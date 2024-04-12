import * as chokidar from "chokidar";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { gameToAppDataFolderName } from "./supportedGames";
import appData from "./appData";

let savesWatcher: chokidar.FSWatcher | undefined;

let saves: GameSave[] = [];

export const getSavesFolderPath = () => {
  const appDataPath = app.getPath("appData");
  return path.join(
    appDataPath,
    "The Creative Assembly",
    gameToAppDataFolderName[appData.currentGame],
    "save_games"
  );
};
export const getSaveFiles = async () => {
  saves = [];
  const folderPath = getSavesFolderPath();
  const files = await fs.readdirSync(folderPath, { withFileTypes: true });

  for (const saveFile of files) {
    if (!saves.find((iterSave) => iterSave.name === saveFile.name)) {
      let lastChanged: number | undefined;
      try {
        lastChanged = await fs.statSync(path.join(folderPath, saveFile.name)).mtimeMs;
      } catch (e) {
        console.log(e);
      }
      saves.push({ name: saveFile.name, lastChanged: lastChanged ?? -1 });
    }
  }

  return saves;
};

const addNewSave = async function (savePath: string) {
  const basename = path.win32.basename(savePath);
  if (!saves.find((iterSave) => iterSave.name === basename)) {
    let lastChanged: number | undefined;
    try {
      lastChanged = await fs.statSync(savePath).mtimeMs;
    } catch (e) {
      console.log(e);
    }
    saves.push({ name: basename, lastChanged: lastChanged ?? -1 });
  }
};

const removeSave = function (savePath: string) {
  const basename = path.win32.basename(savePath);
  saves = saves.filter((iterSave) => iterSave.name !== basename);
};

export const setupSavesWatcher = async (cb: (saves: GameSave[]) => void) => {
  if (savesWatcher) {
    await savesWatcher.close();
  }

  savesWatcher = chokidar
    .watch(`${getSavesFolderPath()}/*.save`, { ignoreInitial: true })
    .on("add", async (path: string) => {
      await addNewSave(path);
      console.log("Save added: " + path);
      cb(saves);
    })
    .on("unlink", (path: string) => {
      removeSave(path);
      console.log("Save removed: " + path);
      cb(saves);
    });
};
