import { app } from "electron";
import * as fs from "fs/promises";
import equal from "fast-deep-equal";
import { move } from "fs-extra";
import appData from "./appData";
import * as nodePath from "path";

let writeConfigTimeout: NodeJS.Timeout;
let dataToWrite: AppStateToWrite | undefined;

const appStateToConfigAppState = (appState: AppState): AppStateToWrite => {
  return {
    alwaysEnabledMods: appState.alwaysEnabledMods,
    hiddenMods: appState.hiddenMods,
    wasOnboardingEverRun: appState.wasOnboardingEverRun,
    presets: appState.presets,
    currentPreset: appState.currentPreset,
    isAuthorEnabled: appState.isAuthorEnabled,
    areThumbnailsEnabled: appState.areThumbnailsEnabled,
    isMakeUnitsGeneralsEnabled: appState.isMakeUnitsGeneralsEnabled,
    isSkipIntroMoviesEnabled: appState.isSkipIntroMoviesEnabled,
    isScriptLoggingEnabled: appState.isScriptLoggingEnabled,
  };
};

export function setStartingAppState(startingAppState: AppStateToWrite) {
  dataToWrite = startingAppState;
}

export function writeAppConfig(data: AppState) {
  const toWrite: AppStateToWrite = appStateToConfigAppState(data);

  if (!appData.hasReadConfig) return;
  if (equal(dataToWrite, toWrite)) return;
  const userData = app.getPath("userData");

  dataToWrite = toWrite;
  if (writeConfigTimeout) {
    writeConfigTimeout.refresh();
  } else {
    writeConfigTimeout = setTimeout(async () => {
      try {
        const stringifiedData = JSON.stringify(dataToWrite);

        try {
          // write to the dir where the exe is due to bizarre file permission issues
          const exeDirPath = nodePath.dirname(app.getPath("exe"));
          const exeDirTempConfigPath = nodePath.join(exeDirPath, "config_temp.json");
          const exeDirConfigPath = nodePath.join(exeDirPath, "config.json");
          await fs.writeFile(exeDirTempConfigPath, stringifiedData);
          await move(exeDirTempConfigPath, exeDirConfigPath, { overwrite: true });
        } catch (err) {
          console.log(err);
        }

        const tempFilePath = nodePath.join(userData, "config_temp.json");
        await fs.writeFile(tempFilePath, stringifiedData);

        const configFilePath = nodePath.join(userData, "config.json");
        await move(tempFilePath, configFilePath, { overwrite: true });
      } catch (e) {
        console.log(e);
      }
    }, 300);
  }
}

export async function readAppConfig(): Promise<AppStateToWrite> {
  let data: string | undefined;
  try {
    const userData = app.getPath("userData");
    const userDataConfigFilePath = nodePath.join(userData, "config.json");
    data = await fs.readFile(userDataConfigFilePath, "utf8");
    // eslint-disable-next-line no-empty
  } catch (err) {}

  try {
    if (!data) {
      const exeDirConfigPath = nodePath.join(nodePath.dirname(app.getPath("exe")), "config.json");
      data = await fs.readFile(exeDirConfigPath, "utf8");
    }
    // eslint-disable-next-line no-empty
  } catch (err) {}

  if (!data) throw new Error("No App config file exists!");

  return JSON.parse(data);
}
