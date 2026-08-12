import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuiltUnitViewerData } from "./data";

const UNIT_VIEWER_CACHE_VERSION = 12;
const UNIT_VIEWER_CACHE_FILE = "unit-viewer-data-cache.bin";

type UnitViewerDiskPayload = {
  version: number;
  signature: string;
  data: {
    groups: BuiltUnitViewerData["groups"];
    unitGroups: BuiltUnitViewerData["unitGroups"];
    units: Array<[string, BuiltUnitViewerData["units"] extends Map<string, infer T> ? T : never]>;
    constants: BuiltUnitViewerData["constants"];
    iconPathsByUnit: Array<[string, string[]]>;
    statIcons: Record<string, string>;
  };
};

let cachedPayload: UnitViewerDiskPayload | undefined;

const deserialize = (payload: UnitViewerDiskPayload): BuiltUnitViewerData => ({
  groups: payload.data.groups,
  unitGroups: payload.data.unitGroups,
  units: new Map(payload.data.units),
  constants: payload.data.constants,
  iconPathsByUnit: new Map(payload.data.iconPathsByUnit),
  statIcons: payload.data.statIcons,
});

export const loadUnitViewerDiskCache = async (
  userDataPath: string,
  signature: string,
): Promise<BuiltUnitViewerData | undefined> => {
  if (cachedPayload?.signature === signature && cachedPayload.version === UNIT_VIEWER_CACHE_VERSION) {
    return deserialize(cachedPayload);
  }
  try {
    const compressed = await fs.promises.readFile(nodePath.join(userDataPath, UNIT_VIEWER_CACHE_FILE));
    const json = await zstdDecompress(compressed);
    const payload = JSON.parse(json.toString("utf8")) as UnitViewerDiskPayload;
    if (payload.version !== UNIT_VIEWER_CACHE_VERSION || payload.signature !== signature) return undefined;
    cachedPayload = payload;
    return deserialize(payload);
  } catch {
    return undefined;
  }
};

export const saveUnitViewerDiskCache = async (
  userDataPath: string,
  signature: string,
  data: BuiltUnitViewerData,
): Promise<void> => {
  const payload: UnitViewerDiskPayload = {
    version: UNIT_VIEWER_CACHE_VERSION,
    signature,
    data: {
      groups: data.groups,
      unitGroups: data.unitGroups,
      units: Array.from(data.units.entries()),
      constants: data.constants,
      iconPathsByUnit: Array.from(data.iconPathsByUnit.entries()),
      statIcons: data.statIcons,
    },
  };
  try {
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(nodePath.join(userDataPath, UNIT_VIEWER_CACHE_FILE), compressed);
    cachedPayload = payload;
  } catch (error) {
    console.error("Failed to save Unit Viewer cache:", error);
  }
};

export const clearUnitViewerMemoryCache = () => {
  cachedPayload = undefined;
};
