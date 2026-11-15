import { resolveRegionSettlementSiteTypes } from "../buildingsData/derive";
import type { BuiltBuildingsData } from "../buildingsData/types";
import type { EsfMapPayload, EsfMapSettlementTypeOption } from "./types";

const settlementTypeLabel = (localizedName: string, key: string) =>
  localizedName === key ? key : `${localizedName} — ${key}`;

/**
 * Adds the settlement-type catalogue and the types each region's site can take.
 *
 * A region's current type comes from the start pos (`EsfMapMarker.settlementType`). Its site types
 * read only the chains its primary slot can hold: every special type in
 * settlement_type_to_building_chains also whitelists foreign, under-empire and special-building
 * chains from every culture, so reading all of a region's chains matched almost every region for
 * every type.
 */
export const addSettlementTypeDataToEsfMap = (map: EsfMapPayload, buildings: BuiltBuildingsData): EsfMapPayload => {
  const settlementTypeNames = new Map(buildings.settlementTypes.map((option) => [option.key, option.localizedName]));
  for (const bindings of Object.values(buildings.settlementTypeBindings)) {
    for (const binding of bindings) {
      if (!settlementTypeNames.has(binding.settlementType)) {
        settlementTypeNames.set(binding.settlementType, binding.settlementType);
      }
    }
  }
  for (const marker of map.markers) {
    if (marker.settlementType && !settlementTypeNames.has(marker.settlementType)) {
      settlementTypeNames.set(marker.settlementType, marker.settlementType);
    }
  }
  const settlementTypes: EsfMapSettlementTypeOption[] = [...settlementTypeNames.entries()]
    .map(([key, localizedName]) => ({ key, label: settlementTypeLabel(localizedName, key) }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const settlementSiteTypesByRegion: Record<string, string[]> = {};
  for (const marker of map.markers) {
    settlementSiteTypesByRegion[marker.key] = resolveRegionSettlementSiteTypes(buildings, map.campaignKey, marker.key);
  }

  return { ...map, settlementTypes, settlementSiteTypesByRegion };
};
