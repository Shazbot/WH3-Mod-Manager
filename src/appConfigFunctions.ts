import { app } from "electron";
import * as fs from "fs/promises";
import equal from "fast-deep-equal";

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

  if (equal(dataToWrite, toWrite)) return;

  dataToWrite = toWrite;
  if (writeConfigTimeout) {
    writeConfigTimeout.refresh();
  } else {
    writeConfigTimeout = setTimeout(() => {
      const userData = app.getPath("userData");
      fs.writeFile(`${userData}\\config.json`, JSON.stringify(dataToWrite));
    }, 250);
  }
}

export async function readAppConfig(): Promise<AppStateToWrite> {
  const userData = app.getPath("userData");
  const data = await fs.readFile(`${userData}\\config.json`, "utf8");
  return JSON.parse(data);
}
