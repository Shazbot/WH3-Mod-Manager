import type { BuiltBuildingsData } from "../buildingsData/types";
import type { EsfMapFaction, EsfMapPayload } from "./types";

/** Converts a factions-table flag folder into the standard campaign flag asset path. */
export const factionFlagPath = (flagsPath: string | undefined): string | undefined => {
  const folder = (flagsPath ?? "").trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (!folder) return undefined;
  return /\.png$/i.test(folder) ? folder : `${folder}\\mon_64.png`;
};

/**
 * Adds the factions represented by the ESF region owners and their flag asset paths.
 *
 * Landless factions from the faction table follow the owners. The map only ever colours the ones
 * that own something, but ownership editing needs a faction to be pickable before it holds land,
 * and an imported ownership file naming one has to resolve to a real name and flag.
 */
export const addFactionDataToEsfMap = (
  map: EsfMapPayload,
  buildings: BuiltBuildingsData,
  getFlagUrl?: (flagPath: string) => string | undefined,
): EsfMapPayload => {
  const factionsByKey = new Map(buildings.factions.map((faction) => [faction.key.toLowerCase(), faction]));
  const ownerKeyByLowerKey = new Map(
    map.markers
      .map((marker) => marker.ownerFaction?.trim())
      .filter((ownerFaction): ownerFaction is string => !!ownerFaction)
      .map((ownerFaction) => [ownerFaction.toLowerCase(), ownerFaction] as const),
  );
  const regionCounts = new Map<string, number>();
  for (const marker of map.markers) {
    const ownerFaction = marker.ownerFaction?.trim();
    if (!ownerFaction) continue;
    const key = ownerFaction.toLowerCase();
    regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
  }

  const byLabel = (first: EsfMapFaction, second: EsfMapFaction) =>
    first.label.localeCompare(second.label) || first.key.localeCompare(second.key);

  const buildFaction = (key: string, lowerKey: string, regionCount: number): EsfMapFaction => {
    const faction = factionsByKey.get(lowerKey);
    const flagPath = factionFlagPath(faction?.flagPath);
    const flagUrl = flagPath ? getFlagUrl?.(flagPath) : undefined;
    return {
      key,
      label: faction?.localizedName || key,
      ...(flagPath ? { flagPath } : {}),
      ...(flagUrl ? { flagUrl } : {}),
      ...(faction?.subculture ? { subculture: faction.subculture } : {}),
      ...(faction?.culture ? { culture: faction.culture } : {}),
      regionCount,
    };
  };

  const owners: EsfMapFaction[] = [...regionCounts.entries()]
    .map(([lowerKey, regionCount]) => {
      const key = factionsByKey.get(lowerKey)?.key ?? ownerKeyByLowerKey.get(lowerKey);
      return key ? buildFaction(key, lowerKey, regionCount) : undefined;
    })
    .filter((faction): faction is EsfMapFaction => !!faction)
    .sort(byLabel);

  // Quest and rebel factions never hold a region on the campaign map, so they would only pad the
  // brush list with entries that produce an unloadable startpos.
  const landless: EsfMapFaction[] = buildings.factions
    .filter((faction) => !faction.isQuestFaction && !faction.isRebel && !regionCounts.has(faction.key.toLowerCase()))
    .map((faction) => buildFaction(faction.key, faction.key.toLowerCase(), 0))
    .sort(byLabel);

  return { ...map, factions: [...owners, ...landless] };
};
