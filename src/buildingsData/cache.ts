import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuildingsTableRows, BuiltBuildingsData } from "./types";

/** Bump whenever the shape of `BuiltBuildingsData` or the extraction rules change. */
const BUILDINGS_CACHE_VERSION = 13;
const BUILDINGS_CACHE_FILE = "buildings-data-cache.bin";

type BuildingsDiskPayload = {
  version: number;
  signature: string;
  data: BuiltBuildingsData;
  tables: BuildingsTableRows;
  localizations: Record<string, string>;
};

export type BuildingsDiskData = Pick<BuildingsDiskPayload, "data" | "tables" | "localizations">;

let cachedPayload: BuildingsDiskPayload | undefined;

export const loadBuildingsDiskCache = async (
  userDataPath: string,
  signature: string,
): Promise<BuildingsDiskData | undefined> => {
  if (cachedPayload?.signature === signature && cachedPayload.version === BUILDINGS_CACHE_VERSION) {
    return cachedPayload;
  }
  const cacheFilePath = nodePath.join(userDataPath, BUILDINGS_CACHE_FILE);
  try {
    const compressed = await fs.promises.readFile(cacheFilePath);
    const json = await zstdDecompress(compressed);
    const payload = JSON.parse(json.toString("utf8")) as BuildingsDiskPayload;
    if (payload.version !== BUILDINGS_CACHE_VERSION) {
      console.log("Buildings disk cache miss: version mismatch", {
        cacheFilePath,
        cachedVersion: payload.version,
        expectedVersion: BUILDINGS_CACHE_VERSION,
      });
      return undefined;
    }
    if (payload.signature !== signature) {
      console.log("Buildings disk cache miss: signature mismatch", {
        cacheFilePath,
        cachedSignature: payload.signature,
        requestedSignature: signature,
      });
      return undefined;
    }
    cachedPayload = payload;
    return payload;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    console.log(
      errorCode === "ENOENT"
        ? "Buildings disk cache miss: cache file does not exist"
        : "Buildings disk cache miss: cache file could not be read or decoded",
      {
        cacheFilePath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return undefined;
  }
};

export const saveBuildingsDiskCache = async (
  userDataPath: string,
  signature: string,
  data: BuiltBuildingsData,
  tables: BuildingsTableRows,
  localizations: Record<string, string>,
): Promise<void> => {
  const payload: BuildingsDiskPayload = {
    version: BUILDINGS_CACHE_VERSION,
    signature,
    data,
    tables,
    localizations,
  };
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
