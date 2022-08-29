import { app } from "electron";
import * as fs from "fs/promises";

let writeConfigTimeout: NodeJS.Timeout;
let dataToWrite: AppStateToWrite | undefined;

export function writeAppConfig(data: AppState) {
  const toWrite: AppStateToWrite = {
    alwaysEnabledMods: data.alwaysEnabledMods,
    hiddenMods: data.hiddenMods,
    wasOnboardingEverRun: data.wasOnboardingEverRun,
    presets: data.presets,
    currentPreset: data.currentPreset,
    isAuthorEnabled: data.isAuthorEnabled,
    areThumbnailsEnabled: data.areThumbnailsEnabled,
  };

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
