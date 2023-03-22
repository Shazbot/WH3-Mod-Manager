import { electronLog } from "electron-log";
import { Pack, PackCollisions } from "./packFileTypes";
import { AppFolderPaths } from "./appData";
export {};

declare global {
  interface Window {
    api?: api;
  }

  interface api {
    startGame: (mods: Mod[], startGameOptions: StartGameOptions, saveName?: string) => void;
    exportModsToClipboard: (mods: Mod[]) => void;
    subscribeToMods: (ids: string[]) => void;
    openFolderInExplorer: (path: string) => void;
    openInSteam: (url: string) => void;
    openPack: (path: string) => void;
    getPacksInSave: (saveName: string) => void;
    putPathInClipboard: (path: string) => void;
    updateMod: (mod: Mod, dataMod: Mod) => void;
    makePackBackup: (mod: Mod) => void;
    forceModDownload: (mod: Mod) => void;
    unsubscribeToMod: (mod: Mod) => void;
    reMerge: (mod: Mod, modsToMerge: Mod[]) => void;
    deletePack: (mod: Mod) => void;
    forceDownloadMods: (modsIds: string[]) => void;
    mergeMods: (mods: Mod[]) => void;
    fakeUpdatePack: (mod: Mod) => void;
    handleLog: (callback: (event: Electron.IpcRendererEvent, msg: string) => void) => Electron.IpcRenderer;
    subscribedToMods: (
      callback: (event: Electron.IpcRendererEvent, ids: string[]) => void
    ) => Electron.IpcRenderer;
    createdMergedPack: (
      callback: (event: Electron.IpcRendererEvent, filePath: string) => void
    ) => Electron.IpcRenderer;
    fromAppConfig: (
      callback: (event: Electron.IpcRendererEvent, appState: AppState) => void
    ) => Electron.IpcRenderer;
    failedReadingConfig: (callback: (event: Electron.IpcRendererEvent) => void) => Electron.IpcRenderer;
    sendApiExists: () => void;
    readAppConfig: () => void;
    copyToData: (modPathsToCopy?: string[]) => void;
    cleanData: () => void;
    saveConfig: (appData: AppState) => void;
    readMods: (mods: Mod[], skipCollisionCheck = true) => void;
    getUpdateData: () => Promise<ModUpdateExists>;
    modsPopulated: (
      callback: (event: Electron.IpcRendererEvent, mods: Mod[]) => void
    ) => Electron.IpcRenderer;
    addMod: (callback: (event: Electron.IpcRendererEvent, mod: Mod) => void) => Electron.IpcRenderer;
    removeMod: (
      callback: (event: Electron.IpcRendererEvent, modPath: string) => void
    ) => Electron.IpcRenderer;
    setModData: (
      callback: (event: Electron.IpcRendererEvent, modDatas: ModData[]) => void
    ) => Electron.IpcRenderer;
    setPackHeaderData: (
      callback: (event: Electron.IpcRendererEvent, packData: PackData) => void
    ) => Electron.IpcRenderer;
    setPacksData: (
      callback: (event: Electron.IpcRendererEvent, packData: PackData) => void
    ) => Electron.IpcRenderer;
    setPacksDataRead: (
      callback: (event: Electron.IpcRendererEvent, packPaths: string[]) => void
    ) => Electron.IpcRenderer;
    setPackCollisions: (
      callback: (event: Electron.IpcRendererEvent, packCollisions: PackCollisions) => void
    ) => Electron.IpcRenderer;
    getAllModData: (ids: string[]) => void;
    savesPopulated: (
      callback: (event: Electron.IpcRendererEvent, saves: GameSave[]) => void
    ) => Electron.IpcRenderer;
    setIsDev: (callback: (event: Electron.IpcRendererEvent, isDev: boolean) => void) => Electron.IpcRenderer;
    packsInSave: (
      callback: (event: Electron.IpcRendererEvent, packNames: string[]) => void
    ) => Electron.IpcRenderer;
    setAppFolderPaths: (
      callback: (event: Electron.IpcRendererEvent, appFolderPaths: AppFolderPaths) => void
    ) => Electron.IpcRenderer;
    getCompatData: (pathsToUse?: string[]) => void;
    selectContentFolder: () => void;
    selectWarhammer3Folder: () => void;
    setContentFolder: (
      callback: (event: Electron.IpcRendererEvent, path: string) => void
    ) => Electron.IpcRenderer;
    setWarhammer3Folder: (
      callback: (event: Electron.IpcRendererEvent, path: string) => void
    ) => Electron.IpcRenderer;
    setOverwrittenDataPackedFiles: (
      callback: (
        event: Electron.IpcRendererEvent,
        overwrittenDataPackedFiles: Record<string, string[]>
      ) => void
    ) => Electron.IpcRenderer;
    setDataModLastChangedLocal: (
      callback: (event: Electron.IpcRendererEvent, dataModLastChangedLocal: number) => void
    ) => Electron.IpcRenderer;
    electronLog: electronLog;
  }

  type MergedModsData = {
    path: string;
    lastChanged: number;
    humanName: string;
    name: string;
  };

  interface Mod {
    humanName: string;
    name: string;
    path: string;
    imgPath: string;
    workshopId: string;
    isEnabled: boolean;
    modDirectory: string;
    isInData: boolean;
    lastChanged?: number;
    lastChangedLocal?: number;
    loadOrder: number | undefined;
    author: string;
    isDeleted: boolean;
    isMovie: boolean;
    dependencyPacks?: string[];
    reqModIdToName?: [string, string][];
    size: number;
    mergedModsData?: MergedModsData[];
    subbedTime?: number;
  }

  interface ModData {
    humanName: string;
    workshopId: string;
    reqModIdToName: [string, string][];
    lastChanged: number;
    author: string;
    isDeleted: boolean;
  }

  interface PackHeaderData {
    path: string;
    isMovie: boolean;
    dependencyPacks: string[];
  }

  interface FetchedModData {
    id: string;
    name: string;
    author: string;
  }

  interface Preset {
    mods: Mod[];
    name: string;
  }
  interface NewMergedPack {
    path: string;
    creationTime: number;
  }

  interface AppState {
    currentPreset: Preset;
    presets: Preset[];
    lastSelectedPreset: Preset | null;
    filter: string;
    alwaysEnabledMods: Mod[];
    hiddenMods: Mod[];
    saves: GameSave[];
    isOnboardingToRun: boolean;
    wasOnboardingEverRun: boolean;
    areThumbnailsEnabled: boolean;
    isAuthorEnabled: boolean;
    isDev: boolean;
    isMakeUnitsGeneralsEnabled: boolean;
    isScriptLoggingEnabled: boolean;
    isSkipIntroMoviesEnabled: boolean;
    isAutoStartCustomBattleEnabled: boolean;
    allMods: Mod[];
    packsData: Record<string, Pack>;
    packCollisions: PackCollisions;
    dataFromConfig?: AppStateToWrite;
    newMergedPacks: NewMergedPack[];
    pathsOfReadPacks: string[];
    appFolderPaths: AppFolderPaths;
    isSetAppFolderPathsDone: boolean;
    overwrittenDataPackedFiles: Record<string, string[]>;
    dataModLastChangedLocal?: number;
  }

  type AppStateToWrite = Pick<
    AppState,
    | "currentPreset"
    | "alwaysEnabledMods"
    | "hiddenMods"
    | "wasOnboardingEverRun"
    | "presets"
    | "isAuthorEnabled"
    | "areThumbnailsEnabled"
    | "isMakeUnitsGeneralsEnabled"
    | "isScriptLoggingEnabled"
    | "isSkipIntroMoviesEnabled"
    | "appFolderPaths"
    | "isAutoStartCustomBattleEnabled"
  >;

  type StartGameOptions = Pick<
    AppState,
    | "isMakeUnitsGeneralsEnabled"
    | "isSkipIntroMoviesEnabled"
    | "isScriptLoggingEnabled"
    | "isAutoStartCustomBattleEnabled"
  >;

  interface ModLoadOrderPayload {
    modName: string;
    loadOrder: number;
    originalOrder?: number;
  }

  interface ModUpdateExists {
    updateExists: boolean;
    downloadURL?: string;
  }

  type ModIdAndLoadOrder = Pick<Mod, "workshopId" | "loadOrder">;

  interface GameSave {
    name: string;
    lastChanged: number;
  }

  type PresetSelection = "unary" | "addition" | "subtraction";

  interface ModWithDefinedReqModIdToName extends Omit<Mod, "reqModIdToName"> {
    reqModIdToName: [string, string][];
  }

  interface ModWithDefinedMergedModsData extends Omit<Mod, "mergedModsData"> {
    mergedModsData: MergedModsData[];
  }

  interface GameUpdateData {
    timestamp: string;
  }
}
