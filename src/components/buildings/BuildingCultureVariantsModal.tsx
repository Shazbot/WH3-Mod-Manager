import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import WindowedSelect from "react-windowed-select";
import { Modal } from "../../flowbite";
import selectStyle from "../../styles/selectStyle";
import { addBuildingCultureVariantRows } from "../../buildingsData/editActions";
import type { BuildingsEditAction, BuildingsEditState } from "../../buildingsData/edits";
import type { BuildingVariantRow, BuildingsCatalog, BuildingsOption, BuildingsTile } from "../../buildingsData/types";
import { buildFactionOptions } from "./BuildingsFilters";

export type BuildingCultureVariantsModalProps = {
  tile: BuildingsTile;
  catalog: BuildingsCatalog;
  edits: BuildingsEditState;
  onClose: () => void;
  dispatch: (action: BuildingsEditAction) => void;
};

type SelectOption = { value: string; label: string };
type EditableVariantColumn = "disables" | "icon";

const WINDOW_THRESHOLD = 60;
const NONE: SelectOption = { value: "", label: "(any)" };
const labelClass = "flex min-w-0 flex-1 flex-col gap-1 text-xs text-gray-400";
const inputClass = "rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100";

const optionLabel = (option: BuildingsOption) =>
  option.localizedName === option.key ? option.key : `${option.localizedName} — ${option.key}`;

const toOptions = (options: BuildingsOption[]): SelectOption[] =>
  options.map((option) => ({ value: option.key, label: optionLabel(option) }));

const findOption = (options: SelectOption[], value: string) => options.find((option) => option.value === value) ?? null;

const variantKey = (variant: Pick<BuildingVariantRow, "culture" | "subculture" | "faction">) =>
  `${variant.culture}|${variant.subculture}|${variant.faction}`;

const variantPart = (value: string) => value || "(any)";

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
    onChange,
  }: {
    variant: BuildingVariantRow;
    isPending: boolean;
    onChange: (column: EditableVariantColumn, value: string) => void;
  }) => {
    const [icon, setIcon] = useState(variant.icon ?? "");

    useEffect(() => {
      setIcon(variant.icon ?? "");
    }, [variant.icon]);

    const label = [variant.culture, variant.subculture, variant.faction].map(variantPart).join(" / ");
    const commitIcon = () => {
      const nextIcon = icon.trim();
      if (nextIcon !== (variant.icon ?? "")) onChange("icon", nextIcon);
    };

    return (
      <div className="grid min-w-[48rem] grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_5rem_minmax(12rem,1.5fr)_4rem] items-center gap-2 border-t border-gray-700 px-2 py-1.5 text-xs">
        <span className="truncate" title={variant.culture}>
          {variantPart(variant.culture)}
        </span>
        <span className="truncate" title={variant.subculture}>
          {variantPart(variant.subculture)}
        </span>
        <span className="truncate" title={variant.faction}>
          {variantPart(variant.faction)}
        </span>
        <label className="flex items-center justify-center gap-1" title={`Disable ${label}`}>
          <input
            type="checkbox"
            aria-label={`Disable ${label}`}
            checked={variant.disables}
            onChange={(event) => onChange("disables", event.target.checked ? "true" : "false")}
          />
          <span className="sr-only">Disables</span>
        </label>
        <input
          aria-label={`Icon for ${label}`}
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          onBlur={commitIcon}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className={`${inputClass} min-w-0`}
          placeholder="building icon"
        />
        <span className="text-[0.65rem] text-gray-500">{isPending ? "pending" : "vanilla"}</span>
      </div>
    );
  },
);

const BuildingCultureVariantsModal = memo(
  ({ tile, catalog, edits, onClose, dispatch }: BuildingCultureVariantsModalProps) => {
    const [newCulture, setNewCulture] = useState("");
    const [newSubculture, setNewSubculture] = useState("");
    const [newFaction, setNewFaction] = useState("");
    const [newIcon, setNewIcon] = useState("");
    const [newDisables, setNewDisables] = useState(false);

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

    const cultureOptions = useMemo(() => [NONE, ...toOptions(catalog.cultures)], [catalog.cultures]);
    const subcultureOptions = useMemo(
      () => [NONE, ...toOptions(catalog.subcultures.filter((entry) => !newCulture || entry.culture === newCulture))],
      [catalog.subcultures, newCulture],
    );
    const factionOptions = useMemo(
      () => [
        NONE,
        ...buildFactionOptions(
          catalog.factions.filter(
            (entry) =>
              (!newCulture || entry.culture === newCulture) && (!newSubculture || entry.subculture === newSubculture),
          ),
        ),
      ],
      [catalog.factions, newCulture, newSubculture],
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
        <Modal.Header>Edit culture variants — {tile.title}</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              {variants.length} culture variant{variants.length === 1 ? "" : "s"}. Empty culture, subculture or faction
              fields mean the row applies to every value in that scope.
            </p>

            <div className="max-h-[45vh] overflow-auto rounded border border-gray-700">
              <div className="grid min-w-[48rem] grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_5rem_minmax(12rem,1.5fr)_4rem] gap-2 bg-gray-800 px-2 py-1.5 text-[0.65rem] text-gray-400">
                <span>Culture</span>
                <span>Subculture</span>
                <span>Faction</span>
                <span className="text-center">Disables</span>
                <span>Icon</span>
                <span>Source</span>
              </div>
              {variants.length > 0 ? (
                variants.map((variant) => (
                  <VariantRow
                    key={variantKey(variant)}
                    variant={variant}
                    isPending={pendingByVariantKey.has(variantKey(variant))}
                    onChange={(column, value) => updateVariantCell(variant, column, value)}
                  />
                ))
              ) : (
                <div className="border-t border-gray-700 px-2 py-3 text-xs text-gray-500">
                  No culture variant rows exist for this building.
                </div>
              )}
            </div>

            <div className="space-y-2 rounded border border-gray-700 p-3">
              <div className="text-xs font-medium text-gray-300">Add a variant row</div>
              <div className="flex flex-wrap items-end gap-3">
                <label className={labelClass}>
                  Culture
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
                  Subculture
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
                  Faction
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={factionOptions}
                    value={findOption(factionOptions, newFaction)}
                    onChange={(option) => setNewFaction((option as SelectOption | null)?.value ?? "")}
                  />
                </label>
                <label className={`${labelClass} min-w-[12rem]`}>
                  Icon
                  <input
                    value={newIcon}
                    onChange={(event) => setNewIcon(event.target.value)}
                    className={inputClass}
                    placeholder="building icon"
                  />
                </label>
                <label className="flex items-center gap-2 pb-1 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={newDisables}
                    onChange={(event) => setNewDisables(event.target.checked)}
                  />
                  Disables
                </label>
                <button
                  type="button"
                  onClick={addVariant}
                  className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
                >
                  Add variant row
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
            Close
          </button>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default BuildingCultureVariantsModal;
