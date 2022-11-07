import "./index.css";
import "./app";
import {
  setMods,
  setModData,
  setFromConfig,
  setSaves,
  setIsOnboardingToRun,
  setIsDev,
  addMod,
  removeMod,
  enableModsByName,
  setPackHeaderData,
  setPacksData,
  setPackCollisions,
  createdMergedPack,
  setPacksDataRead,
  setAppFolderPaths,
  setWarhammer3Folder,
  setContentFolder,
  setOverwrittenDataPackedFiles,
} from "./appSlice";
import store from "./store";
import { Pack, PackCollisions } from "./packFileTypes";
import { AppFolderPaths } from "./appData";
import debounce from "just-debounce-it";

let isSubscribedToStoreChanges = false;

const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
  window.api?.electronLog.log(...args);
  originalConsoleLog(...args);
};

window.addEventListener("error", (e) => {
  console.log(e);
});

window.api?.handleLog((event, msg) => {
  console.log(msg);
});

window.api?.subscribedToMods((event, ids: string[]) => {
  console.log("subbed to mods: ", ids);
});

window.api?.createdMergedPack((event, filePath: string) => {
  store.dispatch(createdMergedPack(filePath));
});

window.api?.setIsDev((event, isDev) => {
  console.log("Setting is dev: " + isDev);
  store.dispatch(setIsDev(isDev));
});

window.api?.packsInSave((event, packNames: string[]) => {
  console.log("packs in save: ", packNames);
  store.dispatch(enableModsByName(packNames));
});

const saveConfig = (appState: AppState) => {
  window.api?.saveConfig(appState);
  const enabledMods = appState.currentPreset.mods.filter((mod) => mod.isEnabled);
  // don't do it if all are enabled, i.e. when user is resetting the enabled column
  if (enabledMods.length != appState.currentPreset.mods.length) window.api?.readMods(enabledMods);
};

const saveConfigDebounced = debounce((appState: AppState) => {
  saveConfig(appState);
}, 200);

const subscribeToStoreChanges = () => {
  if (!isSubscribedToStoreChanges) {
    setTimeout(() => {
      if (!isSubscribedToStoreChanges) {
        isSubscribedToStoreChanges = true;

        saveConfig(store.getState().app);

        store.subscribe(() => {
          saveConfigDebounced(store.getState().app);
        });
      }
    }, 50);
  }
};

window.api?.fromAppConfig((event, appState: AppStateToWrite) => {
  console.log("INVOKED: FROM API CONFIG");
  store.dispatch(setFromConfig(appState));

  subscribeToStoreChanges();
});

window.api?.setAppFolderPaths((event, appFolderPaths: AppFolderPaths) => {
  console.log("INVOKED: SET APP FOLDER PATHS");
  store.dispatch(setAppFolderPaths(appFolderPaths));
});

window.api?.failedReadingConfig(() => {
  console.log("INVOKED: FROM API CONFIG");
  if (!isSubscribedToStoreChanges) {
    store.dispatch(setIsOnboardingToRun(true));
  }

  subscribeToStoreChanges();
});

window.api?.modsPopulated((event, mods: Mod[]) => {
  console.log("INVOKED: MODS POPULATED");
  mods = mods.filter((mod) => mod !== undefined); // try to get rid of this check
  store.dispatch(setMods(mods));
  window.api?.getAllModData(mods.filter((mod) => !mod.isInData).map((mod) => mod.workshopId));
});

window.api?.addMod((event, mod: Mod) => {
  console.log("INVOKED: MOD ADDED");
  store.dispatch(addMod(mod));
  if (mod.workshopId && mod.workshopId !== "") {
    window.api?.getAllModData([mod.workshopId]);
  }
});

window.api?.removeMod((event, modPath: string) => {
  console.log("INVOKED: MOD REMOVED");
  store.dispatch(removeMod(modPath));
});

window.api?.setContentFolder((event, path: string) => {
  console.log("INVOKED: setContentFolder");
  store.dispatch(setContentFolder(path));
});
window.api?.setWarhammer3Folder((event, path: string) => {
  console.log("INVOKED: setWarhammer3Folder");
  store.dispatch(setWarhammer3Folder(path));
});

window.api?.setOverwrittenDataPackedFiles((event, overwrittenDataPackedFiles: Record<string, string[]>) => {
  console.log("INVOKED: setOverwrittenDataPackedFiles");
  store.dispatch(setOverwrittenDataPackedFiles(overwrittenDataPackedFiles));
});

window.api?.savesPopulated((event, saves: GameSave[]) => {
  console.log("INVOKED: SAVES POPULATED");
  store.dispatch(setSaves(saves));
});

window.api?.setModData((event, modData: ModData) => {
  // console.log("INVOKED: MOD DATA RECIEVED");
  store.dispatch(setModData(modData));
});

window.api?.setPackHeaderData((event, packHeaderData: PackHeaderData) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  store.dispatch(setPackHeaderData(packHeaderData));
});

window.api?.setPacksData((event, packsData: Pack[]) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  store.dispatch(setPacksData(packsData));

  // getCompatData(packsData).then((data: Awaited<ReturnType<typeof getCompatData>>) => {
  //   console.log("GOT COMPAT DATA");
  //   store.dispatch(setPackCollisions(data));
  // });
});

window.api?.setPacksDataRead((event, packPaths: string[]) => {
  store.dispatch(setPacksDataRead(packPaths));
});

window.api?.setPackCollisions((event, packCollisions: PackCollisions) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  store.dispatch(setPackCollisions(packCollisions));

  // getCompatData(packsData).then((data: Awaited<ReturnType<typeof getCompatData>>) => {
  //   console.log("GOT COMPAT DATA");
  //   store.dispatch(setPackCollisions(data));
  // });
});

window.api?.sendApiExists();
window.api?.readAppConfig();
