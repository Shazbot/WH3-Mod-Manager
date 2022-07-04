import { contextBridge, ipcRenderer } from "electron";

const appData: AppData = {
  presets: [],
  gamePath: "",
};

const api: api = {
  getAppData: () => appData,
  writeUserScript: (mods: Mod[]) => ipcRenderer.send("writeUserScript", mods),
  handleLog: (callback) => ipcRenderer.on("handleLog", callback),
  sendApiExists: () => ipcRenderer.send("sendApiExists"),
  readAppConfig: () => ipcRenderer.send("readAppConfig"),
  saveConfig: (appState: AppState) => ipcRenderer.send("saveConfig", appState),
  getModData: (id) => ipcRenderer.invoke("getModData", id),
  getUpdateData: () => ipcRenderer.invoke("getUpdateData"),
  fromAppConfig: (callback) => ipcRenderer.on("fromAppConfig", callback),
  modsPopulated: (callback) => ipcRenderer.on("modsPopulated", callback),
  setModData: (callback) => ipcRenderer.on("setModData", callback),
  getAllModData: (ids) => ipcRenderer.send("getAllModData", ids),
};
contextBridge.exposeInMainWorld("api", api);
