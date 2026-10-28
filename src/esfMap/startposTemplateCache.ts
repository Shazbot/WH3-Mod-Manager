import * as nodePath from "node:path";

import { readJsonDiskCache, writeJsonDiskCache } from "../utility/jsonDiskCache";

export const STARTPOS_REGION_SLOT_TEMPLATE_CACHE_VERSION = 1;
export const STARTPOS_REGION_SLOT_TEMPLATE_CACHE_FILE = "startpos-region-slot-templates-cache.bin";

export interface StartposRegionSlotTemplateRow extends Record<string, string> {
  campaign: string;
  region: string;
  slot_template: string;
  slot_type: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasValidRows = (value: unknown): value is StartposRegionSlotTemplateRow[] => {
  if (!Array.isArray(value)) return false;
  const fields = ["campaign", "region", "slot_template", "slot_type"] as const;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
    const row = value[index];
    if (!isRecord(row) || fields.some((field) => typeof row[field] !== "string")) return false;
  }
  return true;
};

const getCacheFilePath = (userDataPath: string) =>
  nodePath.join(userDataPath, STARTPOS_REGION_SLOT_TEMPLATE_CACHE_FILE);

/** Returns only a complete payload for the current signature and format version. */
export const readStartposRegionSlotTemplatesCache = async (
  userDataPath: string,
  signature: string,
): Promise<StartposRegionSlotTemplateRow[] | undefined> => {
  const payload = await readJsonDiskCache<unknown>(getCacheFilePath(userDataPath));
  if (
    !isRecord(payload) ||
    payload.version !== STARTPOS_REGION_SLOT_TEMPLATE_CACHE_VERSION ||
    payload.signature !== signature ||
    !hasValidRows(payload.rows)
  ) {
    return undefined;
  }
  return payload.rows;
};

/** Invalid rows are never published; disk write failures are handled by the shared cache helper. */
export const writeStartposRegionSlotTemplatesCache = async (
  userDataPath: string,
  signature: string,
  rows: StartposRegionSlotTemplateRow[],
): Promise<void> => {
  if (!hasValidRows(rows)) return;
  await writeJsonDiskCache(getCacheFilePath(userDataPath), {
    version: STARTPOS_REGION_SLOT_TEMPLATE_CACHE_VERSION,
    signature,
    rows,
  });
};
