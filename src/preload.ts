import { contextBridge, ipcRenderer } from "electron";

const api: api = {
  startGame: (mods: Mod[], startGameOptions: StartGameOptions, name?: string) =>
    ipcRenderer.send("startGame", mods, startGameOptions, name),
  exportModsToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModsToClipboard", mods),
  subscribeToMods: (ids: string[]) => ipcRenderer.send("subscribeToMods", ids),
  openFolderInExplorer: (path: string) => ipcRenderer.send("openFolderInExplorer", path),
  openInSteam: (url: string) => ipcRenderer.send("openInSteam", url),
  openPack: (path: string) => ipcRenderer.send("openPack", path),
  putPathInClipboard: (path: string) => ipcRenderer.send("putPathInClipboard", path),
  handleLog: (callback) => ipcRenderer.on("handleLog", callback),
  subscribedToMods: (callback) => ipcRenderer.on("subscribedToMods", callback),
  setIsDev: (callback) => ipcRenderer.on("setIsDev", callback),
  sendApiExists: () => ipcRenderer.send("sendApiExists"),
  readAppConfig: () => ipcRenderer.send("readAppConfig"),
  copyToData: () => ipcRenderer.send("copyToData"),
  cleanData: () => ipcRenderer.send("cleanData"),
  saveConfig: (appState: AppState) => ipcRenderer.send("saveConfig", appState),
  getUpdateData: () => ipcRenderer.invoke("getUpdateData"),
  fromAppConfig: (callback) => ipcRenderer.on("fromAppConfig", callback),
  failedReadingConfig: (callback) => ipcRenderer.on("failedReadingConfig", callback),
  modsPopulated: (callback) => ipcRenderer.on("modsPopulated", callback),
  setModData: (callback) => ipcRenderer.on("setModData", callback),
  setPackData: (callback) => ipcRenderer.on("setPackData", callback),
  getAllModData: (ids) => ipcRenderer.send("getAllModData", ids),
  savesPopulated: (callback) => ipcRenderer.on("savesPopulated", callback),
};
contextBridge.exposeInMainWorld("api", api);
