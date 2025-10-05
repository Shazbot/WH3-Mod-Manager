import { PackedFile, PackCollisions } from "./packFileTypes";
import { GameFolderPaths } from "./appData";
import { api } from "./preload";
import { SupportedGames } from "./supportedGames";
import { UgcItemVisibility } from "../node_modules/steamworks.js/client.d";
import { string } from "ts-pattern/dist/patterns";
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
    tags: string[];
    isInModding?: boolean;
  }

  interface ModData {
    humanName: string;
    workshopId: string;
    reqModIdToName: [string, string][];
    lastChanged: number;
    author: string;
    isDeleted: boolean;
    subscriptionTime: number;
    tags: string[];
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

  interface DeepCloneTarget {
    col: number;
    row: number;
  }

  interface TableReferenceRequest {
    key: string;
    tableName: string;
    tableColumnName: string;
  }

  interface SetPackDataStorePayload {
    packPath: string;
    pack: Pack;
  }

  interface SetUnsavedPacksDataPayload {
    packPath: string;
    unsavedFileData: PackedFile[];
  }

  interface AppState {
    categories: string[];
    categoryColors: Record<string, string>;
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
    isCompatCheckingVanillaPacks: boolean;
    isAuthorEnabled: boolean;
    isDev: boolean;
    isAdmin: boolean;
    startArgs: string[];
    isMakeUnitsGeneralsEnabled: boolean;
    isScriptLoggingEnabled: boolean;
    isSkipIntroMoviesEnabled: boolean;
    isAutoStartCustomBattleEnabled: boolean;
    isChangingGameProcessPriority: boolean;
    allMods: Mod[];
    packsData: Record<string, PackViewData>;
    unsavedPacksData: Record<string, PackedFile[]>;
    packCollisions: PackCollisions;
    packCollisionsCheckProgress: PackCollisionsCheckProgressData;
    dataFromConfig?: AppStateToRead;
    newMergedPacks: NewMergedPack[];
    pathsOfReadPacks: string[];
    appFolderPaths: GameFolderPaths;
    isSetAppFolderPathsDone: boolean;
    requestFolderPathsForGame: SupportedGames | undefined;
    overwrittenDataPackedFiles: Record<string, string[]>;
    outdatedPackFiles: Record<string, string[]>;
    dataModLastChangedLocal?: number;
    currentDBTableSelection?: DBTableSelection;
    currentFlowFileSelection?: string;
    currentTab: MainWindowTab;
    isCreateSteamCollectionOpen: boolean;
    isImportSteamCollectionOpen: boolean;
    isPackSearcherOpen: boolean;
    isHelpOpen: boolean;
    isWH3Running: boolean;
    toasts: Toast[];
    removedModsCategories: Record<string, string[]>;
    dataModsToEnableByName: string[];
    removedModsData: RemovedModData[];
    modRowsSortingType: SortingType;
    availableLanguages: string[];
    currentLanguage?: SupportedLanguages;
    currentLocalization: Record<string, string>;
    packDataOverwrites: Record<string, PackDataOverwrite[]>;
    modBeingCustomized: Mod | undefined;
    customizableMods: Record<string, string[]>;
    currentGame: SupportedGames;
    steamCollectionsToImport: Record<string, ImportSteamCollection>;
    isModTagPickerOpen: boolean;
    currentModToUpload: Mod | undefined;
    skillsData?: SkillsData;
    packSearchResults?: string[];
    userFlowOptions: UserFlowOptions;

    // DB viewer
    deepCloneTarget?: DeepCloneTarget;
    deepClonereferencesHashTarget?: string;
    referencesHash?: string;
    // packDataStore: Record<string, Pack>;

    //skills view
    isLocalizingSubtypes: boolean;
    skillNodesToLevel: Record<string, number>;
    currentRank: number;
  }

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
    | "isChangingGameProcessPriority"
    | "isClosedOnPlay"
    | "categories"
    | "categoryColors"
    | "modRowsSortingType"
    | "currentLanguage"
    | "currentGame"
    | "packDataOverwrites"
    | "isCompatCheckingVanillaPacks"
    | "userFlowOptions"
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

  type StartGameOptions = StartGameSpecificOptions &
    Pick<AppState, "isClosedOnPlay" | "packDataOverwrites" | "userFlowOptions">;

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
    filesToRead?: string[];
    skipSorting?: boolean;
    readFlows?: boolean;
  }

  interface UserFlowOptionValues {
    optionValues: Record<string, any>; // option id -> value
    graphEnabled?: boolean; // only if the flow has isGraphEnabled
  }

  type UserFlowOptions = Record<string, Record<string, UserFlowOptionValues>>; // packPath -> flowFileName -> values

  type ToastType = "info" | "success" | "warning";

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

  interface RenameCategoryPayload {
    oldCategory: string;
    newCategory: string;
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
    tags: string[];
  }

  interface EffectData {
    key: string;
    icon: string;
    isPositive: string;
    priority: string;
  }

  interface Effect {
    key: string;
    localizedKey?: string;
    effectScope: string;
    level: number;
    value: string;
    effectKey: string;
    icon?: string;
    iconData: string;
    priority: string;
  }
  interface Skill {
    title: string;
    localizedTitle?: string;
    description: string;
    localizedDescription?: string;
    x: number;
    y: number;
    img: string;
    effects: Effect[];
    id: string;
    linkedToNode?: string | undefined;
    group?: string;
    maxLevel: number;
    origIndent: string;
    origTier: string;
    isHiddentInUI: boolean;
    nodeId: string;
    faction?: string;
    subculture?: string;
    unlockRank: number;
  }
  interface SkillsData {
    // subtypeToSkills: Record<string, Skill[]>;
    currentSubtype: string;
    currentSubtypeIndex: number;
    currentSkills: Skill[];
    subtypeToNumSets: subtypeToNumSets;
    nodeLinks: Record<
      string,
      {
        child: string;
        childLinkPosition?: string;
        parentLinkPosition?: string;
        linkType?: "REQUIRED" | "SUBSET_REQUIRED";
      }[]
    >;
    nodeRequirements: Record<string, { single: string[]; multiple: string[]; numMultiple: number }>;
    icons: Record<string, string>;
    subtypes: string[];
    subtypesToLocalizedNames: Record<string, string>;
    nodeToSkillLocks: NodeToSkillLocks;
  }

  Record<string, [string, string][]>;

  type SkillAndLevel = [string, number];
  type NodeToSkillLocks = Record<string, SkillAndLevel[]>;

  type MainWindowTab = "mods" | "enabledMods" | "categories" | "nodeEditor";

  export interface WorkshopItemStatisticStringified {
    numSubscriptions: string;
    numFavorites: string;
    numFollowers: string;
    numUniqueSubscriptions: string;
    numUniqueFavorites: string;
    numUniqueFollowers: string;
    numUniqueWebsiteViews: string;
    reportScore: string;
    numSecondsPlayed: string;
    numPlaytimeSessions: string;
    numComments: string;
    numSecondsPlayedDuringTimePeriod: string;
    numPlaytimeSessionsDuringTimePeriod: string;
  }
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
    /** Time when the user added the published item to their list (not always applicable), provided in Unix epoch format (time since Jan 1st, 1970). */
    timeAddedToUserList: number;
    visibility: UgcItemVisibility;
    banned: boolean;
    acceptedForUse: boolean;
    tags: Array<string>;
    tagsTruncated: boolean;
    url: string;
    numUpvotes: number;
    numDownvotes: number;
    numChildren: number;
    previewUrl?: string;
    statistics: WorkshopItemStatisticStringified;
  }

  export interface PlayerSteamIdStringInsteadOfBigInt {
    steamId64: string;
    steamId32: string;
    accountId: number;
  }

  interface TreeNode<T> {
    children: TreeNode<T>[];
    key: string;
    value?: T;
  }
  type RootNode<T> = Omit<TreeNode<T>, "key">;
  interface Tree<T> {
    node: RootNode<T>;
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
    packFileAnalysisErrors: Record<string, Record<DBFileName, FileAnalysisError[]>>;
  }

  type ModUpdateResponse = {
    type: string;
  };

  type ModUpdateResponseSuccess = ModUpdateResponse & {
    type: "success";
    needsToAcceptAgreement: boolean;
  };
  type ModUpdateResponseError = ModUpdateResponse & {
    type: "error";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    err: any;
  };
  type ModUpdateResponseProgress = ModUpdateResponse & {
    type: "progress";
    progress: number;
    total: number;
  };

  type ModUploadResponseSuccess = ModUpdateResponse & {
    type: "success";
    workshopId: string;
    needsToAcceptAgreement: boolean;
  };
  type ModUploadResponseError = ModUpdateResponse & {
    type: "error";
  };

  interface ITreeNode {
    name: string;
    children: ITreeNode[];
  }

  interface IViewerTreeNode {
    name: string;
    children: ITreeNode[];
    isIndirectRef?: boolean;
  }

  interface IViewerTreeNodeWithData extends IViewerTreeNode {
    tableName: string;
    columnName: string;
    value: string;
  }

  type DBCell = [tableName: string, tableColumnName: string, resolveKeyValue: string];

  interface DBCloneSaveOptions {
    isAppendSave: boolean;
    savePackedFileName: string;
    savePackFileName: string;
  }

  type NodeEdgeTypes =
    | "PackFiles"
    | "DBData"
    | "TableSelection"
    | "ColumnSelection"
    | "ChangedColumnSelection"
    | "Text"
    | "Text Lines"
    | "GroupedText";

  type FlowNodeType =
    | "packedfiles"
    | "packfilesdropdown"
    | "tableselection"
    | "tableselectiondropdown"
    | "columnselection"
    | "columnselectiondropdown"
    | "groupbycolumns"
    | "numericadjustment"
    | "savechanges"
    | "textsurround"
    | "textjoin"
    | "groupedcolumnstotext";

  // FlowNodeData = "string"|

  interface NodeExecutionRequest {
    nodeId: string;
    nodeType: string;
    textValue: string;
    inputData: any;
  }

  interface NodeExecutionResult {
    success: boolean;
    data?:
      | PackFilesNodeData
      | DBTablesNodeData
      | DBColumnSelectionNodeData
      | DBNumericAdjustmentNodeData
      | DBSaveChangesNodeData
      | GroupedTextNodeData
      | TextNodeData;
    error?: string;
  }

  interface PackFilesNodeFile {
    name: string;
    path: string;
    loaded: boolean;
    error?: Error | string;
  }

  interface PackFilesNodeData {
    type: "PackFiles";
    files: PackFilesNodeFile[];
    count: number;
    loadedCount: number;
  }

  interface DBTablesNodeTable {
    name: string;
    fileName: string;
    sourceFile: Pack;
    table: PackedFile;
  }

  interface DBTablesNodeData {
    type: "TableSelection";
    tables: DBTablesNodeTable[];
    sourceFiles: PackFilesNodeFile[];
    tableCount: number;
  }

  interface DBColumnSelectionTableValues {
    tableName: string;
    fileName: string;
    sourcePack: Pack;
    sourceTable: PackedFile;
    selectedColumns: string[];
    data: { col: string; data: string }[];
  }

  interface DBColumnSelectionNodeData {
    type: "ColumnSelection";
    columns: DBColumnSelectionTableValues[];
    sourceTables: DBTablesNodeTable[];
    selectedColumnCount: number;
  }

  interface DBNumericAdjustmentNodeData {
    type: "ChangedColumnSelection";
    appliedFormula: string;
    adjustedInputData: DBColumnSelectionNodeData;
    originalData: DBColumnSelectionNodeData;
  }

  interface DBSaveChangesNodeData {
    type: "SaveResult";
    savedTo: string;
    format: string;
    fileName?: string;
    message: string;
  }

  interface GroupedTextNodeData {
    type: "GroupedText";
    text: string[];
    textLines: string[][];
    groupCount?: number;
  }

  interface TextNodeData {
    type: "Text";
    text: string;
  }
}
