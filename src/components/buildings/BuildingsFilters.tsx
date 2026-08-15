import React, { memo, useMemo } from "react";
import WindowedSelect from "react-windowed-select";
import selectStyle from "../../styles/selectStyle";
import type {
  BuildingsCatalog,
  BuildingsFactionOption,
  BuildingsOption,
  BuildingsRegionQuery,
} from "../../buildingsData/types";

export type BuildingsFiltersProps = {
  catalog: BuildingsCatalog;
  query: BuildingsRegionQuery;
  /** Populated by the derivation; empty means the region has no mutually exclusive primary chains. */
  settlementTypeOptions: BuildingsOption[];
  zoom: number;
  onQueryChange: (patch: Partial<BuildingsRegionQuery>) => void;
  onZoomChange: (zoom: number) => void;
};

type SelectOption = { value: string; label: string; tone?: "quest" | "rebel" };

const NONE: SelectOption = { value: "", label: "(none)" };

const optionLabel = (option: BuildingsOption) =>
  option.localizedName === option.key ? option.key : `${option.localizedName} — ${option.key}`;

const toOptions = (options: BuildingsOption[]): SelectOption[] =>
  options.map((option) => ({ value: option.key, label: optionLabel(option) }));

/**
 * Keeps exceptional factions easy to find without allowing quest/rebel entries to crowd the normal
 * choices. A military group is unique only when exactly one currently visible ordinary faction
 * names it; quest-battle and rebel factions do not affect that count.
 */
export const buildFactionOptions = (factions: BuildingsFactionOption[]): SelectOption[] => {
  const militaryGroupCounts = new Map<string, number>();
  for (const faction of factions) {
    if (faction.militaryGroup && !faction.isQuestFaction && !faction.isRebel) {
      militaryGroupCounts.set(faction.militaryGroup, (militaryGroupCounts.get(faction.militaryGroup) ?? 0) + 1);
    }
  }

  const rank = (faction: BuildingsFactionOption) => {
    if (faction.isQuestFaction) return 3;
    if (faction.isRebel) return 2;
    if (faction.militaryGroup && militaryGroupCounts.get(faction.militaryGroup) === 1) return 0;
    return 1;
  };

  return [...factions]
    .sort(
      (first, second) =>
        rank(first) - rank(second) ||
        first.localizedName.localeCompare(second.localizedName) ||
        first.key.localeCompare(second.key),
    )
    .map((faction) => ({
      value: faction.key,
      label: optionLabel(faction),
      tone: faction.isQuestFaction ? "quest" : faction.isRebel ? "rebel" : undefined,
    }));
};

const findOption = (options: SelectOption[], value: string | undefined) =>
  (value && options.find((option) => option.value === value)) || null;

const labelClass = "flex flex-col gap-1 text-xs text-gray-400";
const selectWidth = { minWidth: "13rem" };

/** Above this many options the menu is virtualised; regions and factions are well past it. */
const WINDOW_THRESHOLD = 60;

export const firstRegionForCampaign = (catalog: BuildingsCatalog, campaign: string) =>
  catalog.regions.find((region) => region.campaigns.includes(campaign))?.key ??
  catalog.regions.find((region) => region.campaigns.length === 0)?.key ??
  "";

const FilterSelect = ({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: SelectOption[];
  value: string | undefined;
  onSelect: (value: string) => void;
}) => (
  <label className={labelClass} style={selectWidth}>
    {label}
    <WindowedSelect
      windowThreshold={WINDOW_THRESHOLD}
      styles={selectStyle}
      options={options}
      value={findOption(options, value)}
      onChange={(option) => onSelect((option as SelectOption | null)?.value ?? "")}
      formatOptionLabel={(option) => (
        <span
          className={
            (option as SelectOption).tone === "quest"
              ? "text-yellow-300"
              : (option as SelectOption).tone === "rebel"
                ? "text-red-400"
                : undefined
          }
        >
          {(option as SelectOption).label}
        </span>
      )}
    />
  </label>
);

const BuildingsFilters = memo(
  ({ catalog, query, settlementTypeOptions, zoom, onQueryChange, onZoomChange }: BuildingsFiltersProps) => {
    const campaignOptions = useMemo(() => toOptions(catalog.campaigns), [catalog.campaigns]);

    // Only regions the selected campaign actually places slot templates in are pickable; a region
    // with no campaigns recorded stays listed rather than vanishing.
    const regionOptions = useMemo(
      () =>
        toOptions(
          catalog.regions.filter(
            (region) => region.campaigns.length === 0 || region.campaigns.includes(query.campaign),
          ),
        ),
      [catalog.regions, query.campaign],
    );

    const cultureOptions = useMemo(() => [NONE, ...toOptions(catalog.cultures)], [catalog.cultures]);

    const subcultureOptions = useMemo(
      () => [
        NONE,
        ...toOptions(catalog.subcultures.filter((entry) => !query.culture || entry.culture === query.culture)),
      ],
      [catalog.subcultures, query.culture],
    );

    const factionOptions = useMemo(
      () => [
        NONE,
        ...buildFactionOptions(
          catalog.factions.filter(
            (entry) =>
              (!query.subculture || entry.subculture === query.subculture) &&
              (!query.culture || entry.culture === query.culture),
          ),
        ),
      ],
      [catalog.factions, query.culture, query.subculture],
    );

    const settlementOptions = useMemo(() => toOptions(settlementTypeOptions), [settlementTypeOptions]);

    return (
      // Above the board: tiles carrying unit portraits are given a z-index so their overhang is not
      // clipped by the next tile, and without a stacking context of its own this bar - which comes
      // earlier in the DOM - loses to them and its open dropdown renders behind the buildings.
      <div className="relative z-30 flex flex-wrap items-end gap-3 border-b border-gray-700 px-4 py-3">
        <FilterSelect
          label="Campaign"
          options={campaignOptions}
          value={query.campaign}
          onSelect={(campaign) =>
            onQueryChange({
              campaign,
              region: firstRegionForCampaign(catalog, campaign),
              settlementType: undefined,
            })
          }
        />

        <FilterSelect
          label="Region"
          options={regionOptions}
          value={query.region}
          onSelect={(region) => onQueryChange({ region, settlementType: undefined })}
        />

        {settlementOptions.length > 0 && (
          <FilterSelect
            label="Settlement type"
            options={settlementOptions}
            value={query.settlementType}
            onSelect={(settlementType) => onQueryChange({ settlementType: settlementType || undefined })}
          />
        )}

        <FilterSelect
          label="Culture"
          options={cultureOptions}
          value={query.culture}
          onSelect={(culture) =>
            onQueryChange({ culture: culture || undefined, subculture: undefined, faction: undefined })
          }
        />

        <FilterSelect
          label="Subculture"
          options={subcultureOptions}
          value={query.subculture}
          onSelect={(subculture) => onQueryChange({ subculture: subculture || undefined, faction: undefined })}
        />

        <FilterSelect
          label="Faction"
          options={factionOptions}
          value={query.faction}
          onSelect={(faction) => onQueryChange({ faction: faction || undefined })}
        />

        <div className="flex flex-col gap-1 text-xs text-gray-400">
          <span>Zoom {Math.round(zoom * 100)}%</span>
          <input
            type="range"
            min={50}
            max={250}
            step={5}
            value={Math.round(zoom * 100)}
            onChange={(event) => onZoomChange(Number(event.target.value) / 100)}
            className="w-32"
          />
        </div>

        <div className="flex flex-col gap-1 text-xs text-gray-400">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={!!query.includeHiddenInUi}
              onChange={(event) => onQueryChange({ includeHiddenInUi: event.target.checked })}
            />
            Hidden buildings
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={!!query.includeHiddenSets}
              onChange={(event) => onQueryChange({ includeHiddenSets: event.target.checked })}
            />
            Hidden sets
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={!!query.includeLevelsWithoutVariant}
              onChange={(event) => onQueryChange({ includeLevelsWithoutVariant: event.target.checked })}
            />
            No culture variant
          </label>
          <label className="flex items-center gap-1" title="The level-0 razed state of settlement and port chains.">
            <input
              type="checkbox"
              checked={!!query.includeRuinLevels}
              onChange={(event) => onQueryChange({ includeRuinLevels: event.target.checked })}
            />
            Ruin states
          </label>
          <label
            className="flex items-center gap-1"
            title="Levels bound to no building set. The game has no band to draw them in, so it leaves them out."
          >
            <input
              type="checkbox"
              checked={!!query.includeUnbandedLevels}
              onChange={(event) => onQueryChange({ includeUnbandedLevels: event.target.checked })}
            />
            Unbanded levels
          </label>
          <label
            className="flex items-center gap-1"
            title="Chains whose levels name only cultures other than the selected one."
          >
            <input
              type="checkbox"
              checked={!!query.includeOtherCultureChains}
              onChange={(event) => onQueryChange({ includeOtherCultureChains: event.target.checked })}
            />
            Other cultures' chains
          </label>
        </div>
      </div>
    );
  },
);

export default BuildingsFilters;
