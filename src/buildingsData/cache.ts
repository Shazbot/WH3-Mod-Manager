import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuiltBuildingsData } from "./types";

/** Bump whenever the shape of `BuiltBuildingsData` or the extraction rules change. */
const BUILDINGS_CACHE_VERSION = 10;
const BUILDINGS_CACHE_FILE = "buildings-data-cache.bin";

type BuildingsDiskPayload = {
  version: number;
  signature: string;
  data: BuiltBuildingsData;
};

let cachedPayload: BuildingsDiskPayload | undefined;

export const loadBuildingsDiskCache = async (
  userDataPath: string,
  signature: string,
): Promise<BuiltBuildingsData | undefined> => {
  if (cachedPayload?.signature === signature && cachedPayload.version === BUILDINGS_CACHE_VERSION) {
    return cachedPayload.data;
  }
  try {
    const compressed = await fs.promises.readFile(nodePath.join(userDataPath, BUILDINGS_CACHE_FILE));
    const json = await zstdDecompress(compressed);
    const payload = JSON.parse(json.toString("utf8")) as BuildingsDiskPayload;
    if (payload.version !== BUILDINGS_CACHE_VERSION || payload.signature !== signature) return undefined;
    cachedPayload = payload;
    return payload.data;
  } catch {
    return undefined;
  }
};

export const saveBuildingsDiskCache = async (
  userDataPath: string,
  signature: string,
  data: BuiltBuildingsData,
): Promise<void> => {
  const payload: BuildingsDiskPayload = { version: BUILDINGS_CACHE_VERSION, signature, data };
  try {
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(nodePath.join(userDataPath, BUILDINGS_CACHE_FILE), compressed);
    cachedPayload = payload;
  } catch (error) {
    console.error("Failed to save Buildings cache:", error);
  }
};

export const clearBuildingsMemoryCache = () => {
  cachedPayload = undefined;
};
