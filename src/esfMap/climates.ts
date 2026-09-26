import type { BuiltBuildingsData, StartPosSettlement } from "../buildingsData/types";
import type { EsfMapColour, EsfMapPayload, EsfMapClimateOption } from "./types";

const normalize = (value: string | undefined | null) => value?.trim().toLowerCase() ?? "";

const withoutSettlementPrefix = (value: string) => value.replace(/^settlement:/i, "");

const climateColourFromIndex = (index: number, count: number): EsfMapColour => {
  const hue = (index / count) * 360;
  const saturation = 0.72;
  const lightness = 0.5;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return [Math.round((red + match) * 255), Math.round((green + match) * 255), Math.round((blue + match) * 255)];
};

/**
 * Assigns evenly spaced, bright hues to a climate catalogue. Sorting the keys makes the result
 * deterministic while ensuring the eleven vanilla climates cannot collapse into near-identical hash
 * colours.
 */
export const climateColour = (key: string, climateKeys: readonly string[] = [key]): EsfMapColour => {
  const normalizedKey = normalize(key);
  if (!normalizedKey) return [128, 128, 128];
  const orderedKeys = [...new Set([key, ...climateKeys].map(normalize).filter(Boolean))].sort();
  return climateColourFromIndex(Math.max(0, orderedKeys.indexOf(normalizedKey)), orderedKeys.length);
};

const climateMap = (buildings: BuiltBuildingsData) => {
  const result = new Map<string, string>();
  for (const [settlementId, climate] of Object.entries(buildings.campaignMapSettlementClimates ?? {})) {
    const normalizedId = normalize(settlementId);
    const normalizedClimate = climate.trim();
    if (!normalizedId || !normalizedClimate) continue;
    result.set(normalizedId, normalizedClimate);
    result.set(withoutSettlementPrefix(normalizedId), normalizedClimate);
  }
  return result;
};

const startPosSettlementsByRegion = (buildings: BuiltBuildingsData) => {
  const result = new Map<string, StartPosSettlement[]>();
  for (const [key, settlements] of Object.entries(buildings.startPosSettlements ?? {})) {
    result.set(normalize(key), settlements);
  }
  return result;
};

const climateForSettlement = (settlementClimates: Map<string, string>, settlementId: string | undefined | null) => {
  const normalizedId = normalize(settlementId);
  if (!normalizedId) return undefined;
  return settlementClimates.get(normalizedId) ?? settlementClimates.get(withoutSettlementPrefix(normalizedId));
};

const climateForRegion = (
  map: EsfMapPayload,
  marker: EsfMapPayload["markers"][number],
  settlementClimates: Map<string, string>,
  settlementsByRegion: Map<string, StartPosSettlement[]>,
) => {
  const regionSettlements = settlementsByRegion.get(normalize(`${map.campaignKey}|${marker.key}`)) ?? [];
  for (const settlement of regionSettlements) {
    const climate = climateForSettlement(settlementClimates, settlement.settlementId);
    if (climate) return climate;
  }

  for (const candidate of [marker.settlementKey, marker.key]) {
    const climate = climateForSettlement(settlementClimates, candidate);
    if (climate) return climate;
  }
  return null;
};

/** Adds climate names, colours, counts, and region associations to an extracted map. */
export const addClimateDataToEsfMap = (map: EsfMapPayload, buildings: BuiltBuildingsData): EsfMapPayload => {
  const settlementClimates = climateMap(buildings);
  const settlementsByRegion = startPosSettlementsByRegion(buildings);
  const climateNames = new Map((buildings.climates ?? []).map((climate) => [normalize(climate.key), climate] as const));
  const climateKeyByLowerKey = new Map<string, string>();
  for (const climate of buildings.climates ?? []) climateKeyByLowerKey.set(normalize(climate.key), climate.key);
  for (const climate of settlementClimates.values()) {
    const key = normalize(climate);
    if (!climateKeyByLowerKey.has(key)) climateKeyByLowerKey.set(key, climate);
  }

  const climatesByRegion: Record<string, string | null> = {};
  const regionCounts = new Map<string, number>();
  for (const marker of map.markers) {
    const rawClimate = climateForRegion(map, marker, settlementClimates, settlementsByRegion);
    const climate = rawClimate ? (climateKeyByLowerKey.get(normalize(rawClimate)) ?? rawClimate) : null;
    climatesByRegion[marker.key] = climate;
    if (climate) regionCounts.set(normalize(climate), (regionCounts.get(normalize(climate)) ?? 0) + 1);
  }

  const climateKeys = [...climateKeyByLowerKey.values()];
  const climates: EsfMapClimateOption[] = climateKeys
    .map((key) => {
      const climate = climateNames.get(normalize(key));
      return {
        key,
        label: climate?.localizedName || key,
        colour: climateColour(key, climateKeys),
        regionCount: regionCounts.get(normalize(key)) ?? 0,
      };
    })
    .sort((first, second) => first.label.localeCompare(second.label) || first.key.localeCompare(second.key));

  return { ...map, climates, climatesByRegion };
};
