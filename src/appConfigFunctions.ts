import { app } from "electron";
import * as fs from "fs/promises";

export function saveAppConfig(data: AppState) {
  const userData = app.getPath("userData");
  fs.writeFile(`${userData}\\config.json`, JSON.stringify(data));
}

export async function readAppConfig(): Promise<AppState> {
  const userData = app.getPath("userData");
  const data = await fs.readFile(`${userData}\\config.json`, "utf8");
  return JSON.parse(data) as AppState;
}
