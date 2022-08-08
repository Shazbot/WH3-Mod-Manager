export {};

declare global {
  interface Window {
    api?: api;
  }

  interface api {
    writeUserScript: (mods: Mod[], saveName?: string) => void;
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
    getModData: (id: string) => Promise<{ id: string; name: string }>;
    getUpdateData: () => Promise<ModUpdateExists>;
    modsPopulated: (
      callback: (event: Electron.IpcRendererEvent, mods: Mod[]) => void
    ) => Electron.IpcRenderer;
    setModData: (
      callback: (event: Electron.IpcRendererEvent, modData: ModData) => void
    ) => Electron.IpcRenderer;
    getAllModData: (ids: string[]) => void;
    savesPopulated: (
      callback: (event: Electron.IpcRendererEvent, saves: GameSave[]) => void
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
  }

  interface ModData {
    humanName: string;
    workshopId: string;
    reqModIds: string[];
    lastChanged: number;
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
  }

  type AppStateToSave = Pick<
    AppState,
    "currentPreset" | "alwaysEnabledMods" | "hiddenMods" | "wasOnboardingEverRun" | "presets"
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
}
