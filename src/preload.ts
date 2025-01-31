import { contextBridge, ipcRenderer } from "electron";
import { PackCollisions } from "./packFileTypes";
import { GameFolderPaths } from "./appData";
import { SupportedGames } from "./supportedGames";
import debounce from "just-debounce-it";
import "electron-log/preload";

console.log("IN PRELOAD");

const api = {
  startGame: (mods: Mod[], areModsInOrder: boolean, startGameOptions: StartGameOptions, name?: string) =>
    ipcRenderer.send("startGame", mods, areModsInOrder, startGameOptions, name),
  exportModsToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModsToClipboard", mods),
  exportModNamesToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModNamesToClipboard", mods),
  createSteamCollection: (mods: Mod[]) => ipcRenderer.send("createSteamCollection", mods),
  importSteamCollection: (
    steamCollectionURL: string,
    isImmediateImport: boolean,
    doDisableOtherMods: boolean,
    isLoadOrdered: boolean,
    doCreatePreset: boolean,
    presetName: string,
    isPresetLoadOrdered: boolean
  ) =>
    ipcRenderer.send(
      "importSteamCollection",
      steamCollectionURL,
      isImmediateImport,
      doDisableOtherMods,
      isLoadOrdered,
      doCreatePreset,
      presetName,
      isPresetLoadOrdered
    ),
  subscribeToMods: (ids: string[]) => ipcRenderer.send("subscribeToMods", ids),
  openFolderInExplorer: (path: string) => ipcRenderer.send("openFolderInExplorer", path),
  openInSteam: (url: string) => ipcRenderer.send("openInSteam", url),
  openPack: (path: string) => ipcRenderer.send("openPack", path),
  getPacksInSave: (saveName: string) => ipcRenderer.send("getPacksInSave", saveName),
  putPathInClipboard: (path: string) => ipcRenderer.send("putPathInClipboard", path),
  updateMod: (mod: Mod, contentMod: Mod) => ipcRenderer.send("updateMod", mod, contentMod),
  uploadMod: (mod: Mod) => ipcRenderer.send("uploadMod", mod),
  fakeUpdatePack: (mod: Mod) => ipcRenderer.send("fakeUpdatePack", mod),
  makePackBackup: (mod: Mod) => ipcRenderer.send("makePackBackup", mod),
  forceModDownload: (mod: Mod) => ipcRenderer.send("forceModDownload", mod),
  unsubscribeToMod: (mod: Mod) => ipcRenderer.send("unsubscribeToMod", mod),
  reMerge: (mod: Mod, modsToMerge: Mod[]) => ipcRenderer.send("reMerge", mod, modsToMerge),
  deletePack: (mod: Mod) => ipcRenderer.send("deletePack", mod),
  forceDownloadMods: (modIds: string[]) => ipcRenderer.send("forceDownloadMods", modIds),
  forceResubscribeMods: (mods: Mod[]) => ipcRenderer.send("forceResubscribeMods", mods),
  mergeMods: (mods: Mod[]) => ipcRenderer.send("mergeMods", mods),
  handleLog: (callback: (event: Electron.IpcRendererEvent, msg: string) => void) =>
    ipcRenderer.on("handleLog", callback),
  subscribedToMods: (callback: (event: Electron.IpcRendererEvent, ids: string[]) => void) =>
    ipcRenderer.on("subscribedToMods", callback),
  createdMergedPack: (callback: (event: Electron.IpcRendererEvent, filePath: string) => void) =>
    ipcRenderer.on("createdMergedPack", callback),
  importSteamCollectionResponse: (
    callback: (event: Electron.IpcRendererEvent, importSteamCollection: ImportSteamCollection) => void
  ) => ipcRenderer.on("importSteamCollectionResponse", callback),
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
  skillsAreReady: () => ipcRenderer.send("skillsAreReady"),
  requestOpenModInViewer: (modPath: string) => ipcRenderer.send("requestOpenModInViewer", modPath),
  requestOpenSkillsWindow: (mods: Mod[]) => ipcRenderer.send("requestOpenSkillsWindow", mods),
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
  readMods: debounce(
    (mods: Mod[], skipCollisionCheck = true) => ipcRenderer.send("readMods", mods, skipCollisionCheck),
    100
  ),
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
  setSkillsData: (callback: (event: Electron.IpcRendererEvent, skillsData: SkillsData) => void) =>
    ipcRenderer.on("setSkillsData", callback),
  setPackCollisionsCheckProgress: (
    callback: (event: Electron.IpcRendererEvent, progressData: PackCollisionsCheckProgressData) => void
  ) => ipcRenderer.on("setPackCollisionsCheckProgress", callback),
  setPacksDataRead: (callback: (event: Electron.IpcRendererEvent, packPaths: string[]) => void) =>
    ipcRenderer.on("setPacksDataRead", callback),
  setPackCollisions: (callback: (event: Electron.IpcRendererEvent, packCollisions: PackCollisions) => void) =>
    ipcRenderer.on("setPackCollisions", callback),
  addToast: (callback: (event: Electron.IpcRendererEvent, toast: Toast) => void) =>
    ipcRenderer.on("addToast", callback),
  setAppFolderPaths: (
    callback: (event: Electron.IpcRendererEvent, appFolderPaths: GameFolderPaths) => void
  ) => ipcRenderer.on("setAppFolderPaths", callback),
  requestGameFolderPaths: (callback: (event: Electron.IpcRendererEvent, game: SupportedGames) => void) =>
    ipcRenderer.on("requestGameFolderPaths", callback),
  getAllModData: (ids: string[]) => ipcRenderer.send("getAllModData", ids),
  getCustomizableMods: debounce(
    (modPaths: string[], tables: string[]) => ipcRenderer.send("getCustomizableMods", modPaths, tables),
    100
  ),
  setCustomizableMods: (
    callback: (event: Electron.IpcRendererEvent, customizableMods: Record<string, string[]>) => void
  ) => ipcRenderer.on("setCustomizableMods", callback),
  getCompatData: (mods: Mod[]) => ipcRenderer.send("getCompatData", mods),
  selectContentFolder: (requestedGame: SupportedGames | undefined) =>
    ipcRenderer.send("selectContentFolder", requestedGame),
  selectWarhammer3Folder: (requestedGame: SupportedGames | undefined) =>
    ipcRenderer.send("selectWarhammer3Folder", requestedGame),
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

  setCurrentlyReadingMod: (callback: (event: Electron.IpcRendererEvent, modName: string) => void) =>
    ipcRenderer.on("setCurrentlyReadingMod", callback),
  setLastModThatWasRead: (callback: (event: Electron.IpcRendererEvent, modName: string) => void) =>
    ipcRenderer.on("setLastModThatWasRead", callback),

  setAvailableLanguages: (callback: (event: Electron.IpcRendererEvent, languages: string[]) => void) =>
    ipcRenderer.on("setAvailableLanguages", callback),
  getSteamCollectionName: (url: string): Promise<string> => ipcRenderer.invoke("getSteamCollectionName", url),
  requestLanguageChange: (language: string) => ipcRenderer.send("requestLanguageChange", language),
  requestGameChange: (game: string, appState: AppState) =>
    ipcRenderer.send("requestGameChange", game, appState),
  setCurrentLanguage: (callback: (event: Electron.IpcRendererEvent, language: string) => void) =>
    ipcRenderer.on("setCurrentLanguage", callback),
  setCurrentGame: (
    callback: (
      event: Electron.IpcRendererEvent,
      game: SupportedGames,
      currentPreset: Preset,
      presets: Preset[]
    ) => void
  ) => ipcRenderer.on("setCurrentGame", callback),
  setCurrentGameNaive: (callback: (event: Electron.IpcRendererEvent, game: SupportedGames) => void) =>
    ipcRenderer.on("setCurrentGameNaive", callback),

  getSkillsForSubtype: (subtype: string, subtypeIndex: number) =>
    ipcRenderer.send("getSkillsForSubtype", subtype, subtypeIndex),
  searchInsidePacks: (searchTerm: string, mods: Mod[]) =>
    ipcRenderer.send("searchInsidePacks", searchTerm, mods),
  setPackSearchResults: (callback: (event: Electron.IpcRendererEvent, packNames: string[]) => void) =>
    ipcRenderer.on("setPackSearchResults", callback),
  terminateGame: () => ipcRenderer.send("terminateGame"),
};

export type api = typeof api;

window.api = api;
// contextBridge.exposeInMainWorld("api", api);
