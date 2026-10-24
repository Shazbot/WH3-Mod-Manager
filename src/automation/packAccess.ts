import { getSchemaForGame } from "../schema";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import {
  DEFAULT_MAX_LOGICAL_PAYLOAD_BYTES,
  readPackIndex,
  readPayload,
  type CorePack,
  type CorePackEntry,
} from "../packCore";
import { AutomationError, automationErrorFromUnknown } from "./errors";
import { normalizeInternalPackPath } from "./filesystem";
import type { AutomationContext } from "./operations";

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

export const getAutomationSchemaProvider = (context: AutomationContext) =>
  context.schemaProvider ?? ((game: "wh3") => getSchemaForGame(game));
