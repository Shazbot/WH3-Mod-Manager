import deepClone from "clone-deep";
import { app } from "electron";
import * as fs from "fs";
import equal from "fast-deep-equal";
import { copy, move } from "fs-extra";
import appData from "./appData";
import * as nodePath from "path";
import { version } from "../package.json";

let writeConfigTimeout: NodeJS.Timeout;
let dataToWrite: AppStateToWrite | undefined;
let isWriting = false;

const appStateToConfigAppState = (appState: AppState): AppStateToWrite => {
  const gameToCurrentPreset = deepClone(appData.gameToCurrentPreset);
  gameToCurrentPreset[appState.currentGame] = appState.currentPreset;

  const gameToPresets = deepClone(appData.gameToPresets);
  gameToPresets[appState.currentGame] = appState.presets;

  const configAppState = {
    alwaysEnabledMods: appState.alwaysEnabledMods,
    hiddenMods: appState.hiddenMods,
    wasOnboardingEverRun: appState.wasOnboardingEverRun,
    isAuthorEnabled: appState.isAuthorEnabled,
    areThumbnailsEnabled: appState.areThumbnailsEnabled,
    isMakeUnitsGeneralsEnabled: appState.isMakeUnitsGeneralsEnabled,
    isSkipIntroMoviesEnabled: appState.isSkipIntroMoviesEnabled,
    isAutoStartCustomBattleEnabled: appState.isAutoStartCustomBattleEnabled,
    isScriptLoggingEnabled: appState.isScriptLoggingEnabled,
    isClosedOnPlay: appState.isClosedOnPlay,
    categories: appState.categories,
    modRowsSortingType: appState.modRowsSortingType,
    currentLanguage: appState.currentLanguage,
    currentGame: appState.currentGame,
    packDataOverwrites: appState.packDataOverwrites,
    // from appData
    gameFolderPaths: appData.gamesToGameFolderPaths,
    gameToCurrentPreset,
    gameToPresets,
  };

  return configAppState;
};

export function setStartingAppState(startingAppState: AppStateToWrite) {
  dataToWrite = deepClone(startingAppState);
}

export function writeAppConfig(data: AppState) {
  const toWrite: AppStateToWrite = appStateToConfigAppState(data);
  // we don't care about saving this since we want to fetch or calculate the real time state of these anyway
  toWrite.gameToCurrentPreset[toWrite.currentGame]?.mods.forEach((mod) => {
    mod.lastChanged = undefined;
    mod.reqModIdToName = [];
    mod.isDeleted = false;
  });

  if (!appData.hasReadConfig) return;

  if (equal(dataToWrite, toWrite)) {
    console.log("same appConfig, don't save it");
    return;
  }

  dataToWrite = deepClone(toWrite, true);

  if (writeConfigTimeout) {
    writeConfigTimeout.refresh();
  } else {
    writeConfigTimeout = setTimeout(async () => {
      try {
        if (isWriting) return;
        isWriting = true;

        const stringifiedData = JSON.stringify(dataToWrite);
        const backupVersionConfigName = `config_backup_v${version}.json`;

        try {
          // write to the dir where the exe is due to bizarre file permission issues
          const exeDirPath = nodePath.dirname(app.getPath("exe"));
          const exeDirTempConfigPath = nodePath.join(exeDirPath, "config_temp.json");
          const exeDirConfigPath = nodePath.join(exeDirPath, "config.json");
          await fs.writeFileSync(exeDirTempConfigPath, stringifiedData);
          const exeDirVersionConfigPath = nodePath.join(exeDirPath, backupVersionConfigName);
          await copy(exeDirTempConfigPath, exeDirVersionConfigPath, { overwrite: true });
          await move(exeDirTempConfigPath, exeDirConfigPath, { overwrite: true });
        } catch (err) {
          console.log(err);
        }

        const userData = app.getPath("userData");
        const tempFilePath = nodePath.join(userData, "config_temp.json");
        await fs.writeFileSync(tempFilePath, stringifiedData);

        const versionConfigFilePath = nodePath.join(userData, backupVersionConfigName);
        await copy(tempFilePath, versionConfigFilePath, { overwrite: true });
        const configFilePath = nodePath.join(userData, "config.json");
        await move(tempFilePath, configFilePath, { overwrite: true });

        console.log("done writing config file");
        isWriting = false;
      } catch (e) {
        console.log(e);
      }
    }, 300);
  }
}

export async function readAppConfig(): Promise<AppStateToWriteWithDeprecatedProperties> {
  let data: string | undefined;
  try {
    const userData = app.getPath("userData");
    const userDataConfigFilePath = nodePath.join(userData, "config.json");
    data = await fs.readFileSync(userDataConfigFilePath, "utf8");
    // eslint-disable-next-line no-empty
  } catch (err) {}

  try {
    if (!data) {
      const exeDirConfigPath = nodePath.join(nodePath.dirname(app.getPath("exe")), "config.json");
      data = await fs.readFileSync(exeDirConfigPath, "utf8");
    }
    // eslint-disable-next-line no-empty
  } catch (err) {}

  if (!data) throw new Error("No App config file exists!");

  return JSON.parse(data);
}
