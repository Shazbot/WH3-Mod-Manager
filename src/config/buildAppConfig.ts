import appData from "../appData";
import { vanillaPackNames } from "../supportedGames";
import { sanitizeRecentPackPaths } from "../utility/recentPackPaths";
import { emptyGameConfig } from "./migrateAppConfig";

/**
 * Merges what the renderer sent into the stored config. Only the selected game's slot is touched;
 * the other games keep whatever main already had for them.
 */
export function buildAppConfig(payload: ConfigSavePayload): AppConfig {
  const { config, currentGame } = payload;
  // The load order rules belong to the game, not to the app, so they are pulled out of the flat
  // renderer payload here and written into the game slot alongside the presets.
  const {
    currentPreset,
    presets,
    modUserData,
    loadOrderRules,
    disabledModLoadOrderRules,
    loadOrderRuleDisabledPacks,
    recentPackPaths: payloadRecentPackPaths,
    ...options
  } = config;

  const games = { ...appData.gameToConfig };

  // main owns which game is selected. If the renderer is still on the previous game (it can lag a
  // game switch by a debounce or two) its presets belong to that game, not to the one we're on now —
  // writing them into the wrong slot is what used to copy whole preset lists between games.
  if (currentGame === appData.currentGame) {
    games[currentGame] = {
      currentPreset,
      presets,
      modUserData,
      loadOrderRules,
      disabledModLoadOrderRules,
      loadOrderRuleDisabledPacks,
    };
  } else {
    console.log("skipping preset write: renderer is on", currentGame, "but the current game is", appData.currentGame);
  }

  for (const game of Object.keys(games) as (keyof typeof games)[]) {
    games[game] = games[game] ?? emptyGameConfig();
  }

  return {
    ...options,
    // The main process can receive a viewer-open event just before a debounced renderer payload.
    // Keep that newer history entry when folding the payload into the disk config.
    recentPackPaths: sanitizeRecentPackPaths(
      [...(appData.recentPackPaths ?? []), ...(payloadRecentPackPaths ?? [])],
      [...vanillaPackNames, ...(appData.allVanillaPackNames ?? [])],
    ),
    games,
    gameFolderPaths: appData.gamesToGameFolderPaths,
  };
}

/** Updates the in-memory source used by game switches after write guards have accepted a payload. */
export function cacheAcceptedGameConfig(payload: ConfigSavePayload, config: AppConfig) {
  if (payload.currentGame !== appData.currentGame) return;
  appData.gameToConfig[payload.currentGame] = config.games[payload.currentGame];
}
