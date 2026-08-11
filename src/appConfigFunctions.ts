import { app } from "electron";
import * as fs from "fs";
import { copy, move } from "fs-extra";
import appData from "./appData";
import * as nodePath from "path";
import { version } from "../package.json";
import { buildAppConfig } from "./config/buildAppConfig";
import { migrateAppConfig } from "./config/migrateAppConfig";

let lastWrittenConfig: AppConfig | undefined;
let lastWrittenJson: string | undefined;
let pendingJson: string | undefined;
let hasWrittenVersionBackup = false;
let requestedWriteRevision = 0;
let completedWriteRevision = 0;
let activeWritePromise: Promise<void> | undefined;

const configFileName = "config.json";

export function setStartingConfig(startingConfig: AppConfig) {
  lastWrittenConfig = startingConfig;
  lastWrittenJson = JSON.stringify(startingConfig);
}

const persistConfigSnapshot = async (stringifiedData: string) => {
  // the per-version backup is a rollback copy of what this app version last wrote, so one per run is
  // enough - writing it on every save doubled the file writes for no extra safety
  const backupVersionConfigName = `config_backup_v${version}.json`;
  const isWritingVersionBackup = !hasWrittenVersionBackup;

  try {
    // write to the dir where the exe is due to bizarre file permission issues
    const exeDirPath = nodePath.dirname(app.getPath("exe"));
    const exeDirTempConfigPath = nodePath.join(exeDirPath, "config_temp.json");
    const exeDirConfigPath = nodePath.join(exeDirPath, configFileName);
    await fs.promises.writeFile(exeDirTempConfigPath, stringifiedData);
    if (isWritingVersionBackup) {
      const exeDirVersionConfigPath = nodePath.join(exeDirPath, backupVersionConfigName);
      await copy(exeDirTempConfigPath, exeDirVersionConfigPath, { overwrite: true });
    }
    await move(exeDirTempConfigPath, exeDirConfigPath, { overwrite: true });
  } catch (err) {
    console.log(err);
  }

  const userData = app.getPath("userData");
  const tempFilePath = nodePath.join(userData, "config_temp.json");
  await fs.promises.writeFile(tempFilePath, stringifiedData);

  if (isWritingVersionBackup) {
    const versionConfigFilePath = nodePath.join(userData, backupVersionConfigName);
    await copy(tempFilePath, versionConfigFilePath, { overwrite: true });
  }
  const configFilePath = nodePath.join(userData, configFileName);
  await move(tempFilePath, configFilePath, { overwrite: true });

  hasWrittenVersionBackup = true;
};

const processConfigWriteQueue = () => {
  if (activeWritePromise) return activeWritePromise;

  activeWritePromise = (async () => {
    while (completedWriteRevision < requestedWriteRevision) {
      const revisionToWrite = requestedWriteRevision;
      const stringifiedData = pendingJson;
      if (stringifiedData == undefined) break;

      try {
        await persistConfigSnapshot(stringifiedData);
        console.log("done writing config file");
      } catch (error) {
        console.log(error);
      }

      completedWriteRevision = revisionToWrite;
    }
  })().finally(() => {
    activeWritePromise = undefined;
    if (completedWriteRevision < requestedWriteRevision) void processConfigWriteQueue();
  });

  return activeWritePromise;
};

export const hasPendingAppConfigWrites = () =>
  completedWriteRevision < requestedWriteRevision || activeWritePromise != null;

export const flushAppConfigWrites = async () => {
  while (hasPendingAppConfigWrites()) {
    await processConfigWriteQueue();
  }
};

export function writeAppConfig(payload: ConfigSavePayload) {
  if (!appData.hasReadConfig) {
    return;
  }

  const toWrite = buildAppConfig(payload);

  // don't overwrite a config that had mods with one that has none - mods likely haven't populated yet
  const currentGameMods = toWrite.games[toWrite.currentGame]?.currentPreset.mods;
  const previousMods = lastWrittenConfig?.games[toWrite.currentGame]?.currentPreset.mods;
  if ((!currentGameMods || currentGameMods.length === 0) && previousMods && previousMods.length > 0) {
    console.log("skipping config write: current preset has no mods but previous config did");
    return;
  }

  // stringify once and compare the strings: this replaces a deep clone plus a deep equality check
  // over the whole config, and the result is exactly what gets written to disk
  const stringified = JSON.stringify(toWrite);
  if (stringified === lastWrittenJson) {
    return;
  }

  lastWrittenConfig = toWrite;
  lastWrittenJson = stringified;
  pendingJson = stringified;
  requestedWriteRevision += 1;
  void processConfigWriteQueue();
}

export async function readAppConfig(): Promise<AppConfig> {
  let data: string | undefined;
  let configPath: string | undefined;
  try {
    const userData = app.getPath("userData");
    const userDataConfigFilePath = nodePath.join(userData, configFileName);
    data = await fs.promises.readFile(userDataConfigFilePath, "utf8");
    configPath = userDataConfigFilePath;
    // eslint-disable-next-line no-empty
  } catch (err) {}

  try {
    if (!data) {
      const exeDirConfigPath = nodePath.join(nodePath.dirname(app.getPath("exe")), configFileName);
      data = await fs.promises.readFile(exeDirConfigPath, "utf8");
      configPath = exeDirConfigPath;
    }
    // eslint-disable-next-line no-empty
  } catch (err) {}

  if (!data) throw new Error("No App config file exists!");

  console.log("read app config from:", configPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new Error(`App config at ${configPath} is not valid JSON: ${err}`);
  }

  return migrateAppConfig(parsed);
}
