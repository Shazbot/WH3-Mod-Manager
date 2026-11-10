/**
 * Wire format for the local control pipe between the running WHMM app and the CLI/MCP.
 * One JSON object per line in each direction. See docs/HEADLESS.md ("Control the running app").
 * Types and constants only, with no imports: the main window bundle, main and the headless tools
 * all share it. The pipe path lives in endpoint.ts because it needs Node's os/path.
 */
export const APP_CONTROL_PROTOCOL_VERSION = 1;

/** Written by packaged apps into their user data folder (%APPDATA%/wh3mm on Windows) so the CLI can start them. */
export const APP_CONTROL_INFO_FILE_NAME = "app-control.json";

export type AppControlMethod = "status" | "listMods" | "setMods" | "launch" | "stopGame";

/** Which mods to enable. Identifiers match a pack name (with or without .pack), Workshop ID, or unique display name. */
export interface AppControlModSelection {
  preset?: string;
  /** Enable exactly these mods (plus always-enabled mods) and disable the rest. Applied after `preset`. */
  only?: string[];
  enable?: string[];
  disable?: string[];
  /**
   * Enable these mods and load them first, in this order. Clears every other manual load order
   * position, so the remaining enabled mods follow in the automatic order. Applied last.
   */
  order?: string[];
}

export interface AppControlLaunchOptions {
  skipIntroMovies?: boolean;
  scriptLogging?: boolean;
  autoStartCustomBattle?: boolean;
  autoStartNewCampaign?: boolean;
  makeUnitsGenerals?: boolean;
  closeAppOnPlay?: boolean;
}

export interface AppControlSetModsParams extends AppControlModSelection {
  dryRun?: boolean;
}

export interface AppControlLaunchParams extends AppControlModSelection {
  /** Launch with the selection without saving it to the mod list. */
  temporary?: boolean;
  /** Load the most recent save. */
  continueLastSave?: boolean;
  /** Load this save file name. */
  save?: string;
  options?: AppControlLaunchOptions;
  /** Refuse to launch when the app is set to another game. */
  game?: string;
  /** Stop a running game first instead of refusing; validates the request before stopping it. */
  restart?: boolean;
  /** Seconds to wait for a stopped game to exit (restart only). */
  stopTimeoutSeconds?: number;
  /** Internal: check the request without launching. Main sends it before stopping a running game. */
  validateOnly?: boolean;
}

export interface AppControlStopParams {
  /** Seconds to wait for the game to exit after killing it. */
  timeoutSeconds?: number;
}

export interface AppControlStopResult {
  game: string;
  /** False when the game was not running, so nothing was stopped. */
  wasRunning: boolean;
}

export interface AppControlRequest {
  v: number;
  id: string;
  method: AppControlMethod;
  params?: unknown;
}

/** NOT_READY means the app is still starting; clients retry until their start timeout. */
export type AppControlErrorCode =
  | "NOT_READY"
  | "DISABLED"
  | "INVALID_ARGUMENT"
  | "CONFLICT"
  | "VALIDATION"
  | "LAUNCH_FAILED"
  | "STOP_FAILED"
  | "INTERNAL";

export type AppControlResponse =
  | { v: number; id: string; ok: true; result: unknown }
  | { v: number; id: string; ok: false; error: { code: AppControlErrorCode; message: string; details?: unknown } };

export interface AppControlModSummary {
  name: string;
  humanName: string;
  workshopId: string;
  isEnabled: boolean;
  /** Zero-based position in the game's load order; enabled mods only. */
  loadOrder?: number;
  /** The mod has a manual load order position rather than the automatic one. */
  hasManualLoadOrder: boolean;
  source?: string;
  isAlwaysEnabled: boolean;
}

export interface AppControlModsResult {
  game: string;
  enabledCount: number;
  /** Enabled mods in load order. */
  enabledMods: string[];
  mods: AppControlModSummary[];
  presets: string[];
}

export interface AppControlSelectionResult {
  game: string;
  dryRun: boolean;
  /** `loadOrder` is true when mods enabled before and after load in a different relative order. */
  changed: { enabled: string[]; disabled: string[]; loadOrder: boolean };
  /** Enabled mods in load order. */
  enabledMods: string[];
}

export interface AppControlLaunchResult {
  game: string;
  temporary: boolean;
  enabledMods: string[];
  save?: string;
  started: boolean;
  /** A running game was stopped before this launch. */
  restarted?: boolean;
}

export interface AppControlStatus {
  appVersion: string;
  ready: boolean;
  controlEnabled: boolean;
  game: string;
  isGameRunning: boolean;
  launchInProgress: boolean;
  enabledModCount: number;
}
