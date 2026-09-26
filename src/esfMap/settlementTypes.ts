import { resolveRegionSettlementTypes } from "../buildingsData/derive";
import type { BuiltBuildingsData } from "../buildingsData/types";
import type { EsfMapPayload, EsfMapSettlementTypeOption } from "./types";

const settlementTypeLabel = (localizedName: string, key: string) =>
  localizedName === key ? key : `${localizedName} — ${key}`;

/** Adds the settlement-type catalogue and per-region capabilities to an extracted map. */
export const addSettlementTypeDataToEsfMap = (map: EsfMapPayload, buildings: BuiltBuildingsData): EsfMapPayload => {
  const cultureBySubculture = new Map(buildings.subcultures.map((entry) => [entry.key, entry.culture]));
  const cultureByFaction = new Map(buildings.factions.map((entry) => [entry.key, entry.culture]));

  const settlementTypeNames = new Map(buildings.settlementTypes.map((option) => [option.key, option.localizedName]));
  for (const bindings of Object.values(buildings.settlementTypeBindings)) {
    for (const binding of bindings) {
      if (!settlementTypeNames.has(binding.settlementType)) {
        settlementTypeNames.set(binding.settlementType, binding.settlementType);
      }
    }
  }
  const settlementTypes: EsfMapSettlementTypeOption[] = [...settlementTypeNames.entries()]
    .map(([key, localizedName]) => ({ key, label: settlementTypeLabel(localizedName, key) }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const settlementTypesByRegion: Record<string, string[]> = {};
  for (const marker of map.markers) {
    const subculture = marker.subculture || undefined;
    const faction = marker.ownerFaction || undefined;
    const culture =
      (subculture ? cultureBySubculture.get(subculture) : undefined) ??
      (faction ? cultureByFaction.get(faction) : undefined);
    settlementTypesByRegion[marker.key] = resolveRegionSettlementTypes(buildings, {
      campaign: map.campaignKey,
      region: marker.key,
      culture,
      subculture,
      faction,
    });
  }

  return { ...map, settlementTypes, settlementTypesByRegion };
};
