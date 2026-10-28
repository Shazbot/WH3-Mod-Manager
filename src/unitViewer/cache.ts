import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import type { BuiltUnitViewerData } from "./data";
import type { UnitViewerAbility, UnitViewerPainterVariantContext, UnitViewerUnitModel } from "./types";
import { cloneCachedUnitViewerAbility, isCachedUnitViewerAbility } from "./cacheAbilities";

const UNIT_VIEWER_CACHE_VERSION = 33;
const UNIT_VIEWER_CACHE_FILE = "unit-viewer-data-cache.bin";

type FactionColour = NonNullable<UnitViewerPainterVariantContext["factionColours"]>[number];

type UnitViewerDiskUnit = Omit<UnitViewerUnitModel, "painterVariantContext" | "abilities"> & {
  abilities: number[];
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
    abilityPool: UnitViewerAbility[];
    constants: BuiltUnitViewerData["constants"];
    iconPathsByUnit: Array<[string, string[]]>;
    statIcons: Record<string, string>;
    lordOptions: BuiltUnitViewerData["lordOptions"];
    characterExperience: BuiltUnitViewerData["characterExperience"];
  };
};

let cachedPayload: UnitViewerDiskPayload | undefined;

const serializeUnits = (
  units: BuiltUnitViewerData["units"],
  factionColourPool: FactionColour[],
  abilityPool: UnitViewerAbility[],
): Array<[string, UnitViewerDiskUnit]> => {
  const abilityIndex = new Map<string, number>();
  const getAbilityIndex = (ability: UnitViewerAbility): number => {
    const key = JSON.stringify(ability);
    const existing = abilityIndex.get(key);
    if (existing !== undefined) return existing;
    if (!isCachedUnitViewerAbility(ability)) throw new Error("Unsupported Unit Viewer ability cache data");
    const index = abilityPool.length;
    abilityPool.push(cloneCachedUnitViewerAbility(ability));
    abilityIndex.set(key, index);
    return index;
  };
  const factionColourIndexesByFaction = new Map<string, number[]>();
  const getFactionColourIndex = (colour: FactionColour): number => {
    const factionIndexes = factionColourIndexesByFaction.get(colour.faction);
    if (factionIndexes) {
      for (const index of factionIndexes) {
        const pooledColour = factionColourPool[index];
        if (
          pooledColour.subculture === colour.subculture &&
          pooledColour.primary === colour.primary &&
          pooledColour.secondary === colour.secondary &&
          pooledColour.tertiary === colour.tertiary
        ) {
          return index;
        }
      }
    }

    const index = factionColourPool.length;
    factionColourPool.push({
      faction: colour.faction,
      subculture: colour.subculture,
      primary: colour.primary,
      secondary: colour.secondary,
      tertiary: colour.tertiary,
    });
    if (factionIndexes) factionIndexes.push(index);
    else factionColourIndexesByFaction.set(colour.faction, [index]);
    return index;
  };

  return Array.from(units.entries(), ([key, unit]): [string, UnitViewerDiskUnit] => {
    const abilities = Array.from(unit.abilities, getAbilityIndex);
    const context = unit.painterVariantContext;
    if (!context) return [key, Object.assign({}, unit, { abilities, painterVariantContext: undefined })];

    const { factionColours, ...contextWithoutFactionColours } = context;
    return [
      key,
      {
        ...unit,
        abilities,
        painterVariantContext: {
          ...contextWithoutFactionColours,
          ...(factionColours === undefined ? {} : { factionColours: factionColours.map(getFactionColourIndex) }),
        },
      },
    ];
  });
};

const deserializeUnit = (
  unit: UnitViewerDiskUnit,
  factionColourPool: FactionColour[],
  abilityPool: UnitViewerAbility[],
): UnitViewerUnitModel => {
  const { painterVariantContext: context, abilities: indexes, ...rest } = unit;
  const unitWithoutContext = Object.assign({}, rest, {
    abilities: indexes.map((index) => cloneCachedUnitViewerAbility(abilityPool[index])),
  });
  if (!context) return unitWithoutContext;

  const { factionColours, ...contextWithoutFactionColours } = context;
  return {
    ...unitWithoutContext,
    painterVariantContext: {
      ...contextWithoutFactionColours,
      ...(factionColours === undefined
        ? {}
        : {
            factionColours: factionColours.map((index) => {
              const colour = factionColourPool[index];
              return {
                faction: colour.faction,
                subculture: colour.subculture,
                primary: colour.primary,
                secondary: colour.secondary,
                tertiary: colour.tertiary,
              };
            }),
          }),
    },
  };
};

const deserialize = (payload: UnitViewerDiskPayload): BuiltUnitViewerData => ({
  groups: payload.data.groups,
  unitGroups: payload.data.unitGroups,
  units: new Map<string, UnitViewerUnitModel>(
    payload.data.units.map(([key, unit]): [string, UnitViewerUnitModel] => [
      key,
      deserializeUnit(unit, payload.data.factionColourPool, payload.data.abilityPool),
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

const hasValidPoolReferences = (payload: unknown, signature: string): payload is UnitViewerDiskPayload => {
  if (!isRecord(payload) || payload.version !== UNIT_VIEWER_CACHE_VERSION || payload.signature !== signature) {
    return false;
  }
  if (!isRecord(payload.data)) return false;

  const { factionColourPool, abilityPool, units } = payload.data;
  if (
    !Array.isArray(factionColourPool) ||
    !factionColourPool.every(isFactionColour) ||
    !Array.isArray(abilityPool) ||
    !abilityPool.every(isCachedUnitViewerAbility) ||
    !Array.isArray(units)
  ) {
    return false;
  }

  return units.every((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isRecord(entry[1])) {
      return false;
    }

    const unit = entry[1];
    if (
      !Array.isArray(unit.abilities) ||
      !unit.abilities.every((index) => Number.isInteger(index) && index >= 0 && index < abilityPool.length)
    )
      return false;
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
    if (!hasValidPoolReferences(payload, signature)) return undefined;
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
  try {
    const factionColourPool: FactionColour[] = [];
    const abilityPool: UnitViewerAbility[] = [];
    const payload: UnitViewerDiskPayload = {
      version: UNIT_VIEWER_CACHE_VERSION,
      signature,
      data: {
        groups: data.groups,
        unitGroups: data.unitGroups,
        units: serializeUnits(data.units, factionColourPool, abilityPool),
        factionColourPool,
        abilityPool,
        constants: data.constants,
        iconPathsByUnit: Array.from(data.iconPathsByUnit.entries()),
        statIcons: data.statIcons,
        lordOptions: data.lordOptions,
        characterExperience: data.characterExperience,
      },
    };
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
