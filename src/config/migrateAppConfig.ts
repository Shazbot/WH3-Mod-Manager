import { supportedGames, SupportedGames } from "../supportedGames";
import type { GameFolderPaths } from "../appData";
import { sortByNameAndLoadOrder } from "../modSortingHelpers";
import { toPresetEntries, toSnapshotEntries } from "./presetEntries";
import { SortingType } from "../utility/modRowSorting";

/**
 * The config file used to store a full Mod record for every mod in every preset, which made it grow
 * into the megabytes and let each copy drift from reality. Version 3 stores membership + order only.
 *
 * This module is the single place that understands the old shape. Once enough time has passed that
 * nobody is upgrading from a pre-v3 config it can be deleted along with the LegacyAppConfig types.
 */
export const CONFIG_VERSION = 3;

type LegacyMod = Partial<Mod> & { name: string };

type LegacyPreset = {
  name: string;
  mods?: LegacyMod[];
  version?: number;
};

/** Only the fields the migration reads; everything else is copied across untouched. */
type LegacyAppConfig = Partial<Omit<AppConfig, "games">> & {
  gameToCurrentPreset?: Partial<Record<SupportedGames, LegacyPreset | undefined>>;
  gameToPresets?: Partial<Record<SupportedGames, LegacyPreset[]>>;
  // wh3-only fields from before the app supported multiple games
  currentPreset?: LegacyPreset;
  presets?: LegacyPreset[];
  appFolderPaths?: GameFolderPaths;
  alwaysEnabledMods?: LegacyMod[];
  hiddenMods?: LegacyMod[];
};

const emptyGameFolderPaths = (): GameFolderPaths => ({
  gamePath: undefined,
  dataFolder: undefined,
  contentFolder: undefined,
  customModFolders: [],
  modSourceOrder: ["data", "workshop"],
});

export const emptyGameConfig = (): GameConfig => ({
  currentPreset: { name: "", mods: [], version: 2 },
  presets: [],
  modUserData: {},
});

const emptyGames = () =>
  Object.fromEntries(supportedGames.map((game) => [game, emptyGameConfig()])) as Record<SupportedGames, GameConfig>;

const emptyGameFolderPathsByGame = () =>
  Object.fromEntries(supportedGames.map((game) => [game, emptyGameFolderPaths()])) as Record<
    SupportedGames,
    GameFolderPaths
  >;

/**
 * A preset without a version predates load-order-as-array-order: its array order is meaningless and
 * the real order has to be recovered from the sparse loadOrder pins. Doing it here means every stored
 * preset is version 2 from now on, instead of each one being fixed up lazily if it ever became current.
 */
const legacyPresetToSavedPreset = (preset: LegacyPreset, isSnapshot: boolean): SavedPreset => {
  const mods = (preset.mods ?? []).filter((mod) => mod && mod.name != null) as Mod[];
  const orderedMods = preset.version == undefined ? sortByNameAndLoadOrder(mods) : mods;

  return {
    name: preset.name,
    mods: isSnapshot ? toSnapshotEntries(orderedMods) : toPresetEntries(orderedMods),
    version: 2,
  };
};

/** The two auto-generated presets snapshot the whole list, so their disabled mods have to survive. */
const isSnapshotPreset = (name: string) => name === "On App Start" || name === "On Last Game Launch";

const addModUserData = (modUserData: Record<string, StoredModUserData>, mods: LegacyMod[] | undefined) => {
  for (const mod of mods ?? []) {
    if (!mod || mod.name == null || modUserData[mod.name]) continue;

    const data: StoredModUserData = {};
    if (mod.categories && mod.categories.length > 0) data.categories = mod.categories;
    if (mod.humanName) data.humanName = mod.humanName;
    if (mod.author) data.author = mod.author;
    if (mod.reqModIdToName && mod.reqModIdToName.length > 0) data.reqModIdToName = mod.reqModIdToName;

    if (Object.keys(data).length > 0) modUserData[mod.name] = data;
  }
};

const migrateGame = (legacy: LegacyAppConfig, game: SupportedGames): GameConfig => {
  const legacyCurrentPreset = legacy.gameToCurrentPreset?.[game];
  const legacyPresets = legacy.gameToPresets?.[game] ?? [];

  const modUserData: Record<string, StoredModUserData> = {};
  // the current preset is the freshest copy of a mod's metadata, so it wins over preset snapshots
  addModUserData(modUserData, legacyCurrentPreset?.mods);
  for (const preset of legacyPresets) addModUserData(modUserData, preset.mods);

  return {
    currentPreset: legacyCurrentPreset
      ? legacyPresetToSavedPreset(legacyCurrentPreset, true)
      : emptyGameConfig().currentPreset,
    presets: legacyPresets
      .filter((preset) => preset && preset.name != null)
      .map((preset) => legacyPresetToSavedPreset(preset, isSnapshotPreset(preset.name))),
    modUserData,
  };
};

/** Folds the pre-multi-game wh3-only fields into the per-game containers. */
const foldDeprecatedWh3Fields = (legacy: LegacyAppConfig) => {
  if (legacy.currentPreset) {
    legacy.gameToCurrentPreset = { ...legacy.gameToCurrentPreset, wh3: legacy.currentPreset };
  }
  if (legacy.presets) {
    legacy.gameToPresets = { ...legacy.gameToPresets, wh3: legacy.presets };
  }
  if (legacy.appFolderPaths) {
    const gameFolderPaths = legacy.gameFolderPaths ?? emptyGameFolderPathsByGame();
    gameFolderPaths.wh3 = {
      ...emptyGameFolderPaths(),
      ...gameFolderPaths.wh3,
      gamePath: legacy.appFolderPaths.gamePath,
      contentFolder: legacy.appFolderPaths.contentFolder,
      dataFolder: legacy.appFolderPaths.dataFolder,
    };
    legacy.gameFolderPaths = gameFolderPaths;
  }
};

const withDefaults = (config: AppConfig): AppConfig => {
  const gameFolderPaths = config.gameFolderPaths ?? emptyGameFolderPathsByGame();
  const games = config.games ?? emptyGames();
  for (const game of supportedGames) {
    gameFolderPaths[game] = { ...emptyGameFolderPaths(), ...gameFolderPaths[game] };
    games[game] = { ...emptyGameConfig(), ...games[game] };
  }

  return {
    ...config,
    configVersion: CONFIG_VERSION,
    gameFolderPaths,
    games,
    alwaysEnabledModNames: config.alwaysEnabledModNames ?? [],
    hiddenModNames: config.hiddenModNames ?? [],
    categories: config.categories ?? [],
    categoryColors: config.categoryColors ?? {},
    packDataOverwrites: config.packDataOverwrites ?? {},
    userFlowOptions: config.userFlowOptions ?? {},
    nodeEditorFavorites: config.nodeEditorFavorites ?? [],
    hiddenMainWindowTabs: config.hiddenMainWindowTabs ?? [],
    moddersPrefix: config.moddersPrefix ?? "",
    modRowsSortingType: config.modRowsSortingType ?? SortingType.Ordered,
    currentGame: config.currentGame ?? "wh3",
  };
};

const uniqueNames = (mods: LegacyMod[] | undefined) => [
  ...new Set((mods ?? []).filter((mod) => mod && mod.name != null).map((mod) => mod.name)),
];

export function migrateAppConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== "object") throw new Error("App config is not an object");

  const legacy = { ...raw } as LegacyAppConfig;
  if (legacy.configVersion === CONFIG_VERSION) return withDefaults(legacy as AppConfig);

  console.log("migrating app config to version", CONFIG_VERSION);
  foldDeprecatedWh3Fields(legacy);

  const games = Object.fromEntries(supportedGames.map((game) => [game, migrateGame(legacy, game)])) as Record<
    SupportedGames,
    GameConfig
  >;

  const {
    gameToCurrentPreset: _gameToCurrentPreset,
    gameToPresets: _gameToPresets,
    currentPreset: _currentPreset,
    presets: _presets,
    appFolderPaths: _appFolderPaths,
    alwaysEnabledMods,
    hiddenMods,
    ...rest
  } = legacy;

  return withDefaults({
    ...rest,
    games,
    alwaysEnabledModNames: uniqueNames(alwaysEnabledMods),
    hiddenModNames: uniqueNames(hiddenMods),
  } as AppConfig);
}
