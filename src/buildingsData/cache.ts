import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuildingsTableRows, BuiltBuildingsData } from "./types";

/** Bump whenever the shape of `BuiltBuildingsData` or the extraction rules change. */
const BUILDINGS_CACHE_VERSION = 17;
const BUILDINGS_CACHE_FILE = "buildings-data-cache.bin";

export type BuildingsCacheSignatureInputs = {
  feature: number;
  game: string;
  schema: string | undefined;
  mods: string;
  identities: Array<readonly [string, number, number]>;
};

type BuildingsDiskPayload = {
  version: number;
  signature: string;
  /** Optional so cache files written before diagnostic inputs were added remain readable. */
  signatureInputs?: BuildingsCacheSignatureInputs;
  data: BuiltBuildingsData;
  tables: BuildingsTableRows;
  localizations: Record<string, string>;
};

export type BuildingsDiskData = Pick<BuildingsDiskPayload, "data" | "tables" | "localizations" | "signatureInputs">;

export const describeBuildingsCacheSignatureChanges = (
  previous: BuildingsCacheSignatureInputs | undefined,
  current: BuildingsCacheSignatureInputs,
): string[] => {
  if (!previous) return ["cached signature inputs were not recorded"];

  const changes: string[] = [];
  const featureChanged = previous.feature !== current.feature;
  if (featureChanged) changes.push(`feature version changed (${previous.feature} -> ${current.feature})`);
  if (previous.game !== current.game) changes.push(`game changed (${previous.game} -> ${current.game})`);
  if (previous.schema !== current.schema) changes.push("visuals schema changed");
  if (!featureChanged && previous.mods !== current.mods) changes.push("enabled mod list or load order changed");

  const previousByPath = new Map(previous.identities.map(([packPath, size, mtimeMs]) => [packPath, { size, mtimeMs }]));
  const currentByPath = new Map(current.identities.map(([packPath, size, mtimeMs]) => [packPath, { size, mtimeMs }]));
  const allPaths = new Set([...previousByPath.keys(), ...currentByPath.keys()]);
  for (const packPath of allPaths) {
    const previousIdentity = previousByPath.get(packPath);
    const currentIdentity = currentByPath.get(packPath);
    if (!previousIdentity) {
      changes.push(`pack identity added: ${packPath}`);
    } else if (!currentIdentity) {
      changes.push(`pack identity removed: ${packPath}`);
    } else if (previousIdentity.size !== currentIdentity.size || previousIdentity.mtimeMs !== currentIdentity.mtimeMs) {
      changes.push(`pack identity changed: ${packPath}`);
    }
  }

  const previousOrder = previous.identities.map(([packPath]) => packPath);
  const currentOrder = current.identities.map(([packPath]) => packPath);
  if (
    previousOrder.length === currentOrder.length &&
    JSON.stringify([...previousOrder].sort()) === JSON.stringify([...currentOrder].sort()) &&
    JSON.stringify(previousOrder) !== JSON.stringify(currentOrder)
  ) {
    changes.push("pack identity order changed");
  }

  return changes.length > 0 ? changes : ["signature inputs match; cache signature generation changed"];
};

let cachedPayload: BuildingsDiskPayload | undefined;

export const loadBuildingsDiskCache = async (
  userDataPath: string,
  signature: string,
  signatureInputs?: BuildingsCacheSignatureInputs,
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
        changedInputs: signatureInputs
          ? describeBuildingsCacheSignatureChanges(payload.signatureInputs, signatureInputs)
          : ["current signature inputs were not provided"],
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
  signatureInputs?: BuildingsCacheSignatureInputs,
): Promise<void> => {
  const payload: BuildingsDiskPayload = {
    version: BUILDINGS_CACHE_VERSION,
    signature,
    signatureInputs,
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
