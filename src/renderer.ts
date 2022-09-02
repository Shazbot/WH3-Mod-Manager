import "./index.css";
import "./app";
import {
  setMods,
  setModData,
  setFromConfig,
  setSaves,
  setIsOnboardingToRun,
  setIsDev,
  setPackData,
  addMod,
  removeMod,
} from "./appSlice";
import store from "./store";

let isSubscribedToStoreChanges = false;

window.api.handleLog((event, msg) => {
  console.log(msg);
});

window.api.subscribedToMods((event, ids: string[]) => {
  console.log("subbed to mods: ", ids);
});

window.api.setIsDev((event, isDev) => {
  console.log("Setting is dev: " + isDev);
  store.dispatch(setIsDev(isDev));
});

const subscribeToStoreChanges = () => {
  if (!isSubscribedToStoreChanges) {
    setTimeout(() => {
      if (!isSubscribedToStoreChanges) {
        isSubscribedToStoreChanges = true;
        store.subscribe(() => {
          window.api.saveConfig(store.getState().app);
        });
      }
    }, 50);
  }
};

window.api.fromAppConfig((event, appState: AppStateToWrite) => {
  console.log("INVOKED: FROM API CONFIG");
  store.dispatch(setFromConfig(appState));

  subscribeToStoreChanges();
});

window.api.failedReadingConfig(() => {
  console.log("INVOKED: FROM API CONFIG");
  if (!isSubscribedToStoreChanges) {
    store.dispatch(setIsOnboardingToRun(true));
  }

  subscribeToStoreChanges();
});

window.api.modsPopulated((event, mods: Mod[]) => {
  console.log("INVOKED: MODS POPULATED");
  mods = mods.filter((mod) => mod !== undefined); // try to get rid of this check
  store.dispatch(setMods(mods));
  window.api.getAllModData(mods.filter((mod) => !mod.isInData).map((mod) => mod.workshopId));
});

window.api.addMod((event, mod: Mod) => {
  console.log("INVOKED: MOD ADDED");
  store.dispatch(addMod(mod));
  if (mod.workshopId && mod.workshopId !== "") {
    window.api.getAllModData([mod.workshopId]);
  }
});

window.api.removeMod((event, modPath: string) => {
  console.log("INVOKED: MOD REMOVED");
  store.dispatch(removeMod(modPath));
});

window.api.savesPopulated((event, saves: GameSave[]) => {
  console.log("INVOKED: SAVES POPULATED");
  store.dispatch(setSaves(saves));
});

window.api.setModData((event, modData: ModData) => {
  // console.log("INVOKED: MOD DATA RECIEVED");
  store.dispatch(setModData(modData));
});

window.api.setPackData((event, packData: PackData) => {
  // console.log("INVOKED: MOD PACK DATA RECIEVED");
  store.dispatch(setPackData(packData));
});

window.api.sendApiExists();
window.api.readAppConfig();
