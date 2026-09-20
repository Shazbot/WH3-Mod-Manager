import React, { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAppSelector } from "../../hooks";
import AbilityTooltipCard from "../skillsViewer/AbilityTooltipCard";
import {
  abilityEditReducer,
  emptyAbilityEditState,
  type AbilityEditAction,
} from "../../abilitiesData/edits";
import { cloneAbilityRows, copyAbilityPayloadRows } from "../../abilitiesData/clone";
import type {
  AbilityCatalog,
  AbilityCatalogEntry,
  AbilityDetail,
  AbilityPhaseDetail,
  AbilityRowView,
} from "../../abilitiesData/types";
import AbilitiesTablesTab from "./AbilitiesTablesTab";
import AbilitiesSaveModal from "./AbilitiesSaveModal";

type DetailTab = "overview" | "mechanics" | "phases" | "payload" | "conditions" | "usedBy" | "advanced" | "newRows";
const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "mechanics", label: "Mechanics" },
  { key: "phases", label: "Phases" },
  { key: "payload", label: "Payload" },
  { key: "conditions", label: "Conditions" },
  { key: "usedBy", label: "Used by" },
  { key: "advanced", label: "Advanced / Raw" },
  { key: "newRows", label: "New Rows" },
];

const curatedMechanics = [
  "active_time", "recharge_time", "initial_recharge", "num_uses", "effect_range", "min_range",
  "target_intercept_range", "affect_self", "always_affect_self", "only_affect_target", "target_self",
  "target_friends", "target_enemies", "target_ground", "target_ground_under_allies", "target_ground_under_enemies",
  "num_effected_friendly_units", "num_effected_enemy_units", "update_targets_every_frame", "mana_cost",
  "miscast_chance", "miscast_global_bonus", "wind_up_time", "shared_recharge_time", "intensity_based_activation",
];

const sourceLabel = (entry: AbilityCatalogEntry) => entry.sourceTypeName || entry.sourceType || "Other";
const basename = (path: string) => path.replace(/\\/g, "/").split("/").pop() || path;

const RowEditor = memo(({
  row,
  catalog,
  dispatch,
  fields,
  disabled = false,
}: {
  row: AbilityRowView;
  catalog: AbilityCatalog;
  dispatch: (action: AbilityEditAction) => void;
  fields?: string[];
  disabled?: boolean;
}) => {
  const schema = catalog.tableSchemas[row.table];
  const schemaFields = new Map(schema?.fields.map((field) => [field.name, field]) ?? []);
  const names = (fields ?? schema?.fields.map((field) => field.name) ?? Object.keys(row.values)).filter(
    (name) => name in row.values || schemaFields.has(name),
  );

  const stage = (column: string, value: string) => {
    dispatch({
      type: "upsertRows",
      rows: [{ table: row.table, values: { ...row.values, [column]: value }, origin: "override" }],
    });
  };

  return (
    <div className="rounded border border-gray-700 bg-gray-900/40">
      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2 text-xs text-gray-400">
        <span>{row.table}</span>
        <span title={row.sourcePackPath}>{row.sourceKind === "pending" ? "Pending edit" : row.sourcePackName || row.sourceKind || ""}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2 2xl:grid-cols-3">
        {names.map((name) => {
          const field = schemaFields.get(name);
          const current = row.values[name] ?? field?.default_value ?? "";
          const readOnly = disabled || Boolean(field?.is_key);
          const isBool = field?.field_type?.toLowerCase() === "boolean";
          const options =
            row.table === "unit_abilities_tables" && name === "source_type"
              ? catalog.sourceTypes
              : row.table === "unit_abilities_tables" && name === "type"
                ? catalog.mechanicalTypes
                : undefined;
          return (
            <label key={name} className="min-w-0 text-xs text-gray-300" title={field?.description || ""}>
              <span className="mb-1 block truncate text-gray-500">{name}{field?.is_key ? " *" : ""}</span>
              {isBool ? (
                <span className="flex h-8 items-center gap-2 rounded border border-gray-700 bg-gray-800 px-2">
                  <input
                    type="checkbox"
                    checked={current === "true" || current === "1"}
                    disabled={readOnly}
                    onChange={(event) => stage(name, event.target.checked ? "true" : "false")}
                  />
                  <span>{current === "true" || current === "1" ? "true" : "false"}</span>
                </span>
              ) : options ? (
                <select
                  value={current}
                  disabled={readOnly}
                  onChange={(event) => stage(name, event.target.value)}
                  className="h-8 w-full rounded border border-gray-700 bg-gray-800 px-2 text-gray-100 disabled:text-gray-500"
                >
                  {!options.some((option) => option.key === current) && <option value={current}>{current || "(empty)"}</option>}
                  {options.map((option) => <option key={option.key} value={option.key}>{option.name || option.key}</option>)}
                </select>
              ) : (
                <input
                  value={current}
                  readOnly={readOnly}
                  onChange={(event) => stage(name, event.target.value)}
                  className="h-8 w-full rounded border border-gray-700 bg-gray-800 px-2 text-gray-100 read-only:text-gray-500"
                />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
});

const ReadOnlyRows = ({ title, rows }: { title: string; rows: AbilityRowView[] }) => (
  <section className="rounded border border-gray-700 bg-gray-900/30 p-3">
    <h3 className="mb-2 text-sm font-semibold text-gray-200">{title} <span className="text-gray-500">({rows.length})</span></h3>
    {!rows.length ? <div className="text-xs text-gray-500">None</div> : (
      <div className="space-y-1 text-xs text-gray-300">
        {rows.map((row, index) => (
          <div key={`${row.table}:${index}`} className="break-all rounded bg-black/20 px-2 py-1">
            {Object.entries(row.values).filter(([, value]) => value !== "").map(([key, value]) => `${key}=${value}`).join(" · ")}
          </div>
        ))}
      </div>
    )}
  </section>
);

const AbilitiesTab = memo(({ isActive = true }: { isActive?: boolean }) => {
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const [edits, dispatch] = useReducer(abilityEditReducer, undefined, emptyAbilityEditState);
  const [catalog, setCatalog] = useState<AbilityCatalog>();
  const [detail, setDetail] = useState<AbilityDetail>();
  const [selectedKey, setSelectedKey] = useState("");
  const [filter, setFilter] = useState("");
  const [modFilter, setModFilter] = useState("__all__");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneKey, setCloneKey] = useState("");
  const [cloneName, setCloneName] = useState("");
  const catalogRequestSeq = useRef(0);
  const detailRequestSeq = useRef(0);

  useEffect(() => {
    if (!isActive) return;
    const seq = ++catalogRequestSeq.current;
    setLoading(true);
    window.api?.getAbilitiesCatalog(enabledMods, edits).then((response) => {
      if (seq !== catalogRequestSeq.current) return;
      if (!response?.success || !response.catalog) {
        setError(response?.error || "Could not load abilities.");
        return;
      }
      setError("");
      setCatalog(response.catalog);
      setSelectedKey((current) =>
        current && response.catalog!.entries.some((entry) => entry.key === current)
          ? current
          : response.catalog!.entries[0]?.key || "",
      );
    }).finally(() => {
      if (seq === catalogRequestSeq.current) setLoading(false);
    });
  }, [edits, enabledMods, isActive]);

  useEffect(() => {
    if (!isActive || !selectedKey) {
      if (!selectedKey) setDetail(undefined);
      return;
    }
    const seq = ++detailRequestSeq.current;
    window.api?.getAbilityDetail(enabledMods, selectedKey, edits).then((response) => {
      if (seq !== detailRequestSeq.current) return;
      if (!response?.success || !response.detail) {
        setError(response?.error || "Could not load ability.");
        return;
      }
      setError("");
      setDetail(response.detail);
    });
  }, [edits, enabledMods, isActive, selectedKey]);

  const visibleEntries = useMemo(() => {
    if (!catalog) return [];
    const q = filter.trim().toLocaleLowerCase();
    return catalog.entries.filter((entry) => {
      if (q && !entry.searchText.includes(q)) return false;
      if (modFilter === "__vanilla__") return entry.contributingModPaths.length === 0;
      if (modFilter === "__modded__") return entry.contributingModPaths.length > 0;
      if (modFilter !== "__all__") return entry.contributingModPaths.includes(modFilter);
      return true;
    });
  }, [catalog, filter, modFilter]);

  const groups = useMemo(() => {
    const result: Array<{ label: string; entries: AbilityCatalogEntry[] }> = [];
    for (const entry of visibleEntries) {
      const label = sourceLabel(entry);
      let group = result.find((candidate) => candidate.label === label);
      if (!group) {
        group = { label, entries: [] };
        result.push(group);
      }
      group.entries.push(entry);
    }
    return result;
  }, [visibleEntries]);

  const modOptions = useMemo(
    () => enabledMods.map((mod) => ({ path: mod.path, name: mod.name || basename(mod.path) })),
    [enabledMods],
  );

  const beginClone = () => {
    if (!detail) return;
    setCloneKey(`${detail.key}_copy`);
    setCloneName(`${detail.name} Copy`);
    setCloneOpen(true);
  };

  const cloneSelected = () => {
    if (!detail || !cloneKey.trim()) return;
    dispatch({ type: "addRows", rows: cloneAbilityRows(detail, cloneKey, cloneName) });
    setSelectedKey(cloneKey.trim());
    setCloneOpen(false);
  };

  const copySharedPhase = (phase: AbilityPhaseDetail, index: number) => {
    if (!phase.phase) return;
    const used = new Set(detail?.phases.map((item) => item.phase?.values.id || item.junction.values.phase).filter(Boolean));
    let phaseId = `${detail!.key}_phase_${index + 1}`;
    while (used.has(phaseId)) phaseId += "_copy";
    const phaseValues = { ...phase.phase.values, id: phaseId };
    const junctionValues = { ...phase.junction.values, phase: phaseId };
    const rows = [
      { table: phase.phase.table, values: phaseValues, origin: "override" as const },
      { table: phase.junction.table, values: junctionValues, origin: "override" as const },
      ...phase.statEffects.map((effect) => ({
        table: effect.table,
        values: { ...effect.values, phase: phaseId },
        origin: "override" as const,
      })),
    ];
    dispatch({ type: "upsertRows", rows });
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-8 flex overflow-hidden bg-gray-950 text-gray-100">
      <aside className="flex w-[22rem] min-w-[18rem] flex-col border-r border-gray-700 bg-gray-900">
        <div className="space-y-2 border-b border-gray-700 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Abilities</h2>
            <span className="text-xs text-gray-500">{visibleEntries.length}/{catalog?.entries.length ?? 0}</span>
          </div>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter name, key, description, type, lore..."
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm"
          />
          <select
            value={modFilter}
            onChange={(event) => setModFilter(event.target.value)}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm"
          >
            <option value="__all__">All sources</option>
            <option value="__vanilla__">Vanilla only</option>
            <option value="__modded__">Any modded ability</option>
            {modOptions.map((option) => <option key={option.path} value={option.path}>{option.name}</option>)}
          </select>
          {isFeaturesForModdersEnabled && (
            <div className="flex gap-2">
              <button type="button" disabled={!detail} onClick={beginClone} className="flex-1 rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600 disabled:opacity-40">Clone selected</button>
              <button type="button" disabled={!edits.order.length} onClick={() => setSaveOpen(true)} className="flex-1 rounded bg-blue-700 px-2 py-1 text-xs hover:bg-blue-600 disabled:opacity-40">Save {edits.order.length || ""} rows</button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !catalog && <div className="p-3 text-sm text-gray-400">Loading abilities...</div>}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 z-10 border-y border-gray-800 bg-gray-900/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.label} · {group.entries.length}</div>
              {group.entries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setSelectedKey(entry.key)}
                  className={`block w-full border-b border-gray-800 px-3 py-2 text-left hover:bg-gray-800 ${entry.key === selectedKey ? "bg-gray-800" : ""}`}
                >
                  <div className="truncate text-sm font-medium">{entry.name}</div>
                  <div className="mt-0.5 flex gap-1 overflow-hidden text-[11px] text-gray-500">
                    <span className="truncate">{entry.key}</span>
                    {entry.typeName && <span className="shrink-0 rounded bg-gray-700 px-1 text-gray-300">{entry.typeName}</span>}
                    {entry.hasPendingEdits && <span className="shrink-0 text-amber-400">edited</span>}
                    {!entry.hasSpecialAbility && <span className="shrink-0 text-red-400">no mechanics row</span>}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-gray-700 bg-gray-900 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{detail?.name || "Select an ability"}</h1>
              {detail && <div className="mt-1 break-all text-xs text-gray-500">{detail.key}</div>}
            </div>
            {loading && <span className="text-xs text-gray-500">Refreshing...</span>}
          </div>
          {error && <div className="mt-2 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
        </div>

        <div className="flex border-b border-gray-700 bg-gray-900/80 px-3">
          {detailTabs.map((tab) => (
            <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`border-b-2 px-3 py-2 text-xs ${activeTab === tab.key ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
              {tab.label}{tab.key === "newRows" && edits.order.length ? ` (${edits.order.length})` : ""}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!detail ? <div className="text-sm text-gray-500">Choose an ability from the sidebar.</div> : activeTab === "newRows" ? (
            <div className="h-full min-h-[30rem]">
              <AbilitiesTablesTab state={edits} dispatch={dispatch} tableSchemas={catalog?.tableSchemas ?? {}} />
            </div>
          ) : !catalog ? null : (
            <div className="mx-auto max-w-[95rem] space-y-4">
              {activeTab === "overview" && (
                <>
                  {detail.tooltip && <div className="max-w-xl"><AbilityTooltipCard ability={detail.tooltip} icons={detail.icons} /></div>}
                  <RowEditor row={detail.overviewRow} catalog={catalog} dispatch={dispatch} fields={[
                    "key", "requires_effect_enabling", "icon_name", "source_type", "type", "overpower_option",
                    "superseded_abilities_set", "is_unit_upgrade", "is_hidden_in_ui", "is_hidden_in_ui_for_enemy", "uniqueness", "video",
                  ]} disabled={!isFeaturesForModdersEnabled} />
                  {!detail.specialAbilityRow && <div className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-300">This unit_abilities row has no matching unit_special_abilities row. It is still shown intentionally.</div>}
                </>
              )}

              {activeTab === "mechanics" && (
                detail.specialAbilityRow
                  ? <RowEditor row={detail.specialAbilityRow} catalog={catalog} dispatch={dispatch} fields={curatedMechanics} disabled={!isFeaturesForModdersEnabled} />
                  : <div className="text-sm text-gray-500">No mechanics row.</div>
              )}

              {activeTab === "phases" && (
                <div className="space-y-4">
                  {!detail.phases.length && <div className="text-sm text-gray-500">No phases.</div>}
                  {detail.phases.map((phase, index) => {
                    const shared = phase.phaseReferenceCount > 1;
                    return <section key={`${phase.junction.values.order}:${phase.junction.values.phase}`} className="space-y-2 rounded border border-gray-700 p-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Phase {index + 1} · {phase.junction.values.phase}</h3>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>used by {phase.phaseReferenceCount} ability links</span>
                          {isFeaturesForModdersEnabled && shared && phase.phase && <button type="button" onClick={() => copySharedPhase(phase, index)} className="rounded bg-blue-800 px-2 py-1 text-white hover:bg-blue-700">Copy for this ability</button>}
                        </div>
                      </div>
                      <RowEditor row={phase.junction} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled} />
                      {phase.phase && <RowEditor row={phase.phase} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled || shared} />}
                      {phase.statEffects.map((effect, effectIndex) => <RowEditor key={effectIndex} row={effect} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled || shared} />)}
                    </section>;
                  })}
                </div>
              )}

              {activeTab === "payload" && (
                <div className="space-y-4">
                  {!detail.payloadRoots.length && <div className="text-sm text-gray-500">No projectile, bombardment, or vortex payload.</div>}
                  {detail.payloadRoots.map((root, index) => {
                    const shared = root.parts.some((part) => part.referenceCount > 1);
                    return <section key={`${root.kind}:${index}`} className="space-y-2 rounded border border-gray-700 p-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold capitalize">{root.kind}</h3>
                        {isFeaturesForModdersEnabled && shared && <button type="button" onClick={() => dispatch({ type: "upsertRows", rows: copyAbilityPayloadRows(detail, root) })} className="rounded bg-blue-800 px-2 py-1 text-xs hover:bg-blue-700">Copy for this ability</button>}
                      </div>
                      {root.parts.map((part, partIndex) => <div key={`${part.kind}:${partIndex}`} className="space-y-1">
                        <div className="text-xs text-gray-500">{part.kind} · referenced {part.referenceCount} time(s)</div>
                        <RowEditor row={part.row} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled || shared} />
                      </div>)}
                    </section>;
                  })}
                </div>
              )}

              {activeTab === "conditions" && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <ReadOnlyRows title="Invalid target flags" rows={detail.conditions.invalidTargets} />
                  <ReadOnlyRows title="Invalid usage flags" rows={detail.conditions.invalidUsage} />
                  <ReadOnlyRows title="Auto deactivate flags" rows={detail.conditions.autoDeactivate} />
                  {detail.conditions.intensity ? <RowEditor row={detail.conditions.intensity} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled} /> : <ReadOnlyRows title="Intensity" rows={[]} />}
                </div>
              )}

              {activeTab === "usedBy" && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <ReadOnlyRows title="Land units" rows={detail.usedBy.landUnits} />
                  <ReadOnlyRows title="Army abilities" rows={detail.usedBy.armyAbilities} />
                  <ReadOnlyRows title="Effects / skills that enable it" rows={detail.usedBy.enablingEffects} />
                  <ReadOnlyRows title="Ability groups / lores" rows={detail.usedBy.groups} />
                  <ReadOnlyRows title="Superseded abilities" rows={detail.usedBy.supersededAbilities} />
                </div>
              )}

              {activeTab === "advanced" && (
                <div className="space-y-4">
                  <RowEditor row={detail.overviewRow} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled} />
                  {detail.specialAbilityRow && <RowEditor row={detail.specialAbilityRow} catalog={catalog} dispatch={dispatch} disabled={!isFeaturesForModdersEnabled} />}
                  {Object.entries(detail.relatedRows).map(([table, rows]) => <ReadOnlyRows key={table} title={table} rows={rows} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {cloneOpen && detail && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60">
          <div className="w-[32rem] rounded border border-gray-700 bg-gray-900 p-4 shadow-xl">
            <h2 className="text-lg font-semibold">Clone ability</h2>
            <p className="mt-1 text-xs text-gray-400">Core rows and phases are copied. Unit, army and effect assignments are intentionally not copied. Shared payload objects stay shared until you copy them from the Payload tab.</p>
            <label className="mt-4 block text-xs text-gray-400">New key<input value={cloneKey} onChange={(event) => setCloneKey(event.target.value)} className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-gray-100" /></label>
            <label className="mt-3 block text-xs text-gray-400">Name<input value={cloneName} onChange={(event) => setCloneName(event.target.value)} className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-gray-100" /></label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setCloneOpen(false)} className="rounded bg-gray-700 px-3 py-1.5 text-sm">Cancel</button>
              <button type="button" disabled={!cloneKey.trim()} onClick={cloneSelected} className="rounded bg-blue-700 px-3 py-1.5 text-sm disabled:opacity-40">Clone</button>
            </div>
          </div>
        </div>
      )}

      {saveOpen && catalog && (
        <AbilitiesSaveModal
          state={edits}
          tableSchemas={catalog.tableSchemas}
          moddersPrefix={catalog.moddersPrefix}
          onClose={() => setSaveOpen(false)}
          onSaved={() => {
            dispatch({ type: "reset" });
            setSaveOpen(false);
          }}
        />
      )}
    </div>
  );
});

export default AbilitiesTab;
