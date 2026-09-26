import React, { useContext, useMemo, useState } from "react";
import Select from "react-select";

import { useAppDispatch, useAppSelector } from "../../hooks";
import {
  addLoadOrderRule,
  removeLoadOrderRule,
  setLoadOrderRulePackDisabled,
  setModLoadOrderRuleDisabled,
} from "../../appSlice";
import localizationContext from "../../localizationContext";
import selectStyle from "../../styles/selectStyle";
import { buildLoadOrderEdges, loadOrderPackNameKey, loadOrderRuleKey } from "../../loadOrderRules";
import { getFilteredMods, getModSortName, sortByNameAndLoadOrder } from "../../modSortingHelpers";
import { findRulesOverriddenByPins } from "../../loadOrderRules";
import {
  buildModRuleSummaries,
  buildRuleStatusLookup,
  collectAllLoadOrderRules,
  getRuleViewsForMod,
  type LoadOrderRuleStatus,
  type LoadOrderRuleView,
} from "./loadOrderRuleViews";

const statusLabels: Record<LoadOrderRuleStatus, string> = {
  active: "",
  disabled: "off",
  mutedPack: "mod ignored",
  superseded: "replaced by your rule",
  cycle: "dropped, would loop",
  contradiction: "mods disagree",
  missingPack: "pack not installed",
};

const isInactive = (status: LoadOrderRuleStatus) => status !== "active";

const LoadOrderRulesTab = () => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const userRules = useAppSelector((state) => state.app.loadOrderRules);
  const modRules = useAppSelector((state) => state.app.modLoadOrderRules);
  const resolution = useAppSelector((state) => state.app.loadOrderRulesResolution);
  const mutedPacks = useAppSelector((state) => state.app.loadOrderRuleDisabledPacks);

  const [filter, setFilter] = useState("");
  const [selectedPackName, setSelectedPackName] = useState<string | undefined>();
  const [isEnabledOnly, setIsEnabledOnly] = useState(false);

  const allRules = useMemo(() => collectAllLoadOrderRules(userRules, modRules), [userRules, modRules]);
  const getStatus = useMemo(() => buildRuleStatusLookup(resolution, mutedPacks), [resolution, mutedPacks]);

  /**
   * A rule the finished order does not satisfy, because a manual pin sits between the two packs.
   * Pins win by design, so this is reported rather than corrected.
   */
  const pinOverriddenKeys = useMemo(() => {
    const edges = buildLoadOrderEdges(resolution.rules);
    const ordered = sortByNameAndLoadOrder(
      mods.filter((mod) => mod.isEnabled),
      edges,
    );
    return new Set(
      findRulesOverriddenByPins(
        ordered.map((mod) => mod.name),
        resolution.rules,
      ).map((conflict) => loadOrderRuleKey(conflict.rule)),
    );
  }, [mods, resolution.rules]);

  const summaries = useMemo(() => {
    const visibleMods = isEnabledOnly ? mods.filter((mod) => mod.isEnabled) : mods;
    const filtered = filter.trim() === "" ? visibleMods : getFilteredMods(visibleMods, filter.trim(), true);
    return buildModRuleSummaries(filtered, allRules, modRules, mutedPacks).sort((first, second) =>
      first.sortName.localeCompare(second.sortName),
    );
  }, [mods, filter, isEnabledOnly, allRules, modRules, mutedPacks]);

  const withRules = summaries.filter((summary) => summary.ruleCount > 0);
  const enabledWithoutRules = summaries.filter((summary) => summary.ruleCount === 0 && summary.mod.isEnabled);
  const disabledWithoutRules = summaries.filter((summary) => summary.ruleCount === 0 && !summary.mod.isEnabled);

  const selectedMod = useMemo(
    () =>
      selectedPackName
        ? mods.find((mod) => loadOrderPackNameKey(mod.name) === loadOrderPackNameKey(selectedPackName))
        : undefined,
    [mods, selectedPackName],
  );

  const ruleViews = useMemo(
    () => (selectedMod ? getRuleViewsForMod(selectedMod.name, allRules, getStatus) : { before: [], after: [] }),
    [selectedMod, allRules, getStatus],
  );

  const otherModOptions = useMemo(() => {
    if (!selectedMod) return [];
    const selectedKey = loadOrderPackNameKey(selectedMod.name);
    return mods
      .filter((mod) => loadOrderPackNameKey(mod.name) !== selectedKey)
      .map((mod) => ({ value: mod.name, label: `${getModSortName(mod)} (${mod.name})` }))
      .sort((first, second) => first.label.localeCompare(second.label));
  }, [mods, selectedMod]);

  const conflictCount = resolution.conflicts.filter((conflict) => conflict.kind !== "missingPack").length;

  const addRule = (otherPackName: string, isBefore: boolean) => {
    if (!selectedMod) return;
    // The mod whose panel this rule was added from is the one the rule positions.
    const subjectPackName = selectedMod.name;
    dispatch(
      addLoadOrderRule(
        isBefore
          ? { before: selectedMod.name, after: otherPackName, subjectPackName }
          : { before: otherPackName, after: selectedMod.name, subjectPackName },
      ),
    );
  };

  const renderRuleRow = (view: LoadOrderRuleView) => {
    const key = loadOrderRuleKey(view.rule);
    const isPinOverridden = view.status === "active" && pinOverriddenKeys.has(key);
    const statusLabel = statusLabels[view.status];
    // Which mod gives way is now what a rule decides, and two rules that read alike can behave
    // differently, so a rule that moves the other mod says so rather than leaving it invisible.
    const movesOtherMod =
      selectedMod != undefined &&
      loadOrderPackNameKey(view.rule.subjectPackName) !== loadOrderPackNameKey(selectedMod.name);

    return (
      <div
        key={key}
        className={`flex items-center gap-2 border-b border-gray-800 px-2 py-1.5 text-sm ${
          isInactive(view.status) ? "opacity-50" : ""
        }`}
      >
        {view.isFromPack && (
          <input
            type="checkbox"
            className="shrink-0"
            // A pack-wide mute is not undone by re-ticking one rule, so the box points at the toggle
            // that would actually help instead of pretending to work.
            checked={view.status !== "disabled" && view.status !== "mutedPack"}
            disabled={view.status === "mutedPack"}
            title={
              view.status === "mutedPack"
                ? localized.loadOrderRulesPackMutedHint || "This mod's rules are ignored. Turn that off first."
                : localized.loadOrderRulesToggleRule || "Apply this rule"
            }
            onChange={(event) =>
              dispatch(setModLoadOrderRuleDisabled({ rule: view.rule, isDisabled: !event.target.checked }))
            }
          />
        )}

        <span className={`min-w-0 flex-1 truncate ${isInactive(view.status) ? "line-through" : ""}`}>
          {view.otherPackName}
        </span>

        {view.isFromPack && (
          <span
            className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300"
            title={(localized.loadOrderRulesFromPack || "From {{pack}}").replace(
              "{{pack}}",
              view.rule.sourcePackName ?? "",
            )}
          >
            {view.rule.sourcePackName}
          </span>
        )}

        {statusLabel !== "" && <span className="shrink-0 text-xs text-amber-400">{statusLabel}</span>}
        {movesOtherMod && (
          <span
            className="shrink-0 text-xs text-gray-400"
            title={
              localized.loadOrderRulesMovesHint ||
              "This rule belongs to that mod, so it is the one that moves. Add the rule from this mod's side to move this one instead."
            }
          >
            {(localized.loadOrderRulesMoves || "moves {{pack}}").replace("{{pack}}", view.rule.subjectPackName)}
          </span>
        )}
        {isPinOverridden && (
          <span
            className="shrink-0 text-xs text-amber-400"
            title={
              localized.loadOrderRulesPinnedHint ||
              "A manual load order position puts these packs the other way round, and manual positions win."
            }
          >
            {localized.loadOrderRulesPinned || "overridden by a manual position"}
          </span>
        )}

        {view.isFromPack ? (
          <button
            type="button"
            className="shrink-0 rounded bg-gray-700 px-2 py-0.5 text-xs hover:bg-gray-600"
            title={
              localized.loadOrderRulesOverrideHint ||
              "Add your own rule for this pair, the other way round. Yours wins."
            }
            onClick={() => addRule(view.otherPackName, !view.isBefore)}
          >
            {localized.loadOrderRulesOverride || "Override"}
          </button>
        ) : (
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white"
            title={localized.loadOrderRulesRemove || "Remove this rule"}
            onClick={() => dispatch(removeLoadOrderRule(view.rule))}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  const renderRuleColumn = (title: string, hint: string, views: LoadOrderRuleView[], isBefore: boolean) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 shrink-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-xs text-gray-400">{hint}</div>
      </div>

      <div className="mb-2 shrink-0">
        <Select
          options={otherModOptions}
          value={null}
          styles={selectStyle}
          isDisabled={!selectedMod}
          placeholder={localized.loadOrderRulesAddPlaceholder || "Add a mod..."}
          onChange={(option) => option && addRule(option.value, isBefore)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-gray-700 bg-gray-900/40">
        {views.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">{localized.loadOrderRulesNoRules || "No rules yet."}</div>
        ) : (
          views.map(renderRuleRow)
        )}
      </div>
    </div>
  );

  const renderModRow = (summary: (typeof summaries)[number]) => {
    const isSelected = selectedMod && loadOrderPackNameKey(summary.mod.name) === loadOrderPackNameKey(selectedMod.name);

    return (
      <div
        key={summary.mod.name}
        id={`load-order-rules-mod-${summary.mod.name}`}
        onClick={() => setSelectedPackName(summary.mod.name)}
        className={`flex cursor-pointer items-center gap-2 border-b border-gray-800 px-2 py-1.5 text-sm hover:bg-gray-800 ${
          isSelected ? "bg-amber-900/40" : ""
        } ${summary.isMuted ? "opacity-60" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate" title={summary.mod.name}>
          {summary.sortName}
        </span>

        {summary.shipsRules && (
          <label
            className="flex shrink-0 items-center gap-1 text-xs text-gray-400"
            title={
              localized.loadOrderRulesIgnoreModHint ||
              "Ignore every rule this mod ships, including any it adds in a later update."
            }
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={summary.isMuted}
              onChange={(event) =>
                dispatch(setLoadOrderRulePackDisabled({ packName: summary.mod.name, isDisabled: event.target.checked }))
              }
            />
            {localized.loadOrderRulesIgnoreMod || "ignore"}
          </label>
        )}

        {summary.ruleCount > 0 && (
          <span className={`shrink-0 rounded bg-gray-700 px-1.5 text-xs ${summary.isMuted ? "line-through" : ""}`}>
            {summary.ruleCount}
          </span>
        )}
      </div>
    );
  };

  const renderModGroup = (title: string, group: typeof summaries) =>
    group.length === 0 ? null : (
      <div>
        <div className="sticky top-0 bg-gray-900 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {title} ({group.length})
        </div>
        {group.map(renderModRow)}
      </div>
    );

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col text-gray-100">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-700 bg-gray-900 px-4 py-2">
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={localized.searchMods || "Search mods..."}
          className="w-64 rounded bg-gray-700 px-3 py-1 text-sm text-white"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isEnabledOnly} onChange={(event) => setIsEnabledOnly(event.target.checked)} />
          {localized.loadOrderRulesEnabledOnly || "Enabled mods only"}
        </label>
        {conflictCount > 0 && (
          <span className="ml-auto rounded bg-amber-800 px-2 py-0.5 text-xs text-white">
            {(localized.loadOrderRulesConflictCount || "{{count}} rule(s) not in effect").replace(
              "{{count}}",
              String(conflictCount),
            )}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-gray-700 bg-gray-900">
          {summaries.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">{localized.loadOrderRulesNoMods || "No mods match."}</div>
          ) : (
            <>
              {renderModGroup(localized.loadOrderRulesWithRules || "With rules", withRules)}
              {renderModGroup(
                localized.loadOrderRulesEnabledWithoutRules || "Enabled without rules",
                enabledWithoutRules,
              )}
              {renderModGroup(
                localized.loadOrderRulesDisabledWithoutRules || "Disabled without rules",
                disabledWithoutRules,
              )}
            </>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-gray-950 p-4">
          {!selectedMod ? (
            <div className="text-sm text-gray-400">
              {localized.loadOrderRulesPickMod || "Pick a mod on the left to set up its rules."}
            </div>
          ) : (
            <>
              <div className="mb-3 shrink-0">
                <div className="text-lg font-semibold text-white">{getModSortName(selectedMod)}</div>
                <div className="text-xs text-gray-400">{selectedMod.name}</div>
              </div>

              <div className="flex min-h-0 flex-1 gap-4">
                {renderRuleColumn(
                  localized.loadOrderRulesLoadsBefore || "Loads before these mods",
                  localized.loadOrderRulesLoadsBeforeHint ||
                    "This mod appears higher in the visible mod list (with a lower load-order number), so it overrides those mods.",
                  ruleViews.before,
                  true,
                )}
                {renderRuleColumn(
                  localized.loadOrderRulesLoadsAfter || "Loads after these mods",
                  localized.loadOrderRulesLoadsAfterHint ||
                    "Those mods appear higher in the visible mod list (with lower load-order numbers), so they override this mod.",
                  ruleViews.after,
                  false,
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default LoadOrderRulesTab;
