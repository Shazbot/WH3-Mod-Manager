import { ipcRenderer } from "electron";
import { DBFieldName, DBFileName, DBVersion, Pack, PackCollisions, PackedFile } from "./packFileTypes";
import { GameFolderPaths } from "./appData";
import { SupportedGames } from "./supportedGames";
import debounce from "just-debounce-it";
import "electron-log/preload";
import type {
  UnitViewerAssetsPrewarmResponse,
  UnitViewerCatalogResponse,
  UnitViewerDetailsResponse,
} from "./unitViewer/types";
import type {
  BuildingsCaiRowsResponse,
  BuildingsCatalogResponse,
  BuildingsRegionQuery,
  BuildingsRegionViewResponse,
} from "./buildingsData/types";
import type { BuildingsEditState } from "./buildingsData/edits";
import type { AncillariesCatalogResponse, AncillariesDetailResponse } from "./ancillariesData/types";
import type { AncillariesEditState } from "./ancillariesData/edits";
import type {
  GlobalSearchProgress,
  GlobalSearchRequest,
  GlobalSearchResponse,
  GlobalSearchResultBatch,
} from "./globalSearch/types";
import type { EsfMapResponse } from "./esfMap/types";
import type { PackRowsForSave } from "./utility/packRowsForSave";
import type { PackFileRenameEntry } from "./utility/packFileRenamePlan";
import type {
  CompressionAnalysisProgress,
  CompressionAnalysisRequest,
  CompressionAnalysisStartResponse,
  CompressPackRequest,
  CompressPackResponse,
} from "./compressionAnalysis";

console.log("IN PRELOAD");

const createWorkshopStagingRunId = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to the local fallback for older Electron runtimes.
  }
  return `workshop-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

const api = {
  startGame: (mods: Mod[], areModsInOrder: boolean, startGameOptions: StartGameOptions, name?: string) => {
    const usesWorkshopStaging =
      startGameOptions.workshopModStagingMode === "copy" || startGameOptions.workshopModStagingMode === "symlink";
    const runId = usesWorkshopStaging ? createWorkshopStagingRunId() : undefined;
    if (runId) ipcRenderer.send("startGame", mods, areModsInOrder, startGameOptions, name, runId);
    else ipcRenderer.send("startGame", mods, areModsInOrder, startGameOptions, name);
    return runId;
  },
  exportModsToClipboard: (mods: Mod[], availableMods: Mod[]) =>
    ipcRenderer.send("exportModsToClipboard", mods, availableMods),
  exportModNamesToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModNamesToClipboard", mods),
  createSteamCollection: (mods: Mod[]) => ipcRenderer.send("createSteamCollection", mods),
  importSteamCollection: (
    steamCollectionURL: string,
    isImmediateImport: boolean,
    doDisableOtherMods: boolean,
    isLoadOrdered: boolean,
    doCreatePreset: boolean,
    presetName: string,
    isPresetLoadOrdered: boolean,
  ) =>
    ipcRenderer.send(
      "importSteamCollection",
      steamCollectionURL,
      isImmediateImport,
      doDisableOtherMods,
      isLoadOrdered,
      doCreatePreset,
      presetName,
      isPresetLoadOrdered,
    ),
  subscribeToMods: (ids: string[]) => ipcRenderer.send("subscribeToMods", ids),
  openFolderInExplorer: (path: string) => ipcRenderer.send("openFolderInExplorer", path),
  openDirectoryInExplorer: (path: string) => ipcRenderer.send("openDirectoryInExplorer", path),
  openDiagnosticPath: (target: DiagnosticPathTarget, copyPath: boolean): Promise<DiagnosticPathResult> =>
    ipcRenderer.invoke("openDiagnosticPath", target, copyPath),
  openInSteam: (url: string) => ipcRenderer.send("openInSteam", url),
  openPack: (path: string) => ipcRenderer.send("openPack", path),
  getPacksInSave: (saveName: string) => ipcRenderer.send("getPacksInSave", saveName),
  requestSaves: () => ipcRenderer.send("requestSaves"),
  putPathInClipboard: (path: string) => ipcRenderer.send("putPathInClipboard", path),
  copyModToData: (path: string) => ipcRenderer.send("copyModToData", path),
  compareModsByteForByte: (
    modPath: string,
    workshopModPath: string,
  ): Promise<{ success: boolean; identical?: boolean; error?: string }> =>
    ipcRenderer.invoke("compareModsByteForByte", modPath, workshopModPath),
  updateMod: (mod: Mod, contentMod: Mod) => ipcRenderer.send("updateMod", mod, contentMod),
  uploadMod: (mod: Mod) => ipcRenderer.send("uploadMod", mod),
  fakeUpdatePack: (mod: Mod) => ipcRenderer.send("fakeUpdatePack", mod),
  makePackBackup: (mod: Mod) => ipcRenderer.send("makePackBackup", mod),
  forceModDownload: (mod: Mod) => ipcRenderer.send("forceModDownload", mod),
  unsubscribeToMod: (mod: Mod) => ipcRenderer.send("unsubscribeToMod", mod),
  reMerge: (mod: Mod, modsToMerge: Mod[]) => ipcRenderer.send("reMerge", mod, modsToMerge),
  deletePack: (mod: Mod) => ipcRenderer.send("deletePack", mod),
  forceDownloadMods: (modIds: string[]) => ipcRenderer.send("forceDownloadMods", modIds),
  repairOutdatedWorkshopMods: (requests: WorkshopModRepairRequest[]) =>
    ipcRenderer.send("repairOutdatedWorkshopMods", requests),
  cancelWorkshopRepairAndResubscribeMods: (mods: Mod[]) =>
    ipcRenderer.send("cancelWorkshopRepairAndResubscribeMods", mods),
  forceResubscribeMods: (mods: Mod[]) => ipcRenderer.send("forceResubscribeMods", mods),
  mergeMods: (mods: Mod[]) => ipcRenderer.send("mergeMods", mods),
  handleLog: (callback: (event: Electron.IpcRendererEvent, msg: string) => void) =>
    ipcRenderer.on("handleLog", callback),
  workshopUpdateCheck: (callback: (event: Electron.IpcRendererEvent, message: WorkshopUpdateCheckMessage) => void) =>
    ipcRenderer.on("workshopUpdateCheck", callback),
  subscribedToMods: (callback: (event: Electron.IpcRendererEvent, ids: string[]) => void) =>
    ipcRenderer.on("subscribedToMods", callback),
  createdMergedPack: (callback: (event: Electron.IpcRendererEvent, filePath: string) => void) =>
    ipcRenderer.on("createdMergedPack", callback),
  importSteamCollectionResponse: (
    callback: (event: Electron.IpcRendererEvent, importSteamCollection: ImportSteamCollection) => void,
  ) => ipcRenderer.on("importSteamCollectionResponse", callback),
  setIsDev: (callback: (event: Electron.IpcRendererEvent, isDev: boolean) => void) =>
    ipcRenderer.on("setIsDev", callback),
  setIsAdmin: (callback: (event: Electron.IpcRendererEvent, isAdmin: boolean) => void) =>
    ipcRenderer.on("setIsAdmin", callback),
  setCanCreateSymbolicLinks: (callback: (event: Electron.IpcRendererEvent, canCreate: boolean) => void) =>
    ipcRenderer.on("setCanCreateSymbolicLinks", callback),
  setIsWH3Running: (callback: (event: Electron.IpcRendererEvent, isWH3Running: boolean) => void) =>
    ipcRenderer.on("setIsWH3Running", callback),
  setStartArgs: (callback: (event: Electron.IpcRendererEvent, startArgs: string[]) => void) =>
    ipcRenderer.on("setStartArgs", callback),
  packsInSave: (callback: (event: Electron.IpcRendererEvent, packNames: string[]) => void) =>
    ipcRenderer.on("packsInSave", callback),
  enableModsByName: (callback: (event: Electron.IpcRendererEvent, packNames: string[]) => void) =>
    ipcRenderer.on("enableModsByName", callback),
  sendApiExists: () => ipcRenderer.send("sendApiExists"),
  rendererMainMounted: () => ipcRenderer.send("rendererMainMounted"),
  viewerIsReady: () => ipcRenderer.send("viewerIsReady"),
  skillsAreReady: () => ipcRenderer.send("skillsAreReady"),
  techTreesAreReady: () => ipcRenderer.send("techTreesAreReady"),
  requestOpenModInViewer: (modPath: string) => ipcRenderer.send("requestOpenModInViewer", modPath),
  viewerClosedPack: (packPath: string) => ipcRenderer.send("viewerClosedPack", packPath),
  setViewerActivePack: (packPath: string) => ipcRenderer.send("setViewerActivePack", packPath),
  requestOpenSkillsWindow: (mods: Mod[]) => ipcRenderer.send("requestOpenSkillsWindow", mods),
  requestSkillsData: (mods: Mod[]) => ipcRenderer.send("requestSkillsData", mods),
  requestOpenTechTreesWindow: () => ipcRenderer.send("requestOpenTechTreesWindow"),
  setSkillsViewOptions: (skillsViewOptions: SkillsViewOptions) =>
    ipcRenderer.send("setSkillsViewOptions", skillsViewOptions),
  openModInViewer: (callback: (event: Electron.IpcRendererEvent, modPath: string) => void) =>
    ipcRenderer.on("openModInViewer", callback),
  onSkillsViewOptions: (callback: (event: Electron.IpcRendererEvent, skillsViewOptions: SkillsViewOptions) => void) =>
    ipcRenderer.on("setSkillsViewOptions", callback),
  readAppConfig: () => ipcRenderer.send("readAppConfig"),
  copyToData: (modPathsToCopy?: string[]) => ipcRenderer.send("copyToData", modPathsToCopy),
  copyToDataAsSymbolicLink: (modPathsToCopy?: string[]) => ipcRenderer.send("copyToDataAsSymbolicLink", modPathsToCopy),
  cleanData: () => ipcRenderer.send("cleanData"),
  cleanSymbolicLinksInData: () => ipcRenderer.send("cleanSymbolicLinksInData"),
  getWorkshopModStagingInfo: (): Promise<{
    success: boolean;
    size?: number;
    hasContents?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("getWorkshopModStagingInfo"),
  clearWorkshopModStaging: (): Promise<{
    success: boolean;
    removed?: boolean;
    code?: "GAME_RUNNING" | "CLEANUP_FAILED";
    error?: string;
  }> => ipcRenderer.invoke("clearWorkshopModStaging"),
  getPackData: (packPath: string, table?: DBTable) => ipcRenderer.send("getPackData", packPath, table),
  getPackDataWithLocs: (packPath: string, table?: DBTable) => ipcRenderer.send("getPackDataWithLocs", packPath, table),
  saveConfig: (payload: ConfigSavePayload) => ipcRenderer.send("saveConfig", payload),
  readMods: debounce(
    (mods: Mod[], skipCollisionCheck = true, canUseCustomizableCache = true, customizableModsHash?: string) =>
      ipcRenderer.send("readMods", mods, skipCollisionCheck, canUseCustomizableCache, customizableModsHash),
    100,
  ),
  getUpdateData: () => ipcRenderer.invoke("getUpdateData"),
  downloadAndInstallUpdate: (downloadURL: string) => ipcRenderer.invoke("downloadAndInstallUpdate", downloadURL),
  translate: (translationId: string, options?: Record<string, string | number>) =>
    ipcRenderer.invoke("translate", translationId, options),
  translateAll: (translationIdsWithOptions: Record<string, Record<string, string | number>>) =>
    ipcRenderer.invoke("translateAll", translationIdsWithOptions),
  translateAllStatic: (translationIds: Record<string, string | number>) =>
    ipcRenderer.invoke("translateAllStatic", translationIds),
  startCompressionAnalysis: (request: CompressionAnalysisRequest): Promise<CompressionAnalysisStartResponse> =>
    ipcRenderer.invoke("startCompressionAnalysis", request),
  compressPack: (request: CompressPackRequest): Promise<CompressPackResponse> =>
    ipcRenderer.invoke("compressPack", request),
  cancelCompressionAnalysis: () => ipcRenderer.send("cancelCompressionAnalysis"),
  cancelWorkshopModStaging: (runId?: string) => ipcRenderer.send("cancelWorkshopModStaging", runId),
  onWorkshopModStagingProgress: (
    callback: (event: Electron.IpcRendererEvent, progress: WorkshopModStagingProgressEvent) => void,
  ) => {
    ipcRenderer.on("workshopModStagingProgress", callback);
    return () => ipcRenderer.removeListener("workshopModStagingProgress", callback);
  },
  onCompressionAnalysisProgress: (
    callback: (event: Electron.IpcRendererEvent, progress: CompressionAnalysisProgress) => void,
  ) => {
    ipcRenderer.on("compressionAnalysisProgress", callback);
    return () => ipcRenderer.removeListener("compressionAnalysisProgress", callback);
  },
  fromAppConfig: (callback: (event: Electron.IpcRendererEvent, config: ConfigForRenderer) => void) =>
    ipcRenderer.on("fromAppConfig", callback),
  failedReadingConfig: (callback: (event: Electron.IpcRendererEvent) => void) =>
    ipcRenderer.on("failedReadingConfig", callback),
  importModsFromUsedMods: (callback: (event: Electron.IpcRendererEvent, modNames: string[]) => void) =>
    ipcRenderer.on("importModsFromUsedMods", callback),
  modsPopulated: (callback: (event: Electron.IpcRendererEvent, mods: Mod[]) => void) =>
    ipcRenderer.on("modsPopulated", callback),
  addMod: (callback: (event: Electron.IpcRendererEvent, mod: Mod) => void) => ipcRenderer.on("addMod", callback),
  removeMod: (callback: (event: Electron.IpcRendererEvent, modPath: string) => void) =>
    ipcRenderer.on("removeMod", callback),
  setModData: (callback: (event: Electron.IpcRendererEvent, modDatas: ModData[]) => void) =>
    ipcRenderer.on("setModData", callback),
  setPackHeaderData: (callback: (event: Electron.IpcRendererEvent, packHeaderData: PackHeaderData[]) => void) =>
    ipcRenderer.on("setPackHeaderData", callback),
  setModLoadOrderRules: (
    callback: (event: Electron.IpcRendererEvent, modLoadOrderRules: Record<string, LoadOrderRule[]>) => void,
  ) => ipcRenderer.on("setModLoadOrderRules", callback),
  setPacksData: (callback: (event: Electron.IpcRendererEvent, packsData: PackViewData[]) => void) =>
    ipcRenderer.on("setPacksData", callback),
  applySavedPackData: (callback: (event: Electron.IpcRendererEvent, payload: ApplySavedPackDataPayload) => void) =>
    ipcRenderer.on("applySavedPackData", callback),
  setUnsavedPacksData: (
    callback: (event: Electron.IpcRendererEvent, packPath: string, unsavedFileData: PackedFile[]) => void,
  ) => ipcRenderer.on("setUnsavedPacksData", callback),
  setDeletedPackFilePaths: (
    callback: (event: Electron.IpcRendererEvent, packPath: string, deletedFilePaths: string[]) => void,
  ) => ipcRenderer.on("setDeletedPackFilePaths", callback),
  setSkillsData: (callback: (event: Electron.IpcRendererEvent, skillsData: SkillsData) => void) =>
    ipcRenderer.on("setSkillsData", callback),
  setPackCollisionsCheckProgress: (
    callback: (event: Electron.IpcRendererEvent, progressData: PackCollisionsCheckProgressData) => void,
  ) => ipcRenderer.on("setPackCollisionsCheckProgress", callback),
  onVanillaDbCacheBuildProgress: (
    callback: (event: Electron.IpcRendererEvent, progress: VanillaDbCacheBuildProgress) => void,
  ) => {
    ipcRenderer.on("vanillaDbCacheBuildProgress", callback);
    return () => {
      ipcRenderer.removeListener("vanillaDbCacheBuildProgress", callback);
    };
  },
  setPacksDataRead: (callback: (event: Electron.IpcRendererEvent, packPaths: string[]) => void) =>
    ipcRenderer.on("setPacksDataRead", callback),
  setPackCollisions: (callback: (event: Electron.IpcRendererEvent, packCollisions: PackCollisions) => void) =>
    ipcRenderer.on("setPackCollisions", callback),
  addToast: (callback: (event: Electron.IpcRendererEvent, toast: Toast) => void) =>
    ipcRenderer.on("addToast", callback),
  setDBDuplicationProgress: (callback: (event: Electron.IpcRendererEvent, progress: DBDuplicationProgress) => void) =>
    ipcRenderer.on("setDBDuplicationProgress", callback),
  setAppFolderPaths: (callback: (event: Electron.IpcRendererEvent, appFolderPaths: GameFolderPaths) => void) =>
    ipcRenderer.on("setAppFolderPaths", callback),
  requestGameFolderPaths: (callback: (event: Electron.IpcRendererEvent, game: SupportedGames) => void) =>
    ipcRenderer.on("requestGameFolderPaths", callback),
  getAllModData: (ids: string[]) => ipcRenderer.send("getAllModData", ids),
  getCustomizableMods: debounce(
    (modPaths: string[], tables: string[], customizableModsHash: string) =>
      ipcRenderer.send("getCustomizableMods", modPaths, tables, customizableModsHash),
    100,
  ),
  setCustomizableMods: (
    callback: (event: Electron.IpcRendererEvent, customizableMods: Record<string, string[]>) => void,
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
    callback: (event: Electron.IpcRendererEvent, overwrittenDataPackedFiles: Record<string, string[]>) => void,
  ) => ipcRenderer.on("setOverwrittenDataPackedFiles", callback),
  setOutdatedPackFiles: (
    callback: (event: Electron.IpcRendererEvent, outdatedPackFiles: Record<string, string[]>) => void,
  ) => ipcRenderer.on("setOutdatedPackFiles", callback),
  setDataModLastChangedLocal: (callback: (event: Electron.IpcRendererEvent, dataModLastChangedLocal: number) => void) =>
    ipcRenderer.on("setDataModLastChangedLocal", callback),

  setCurrentlyReadingMod: (callback: (event: Electron.IpcRendererEvent, modName: string) => void) =>
    ipcRenderer.on("setCurrentlyReadingMod", callback),
  setLastModThatWasRead: (callback: (event: Electron.IpcRendererEvent, modName: string) => void) =>
    ipcRenderer.on("setLastModThatWasRead", callback),

  setAvailableLanguages: (callback: (event: Electron.IpcRendererEvent, languages: string[]) => void) =>
    ipcRenderer.on("setAvailableLanguages", callback),
  getSteamCollectionName: (url: string): Promise<string> => ipcRenderer.invoke("getSteamCollectionName", url),
  requestLanguageChange: (language: string) => ipcRenderer.send("requestLanguageChange", language),
  requestGameChange: (game: string, payload: ConfigSavePayload) => ipcRenderer.send("requestGameChange", game, payload),
  setCurrentLanguage: (callback: (event: Electron.IpcRendererEvent, language: string) => void) =>
    ipcRenderer.on("setCurrentLanguage", callback),
  setCurrentGame: (
    callback: (
      event: Electron.IpcRendererEvent,
      game: SupportedGames,
      currentPreset: SavedPreset,
      presets: SavedPreset[],
      modUserData: Record<string, StoredModUserData>,
    ) => void,
  ) => ipcRenderer.on("setCurrentGame", callback),
  setCurrentGameNaive: (callback: (event: Electron.IpcRendererEvent, game: SupportedGames) => void) =>
    ipcRenderer.on("setCurrentGameNaive", callback),

  getSkillsForSubtype: (subtype: string, subtypeIndex: number, requestId?: string) =>
    ipcRenderer.send("getSkillsForSubtype", subtype, subtypeIndex, requestId),
  createNewSkillTree: (subtype: string) => ipcRenderer.send("createNewSkillTree", subtype),
  getSkillsEditorData: (): Promise<SkillsEditorData | undefined> => ipcRenderer.invoke("getSkillsEditorData"),
  saveSkillsPack: (data: any) => ipcRenderer.invoke("saveSkillsPack", data),
  saveSkillsChanges: (data: any) => ipcRenderer.invoke("saveSkillsChanges", data),
  getTechnologyNodeSets: (): Promise<TechnologyNodeSetSummary[]> => ipcRenderer.invoke("getTechnologyNodeSets"),
  getTechnologyTree: (setKey: string): Promise<TechnologyTreePayload | undefined> =>
    ipcRenderer.invoke("getTechnologyTree", setKey),
  saveTechnologyPack: (
    payload: SaveTechnologyPackPayload,
  ): Promise<{ success: boolean; packName?: string; packPath?: string; warning?: string; error?: string }> =>
    ipcRenderer.invoke("saveTechnologyPack", payload),
  saveTechnologyChanges: (
    payload: SaveTechnologyChangesPayload,
  ): Promise<{ success: boolean; packName?: string; packPath?: string; warning?: string; error?: string }> =>
    ipcRenderer.invoke("saveTechnologyChanges", payload),
  getBuildingsCatalog: (enabledMods: Mod[]): Promise<BuildingsCatalogResponse> =>
    ipcRenderer.invoke("getBuildingsCatalog", enabledMods),
  onBuildingsDataRebuild: (callback: (event: Electron.IpcRendererEvent, isRebuilding: boolean) => void) => {
    ipcRenderer.on("buildingsDataRebuild", callback);
    return () => {
      ipcRenderer.removeListener("buildingsDataRebuild", callback);
    };
  },
  getBuildingsRegionView: (
    enabledMods: Mod[],
    query: BuildingsRegionQuery,
    pendingEdits?: BuildingsEditState,
  ): Promise<BuildingsRegionViewResponse> =>
    ipcRenderer.invoke("getBuildingsRegionView", enabledMods, query, pendingEdits),
  getBuildingsCaiRows: (
    enabledMods: Mod[],
    chainKey: string,
    pendingEdits?: BuildingsEditState,
  ): Promise<BuildingsCaiRowsResponse> =>
    ipcRenderer.invoke("getBuildingsCaiRows", enabledMods, chainKey, pendingEdits),
  getAncillariesCatalog: (enabledMods: Mod[]): Promise<AncillariesCatalogResponse> =>
    ipcRenderer.invoke("getAncillariesCatalog", enabledMods),
  getAncillariesDetail: (
    enabledMods: Mod[],
    key: string,
    pendingEdits?: AncillariesEditState,
  ): Promise<AncillariesDetailResponse> => ipcRenderer.invoke("getAncillariesDetail", enabledMods, key, pendingEdits),
  getEsfMap: (enabledMods: Mod[], campaignName?: string): Promise<EsfMapResponse> =>
    ipcRenderer.invoke("getEsfMap", enabledMods, campaignName),
  searchInsidePacks: (searchTerm: string, mods: Mod[]) => ipcRenderer.send("searchInsidePacks", searchTerm, mods),
  setPackSearchResults: (callback: (event: Electron.IpcRendererEvent, packNames: string[]) => void) =>
    ipcRenderer.on("setPackSearchResults", callback),
  runGlobalSearch: (request: GlobalSearchRequest): Promise<GlobalSearchResponse> =>
    ipcRenderer.invoke("runGlobalSearch", request),
  cancelGlobalSearch: () => ipcRenderer.send("cancelGlobalSearch"),
  // The unsubscribe-returning shape, like onVanillaDbCacheBuildProgress: the panel mounts and
  // unmounts with the viewer's bottom dock, so a plain `on` would stack listeners.
  onGlobalSearchProgress: (callback: (event: Electron.IpcRendererEvent, progress: GlobalSearchProgress) => void) => {
    ipcRenderer.on("setGlobalSearchProgress", callback);
    return () => {
      ipcRenderer.removeListener("setGlobalSearchProgress", callback);
    };
  },
  onGlobalSearchResults: (callback: (event: Electron.IpcRendererEvent, batch: GlobalSearchResultBatch) => void) => {
    ipcRenderer.on("setGlobalSearchResults", callback);
    return () => {
      ipcRenderer.removeListener("setGlobalSearchResults", callback);
    };
  },
  terminateGame: () => ipcRenderer.send("terminateGame"),

  setSchemaData: (
    callback: (event: Electron.IpcRendererEvent, DBNameToDBVersions: Record<string, DBVersion[]>) => void,
  ) => ipcRenderer.on("setSchemaData", callback),
  setPackDataStore: (
    callback: (
      event: Electron.IpcRendererEvent,
      packPath: string,
      pack: Pack,
      tableReferenceRequests: TableReferenceRequest[],
    ) => void,
  ) => ipcRenderer.on("setPackDataStore", callback),
  appendPackDataStore: (
    callback: (
      event: Electron.IpcRendererEvent,
      packPath: string,
      packFilesToAppend: PackedFile[],
      tableReferenceRequests: TableReferenceRequest[],
    ) => void,
  ) => ipcRenderer.on("appendPackDataStore", callback),
  getTableReferences: (packPath: string, tableReferenceRequests: TableReferenceRequest[], withPack: boolean) =>
    ipcRenderer.send("getTableReferences", packPath, tableReferenceRequests, withPack),
  setDBNameToDBVersions: (
    callback: (
      event: Electron.IpcRendererEvent,
      DBNameToDBVersions: Record<string, DBVersion[]>,
      DBFieldsThatReference: Record<DBFileName, Record<DBFieldName, string[]>>,
      referencedColums: Record<string, string[]>,
    ) => void,
  ) => ipcRenderer.on("setDBNameToDBVersions", callback),
  executeDBDuplication: (
    packPath: string,
    nodesNamesToDuplicate: string[],
    nodeNameToRef: Record<string, IViewerTreeNodeWithData>,
    nodeNameToRenameValue: Record<string, string>,
    defaultNodeNameToRenameValue: Record<string, string>,
    treeData: IViewerTreeNodeWithData,
    DBCloneSaveOptions: DBCloneSaveOptions,
  ): Promise<DBCloneExecutionResult> =>
    ipcRenderer.invoke(
      "executeDBDuplication",
      packPath,
      nodesNamesToDuplicate,
      nodeNameToRef,
      nodeNameToRenameValue,
      defaultNodeNameToRenameValue,
      treeData,
      DBCloneSaveOptions,
    ),
  cancelDBDuplication: () => ipcRenderer.send("cancelDBDuplication"),
  buildDBIndirectReferences: (
    packPath: string,
    selectedNode: IViewerTreeNodeWithData,
    existingRefs: DBCell[],
  ): Promise<IViewerTreeNodeWithData[]> =>
    ipcRenderer.invoke("buildDBIndirectReferences", packPath, selectedNode, existingRefs),
  buildDBReferenceTree: (
    packPath: string,
    currentDBTableSelection: DBTableSelection,
    deepCloneTarget: { row: number; col: number },
    existingRefs: DBCell[],
    selectedNodesByName: IViewerTreeNodeWithData[],
    existingTree?: IViewerTreeNodeWithData,
  ): Promise<IViewerTreeNodeWithData> =>
    ipcRenderer.invoke(
      "buildDBReferenceTree",
      packPath,
      currentDBTableSelection,
      deepCloneTarget,
      existingRefs,
      selectedNodesByName,
      existingTree,
    ),

  getDBNameToDBVersions: (): Promise<Record<string, DBVersion[]>> => ipcRenderer.invoke("getDBNameToDBVersions"),

  getDefaultTableVersions: (): Promise<Record<string, number>> => ipcRenderer.invoke("getDefaultTableVersions"),

  getListOfPacksInSave: (saveName: string): Promise<string[]> => ipcRenderer.invoke("getListOfPacksInSave", saveName),

  getPackFilesList: (packPath: string): Promise<string[]> => ipcRenderer.invoke("getPackFilesList", packPath),
  getViewerPackCatalog: (): Promise<{
    success: boolean;
    packs?: Array<{
      path: string;
      name: string;
      humanName?: string;
      isEnabled: boolean;
      isInData: boolean;
      /** Lower values are the sources chosen first for same-named mods. */
      priority?: number;
    }>;
    error?: string;
  }> => ipcRenderer.invoke("getViewerPackCatalog"),
  copyPackedFileToPack: (
    sourcePackPath: string,
    filePath: string,
    targetPackPath: string,
    overwriteExisting?: boolean,
    destinationFilePath?: string,
  ): Promise<{
    success: boolean;
    targetPackPath?: string;
    filePath?: string;
    overwriteRequired?: boolean;
    tableNameRequired?: boolean;
    tableName?: string;
    error?: string;
  }> =>
    ipcRenderer.invoke(
      "copyPackedFileToPack",
      sourcePackPath,
      filePath,
      targetPackPath,
      overwriteExisting,
      destinationFilePath,
    ),
  getPackRowsForSave: (packPath: string, tableNames: string[], includeLocs: boolean): Promise<PackRowsForSave> =>
    ipcRenderer.invoke("getPackRowsForSave", packPath, tableNames, includeLocs),
  renamePackedFiles: (
    packPath: string,
    searchRegex: string,
    replaceText: string,
    useRegex: boolean,
    isDev?: boolean,
    pathFilter?: string,
  ): Promise<void> =>
    ipcRenderer.invoke("renamePackedFiles", packPath, searchRegex, replaceText, useRegex, isDev, pathFilter),
  deletePackedFiles: (
    packPath: string,
    filePaths: string[],
  ): Promise<{ success: boolean; removedPaths?: string[]; error?: string }> =>
    ipcRenderer.invoke("deletePackedFiles", packPath, filePaths),
  renamePackedFilesInPack: (
    packPath: string,
    entries: PackFileRenameEntry[],
  ): Promise<{ success: boolean; removedPaths?: string[]; error?: string }> =>
    ipcRenderer.invoke("renamePackedFilesInPack", packPath, entries),

  executeNode: (nodeExecutionRequest: {
    nodeId: string;
    nodeType: string;
    textValue: string;
    inputData: any;
  }): Promise<{ success: boolean; data?: any; error?: string }> =>
    ipcRenderer.invoke("executeNode", nodeExecutionRequest),

  executeNodeGraph: (graphExecutionRequest: {
    nodes: Array<{
      id: string;
      type: string;
      data: {
        label: string;
        type: string;
        isDisabled?: boolean;
        textValue?: string;
        outputType?: string;
        inputType?: string;
      };
    }>;
    connections: Array<{
      id: string;
      sourceId: string;
      targetId: string;
      sourceType?: string;
      targetType?: string;
    }>;
  }): Promise<{
    success: boolean;
    executionResults: Array<[string, { success: boolean; data?: any; error?: string; warnings?: string[] }]>;
    totalExecuted: number;
    successCount: number;
    failureCount: number;
    error?: string;
  }> => ipcRenderer.invoke("executeNodeGraph", graphExecutionRequest),

  saveNodeFlow: (
    flowName: string,
    flowData: string,
    packPath: string,
  ): Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
  }> => ipcRenderer.invoke("saveNodeFlow", flowName, flowData, packPath),

  saveDBTableEdits: (
    packPath: string,
    packedFile: PackedFile,
  ): Promise<{
    success: boolean;
    error?: string;
  }> => ipcRenderer.invoke("saveDBTableEdits", packPath, packedFile),

  saveTextPackedFileEdits: (
    packPath: string,
    filePath: string,
    text: string,
  ): Promise<{
    success: boolean;
    error?: string;
  }> => ipcRenderer.invoke("saveTextPackedFileEdits", packPath, filePath, text),

  savePackWithUnsavedFiles: (
    packPath: string,
  ): Promise<{
    success: boolean;
    savedPath?: string;
    replacedOriginal?: boolean;
    warning?: string;
    error?: string;
  }> => ipcRenderer.invoke("savePackWithUnsavedFiles", packPath),

  savePackAsWithUnsavedFiles: (
    packPath: string,
    newPackName: string,
    newPackDirectory: string,
    overwriteExisting?: boolean,
  ): Promise<{
    success: boolean;
    savedPath?: string;
    /** A pack is already at savedPath and overwriteExisting was not set. Nothing was written. */
    alreadyExists?: boolean;
    warning?: string;
    error?: string;
  }> => ipcRenderer.invoke("savePackAsWithUnsavedFiles", packPath, newPackName, newPackDirectory, overwriteExisting),

  getVisualsUnitsData: (
    enabledMods: Mod[],
  ): Promise<{
    success: boolean;
    sessionId?: string;
    units?: {
      unitKey: string;
      faction: string;
      localizedName: string;
      variantName?: string;
      variantMeshPath?: string;
      originPackPath: string;
      originLabel: string;
      cultureKey?: string;
      cultureName?: string;
      cultures?: { key: string; name: string }[];
      caste?: string;
    }[];
    error?: string;
  }> => ipcRenderer.invoke("getVisualsUnitsData", enabledMods),

  getUnitViewerCatalog: (enabledMods: Mod[]): Promise<UnitViewerCatalogResponse> =>
    ipcRenderer.invoke("getUnitViewerCatalog", enabledMods),

  getUnitViewerDetails: (sessionId: string, unitKey: string): Promise<UnitViewerDetailsResponse> =>
    ipcRenderer.invoke("getUnitViewerDetails", sessionId, unitKey),

  prewarmUnitViewerAssets: (sessionId: string, assetPaths: string[]): Promise<UnitViewerAssetsPrewarmResponse> =>
    ipcRenderer.invoke("prewarmUnitViewerAssets", sessionId, assetPaths),

  readVariantMeshDefinition: (
    sessionId: string,
    fileName: string,
  ): Promise<{
    success: boolean;
    text?: string;
    resolved?: { packPath: string; fileName: string };
    error?: string;
  }> => ipcRenderer.invoke("readVariantMeshDefinition", sessionId, fileName),

  searchVisualsFiles: (
    sessionId: string,
    query: string,
    offset?: number,
    limit?: number,
  ): Promise<{
    success: boolean;
    total?: number;
    results?: {
      path: string;
      ext: "variantmeshdefinition" | "wsmodel" | "rigid_model_v2";
    }[];
    error?: string;
  }> => ipcRenderer.invoke("searchVisualsFiles", sessionId, query, offset, limit),

  openInAssetEditor: (
    sessionId: string,
    packInternalPath: string,
    mode: "new" | "existing",
    preferredPackPath?: string,
  ): Promise<{
    success: boolean;
    resolved?: { packPath: string; fileName: string };
    response?: { ok?: boolean; error?: string; normalizedPath?: string };
    error?: string;
  }> => ipcRenderer.invoke("openInAssetEditor", sessionId, packInternalPath, mode, preferredPackPath),

  readFileFromPack: (
    packPath: string,
    fileName: string,
  ): Promise<{
    success: boolean;
    text?: string;
    base64?: string;
    mimeType?: string;
    error?: string;
  }> => ipcRenderer.invoke("readFileFromPack", packPath, fileName),

  getFlowFilesFromPack: (
    packPath: string,
  ): Promise<{
    success: boolean;
    flowFiles?: { name: string; content: string }[];
    error?: string;
  }> => ipcRenderer.invoke("getFlowFilesFromPack", packPath),

  getFlowPackCatalog: (): Promise<{
    success: boolean;
    packs?: Array<{
      path: string;
      name: string;
      humanName?: string;
      isEnabled: boolean;
      hasFlows: boolean;
    }>;
    error?: string;
  }> => ipcRenderer.invoke("getFlowPackCatalog"),

  selectFlowPackFile: (): Promise<string | undefined> => ipcRenderer.invoke("selectFlowPackFile"),

  selectFlowPackSavePath: (suggestedName?: string): Promise<string | undefined> =>
    ipcRenderer.invoke("selectFlowPackSavePath", suggestedName),

  saveFlowToPack: (
    packPath: string,
    flowName: string,
    flowData: string,
    overwriteExisting?: boolean,
  ): Promise<{
    success: boolean;
    alreadyExists?: boolean;
    packPath?: string;
    flowName?: string;
    error?: string;
  }> => ipcRenderer.invoke("saveFlowToPack", packPath, flowName, flowData, overwriteExisting),

  writeTextFilesToDirectory: (
    baseDirectory: string,
    files: { relativePath: string; content: string }[],
  ): Promise<{
    success: boolean;
    writtenFiles?: string[];
    error?: string;
  }> => ipcRenderer.invoke("writeTextFilesToDirectory", baseDirectory, files),

  selectDirectory: (defaultPath?: string): Promise<string | undefined> =>
    ipcRenderer.invoke("selectDirectory", defaultPath),

  selectImportFiles: (): Promise<string[]> => ipcRenderer.invoke("selectImportFiles"),

  selectImportFolders: (): Promise<string[]> => ipcRenderer.invoke("selectImportFolders"),

  planPackImportFromDisk: (
    packPath: string,
    sources: PackImportSource[],
    targetFolder: string,
  ): Promise<PackImportPlan> => ipcRenderer.invoke("planPackImportFromDisk", packPath, sources, targetFolder),

  applyPackImportFromDisk: (packPath: string, items: PackImportItem[]): Promise<PackImportApplyResult> =>
    ipcRenderer.invoke("applyPackImportFromDisk", packPath, items),

  exportPackedFilesToDirectory: (
    packPath: string,
    outputDirectory: string,
    filePaths: string[] | "all",
  ): Promise<PackExportResult> =>
    ipcRenderer.invoke("exportPackedFilesToDirectory", packPath, outputDirectory, filePaths),

  getDataFolder: (): Promise<string | undefined> => ipcRenderer.invoke("getDataFolder"),

  exportCompatReport: (
    reportText: string,
    suggestedName: string,
  ): Promise<{ success: boolean; savedPath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("exportCompatReport", reportText, suggestedName),

  exportRegionOwnership: (
    json: string,
    suggestedName: string,
  ): Promise<{ success: boolean; savedPath?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke("exportRegionOwnership", json, suggestedName),

  importRegionOwnership: (): Promise<{
    success: boolean;
    text?: string;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("importRegionOwnership"),

  updateCustomModSources: (data: {
    game: SupportedGames;
    customModFolders: CustomModFolder[];
    modSourceOrder: string[];
  }): Promise<{ success: boolean; folderPaths?: GameFolderPaths; error?: string }> =>
    ipcRenderer.invoke("updateCustomModSources", data),

  getCustomModFolderStatuses: (folderPaths: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("getCustomModFolderStatuses", folderPaths),

  copyModsToNewCustomFolder: (data: {
    destinationPath: string;
    modPaths: string[];
    overwrite: boolean;
  }): Promise<{
    success: boolean;
    copied?: string[];
    failed?: Array<{ path: string; error: string }>;
    conflicts?: string[];
    requiresConfirmation?: boolean;
    folderPaths?: GameFolderPaths;
    error?: string;
  }> => ipcRenderer.invoke("copyModsToNewCustomFolder", data),

  syncWorkshopModsToCustomFolder: (data: {
    customSourceId: string;
    enabledWorkshopModNames: string[];
  }): Promise<{
    success: boolean;
    updated?: string[];
    added?: string[];
    failed?: Array<{ path: string; error: string }>;
    error?: string;
  }> => ipcRenderer.invoke("syncWorkshopModsToCustomFolder", data),

  createNewPack: (
    packName: string,
    packDirectory: string,
  ): Promise<{
    success: boolean;
    packPath?: string;
    error?: string;
  }> => ipcRenderer.invoke("createNewPack", packName, packDirectory),

  syncIsFeaturesForModdersEnabled: (isFeaturesForModdersEnabled: boolean) =>
    ipcRenderer.send("syncIsFeaturesForModdersEnabled", isFeaturesForModdersEnabled),
  syncModdersPrefix: (moddersPrefix: string) => ipcRenderer.send("syncModdersPrefix", moddersPrefix),
  syncTreeDisplayModes: (treeDisplayModes: {
    skillTreesDisplayMode: TreeDisplayMode;
    technologyTreesDisplayMode: TreeDisplayMode;
  }) => ipcRenderer.send("syncTreeDisplayModes", treeDisplayModes),

  setIsFeaturesForModdersEnabled: (callback: (event: any, isFeaturesForModdersEnabled: boolean) => void) =>
    ipcRenderer.on("setIsFeaturesForModdersEnabled", callback),
  setModdersPrefix: (callback: (event: any, moddersPrefix: string) => void) =>
    ipcRenderer.on("setModdersPrefix", callback),
  setRecentPackPaths: (callback: (event: Electron.IpcRendererEvent, packPaths: string[]) => void) =>
    ipcRenderer.on("setRecentPackPaths", callback),
};

export type api = typeof api;

window.api = api;
// contextBridge.exposeInMainWorld("api", api);
