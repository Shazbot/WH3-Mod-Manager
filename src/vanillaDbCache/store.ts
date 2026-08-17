import { app } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";

import appData from "../appData";
import { readPack } from "../packFileSerializer";
import { DBVersion, Pack, PackedFile, SchemaField } from "../packFileTypes";
import { DBNameToDBVersions, getSchemaFileName } from "../schema";
import { SupportedGames, gameToPackWithDBTablesName } from "../supportedGames";
import { parseDBTablePath, resolveParsedDBVersion } from "../utility/packFileHelpers";
import { buildVanillaDbCache } from "./build";
import { createCacheBuildGeneration } from "./buildGeneration";
import { VanillaDbCacheIdentity, isVanillaDbCacheCurrent } from "./format";
import { VanillaDbCacheBuildPhase, VanillaDbCacheBuildStatus, reportVanillaDbCacheBuildProgress } from "./progress";
import { CacheCandidateResult, openCacheCandidate } from "./openPolicy";
import {
  VanillaDbCacheIntegrityError,
  VanillaDbCacheReader,
  createFileSource,
  createMemorySource,
  openVanillaDbCache,
} from "./read";
import { buildCacheIdentityKey, createCacheRebuildPolicy } from "./rebuildPolicy";
import { VanillaSearchOptions, VanillaSearchResult, searchVanillaDbCache } from "./search";
import { getIndexedDbTablePathsForPrefix, isSamePackPath, isVanillaDbPackPath } from "./routing";

/**
 * Owns the vanilla DB cache file: finding it, deciding whether it still applies, building it when it
 * does not, and handing out a reader.
 *
 * Everything Electron-shaped lives here so the format, builder and reader stay pure and testable. The
 * cache is built lazily on the first request and reused from then on, matching the other caches under
 * userData.
 */

const cacheFileName = (game: SupportedGames) => `vanilla-db-cache-${game}.bin`;

const readerByGame = new Map<SupportedGames, VanillaDbCacheReader>();
/** In flight builds, so several callers arriving at once do not each parse db.pack. */
const buildsInFlight = new Map<SupportedGames, Promise<VanillaDbCacheReader | undefined>>();
/** Stops a cache that keeps coming back broken from being rebuilt on every request. */
const rebuildPolicy = createCacheRebuildPolicy();
/** Invalidates work that was started before a game or folder change. */
const buildGeneration = createCacheBuildGeneration();
let nextBuildId = 0;

/**
 * sha1 of the bundled schema file.
 *
 * The schema is a build artifact with no content revision to key on - its own `version` field is the
 * RPFM file format version, which does not move when a table gains a field. Hashing the 200 KB file
 * takes well under a millisecond and is exact.
 */
const getSchemaHash = (game: SupportedGames): string | undefined => {
  try {
    const schemaPath = nodePath.join(__dirname, `../schema/${getSchemaFileName(game)}`);
    return crypto.createHash("sha1").update(fs.readFileSync(schemaPath)).digest("hex");
  } catch (error) {
    console.log("vanilla db cache: could not hash the schema", error);
    return undefined;
  }
};

/** The identity, with `game` kept narrow - VanillaDbCacheIdentity widens it to a plain string. */
type GameCacheIdentity = VanillaDbCacheIdentity & { game: SupportedGames };

const getIdentity = (game: SupportedGames): GameCacheIdentity | undefined => {
  const dataFolder = appData.gamesToGameFolderPaths[game]?.dataFolder;
  if (!dataFolder) return undefined;

  const dbPackPath = nodePath.resolve(dataFolder, gameToPackWithDBTablesName[game]);
  const schemaHash = getSchemaHash(game);
  if (!schemaHash) return undefined;

  try {
    const stats = fs.statSync(dbPackPath);
    return {
      game,
      dbPackPath,
      dbPackSize: stats.size,
      dbPackMtimeMs: stats.mtimeMs,
      schemaHash,
    };
  } catch {
    return undefined;
  }
};

/** A cheap routing check that deliberately runs before opening or building a cache reader. */
export const canUseVanillaDbCacheForPack = (packPath: string): boolean =>
  isVanillaDbPackPath(
    packPath,
    appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder,
    gameToPackWithDBTablesName[appData.currentGame],
  );

type OpenExistingResult = CacheCandidateResult<VanillaDbCacheReader>;

const openExisting = (game: SupportedGames, identity: VanillaDbCacheIdentity): OpenExistingResult => {
  const cacheFilePath = nodePath.join(app.getPath("userData"), cacheFileName(game));
  return openCacheCandidate({
    openSource: () => createFileSource(cacheFilePath),
    openReader: (source) => openVanillaDbCache(source),
    isCurrent: (reader) => isVanillaDbCacheCurrent(reader.meta, identity),
    isMissingError: (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
  });
};

type BuildCacheFileResult = "built" | "empty" | "invalid-output" | "cancelled";

interface CacheBuildContext {
  buildId: string;
  generation: number;
  isCurrent(): boolean;
}

const reportBuildProgress = (
  identity: GameCacheIdentity,
  context: CacheBuildContext,
  phase: VanillaDbCacheBuildPhase,
  percent: number,
  status: VanillaDbCacheBuildStatus = "running",
  detail?: string,
): void => {
  reportVanillaDbCacheBuildProgress({
    buildId: context.buildId,
    game: identity.game,
    phase,
    percent,
    status,
    detail,
  });
};

const removeBuildFile = async (filePath: string): Promise<void> => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const buildCacheFile = async (
  identity: GameCacheIdentity,
  context: CacheBuildContext,
): Promise<BuildCacheFileResult> => {
  const startedAt = performance.now();
  console.log(`vanilla db cache: building for ${identity.game} from ${identity.dbPackPath}`);

  // The whole DB region, parsed. This is the cost the cache exists to stop paying on every start, and
  // it is the same parse getDefaultTableVersions and the compat check already do cold.
  reportBuildProgress(identity, context, "indexing", 5);
  const pack = await readPack(identity.dbPackPath, { skipParsingTables: true });
  if (!context.isCurrent()) return "cancelled";
  const tablePaths = pack.packedFiles
    .filter((packedFile) => parseDBTablePath(packedFile.name) != undefined)
    .map((packedFile) => packedFile.name);
  if (tablePaths.length === 0) {
    console.log("vanilla db cache: no db tables in the pack, nothing to build");
    return "empty";
  }

  reportBuildProgress(identity, context, "parsing", 20);
  const parsed = await readPack(identity.dbPackPath, { tablesToRead: tablePaths });
  if (!context.isCurrent()) return "cancelled";
  const dbVersionsForGame = DBNameToDBVersions[identity.game];

  reportBuildProgress(identity, context, "encoding", 65);
  const { bytes, meta, skipped } = buildVanillaDbCache(
    parsed.packedFiles,
    (packedFile) => {
      const dbName = parseDBTablePath(packedFile.name)?.dbName;
      if (!dbName) return undefined;
      return resolveParsedDBVersion(packedFile.version, dbVersionsForGame?.[dbName]);
    },
    identity,
  );
  if (!context.isCurrent()) return "cancelled";

  // This is the one failure known to be deterministic: the reader rejected bytes straight from the
  // builder, before the filesystem could damage or temporarily hide them. Retrying the same build
  // cannot help, so let the caller abandon this identity immediately.
  reportBuildProgress(identity, context, "validating", 85);
  const generatedReader = openVanillaDbCache(createMemorySource(bytes), identity);
  if (!generatedReader) return "invalid-output";
  generatedReader.close();
  if (!context.isCurrent()) return "cancelled";

  // Written aside and renamed, so a crash mid-write cannot leave a half file where the real one goes.
  const cacheFilePath = nodePath.join(app.getPath("userData"), cacheFileName(identity.game));
  const temporaryPath = `${cacheFilePath}.building`;
  reportBuildProgress(identity, context, "writing", 92);
  // Remove a temporary file left by a previous crash before replacing it with this attempt's bytes.
  await removeBuildFile(temporaryPath);
  try {
    await fs.promises.writeFile(temporaryPath, bytes);
    if (!context.isCurrent()) return "cancelled";
    await fs.promises.rename(temporaryPath, cacheFilePath);
  } finally {
    await removeBuildFile(temporaryPath);
  }

  console.log(
    `vanilla db cache: built ${meta.tables.length} tables, ${skipped.length} skipped,` +
      ` ${(bytes.length / 1048576).toFixed(1)} MB in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  return "built";
};

const recordRecoverableFailure = (identityKey: string, message: string, error?: unknown): boolean => {
  const { abandoned, failureCount } = rebuildPolicy.recordRecoverableFailure(identityKey);
  console.log(
    `vanilla db cache: ${message} (${failureCount} this session)` + `${abandoned ? ", not trying again" : ""}`,
    error,
  );
  return abandoned;
};

/**
 * A reader for the current game's vanilla DB cache, building it first if need be.
 *
 * Returns undefined when there is no game folder, no schema, or the build failed - every caller is
 * expected to fall back to reading the pack, which is what it did before this existed.
 */
export const getVanillaDbCacheReader = async (): Promise<VanillaDbCacheReader | undefined> => {
  const game = appData.currentGame;
  const generation = buildGeneration.capture();

  const existingReader = readerByGame.get(game);
  if (existingReader) return existingReader;

  const inFlight = buildsInFlight.get(game);
  if (inFlight) return inFlight;

  const attempt = (async () => {
    const identity = getIdentity(game);
    if (!identity) return undefined;

    const identityKey = buildCacheIdentityKey(identity);
    if (!rebuildPolicy.mayBuild(identityKey)) return undefined;

    const existing = openExisting(game, identity);
    if (existing.kind === "opened") {
      readerByGame.set(game, existing.reader);
      return existing.reader;
    }
    if (existing.kind === "io-error") {
      recordRecoverableFailure(identityKey, "could not open the cache", existing.error);
      return undefined;
    }
    if (existing.kind === "invalid") {
      if (recordRecoverableFailure(identityKey, "existing cache would not open")) return undefined;
    }

    const buildId = `${game}-${++nextBuildId}`;
    const buildContext: CacheBuildContext = {
      buildId,
      generation,
      isCurrent: () => buildGeneration.isCurrent(generation) && appData.currentGame === game,
    };

    try {
      const buildResult = await buildCacheFile(identity, buildContext);
      if (buildResult === "cancelled") {
        reportBuildProgress(identity, buildContext, "complete", 0, "cancelled");
        return undefined;
      }
      if (buildResult === "empty") {
        reportBuildProgress(identity, buildContext, "complete", 0, "failed", "No DB tables found");
        return undefined;
      }
      if (buildResult === "invalid-output") {
        rebuildPolicy.recordUnopenable(identityKey);
        reportBuildProgress(identity, buildContext, "complete", 0, "failed", "Generated cache failed validation");
        console.log("vanilla db cache: the reader rejected bytes directly from the builder, not building it again");
        return undefined;
      }
    } catch (error) {
      recordRecoverableFailure(identityKey, "build failed", error);
      reportBuildProgress(
        identity,
        buildContext,
        "complete",
        0,
        "failed",
        error instanceof Error ? error.message : "Cache build failed",
      );
      return undefined;
    }

    if (!buildContext.isCurrent()) {
      reportBuildProgress(identity, buildContext, "complete", 0, "cancelled");
      return undefined;
    }

    const built = openExisting(game, identity);
    if (built.kind !== "opened") {
      recordRecoverableFailure(
        identityKey,
        `freshly built cache could not be opened (${built.kind})`,
        built.kind === "io-error" ? built.error : undefined,
      );
      reportBuildProgress(identity, buildContext, "complete", 0, "failed", `Cache could not be opened (${built.kind})`);
      return undefined;
    }

    if (!buildContext.isCurrent()) {
      built.reader.close();
      reportBuildProgress(identity, buildContext, "complete", 0, "cancelled");
      return undefined;
    }

    readerByGame.set(game, built.reader);
    reportBuildProgress(identity, buildContext, "complete", 100, "complete");
    return built.reader;
  })();

  buildsInFlight.set(game, attempt);
  try {
    return await attempt;
  } finally {
    if (buildsInFlight.get(game) === attempt) buildsInFlight.delete(game);
  }
};

const discardCorruptReader = async (reader: VanillaDbCacheReader, error: unknown): Promise<void> => {
  const game = reader.meta.game as SupportedGames;
  const { abandoned, failureCount } = rebuildPolicy.recordRecoverableFailure(buildCacheIdentityKey(reader.meta));
  console.log(
    `vanilla db cache: corrupt payload (${failureCount} failure(s) this session), discarding the cache` +
      `${abandoned ? " and not rebuilding it again" : ""}`,
    error,
  );
  if (readerByGame.get(game) === reader) readerByGame.delete(game);
  try {
    reader.close();
  } catch {
    // The handle may already have been closed by a concurrent failure or game switch.
  }

  // Removed either way: a rebuild needs it gone, and when giving up, leaving a file behind that is
  // known bad would only be reopened and rejected on the next start.
  const filePath = nodePath.join(app.getPath("userData"), cacheFileName(game));
  try {
    await fs.promises.unlink(filePath);
  } catch (unlinkError) {
    if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
      console.log("vanilla db cache: could not remove corrupt cache", unlinkError);
    }
  }
};

/**
 * Searches the base game tables, or undefined when the cache cannot answer.
 *
 * The entry point consumers should use rather than calling `searchVanillaDbCache` on a reader: like
 * every other consumer here, a block that fails verification discards the cache and reports a miss,
 * instead of letting the error escape into a caller that has no idea what to do with it.
 */
export const searchVanillaDb = async (options: VanillaSearchOptions): Promise<VanillaSearchResult | undefined> => {
  if (options.query === "") {
    return { matches: [], truncated: false, columnsConsidered: 0, columnsScanned: 0 };
  }
  const reader = await getVanillaDbCacheReader();
  if (!reader) return undefined;

  try {
    return searchVanillaDbCache(reader, options);
  } catch (error) {
    if (!(error instanceof VanillaDbCacheIntegrityError)) throw error;
    await discardCorruptReader(reader, error);
    return undefined;
  }
};

/**
 * Why the caller's schema does not match what the table was stored as, or undefined when it does.
 *
 * Compares every field, not just how many there are. Two versions of a table can share a column count
 * and differ in a type, and that would decode without complaint into values of the wrong shape - the
 * exact silent-wrong-data failure the whole cache is built to avoid.
 */
const describeSchemaDisagreement = (
  schema: DBVersion | undefined,
  tableMeta: { columns: Array<{ name: string; fieldType: string }> },
): string | undefined => {
  if (!schema) return "has no schema for the reader";
  if (schema.fields.length !== tableMeta.columns.length) {
    return `would be read with ${schema.fields.length} columns but was stored with ${tableMeta.columns.length}`;
  }
  for (let index = 0; index < schema.fields.length; index++) {
    const expected = tableMeta.columns[index];
    const actual = schema.fields[index];
    if (actual.name !== expected.name || actual.field_type !== expected.fieldType) {
      return (
        `column ${index} would be read as ${actual.name}:${actual.field_type}` +
        ` but was stored as ${expected.name}:${expected.fieldType}`
      );
    }
  }
  return undefined;
};

/**
 * Fills in one table's rows from the cache, on a pack whose file index is already known.
 *
 * Returns false when the cache cannot serve it, and the caller reads the pack as before. The index
 * itself is not something this can provide - the viewer builds its table tree from the full packed
 * file list - so this only replaces the parse, which is the expensive half.
 *
 * `resolveViewerSchema` is how the *caller* will resolve the layout when it renders the rows. If that
 * disagrees with what the cache stored the table as, the rows would be chunked by the wrong field
 * count, so the mismatch is checked rather than assumed: `getDBVersion` and the parser's own rule
 * differ for tables neither would parse, and only a check keeps that from mattering here.
 */
export const fillPackedFileFromVanillaCache = async (
  packPath: string,
  packedFilePath: string,
  packedFile: PackedFile,
  resolveViewerSchema: (packedFile: PackedFile) => DBVersion | undefined,
): Promise<boolean> => {
  if (!canUseVanillaDbCacheForPack(packPath)) return false;
  const reader = await getVanillaDbCacheReader();
  if (!reader) return false;
  if (!isSamePackPath(reader.meta.dbPackPath, packPath)) return false;

  return fillPackedFileFromReader(reader, packedFilePath, packedFile, resolveViewerSchema);
};

const fillPackedFileFromReader = async (
  reader: VanillaDbCacheReader,
  packedFilePath: string,
  packedFile: PackedFile,
  resolveViewerSchema: (packedFile: PackedFile) => DBVersion | undefined,
): Promise<boolean> => {
  const tableMeta = reader.getTableMeta(packedFilePath);
  if (!tableMeta) return false;

  let rows: SchemaField[][] | undefined;
  try {
    rows = reader.getTableRows(packedFilePath);
  } catch (error) {
    // Only a failed checksum condemns the cache. Anything else is a bug in decoding, and throwing the
    // file away for it would delete a perfectly good cache and rebuild it on every request.
    if (!(error instanceof VanillaDbCacheIntegrityError)) {
      console.log(`vanilla db cache: could not decode ${packedFilePath}, falling back to the pack`, error);
      return false;
    }
    await discardCorruptReader(reader, error);
    return false;
  }
  if (!rows) return false;

  // The version marker drives which schema the caller resolves, so it has to be restored first.
  const previousVersion = packedFile.version;
  packedFile.version = tableMeta.packedFileVersion;
  const viewerSchema = resolveViewerSchema(packedFile);
  const disagreement = describeSchemaDisagreement(viewerSchema, tableMeta);
  if (disagreement) {
    packedFile.version = previousVersion;
    console.log(`vanilla db cache: ${packedFilePath} ${disagreement}, falling back to the pack`);
    return false;
  }

  packedFile.schemaFields = rows.flat();
  if (tableMeta.guid != undefined) packedFile.guid = tableMeta.guid;
  return true;
};

/**
 * Fills every table matching one of `tablePathPrefixes` on an already-indexed vanilla pack.
 *
 * For the compatibility check, which needs the rows themselves - it builds key sets and a unique-id
 * registry from them - so this replaces where the rows come from and leaves the scan untouched. That
 * is deliberately conservative: a wrong key set there produces wrong conflict reports rather than
 * anything visible, so the scan is not restructured until the source is proven in place.
 *
 * Returns the prefixes it could not fully serve, which the caller still has to read from the pack.
 * A prefix with no indexed table files is an empty table family, not a cache miss: some schema
 * tables are stored in startpos.esf or are simply absent from a particular game's db.pack.
 */
export const fillVanillaTablesFromCache = async (
  pack: Pack,
  tablePathPrefixes: readonly string[],
  resolveConsumerSchema: (packedFile: PackedFile) => DBVersion | undefined,
): Promise<{ servedTablePaths: string[]; unservedPrefixes: string[] }> => {
  const servedTablePaths: string[] = [];
  const unservedPrefixes: string[] = [];

  if (!canUseVanillaDbCacheForPack(pack.path)) {
    return { servedTablePaths, unservedPrefixes: [...tablePathPrefixes] };
  }

  const reader = await getVanillaDbCacheReader();
  if (!reader || !isSamePackPath(reader.meta.dbPackPath, pack.path)) {
    return { servedTablePaths, unservedPrefixes: [...tablePathPrefixes] };
  }

  const packedFileByName = new Map(pack.packedFiles.map((packedFile) => [packedFile.name, packedFile]));

  for (const prefix of tablePathPrefixes) {
    // Completeness is defined by the pack index. Looking only at the cache directory would hide a
    // packed file the builder deliberately skipped and incorrectly turn a partial result into a hit.
    // An empty result, however, means this pack has no table files under the prefix and therefore
    // has no rows for the cache to provide.
    const tablePaths = getIndexedDbTablePathsForPrefix(pack.packedFiles, prefix);
    if (tablePaths.length === 0) {
      // There is no vanilla row source to read for an absent prefix. In particular, WH3's
      // start_pos_* data is reconstructed from startpos.esf by the Buildings loader, rather than
      // being part of db.pack or this cache.
      continue;
    }

    let servedAll = true;
    for (const tablePath of tablePaths) {
      const packedFile = packedFileByName.get(tablePath);
      if (!packedFile) {
        servedAll = false;
        continue;
      }
      // Already parsed, by an earlier fill or a real read. Leaving it be keeps this idempotent.
      if (packedFile.schemaFields) {
        servedTablePaths.push(tablePath);
        continue;
      }
      if (await fillPackedFileFromReader(reader, tablePath, packedFile, resolveConsumerSchema)) {
        servedTablePaths.push(tablePath);
      } else {
        servedAll = false;
        // A corrupt block discards and closes this reader. Stop touching it and make the caller read
        // every requested prefix from the pack, including any tables filled earlier in this attempt.
        if (readerByGame.get(reader.meta.game as SupportedGames) !== reader) {
          return { servedTablePaths: [], unservedPrefixes: [...tablePathPrefixes] };
        }
      }
    }
    // Partly served is no use: the caller reads the whole prefix, and a second read of a table already
    // filled is harmless, where a missing one would silently narrow the key set it resolves against.
    if (!servedAll) unservedPrefixes.push(prefix);
  }

  return { servedTablePaths, unservedPrefixes };
};

/**
 * A whole `readPack` result served from the cache, or undefined to read the pack as before.
 *
 * For callers that ask for tables by name and nothing else - flows and deep clone go through one
 * chokepoint that does exactly that. The file index still comes from the pack, which costs about 6 ms
 * and is what callers use to find their tables; the parse, the expensive part, comes from the cache.
 *
 * All or nothing on purpose. A pack filled with only some of the tables asked for would let a flow
 * that dedupes against vanilla, or a reference lookup, silently miss rows and produce a wrong answer
 * with nothing logged.
 */
export const readVanillaPackFromCache = async (
  packPath: string,
  packReadingOptions: PackReadingOptions,
  resolveConsumerSchema: (packedFile: PackedFile) => DBVersion | undefined,
): Promise<Pack | undefined> => {
  const { tablesToRead, skipParsingTables, readLocs, readScripts, filesToRead, readFlows } = packReadingOptions;
  // Anything beyond db tables has to come from the pack: the cache holds nothing else.
  if (!tablesToRead?.length) return undefined;
  if (skipParsingTables || readLocs || readScripts || readFlows || filesToRead?.length) return undefined;
  if (!canUseVanillaDbCacheForPack(packPath)) return undefined;

  const reader = await getVanillaDbCacheReader();
  if (!reader || !isSamePackPath(reader.meta.dbPackPath, packPath)) return undefined;

  const pack = await readPack(packPath, { skipParsingTables: true });
  const { unservedPrefixes } = await fillVanillaTablesFromCache(pack, tablesToRead, resolveConsumerSchema);
  if (unservedPrefixes.length > 0) return undefined;

  // Left as readPack would have left it for this request, so nothing downstream can tell them apart.
  pack.readTables = [...tablesToRead];
  return pack;
};

/** Drops open readers, so the next request revalidates against the pack and schema on disk. */
export const closeVanillaDbCacheReaders = (): void => {
  buildGeneration.invalidate();
  for (const reader of readerByGame.values()) reader.close();
  readerByGame.clear();
};
