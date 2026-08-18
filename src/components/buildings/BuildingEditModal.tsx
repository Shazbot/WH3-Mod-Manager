import React, { memo, useCallback, useMemo, useState } from "react";
import WindowedSelect from "react-windowed-select";
import { createFilter } from "react-select";
import { Modal } from "../../flowbite";
import { useLocalizations } from "../../localizationContext";
import selectStyle from "../../styles/selectStyle";
import {
  addEffectRows,
  addGarrisonRows,
  addRecruitableUnitRows,
  cloneCaiRows,
  type NewRowDraft,
} from "../../buildingsData/editActions";
import type { BuildingsEditAction } from "../../buildingsData/edits";
import type {
  BuildingsCaiRowsResponse,
  BuildingsCatalog,
  BuildingsOption,
  BuildingsTile,
} from "../../buildingsData/types";

export type BuildingEditModalProps = {
  tile: BuildingsTile;
  catalog: BuildingsCatalog;
  /** Cursors from the edit state, so allocated numeric ids never repeat. */
  numericIdCursors: Record<string, number>;
  /** Owned by the tab, which is what holds the enabled-mod list the read needs. */
  fetchCaiRows: (chainKey: string) => Promise<BuildingsCaiRowsResponse>;
  /**
   * The pending effect rows already written for this building, keyed by effect.
   *
   * Tells an effect the user added or overrode apart from one the game ships, which decides whether
   * it can be taken away and whether changing its value edits a row or writes a new one.
   */
  pendingEffects: Record<string, { id: string; value: number }>;
  onClose: () => void;
  dispatch: (action: BuildingsEditAction) => void;
};

type SelectOption = { value: string; label: string };
/** The label is the effect's description, so the key is shown alongside rather than folded in. */
type EffectOption = SelectOption & { preferredScope?: string };
type Tab = "recruitment" | "garrison" | "effects" | "cai";

const WINDOW_THRESHOLD = 60;
const inputClass = "rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-100";
const labelClass = "flex flex-col gap-1 text-xs text-gray-400";

const toKeyOptions = (keys: string[]): SelectOption[] => keys.map((key) => ({ value: key, label: key }));

const toOptions = (options: BuildingsOption[]): SelectOption[] =>
  options.map((option) => ({
    value: option.key,
    label: option.localizedName === option.key ? option.key : `${option.localizedName} — ${option.key}`,
  }));

/**
 * Adding recruitment, a garrison or CAI scoring to one building.
 *
 * Three tabs rather than three menu entries because all of them are "pick a thing and set a number",
 * and a modder setting up a new building normally wants more than one of them in a row.
 */
const BuildingEditModal = memo(
  ({ tile, catalog, numericIdCursors, fetchCaiRows, pendingEffects, onClose, dispatch }: BuildingEditModalProps) => {
    const localized = useLocalizations();
    const [tab, setTab] = useState<Tab>("recruitment");
    const [note, setNote] = useState<string | undefined>();

    const unitOptions = useMemo(() => toOptions(catalog.units), [catalog.units]);
    const unitGroupOptions = useMemo(() => toOptions(catalog.unitGroups), [catalog.unitGroups]);
    const [garrisonUnitKey, setGarrisonUnitKey] = useState("");
    const garrisonUnitGroupOptions = useMemo(() => {
      if (!garrisonUnitKey) return unitGroupOptions;
      const groupKeys = new Set(catalog.unitGroupsByUnit[garrisonUnitKey] ?? []);
      return unitGroupOptions.filter((option) => groupKeys.has(option.value));
    }, [catalog.unitGroupsByUnit, garrisonUnitKey, unitGroupOptions]);

    const [unitKey, setUnitKey] = useState("");
    const [unitXp, setUnitXp] = useState("0");
    const [unitFaction, setUnitFaction] = useState("");
    const [unitGroup, setUnitGroup] = useState("");

    // Only the 1824 effects some building already uses carry a localised name and a registered icon;
    // the rest are offered as bare keys for the case where you know exactly what you want.
    const [buildingEffectsOnly, setBuildingEffectsOnly] = useState(true);
    const effectOptions = useMemo<EffectOption[]>(
      () =>
        catalog.effects
          .filter((effect) => !buildingEffectsOnly || effect.usedByBuildings)
          .map((effect) => ({
            value: effect.key,
            label: effect.localizedName,
            preferredScope: effect.preferredScope,
          })),
      [buildingEffectsOnly, catalog.effects],
    );
    const scopeOptions = useMemo(() => toKeyOptions(catalog.effectScopes), [catalog.effectScopes]);
    const chainOptions = useMemo(() => toKeyOptions(catalog.chainKeys), [catalog.chainKeys]);

    const [effectKey, setEffectKey] = useState("");
    const [effectScope, setEffectScope] = useState("building_to_building_own");
    const [effectValue, setEffectValue] = useState("1");
    const preferredEffectScope = useMemo(
      () => catalog.effects.find((effect) => effect.key === effectKey)?.preferredScope,
      [catalog.effects, effectKey],
    );

    const [caiSource, setCaiSource] = useState("");
    const [isCloningCai, setIsCloningCai] = useState(false);

    const emit = useCallback(
      (rows: NewRowDraft[], cursors: Record<string, number>, message: string) => {
        if (rows.length === 0) {
          setNote(localized.buildingsThatProducedNoRows || "That produced no rows.");
          return;
        }
        dispatch({ type: "addRows", rows, numericIdCursors: cursors });
        setNote(message);
      },
      [dispatch, localized.buildingsThatProducedNoRows],
    );

    /** Typed-but-not-yet-committed effect values, so each keystroke does not re-derive the board. */
    const [effectDrafts, setEffectDrafts] = useState<Record<string, string>>({});

    const commitEffectValue = useCallback(
      (effectKey: string, scope: string, currentValue: number, text: string) => {
        setEffectDrafts((drafts) => {
          const next = { ...drafts };
          delete next[effectKey];
          return next;
        });
        const value = Number(text.trim());
        if (text.trim() === "" || !Number.isFinite(value) || value === currentValue) return;

        const pending = pendingEffects[effectKey];
        if (pending) {
          // Already our row - edit it rather than adding a second one with the same (building,
          // effect) key, which would collide and only confuse the tables tab.
          dispatch({ type: "setCell", id: pending.id, column: "value", value: `${value}` });
        } else {
          // A pack cannot change a row in place, but the table keys on (building, effect), so a row
          // with the same pair overrides the one the game ships.
          dispatch({
            type: "addRows",
            rows: addEffectRows({ levelKey: tile.levelKey, effectKey, scope, value }),
          });
        }
        setNote(
          (localized.buildingsEffectSetTo || "{{effect}} set to {{value}}.")
            .replace("{{effect}}", effectKey)
            .replace("{{value}}", `${value}`),
        );
      },
      [dispatch, localized.buildingsEffectSetTo, pendingEffects, tile.levelKey],
    );

    const addRecruitment = () => {
      const cursors = { ...numericIdCursors };
      emit(
        addRecruitableUnitRows(
          { levelKey: tile.levelKey, unitKey, faction: unitFaction || undefined, xp: Number(unitXp) || 0 },
          cursors,
        ),
        cursors,
        (localized.buildingsUnitRecruitable || "{{unit}} can now be recruited here.").replace("{{unit}}", unitKey),
      );
    };

    const addGarrison = () => {
      const cursors = { ...numericIdCursors };
      emit(
        addGarrisonRows({ levelKey: tile.levelKey, unitGroup }, cursors),
        cursors,
        (localized.buildingsUnitGroupAdded || "{{group}} added to the garrison.").replace("{{group}}", unitGroup),
      );
    };

    const addEffect = () => {
      emit(
        addEffectRows({
          levelKey: tile.levelKey,
          effectKey,
          scope: effectScope,
          value: Number(effectValue) || 0,
        }),
        { ...numericIdCursors },
        (localized.buildingsEffectAdded || "{{effect}} added.").replace("{{effect}}", effectKey),
      );
      setEffectKey("");
    };

    const cloneCai = async () => {
      setIsCloningCai(true);
      setNote(undefined);
      try {
        const response = await fetchCaiRows(caiSource);
        if (!response.success || !response.rowsByTable) {
          setNote(response.error || localized.buildingsCaiReadFailed || "Could not read that chain's CAI rows.");
          return;
        }
        const rows = cloneCaiRows({
          fromChainKey: caiSource,
          toChainKey: tile.chainKey,
          rowsByTable: response.rowsByTable,
          fromSuperChain: response.superChain,
        });
        if (rows.length === 0) {
          setNote(
            (localized.buildingsCaiNoRows || "{{chain}} has no CAI rows of its own to copy.").replace(
              "{{chain}}",
              caiSource,
            ),
          );
          return;
        }
        emit(
          rows,
          { ...numericIdCursors },
          (localized.buildingsCaiRowsCopied || "Copied {{count}} CAI row(s).")
            .replace("{{count}}", `${rows.length}`)
            .replace("row(s)", rows.length === 1 ? "row" : "rows"),
        );
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      } finally {
        setIsCloningCai(false);
      }
    };

    return (
      <Modal
        onClose={onClose}
        show
        size="2xl"
        position="center"
        explicitClasses={["first-child-div-second-child-div-flex-grow", "!h-[75vh]", "first-child-div-flex-col"]}
      >
        <Modal.Header>
          {(localized.buildingsEditTitle || "Edit {{title}}").replace("{{title}}", tile.title)}
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-gray-700">
              {(
                [
                  ["recruitment", localized.buildingsRecruitment || "Recruitment"],
                  ["garrison", localized.buildingsGarrison || "Garrison"],
                  ["effects", localized.buildingsEffects || "Effects"],
                  ["cai", localized.buildingsAiScoring || "AI scoring"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 text-sm ${
                    tab === key ? "border-b-2 border-blue-500 text-gray-100" : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "recruitment" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  {(localized.buildingsCurrentlyUnlocks || "Currently unlocks {{count}} unit(s).")
                    .replace("{{count}}", `${tile.recruitable.length}`)
                    .replace("unit(s)", tile.recruitable.length === 1 ? "unit" : "units")}
                </p>
                <label className={labelClass}>
                  {localized.buildingsUnit || "Unit"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={unitOptions}
                    value={unitOptions.find((option) => option.value === unitKey) ?? null}
                    onChange={(option) => setUnitKey((option as SelectOption | null)?.value ?? "")}
                  />
                </label>
                <div className="flex gap-3">
                  <label className={`${labelClass} flex-1`}>
                    {localized.buildingsStartingXp || "Starting XP"}
                    <input
                      value={unitXp}
                      onChange={(event) => setUnitXp(event.target.value)}
                      className={inputClass}
                      inputMode="numeric"
                    />
                  </label>
                  <label className={`${labelClass} flex-1`}>
                    {localized.buildingsFactionBlankForAll || "Faction (blank for all)"}
                    <input
                      value={unitFaction}
                      onChange={(event) => setUnitFaction(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!unitKey}
                  onClick={addRecruitment}
                  className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {localized.buildingsAddRecruitment || "Add recruitment"}
                </button>
              </div>
            )}

            {tab === "garrison" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  {(
                    localized.buildingsCurrentlyProvides ||
                    "Currently provides {{count}} unit(s). A garrison is a whole unit group, not one unit."
                  )
                    .replace("{{count}}", `${tile.garrison.length}`)
                    .replace("unit(s)", tile.garrison.length === 1 ? "unit" : "units")}
                </p>
                <label className={labelClass}>
                  {localized.buildingsUnit || "Unit"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={unitOptions}
                    value={unitOptions.find((option) => option.value === garrisonUnitKey) ?? null}
                    onChange={(option) => {
                      const nextUnitKey = (option as SelectOption | null)?.value ?? "";
                      setGarrisonUnitKey(nextUnitKey);
                      if (
                        nextUnitKey &&
                        unitGroup &&
                        !(catalog.unitGroupsByUnit[nextUnitKey] ?? []).includes(unitGroup)
                      ) {
                        setUnitGroup("");
                      }
                    }}
                  />
                </label>
                <label className={labelClass}>
                  {localized.buildingsUnitGroup || "Unit group"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={garrisonUnitGroupOptions}
                    value={garrisonUnitGroupOptions.find((option) => option.value === unitGroup) ?? null}
                    onChange={(option) => setUnitGroup((option as SelectOption | null)?.value ?? "")}
                  />
                </label>
                <button
                  type="button"
                  disabled={!unitGroup}
                  onClick={addGarrison}
                  className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {localized.buildingsAddGarrisonGroup || "Add garrison group"}
                </button>
              </div>
            )}

            {tab === "effects" && (
              <div className="space-y-3">
                {tile.effects.length > 0 && (
                  <div className="max-h-52 space-y-1 overflow-y-auto rounded border border-gray-700 p-2">
                    {tile.effects.map((effect) => {
                      const pending = pendingEffects[effect.effectKey];
                      return (
                        <div key={effect.effectKey} className="flex items-center gap-2 text-xs">
                          {effect.iconUrl ? (
                            <img src={effect.iconUrl} alt="" className="h-4 w-4 shrink-0" />
                          ) : (
                            <span className="h-4 w-4 shrink-0" />
                          )}
                          <span className="flex-1 truncate text-gray-200" title={effect.effectKey}>
                            {effect.localizedKey}
                          </span>
                          <input
                            value={effectDrafts[effect.effectKey] ?? `${effect.value}`}
                            onChange={(event) =>
                              setEffectDrafts((drafts) => ({ ...drafts, [effect.effectKey]: event.target.value }))
                            }
                            onBlur={(event) =>
                              commitEffectValue(effect.effectKey, effect.scope, effect.value, event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                            className={`w-16 shrink-0 py-0.5 text-right ${inputClass}`}
                            inputMode="decimal"
                          />
                          {pending ? (
                            <button
                              type="button"
                              title={
                                localized.buildingsRemovePendingEffectTooltip ||
                                "Drops the row we added. An effect the game ships comes back at its own value."
                              }
                              onClick={() => dispatch({ type: "removeRow", id: pending.id })}
                              className="shrink-0 rounded bg-red-800 px-2 py-0.5 text-gray-100 hover:bg-red-700"
                            >
                              {localized.buildingsRemove || "Remove"}
                            </button>
                          ) : (
                            <span
                              className="w-[4.6rem] shrink-0 text-center text-[0.65rem] text-gray-500"
                              title={
                                localized.buildingsShippedEffectTooltip ||
                                "Shipped with the game. A pack can only add rows, so this cannot be deleted - only its value overridden."
                              }
                            >
                              {localized.buildingsVanilla || "vanilla"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-xs text-gray-400">
                  {localized.buildingsEffectsHelp ||
                    "Editing a value writes a row that overrides the one the game ships; only effects added here can be removed again. The scope decides who a new effect reaches - `building_to_building_own` stays on this building, `region_to_region_own` covers the region."}
                </p>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={buildingEffectsOnly}
                    onChange={(event) => setBuildingEffectsOnly(event.target.checked)}
                  />
                  {(localized.buildingsOnlyBuildingEffects || "Only effects buildings use ({{used}} of {{total}})")
                    .replace("{{used}}", `${catalog.effects.filter((effect) => effect.usedByBuildings).length}`)
                    .replace("{{total}}", `${catalog.effects.length}`)}
                </label>
                <label className={labelClass}>
                  {localized.buildingsEffect || "Effect"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={effectOptions}
                    value={effectOptions.find((option) => option.value === effectKey) ?? null}
                    onChange={(option) => {
                      const selected = option as EffectOption | null;
                      setEffectKey(selected?.value ?? "");
                      if (selected?.preferredScope) setEffectScope(selected.preferredScope);
                    }}
                    filterOption={createFilter({ ignoreAccents: false })}
                    placeholder={localized.buildingsSearchEffects || "Search effects..."}
                    // @ts-expect-error react-select's option type is narrower than the runtime shape.
                    formatOptionLabel={(option: EffectOption) => (
                      <div className="flex items-baseline gap-2">
                        <span className="truncate">{option.label}</span>
                        {option.label !== option.value && (
                          <span className="truncate text-[0.65rem] text-gray-400">({option.value})</span>
                        )}
                      </div>
                    )}
                  />
                </label>
                {effectKey && (
                  <p className="text-xs text-gray-400">
                    {localized.buildingsMostFrequentScope || "Most frequently used scope:"}{" "}
                    <span className="text-gray-200">
                      {preferredEffectScope ?? (localized.buildingsNoneFound || "(none found)")}
                    </span>
                  </p>
                )}
                <div className="flex gap-3">
                  <label className={`${labelClass} flex-1`}>
                    {localized.buildingsScope || "Scope"}
                    <WindowedSelect
                      windowThreshold={WINDOW_THRESHOLD}
                      styles={selectStyle}
                      options={scopeOptions}
                      value={scopeOptions.find((option) => option.value === effectScope) ?? null}
                      onChange={(option) => setEffectScope((option as SelectOption | null)?.value ?? "")}
                    />
                  </label>
                  <label className={`${labelClass} w-32`}>
                    {localized.buildingsValue || "Value"}
                    <input
                      value={effectValue}
                      onChange={(event) => setEffectValue(event.target.value)}
                      className={inputClass}
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!effectKey || !effectScope}
                  onClick={addEffect}
                  className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {localized.buildingsAddEffect || "Add effect"}
                </button>
              </div>
            )}

            {tab === "cai" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  {(
                    localized.buildingsCaiHelp ||
                    "The AI will not build {{chain}} without scoring rows. Copying them from a chain that plays the same role is how these are normally written - only the columns naming that chain are rewritten, so a synergy with some third building carries over intact."
                  ).replace("{{chain}}", tile.chainKey)}
                </p>
                <label className={labelClass}>
                  {localized.buildingsCopyCaiFrom || "Copy CAI rows from chain"}
                  <WindowedSelect
                    windowThreshold={WINDOW_THRESHOLD}
                    styles={selectStyle}
                    options={chainOptions}
                    value={chainOptions.find((option) => option.value === caiSource) ?? null}
                    onChange={(option) => setCaiSource((option as SelectOption | null)?.value ?? "")}
                    filterOption={createFilter({ ignoreAccents: false })}
                    placeholder={localized.buildingsSearchBuildingChains || "Search building chains..."}
                  />
                </label>
                <button
                  type="button"
                  disabled={!caiSource || isCloningCai}
                  onClick={cloneCai}
                  className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {isCloningCai
                    ? localized.buildingsCopying || "Copying..."
                    : localized.buildingsCopyCaiRows || "Copy CAI rows"}
                </button>
              </div>
            )}

            {note && <p className="text-xs text-emerald-400">{note}</p>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-500"
          >
            {localized.buildingsDone || "Done"}
          </button>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default BuildingEditModal;
