export {};

declare global {
  interface Window {
    api?: api;
  }

  interface api {
    startGame: (mods: Mod[], startGameOptions: StartGameOptions, saveName?: string) => void;
    openFolderInExplorer: (path: string) => void;
    openInSteam: (url: string) => void;
    openPack: (path: string) => void;
    putPathInClipboard: (path: string) => void;
    handleLog: (callback: (event: Electron.IpcRendererEvent, string) => void) => Electron.IpcRenderer;
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
    setModData: (
      callback: (event: Electron.IpcRendererEvent, modData: ModData) => void
    ) => Electron.IpcRenderer;
    setPackData: (
      callback: (event: Electron.IpcRendererEvent, packData: PackData) => void
    ) => Electron.IpcRenderer;
    getAllModData: (ids: string[]) => void;
    savesPopulated: (
      callback: (event: Electron.IpcRendererEvent, saves: GameSave[]) => void
    ) => Electron.IpcRenderer;
    setIsDev: (callback: (event: Electron.IpcRendererEvent, boolean) => void) => Electron.IpcRenderer;
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

  interface PackData {
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

  interface AppData {
    presets: Preset[];
    gamePath: string;
    contentFolder: string | undefined;
    dataFolder: string | undefined;
    gameSaves: GameSave[];
    saveSetupDone: boolean;
    isMakeUnitsGeneralsEnabled: boolean;
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

  interface GameSave {
    name: string;
    lastChanged: number;
  }

  type PresetSelection = "unary" | "addition" | "subtraction";
}
