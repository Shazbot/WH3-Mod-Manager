import { PackedFile, PackCollisions } from "./packFileTypes";
import { GameFolderPaths } from "./appData";
import { api } from "./preload";
import { SupportedGames } from "./supportedGames";
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
    version?: number;
  }
  interface NewMergedPack {
    path: string;
    creationTime: number;
  }

  interface AppState {
    categories: string[];
    currentPreset: Preset;
    importedMods: ModIdAndLoadOrder[];
    presets: Preset[];
    lastSelectedPreset: Preset | null;
    filter: string;
    alwaysEnabledMods: Mod[];
    hiddenMods: Mod[];
    saves: GameSave[];
    isOnboardingToRun: boolean;
    hasConfigBeenRead: boolean;
    wasOnboardingEverRun: boolean;
    areThumbnailsEnabled: boolean;
    lastModThatWasRead: ModReadingInfo | undefined;
    currentlyReadingMod: ModReadingInfo | undefined;
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
    packCollisionsCheckProgress: PackCollisionsCheckProgressData;
    dataFromConfig?: AppStateToRead;
    newMergedPacks: NewMergedPack[];
    pathsOfReadPacks: string[];
    appFolderPaths: GameFolderPaths;
    isSetAppFolderPathsDone: boolean;
    overwrittenDataPackedFiles: Record<string, string[]>;
    outdatedPackFiles: Record<string, string[]>;
    dataModLastChangedLocal?: number;
    currentDBTableSelection?: DBTableSelection;
    currentTab: MainWindowTab;
    isCreateSteamCollectionOpen: boolean;
    isImportSteamCollectionOpen: boolean;
    isHelpOpen: boolean;
    isWH3Running: boolean;
    toasts: Toast[];
    removedModsCategories: Record<string, string[]>;
    dataModsToEnableByName: string[];
    removedModsData: RemovedModData[];
    modRowsSortingType: SortingType;
    availableLanguages: string[];
    currentLanguage: string;
    packDataOverwrites: Record<string, PackDataOverwrite[]>;
    modBeingCustomized: Mod | undefined;
    customizableMods: Record<string, string[]>;
    currentGame: SupportedGames;
    steamCollectionsToImport: Record<string, ImportSteamCollection>;
  }

  type;

  type AppStateToWrite = Pick<
    AppState,
    | "alwaysEnabledMods"
    | "hiddenMods"
    | "wasOnboardingEverRun"
    | "isAuthorEnabled"
    | "areThumbnailsEnabled"
    | "isMakeUnitsGeneralsEnabled"
    | "isScriptLoggingEnabled"
    | "isSkipIntroMoviesEnabled"
    | "isAutoStartCustomBattleEnabled"
    | "isClosedOnPlay"
    | "categories"
    | "modRowsSortingType"
    | "currentLanguage"
    | "currentGame"
    | "packDataOverwrites"
  > &
    AppStateMainProcessExtras;

  // main process (index.ts) specific properties that are writtend and read from the app config file
  type AppStateMainProcessExtras = {
    gameFolderPaths: Record<SupportedGames, GameFolderPaths>;
    gameToCurrentPreset: Record<SupportedGames, Preset | undefined>;
    gameToPresets: Record<SupportedGames, Preset[]>;
  };

  // renderer redux app state specific properties
  type AppStateRendererExtras = {
    appFolderPaths: GameFolderPaths;
    presets: Preset[];
    currentPreset: Preset;
  };

  type AppStateToWriteWithDeprecatedProperties = AppStateToWrite & AppStateRendererExtras;

  type AppStateWithRendererExtras = AppStateToWrite & AppStateRendererExtras;

  type AppStateToRead = Omit<AppStateWithRendererExtras, keyof AppStateMainProcessExtras>;

  type StartGameSpecificOptions = Pick<
    AppState,
    | "isMakeUnitsGeneralsEnabled"
    | "isSkipIntroMoviesEnabled"
    | "isScriptLoggingEnabled"
    | "isAutoStartCustomBattleEnabled"
  >;

  type StartGameOptions = StartGameSpecificOptions & Pick<AppState, "isClosedOnPlay" | "packDataOverwrites">;

  interface ModLoadOrderPayload {
    modName: string;
    loadOrder: number;
    originalOrder?: number;
  }

  interface SetCurrentGamePayload {
    game: SupportedGames;
    currentPreset: Preset;
    presets: Preset[];
  }

  interface ModLoadOrderRelativeTo {
    modNameToChange: string;
    modNameRelativeTo: string;
    visualModList: Mods[];
    setAfterMod?: boolean;
  }

  interface ModUpdateExists {
    updateExists: boolean;
    downloadURL?: string;
    releaseNotesURL?: string;
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
    packedFiles: Record<string, PackedFile>;
  }

  interface PackReadingOptions {
    skipParsingTables?: boolean;
    tablesToRead?: string[];
    readLocs?: boolean;
    readScripts?: boolean;
  }

  interface Toast {
    type: ToastType;
    messages: string[];
    duration?: number;
    startTime: number;
    isDismissed?: boolean;
    staticToastId?: string;
  }

  interface ImportSteamCollection {
    name: string;
    modIds: string[];
    isImmediateImport: boolean;
    doDisableOtherMods: boolean;
    isLoadOrdered: boolean;
    doCreatePreset: boolean;
    presetName: string;
    isPresetLoadOrdered: boolean;
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

  interface PackDataOverwrite {
    packFilePath: string;
    columnsId: string;
    columnIndices: number[];
    columnValues: PlainPackDataTypes[];
    operation: PackDataOverwriteOperation;
    overwriteIndex?: number;
    overwriteData?: PlainPackDataTypes;
  }

  type PackDataOverwriteOperation = "REMOVE" | "APPEND" | "EDIT";

  type PlainPackDataTypes = string | boolean;
  type PlainPackFileDataRow = PlainPackDataTypes[];
  type PlainPackFileData = PlainPackFileDataRow[];

  interface PackDataOverwritePayload {
    packName: string;
    packFilePath: string;
    columnsId: string;
    columnIndices: number[];
    columnValues: PlainPackDataTypes[];
    operation: PackDataOverwriteOperation;
    overwriteIndex?: number;
    overwriteData?: PlainPackDataTypes;
  }

  interface SetIsModEnabledPayload {
    mod: Mod;
    isEnabled: boolean;
  }

  interface RemovedModData {
    isEnabled: boolean;
    modPath: string;
    indexInMods: number;
    loadOrder?: number;
    time: number;
  }

  type ToastType = "success" | "warning" | "info";

  type MainWindowTab = "mods" | "enabledMods" | "categories";

  export interface WorkshopItemStringInsteadOfBigInt {
    publishedFileId: string;
    creatorAppId?: number;
    consumerAppId?: number;
    title: string;
    description: string;
    owner: PlayerSteamIdStringInsteadOfBigInt;
    /** Time created in unix epoch seconds format */
    timeCreated: number;
    /** Time updated in unix epoch seconds format */
    timeUpdated: number;
    banned: boolean;
    acceptedForUse: boolean;
    tags: Array<string>;
    tagsTruncated: boolean;
    url: string;
    numUpvotes: number;
    numDownvotes: number;
    numChildren: number;
    previewUrl?: string;
  }

  export interface PlayerSteamIdStringInsteadOfBigInt {
    steamId64: string;
    steamId32: string;
    accountId: number;
  }

  interface TreeNode {
    children: TreeNode[];
    key: string;
    value?: string;
  }
  interface Tree {
    node: TreeNode;
  }

  interface PackCollisionsCheckProgressData {
    currentIndex: number;
    maxIndex: number;
    firstPackName: string;
    secondPackName: string;
    type: PackCollisionCheckType;
  }

  interface ModReadingInfo {
    name: string;
    time: number;
  }

  type OnPackChecked = (
    currentIndex: number,
    maxIndex: number,
    firstPackName: string,
    secondPackName: string,
    type: PackCollisionCheckType
  ) => void;

  type PackCollisionCheckType = "Files" | "TableKeys" | "MissingKeys";

  interface PacksAnalysisData {
    uniqueIdsCollisions: Record<string, UniqueIdsCollision[]>;
    missingRefs: Record<string, DBRefOrigin[]>;
    scriptListenerCollisions: Record<string, ScriptListenerCollision[]>;
  }
}
