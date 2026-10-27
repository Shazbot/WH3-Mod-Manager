import { getSchemaForGame } from "../schema";
import * as fs from "node:fs";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import {
  DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
  openRawPayloadRangeReader,
  openRawPackReadSession,
  readPackIndex,
  readPayload,
  readRawPayloadPrefix,
  type CorePack,
  type CorePackEntry,
  type RawPayloadRangeReader,
  Rmv2CodecError,
} from "../packCore";
import { AutomationError, automationErrorFromUnknown, throwIfAborted } from "./errors";
import { normalizeInternalPackPath } from "./filesystem";
import type { AutomationContext } from "./operations";
import { loadPackedTable, tableRowsToJson } from "./tables";
import type { ReadonlyTableData } from "./cacheService";

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

export const readAutomationPack = async (packPath: string, context: AutomationContext): Promise<CorePack> => {
  try {
    if (context.cacheRequest) return await context.cacheRequest.readPackIndex(packPath);
    const canonicalPath = await context.policy.assertReadPath(packPath);
    return readPackIndex(canonicalPath, { game: "wh3", maxLogicalPayloadBytes: context.maxLogicalPayloadBytes });
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    const normalized = automationErrorFromUnknown(error);
    if (normalized.code !== "INTERNAL") throw normalized;
    throw new AutomationError("VALIDATION", error instanceof Error ? error.message : String(error), { packPath });
  }
};

export const findAutomationPackEntry = (pack: CorePack, inputPath: string): CorePackEntry => {
  const wanted = normalizePackFilePathKey(normalizeInternalPackPath(inputPath));
  const matches = pack.entries.filter((entry) => normalizePackFilePathKey(entry.name) === wanted);
  if (matches.length === 0) throw new AutomationError("VALIDATION", `Packed file not found: ${inputPath}`);
  if (matches.length > 1) throw new AutomationError("CONFLICT", `Packed file path is ambiguous: ${inputPath}`);
  return matches[0];
};

export const readAutomationPayload = async (
  pack: CorePack,
  entry: CorePackEntry,
  context: AutomationContext,
): Promise<Buffer> => {
  try {
    await context.cacheRequest?.assertPackSnapshot(pack);
    const payload = await readPayload(pack, entry, {
      game: "wh3",
      maxLogicalPayloadBytes: context.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
    });
    await context.cacheRequest?.assertPackSnapshot(pack);
    return payload;
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const unsupportedCode = error && typeof error === "object" && "code" in error && error.code === "UNSUPPORTED_CODEC";
    const code = unsupportedCode || /not available|unsupported codec/i.test(message) ? "UNSUPPORTED" : "VALIDATION";
    throw new AutomationError(code, message, { filePath: entry.name });
  }
};

export interface AutomationPackReadSession {
  readonly pack: CorePack;
  readPayload(entry: CorePackEntry): Promise<Buffer>;
  withRangeReader<T>(entry: CorePackEntry, read: (reader: RawPayloadRangeReader) => Promise<T>): Promise<T>;
}

/** One authorized handle for a contiguous source-pack scan. Descriptor checks protect every
 * payload; the named path is reauthorized and compared before any scan result is accepted. */
export const withAutomationPackReadSession = async <T>(
  pack: CorePack,
  context: AutomationContext,
  scan: (session: AutomationPackReadSession) => Promise<T>,
): Promise<T> => {
  await context.cacheRequest?.assertPackSnapshot(pack);
  const canonicalPath = await context.policy.assertReadPath(pack.path);
  const raw = await openRawPackReadSession({ path: canonicalPath });
  const expected = fs.fstatSync(raw.descriptor, { bigint: true });
  const same = (next: fs.BigIntStats) => (["size", "mtimeNs", "ctimeNs", "dev", "ino"] as const)
    .every((key) => expected[key] === next[key]);
  const checkDescriptor = async () => {
    throwIfAborted(context.signal);
    if (context.cacheRequest) await context.cacheRequest.assertPackSnapshot(pack, raw.descriptor);
    else if (!same(fs.fstatSync(raw.descriptor, { bigint: true })))
      throw new AutomationError("CONFLICT", "Pack changed during its source scan", { packPath: pack.path });
  };
  const checked = async <R>(read: () => Promise<R>): Promise<R> => {
    await checkDescriptor();
    let result: R | undefined;
    let failure: unknown;
    let failed = false;
    try { result = await read(); } catch (error) { failed = true; failure = error; }
    await checkDescriptor();
    if (failed) throw failure;
    return result as R;
  };
  try {
    if (raw.fileSize !== pack.fileSize)
      throw new AutomationError("CONFLICT", "Pack size changed since its index was read", { packPath: pack.path });
    await checkDescriptor();
    let value: T | undefined;
    let failure: unknown;
    let failed = false;
    try {
      value = await scan({
        pack,
        readPayload: (entry) => checked(() => raw.readPayload(entry, context.maxLogicalPayloadBytes ?? DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES)),
        withRangeReader: (entry, read) => checked(async () => {
          const reader = raw.rangeReader(entry);
          try { return await read(reader); } finally { await reader.close(); }
        }),
      });
    } catch (error) { failed = true; failure = error; }
    await checkDescriptor();
    const finalPath = await context.policy.assertReadPath(pack.path);
    if (finalPath !== canonicalPath || !same(fs.statSync(finalPath, { bigint: true })))
      throw new AutomationError("CONFLICT", "Pack source path changed during its scan", { packPath: pack.path });
    await context.cacheRequest?.assertPackSnapshot(pack);
    if (failed) throw failure;
    return value as T;
  } finally {
    await raw.close();
  }
};

/** Runs one bounded random-access read against an uncompressed pack entry. The pack policy and
 * request snapshot are checked on both sides, and the shared file handle is always released. */
export const withAutomationPayloadRangeReader = async <T>(
  pack: CorePack,
  entry: CorePackEntry,
  context: AutomationContext,
  read: (reader: RawPayloadRangeReader) => Promise<T>,
): Promise<T> => {
  if (entry.is_compressed)
    throw new AutomationError("INVALID_ARGUMENT", "A range reader requires an uncompressed entry", { filePath: entry.name });
  let reader: RawPayloadRangeReader;
  try {
    await context.cacheRequest?.assertPackSnapshot(pack);
    const canonicalPath = await context.policy.assertReadPath(pack.path);
    reader = await openRawPayloadRangeReader({ path: canonicalPath }, entry);
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError("IO_ACCESS", error instanceof Error ? error.message : String(error), { filePath: entry.name });
  }

  try {
    let value: T | undefined;
    let readError: unknown;
    try {
      value = await read(reader);
    } catch (error) {
      readError = error;
    }
    await context.cacheRequest?.assertPackSnapshot(pack);
    if (readError !== undefined) {
      if (readError instanceof AutomationError || readError instanceof Rmv2CodecError) throw readError;
      throw new AutomationError("IO_ACCESS", readError instanceof Error ? readError.message : String(readError), {
        filePath: entry.name,
      });
    }
    return value as T;
  } finally {
    await reader.close();
  }
};

/** Bounded uncompressed prefix reader with the same path and snapshot checks as full reads. */
export const readAutomationPayloadPrefix = async (
  pack: CorePack,
  entry: CorePackEntry,
  maxBytes: number,
  context: AutomationContext,
): Promise<Buffer> => {
  if (entry.is_compressed) throw new AutomationError("INVALID_ARGUMENT", "A raw payload prefix requires an uncompressed entry");
  try {
    await context.cacheRequest?.assertPackSnapshot(pack);
    const canonicalPath = await context.policy.assertReadPath(pack.path);
    const prefix = readRawPayloadPrefix({ path: canonicalPath }, entry, maxBytes);
    await context.cacheRequest?.assertPackSnapshot(pack);
    return prefix;
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError("IO_ACCESS", error instanceof Error ? error.message : String(error), { filePath: entry.name });
  }
};

export const getAutomationSchemaProvider = (context: AutomationContext) =>
  context.schemaProvider ?? ((game: "wh3") => getSchemaForGame(game));

/** A typed, readonly view for query paths; raw ParsedDbTable data remains available to writers. */
export const readAutomationReadonlyTable = async (
  pack: CorePack,
  entry: CorePackEntry,
  context: AutomationContext,
): Promise<ReadonlyTableData> => {
  await context.cacheRequest?.assertPackSnapshot(pack);
  const cached = await context.cacheRequest?.getReadonlyTable(pack.path, entry.name);
  await context.cacheRequest?.assertPackSnapshot(pack);
  if (cached) return cached;

  const loaded = await loadPackedTable(
    entry.name,
    await readAutomationPayload(pack, entry, context),
    getAutomationSchemaProvider(context),
  );
  const schema = deepFreeze(structuredClone(loaded.parsed.schema));
  const rows = Object.freeze(tableRowsToJson(loaded.parsed).map((row) => deepFreeze(row)));
  return Object.freeze({
    packedPath: normalizeInternalPackPath(loaded.packedPath),
    schema,
    isLoc: loaded.isLoc,
    rows,
  });
};
