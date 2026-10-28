# Main ↔ renderer IPC

This is a map of how WHMM's windows talk to the Electron main process: the mechanics, the conventions, and every channel grouped by feature. Use it to find where a feature's messages live, and to add new ones in the established style.

Counts in this document come from the source as of 2026-10-26:

- `src/preload.ts`: 238 `window.api` methods, 98 `invoke` channels, 73 `send` channels, 67 event subscriptions.
- Main process: 179 handlers (106 `handle`, 73 `on`) and 66 channels it emits to windows.

## Processes and windows

| Window      | Renderer entry             | App root           | Opened by                                        |
| ----------- | -------------------------- | ------------------ | ------------------------------------------------ |
| Main window | `src/rendererMain.ts`      | `appMain.tsx`      | `src/index.ts` (`createWindow`)                  |
| Pack viewer | `src/rendererViewer.ts`    | `appViewer.tsx`    | `requestOpenModInViewer` → `ipcMainListeners.ts` |
| Skills      | `src/rendererSkills.ts`    | `appSkills.tsx`    | `requestOpenSkillsWindow`                        |
| Tech trees  | `src/rendererTechTrees.ts` | `appTechTrees.tsx` | `requestOpenTechTreesWindow`                     |

- All four windows load the same preload (`src/preload.ts`) and run with `nodeIntegration: true` and `contextIsolation: false`.
- The main process keeps them in `windows` (`ipcMainListeners.ts`): `mainWindow`, `viewerWindow`, `skillsWindow`, `techTreesWindow`.
- Each window has **its own Redux store**. They are separate instances of `src/store.ts`, so no state is shared. Settings that every window needs (language, modder prefix, start arguments, game) are sent to each window separately. For example, a language change sends `setCurrentLanguage` to the main, skills and viewer windows.
- The pack viewer also exists as a tab inside the main window. Pack data is sent either to the main window or to the viewer window (`sendPackViewData(..., "main" | "viewer")`).

## Where the code is

| Side                 | File                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer API         | `src/preload.ts`: the `api` object, assigned with `window.api = api` (the `contextBridge` call is commented out). Typed as `window.api?: api` in `src/index.d.ts`.                           |
| Event → Redux wiring | `src/rendererMain.ts` (55 subscriptions), plus `rendererViewer.ts`, `rendererSkills.ts`, `rendererTechTrees.ts`. Components subscribe to their own feature events, e.g. `DBDuplication.tsx`. |
| Main handlers        | `src/ipcMainListeners.ts` (159 handlers, all inside `registerIpcMainListeners()`), `src/wh3AssetHostIpc.ts` (10), `src/workshopModOptimizer/visualCheckIpc.ts` (6), `src/index.ts` (4)       |

## The three message kinds

| Renderer                      | Main                                                                                       | Use                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipcRenderer.invoke(ch, ...)` | `ipcMain.handle(ch, ...)`                                                                  | Request → response (a Promise). **Use this for new work.** Most newer handlers resolve to `{ success: boolean, error?: string, ... }` rather than throwing.            |
| `ipcRenderer.send(ch, ...)`   | `ipcMain.on(ch, ...)`                                                                      | Fire-and-forget. Older features answer later with an event, e.g. `requestSaves` → `savesPopulated`, `getPackData` → `setPacksData`, `readAppConfig` → `fromAppConfig`. |
| `ipcRenderer.on(ch, cb)`      | `webContents.send(ch, ...)`, or `event.sender.send(...)` to reply to the window that asked | Main → window events. The preload exposes each as `api.<name>(callback)`.                                                                                              |

**Progress and cancel.** Long-running work starts with `invoke`, which resolves when the work finishes. Progress goes back to the requesting window with `event.sender.send`, and a separate `send` channel cancels. Examples:

- `runGlobalSearch` + `setGlobalSearchProgress` / `setGlobalSearchResults` + `cancelGlobalSearch`
- `startCompressionAnalysis` + `compressionAnalysisProgress` + `cancelCompressionAnalysis`
- `executeDBDuplication` + `setDBDuplicationProgress` + `cancelDBDuplication`
- `startGame` + `workshopModStagingProgress` + `cancelWorkshopModStaging`

**Listener cleanup.** Twelve preload subscriptions return an unsubscribe function: `onWorkshopOptimizerBackgroundStatus`, `onWorkshopOptimizerLastRun`, `onWorkshopOptimizerRunReport`, `onVisualAssetCheckState`, the subscriptions for `workshopModStagingProgress`, `compressionAnalysisProgress`, `vanillaDbCacheBuildProgress`, `buildingsDataRebuild`, `setGlobalSearchProgress`, `setGlobalSearchResults`, `wh3AssetHostDecisionRequest` and `wh3AssetHostReset`.

All other subscriptions add a listener every time they are called and return nothing. Call those once, at module scope in a `renderer*.ts` file, never from a React effect. For a subscription a component needs, follow the twelve above and return a remover.

**Calls that skip the preload.** Because Node access is on, `src/visuals/modelPreviewApi.ts` reaches `ipcRenderer` directly through `window.require("electron")`; a static `import "electron"` would make webpack try to bundle Electron. It invokes these nine channels, which have no `window.api` method: `exportVisualsModel`, `exportVisualsModelBatch`, `exportVisualsModelAnimations`, `getVisualsModelAnimationCatalog`, `releaseVisualsModelPreview`, `reportVisualsModelPreviewTiming`, `getUnitPainterFactionMaskBindings`, `exportUnitPainterTextures`, `openUnitPainterProject`. All are handled in `wh3AssetHostIpc.ts` (see `docs/WH3_ASSET_HOST.md`).

## Startup handshakes

Main window:

1. `rendererMain.ts` sends `sendApiExists`. `index.ts` answers with `setIsDev`, `setStartArgs`, `setIsAdmin`, `setCanCreateSymbolicLinks`, `setSkillsViewOptions` and `setAvailableLanguages`, then starts polling whether the game is running (`setIsWH3Running`).
2. The renderer sends `readAppConfig`. Main answers `fromAppConfig` (or `failedReadingConfig`), followed by `setCurrentLanguage` and the mod-list events.
3. When `fromAppConfig` arrives, the renderer applies it with `setFromConfig` and only then subscribes to store changes. From that point, every store change calls `saveConfig` (debounced 200 ms, plus once on `beforeunload`). It also calls `readMods` when the set of enabled mods changes.
4. `rendererMainMounted` is a diagnostic signal only. `index.ts` logs a warning if React has not mounted within 10 s.

Secondary windows send `viewerIsReady`, `skillsAreReady` or `techTreesAreReady` once mounted. Until then, main queues their data in `appData` (e.g. `queuedViewerData`) and delivers it on the ready signal, together with schema data (`setDBNameToDBVersions`) and current settings.

## Adding a channel

1. Add the handler inside `registerIpcMainListeners()` in `src/ipcMainListeners.ts`, or in the feature's own IPC module if it has one (`wh3AssetHostIpc.ts`, `visualCheckIpc.ts`). Prefer `ipcMain.handle`.
2. Add a typed method to `api` in `src/preload.ts`. The `window.api` type follows automatically from `export type api = typeof api`.
3. For main → window events, add an `api.<name>(callback)` method that returns a remover, and send with `windows.<window>?.webContents.send(...)` or `event.sender.send(...)`.
4. Validate arguments in the handler. The renderer is not trusted to send well-formed values; see the `sanitize*` helpers in `wh3AssetHostIpc.ts`.
5. Keep channel names unique across all handler files. Electron throws if a second `handle` registers the same channel. `wh3AssetHostIpc.ts` calls `ipcMain.removeHandler` first so the module can be loaded again safely.

## Channels by feature

Legend:

- **I** = `invoke`/`handle`, **S** = `send`/`on` (renderer → main), **E** = event (main → window)
- Unmarked handlers are in `src/ipcMainListeners.ts`; others are marked †`index.ts`, ‡`wh3AssetHostIpc.ts`, §`visualCheckIpc.ts`

### App shell, settings, folders, updates

- **I** `getUpdateData`†, `downloadAndInstallUpdate`†, `translate`, `translateAll`, `translateAllStatic`, `openDiagnosticPath`, `selectDirectory`, `getDataFolder`
- **S** `sendApiExists`†, `rendererMainMounted`†, `readAppConfig`, `saveConfig`, `requestLanguageChange`, `requestGameChange`, `selectContentFolder`, `selectWarhammer3Folder`, `openFolderInExplorer`, `openDirectoryInExplorer`, `putPathInClipboard`, `syncIsFeaturesForModdersEnabled`, `syncModdersPrefix`, `syncTreeDisplayModes`
- **E** `handleLog`, `addToast`, `setIsDev`, `setIsAdmin`, `setCanCreateSymbolicLinks`, `setStartArgs`, `fromAppConfig`, `failedReadingConfig`, `setAvailableLanguages`, `setCurrentLanguage`, `setCurrentGame`, `setCurrentGameNaive`, `setAppFolderPaths`, `requestGameFolderPaths`, `setContentFolder`, `setWarhammer3Folder`, `setIsFeaturesForModdersEnabled`, `setModdersPrefix`, `setRecentPackPaths`

### Mod list, load order, data folder, merging

- **I** `compareModsByteForByte`, `updateCustomModSources`, `getCustomModFolderStatuses`, `copyModsToNewCustomFolder`, `syncWorkshopModsToCustomFolder`
- **S** `readMods`, `getAllModData`, `getCustomizableMods`, `exportModsToClipboard`, `exportModNamesToClipboard`, `openPack`, `copyModToData`, `copyToData`, `copyToDataAsSymbolicLink`, `cleanData`, `cleanSymbolicLinksInData`, `deletePack`, `makePackBackup`, `fakeUpdatePack`, `mergeMods`, `reMerge`
- **E** `modsPopulated`, `addMod`, `removeMod`, `setModData`, `setPackHeaderData`, `setModLoadOrderRules`, `setCurrentlyReadingMod`, `setLastModThatWasRead`, `setDataModLastChangedLocal`, `setOutdatedPackFiles`, `setOverwrittenDataPackedFiles`, `setCustomizableMods`, `importModsFromUsedMods`, `createdMergedPack`

### Steam Workshop

- **I** `getSteamCollectionName`
- **S** `subscribeToMods`, `unsubscribeToMod`, `updateMod`, `uploadMod`, `forceModDownload`, `forceDownloadMods`, `forceResubscribeMods`, `repairOutdatedWorkshopMods`, `cancelWorkshopRepairAndResubscribeMods`, `openInSteam`, `createSteamCollection`, `importSteamCollection`
- **E** `subscribedToMods`, `workshopUpdateCheck`, `importSteamCollectionResponse`

### Game launch, Workshop staging, optimizer, visual asset check

- **I** `getWorkshopModStagingInfo`, `clearWorkshopModStaging`, `getWorkshopOptimizerCacheInfo`, `getWorkshopOptimizerBackgroundStatus`, `clearWorkshopOptimizerCache`, `getWorkshopOptimizerRunReport`, `openWorkshopOptimizerReport`, `startVisualAssetCheck`§, `getVisualAssetCheckState`§, `openVisualAssetCheckReport`§, `showVisualAssetCheckReportInFolder`§, `saveVisualAssetCheckReport`§
- **S** `startGame`, `terminateGame`, `cancelWorkshopModStaging`, `skipWorkshopModOptimization`, `updateWorkshopOptimizerBackground`, `cancelWorkshopOptimizerBackground`, `runWorkshopOptimizerBackgroundNow`, `cancelVisualAssetCheck`§
- **E** `setIsWH3Running`, `workshopModStagingProgress`, `workshopOptimizerBackgroundStatus`, `workshopOptimizerLastRun`, `workshopOptimizerRunReport`, `visualAssetCheckState`

### Save games

- **I** `getListOfPacksInSave`
- **S** `requestSaves`, `getPacksInSave`
- **E** `savesPopulated`, `packsInSave`

### Compatibility checks

- **I** `exportCompatReport`
- **S** `getCompatData`
- **E** `setPackCollisionsCheckProgress`, `setPackCollisions`

### Pack viewer: reading

- **I** `reloadPackForViewer`, `getVanillaPackFileTree`, `searchVanillaPackFiles`, `getPackFilesList`, `getViewerPackCatalog`, `readFileFromPack`, `getDBNameToDBVersions`, `getDefaultTableVersions`
- **S** `requestOpenModInViewer`, `viewerIsReady`, `viewerClosedPack`, `setViewerActivePack`, `getPackData`, `getPackDataWithLocs`, `getTableReferences`
- **E** `openModInViewer`, `viewerPackChangedOnDisk`, `setPacksData`, `setPacksDataRead`, `setPackDataStore`, `appendPackDataStore`, `setDBNameToDBVersions`, `vanillaDbCacheBuildProgress`

### Pack viewer: editing, saving, import and export

- **I** `createNewPack`, `copyPackedFileToPack`, `getPackRowsForSave`, `renamePackedFiles`, `deletePackedFiles`, `renamePackedFilesInPack`, `saveDBTableEdits`, `saveTextPackedFileEdits`, `savePackWithUnsavedFiles`, `savePackAsWithUnsavedFiles`, `selectImportFiles`, `selectImportFolders`, `planPackImportFromDisk`, `applyPackImportFromDisk`, `exportPackedFilesToDirectory`, `writeTextFilesToDirectory`
- **E** `applySavedPackData`, `setUnsavedPacksData`, `setDeletedPackFilePaths`

### DB duplication and references

- **I** `executeDBDuplication`, `buildDBIndirectReferences`, `buildDBReferenceTree`
- **S** `cancelDBDuplication`
- **E** `setDBDuplicationProgress`

### Search

- **I** `runGlobalSearch`
- **S** `searchInsidePacks`, `cancelGlobalSearch`
- **E** `setPackSearchResults`, `setGlobalSearchProgress`, `setGlobalSearchResults`

### Pack compression

- **I** `startCompressionAnalysis`, `compressPack`
- **S** `cancelCompressionAnalysis`
- **E** `compressionAnalysisProgress`

### Skills and tech trees

- **I** `prefetchSkillsForSubtype`, `getSkillsEditorData`, `saveSkillsPack`, `saveSkillsChanges`, `getTechnologyNodeSets`, `getTechnologyTree`, `saveTechnologyPack`, `saveTechnologyChanges`
- **S** `requestOpenSkillsWindow`, `skillsAreReady`, `requestSkillsData`, `getSkillsForSubtype`, `setSkillsSelection`, `createNewSkillTree`, `setSkillsViewOptions`, `requestOpenTechTreesWindow`, `techTreesAreReady`
- **E** `setSkillsData`, `setSkillsViewOptions`

### Buildings, ancillaries, campaign map

- **I** `getBuildingsCatalog`, `getBuildingsRegionView`, `getBuildingsCaiRows`, `getAncillariesCatalog`, `getAncillariesDetail`, `getEsfMap`, `exportRegionOwnership`, `importRegionOwnership`
- **E** `buildingsDataRebuild`

### Flows (node graph)

- **I** `executeNode`, `executeNodeGraph`, `saveNodeFlow`, `listNativePatchFlowTemplates`, `getFlowFilesFromPack`, `getFlowPackCatalog`, `selectFlowPackFile`, `selectFlowPackSavePath`, `saveFlowToPack`

See `docs/FLOWS.md`.

### Unit viewer, visuals, WH3AssetHost

- **I** `getVisualsUnitsData`, `getUnitViewerCatalog`, `getUnitViewerDetails`, `getUnitViewerAnimationBinClips`, `getUnitViewerSkeletonAnim`, `getUnitViewerVariantMeshCatalog`, `getVisualsVariantMeshCatalog`, `prewarmUnitViewerAssets`, `readVariantMeshDefinition`, `searchVisualsFiles`, `openInAssetEditor`, `extractVisualsFilesToDirectory`, `startWh3AssetHost`‡, `stopWh3AssetHost`‡, `respondWh3AssetHostDecision`‡
- The eight direct calls listed under "Calls that skip the preload" (all ‡)
- **E** `wh3AssetHostDecisionRequest`, `wh3AssetHostReset`
