import { PackedFile, PackCollisions } from "./packFileTypes";
import { AppFolderPaths } from "./appData";
import { DBVersion } from "./schema";
import { api } from "./preload";
export {};

declare global {
  interface Window {
    api?: api;
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
    isSymbolicLink: boolean;
    categories?: string[];
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
    categories: string[];
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
    isClosedOnPlay: boolean;
    isAuthorEnabled: boolean;
    isDev: boolean;
    isAdmin: boolean;
    startArgs: string[];
    isMakeUnitsGeneralsEnabled: boolean;
    isScriptLoggingEnabled: boolean;
    isSkipIntroMoviesEnabled: boolean;
    isAutoStartCustomBattleEnabled: boolean;
    allMods: Mod[];
    packsData: Record<string, PackViewData>;
    packCollisions: PackCollisions;
    dataFromConfig?: AppStateToWrite;
    newMergedPacks: NewMergedPack[];
    pathsOfReadPacks: string[];
    appFolderPaths: AppFolderPaths;
    isSetAppFolderPathsDone: boolean;
    overwrittenDataPackedFiles: Record<string, string[]>;
    outdatedPackFiles: Record<string, string[]>;
    dataModLastChangedLocal?: number;
    currentDBTableSelection?: DBTableSelection;
    currentTab: MainWindowTab;
    isCreateSteamCollectionOpen: boolean;
    isWH3Running: boolean;
    toasts: Toast[];
    removedModsCategories: Record<string, string[]>;
    dataModsToEnableByName: string[];
    removedEnabledModPaths: string[];
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
    | "isClosedOnPlay"
    | "categories"
  >;

  type StartGameOptions = Pick<
    AppState,
    | "isMakeUnitsGeneralsEnabled"
    | "isSkipIntroMoviesEnabled"
    | "isScriptLoggingEnabled"
    | "isAutoStartCustomBattleEnabled"
    | "isClosedOnPlay"
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

  type SelectOperation = "unary" | "addition" | "subtraction";

  interface ModWithDefinedReqModIdToName extends Omit<Mod, "reqModIdToName"> {
    reqModIdToName: [string, string][];
  }

  interface ModWithDefinedMergedModsData extends Omit<Mod, "mergedModsData"> {
    mergedModsData: MergedModsData[];
  }

  interface IGameUpdateDataSelection {
    regex: string;
    reason: string;
  }

  interface GameUpdateData {
    timestamp: string;
    version?: string;
    files?: IGameUpdateDataSelection[];
  }

  interface DBTable {
    dbName: string;
    dbSubname: string;
  }

  interface DBTableSelection extends DBTable {
    packPath: string;
  }

  interface PackViewData {
    packName: string;
    packPath: string;
    tables: string[];
    currentTable?: PackedFile;
    currentTableSchema?: DBVersion;
  }

  interface PackReadingOptions {
    skipParsingTables?: boolean;
    tablesToRead?: string[];
  }

  interface Toast {
    type: ToastType;
    messages: string[];
    duration?: number;
    startTime: number;
    isDismissed?: boolean;
  }

  interface AddCategoryPayload {
    mods: Mod[];
    category: string;
  }

  interface RemoveCategoryPayload {
    mods: Mod[];
    category: string;
  }

  interface AddCategoryPayload {
    mods: Mod[];
    category: string;
  }

  interface CategorySelectionPayload {
    mods: Mod[];
    category: string;
    selectOperation: SelectOperation;
  }

  interface SetIsModEnabledPayload {
    mod: Mod;
    isEnabled: boolean;
  }

  type ToastType = "success" | "warning" | "info";

  type MainWindowTab = "mods" | "enabledMods" | "categories";
}
