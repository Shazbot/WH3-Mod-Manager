import type { PayloadAction } from "@reduxjs/toolkit";
import appReducer, { disableAllMods, selectPreset, setAreModsEnabled, setLeadingModLoadOrder } from "../appSlice";
import { getEnabledMods, isModAlwaysEnabled } from "../modsHelpers";
import { sortByNameAndLoadOrder } from "../modSortingHelpers";
import type { AppControlErrorCode, AppControlLaunchOptions, AppControlModSelection } from "./protocol";

/** Mod selection for the control pipe, kept free of the store so it can be tested on plain state. */
export class ControlError extends Error {
  constructor(
    readonly code: AppControlErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const normalized = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\.pack$/, "");

const asStringList = (value: unknown, field: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === ""))
    throw new ControlError("INVALID_ARGUMENT", `${field} must be a list of mod names`);
  return value as string[];
};

/** Matches pack name (with or without .pack), then Workshop ID, then display name. */
export const resolveMods = (mods: Mod[], identifiers: string[]) => {
  const found: Mod[] = [];
  const missing: string[] = [];
  const ambiguous: { identifier: string; matches: string[] }[] = [];
  for (const identifier of identifiers) {
    const key = normalized(identifier);
    let matches = mods.filter((mod) => normalized(mod.name) === key);
    if (matches.length === 0) matches = mods.filter((mod) => mod.workshopId && mod.workshopId === identifier.trim());
    if (matches.length === 0)
      matches = mods.filter(
        (mod) => mod.humanName && mod.humanName.trim().toLowerCase() === identifier.trim().toLowerCase(),
      );
    if (matches.length === 1) found.push(matches[0]);
    else if (matches.length === 0) missing.push(identifier);
    else ambiguous.push({ identifier, matches: matches.map((mod) => mod.name) });
  }
  if (missing.length > 0 || ambiguous.length > 0) {
    const parts = [
      ...(missing.length ? [`not found: ${missing.join(", ")}`] : []),
      ...ambiguous.map(({ identifier, matches }) => `'${identifier}' matches ${matches.join(", ")}`),
    ];
    throw new ControlError("VALIDATION", `Could not match every mod (${parts.join("; ")})`, { missing, ambiguous });
  }
  return found;
};

/** Enabled mod names in the order the game loads them (manual positions, then name and load order rules). */
export const enabledNames = (appState: AppState) =>
  sortByNameAndLoadOrder(
    getEnabledMods(appState.currentPreset.mods, appState.alwaysEnabledModNames, appState.canDisableAlwaysEnabledMods),
  ).map((mod) => mod.name);

/** Builds the actions for a selection and the state they produce, without touching the store. */
export const planSelection = (appState: AppState, params: AppControlModSelection) => {
  const only = asStringList(params.only, "only");
  const enable = asStringList(params.enable, "enable") ?? [];
  const disable = asStringList(params.disable, "disable") ?? [];
  const order = asStringList(params.order, "order");
  const actions: PayloadAction<unknown>[] = [];
  if (params.preset !== undefined) {
    if (typeof params.preset !== "string" || !appState.presets.some((preset) => preset.name === params.preset))
      throw new ControlError("VALIDATION", `Unknown preset: ${String(params.preset)}`, {
        presets: appState.presets.map((preset) => preset.name),
      });
    actions.push(selectPreset([params.preset, "unary"]) as PayloadAction<unknown>);
  }
  const mods = appState.currentPreset.mods;
  const orderMods = resolveMods(mods, order ?? []);
  const repeated = orderMods.filter((mod, index) => orderMods.indexOf(mod) !== index);
  if (repeated.length > 0)
    throw new ControlError(
      "INVALID_ARGUMENT",
      `Mods listed more than once in order: ${[...new Set(repeated.map((mod) => mod.name))].join(", ")}`,
    );
  // Ordering a mod enables it.
  const enableMods = [...new Set([...resolveMods(mods, [...(only ?? []), ...enable]), ...orderMods])];
  const disableMods = resolveMods(mods, disable);
  const clash = disableMods.filter((mod) => enableMods.includes(mod));
  if (clash.length > 0)
    throw new ControlError(
      "INVALID_ARGUMENT",
      `Mods both enabled and disabled: ${clash.map((mod) => mod.name).join(", ")}`,
    );
  if (only) actions.push(disableAllMods() as PayloadAction<unknown>);
  const changes = [
    ...enableMods.map((mod) => ({ mod, isEnabled: true })),
    ...disableMods.map((mod) => ({ mod, isEnabled: false })),
  ];
  if (changes.length > 0) actions.push(setAreModsEnabled(changes) as PayloadAction<unknown>);
  if (order) actions.push(setLeadingModLoadOrder(orderMods.map((mod) => mod.name)) as PayloadAction<unknown>);

  const nextState = actions.reduce((state, action) => appReducer(state, action), appState);
  const beforeOrder = enabledNames(appState);
  const before = new Set(beforeOrder);
  const after = enabledNames(nextState);
  const afterSet = new Set(after);
  const warnings = disableMods
    .filter((mod) => afterSet.has(mod.name) && isModAlwaysEnabled(mod, appState.alwaysEnabledModNames))
    .map((mod) => `${mod.name} is always enabled, so it stays enabled.`);
  return {
    actions,
    nextState,
    warnings,
    changed: {
      enabled: after.filter((name) => !before.has(name)),
      disabled: [...before].filter((name) => !afterSet.has(name)),
      loadOrder:
        after.filter((name) => before.has(name)).join("\n") !==
        beforeOrder.filter((name) => afterSet.has(name)).join("\n"),
    },
    enabledMods: after,
  };
};

const autoStartOptions = (appState: AppState, overrides: AppControlLaunchOptions) => {
  // Both auto-start scripts drive the main menu, so turning one on for a launch turns the other off.
  if (overrides.autoStartNewCampaign)
    return { isAutoStartCustomBattleEnabled: false, isAutoStartNewCampaignEnabled: true };
  if (overrides.autoStartCustomBattle)
    return { isAutoStartCustomBattleEnabled: true, isAutoStartNewCampaignEnabled: false };
  return {
    isAutoStartCustomBattleEnabled: overrides.autoStartCustomBattle ?? appState.isAutoStartCustomBattleEnabled,
    isAutoStartNewCampaignEnabled: overrides.autoStartNewCampaign ?? appState.isAutoStartNewCampaignEnabled,
  };
};

export const startGameOptions = (appState: AppState, overrides: AppControlLaunchOptions = {}): StartGameOptions => ({
  isMakeUnitsGeneralsEnabled: overrides.makeUnitsGenerals ?? appState.isMakeUnitsGeneralsEnabled,
  isSkipIntroMoviesEnabled: overrides.skipIntroMovies ?? appState.isSkipIntroMoviesEnabled,
  isScriptLoggingEnabled: overrides.scriptLogging ?? appState.isScriptLoggingEnabled,
  ...autoStartOptions(appState, overrides),
  isClosedOnPlay: overrides.closeAppOnPlay ?? appState.isClosedOnPlay,
  workshopModStagingMode: appState.workshopModStagingMode,
  compressWorkshopModsOnStart: appState.compressWorkshopModsOnStart,
  optimizeWorkshopModsOnStart: appState.optimizeWorkshopModsOnStart,
  workshopOptimizerOptions: appState.workshopOptimizerOptions,
  isRigidModelV2CompressionEnabled: appState.isRigidModelV2CompressionEnabled,
  cleanUpWorkshopModStagingAfterGameExit: appState.cleanUpWorkshopModStagingAfterGameExit,
  packDataOverwrites: appState.packDataOverwrites,
  userFlowOptions: appState.userFlowOptions,
});
