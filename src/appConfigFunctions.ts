import { app } from "electron";
import * as fs from "fs/promises";

let saveConfigTimeout: NodeJS.Timeout;
let saveData: Partial<AppState> | undefined;

export function saveAppConfig(data: AppState) {
  const toSave: AppStateToSave = {
    alwaysEnabledMods: data.alwaysEnabledMods,
    hiddenMods: data.hiddenMods,
    wasOnboardingEverRun: data.wasOnboardingEverRun,
    presets: data.presets,
    currentPreset: data.currentPreset,
  };

  saveData = toSave;
  if (saveConfigTimeout) {
    saveConfigTimeout.refresh();
  } else {
    saveConfigTimeout = setTimeout(() => {
      const userData = app.getPath("userData");
      fs.writeFile(`${userData}\\config.json`, JSON.stringify(saveData));
    }, 250);
  }
}

export async function readAppConfig(): Promise<AppStateToSave> {
  const userData = app.getPath("userData");
  const data = await fs.readFile(`${userData}\\config.json`, "utf8");
  return JSON.parse(data) as AppStateToSave;
}
