import React, { memo, useMemo } from "react";
import { useLocalizations } from "../../localizationContext";
import type { BuildingUnitRow, BuildingsTile } from "../../buildingsData/types";

const tooltipFrame = require("../../assets/skills/tooltip_frame.png");

export type BuildingTooltipProps = {
  tile: BuildingsTile;
};

const UnitList = ({ heading, units }: { heading: string; units: BuildingUnitRow[] }) => (
  <div className="space-y-1 border-t border-red-900/40 pt-1.5">
    <div className="text-xs font-semibold">{heading}</div>
    {units.map((unit) => (
      <div key={`${unit.unitGroup ?? ""}:${unit.unitKey}`} className="flex items-center gap-2 text-xs">
        {unit.cardUrl ? (
          <img className="h-6 w-5 shrink-0 rounded-[1px] object-cover" src={unit.cardUrl} alt="" />
        ) : (
          <span className="h-6 w-5 shrink-0 rounded-[1px] border border-amber-900/60 bg-amber-700/40" />
        )}
        <span>{unit.localizedName}</span>
      </div>
    ))}
  </div>
);

/**
 * The building tooltip, in the order the game's own one uses: title, descriptions, cost, effects,
 * garrison, then recruitment.
 *
 * Shares the skills/tech tooltip's frame and typeface so the three read as one family - see
 * `src/components/techTrees/TechNode.tsx`.
 */
const BuildingTooltip = memo(({ tile }: BuildingTooltipProps) => {
  const localized = useLocalizations();
  const costs = useMemo(
    () =>
      [
        { label: localized.buildingsTurns || "Turns", value: tile.createTime },
        { label: localized.buildingsCost || "Cost", value: tile.createCost },
        { label: localized.buildingsUpkeep || "Upkeep", value: tile.upkeepCost },
        { label: localized.buildingsFood || "Food", value: tile.foodCost },
        { label: localized.buildingsGrowth || "Growth", value: tile.developmentPointCost },
      ].filter((entry) => entry.value !== 0),
    [localized, tile],
  );

  return (
    <div
      style={{ backgroundImage: `url('${tooltipFrame}')`, fontFamily: '"Libre Baskerville", serif' }}
      className="skillTooltip max-h-[80vh] w-[330px] space-y-1.5 overflow-y-auto text-sm text-gray-100"
    >
      <div className="text-center text-base font-bold">{tile.title}</div>

      {tile.isRuin && (
        <div className="text-center text-[0.7rem] italic text-red-300">
          {localized.buildingsRuinedState || "Ruined state"}
        </div>
      )}

      {tile.shortDescription && (
        <div className="border-t border-red-900/40 pt-1.5 text-xs">{tile.shortDescription}</div>
      )}
      {tile.longDescription && (
        <div className="border-t border-red-900/40 pt-1.5 text-xs italic">&ldquo;{tile.longDescription}&rdquo;</div>
      )}

      {costs.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-red-900/40 pt-1.5 text-xs text-amber-300">
          {costs.map((entry) => (
            <span key={entry.label}>
              {entry.label}: {entry.value}
            </span>
          ))}
        </div>
      )}

      {tile.effects.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-red-900/40 pt-1.5">
          {tile.effects.map((effect) => (
            <div key={`${effect.effectKey}:${effect.scope}`} className="flex items-center gap-2 text-xs">
              {effect.iconUrl ? (
                <img className="h-6 w-6 shrink-0 object-contain" src={effect.iconUrl} alt="" />
              ) : (
                <span className="h-6 w-6 shrink-0" />
              )}
              <span>{effect.localizedKey}</span>
            </div>
          ))}
        </div>
      )}

      {tile.garrison.length > 0 && (
        <UnitList heading={localized.buildingsProvidesGarrison || "Provides garrison:"} units={tile.garrison} />
      )}
      {tile.recruitable.length > 0 && (
        <UnitList
          heading={localized.buildingsUnlocksRecruitment || "Unlocks recruitment of:"}
          units={tile.recruitable}
        />
      )}

      <div className="space-y-0.5 border-t border-red-900/40 pt-1.5 text-[0.65rem] opacity-60">
        <div>{tile.levelKey}</div>
        <div>{(localized.buildingsChainInfo || "chain: {{key}}").replace("{{key}}", tile.chainKey)}</div>
        {tile.instanceLimit != undefined && tile.instanceLimit > 0 && (
          <div>
            {(localized.buildingsMaxPerRegion || "Max {{count}} per region").replace(
              "{{count}}",
              `${tile.instanceLimit}`,
            )}
          </div>
        )}
        {tile.onlyInCapital && (
          <div>{localized.buildingsOnlyProvincialCapital || "Only in the provincial capital"}</div>
        )}
        {tile.factionUnique && <div>{localized.buildingsFactionUnique || "Faction unique"}</div>}
        {tile.variant && (tile.variant.culture || tile.variant.subculture || tile.variant.faction) && (
          <div>
            {(localized.buildingsVariantInfo || "variant: {{values}}").replace(
              "{{values}}",
              [tile.variant.culture, tile.variant.subculture, tile.variant.faction].filter(Boolean).join(" / "),
            )}
          </div>
        )}
        {tile.variantCount > 1 && (
          <div>
            {(localized.buildingsCultureVariantsCount || "{{count}} culture variants").replace(
              "{{count}}",
              `${tile.variantCount}`,
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default BuildingTooltip;
