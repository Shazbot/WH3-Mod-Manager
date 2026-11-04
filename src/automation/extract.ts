import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES, readDbTablePreamble, type CorePack, type CorePackEntry } from "../packCore";
import { parseDBTablePath, resolveParsedDBVersion } from "../utility/packFileHelpers";
import { buildRpfmTsvContent } from "../utility/rpfmTsv";
import { normalizeInternalPackPath } from "./filesystem";
import {
  AutomationError,
  automationErrorFromUnknown,
  throwIfAborted,
  yieldToEventLoop,
  type AutomationDiagnostic,
} from "./errors";
import {
  getAutomationSchemaProvider,
  readAutomationPack,
  withAutomationPackReadSession,
  type AutomationPackReadSession,
} from "./packAccess";
import { loadPackedTable } from "./tables";
import { discoverGameDataPath, parseManifestPackNames, validateManifestPackName } from "./vanilla";
import type { AutomationContext, OperationOutput } from "./operations";

export const packExtractSchema = z
  .object({
    operation: z.literal("pack_extract"),
    packPaths: z.array(z.string().min(1)).max(512).default([]),
    withVanilla: z.boolean().default(false),
    gameDataPath: z.string().min(1).optional(),
    language: z.enum(["br", "cn", "cz", "en", "fr", "ge", "it", "kr", "pl", "ru", "sp", "tr", "zh"]).default("en"),
    folders: z.array(z.string().min(1)).max(512).default([]),
    looseFiles: z.array(z.string().min(1)).max(10000).default([]),
    outputPath: z.string().min(1),
    tableFormat: z.enum(["tsv", "raw"]).default("tsv"),
    keysFirst: z.boolean().default(false),
    overwrite: z.boolean().default(false),
    reportPath: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (request) => request.packPaths.length > 0 || request.withVanilla || request.gameDataPath !== undefined,
    "Provide packPaths or enable vanilla extraction",
  )
  .refine(
    (request) => !request.looseFiles.length || request.withVanilla || request.gameDataPath !== undefined,
    "looseFiles requires vanilla game data",
  )
  .refine((request) => !request.keysFirst || request.tableFormat === "tsv", "keysFirst requires TSV export");

type Request = z.output<typeof packExtractSchema>;
type PackedSource = { pack: CorePack; entry: CorePackEntry; internalPath: string };
type LooseSource = { sourcePath: string; internalPath: string };
type SourceFile = PackedSource | LooseSource;
type PlannedFile = SourceFile & { outputPath: string; tsv: boolean };
const sourcePack = (file: SourceFile) => ("pack" in file ? file.pack : undefined);
const pathKey = (value: string) => value.toLowerCase();
const identity = (stat: Awaited<ReturnType<typeof snapshot>>) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
const snapshot = (file: string) => fs.stat(file, { bigint: true });
const inodeKey = (stat: { dev: bigint; ino: bigint }) => `${stat.dev}:${stat.ino}`;
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};
const optionalStat = async (file: string) =>
  fs.stat(file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
const readPayload = async (session: AutomationPackReadSession, entry: CorePackEntry) => {
  try {
    return await session.readPayload(entry);
  } catch (error) {
    const normalized = automationErrorFromUnknown(error);
    throw new AutomationError(normalized.code === "INTERNAL" ? "VALIDATION" : normalized.code, normalized.message, {
      packPath: session.pack.path,
      filePath: entry.name,
    });
  }
};

export const runPackExtract = async (request: Request, context: AutomationContext): Promise<OperationOutput> => {
  const diagnostics: AutomationDiagnostic[] = [];
  const folders = [...new Set(request.folders.map((folder) => normalizeInternalPackPath(folder).toLowerCase()))];
  const root = await context.policy.assertWritePath(request.outputPath);
  const rootStats = await optionalStat(root);
  if (rootStats && !rootStats.isDirectory())
    throw new AutomationError("IO_ACCESS", "Extraction output must be a directory");
  const sources: string[] = [];
  const sourceIdentities = new Map<string, string>();
  const sourcePaths = new Set<string>();
  const sourceInodes = new Set<string>();
  const protectSource = async (file: string) => {
    const canonical = await context.policy.assertReadPath(file);
    const stat = await snapshot(canonical);
    sources.push(canonical);
    sourceIdentities.set(canonical, identity(stat));
    sourcePaths.add(pathKey(canonical));
    sourceInodes.add(inodeKey(stat));
    return canonical;
  };
  const assertSources = async () => {
    for (const [source, expected] of sourceIdentities) {
      if ((await context.policy.assertReadPath(source)) !== source || identity(await snapshot(source)) !== expected)
        throw new AutomationError("CONFLICT", "Extraction source changed", { source });
    }
  };

  const packPaths: string[] = [];
  const looseSources: LooseSource[] = [];
  if (request.withVanilla || request.gameDataPath !== undefined) {
    const dataPath = await context.policy.assertReadPath(request.gameDataPath ?? (await discoverGameDataPath(context)));
    const manifestPath = await protectSource(path.join(dataPath, "manifest.txt"));
    const manifest = (await context.policy.readFile(manifestPath)).bytes.toString("utf8");
    const names = parseManifestPackNames(manifest);
    const manifestFiles = new Map(
      manifest
        .split(/\r?\n/)
        .map((line) => line.match(/[^\s]+/)?.[0])
        .filter((name): name is string => Boolean(name && !name.toLowerCase().endsWith(".pack")))
        .map((name) => {
          const internalPath = normalizeInternalPackPath(name);
          return [internalPath.toLowerCase(), internalPath];
        }),
    );
    for (const requested of new Set(request.looseFiles.map((file) => normalizeInternalPackPath(file).toLowerCase()))) {
      const internalPath = manifestFiles.get(requested);
      if (!internalPath)
        throw new AutomationError("VALIDATION", "Loose file is not listed in the game manifest", { path: requested });
      const sourcePath = await protectSource(path.join(dataPath, ...internalPath.split("\\")));
      if (!inside(dataPath, sourcePath))
        throw new AutomationError("IO_ACCESS", "Loose source escapes game data directory", { path: sourcePath });
      looseSources.push({ sourcePath, internalPath });
    }
    if (!names.length)
      throw new AutomationError("VALIDATION", "No base game packs listed in manifest", { manifestPath });
    const localNames = names.filter((name) => /^local_[^/\\]+\.pack$/i.test(name));
    if (localNames.length && !localNames.some((name) => name.toLowerCase() === `local_${request.language}.pack`))
      throw new AutomationError("VALIDATION", `Manifest has no localization pack for ${request.language}`);
    for (const name of names) {
      const safeName = validateManifestPackName(name);
      if (/^local_[^/\\]+\.pack$/i.test(safeName) && safeName.toLowerCase() !== `local_${request.language}.pack`)
        continue;
      packPaths.push(path.join(dataPath, safeName));
    }
  }
  packPaths.push(...request.packPaths);
  const packs: CorePack[] = [];
  const winners = new Map<string, SourceFile>();
  let selectedEntries = 0;
  for (const input of packPaths) {
    throwIfAborted(context.signal);
    const canonical = await context.policy.assertReadPath(input);
    // An explicitly repeated pack is moved to its final position in the load order.
    const existing = packs.findIndex((pack) => pack.path === canonical);
    let pack: CorePack;
    if (existing >= 0) pack = packs.splice(existing, 1)[0];
    else {
      await protectSource(canonical);
      pack = await readAutomationPack(canonical, context);
      if (identity(await snapshot(canonical)) !== sourceIdentities.get(canonical))
        throw new AutomationError("CONFLICT", "Pack changed while indexing", { packPath: canonical });
    }
    packs.push(pack);
    const seen = new Set<string>();
    for (const entry of pack.entries) {
      const internalPath = normalizeInternalPackPath(entry.name);
      const key = internalPath.toLowerCase();
      if (!folders.length || folders.some((folder) => key.startsWith(`${folder}\\`))) {
        if (seen.has(key))
          throw new AutomationError("CONFLICT", "Ambiguous duplicate packed path", {
            packPath: canonical,
            path: entry.name,
          });
        seen.add(key);
        winners.set(key, { pack, entry, internalPath });
        selectedEntries++;
      }
    }
    context.progress?.({ stage: "extract-index", completed: packs.length, total: packPaths.length });
    await yieldToEventLoop(context.signal);
  }

  const explicitPacks = new Set(
    await Promise.all(request.packPaths.map((file) => context.policy.assertReadPath(file))),
  );
  for (const file of looseSources) {
    selectedEntries++;
    const key = file.internalPath.toLowerCase();
    const winner = winners.get(key);
    const winnerPack = winner && sourcePack(winner);
    // Explicit packs remain highest priority; selected loose vanilla files override vanilla packs.
    if (!winnerPack || !explicitPacks.has(winnerPack.path)) winners.set(key, file);
  }
  const withSourceSession = (
    pack: CorePack | undefined,
    scan: (session?: AutomationPackReadSession) => Promise<void>,
  ) => (pack ? withAutomationPackReadSession(pack, context, scan) : scan());
  const readSource = async (file: SourceFile, session?: AutomationPackReadSession) => {
    if ("entry" in file) {
      if (!session) throw new AutomationError("INTERNAL", "Missing source pack session");
      return readPayload(session, file.entry);
    }
    const limit = context.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES;
    const stat = await snapshot(file.sourcePath);
    if (!stat.isFile() || stat.size > BigInt(limit))
      throw new AutomationError("VALIDATION", "Loose source is not a file or exceeds the payload limit", {
        path: file.sourcePath,
      });
    if (identity(stat) !== sourceIdentities.get(file.sourcePath))
      throw new AutomationError("CONFLICT", "Loose source changed", { path: file.sourcePath });
    const payload = (await context.policy.readFile(file.sourcePath)).bytes;
    if (payload.length > limit || identity(await snapshot(file.sourcePath)) !== sourceIdentities.get(file.sourcePath))
      throw new AutomationError("CONFLICT", "Loose source changed during extraction", { path: file.sourcePath });
    return payload;
  };

  const provider = getAutomationSchemaProvider(context);
  let schemaPromise: ReturnType<typeof provider> | undefined;
  const schemaProvider: typeof provider = (game) => (schemaPromise ??= provider(game));
  const files: PlannedFile[] = [];
  const destinations = new Map<string, string>();
  const guardDestination = async (destination: string) => {
    const canonical = await context.policy.assertWritePath(destination);
    if (!inside(root, canonical) || canonical === root)
      throw new AutomationError("IO_ACCESS", "Extraction path escapes output directory", { path: destination });
    if (sourcePaths.has(pathKey(canonical)))
      throw new AutomationError("CONFLICT", "Extraction output aliases a source", { path: destination });
    const stat = await optionalStat(canonical);
    if (stat && sourceInodes.has(inodeKey(stat)))
      throw new AutomationError("CONFLICT", "Extraction output is a hard-link alias of a source", {
        path: destination,
      });
    if (stat && !stat.isFile())
      throw new AutomationError("IO_ACCESS", "Extraction destination is not a file", { path: destination });
    if (stat && !request.overwrite)
      throw new AutomationError("CONFLICT", "Extraction output already exists; use overwrite", { path: destination });
    return canonical;
  };
  const failures: { path: string; packPath?: string; sourcePath?: string; code: string; message: string }[] = [];
  const skipFile = (file: SourceFile, error: unknown) => {
    const failure = automationErrorFromUnknown(error);
    if (["CANCELLED", "CONFLICT", "IO_ACCESS", "INVALID_ARGUMENT"].includes(failure.code)) throw failure;
    failures.push({
      path: file.internalPath,
      ...("pack" in file ? { packPath: file.pack.path } : { sourcePath: file.sourcePath }),
      code: failure.code === "INTERNAL" ? "VALIDATION" : failure.code,
      message: failure.message,
    });
    diagnostics.push({
      code: "EXTRACT_FILE_FAILED",
      severity: "warning",
      path: file.internalPath,
      message: `Skipped file: ${failure.message}`,
    });
  };
  // Plan final filenames first, including raw fallback, so conflicts are found before publication.
  for (const pack of [...packs, undefined]) {
    const selected = [...winners.values()].filter((file) => sourcePack(file) === pack);
    if (!selected.length) continue;
    await withSourceSession(pack, async (session) => {
      for (const file of selected) {
        throwIfAborted(context.signal);
        const relative = file.internalPath.replaceAll("\\", "/");
        // Avoid NTFS alternate streams and Win32 filename aliases, even when running on Linux.
        if (
          relative
            .split("/")
            .some(
              (segment) =>
                /[<>:"|?*]/.test(segment) ||
                [...segment].some((character) => character.charCodeAt(0) < 32) ||
                /[. ]$/.test(segment) ||
                /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
            )
        )
          throw new AutomationError("VALIDATION", "Packed path cannot be extracted safely", {
            path: file.internalPath,
          });
        const key = file.internalPath.toLowerCase();
        const db = parseDBTablePath(key);
        let tsv = request.tableFormat === "tsv" && key.endsWith(".loc");
        if (request.tableFormat === "tsv" && db && !key.endsWith(".loc")) {
          const schemas = (await schemaProvider("wh3"))[db.dbName];
          let unsupported = !schemas?.length;
          if (!unsupported) {
            let preamble: ReturnType<typeof readDbTablePreamble>;
            try {
              preamble = readDbTablePreamble(await readSource(file, session));
            } catch (error) {
              skipFile(file, error);
              continue;
            }
            unsupported = !(preamble.version === undefined
              ? resolveParsedDBVersion(undefined, schemas)
              : schemas.find((schema) => schema.version === preamble.version));
          }
          tsv = !unsupported;
          if (unsupported)
            diagnostics.push({
              code: "EXTRACT_RAW_TABLE",
              severity: "warning",
              path: file.internalPath,
              message: "No matching table schema; extracted the original payload",
            });
        }
        const outputPath = await guardDestination(path.join(root, ...relative.split("/")) + (tsv ? ".tsv" : ""));
        const destinationKey = pathKey(outputPath);
        if (destinations.has(destinationKey))
          throw new AutomationError("CONFLICT", "Extracted filenames collide", { path: outputPath });
        destinations.set(destinationKey, outputPath);
        files.push({ ...file, outputPath, tsv });
        if ((files.length & 127) === 0)
          context.progress?.({ stage: "extract-plan", completed: files.length, total: winners.size });
      }
    });
    await yieldToEventLoop(context.signal);
  }
  if (request.reportPath) {
    const reportPath = await context.policy.assertOutputDistinctFromSources(request.reportPath, sources);
    const reportStat = await optionalStat(reportPath);
    if (reportStat && !request.overwrite) throw new AutomationError("CONFLICT", "Report already exists");
    if (reportStat && !reportStat.isFile()) throw new AutomationError("IO_ACCESS", "Report must be a file");
    if (destinations.has(pathKey(reportPath)))
      throw new AutomationError("CONFLICT", "Report aliases an extracted file");
    destinations.set(pathKey(reportPath), reportPath);
  }
  for (const output of destinations.values()) {
    for (let parent = path.dirname(output); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      if (destinations.has(pathKey(parent)))
        throw new AutomationError("CONFLICT", "Extraction has conflicting file and directory paths", { path: output });
    }
  }
  await assertSources();

  let extractedFiles = 0;
  let tsvFiles = 0;
  let extractedBytes = 0;
  for (const pack of [...packs, undefined]) {
    const selected = files.filter((file) => sourcePack(file) === pack);
    if (!selected.length) continue;
    await withSourceSession(pack, async (session) => {
      for (const file of selected) {
        throwIfAborted(context.signal);
        let payload: Buffer;
        try {
          payload = await readSource(file, session);
          if (file.tsv) {
            const loaded = await loadPackedTable(file.internalPath, payload, schemaProvider);
            payload = Buffer.from(
              buildRpfmTsvContent({
                packedFilePath: file.internalPath,
                tableName: parseDBTablePath(file.internalPath.toLowerCase())?.dbName ?? "Loc",
                version: loaded.parsed.schema.version,
                schema: loaded.parsed.schema,
                rows: loaded.parsed.rows.map((row) => row.cells),
                keysFirst: request.keysFirst,
                formatting: "rpfm",
              }),
              "utf8",
            );
          }
        } catch (error) {
          skipFile(file, error);
          context.progress?.({
            stage: "extract",
            completed: extractedFiles + failures.length,
            total: winners.size,
            message: file.internalPath,
          });
          await yieldToEventLoop(context.signal);
          continue;
        }
        await guardDestination(file.outputPath);
        await context.policy.withAtomicOutput({
          outputPath: file.outputPath,
          overwrite: request.overwrite,
          produce: async (temporaryPath) => {
            await fs.writeFile(temporaryPath, payload);
          },
          validate: async () => {
            await guardDestination(file.outputPath);
          },
        });
        extractedFiles++;
        if (file.tsv) tsvFiles++;
        extractedBytes += payload.length;
        context.progress?.({
          stage: "extract",
          completed: extractedFiles + failures.length,
          total: winners.size,
          message: file.internalPath,
        });
        if ((extractedFiles & 31) === 0) await yieldToEventLoop(context.signal);
      }
    });
  }
  await assertSources();
  const data = {
    packPaths: packs.map((pack) => pack.path),
    outputPath: root,
    folders: request.folders,
    looseFiles: request.looseFiles,
    language: request.language,
    tableFormat: request.tableFormat,
    keysFirst: request.keysFirst,
    extractedFiles,
    tsvFiles,
    rawFiles: extractedFiles - tsvFiles,
    unsupportedTables: diagnostics.filter((item) => item.code === "EXTRACT_RAW_TABLE").length,
    skippedFiles: failures.length,
    complete: failures.length === 0,
    failures,
    shadowedFiles: selectedEntries - winners.size,
    extractedBytes,
  };
  if (request.reportPath)
    await context.policy.withAtomicOutput({
      outputPath: request.reportPath,
      overwrite: request.overwrite,
      sourcePaths: sources,
      produce: async (temporaryPath) => {
        await fs.writeFile(temporaryPath, JSON.stringify({ ...data, diagnostics }, null, 2) + "\n");
      },
    });
  return { data: { ...data, ...(request.reportPath ? { reportPath: request.reportPath } : {}) }, diagnostics };
};
