import type { BuiltBuildingsData } from "../buildingsData/types";
import { climateColour } from "./climates";
import type { EsfMapPayload, EsfMapProvinceOption } from "./types";

const normalize = (value: string | undefined | null) => value?.trim().toLowerCase() ?? "";

/** Adds provinces (region groups), their colours and the region-to-province join to an extracted map. */
export const addProvinceDataToEsfMap = (map: EsfMapPayload, buildings: BuiltBuildingsData): EsfMapPayload => {
  const junctions = new Map<string, { province: string; isCapital: boolean }>();
  for (const [region, junction] of Object.entries(buildings.regionProvinces ?? {})) {
    junctions.set(normalize(region), junction);
  }
  const names = new Map((buildings.provinces ?? []).map((province) => [normalize(province.key), province] as const));
  const areaByRegion = new Map<string, EsfMapPayload["areas"][number]>();
  const areaById = new Map<number, EsfMapPayload["areas"][number]>();
  for (const area of map.areas ?? []) {
    if (area.regionKey) areaByRegion.set(normalize(area.regionKey), area);
    areaById.set(area.areaId, area);
  }

  const provincesByRegion: Record<string, string | null> = {};
  const groups = new Map<string, { key: string; regionKeys: string[]; capital: string | null }>();
  for (const marker of map.markers) {
    const junction = junctions.get(normalize(marker.key));
    if (!junction) {
      provincesByRegion[marker.key] = null;
      continue;
    }
    const canonicalKey = names.get(normalize(junction.province))?.key ?? junction.province;
    provincesByRegion[marker.key] = canonicalKey;
    const group = groups.get(normalize(canonicalKey)) ?? { key: canonicalKey, regionKeys: [], capital: null };
    group.regionKeys.push(marker.key);
    if (junction.isCapital && !group.capital) group.capital = marker.key;
    groups.set(normalize(canonicalKey), group);
  }

  const allKeys = [...groups.values()].map((group) => group.key);
  const markerByKey = new Map(map.markers.map((marker) => [marker.key, marker] as const));
  const areaOf = (regionKey: string) => {
    const marker = markerByKey.get(regionKey);
    return areaByRegion.get(normalize(regionKey)) ?? (marker ? areaById.get(marker.areaId) : undefined);
  };
  const provinces: EsfMapProvinceOption[] = [...groups.values()]
    .map((group) => {
      const area = (group.capital ? areaOf(group.capital) : undefined) ?? areaOf(group.regionKeys[0]);
      return {
        key: group.key,
        label: names.get(normalize(group.key))?.localizedName || group.key,
        colour: area?.colour ?? climateColour(group.key, allKeys),
        regionKeys: group.regionKeys,
        capitalRegion: group.capital,
      };
    })
    .sort((first, second) => first.label.localeCompare(second.label) || first.key.localeCompare(second.key));

  return { ...map, provinces, provincesByRegion };
};
