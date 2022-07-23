import { app } from "electron";
import * as fs from "fs/promises";

let saveConfigTimeout: NodeJS.Timeout;
let saveData: AppState | undefined;

export function saveAppConfig(data: AppState) {
  saveData = data;
  if (saveConfigTimeout) {
    saveConfigTimeout.refresh();
  } else {
    saveConfigTimeout = setTimeout(() => {
      console.log("WRITING CONFIG");
      const userData = app.getPath("userData");
      fs.writeFile(`${userData}\\config.json`, JSON.stringify(saveData));
    }, 250);
  }
}

export async function readAppConfig(): Promise<AppState> {
  const userData = app.getPath("userData");
  const data = await fs.readFile(`${userData}\\config.json`, "utf8");
  return JSON.parse(data) as AppState;
}
