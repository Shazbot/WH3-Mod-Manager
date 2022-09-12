import { PackCollisions } from "./packFileTypes";
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
    fakeUpdatePack: (mod: Mod) => void;
    handleLog: (callback: (event: Electron.IpcRendererEvent, msg: string) => void) => Electron.IpcRenderer;
    subscribedToMods: (
      callback: (event: Electron.IpcRendererEvent, ids: string[]) => void
    ) => Electron.IpcRenderer;
    fromAppConfig: (
      callback: (event: Electron.IpcRendererEvent, appState: AppState) => void
    ) => Electron.IpcRenderer;
    failedReadingConfig: (callback: (event: Electron.IpcRendererEvent) => void) => Electron.IpcRenderer;
    sendApiExists: () => void;
    readAppConfig: () => void;
    copyToData: () => void;
    cleanData: () => void;
    saveConfig: (appData: AppState) => void;
    getUpdateData: () => Promise<ModUpdateExists>;
    modsPopulated: (
      callback: (event: Electron.IpcRendererEvent, mods: Mod[]) => void
    ) => Electron.IpcRenderer;
    addMod: (callback: (event: Electron.IpcRendererEvent, mod: Mod) => void) => Electron.IpcRenderer;
    removeMod: (
      callback: (event: Electron.IpcRendererEvent, modPath: string) => void
    ) => Electron.IpcRenderer;
    setModData: (
      callback: (event: Electron.IpcRendererEvent, modData: ModData) => void
    ) => Electron.IpcRenderer;
    setPackHeaderData: (
      callback: (event: Electron.IpcRendererEvent, packData: PackData) => void
    ) => Electron.IpcRenderer;
    setPacksData: (
      callback: (event: Electron.IpcRendererEvent, packData: PackData) => void
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
  }

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
    loadOrder: number | undefined;
    author: string;
    isDeleted: boolean;
    isMovie: boolean;
  }

  interface ModData {
    humanName: string;
    workshopId: string;
    reqModIds: string[];
    lastChanged: number;
    author: string;
    isDeleted: boolean;
  }

  interface PackHeaderData {
    path: string;
    isMovie: boolean;
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
    allMods: Mod[];
    packsData: Record<string, Pack>;
    packCollisions: PackCollisions;
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
  >;

  type StartGameOptions = Pick<
    AppState,
    "isMakeUnitsGeneralsEnabled" | "isSkipIntroMoviesEnabled" | "isScriptLoggingEnabled"
  >;

  interface ModLoadOrderPayload {
    modName: string;
    loadOrder: number;
    originalOrder: number;
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
}
