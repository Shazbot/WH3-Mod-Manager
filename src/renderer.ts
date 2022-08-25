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
} from "./appSlice";
import store from "./store";

window.api.handleLog((event, str) => {
  console.log(str);
});

window.api.setIsDev((event, isDev) => {
  console.log("Setting is dev: " + isDev);
  store.dispatch(setIsDev(isDev));
});

window.api.fromAppConfig((event, appState: AppStateToSave) => {
  console.log("INVOKED: FROM API CONFIG");
  store.dispatch(setFromConfig(appState));

  store.subscribe(() => {
    window.api.saveConfig(store.getState().app);
  });
});

window.api.failedReadingConfig(() => {
  console.log("INVOKED: FROM API CONFIG");
  store.dispatch(setIsOnboardingToRun(true));

  store.subscribe(() => {
    window.api.saveConfig(store.getState().app);
  });
});

window.api.modsPopulated((event, mods: Mod[]) => {
  console.log("INVOKED: MODS POPULATED");
  mods = mods.filter((mod) => mod !== undefined); // try to get rid of this check
  store.dispatch(setMods(mods));
  window.api.getAllModData(mods.filter((mod) => !mod.isInData).map((mod) => mod.workshopId));
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
