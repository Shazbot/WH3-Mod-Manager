import { getSchemaForGame } from "../schema";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import {
  DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
  readPackIndex,
  readPayload,
  readRawPayloadPrefix,
  type CorePack,
  type CorePackEntry,
} from "../packCore";
import { AutomationError, automationErrorFromUnknown } from "./errors";
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
