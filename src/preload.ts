import { contextBridge, ipcRenderer } from "electron";
import electronLog from "electron-log";
import { PackCollisions } from "./packFileTypes";
import { AppFolderPaths } from "./appData";

console.log("IN PRELOAD");

const api = {
  startGame: (mods: Mod[], areModsInOrder: boolean, startGameOptions: StartGameOptions, name?: string) =>
    ipcRenderer.send("startGame", mods, areModsInOrder, startGameOptions, name),
  exportModsToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModsToClipboard", mods),
  exportModNamesToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModNamesToClipboard", mods),
  createSteamCollection: (mods: Mod[]) => ipcRenderer.send("createSteamCollection", mods),
  subscribeToMods: (ids: string[]) => ipcRenderer.send("subscribeToMods", ids),
  openFolderInExplorer: (path: string) => ipcRenderer.send("openFolderInExplorer", path),
  openInSteam: (url: string) => ipcRenderer.send("openInSteam", url),
  openPack: (path: string) => ipcRenderer.send("openPack", path),
  getPacksInSave: (saveName: string) => ipcRenderer.send("getPacksInSave", saveName),
  putPathInClipboard: (path: string) => ipcRenderer.send("putPathInClipboard", path),
  updateMod: (mod: Mod, contentMod: Mod) => ipcRenderer.send("updateMod", mod, contentMod),
  fakeUpdatePack: (mod: Mod) => ipcRenderer.send("fakeUpdatePack", mod),
  makePackBackup: (mod: Mod) => ipcRenderer.send("makePackBackup", mod),
  forceModDownload: (mod: Mod) => ipcRenderer.send("forceModDownload", mod),
  unsubscribeToMod: (mod: Mod) => ipcRenderer.send("unsubscribeToMod", mod),
  reMerge: (mod: Mod, modsToMerge: Mod[]) => ipcRenderer.send("reMerge", mod, modsToMerge),
  deletePack: (mod: Mod) => ipcRenderer.send("deletePack", mod),
  forceDownloadMods: (modIds: string[]) => ipcRenderer.send("forceDownloadMods", modIds),
  mergeMods: (mods: Mod[]) => ipcRenderer.send("mergeMods", mods),
  handleLog: (callback: (event: Electron.IpcRendererEvent, msg: string) => void) =>
    ipcRenderer.on("handleLog", callback),
  subscribedToMods: (callback: (event: Electron.IpcRendererEvent, ids: string[]) => void) =>
    ipcRenderer.on("subscribedToMods", callback),
  createdMergedPack: (callback: (event: Electron.IpcRendererEvent, filePath: string) => void) =>
    ipcRenderer.on("createdMergedPack", callback),
  setIsDev: (callback: (event: Electron.IpcRendererEvent, isDev: boolean) => void) =>
    ipcRenderer.on("setIsDev", callback),
  setIsAdmin: (callback: (event: Electron.IpcRendererEvent, isAdmin: boolean) => void) =>
    ipcRenderer.on("setIsAdmin", callback),
  setIsWH3Running: (callback: (event: Electron.IpcRendererEvent, isWH3Running: boolean) => void) =>
    ipcRenderer.on("setIsWH3Running", callback),
  setStartArgs: (callback: (event: Electron.IpcRendererEvent, startArgs: string[]) => void) =>
    ipcRenderer.on("setStartArgs", callback),
  packsInSave: (callback: (event: Electron.IpcRendererEvent, packNames: string[]) => void) =>
    ipcRenderer.on("packsInSave", callback),
  sendApiExists: () => ipcRenderer.send("sendApiExists"),
  viewerIsReady: () => ipcRenderer.send("viewerIsReady"),
  requestOpenModInViewer: (modPath: string) => ipcRenderer.send("requestOpenModInViewer", modPath),
  openModInViewer: (callback: (event: Electron.IpcRendererEvent, modPath: string) => void) =>
    ipcRenderer.on("openModInViewer", callback),
  readAppConfig: () => ipcRenderer.send("readAppConfig"),
  copyToData: (modPathsToCopy?: string[]) => ipcRenderer.send("copyToData", modPathsToCopy),
  copyToDataAsSymbolicLink: (modPathsToCopy?: string[]) =>
    ipcRenderer.send("copyToDataAsSymbolicLink", modPathsToCopy),
  cleanData: () => ipcRenderer.send("cleanData"),
  cleanSymbolicLinksInData: () => ipcRenderer.send("cleanSymbolicLinksInData"),
  getPackData: (packPath: string, table?: DBTable) => ipcRenderer.send("getPackData", packPath, table),
  getPackDataWithLocs: (packPath: string, table?: DBTable) =>
    ipcRenderer.send("getPackDataWithLocs", packPath, table),
  saveConfig: (appState: AppState) => ipcRenderer.send("saveConfig", appState),
  readMods: (mods: Mod[], skipCollisionCheck = true) =>
    ipcRenderer.send("readMods", mods, skipCollisionCheck),
  getUpdateData: () => ipcRenderer.invoke("getUpdateData"),
  translate: (translationId: string, options?: Record<string, string | number>) =>
    ipcRenderer.invoke("translate", translationId, options),
  translateAll: (translationIdsWithOptions: Record<string, Record<string, string | number>>) =>
    ipcRenderer.invoke("translateAll", translationIdsWithOptions),
  translateAllStatic: (translationIds: Record<string, string | number>) =>
    ipcRenderer.invoke("translateAllStatic", translationIds),
  fromAppConfig: (callback: (event: Electron.IpcRendererEvent, appState: AppState) => void) =>
    ipcRenderer.on("fromAppConfig", callback),
  failedReadingConfig: (callback: (event: Electron.IpcRendererEvent) => void) =>
    ipcRenderer.on("failedReadingConfig", callback),
  modsPopulated: (callback: (event: Electron.IpcRendererEvent, mods: Mod[]) => void) =>
    ipcRenderer.on("modsPopulated", callback),
  addMod: (callback: (event: Electron.IpcRendererEvent, mod: Mod) => void) =>
    ipcRenderer.on("addMod", callback),
  removeMod: (callback: (event: Electron.IpcRendererEvent, modPath: string) => void) =>
    ipcRenderer.on("removeMod", callback),
  setModData: (callback: (event: Electron.IpcRendererEvent, modDatas: ModData[]) => void) =>
    ipcRenderer.on("setModData", callback),
  setPackHeaderData: (callback: (event: Electron.IpcRendererEvent, packHeaderData: PackHeaderData) => void) =>
    ipcRenderer.on("setPackHeaderData", callback),
  setPacksData: (callback: (event: Electron.IpcRendererEvent, packsData: PackViewData[]) => void) =>
    ipcRenderer.on("setPacksData", callback),
  setPacksDataRead: (callback: (event: Electron.IpcRendererEvent, packPaths: string[]) => void) =>
    ipcRenderer.on("setPacksDataRead", callback),
  setPackCollisions: (callback: (event: Electron.IpcRendererEvent, packCollisions: PackCollisions) => void) =>
    ipcRenderer.on("setPackCollisions", callback),
  addToast: (callback: (event: Electron.IpcRendererEvent, toast: Toast) => void) =>
    ipcRenderer.on("addToast", callback),
  setAppFolderPaths: (callback: (event: Electron.IpcRendererEvent, appFolderPaths: AppFolderPaths) => void) =>
    ipcRenderer.on("setAppFolderPaths", callback),
  getAllModData: (ids: string[]) => ipcRenderer.send("getAllModData", ids),
  getCustomizableMods: (modPaths: string[], tables: string[]) =>
    ipcRenderer.send("getCustomizableMods", modPaths, tables),
  setCustomizableMods: (
    callback: (event: Electron.IpcRendererEvent, customizableMods: Record<string, string[]>) => void
  ) => ipcRenderer.on("setCustomizableMods", callback),
  getCompatData: (mods: Mod[]) => ipcRenderer.send("getCompatData", mods),
  selectContentFolder: () => ipcRenderer.send("selectContentFolder"),
  selectWarhammer3Folder: () => ipcRenderer.send("selectWarhammer3Folder"),
  savesPopulated: (callback: (event: Electron.IpcRendererEvent, saves: GameSave[]) => void) =>
    ipcRenderer.on("savesPopulated", callback),
  setContentFolder: (callback: (event: Electron.IpcRendererEvent, path: string) => void) =>
    ipcRenderer.on("setContentFolder", callback),
  setWarhammer3Folder: (callback: (event: Electron.IpcRendererEvent, path: string) => void) =>
    ipcRenderer.on("setWarhammer3Folder", callback),
  setOverwrittenDataPackedFiles: (
    callback: (event: Electron.IpcRendererEvent, overwrittenDataPackedFiles: Record<string, string[]>) => void
  ) => ipcRenderer.on("setOverwrittenDataPackedFiles", callback),
  setOutdatedPackFiles: (
    callback: (event: Electron.IpcRendererEvent, outdatedPackFiles: Record<string, string[]>) => void
  ) => ipcRenderer.on("setOutdatedPackFiles", callback),
  setDataModLastChangedLocal: (
    callback: (event: Electron.IpcRendererEvent, dataModLastChangedLocal: number) => void
  ) => ipcRenderer.on("setDataModLastChangedLocal", callback),
  setAvailableLanguages: (callback: (event: Electron.IpcRendererEvent, languages: string[]) => void) =>
    ipcRenderer.on("setAvailableLanguages", callback),
  requestLanguageChange: (language: string) => ipcRenderer.send("requestLanguageChange", language),
  setCurrentLanguage: (callback: (event: Electron.IpcRendererEvent, language: string) => void) =>
    ipcRenderer.on("setCurrentLanguage", callback),
  electronLog,
};

export type api = typeof api;

window.api = api;
// contextBridge.exposeInMainWorld("api", api);
