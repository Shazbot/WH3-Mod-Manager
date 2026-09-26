import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import WindowedSelect from "react-windowed-select";
import { FaMapMarkedAlt } from "react-icons/fa";
import { useLocalizations } from "../../localizationContext";
import selectStyle from "../../styles/selectStyle";
import type {
  BuildingsBoardMode,
  BuildingsCatalog,
  BuildingsFactionOption,
  BuildingsForeignSlotTypeOption,
  BuildingsOption,
  BuildingsRegionQuery,
} from "../../buildingsData/types";
import { boardModeOf } from "../../buildingsData/derive";

export type BuildingsFiltersProps = {
  catalog: BuildingsCatalog;
  query: BuildingsRegionQuery;
  /** Cultures the current board draws nothing for. Populated on the horde board only. */
  culturesWithoutChains: string[];
  /** Populated by the derivation; empty means the region has no mutually exclusive primary chains. */
  settlementTypeOptions: BuildingsOption[];
  settlementTypeDisabled: boolean;
  zoom: number;
  onQueryChange: (patch: Partial<BuildingsRegionQuery>) => void;
  onZoomChange: (zoom: number) => void;
  onOpenMap: (campaign: string, region: string) => void;
};

/**
 * `label` stays the `Name — key` pair so the built-in filter still matches either half; `name` is
 * what the menu draws on its own line, and `value` doubles as the key line under it.
 */
type SelectOption = { value: string; label: string; name?: string; tone?: "quest" | "rebel" | "empty" };

const optionLabel = (option: BuildingsOption) =>
  option.localizedName === option.key ? option.key : `${option.localizedName} — ${option.key}`;

const isUnlocalized = (option: BuildingsOption) => option.localizedName === option.key;

const compareLocalizedOptions = (first: BuildingsOption, second: BuildingsOption) => {
  const unlocalizedDifference = Number(isUnlocalized(first)) - Number(isUnlocalized(second));
  return (
    unlocalizedDifference ||
    first.localizedName.localeCompare(second.localizedName) ||
    first.key.localeCompare(second.key)
  );
};

export const sortLocalizedOptions = <T extends BuildingsOption>(options: T[]): T[] =>
  [...options].sort(compareLocalizedOptions);

const toOptions = (options: BuildingsOption[], putUnlocalizedLast = false): SelectOption[] =>
  (putUnlocalizedLast ? sortLocalizedOptions(options) : options).map((option) => ({
    value: option.key,
    label: optionLabel(option),
    name: option.localizedName,
  }));

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
    .sort((first, second) => {
      const unlocalizedDifference = Number(isUnlocalized(first)) - Number(isUnlocalized(second));
      if (unlocalizedDifference) return unlocalizedDifference;
      if (isUnlocalized(first)) return first.key.localeCompare(second.key);
      return (
        rank(first) - rank(second) ||
        first.localizedName.localeCompare(second.localizedName) ||
        first.key.localeCompare(second.key)
      );
    })
    .map((faction) => ({
      value: faction.key,
      label: optionLabel(faction),
      name: faction.localizedName,
      tone: faction.isQuestFaction ? "quest" : faction.isRebel ? "rebel" : undefined,
    }));
};

/**
 * Cultures the board draws nothing for are sorted below the ones it does and marked.
 *
 * They stay selectable rather than being dropped: a modder may be about to write the first chain for
 * one, and a culture silently missing from the list is harder to explain than one that is present
 * and visibly empty. Within each group the usual localised ordering applies.
 */
export const buildCultureOptions = (cultures: BuildingsOption[], withoutChains: ReadonlySet<string>): SelectOption[] =>
  [...cultures]
    .sort(
      (first, second) =>
        Number(withoutChains.has(first.key)) - Number(withoutChains.has(second.key)) ||
        compareLocalizedOptions(first, second),
    )
    .map((culture) => ({
      value: culture.key,
      label: optionLabel(culture),
      name: culture.localizedName,
      tone: withoutChains.has(culture.key) ? ("empty" as const) : undefined,
    }));

const findOption = (options: SelectOption[], value: string | undefined) =>
  (value && options.find((option) => option.value === value)) || null;

const labelClass = "flex flex-col gap-1 text-sm text-gray-300";
const selectWidth = { minWidth: "15rem" };
/** The mode picker has three short options and does not need the shared width. */
const modeSelectWidth = { minWidth: "9rem" };

/**
 * The filter bar sits above a dense board, so its own text was left small enough to be hard to
 * read. These bump the control and its menu to the body size. Menu rows carry the localized name
 * over the key on two lines instead of wrapping one long `Name — key` string, and the height that
 * costs has to be stated here because react-windowed-select measures virtualised rows by it.
 */
const CONTROL_HEIGHT = 38;
const OPTION_HEIGHT = 50;
const filterSelectStyle = {
  ...selectStyle,
  control: (base: any, state: any) => ({
    ...selectStyle.control(base, state),
    fontSize: "0.875rem",
    minHeight: CONTROL_HEIGHT,
  }),
  menu: (base: any) => ({ ...selectStyle.menu(base), fontSize: "0.875rem" }),
  option: (base: any, state: any) => ({
    ...selectStyle.option(base, state),
    height: OPTION_HEIGHT,
    padding: "6px 12px",
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
  }),
};

/** Above this many options the menu is virtualised; regions and factions are well past it. */
const WINDOW_THRESHOLD = 60;

/** Default cultures for foreign slot types whose game content has one intended owner. */
export const FOREIGN_SLOT_TYPE_CULTURES: Readonly<Record<string, string>> = {
  PIRATE_COVE: "wh2_dlc11_cst_vampire_coast",
  SILENT_SANCTUM: "wh2_main_lzd_lizardmen",
  TYRANTS_DEMANDS: "wh3_main_ogr_ogre_kingdoms",
  UNDERDEEP: "wh_main_dwf_dwarfs",
  UNDEREMPIRE: "wh2_main_skv_skaven",
  BLACK_TOWER: "wh_main_emp_empire",
};

/**
 * The query change that switching foreign slot type implies.
 *
 * A type's dropdowns only offer the culture, subculture and faction its own buildings name, so a
 * selection the new type never mentions has to go rather than silently filter the board down to
 * nothing. Clearing the culture clears what hangs off it, the same way the culture dropdown does.
 */
export const foreignSlotTypeQueryPatch = (
  option: BuildingsForeignSlotTypeOption | undefined,
  query: BuildingsRegionQuery,
): Partial<BuildingsRegionQuery> => {
  const keep = (value: string | undefined, allowed: string[]) =>
    value && (!option || allowed.includes(value)) ? value : undefined;
  const mappedCulture = option ? FOREIGN_SLOT_TYPE_CULTURES[option.key] : undefined;
  const culture = mappedCulture ?? keep(query.culture, option?.cultures ?? []);
  const cultureChanged = culture !== query.culture;
  return {
    foreignSlotType: option?.key,
    settlementType: undefined,
    culture,
    subculture: culture && !cultureChanged ? keep(query.subculture, option?.subcultures ?? []) : undefined,
    faction: culture && !cultureChanged ? keep(query.faction, option?.factions ?? []) : undefined,
  };
};

export const firstRegionForCampaign = (catalog: BuildingsCatalog, campaign: string) =>
  catalog.regions.find((region) => region.campaigns.includes(campaign))?.key ??
  catalog.regions.find((region) => region.campaigns.length === 0)?.key ??
  "";

/** The undercity type to land on when the mode is switched, when the install has it. */
const DEFAULT_UNDERCITY_SLOT_TYPE = "UNDEREMPIRE";

/**
 * The query change that switching board mode implies.
 *
 * Each mode owns a different set of filters, so the ones the new mode does not draw have to be
 * cleared rather than left applying invisibly. Undercity additionally needs a type to browse - the
 * mode itself is the "browse foreign slots" state now, so an unset type would only mean an empty
 * board - and reuses `foreignSlotTypeQueryPatch` so the culture narrowing is identical to picking
 * the type by hand.
 */
export const boardModeQueryPatch = (
  mode: BuildingsBoardMode,
  query: BuildingsRegionQuery,
  catalog: BuildingsCatalog,
): Partial<BuildingsRegionQuery> => {
  if (mode === "undercity") {
    const types = catalog.foreignSlotTypes;
    const selected =
      types.find((entry) => entry.key === query.foreignSlotType) ??
      types.find((entry) => entry.key === DEFAULT_UNDERCITY_SLOT_TYPE) ??
      types[0];
    return { ...foreignSlotTypeQueryPatch(selected, query), mode };
  }
  return {
    mode,
    foreignSlotType: undefined,
    settlementType: undefined,
    // Leaving undercity or horde with no region left to return to would show an empty board with
    // no way to tell why.
    ...(mode === "normal" && !query.region ? { region: firstRegionForCampaign(catalog, query.campaign) } : {}),
  };
};

const FilterSelect = ({
  label,
  options,
  value,
  onSelect,
  disabled = false,
  width = selectWidth,
}: {
  label: string;
  options: SelectOption[];
  value: string | undefined;
  onSelect: (value: string) => void;
  disabled?: boolean;
  width?: React.CSSProperties;
}) => (
  <label className={`${labelClass}${disabled ? " cursor-not-allowed opacity-60" : ""}`} style={width}>
    {label}
    <WindowedSelect
      // The visible label is the wrapping `<label>`'s own text, which a screen reader reads together
      // with everything react-select renders inside it. Naming the control directly keeps it short.
      aria-label={label}
      windowThreshold={WINDOW_THRESHOLD}
      styles={filterSelectStyle}
      options={options}
      value={findOption(options, value)}
      isDisabled={disabled}
      onChange={(option) => onSelect((option as SelectOption | null)?.value ?? "")}
      formatOptionLabel={(option, meta) => {
        const entry = option as SelectOption;
        const toneClass =
          entry.tone === "quest" || entry.tone === "empty"
            ? "text-yellow-300"
            : entry.tone === "rebel"
              ? "text-red-400"
              : "text-slate-100";
        // The closed control has one line to work with, and an option whose key is its own name
        // would only repeat itself on a second line.
        if (meta.context === "value" || !entry.name || entry.name === entry.value) {
          return (
            <span className={`${meta.context === "menu" ? "w-full min-w-0 truncate " : ""}${toneClass}`}>
              {entry.label}
            </span>
          );
        }
        return (
          <span className="flex w-full min-w-0 flex-col leading-tight">
            <span className={`truncate ${toneClass}`}>{entry.name}</span>
            <span className="truncate text-[0.8125rem] text-gray-300">{entry.value}</span>
          </span>
        );
      }}
    />
  </label>
);

const BuildingsFilters = memo(
  ({
    catalog,
    query,
    culturesWithoutChains,
    settlementTypeOptions,
    settlementTypeDisabled,
    zoom,
    onQueryChange,
    onZoomChange,
    onOpenMap,
  }: BuildingsFiltersProps) => {
    const localized = useLocalizations();
    const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
    const optionsMenuRef = useRef<HTMLDivElement | null>(null);
    const noneOption = useMemo<SelectOption>(
      () => ({ value: "", label: localized.buildingsNone || "(none)" }),
      [localized.buildingsNone],
    );
    const campaignOptions = useMemo(() => toOptions(catalog.campaigns), [catalog.campaigns]);

    const mode = boardModeOf(query);
    const modeOptions = useMemo<SelectOption[]>(
      () => [
        { value: "normal", label: localized.buildingsModeNormal || "Normal" },
        { value: "undercity", label: localized.buildingsModeUndercity || "Undercity" },
        { value: "horde", label: localized.buildingsModeHorde || "Horde" },
      ],
      [localized.buildingsModeHorde, localized.buildingsModeNormal, localized.buildingsModeUndercity],
    );

    // The selected type, when one is: it is what the undercity board shows, and the
    // culture/subculture/faction dropdowns narrow to what it names.
    const foreignSlotType = useMemo(
      () => catalog.foreignSlotTypes.find((entry) => entry.key === query.foreignSlotType),
      [catalog.foreignSlotTypes, query.foreignSlotType],
    );
    // No `(none)` entry: the mode owns "not browsing foreign slots" now, so it would only offer a
    // way to empty the board.
    const foreignSlotTypeOptions = useMemo(() => toOptions(catalog.foreignSlotTypes), [catalog.foreignSlotTypes]);

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

    const emptyCultures = useMemo(() => new Set(culturesWithoutChains), [culturesWithoutChains]);
    const cultureOptions = useMemo(
      () => [
        noneOption,
        ...buildCultureOptions(
          catalog.cultures.filter((entry) => !foreignSlotType || foreignSlotType.cultures.includes(entry.key)),
          emptyCultures,
        ),
      ],
      [catalog.cultures, emptyCultures, foreignSlotType, noneOption],
    );

    const subcultureOptions = useMemo(
      () => [
        noneOption,
        ...toOptions(
          catalog.subcultures.filter(
            (entry) =>
              (!query.culture || entry.culture === query.culture) &&
              (!foreignSlotType || foreignSlotType.subcultures.includes(entry.key)),
          ),
          true,
        ),
      ],
      [catalog.subcultures, foreignSlotType, noneOption, query.culture],
    );

    const factionOptions = useMemo(
      () => [
        noneOption,
        ...buildFactionOptions(
          catalog.factions.filter(
            (entry) =>
              (!query.subculture || entry.subculture === query.subculture) &&
              (!query.culture || entry.culture === query.culture) &&
              (!foreignSlotType || foreignSlotType.factions.includes(entry.key)),
          ),
        ),
      ],
      [catalog.factions, foreignSlotType, noneOption, query.culture, query.subculture],
    );

    const settlementOptions = useMemo(
      () => [noneOption, ...toOptions(settlementTypeOptions)],
      [noneOption, settlementTypeOptions],
    );

    useEffect(() => {
      if (!isOptionsMenuOpen) return;

      const onPointerDown = (event: MouseEvent) => {
        if (optionsMenuRef.current?.contains(event.target as Node)) return;
        setIsOptionsMenuOpen(false);
      };

      document.addEventListener("mousedown", onPointerDown);
      return () => {
        document.removeEventListener("mousedown", onPointerDown);
      };
    }, [isOptionsMenuOpen]);

    return (
      // Above the board: tiles carrying unit portraits are given a z-index so their overhang is not
      // clipped by the next tile, and without a stacking context of its own this bar - which comes
      // earlier in the DOM - loses to them and its open dropdown renders behind the buildings.
      <div className="relative z-30 flex flex-wrap items-end gap-3 border-b border-gray-700 px-4 py-3">
        <FilterSelect
          label={localized.buildingsBoardMode || "Mode"}
          options={modeOptions}
          value={mode}
          width={modeSelectWidth}
          onSelect={(next) => onQueryChange(boardModeQueryPatch(next as BuildingsBoardMode, query, catalog))}
        />

        <FilterSelect
          label={localized.buildingsCampaign || "Campaign"}
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

        {mode === "normal" && (
          <>
            <FilterSelect
              label={localized.buildingsRegion || "Region"}
              options={regionOptions}
              value={query.region}
              onSelect={(region) => onQueryChange({ region, settlementType: undefined })}
            />

            <button
              type="button"
              onClick={() => onOpenMap(query.campaign, query.region)}
              className="mb-0.5 flex h-9 w-9 items-center justify-center rounded border border-gray-700 bg-gray-900 text-gray-300 hover:border-blue-500 hover:bg-gray-800 hover:text-white"
              title={localized.buildingsChooseRegionOnMap || "Choose region on map"}
              aria-label={localized.buildingsChooseRegionOnMap || "Choose region on map"}
            >
              <FaMapMarkedAlt size="1rem" />
            </button>
          </>
        )}

        {mode === "undercity" && foreignSlotTypeOptions.length > 0 && (
          <FilterSelect
            label={localized.buildingsForeignSlotType || "Foreign slot type"}
            options={foreignSlotTypeOptions}
            value={query.foreignSlotType}
            onSelect={(type) =>
              onQueryChange(
                foreignSlotTypeQueryPatch(
                  catalog.foreignSlotTypes.find((entry) => entry.key === type),
                  query,
                ),
              )
            }
          />
        )}

        {mode === "normal" && settlementOptions.length > 0 && (
          <FilterSelect
            label={localized.buildingsSettlementType || "Settlement type"}
            options={settlementOptions}
            value={query.settlementType}
            disabled={settlementTypeDisabled}
            onSelect={(settlementType) => onQueryChange({ settlementType: settlementType || undefined })}
          />
        )}

        <FilterSelect
          label={localized.buildingsCulture || "Culture"}
          options={cultureOptions}
          value={query.culture}
          onSelect={(culture) =>
            onQueryChange({
              culture: culture || undefined,
              settlementType: undefined,
              subculture: undefined,
              faction: undefined,
            })
          }
        />

        <FilterSelect
          label={localized.buildingsSubculture || "Subculture"}
          options={subcultureOptions}
          value={query.subculture}
          onSelect={(subculture) => onQueryChange({ subculture: subculture || undefined, faction: undefined })}
        />

        <FilterSelect
          label={localized.buildingsFaction || "Faction"}
          options={factionOptions}
          value={query.faction}
          onSelect={(faction) => onQueryChange({ faction: faction || undefined })}
        />

        <div className="flex flex-col gap-1 text-sm text-gray-300">
          <span>
            {(localized.buildingsZoom || "Zoom {{percent}}%").replace("{{percent}}", `${Math.round(zoom * 100)}`)}
          </span>
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

        <div className="relative mb-0.5" ref={optionsMenuRef}>
          <button
            type="button"
            onClick={() => setIsOptionsMenuOpen((currentValue) => !currentValue)}
            className="h-9 rounded border border-gray-700 bg-gray-900 px-3 text-sm text-gray-300 hover:border-blue-500 hover:bg-gray-800 hover:text-white"
          >
            {localized.buildingsExtra || "Extra"}
          </button>
          {isOptionsMenuOpen && (
            <div className="absolute right-0 z-[250] mt-1 w-56 rounded-lg border border-gray-700 bg-gray-800 p-1 text-left shadow-lg">
              <label className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700">
                <input
                  type="checkbox"
                  checked={!!query.includeHiddenInUi}
                  onChange={(event) => onQueryChange({ includeHiddenInUi: event.target.checked })}
                />
                {localized.buildingsHiddenBuildings || "Hidden buildings"}
              </label>
              <label className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700">
                <input
                  type="checkbox"
                  checked={!!query.includeHiddenSets}
                  onChange={(event) => onQueryChange({ includeHiddenSets: event.target.checked })}
                />
                {localized.buildingsHiddenSets || "Hidden sets"}
              </label>
              <label className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700">
                <input
                  type="checkbox"
                  checked={!!query.includeLevelsWithoutVariant}
                  onChange={(event) => onQueryChange({ includeLevelsWithoutVariant: event.target.checked })}
                />
                {localized.buildingsNoCultureVariant || "No culture variant"}
              </label>
              <label
                className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700"
                title={localized.buildingsRuinStatesTooltip || "The level-0 razed state of settlement and port chains."}
              >
                <input
                  type="checkbox"
                  checked={!!query.includeRuinLevels}
                  onChange={(event) => onQueryChange({ includeRuinLevels: event.target.checked })}
                />
                {localized.buildingsRuinStates || "Ruin states"}
              </label>
              <label
                className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700"
                title={
                  localized.buildingsUnbandedLevelsTooltip ||
                  "Levels bound to no building set. The game has no band to draw them in, so it leaves them out."
                }
              >
                <input
                  type="checkbox"
                  checked={!!query.includeUnbandedLevels}
                  onChange={(event) => onQueryChange({ includeUnbandedLevels: event.target.checked })}
                />
                {localized.buildingsUnbandedLevels || "Unbanded levels"}
              </label>
              <label
                className="flex items-center gap-2 rounded px-3 py-2 text-sm text-white hover:bg-gray-700"
                title={
                  localized.buildingsOtherCultureChainsTooltip ||
                  "Chains whose levels name only cultures other than the selected one."
                }
              >
                <input
                  type="checkbox"
                  checked={!!query.includeOtherCultureChains}
                  onChange={(event) => onQueryChange({ includeOtherCultureChains: event.target.checked })}
                />
                {localized.buildingsOtherCultureChains || "Other cultures' chains"}
              </label>
            </div>
          )}
        </div>

        {mode === "undercity" && foreignSlotType && (
          <p className="basis-full text-xs text-amber-300">
            {(
              localized.buildingsForeignSlotNotRegional ||
              "{{type}} slots are granted by a slot set, not by a region: these buildings can appear in any region, so the region is ignored."
            ).replace("{{type}}", foreignSlotType.key)}
          </p>
        )}

        {mode === "horde" && (
          <p className="basis-full text-xs text-amber-300">
            {localized.buildingsHordeNotRegional ||
              "Horde slots come with a military force type, not with a region: these buildings travel with the army, so no region or settlement type applies."}
          </p>
        )}
      </div>
    );
  },
);

export default BuildingsFilters;
