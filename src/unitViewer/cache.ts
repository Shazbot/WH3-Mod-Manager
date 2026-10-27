import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuiltUnitViewerData } from "./data";
import type { UnitViewerPainterVariantContext, UnitViewerUnitModel } from "./types";

const UNIT_VIEWER_CACHE_VERSION = 32;
const UNIT_VIEWER_CACHE_FILE = "unit-viewer-data-cache.bin";

type FactionColour = NonNullable<UnitViewerPainterVariantContext["factionColours"]>[number];

type UnitViewerDiskUnit = Omit<UnitViewerUnitModel, "painterVariantContext"> & {
  painterVariantContext?: Omit<UnitViewerPainterVariantContext, "factionColours"> & {
    factionColours?: number[];
  };
};

type UnitViewerDiskPayload = {
  version: number;
  signature: string;
  data: {
    groups: BuiltUnitViewerData["groups"];
    unitGroups: BuiltUnitViewerData["unitGroups"];
    units: Array<[string, UnitViewerDiskUnit]>;
    factionColourPool: FactionColour[];
    constants: BuiltUnitViewerData["constants"];
    iconPathsByUnit: Array<[string, string[]]>;
    statIcons: Record<string, string>;
    lordOptions: BuiltUnitViewerData["lordOptions"];
    characterExperience: BuiltUnitViewerData["characterExperience"];
  };
};

let cachedPayload: UnitViewerDiskPayload | undefined;

const factionColourKey = (colour: FactionColour): string =>
  JSON.stringify([colour.faction, colour.subculture, colour.primary, colour.secondary, colour.tertiary]);

const serializeUnits = (
  units: BuiltUnitViewerData["units"],
  factionColourPool: FactionColour[],
): Array<[string, UnitViewerDiskUnit]> => {
  const factionColourIndex = new Map<string, number>();
  const getFactionColourIndex = (colour: FactionColour): number => {
    const key = factionColourKey(colour);
    const existingIndex = factionColourIndex.get(key);
    if (existingIndex !== undefined) return existingIndex;

    const index = factionColourPool.length;
    factionColourIndex.set(key, index);
    factionColourPool.push({
      faction: colour.faction,
      subculture: colour.subculture,
      primary: colour.primary,
      secondary: colour.secondary,
      tertiary: colour.tertiary,
    });
    return index;
  };

  return Array.from(units.entries(), ([key, unit]): [string, UnitViewerDiskUnit] => {
    const context = unit.painterVariantContext;
    if (!context) return [key, unit as UnitViewerDiskUnit];

    const { factionColours, ...contextWithoutFactionColours } = context;
    return [
      key,
      {
        ...unit,
        painterVariantContext: {
          ...contextWithoutFactionColours,
          ...(factionColours === undefined ? {} : { factionColours: factionColours.map(getFactionColourIndex) }),
        },
      },
    ];
  });
};

const deserializeUnit = (unit: UnitViewerDiskUnit, factionColourPool: FactionColour[]): UnitViewerUnitModel => {
  const { painterVariantContext: context, ...unitWithoutContext } = unit;
  if (!context) return unitWithoutContext;

  const { factionColours, ...contextWithoutFactionColours } = context;
  return {
    ...unitWithoutContext,
    painterVariantContext: {
      ...contextWithoutFactionColours,
      ...(factionColours === undefined
        ? {}
        : { factionColours: factionColours.map((index) => ({ ...factionColourPool[index] })) }),
    },
  };
};

const deserialize = (payload: UnitViewerDiskPayload): BuiltUnitViewerData => ({
  groups: payload.data.groups,
  unitGroups: payload.data.unitGroups,
  units: new Map<string, UnitViewerUnitModel>(
    payload.data.units.map(([key, unit]): [string, UnitViewerUnitModel] => [
      key,
      deserializeUnit(unit, payload.data.factionColourPool),
    ]),
  ),
  constants: payload.data.constants,
  iconPathsByUnit: new Map(payload.data.iconPathsByUnit),
  statIcons: payload.data.statIcons,
  lordOptions: payload.data.lordOptions || [],
  characterExperience: payload.data.characterExperience || { tiers: [], permittedSubtypes: [] },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFactionColour = (value: unknown): value is FactionColour =>
  isRecord(value) &&
  typeof value.faction === "string" &&
  typeof value.subculture === "string" &&
  typeof value.primary === "string" &&
  typeof value.secondary === "string" &&
  typeof value.tertiary === "string";

const hasValidFactionColourReferences = (payload: unknown, signature: string): payload is UnitViewerDiskPayload => {
  if (!isRecord(payload) || payload.version !== UNIT_VIEWER_CACHE_VERSION || payload.signature !== signature) {
    return false;
  }
  if (!isRecord(payload.data)) return false;

  const { factionColourPool, units } = payload.data;
  if (!Array.isArray(factionColourPool) || !factionColourPool.every(isFactionColour) || !Array.isArray(units)) {
    return false;
  }

  return units.every((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isRecord(entry[1])) {
      return false;
    }

    const unit = entry[1];
    if (!("painterVariantContext" in unit)) return true;
    const context = unit.painterVariantContext;
    if (!isRecord(context)) return false;
    if (!("factionColours" in context)) return true;

    return (
      Array.isArray(context.factionColours) &&
      context.factionColours.every((index) => Number.isInteger(index) && index >= 0 && index < factionColourPool.length)
    );
  });
};

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
    const payload: unknown = JSON.parse(json.toString("utf8"));
    if (!hasValidFactionColourReferences(payload, signature)) return undefined;
    const data = deserialize(payload);
    cachedPayload = payload;
    return data;
  } catch {
    return undefined;
  }
};

export const saveUnitViewerDiskCache = async (
  userDataPath: string,
  signature: string,
  data: BuiltUnitViewerData,
): Promise<void> => {
  const factionColourPool: FactionColour[] = [];
  const payload: UnitViewerDiskPayload = {
    version: UNIT_VIEWER_CACHE_VERSION,
    signature,
    data: {
      groups: data.groups,
      unitGroups: data.unitGroups,
      units: serializeUnits(data.units, factionColourPool),
      factionColourPool,
      constants: data.constants,
      iconPathsByUnit: Array.from(data.iconPathsByUnit.entries()),
      statIcons: data.statIcons,
      lordOptions: data.lordOptions,
      characterExperience: data.characterExperience,
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
