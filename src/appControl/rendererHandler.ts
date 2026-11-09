import store from "../store";
import { createOnGameStartPreset } from "../appSlice";
import { isModAlwaysEnabled } from "../modsHelpers";
import { ControlError, enabledNames, planSelection, startGameOptions } from "./modSelection";
import {
  APP_CONTROL_PROTOCOL_VERSION,
  type AppControlLaunchParams,
  type AppControlLaunchResult,
  type AppControlModsResult,
  type AppControlRequest,
  type AppControlSelectionResult,
  type AppControlSetModsParams,
} from "./protocol";

/**
 * Main-window side of the CLI/MCP control pipe. Mod changes go through the same reducers as the
 * UI, and launches call `startGame` with the same arguments as the Play button.
 */
const listMods = (): AppControlModsResult => {
  const appState = store.getState().app;
  const enabledMods = enabledNames(appState);
  const positions = new Map(enabledMods.map((name, index) => [name, index]));
  // Enabled mods first, in load order, then the disabled ones.
  const mods = [...appState.currentPreset.mods].sort(
    (first, second) =>
      (positions.get(first.name) ?? Number.MAX_SAFE_INTEGER) - (positions.get(second.name) ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    game: appState.currentGame,
    enabledCount: enabledMods.length,
    enabledMods,
    mods: mods.map((mod) => ({
      name: mod.name,
      humanName: mod.humanName,
      workshopId: mod.workshopId,
      isEnabled: positions.has(mod.name),
      ...(positions.has(mod.name) ? { loadOrder: positions.get(mod.name) } : {}),
      hasManualLoadOrder: mod.loadOrder != null,
      ...(mod.sourceKind ? { source: mod.sourceKind } : {}),
      isAlwaysEnabled: isModAlwaysEnabled(mod, appState.alwaysEnabledModNames),
    })),
    presets: appState.presets.map((preset) => preset.name),
  };
};

const setMods = (params: AppControlSetModsParams): AppControlSelectionResult & { warnings: string[] } => {
  const appState = store.getState().app;
  const plan = planSelection(appState, params);
  if (!params.dryRun) plan.actions.forEach((action) => store.dispatch(action));
  return {
    game: appState.currentGame,
    dryRun: Boolean(params.dryRun),
    changed: plan.changed,
    enabledMods: plan.enabledMods,
    warnings: plan.warnings,
  };
};

const launch = (params: AppControlLaunchParams): AppControlLaunchResult & { warnings: string[] } => {
  const appState = store.getState().app;
  if (params.game !== undefined && params.game !== appState.currentGame)
    throw new ControlError(
      "CONFLICT",
      `WHMM is set to ${appState.currentGame}, not ${String(params.game)}. Switch games in the app first.`,
    );
  // Main validates a restart before stopping the game, so the game is still running at that point.
  if (appState.isWH3Running && !params.validateOnly) throw new ControlError("CONFLICT", "The game is already running.");

  let saveName: string | undefined;
  if (params.save !== undefined) {
    if (!appState.saves.some((save) => save.name === params.save))
      throw new ControlError("VALIDATION", `Save not found: ${String(params.save)}`);
    saveName = params.save;
  } else if (params.continueLastSave) {
    const latest = [...appState.saves].sort((first, second) => second.lastChanged - first.lastChanged)[0];
    if (!latest) throw new ControlError("VALIDATION", "No saves found to continue.");
    saveName = latest.name;
  }

  const plan = planSelection(appState, params);
  if (params.validateOnly)
    return {
      game: appState.currentGame,
      temporary: Boolean(params.temporary),
      enabledMods: plan.enabledMods,
      ...(saveName ? { save: saveName } : {}),
      started: false,
      warnings: plan.warnings,
    };
  let launchState = plan.nextState;
  if (!params.temporary) {
    plan.actions.forEach((action) => store.dispatch(action));
    // Same as the Play button; Continue does not record this preset.
    if (!saveName) store.dispatch(createOnGameStartPreset());
    launchState = store.getState().app;
  }
  window.api?.startGame(
    launchState.currentPreset.mods,
    launchState.currentPreset.version != undefined,
    startGameOptions(launchState, params.options),
    saveName,
  );
  return {
    game: appState.currentGame,
    temporary: Boolean(params.temporary),
    enabledMods: plan.enabledMods,
    ...(saveName ? { save: saveName } : {}),
    started: false,
    warnings: plan.warnings,
  };
};

const handle = (request: AppControlRequest): unknown => {
  const params = (request.params ?? {}) as Record<string, unknown>;
  if (typeof params !== "object" || Array.isArray(params))
    throw new ControlError("INVALID_ARGUMENT", "params must be an object");
  switch (request.method) {
    case "listMods":
      return listMods();
    case "setMods":
      return setMods(params as AppControlSetModsParams);
    case "launch":
      return launch(params as AppControlLaunchParams);
    default:
      throw new ControlError("INVALID_ARGUMENT", `Unknown method: ${String(request.method)}`);
  }
};

let isRegistered = false;

/** Call once the mod list has been populated; reports ready to main after the config is read. */
export const registerAppControlHandler = () => {
  if (isRegistered) return;
  isRegistered = true;
  window.api?.onAppControlRequest((_event, request) => {
    try {
      const result = handle(request);
      window.api?.sendAppControlResponse({ v: APP_CONTROL_PROTOCOL_VERSION, id: request.id, ok: true, result });
    } catch (error) {
      const controlError =
        error instanceof ControlError
          ? error
          : new ControlError("INTERNAL", error instanceof Error ? error.message : String(error));
      window.api?.sendAppControlResponse({
        v: APP_CONTROL_PROTOCOL_VERSION,
        id: request.id,
        ok: false,
        error: {
          code: controlError.code,
          message: controlError.message,
          ...(controlError.details === undefined ? {} : { details: controlError.details }),
        },
      });
    }
  });
  const reportReadyWhenConfigRead = () => {
    if (!store.getState().app.hasConfigBeenRead) return false;
    window.api?.sendAppControlReady();
    return true;
  };
  if (reportReadyWhenConfigRead()) return;
  const unsubscribe = store.subscribe(() => {
    if (reportReadyWhenConfigRead()) unsubscribe();
  });
};
