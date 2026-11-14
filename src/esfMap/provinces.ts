import type { BuiltBuildingsData } from "../buildingsData/types";
import { climateColour } from "./climates";
import { assignNeighbourAwareColours } from "./data";
import type { EsfMapPayload, EsfMapProvinceOption } from "./types";

const normalize = (value: string | undefined | null) => value?.trim().toLowerCase() ?? "";

const COORDINATE_SCALE = 1000;
const quantize = (value: number) => Math.round(value * COORDINATE_SCALE);

/**
 * Provinces that share a stretch of border. Area outlines are axis-aligned loops traced on the same
 * grid, so two areas touch when a horizontal or vertical edge of one overlaps an edge of the other
 * on the same line. Corner-only contact does not count.
 */
const buildProvinceAdjacency = (
  areas: EsfMapPayload["areas"],
  provinceIndexByRegion: Map<string, number>,
  provinceCount: number,
): Set<number>[] => {
  const adjacency = Array.from({ length: provinceCount }, () => new Set<number>());
  const edgesByLine = new Map<string, Array<[start: number, end: number, province: number]>>();
  for (const area of areas) {
    const province = area.regionKey ? provinceIndexByRegion.get(normalize(area.regionKey)) : undefined;
    if (province === undefined) continue;
    for (const loop of area.loops ?? []) {
      for (let index = 0; index + 1 < loop.length; index += 2) {
        const nextIndex = (index + 2) % loop.length;
        const x = quantize(loop[index]);
        const y = quantize(loop[index + 1]);
        const nextX = quantize(loop[nextIndex]);
        const nextY = quantize(loop[nextIndex + 1]);
        const [line, start, end] =
          y === nextY ? [`h${y}`, x, nextX] : x === nextX ? [`v${x}`, y, nextY] : [undefined, 0, 0];
        if (!line || start === end) continue;
        const edges = edgesByLine.get(line) ?? [];
        edges.push([Math.min(start, end), Math.max(start, end), province]);
        edgesByLine.set(line, edges);
      }
    }
  }

  for (const edges of edgesByLine.values()) {
    edges.sort((first, second) => first[0] - second[0]);
    let active: typeof edges = [];
    for (const edge of edges) {
      active = active.filter((other) => other[1] > edge[0]);
      for (const other of active) {
        if (other[2] === edge[2]) continue;
        adjacency[edge[2]].add(other[2]);
        adjacency[other[2]].add(edge[2]);
      }
      active.push(edge);
    }
  }
  return adjacency;
};

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
  const groupList = [...groups.values()];
  // Regions carry neighbour-aware colours, but two provinces can still meet with similar ones, so
  // the province graph is coloured again. The capital's colour stays the preference.
  const preferredColours = groupList.map((group) => {
    const area = (group.capital ? areaOf(group.capital) : undefined) ?? areaOf(group.regionKeys[0]);
    return area?.colour ?? climateColour(group.key, allKeys);
  });
  const provinceIndexByRegion = new Map<string, number>();
  groupList.forEach((group, index) => {
    for (const regionKey of group.regionKeys) provinceIndexByRegion.set(normalize(regionKey), index);
  });
  const colours = assignNeighbourAwareColours(
    buildProvinceAdjacency(map.areas ?? [], provinceIndexByRegion, groupList.length),
    (index) => preferredColours[index],
  );
  const provinces: EsfMapProvinceOption[] = groupList
    .map((group, index) => ({
      key: group.key,
      label: names.get(normalize(group.key))?.localizedName || group.key,
      colour: colours[index],
      regionKeys: group.regionKeys,
      capitalRegion: group.capital,
    }))
    .sort((first, second) => first.label.localeCompare(second.label) || first.key.localeCompare(second.key));

  return { ...map, provinces, provincesByRegion };
};
