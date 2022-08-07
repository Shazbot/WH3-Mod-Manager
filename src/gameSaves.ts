import * as chokidar from "chokidar";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs/promises";

let savesWatcher: chokidar.FSWatcher | undefined;

let saves: GameSave[] = [];

const getSavesFolderPath = () => {
  const appDataPath = app.getPath("appData");
  return path.join(appDataPath, "The Creative Assembly/Warhammer3/save_games/");
};
export const getSaveFiles = async () => {
  const folderPath = getSavesFolderPath();
  const files = await fs.readdir(folderPath, { withFileTypes: true });

  for (const saveFile of files) {
    if (!saves.find((iterSave) => iterSave.name === saveFile.name)) {
      let lastChanged = undefined;
      try {
        lastChanged = await fs.stat(path.join(folderPath, saveFile.name)).then((stats) => {
          return stats.mtimeMs;
        });
      } catch {}
      saves.push({ name: saveFile.name, lastChanged });
    }
  }

  return saves;
};

const addNewSave = async function (savePath: string) {
  const basename = path.win32.basename(savePath);
  if (!saves.find((iterSave) => iterSave.name === basename)) {
    let lastChanged = undefined;
    try {
      lastChanged = await fs.stat(savePath).then((stats) => {
        return stats.mtimeMs;
      });
    } catch {}
    saves.push({ name: basename, lastChanged });
  }
};

const removeSave = function (savePath: string) {
  const basename = path.win32.basename(savePath);
  saves = saves.filter((iterSave) => iterSave.name !== basename);
};

export const setupSavesWatcher = (cb: (saves: GameSave[]) => void) => {
  if (!savesWatcher) {
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
  }
};
