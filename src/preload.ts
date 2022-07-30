import { contextBridge, ipcRenderer } from "electron";
import appData from "./appData";

const api: api = {
  getAppData: () => appData,
  writeUserScript: (mods: Mod[]) => ipcRenderer.send("writeUserScript", mods),
  handleLog: (callback) => ipcRenderer.on("handleLog", callback),
  sendApiExists: () => ipcRenderer.send("sendApiExists"),
  readAppConfig: () => ipcRenderer.send("readAppConfig"),
  copyToData: () => ipcRenderer.send("copyToData"),
  cleanData: () => ipcRenderer.send("cleanData"),
  saveConfig: (appState: AppState) => ipcRenderer.send("saveConfig", appState),
  getModData: (id) => ipcRenderer.invoke("getModData", id),
  getUpdateData: () => ipcRenderer.invoke("getUpdateData"),
  fromAppConfig: (callback) => ipcRenderer.on("fromAppConfig", callback),
  modsPopulated: (callback) => ipcRenderer.on("modsPopulated", callback),
  setModData: (callback) => ipcRenderer.on("setModData", callback),
  getAllModData: (ids) => ipcRenderer.send("getAllModData", ids),
};
contextBridge.exposeInMainWorld("api", api);
