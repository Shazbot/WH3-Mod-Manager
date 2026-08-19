import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { EsfMapPayload } from "./types";

/** Bump whenever the derived map payload or the map extraction rules change. */
const ESF_MAP_CACHE_VERSION = 4;
const ESF_MAP_CACHE_FILE = "esf-map-data-cache.bin";

type EsfMapDiskPayload = {
  version: number;
  signature: string;
  data: EsfMapPayload;
};

let cachedPayload: EsfMapDiskPayload | undefined;

export const loadEsfMapDiskCache = async (
  userDataPath: string,
  signature: string,
): Promise<EsfMapPayload | undefined> => {
  if (cachedPayload?.signature === signature && cachedPayload.version === ESF_MAP_CACHE_VERSION) {
    return cachedPayload.data;
  }
  try {
    const compressed = await fs.promises.readFile(nodePath.join(userDataPath, ESF_MAP_CACHE_FILE));
    const json = await zstdDecompress(compressed);
    const payload = JSON.parse(json.toString("utf8")) as EsfMapDiskPayload;
    if (payload.version !== ESF_MAP_CACHE_VERSION || payload.signature !== signature) return undefined;
    cachedPayload = payload;
    return payload.data;
  } catch {
    return undefined;
  }
};

export const saveEsfMapDiskCache = async (
  userDataPath: string,
  signature: string,
  data: EsfMapPayload,
): Promise<void> => {
  const payload: EsfMapDiskPayload = { version: ESF_MAP_CACHE_VERSION, signature, data };
  try {
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(nodePath.join(userDataPath, ESF_MAP_CACHE_FILE), compressed);
    cachedPayload = payload;
  } catch (error) {
    console.error("Failed to save ESF map cache:", error);
  }
};

export const clearEsfMapMemoryCache = () => {
  cachedPayload = undefined;
};
