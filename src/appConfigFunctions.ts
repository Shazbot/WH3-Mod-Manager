import deepClone from "clone-deep";
import { app } from "electron";
import * as fs from "fs";
import equal from "fast-deep-equal";
import { copy, move } from "fs-extra";
import appData from "./appData";
import * as nodePath from "path";
import { version } from "../package.json";
import { diff } from "deep-object-diff";

let writeConfigTimeout: NodeJS.Timeout;
let dataToWrite: AppStateToWrite | undefined;
let isWriting = false;
let hasConfigBeenRead = false;

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

const removeModDataWeDontSave = (mods: Mod[] | undefined) => {
  if (!mods) return;

  // we don't care about saving these since we want to fetch or calculate the real time state of them anyway
  for (const mod of mods) {
    mod.lastChanged = undefined;
    mod.lastChangedLocal = undefined;
    mod.reqModIdToName = [];
    mod.isDeleted = false;
    mod.isMovie = false;
    mod.dependencyPacks = [];
  }
};

export function writeAppConfig(data: AppState) {
  const toWrite: AppStateToWrite = appStateToConfigAppState(data);

  if (!appData.hasReadConfig) {
    return;
  }

  // remove mod data we don't want to save from
  removeModDataWeDontSave(toWrite.gameToCurrentPreset[toWrite.currentGame]?.mods);

  const onLastGameLaunchPreset = toWrite.gameToPresets[toWrite.currentGame]?.find(
    (preset) => preset.name == "On Last Game Launch"
  );
  removeModDataWeDontSave(onLastGameLaunchPreset?.mods);

  const onAppStartPreset = toWrite.gameToPresets[toWrite.currentGame]?.find(
    (preset) => preset.name == "On App Start"
  );
  removeModDataWeDontSave(onAppStartPreset?.mods);

  if (!data.hasConfigBeenRead) {
    dataToWrite = deepClone(toWrite, true);
    console.log("config yet to be read, skip writing new config");
    return;
  }
  if (!hasConfigBeenRead && data.hasConfigBeenRead) {
    console.log("CONFIG HAS BEEN READ IN THIS WRITE REQUEST");
    hasConfigBeenRead = true;
    dataToWrite = deepClone(toWrite, true);
    return;
  }

  if (equal(dataToWrite, toWrite)) {
    console.log("same appConfig, don't save it");
    return;
  }

  if (dataToWrite) console.log("diff in config:", JSON.stringify(diff(dataToWrite, toWrite), null, 2));

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
