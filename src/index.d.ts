export {};

declare global {
  interface Window {
    api?: api;
  }

  interface api {
    getAppData: () => AppData;
    writeUserScript: (mods: Mod[]) => void;
    handleLog: (callback: (event: Electron.IpcRendererEvent, string) => void) => Electron.IpcRenderer;
    fromAppConfig: (
      callback: (event: Electron.IpcRendererEvent, appState: AppState) => void
    ) => Electron.IpcRenderer;
    sendApiExists: () => void;
    readAppConfig: () => void;
    saveConfig: (appData: AppState) => void;
    getModData: (id: string) => Promise<{ id: string; name: string }>;
    modsPopulated: (
      callback: (event: Electron.IpcRendererEvent, mods: Mod[]) => void
    ) => Electron.IpcRenderer;
    setModData: (
      callback: (event: Electron.IpcRendererEvent, modData: ModData) => void
    ) => Electron.IpcRenderer;
    getAllModData: (ids: string[]) => void;
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
  }

  interface ModData {
    humanName: string;
    workshopId: string;
    reqModIds: string[];
  }

  interface Preset {
    mods: Mod[];
    name: string;
  }

  interface AppData {
    presets: Preset[];
    gamePath: string;
  }

  interface AppState {
    currentPreset: Preset;
    presets: Preset[];
    lastSelectedPreset: Preset | null;
    filter: string;
  }
}

// declare const api: {
//   getMods: () => Mod[];
//   doThing: () => void;
// };
