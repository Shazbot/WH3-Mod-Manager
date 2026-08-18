import React, { memo, useCallback, useMemo, useState } from "react";
import { createFilter } from "react-select";
import WindowedSelect from "react-windowed-select";
import { Modal } from "../../flowbite";
import { useLocalizations } from "../../localizationContext";
import selectStyle from "../../styles/selectStyle";
import { addBuildingCultureVariantRows } from "../../buildingsData/editActions";
import type { BuildingsEditAction, BuildingsEditState } from "../../buildingsData/edits";
import type {
  BuildingVariantRow,
  BuildingsCatalog,
  BuildingsIconOption,
  BuildingsOption,
  BuildingsTile,
} from "../../buildingsData/types";
import { buildFactionOptions } from "./BuildingsFilters";

export type BuildingCultureVariantsModalProps = {
  tile: BuildingsTile;
  catalog: BuildingsCatalog;
  edits: BuildingsEditState;
  onClose: () => void;
  dispatch: (action: BuildingsEditAction) => void;
};

type SelectOption = { value: string; label: string };
type IconSelectOption = SelectOption & { iconUrl?: string; path?: string };
type EditableVariantColumn = "disables" | "icon";

const WINDOW_THRESHOLD = 60;
const labelClass = "flex min-w-0 flex-1 flex-col gap-1 text-xs text-gray-400";
const inputClass = "rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100";
const portalSelectStyle = {
  ...selectStyle,
  menuPortal: (base: any) => ({ ...base, zIndex: 80 }),
  menu: (base: any) => ({ ...selectStyle.menu(base), zIndex: 80 }),
};

const optionLabel = (option: BuildingsOption) =>
  option.localizedName === option.key ? option.key : `${option.localizedName} — ${option.key}`;

const toOptions = (options: BuildingsOption[]): SelectOption[] =>
  options.map((option) => ({ value: option.key, label: optionLabel(option) }));

const findOption = (options: SelectOption[], value: string) => options.find((option) => option.value === value) ?? null;

const variantKey = (variant: Pick<BuildingVariantRow, "culture" | "subculture" | "faction">) =>
  `${variant.culture}|${variant.subculture}|${variant.faction}`;

const variantPart = (value: string, anyLabel = "(any)") => value || anyLabel;

/** The icon beside an option's name, or the space it occupies when an old value has no asset. */
const OptionIcon = ({ iconUrl, large = false }: { iconUrl?: string; large?: boolean }) =>
  iconUrl ? (
    <img src={iconUrl} alt="" className={`${large ? "h-16 w-16" : "h-5 w-5"} shrink-0 object-contain`} />
  ) : (
    <span
      className={`${large ? "h-16 w-16" : "h-5 w-5"} flex shrink-0 items-center justify-center text-[0.6rem] text-gray-500`}
    >
      —
    </span>
  );

const IconTile = ({
  option,
  isSelected,
  onClick,
}: {
  option: IconSelectOption;
  isSelected: boolean;
  onClick: () => void;
}) => {
  const localized = useLocalizations();
  return (
    <button
      type="button"
      onClick={onClick}
      title={option.label}
      aria-label={(localized.buildingsSelectIcon || "Select icon {{label}}").replace("{{label}}", option.label)}
      className={`rounded border-2 p-2 text-center transition-colors ${
        isSelected ? "border-blue-500 bg-gray-700" : "border-gray-600 hover:border-gray-500 hover:bg-gray-700"
      }`}
    >
      <OptionIcon iconUrl={option.iconUrl} large />
      <div className="mt-2 truncate text-xs text-gray-300">{option.label}</div>
    </button>
  );
};

const iconNameFromValue = (value: string) => {
  const normalized = value.replace(/\\/g, "/").split("/").pop() ?? value;
  return normalized.replace(/\.(png|jpg|jpeg|webp|tga)$/i, "");
};

/** An image-backed icon select with the same large browser used by the technology node editor. */
const BuildingIconSelect = ({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: IconSelectOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) => {
  const localized = useLocalizations();
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [search, setSearch] = useState("");
  const normalizedValue = iconNameFromValue(value);
  const selected =
    options.find((option) => option.value === value || option.value === normalizedValue) ??
    (value ? { value, label: value } : null);
  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(needle) || option.path?.toLowerCase().includes(needle),
    );
  }, [options, search]);

  return (
    <>
      <div className="flex min-w-0 gap-1">
        <div className="min-w-0 flex-1">
          <WindowedSelect
            windowThreshold={WINDOW_THRESHOLD}
            filterOption={createFilter({ ignoreAccents: false })}
            options={options}
            value={selected}
            // @ts-expect-error react-select value type does not match the windowed select wrapper.
            onChange={(option: IconSelectOption | null) => onChange(option?.value ?? "")}
            styles={portalSelectStyle}
            placeholder={localized.buildingsChooseIcon || "Choose icon..."}
            isClearable
            aria-label={ariaLabel}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            menuPlacement="auto"
            // @ts-expect-error react-select option rendering types are narrower than the runtime shape here.
            formatOptionLabel={(option: IconSelectOption) => (
              <div className="flex min-w-0 items-center gap-2">
                <OptionIcon iconUrl={option.iconUrl} />
                <span className="truncate">{option.label}</span>
              </div>
            )}
          />
        </div>
        <button
          type="button"
          aria-label={localized.buildingsBrowseIcons || "Browse icons"}
          title={localized.buildingsBrowseAllIcons || "Browse all building icons"}
          onClick={() => setIsBrowserOpen(true)}
          className="shrink-0 rounded bg-gray-700 px-2 text-xs text-gray-100 hover:bg-gray-600"
        >
          {localized.buildingsBrowse || "Browse…"}
        </button>
      </div>

      {isBrowserOpen && (
        <Modal
          show
          onClose={() => setIsBrowserOpen(false)}
          size="5xl"
          explicitClasses={[
            "max-w-[90vw]",
            "first-child-div-second-child-div-flex-grow",
            "first-child-div-flex-col",
            "!h-[85vh]",
          ]}
        >
          <Modal.Header>{localized.buildingsBrowseBuildingIcons || "Browse building icons"}</Modal.Header>
          <Modal.Body>
            <div className="flex h-full flex-col gap-3">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={localized.buildingsSearchIcons || "Search icons..."}
                aria-label={localized.buildingsSearchBuildingIcons || "Search building icons"}
                className={inputClass}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-6 gap-3 p-1">
                  {filteredOptions.map((option) => (
                    <IconTile
                      key={option.path ?? option.value}
                      option={option}
                      isSelected={selected?.value === option.value}
                      onClick={() => {
                        onChange(option.value);
                        setIsBrowserOpen(false);
                      }}
                    />
                  ))}
                </div>
                {filteredOptions.length === 0 && (
                  <div className="py-8 text-center text-sm text-gray-400">
                    {localized.buildingsNoIconsMatch || "No icons match this search."}
                  </div>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              type="button"
              onClick={() => setIsBrowserOpen(false)}
              className="rounded bg-gray-700 px-4 py-2 text-sm text-gray-100 hover:bg-gray-600"
            >
              {localized.buildingsClose || "Close"}
            </button>
          </Modal.Footer>
        </Modal>
      )}
    </>
  );
};

/** Reconstructs a complete row when an older cache has no rawValues on its parsed variants. */
const valuesForVariant = (variant: BuildingVariantRow): Record<string, string> => ({
  ...(variant.rawValues ?? {}),
  building: variant.building,
  culture: variant.culture,
  subculture: variant.subculture,
  faction: variant.faction,
  icon: variant.icon ?? "",
  disables: variant.disables ? "true" : "false",
  display_tooltip: variant.displayTooltip ? "true" : "false",
  ...(variant.description !== undefined ? { description: variant.description } : {}),
  ...(variant.shortDescription !== undefined ? { short_description: variant.shortDescription } : {}),
  ...(variant.frameOverride !== undefined ? { building_frame_override: variant.frameOverride } : {}),
});

const VariantRow = memo(
  ({
    variant,
    isPending,
    iconOptions,
    onChange,
  }: {
    variant: BuildingVariantRow;
    isPending: boolean;
    iconOptions: IconSelectOption[];
    onChange: (column: EditableVariantColumn, value: string) => void;
  }) => {
    const localized = useLocalizations();
    const anyLabel = localized.buildingsAny || "(any)";
    const label = [variant.culture, variant.subculture, variant.faction]
      .map((value) => variantPart(value, anyLabel))
      .join(" / ");

    return (
      <div className="grid min-w-[48rem] grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_5rem_minmax(12rem,1.5fr)_4rem] items-center gap-2 border-t border-gray-700 px-2 py-1.5 text-xs">
        <span className="truncate" title={variant.culture}>
          {variantPart(variant.culture, anyLabel)}
        </span>
        <span className="truncate" title={variant.subculture}>
          {variantPart(variant.subculture, anyLabel)}
        </span>
        <span className="truncate" title={variant.faction}>
          {variantPart(variant.faction, anyLabel)}
        </span>
        <label
          className="flex items-center justify-center gap-1"
          title={(localized.buildingsDisableVariant || "Disable {{label}}").replace("{{label}}", label)}
        >
          <input
            type="checkbox"
            aria-label={(localized.buildingsDisableVariant || "Disable {{label}}").replace("{{label}}", label)}
            checked={variant.disables}
            onChange={(event) => onChange("disables", event.target.checked ? "true" : "false")}
          />
          <span className="sr-only">{localized.buildingsDisables || "Disables"}</span>
        </label>
        <BuildingIconSelect
          options={iconOptions}
          value={variant.icon ?? ""}
          onChange={(value) => onChange("icon", value)}
          ariaLabel={(localized.buildingsIconFor || "Icon for {{label}}").replace("{{label}}", label)}
        />
        <span className="text-[0.65rem] text-gray-500">
          {isPending ? localized.buildingsPending || "pending" : localized.buildingsVanilla || "vanilla"}
        </span>
      </div>
    );
  },
);

const BuildingCultureVariantsModal = memo(
  ({ tile, catalog, edits, onClose, dispatch }: BuildingCultureVariantsModalProps) => {
    const localized = useLocalizations();
    const [newCulture, setNewCulture] = useState("");
    const [newSubculture, setNewSubculture] = useState("");
    const [newFaction, setNewFaction] = useState("");
    const [newIcon, setNewIcon] = useState("");
    const [newDisables, setNewDisables] = useState(false);

    const iconOptions = useMemo<IconSelectOption[]>(
      () =>
        catalog.buildingIcons.map((icon: BuildingsIconOption) => ({
          value: icon.name,
          label: icon.name,
          path: icon.path,
          iconUrl: icon.iconUrl,
        })),
      [catalog.buildingIcons],
    );

    // Pending rows are appended after the effective base rows. Last row for a composite key is the
    // one the game uses, so dedupe here to show one editable row per actual variant.
    const variants = useMemo(() => {
      const byKey = new Map<string, BuildingVariantRow>();
      for (const variant of catalog.cultureVariantsByBuilding[tile.levelKey] ?? []) {
        byKey.set(variantKey(variant), variant);
      }
      return [...byKey.values()];
    }, [catalog.cultureVariantsByBuilding, tile.levelKey]);

    const pendingByVariantKey = useMemo(() => {
      const ids = new Map<string, string>();
      for (const id of edits.order) {
        const row = edits.rowsById[id];
        if (!row || row.table !== "building_culture_variants_tables") continue;
        if ((row.values.building ?? "").trim() !== tile.levelKey) continue;
        ids.set(
          variantKey({
            culture: (row.values.culture ?? "").trim(),
            subculture: (row.values.subculture ?? "").trim(),
            faction: (row.values.faction ?? "").trim(),
          }),
          id,
        );
      }
      return ids;
    }, [edits, tile.levelKey]);

    const updateVariantCell = useCallback(
      (variant: BuildingVariantRow, column: EditableVariantColumn, value: string) => {
        const pendingId = pendingByVariantKey.get(variantKey(variant));
        if (pendingId) {
          dispatch({ type: "setCell", id: pendingId, column, value });
          return;
        }
        dispatch({
          type: "addRows",
          rows: [
            {
              table: "building_culture_variants_tables",
              origin: "manual",
              values: { ...valuesForVariant(variant), [column]: value },
            },
          ],
        });
      },
      [dispatch, pendingByVariantKey],
    );

    const noneOption = useMemo<SelectOption>(
      () => ({ value: "", label: localized.buildingsAny || "(any)" }),
      [localized.buildingsAny],
    );
    const cultureOptions = useMemo(() => [noneOption, ...toOptions(catalog.cultures)], [catalog.cultures, noneOption]);
    const subcultureOptions = useMemo(
      () => [
        noneOption,
        ...toOptions(catalog.subcultures.filter((entry) => !newCulture || entry.culture === newCulture)),
      ],
      [catalog.subcultures, newCulture, noneOption],
    );
    const factionOptions = useMemo(
      () => [
        noneOption,
        ...buildFactionOptions(
          catalog.factions.filter(
            (entry) =>
              (!newCulture || entry.culture === newCulture) && (!newSubculture || entry.subculture === newSubculture),
          ),
        ),
      ],
      [catalog.factions, newCulture, newSubculture, noneOption],
    );

    const addVariant = () => {
      dispatch({
        type: "addRows",
        rows: addBuildingCultureVariantRows({
          levelKey: tile.levelKey,
          culture: newCulture,
          subculture: newSubculture,
          faction: newFaction,
          icon: newIcon.trim(),
          disables: newDisables,
        }),
      });
    };

    return (
      <Modal onClose={onClose} show size="4xl" position="center">
        <Modal.Header>
          {(localized.buildingsEditCultureVariantsTitle || "Edit culture variants — {{title}}").replace(
            "{{title}}",
            tile.title,
          )}
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              {(
                localized.buildingsCultureVariantSummary ||
                "{{count}} culture variant(s). Empty culture, subculture or faction fields mean the row applies to every value in that scope."
              )
                .replace("{{count}}", `${variants.length}`)
                .replace("variant(s)", variants.length === 1 ? "variant" : "variants")}
            </p>

            <div className="max-h-[45vh] overflow-auto rounded border border-gray-700">
              <div className="grid min-w-[48rem] grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_5rem_minmax(12rem,1.5fr)_4rem] gap-2 bg-gray-800 px-2 py-1.5 text-[0.65rem] text-gray-400">
                <span>{localized.buildingsCulture || "Culture"}</span>
                <span>{localized.buildingsSubculture || "Subculture"}</span>
                <span>{localized.buildingsFaction || "Faction"}</span>
                <span className="text-center">{localized.buildingsDisables || "Disables"}</span>
                <span>{localized.buildingsIcon || "Icon"}</span>
                <span>{localized.buildingsSource || "Source"}</span>
              </div>
              {variants.length > 0 ? (
                variants.map((variant) => (
                  <VariantRow
                    key={variantKey(variant)}
                    variant={variant}
                    isPending={pendingByVariantKey.has(variantKey(variant))}
                    iconOptions={iconOptions}
                    onChange={(column, value) => updateVariantCell(variant, column, value)}
                  />
                ))
              ) : (
                <div className="border-t border-gray-700 px-2 py-3 text-xs text-gray-500">
                  {localized.buildingsNoVariantRows || "No culture variant rows exist for this building."}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded border border-gray-700 p-3">
              <div className="text-xs font-medium text-gray-300">
                {localized.buildingsAddVariantRow || "Add a variant row"}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className={labelClass}>
                  {localized.buildingsCulture || "Culture"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={cultureOptions}
                    value={findOption(cultureOptions, newCulture)}
                    onChange={(option) => {
                      setNewCulture((option as SelectOption | null)?.value ?? "");
                      setNewSubculture("");
                      setNewFaction("");
                    }}
                  />
                </label>
                <label className={labelClass}>
                  {localized.buildingsSubculture || "Subculture"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={subcultureOptions}
                    value={findOption(subcultureOptions, newSubculture)}
                    onChange={(option) => {
                      setNewSubculture((option as SelectOption | null)?.value ?? "");
                      setNewFaction("");
                    }}
                  />
                </label>
                <label className={labelClass}>
                  {localized.buildingsFaction || "Faction"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={factionOptions}
                    value={findOption(factionOptions, newFaction)}
                    onChange={(option) => setNewFaction((option as SelectOption | null)?.value ?? "")}
                  />
                </label>
                <label className={`${labelClass} min-w-[15rem]`}>
                  {localized.buildingsIcon || "Icon"}
                  <BuildingIconSelect
                    options={iconOptions}
                    value={newIcon}
                    onChange={setNewIcon}
                    ariaLabel={localized.buildingsIcon || "Icon"}
                  />
                </label>
                <label className="flex items-center gap-2 pb-1 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={newDisables}
                    onChange={(event) => setNewDisables(event.target.checked)}
                  />
                  {localized.buildingsDisables || "Disables"}
                </label>
                <button
                  type="button"
                  onClick={addVariant}
                  className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
                >
                  {localized.buildingsAddVariantRowButton || "Add variant row"}
                </button>
              </div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-500"
          >
            {localized.buildingsClose || "Close"}
          </button>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default BuildingCultureVariantsModal;
