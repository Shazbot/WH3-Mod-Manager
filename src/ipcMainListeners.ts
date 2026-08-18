import assert from "assert";
import {
  getDBName,
  findUnparsedTablePrefixes,
  getDBPackedFilePath,
  isLocPackedFilePath,
  parseLiveDBTablePath,
  releaseParsedTables,
} from "./utility/packFileHelpers";
import { planSaveAs } from "./utility/saveAsPlan";
import { createInFlightTableRequests } from "./components/viewer/inFlightTableRequests";
import { createSerializedBuilds } from "./utility/serializedBuilds";
import { createPackReadRegistry } from "./utility/packReadRegistry";
import { clonePackIndexForTable } from "./components/viewer/viewerPackIndex";
import { selectPacksToCheck } from "./modCompat/compatScope";
import {
  findExistingPackedFlowName,
  normalizePackedFlowName,
  orderFlowPackCatalog,
  type FlowPackCatalogEntry,
} from "./nodeGraph/flowPackOperations";
import {
  canReusePackIndexForCompat,
  canReuseParsedPackForCompat,
  mergeCompatTextIntoPack,
  packNeedsCompatTextRefresh,
} from "./modCompat/compatPackReuse";
import { readJsonDiskCache, writeJsonDiskCache } from "./utility/jsonDiskCache";
import {
  buildUnitViewerData,
  createLocLookup,
  UNIT_VIEWER_TABLES,
  type BuiltUnitViewerData,
  type UnitViewerTableRows,
} from "./unitViewer/data";
import { loadUnitViewerDiskCache, saveUnitViewerDiskCache } from "./unitViewer/cache";
import { buildBuildingsData, createBuildingsLocLookup, BUILDINGS_TABLES } from "./buildingsData/data";
import { resolveRegionBuildings } from "./buildingsData/derive";
import { validateNewRows } from "./buildingsData/validate";
import { applyNewRowsToBuildingsData, LOC_TABLE, newRowsByTable, type BuildingsEditState } from "./buildingsData/edits";
import {
  clearBuildingsMemoryCache,
  describeBuildingsCacheSignatureChanges,
  loadBuildingsDiskCache,
  saveBuildingsDiskCache,
  type BuildingsCacheSignatureInputs,
} from "./buildingsData/cache";
import type {
  BuildingsCatalog,
  BuildingsCaiRowsResponse,
  BuildingsCatalogResponse,
  BuildingsRegionQuery,
  BuildingsRegionView,
  BuildingsRegionViewResponse,
  BuildingsTableRows,
  BuiltBuildingsData,
} from "./buildingsData/types";
import {
  ANCILLARY_TABLES,
  buildAncillariesData,
  categoryIconPath,
  createAncillariesLocLookup,
} from "./ancillariesData/data";
import { validateNewRows as validateAncillariesNewRows } from "./ancillariesData/validate";
import {
  applyNewRowsToAncillariesData,
  LOC_TABLE as ANCILLARIES_LOC_TABLE,
  newRowsByTable as ancillariesNewRowsByTable,
  type AncillariesEditState,
} from "./ancillariesData/edits";
import {
  clearAncillariesMemoryCache,
  isSameIdentity,
  loadAncillariesModSegments,
  loadVanillaAncillariesCache,
  mergeAncillariesSources,
  modSegmentKey,
  readPackIdentity,
  saveAncillariesModSegments,
  saveVanillaAncillariesCache,
  type AncillariesModSegment,
  type AncillariesModSegments,
  type AncillariesSource,
  type AncillariesVanillaSignatureInputs,
} from "./ancillariesData/cache";
import type {
  AncillariesCatalog,
  AncillariesCatalogResponse,
  AncillariesDetailResponse,
  AncillariesTableRows,
  AncillaryDetail,
  AncillaryEffectRow,
  BuiltAncillariesData,
} from "./ancillariesData/types";
import { clearEsfMapMemoryCache, loadEsfMapDiskCache, saveEsfMapDiskCache } from "./esfMap/cache";
import { getVanillaStartposFilePaths, loadEsfMapData, loadStartposRegionSlotTemplates } from "./esfMap/loader";
import { addFactionDataToEsfMap, factionFlagPath } from "./esfMap/factions";
import { addSettlementTypeDataToEsfMap } from "./esfMap/settlementTypes";
import type { EsfMapResponse } from "./esfMap/types";
import { getVanillaLocalisationPackPaths as getVanillaLocalisationPackPathsFor } from "./vanillaLocCache/packs";
import { openOrBuildVanillaLocCache } from "./vanillaLocCache/store";
import {
  VISUALS_DATA_CACHE_VERSION,
  createEmptyVisualsDataCache,
  getCurrentVisualsTableContribution,
  getCurrentVisualsPackCacheEntry,
  getOrCreateVisualsPackCacheEntry,
  getVisualsFilesFromNames,
  mergeVisualsLocContributions,
  mergeVisualsFileContributions,
  mergeVisualsTableContributions,
  type VisualsDataDiskCache,
  type VisualsFileResult,
  type VisualsPackCacheEntry,
  type VisualsPackCacheIdentity,
  type VisualsTableContribution,
} from "./visuals/cache";
import {
  canUseVanillaDbCacheForPack,
  closeVanillaDbCacheReaders,
  fillPackedFileFromVanillaCache,
  fillVanillaTablesFromCache,
} from "./vanillaDbCache/store";
import { setVanillaDbCacheBuildProgressReporter } from "./vanillaDbCache/progress";
import bs from "binary-search";
import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as cheerio from "cheerio";
import { exec, fork } from "child_process";
import chokidar from "chokidar";
import { format } from "date-fns";
import electronLog from "electron-log/main";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import windowStateKeeper from "electron-window-state";
import * as fs from "fs";
import * as fsExtra from "fs-extra";
import { createHash, randomInt, randomUUID } from "node:crypto";
import * as net from "node:net";
import debounce from "just-debounce-it";
import fetch from "node-fetch";
import * as nodePath from "path";
import { version } from "react";
import { readAppConfig, setStartingConfig, writeAppConfig } from "./appConfigFunctions";
import { applyConfigSavePayloadToAppData } from "./config/applyConfigSavePayload";
import appData, { GameFolderPaths } from "./appData";
import type { SerializedNode, SerializedConnection } from "./nodeGraph/types";
import { packDataStore } from "./components/viewer/packDataStore";
import i18n from "./configs/i18next.config";
import { buildDBIndirectReferences, buildDBReferenceTree, type DBIndirectReferenceCacheContext } from "./DBClone";
import { buildAbilityTooltipDataForEffects } from "./abilityTooltips";
import { getSaveFiles, setupSavesWatcher } from "./gameSaves";
import { appendPackFileCollisions, removeFromPackFileCollisions } from "./modCompat/packFileCollisions";
import { emptyAllCompatDataCollections, getCompatData } from "./modCompat/packFileCompatManager";
import { appendPackTableCollisions, removeFromPackTableCollisions } from "./modCompat/packTableCollisions";
import {
  fetchModData,
  getContentModInFolder,
  getCustomMod,
  getDataMod,
  getFolderPaths,
  getLastUpdated,
  getMods,
} from "./modFunctions";
import {
  DATA_MOD_SOURCE_ID,
  getWorkshopModSyncItems,
  insertCustomSourceAfterData,
  isWorkshopMod,
  normalizeModSourceOrder,
  WORKSHOP_MOD_SOURCE_ID,
} from "./modSources";
import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import { serializeSharedModList } from "./sharedModList";
import { parseUsedMods } from "./usedMods";
import { readPackHeader } from "./packFileHandler";
import {
  addFakeUpdate,
  amendSchemaField,
  chunkSchemaIntoRows,
  createOverwritePack,
  executeFlowsForPack,
  getDBVersion,
  getDBVersionByTableName,
  getPacksInSave,
  getPacksTableData,
  getPackViewData,
  mergeMods,
  readFromExistingPack,
  readPack,
  serializePackFileDataToBuffer,
  typeToBuffer,
  writeStartGamePack,
  writePack,
} from "./packFileSerializer";
import {
  AmendedSchemaField,
  DBField,
  DBVersion,
  LocFields,
  NewPackedFile,
  Pack,
  PackCollisions,
  PackedFile,
  PackHeader,
} from "./packFileTypes";
import { resolveTable } from "./resolveTable";
import {
  DBNameToDBVersions,
  gameToDBFieldsThatReference,
  gameToReferences,
  getSchemaFileName,
  initializeAllSchemaForGame,
} from "./schema";
import {
  appendLocalizationsToSkills,
  formatEffectLocalization,
  getNodeRequirements,
  getNodesToParents,
  getRawEffectLocalization,
  getSkills,
  NodeLinks,
  NodeSkill,
  resolveTextReplacements,
  SkillAndIcons,
} from "./skills";
import {
  cloneSkillsDataCore,
  createEmptySkillsDataCore,
  getDefaultSkillsSubtype,
  getLocsFromPacks,
  getSkillAndEffectIconPaths,
  getVanillaSkillsDataCoreFromCache,
  loadIconsFromPacks,
  pickIconsForSkills,
  saveVanillaSkillsDataCoreCache,
} from "./skillsData/cache";
import { applyModOverlayToSkillsDataCore } from "./skillsData/overlay";
import {
  clearIconAssets,
  iconAssetUrl,
  registerAssetProtocol,
  registerIconAssets,
  unitAssetUrl,
  type AssetBytes,
} from "./assetProtocol";
import { normalizeAssetPath } from "./assetUrls";
import { collectVanillaFilesUnderPrefix, findVanillaPackContaining } from "./vanillaPackIndex/format";
import {
  selectPackPathsToSearch,
  selectVanillaPacksHoldingFiles,
  selectVanillaPacksHoldingTables,
} from "./vanillaPackIndex/select";
import { getVanillaPackIndex } from "./vanillaPackIndex/store";
import { getVanillaPackPathsInLoadOrder } from "./utility/vanillaPackPaths";
import {
  gameToGameName,
  gameToPackWithDBTablesName,
  gameToProcessName,
  gameToSteamId,
  gameToSupportedGameOptions,
  gameToVanillaPacksData,
  supportedGameOptions,
  supportedGameOptionToStartGameOption,
  supportsCompression,
  SupportedGames,
  supportedGames,
  SupportedLanguage,
} from "./supportedGames";
import { tryOpenFile } from "./utility/fileHelpers";
import getPackTableData from "./utility/frontend/packDataHandling";
import { findLatestScriptLog } from "./utility/logPaths";
import { decodePackedTextBuffer, getPackedFileMimeType, getPackedFileViewerKind } from "./utility/packFileViewing";
import { collator } from "./utility/packFileSorting";
import steamCollectionScript from "./utility/steamCollectionScript";
import Trie, { type KeyedLookup } from "./utility/trie";
import hash from "object-hash";
import { Md10K } from "react-icons/md";
import { join } from "path";

declare const VIEWER_WEBPACK_ENTRY: string;
declare const VIEWER_PRELOAD_WEBPACK_ENTRY: string;
declare const SKILLS_WEBPACK_ENTRY: string;
declare const SKILLS_PRELOAD_WEBPACK_ENTRY: string;
declare const TECH_TREES_WEBPACK_ENTRY: string;
declare const TECH_TREES_PRELOAD_WEBPACK_ENTRY: string;
const normalizeGeneratedPrefix = (prefix: string) => prefix.trim().replace(/_+$/, "");
const appendScopedTechNodeHash = (nodeKey: string, campaignKey?: string, factionKey?: string) => {
  const scopeSource = `${campaignKey || ""}${factionKey || ""}`.trim();
  if (!scopeSource) return nodeKey;
  const scopeHash = createHash("sha256").update(scopeSource).digest().subarray(0, 8).toString("base64url");
  return nodeKey.endsWith("_") ? `${nodeKey}${scopeHash}` : `${nodeKey}_${scopeHash}`;
};
const appendScopedSkillNodeHash = (nodeKey: string, campaignKey?: string, factionKey?: string, subculture?: string) => {
  const scopeSource = `${campaignKey || ""}${factionKey || ""}${subculture || ""}`.trim();
  if (!scopeSource) return nodeKey;
  const scopeHash = createHash("sha256").update(scopeSource).digest().subarray(0, 8).toString("base64url");
  return nodeKey.endsWith("_") ? `${nodeKey}${scopeHash}` : `${nodeKey}_${scopeHash}`;
};
const buildDefaultSkillSetSuffix = (subtype: string) => `skill_set_${subtype}`;
const buildSkillsDataSignature = (mods: Mod[], currentGame: SupportedGames) =>
  JSON.stringify({
    currentGame,
    mods: sortByNameAndLoadOrder(mods).map((mod) => ({
      path: mod.path,
      loadOrder: mod.loadOrder ?? null,
      lastChangedLocal: mod.lastChangedLocal ?? null,
    })),
  });
const buildBuildingsModsSignature = (mods: Mod[]) =>
  JSON.stringify(
    sortByNameAndLoadOrder(mods).map((mod) => ({
      path: mod.path,
      loadOrder: mod.loadOrder ?? null,
    })),
  );
const buildBuildingsBuildKey = (mods: Mod[], currentGame: SupportedGames) =>
  JSON.stringify({ currentGame, mods: buildBuildingsModsSignature(mods) });
const resolveSkillGenerationTemplate = (
  template: string,
  variables: { prefix: string; setSuffix: string; timestamp: string; row: string; column: string },
) =>
  template
    .replaceAll("${prefix}", variables.prefix)
    .replaceAll("${xxx}", variables.prefix)
    .replaceAll("${setSuffix}", variables.setSuffix)
    .replaceAll("${yyy}", variables.setSuffix)
    .replaceAll("${timestamp}", variables.timestamp)
    .replaceAll("${row}", variables.row)
    .replaceAll("${r}", variables.row)
    .replaceAll("${column}", variables.column)
    .replaceAll("${c}", variables.column);
let contentWatcher: chokidar.FSWatcher | undefined;
let dataWatcher: chokidar.FSWatcher | undefined;
let downloadsWatcher: chokidar.FSWatcher | undefined;
let mergedWatcher: chokidar.FSWatcher | undefined;
let customModFoldersWatcher: chokidar.FSWatcher | undefined;
/**
 * Opens a pack in the viewer, published by registerIpcMainListeners.
 *
 * The viewer is normally opened by an IPC message from the renderer. Flows run in the main process
 * and have no renderer to send one, so they need a way in from this side.
 */
let openModInViewerFromMainProcess: ((modPath: string) => void) | undefined;

export const openModInViewer = (modPath: string) => {
  if (!openModInViewerFromMainProcess) {
    console.warn(`Cannot open ${modPath} in the viewer: main process listeners are not registered`);
    return;
  }
  openModInViewerFromMainProcess(modPath);
};

export const windows = {
  mainWindow: undefined as BrowserWindow | undefined,
  viewerWindow: undefined as BrowserWindow | undefined,
  skillsWindow: undefined as BrowserWindow | undefined,
  techTreesWindow: undefined as BrowserWindow | undefined,
};

setVanillaDbCacheBuildProgressReporter((progress) => {
  for (const targetWindow of Object.values(windows)) {
    if (targetWindow && !targetWindow.isDestroyed() && !targetWindow.webContents.isDestroyed()) {
      targetWindow.webContents.send("vanillaDbCacheBuildProgress", progress);
    }
  }
});
type VisualsSession = {
  sessionId: string;
  enabledModPaths: string[];
  dbPriorityPackPaths: string[];
  fileSearchPackPaths: string[];
  visualFiles?: VisualsFileResult[];
  visualFilesPromise?: Promise<VisualsFileResult[]>;
  createdAt: number;
};
type UnitViewerSession = {
  sessionId: string;
  data: BuiltUnitViewerData;
  assetPackPaths: string[];
  assetCache: Map<string, { buffer: Buffer; mimeType: string; bytes: number; resolvedPath: string }>;
  assetCacheBytes: number;
  /** Reads in flight, so an image requested twice before it lands is read once. */
  pendingAssets: Map<string, Promise<AssetBytes | undefined>>;
  /** A batch read in flight, which single asset requests wait behind rather than race. */
  pendingPrewarm?: Promise<unknown>;
  createdAt: number;
};
const unitViewerSessions = new Map<string, UnitViewerSession>();
const UNIT_VIEWER_ASSET_CACHE_MAX_BYTES = 64 * 1024 * 1024;
let cachedUnitViewerData: { signature: string; data: BuiltUnitViewerData; assetPackPaths: string[] } | undefined;
type CachedBuildingsData = {
  signature: string;
  signatureInputs?: BuildingsCacheSignatureInputs;
  data: BuiltBuildingsData;
  /** Effective source rows retained so every non-start-pos pending table can rebuild the view. */
  tables: BuildingsTableRows;
  /** Only localization keys consumed by `buildBuildingsData`, captured while the base is built. */
  localizations: Record<string, string>;
  dbPackPath: string;
  /** Variant `icon` cell, normalised to a bare lowercase name -> the packed file that holds it. */
  iconPathByBaseName: Record<string, string>;
  /** Every indexed icon under the building icon folder, including icons not used by current rows. */
  buildingIconPaths: string[];
  icons: Record<string, AssetBytes>;
  iconGeneration: number;
};
let cachedBuildingsData: CachedBuildingsData | undefined;
type CachedAncillariesData = {
  /** Covers the vanilla signature *and* every enabled mod's identity, so any change misses. */
  signature: string;
  data: BuiltAncillariesData;
  /** Effective source rows retained so a pending table can rebuild the panel. */
  tables: AncillariesTableRows;
  /** Only localization keys consumed by `buildAncillariesData`, captured while the base is built. */
  localizations: Record<string, string>;
  originPackPathByAncillary: Record<string, string>;
  dbPackPath: string;
  icons: Record<string, AssetBytes>;
  iconGeneration: number;
};
let cachedAncillariesData: CachedAncillariesData | undefined;
let cachedEsfMapData: { signature: string; data: import("./esfMap/types").EsfMapPayload } | undefined;
// Cache for vanilla pack file name lists, keyed by pack path.
// Allows skipping readPack() on startup when the pack hasn't changed. Module scope rather than
// inside registerIpcMainListeners so anything that only needs a pack's file names - the buildings
// icon scan, for one - can reuse it instead of reading the pack again.
interface VanillaPackFilesCacheEntry {
  size: number;
  lastChangedLocal: number;
  packedFileNames: string[];
}
type VanillaPackFilesCache = Record<string, VanillaPackFilesCacheEntry>;
const VANILLA_PACK_FILES_CACHE_FILE = "vanilla-pack-files-cache.bin";
let vanillaPackFilesCache: VanillaPackFilesCache | null = null;
const loadVanillaPackFilesCache = async (): Promise<VanillaPackFilesCache> => {
  if (vanillaPackFilesCache !== null) return vanillaPackFilesCache;
  try {
    const cacheFilePath = nodePath.join(app.getPath("userData"), VANILLA_PACK_FILES_CACHE_FILE);
    const compressed = await fs.promises.readFile(cacheFilePath);
    const json = await zstdDecompress(compressed);
    vanillaPackFilesCache = JSON.parse(json.toString("utf8")) as VanillaPackFilesCache;
    return vanillaPackFilesCache!;
  } catch {
    vanillaPackFilesCache = {};
    return vanillaPackFilesCache;
  }
};
const saveVanillaPackFilesCache = async (): Promise<void> => {
  if (!vanillaPackFilesCache) return;
  try {
    const cacheFilePath = nodePath.join(app.getPath("userData"), VANILLA_PACK_FILES_CACHE_FILE);
    const json = Buffer.from(JSON.stringify(vanillaPackFilesCache), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(cacheFilePath, compressed);
  } catch (err) {
    console.error("Failed to save vanilla pack files cache:", err);
  }
};

/**
 * A pack's file names, from the cache when its size and mtime still match.
 *
 * The names are all an icon lookup needs, and reading a pack just to list them costs a full index
 * parse per pack - about 260 of them for wh3. Populates the cache for packs the startup path never
 * touched, so the second call in a session is free.
 */
const getVanillaPackedFileNames = async (packPath: string): Promise<string[]> => {
  const cache = await loadVanillaPackFilesCache();
  let stat: fs.Stats | undefined;
  try {
    stat = await fs.promises.stat(packPath);
  } catch {
    return [];
  }
  const entry = cache[packPath];
  if (entry && entry.size === stat.size && entry.lastChangedLocal === stat.mtimeMs) return entry.packedFileNames;

  const alreadyRead = appData.packsData.find((pack) => pack.path == packPath);
  const packedFileNames = alreadyRead
    ? alreadyRead.packedFiles.map((packedFile) => packedFile.name)
    : (await readPack(packPath, { skipParsingTables: true })).packedFiles.map((packedFile) => packedFile.name);

  cache[packPath] = { size: stat.size, lastChangedLocal: stat.mtimeMs, packedFileNames };
  await saveVanillaPackFilesCache();
  return packedFileNames;
};

const visualsSessions = new Map<string, VisualsSession>();
const visualsPackIndexes = new Map<string, { size: number; mtimeMs: number; pack: Pack }>();
const VISUALS_DATA_CACHE_FILE = "visuals-data-cache.bin";
let visualsDataCachePromise: Promise<VisualsDataDiskCache> | undefined;

const loadVisualsDataCache = async (): Promise<VisualsDataDiskCache> => {
  if (!visualsDataCachePromise) {
    visualsDataCachePromise = (async () => {
      const cacheFilePath = nodePath.join(app.getPath("userData"), VISUALS_DATA_CACHE_FILE);
      const cache = await readJsonDiskCache<VisualsDataDiskCache>(cacheFilePath);
      if (
        !cache ||
        cache.version !== VISUALS_DATA_CACHE_VERSION ||
        !cache.entries ||
        typeof cache.entries !== "object"
      ) {
        return createEmptyVisualsDataCache();
      }
      return cache;
    })();
  }
  return visualsDataCachePromise;
};

const saveVisualsDataCache = async (cache: VisualsDataDiskCache): Promise<void> => {
  const cacheFilePath = nodePath.join(app.getPath("userData"), VISUALS_DATA_CACHE_FILE);
  await writeJsonDiskCache(cacheFilePath, cache);
};

const getVisualsPackIdentity = async (packPath: string): Promise<VisualsPackCacheIdentity | undefined> => {
  try {
    const stat = await fs.promises.stat(packPath);
    return { packPath, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
};

const getVisualsSchemaHash = (game: SupportedGames): string | undefined => {
  try {
    const schemaPath = nodePath.join(__dirname, `../schema/${getSchemaFileName(game)}`);
    return createHash("sha1").update(fs.readFileSync(schemaPath)).digest("hex");
  } catch (error) {
    console.error("Failed to identify the schema for the Visuals cache:", error);
    return undefined;
  }
};

const getVisualsTableContribution = (pack: Pack): VisualsTableContribution => {
  const contribution: VisualsTableContribution = {
    variants: [],
    unitVariants: [],
    landUnits: [],
  };

  const forEachTableRow = (tableName: string, visit: (schemaFieldRow: AmendedSchemaField[]) => void) => {
    for (const packedFile of pack.packedFiles) {
      if (!packedFile.name.startsWith(`db\\${tableName}\\`)) continue;
      const dbVersion = getDBVersion(packedFile);
      if (!dbVersion || !packedFile.schemaFields) continue;
      const rows = chunkSchemaIntoRows(
        amendSchemaField(packedFile.schemaFields, dbVersion),
        dbVersion,
      ) as AmendedSchemaField[][];
      for (const row of rows) visit(row);
    }
  };

  forEachTableRow("variants_tables", (row) => {
    const variantName = row.find((field) => field.name === "variant_name")?.resolvedKeyValue;
    if (!variantName) return;
    const variantFilename = row.find((field) => field.name === "variant_filename")?.resolvedKeyValue;
    contribution.variants.push([variantName, variantFilename || ""]);
  });
  forEachTableRow("unit_variants_tables", (row) => {
    const unitKey = row.find((field) => field.name === "unit")?.resolvedKeyValue;
    if (!unitKey) return;
    const faction = row.find((field) => field.name === "faction")?.resolvedKeyValue || "";
    const variantName = row.find((field) => field.name === "variant")?.resolvedKeyValue || "";
    contribution.unitVariants.push([unitKey, faction, variantName]);
  });
  forEachTableRow("land_units_tables", (row) => {
    const unitKey = row.find((field) => field.name === "key")?.resolvedKeyValue;
    if (unitKey) contribution.landUnits.push(unitKey);
  });

  return contribution;
};

const getVisualsLocContribution = (pack: Pack): Array<[string, string]> => {
  const trie = getLocsTrie(pack);
  return trie ? Object.entries(trie.getEntries()) : [];
};
const dbDuplicationCancelStateByWebContentsId = new Map<number, { canceled: boolean }>();
const dbIndirectReferenceCacheByWebContentsId = new Map<number, DBIndirectReferenceCacheContext>();
const createDBIndirectReferenceCacheContext = (): DBIndirectReferenceCacheContext => ({
  packByPath: new Map<string, Pack>(),
  tableFilesByPackAndTable: new Map<string, PackedFile[]>(),
  rowsByPackedFile: new WeakMap<PackedFile, AmendedSchemaField[][]>(),
  columnIndexesByPackedFile: new WeakMap<PackedFile, Map<string, number>>(),
  reverseRefIndexByKey: new Map(),
  reverseRefTtlMs: 5 * 60 * 1000,
  maxReverseRefEntries: 32,
});
const normalizePackFilePath = (value: string) =>
  value.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/^\\+/, "").trim();
const normalizePackFilePathKey = (value: string) => normalizePackFilePath(value).toLowerCase();
const toVariantMeshDefinitionPath = (value: string) => {
  let path = normalizePackFilePath(value);
  if (!path) return path;
  if (!path.toLowerCase().endsWith(".variantmeshdefinition")) {
    path = `${path}.variantmeshdefinition`;
  }
  const lower = path.toLowerCase();
  if (!lower.startsWith("variantmeshes\\")) {
    path = `variantmeshes\\variantmeshdefinitions\\${path}`;
  } else if (!lower.startsWith("variantmeshes\\variantmeshdefinitions\\")) {
    const baseName = nodePath.basename(path);
    path = `variantmeshes\\variantmeshdefinitions\\${baseName}`;
  }
  return normalizePackFilePath(path);
};
const decodePackedFileText = (packedFile: PackedFile) => {
  if (packedFile.text != null) return packedFile.text;
  if (!packedFile.buffer) return undefined;
  const buffer = packedFile.buffer;
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("hex") === "fffe") {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("hex") === "efbbbf") {
    return buffer.subarray(3).toString("utf8");
  }
  return buffer.toString("utf8");
};
const findPackedFileCaseInsensitive = (pack: Pack, fileName: string) => {
  const normalizedTarget = normalizePackFilePathKey(fileName);
  const exactIndex = bs(pack.packedFiles, fileName, (a: PackedFile, b: string) => collator.compare(a.name, b));
  if (exactIndex >= 0) return pack.packedFiles[exactIndex];
  return pack.packedFiles.find((packedFile) => normalizePackFilePathKey(packedFile.name) === normalizedTarget);
};
const getOrLoadPackFromAppData = async (packPath: string) => {
  let stat: { size: number; mtimeMs: number } | undefined;
  try {
    stat = await fs.promises.stat(packPath);
  } catch {
    // Let readPack or the retained pack provide the existing failure behavior below.
  }
  const retainedVisualsIndex = visualsPackIndexes.get(packPath);
  if (stat && retainedVisualsIndex?.size === stat.size && retainedVisualsIndex.mtimeMs === stat.mtimeMs) {
    return retainedVisualsIndex.pack;
  }
  const pack = appData.packsData.find((existingPack) => existingPack.path === packPath);
  if (pack) {
    const isPlaceholderIndex =
      pack.packedFiles.length > 0 && pack.packedFiles.every((file) => file.file_size === 0 && file.start_pos === 0);
    if (stat && pack.size === stat.size && pack.lastChangedLocal === stat.mtimeMs && !isPlaceholderIndex) {
      return pack;
    }
    if (stat) {
      // Do not merge a changed index into a retained parsed pack: appendPacksData intentionally only
      // merges parsed files. The fresh index is sufficient for this Visuals request and avoids stale
      // search/open results until the normal mod refresh replaces the retained pack.
      const freshPack = await readPack(packPath, { skipParsingTables: true });
      visualsPackIndexes.set(packPath, { size: stat.size, mtimeMs: stat.mtimeMs, pack: freshPack });
      return freshPack;
    }
    return pack;
  }
  const newPack = await readPack(packPath, { skipParsingTables: true });
  if (stat) {
    visualsPackIndexes.set(packPath, { size: stat.size, mtimeMs: stat.mtimeMs, pack: newPack });
  }
  appendPacksData(newPack);
  return appData.packsData.find((existingPack) => existingPack.path === packPath);
};
const getVisualsFilesForSession = async (session: VisualsSession): Promise<VisualsFileResult[]> => {
  if (session.visualFiles) return session.visualFiles;
  if (session.visualFilesPromise) return session.visualFilesPromise;

  session.visualFilesPromise = (async () => {
    const cache = await loadVisualsDataCache();
    const contributions: VisualsFileResult[][] = [];
    let didChangeCache = false;
    for (const packPath of session.fileSearchPackPaths) {
      const identity = await getVisualsPackIdentity(packPath);
      if (!identity) continue;
      let entry = getCurrentVisualsPackCacheEntry(cache, identity);
      if (!entry?.files) {
        const pack = await getOrLoadPackFromAppData(packPath);
        if (!pack) continue;
        entry = getOrCreateVisualsPackCacheEntry(cache, identity);
        entry.files = getVisualsFilesFromNames(pack.packedFiles.map((file) => file.name));
        didChangeCache = true;
      }
      contributions.push(entry.files);
    }
    if (didChangeCache) await saveVisualsDataCache(cache);
    const files = mergeVisualsFileContributions(contributions);
    session.visualFiles = files;
    return files;
  })();

  try {
    return await session.visualFilesPromise;
  } finally {
    session.visualFilesPromise = undefined;
  }
};
const resolveVisualsFileInSession = async (
  session: VisualsSession,
  fileName: string,
  options?: { variantMeshDefinitionFallback?: boolean; preferredPackPath?: string },
) => {
  let requestedPath = normalizePackFilePath(fileName);
  if (!requestedPath) return undefined;
  if (options?.variantMeshDefinitionFallback) {
    const lowerRequested = requestedPath.toLowerCase();
    const looksExplicitPath = lowerRequested.includes("\\") || lowerRequested.startsWith("variantmeshes");
    if (
      lowerRequested.endsWith(".variantmeshdefinition") ||
      !looksExplicitPath ||
      !(/\.[a-z0-9_]+$/i.test(lowerRequested) && !lowerRequested.endsWith(".variantmeshdefinition"))
    ) {
      requestedPath = toVariantMeshDefinitionPath(requestedPath);
    }
  }
  if (!requestedPath) return undefined;
  const preferredPackPath = options?.preferredPackPath;
  const searchPackPaths = [...session.fileSearchPackPaths].toReversed();
  const prioritizedPackPaths =
    preferredPackPath && searchPackPaths.includes(preferredPackPath)
      ? [preferredPackPath, ...searchPackPaths.filter((packPath) => packPath !== preferredPackPath)]
      : searchPackPaths;
  for (const packPath of prioritizedPackPaths) {
    const pack = await getOrLoadPackFromAppData(packPath);
    if (!pack) continue;
    const matchedFile = findPackedFileCaseInsensitive(pack, requestedPath);
    if (!matchedFile) continue;
    return {
      requestedPath,
      pack,
      packPath,
      fileName: matchedFile.name,
    };
  }
  return {
    requestedPath,
  };
};
const sendAssetEditorOpenRequest = async (args: {
  packPathOnDisk: string;
  path: string;
  openInExistingKitbashTab: boolean;
}) => {
  const pipePath = "\\\\.\\pipe\\TheAssetEditor.Ipc";
  const connectionTimeoutMs = 5000;
  const responseTimeoutMs = 60000;
  return new Promise<{ ok?: boolean; error?: string; normalizedPath?: string }>((resolve, reject) => {
    const socket = net.connect(pipePath);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        fn();
      } finally {
        socket.removeAllListeners();
        socket.end();
        socket.destroy();
      }
    };
    timeout = setTimeout(() => {
      finish(() => reject(new Error(`Timed out connecting to AssetEditor IPC pipe ${pipePath}`)));
    }, connectionTimeoutMs);
    socket.on("connect", () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        finish(() => reject(new Error("AssetEditor accepted the request but did not respond within 60 seconds")));
      }, responseTimeoutMs);
      const request = {
        action: "open",
        path: args.path,
        bringToFront: true,
        openInExistingKitbashTab: args.openInExistingKitbashTab,
        packPathOnDisk: args.packPathOnDisk,
      };
      const requestAsJSON = JSON.stringify(request);
      console.log("sending asset editor request:", requestAsJSON);
      socket.write(`${requestAsJSON}\n`);
    });
    socket.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex).trim();
      finish(() => {
        if (!line) {
          reject(new Error("AssetEditor IPC returned an empty response"));
          return;
        }
        try {
          resolve(JSON.parse(line) as { ok?: boolean; error?: string; normalizedPath?: string });
        } catch (error) {
          reject(
            new Error(
              `Failed to parse AssetEditor IPC response: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
    });
    socket.on("error", (error) => {
      finish(() => {
        reject(new Error(`Failed to connect to ${pipePath}: ${error.message}`));
      });
    });
    socket.on("close", () => {
      if (settled) return;
      finish(() => {
        reject(new Error("AssetEditor IPC connection closed before a response was received"));
      });
    });
  });
};
const appendCollisions = async (newPack: Pack) => {
  while (!appData.compatData) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (appData.compatData) {
    appData.compatData.packTableCollisions = appendPackTableCollisions(
      appData.packsData,
      appData.compatData.packTableCollisions,
      newPack,
    );
    appData.compatData.packFileCollisions = appendPackFileCollisions(
      appData.packsData,
      appData.compatData.packFileCollisions,
      newPack,
    );
  }
};
const matchVanillaDBFiles = /^db\\.*\\data__/;
const appendPacksData = (newPack: Pack, mod?: Mod, emitToMainWindow = true) => {
  const existingPack = appData.packsData.find((pack) => pack.path == newPack.path);
  console.log("appendPacksData: appending", newPack.name);
  console.log("appendPacksData: is existingPack:", !!existingPack);
  if (!existingPack) {
    appData.packsData.push(newPack);
    if (emitToMainWindow) {
      windows.mainWindow?.webContents.send("setPacksDataRead", [newPack.path]);
    }
    const candidateFileNames = newPack.packedFiles
      .map((packedFile) => packedFile.name)
      .filter((packedFileName) => packedFileName.match(matchVanillaDBFiles) || packedFileName.endsWith(".lua"));
    // Gathered once rather than scanned per candidate: a mod adding scripts of its own finds no
    // match for any of them, and that is the case that walked every vanilla pack in full each time.
    const vanillaFileNames = new Set<string>();
    if (candidateFileNames.length > 0) {
      for (const vanillaPack of appData.vanillaPacks) {
        for (const packedFileInData of vanillaPack.packedFiles) vanillaFileNames.add(packedFileInData.name);
      }
    }
    const overwrittenFileNames = candidateFileNames.filter((packedFileName) => vanillaFileNames.has(packedFileName));
    if (overwrittenFileNames.length > 0) {
      appData.overwrittenDataPackedFiles[newPack.name] = overwrittenFileNames;
      if (emitToMainWindow) {
        windows.mainWindow?.webContents.send("setOverwrittenDataPackedFiles", appData.overwrittenDataPackedFiles);
      }
    }
    const outdatedPackFiles = new Set<string>();
    if (appData.currentGame == "wh3" && mod && (mod.lastChangedLocal || mod.lastChanged)) {
      const lastChanged = mod.lastChanged || mod.lastChangedLocal;
      if (lastChanged) {
        appData.gameUpdates
          .filter((gameUpdate) => parseInt(gameUpdate.timestamp) * 1000 - lastChanged > 0)
          .reduce((acc, current) => {
            if (current.files) {
              current.files
                .filter((fileUpdateRule) => {
                  const ret = newPack.packedFiles.some((pF) => pF.name.search(fileUpdateRule.regex) > -1);
                  // if (ret)
                  //   console.log(
                  //     "file match",
                  //     newPack.packedFiles.find((pF) => pF.name.search(fileUpdateRule.regex) > -1)?.name,
                  //     "regex",
                  //     fileUpdateRule.regex,
                  //     "ret",
                  //     ret
                  //   );
                  return ret;
                })
                .map((updateRule) => `${current.version}: ${updateRule.reason}`)
                .forEach((updateStr) => acc.add(updateStr));
            }
            return acc;
          }, outdatedPackFiles);
      }
    }
    console.log("outdatedPackFiles", outdatedPackFiles);
    if (outdatedPackFiles.size > 0) {
      appData.outdatedPackFiles[newPack.name] = Array.from(outdatedPackFiles);
      if (emitToMainWindow) {
        windows.mainWindow?.webContents.send("setOutdatedPackFiles", appData.outdatedPackFiles);
      }
    }
  } else {
    console.log("existing pack for", newPack.name, "found");
    // append list of tables that are parsed in that pack
    if (newPack.readTables == "all") {
      existingPack.readTables = "all";
    } else {
      newPack.readTables.forEach((newlyRead) => {
        if (existingPack.readTables != "all" && !existingPack.readTables.includes(newlyRead)) {
          existingPack.readTables.push(newlyRead);
        }
      });
    }
    newPack.packedFiles
      .filter((packedFile) => packedFile.schemaFields)
      .forEach((newPackedFile) => {
        const index = existingPack.packedFiles.findIndex(
          (existingPackedFile) => existingPackedFile.name == newPackedFile.name,
        );
        if (index != -1) {
          existingPack.packedFiles.splice(index, 1);
        }
        existingPack.packedFiles.push(newPackedFile);
      });
  }
};
/**
 * Every loc entry in a pack, one at a time.
 *
 * The same walk `getLocsTrie` does, without building the trie: feeding a cache builder through a
 * trie would pay ~97 MB of node overhead to produce something it immediately flattens again.
 */
export const forEachPackLocEntry = (pack: Pack, visit: (key: string, value: string) => void) => {
  const locPackedFiles = Object.values(pack.packedFiles).filter((packedFile) => packedFile.name.endsWith(".loc"));
  const packViewData = getPackViewData(pack, undefined, true);
  if (!packViewData) return;
  for (const packedFile of locPackedFiles) {
    const data = getPackTableData(packedFile.name, packViewData);
    if (!data) continue;
    for (const rows of Object.values(data)) {
      for (const row of rows) {
        const locKey = row[0] as string;
        if (locKey) visit(locKey, row[1] as string);
      }
    }
  }
};

/**
 * Icons a tooltip turned out to need that the feature's initial sweep did not cover.
 *
 * Reads them, adds them to the record and registers them for the asset protocol, returning the
 * generation their URLs have to be built with. Undefined when there was nothing left to read.
 */
const loadMissingIconsInto = async (icons: Record<string, AssetBytes>, packs: Pack[], iconPaths: string[]) => {
  const missing = iconPaths.filter((iconPath) => !icons[iconPath]);
  if (missing.length === 0) return undefined;
  const loaded = await loadIconsFromPacks(packs, missing);
  Object.assign(icons, loaded);
  return registerIconAssets(loaded);
};

/**
 * The vanilla packs that actually hold one of `iconPaths`, in load order.
 *
 * The skills and technology builds each want a few dozen icons and used to find them by indexing
 * every vanilla pack their filter let through - a full index parse per pack, repeated on every
 * build, to read three or four of them. The global file index answers which pack wins for a path
 * without opening anything.
 *
 * Undefined means there is no index to ask, which callers read as "fall back to the whole set".
 */
const findVanillaPacksHoldingIcons = async (iconPaths: readonly string[]): Promise<string[] | undefined> => {
  if (iconPaths.length === 0) return [];
  const vanillaIndex = await getVanillaPackIndex();
  if (!vanillaIndex) return undefined;
  return selectVanillaPacksHoldingFiles(vanillaIndex, iconPaths, getVanillaPackPathsInLoadOrder());
};

/**
 * The vanilla rows for `tablePathPrefixes`, from the vanilla db cache wherever it can serve them.
 *
 * Vanilla ships its db tables in the database pack, but this asks the file index rather than
 * assuming it, so a game or a table family that breaks the rule is read rather than missed. Only the
 * database pack can come from the cache - that is all the cache holds - and anything else is read
 * the way it always was.
 *
 * Undefined means the read did not produce every prefix's rows - usually because another operation
 * was already reading a pack this one wanted. It matters because both callers distil these rows into
 * a model they then cache: a model built without the base game's rows reads as a real answer, with
 * mods present and vanilla missing, and would be served for the rest of the session.
 */
const readVanillaTablePacks = async (
  dataFolder: string,
  tablePathPrefixes: string[],
  fallbackPackPaths: string[],
  emitToMainWindow: boolean,
): Promise<Pack[] | undefined> => {
  const dbPackPath = nodePath.join(dataFolder, gameToPackWithDBTablesName[appData.currentGame]);
  const vanillaIndex = await getVanillaPackIndex();

  // No pack under any of these prefixes is not an answer worth acting on - an index built before the
  // tables existed says the same thing as a game that genuinely has none. Read the old set.
  const narrowed = vanillaIndex
    ? selectVanillaPacksHoldingTables(vanillaIndex, tablePathPrefixes, getVanillaPackPathsInLoadOrder())
    : [];
  const packPaths = narrowed.length > 0 ? narrowed : fallbackPackPaths;

  const stillToRead: string[] = [];
  for (const packPath of packPaths) {
    if (nodePath.resolve(packPath) !== nodePath.resolve(dbPackPath)) {
      stillToRead.push(packPath);
      continue;
    }
    // The file index still comes from the pack, which is cheap; the parse, which is not, comes from
    // the cache. Partly served is no use: the rows below are read per prefix.
    const indexedDbPack = await readPack(packPath, { skipParsingTables: true });
    const { unservedPrefixes } = await fillVanillaTablesFromCache(indexedDbPack, tablePathPrefixes, getDBVersion);
    if (unservedPrefixes.length === 0) {
      indexedDbPack.readTables = [...tablePathPrefixes];
      appendPacksData(indexedDbPack, undefined, emitToMainWindow);
      continue;
    }
    console.log("readVanillaTablePacks: prefixes the vanilla db cache did not serve:", unservedPrefixes);
    stillToRead.push(packPath);
  }
  if (stillToRead.length > 0) {
    await readModsByPath(
      stillToRead,
      { skipParsingTables: false, tablesToRead: tablePathPrefixes },
      true,
      emitToMainWindow,
    );
  }

  const packsByPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
  const packs = packPaths.map((packPath) => packsByPath.get(packPath)).filter((pack): pack is Pack => !!pack);
  // Only the packs that carry one of these tables. When the index was unavailable the set above is
  // the caller's whole vanilla filter, and handing a consumer packs with nothing in them would have
  // it build view data per pack for no rows.
  const carriers = packs.filter((pack) =>
    pack.packedFiles.some((packedFile) => tablePathPrefixes.some((prefix) => packedFile.name.startsWith(prefix))),
  );
  // Not one pack carrying any of them means the pack that does was never read, not that the game
  // ships none of these tables: `findUnparsedTablePrefixes` has nothing to report either way, so it
  // cannot tell those apart on its own.
  if (carriers.length === 0) return undefined;
  if (findUnparsedTablePrefixes(carriers, tablePathPrefixes).length > 0) return undefined;
  return carriers;
};

const getVanillaLocalisationPackPaths = (dataFolder: string) =>
  getVanillaLocalisationPackPathsFor(
    appData.allVanillaPackNames,
    appData.currentLanguage,
    dataFolder,
    appData.isUsingEnglishLocalizations,
  );

/**
 * The game's own locs, as an entry for the `locs` record consumers look keys up in.
 *
 * Returns the cache reader under one synthetic key rather than a trie per pack, which is the whole
 * saving: the tries these replace cost ~97 MB of heap and are retained for as long as the skills or
 * technology data is. Consumers spread this first so mod locs, which stay on the live path, keep
 * whatever precedence they had.
 *
 * Falls back to reading the packs and building tries, so a cache that cannot be built or opened
 * degrades to the old behaviour instead of losing every localised string.
 */
export const getVanillaLocLookup = async (vanillaPackPaths: string[]): Promise<Record<string, KeyedLookup<string>>> => {
  const readVanillaLocPacks = async () => {
    if (vanillaPackPaths.length > 0) {
      await readModsByPath(vanillaPackPaths, { skipParsingTables: true, readLocs: true }, true, false);
    }
    const loadedByPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
    return vanillaPackPaths.map((packPath) => loadedByPath.get(packPath)).filter((pack): pack is Pack => !!pack);
  };

  const reader = await openOrBuildVanillaLocCache({
    userDataPath: app.getPath("userData"),
    game: appData.currentGame,
    packPaths: vanillaPackPaths,
    readEntries: async () => {
      const entries: Array<readonly [string, string]> = [];
      for (const pack of await readVanillaLocPacks()) {
        forEachPackLocEntry(pack, (key, value) => entries.push([key, value]));
      }
      return entries;
    },
  });
  if (reader) return { "vanilla-loc-cache": reader };
  return getLocsFromPacks(await readVanillaLocPacks(), getLocsTrie);
};

export const getLocsTrie = (pack: Pack) => {
  console.log("getLocsTrie:", pack.name);
  const trie = new Trie<string>("_");
  const locPFs = Object.values(pack.packedFiles).filter((pF) => pF.name.endsWith(".loc"));
  const packViewData = getPackViewData(pack, undefined, true);
  if (!packViewData) {
    console.log("getLocsTrie: packViewData INVALID");
    return;
  }
  for (const packedFile of locPFs) {
    const data = getPackTableData(packedFile.name, packViewData);
    if (!data) continue;
    // console.log("loc data for:", pack.name, data);
    for (const rows of Object.values(data)) {
      for (const row of rows) {
        const [locKey, locValue] = [row[0] as string, row[1] as string];
        // console.log("loc:", locKey, locValue);
        if (locKey && locKey != "") trie.add(locKey, locValue);
      }
    }
  }
  return trie;
};
const gameToDefaultTableVersions = {} as Record<SupportedGames, Record<string, number>>;
interface DefaultTableVersionsCacheEntry {
  dbPackSize: number;
  dbPackMtimeMs: number;
  tableNameToVersion: Record<string, number>;
}
const DEFAULT_TABLE_VERSIONS_CACHE_FILE = "default-table-versions-cache.bin";
/**
 * One integer per table, and getting it costs a full parse of every table in the game's db pack -
 * the version only exists in the parsed output. Worth keeping across restarts, keyed like the other
 * vanilla caches on the pack's size and mtime.
 */
export const getDefaultTableVersions = async () => {
  const cachedGameToDefaultTableVersions = gameToDefaultTableVersions[appData.currentGame];
  if (cachedGameToDefaultTableVersions) return cachedGameToDefaultTableVersions;
  const dbPackName = gameToPackWithDBTablesName[appData.currentGame];
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
  if (!dataFolder) return;
  const dbPackPath = nodePath.join(dataFolder, dbPackName);

  const cacheFilePath = nodePath.join(app.getPath("userData"), DEFAULT_TABLE_VERSIONS_CACHE_FILE);
  let dbPackStats: fs.Stats | undefined;
  try {
    dbPackStats = await fs.promises.stat(dbPackPath);
  } catch {
    // No pack to key the cache on, so fall through and let the read below fail as it did before.
  }

  type DefaultTableVersionsCache = Partial<Record<SupportedGames, DefaultTableVersionsCacheEntry>>;
  const diskCache = (await readJsonDiskCache<DefaultTableVersionsCache>(cacheFilePath)) ?? {};
  const cacheEntry = diskCache[appData.currentGame];
  if (
    dbPackStats &&
    cacheEntry &&
    cacheEntry.dbPackSize === dbPackStats.size &&
    cacheEntry.dbPackMtimeMs === dbPackStats.mtimeMs
  ) {
    gameToDefaultTableVersions[appData.currentGame] = cacheEntry.tableNameToVersion;
    return cacheEntry.tableNameToVersion;
  }

  let pack = appData.packsData.find((packData) => packData.path == dbPackPath);
  if (!pack || (pack && pack.packedFiles.length == 0)) {
    pack = await readPack(dbPackPath, { skipParsingTables: true });
  }
  if (!pack) return;
  const dataPackData = await readPack(dbPackPath, {
    tablesToRead: pack.packedFiles.filter((pf) => pf.name.startsWith("db\\")).map((pf) => pf.name),
  });
  const tableNameToVersion = {} as Record<string, number>;
  // Default versions come from the game's own tables, so the live db folder alone.
  for (const packedFile of dataPackData.packedFiles) {
    const dbName = parseLiveDBTablePath(packedFile.name)?.dbName;
    if (dbName == undefined) continue;
    tableNameToVersion[dbName] = packedFile.version ?? 0;
  }
  gameToDefaultTableVersions[appData.currentGame] = tableNameToVersion;

  if (dbPackStats) {
    diskCache[appData.currentGame] = {
      dbPackSize: dbPackStats.size,
      dbPackMtimeMs: dbPackStats.mtimeMs,
      tableNameToVersion,
    };
    await writeJsonDiskCache(cacheFilePath, diskCache);
  }
  return tableNameToVersion;
};
/**
 * The packs being read right now. Every read of a whole pack registers here, so a caller that needs
 * one can wait for the read in flight instead of reading beside it or giving up on it.
 */
export const packReads = createPackReadRegistry();

/** A pack read that is registered for its whole duration, released even when the read throws. */
const readPackWhileRegistered = async (packPath: string, packReadingOptions: PackReadingOptions) => {
  const releaseRead = packReads.begin(packPath);
  try {
    return await readPack(packPath, packReadingOptions);
  } finally {
    releaseRead();
  }
};

export const readModsByPath = async (
  modPaths: string[],
  packReadingOptions: PackReadingOptions,
  skipCollisionCheck = true,
  emitToMainWindow = true,
) => {
  console.log("readModsByPath:", modPaths, "packReadingOptions:", packReadingOptions);
  // console.log("readModsByPath skipParsingTables:", skipParsingTables);
  // console.log("readModsByPath skipCollisionCheck:", skipCollisionCheck);
  // if (!skipParsingTables) {
  //   appData.packsData = appData.packsData.filter((pack) => !modPaths.some((modPath) => modPath == pack.path));
  // }
  const newPacks = [] as Pack[];
  for (const modPath of modPaths) {
    // Wait for whoever is reading this pack rather than skip it. The read in flight is not this
    // caller's read - it may be parsing an entirely different set of tables - so giving up on it
    // returned a pack holding none of the tables asked for, with only a log line to say so. A full
    // parse of the game's database pack runs well past any fixed wait, so the wait is exact and the
    // backstop below only guards against a registration that leaked.
    if (!(await packReads.waitUntilFree(modPath))) {
      console.log("readModsByPath: waited too long for a read of", modPath, "to end, reading it anyway");
    }
    // console.log("READING ", modPath, readLocs);
    if (emitToMainWindow) {
      windows.mainWindow?.webContents.send("setCurrentlyReadingMod", modPath);
    }
    const newPack = await readPackWhileRegistered(modPath, packReadingOptions);
    if (emitToMainWindow) {
      windows.mainWindow?.webContents.send("setLastModThatWasRead", modPath);
    }
    // if (appData.packsData.every((pack) => pack.path != modPath)) {
    appendPacksData(newPack, undefined, emitToMainWindow);
    // }
    if (!skipCollisionCheck) {
      appendCollisions(newPack);
    }
    newPacks.push(newPack);
  }
  if (!skipCollisionCheck) {
    windows.mainWindow?.webContents.send("setPackCollisions", {
      packFileCollisions: appData.compatData.packFileCollisions,
      packTableCollisions: appData.compatData.packTableCollisions,
    } as PackCollisions);
  }
  return newPacks;
};
export const registerIpcMainListeners = (mainWindow: Electron.CrossProcessExports.BrowserWindow, isDev: boolean) => {
  const log = (msg: string) => {
    mainWindow?.webContents.send("handleLog", msg);
    console.log(msg);
  };
  const tempModDatas: ModData[] = [];
  const sendModData = debounce(() => {
    mainWindow?.webContents.send("setModData", [...tempModDatas]);
    tempModDatas.splice(0, tempModDatas.length);
  }, 200);
  const getCachedSkillsSelection = () => {
    if (!appData.skillsData) return undefined;

    const currentSubtype = appData.lastSkillsSelection?.currentSubtype;
    const currentSubtypeIndex = appData.lastSkillsSelection?.currentSubtypeIndex ?? 0;
    if (
      currentSubtype &&
      appData.skillsData.subtypesToSet[currentSubtype] &&
      appData.skillsData.subtypesToSet[currentSubtype][currentSubtypeIndex]
    ) {
      return {
        currentSubtype,
        currentSubtypeIndex,
      };
    }

    const defaultSubtype = getDefaultSkillsSubtype(appData.skillsData.subtypesToSet);
    if (!defaultSubtype) return undefined;

    return {
      currentSubtype: defaultSubtype,
      currentSubtypeIndex: 0,
    };
  };
  /**
   * One skills build at a time, for the same reason the Unit Viewer has one: the cold path below
   * fills vanilla rows into the shared packs, uses them across several awaits and releases them at
   * the end, and it persists a vanilla core cache from what it read.
   */
  const skillsDataBuilds = createSerializedBuilds();
  const getSkillsData = async (mods: Mod[]) =>
    skillsDataBuilds.run(buildSkillsDataSignature(mods, appData.currentGame), () => buildSkillsData(mods));
  const buildSkillsData = async (mods: Mod[]) => {
    console.log(
      "getSkillsData:",
      mods.map((mod) => mod.name),
    );
    const skillsDataSignature = buildSkillsDataSignature(mods, appData.currentGame);
    if (appData.skillsData && appData.lastSkillsDataSignature === skillsDataSignature) {
      console.log("getSkillsData: using in-memory cached skills data");
      const cachedSelection = getCachedSkillsSelection();
      if (cachedSelection) {
        await getSkillsForSubtype(cachedSelection.currentSubtype, cachedSelection.currentSubtypeIndex);
      }
      return;
    }
    const tablesToRead = resolveTable("character_skill_node_set_items_tables").map((table) => `db\\${table}\\`);
    const effectTablesToRead = resolveTable("character_skill_level_to_effects_junctions_tables").map(
      (table) => `db\\${table}\\`,
    );
    for (const effectTable of effectTablesToRead) {
      if (!tablesToRead.includes(effectTable)) tablesToRead.push(effectTable);
    }
    const nodeLinksTablesToRead = resolveTable("character_skill_node_links_tables").map((table) => `db\\${table}\\`);
    for (const nodeLinksTable of nodeLinksTablesToRead) {
      if (!tablesToRead.includes(nodeLinksTable)) tablesToRead.push(nodeLinksTable);
    }
    const skillLocksTablesToRead = resolveTable("character_skill_nodes_skill_locks_tables").map(
      (table) => `db\\${table}\\`,
    );
    for (const skillLocksTable of skillLocksTablesToRead) {
      if (!tablesToRead.includes(skillLocksTable)) tablesToRead.push(skillLocksTable);
    }
    const effectBonusValueIdsUnitSetsTablesToRead = resolveTable("effect_bonus_value_ids_unit_sets_tables").map(
      (table) => `db\\${table}\\`,
    );
    for (const effectBonusValueIdsUnitSetsTable of effectBonusValueIdsUnitSetsTablesToRead) {
      if (!tablesToRead.includes(effectBonusValueIdsUnitSetsTable)) tablesToRead.push(effectBonusValueIdsUnitSetsTable);
    }
    const abilityTooltipTablesToRead = [
      "effect_bonus_value_unit_ability_junctions_tables",
      "unit_abilities_tables",
      "unit_special_abilities_tables",
      "projectile_bombardments_tables",
      "projectiles_tables",
      "projectiles_explosions_tables",
      "battle_vortexs_tables",
      "_kv_unit_ability_scaling_rules_tables",
      "special_ability_to_special_ability_phase_junctions_tables",
      "special_ability_phases_tables",
      "special_ability_phase_stat_effects_tables",
      "ui_unit_stats_tables",
      "unit_abilities_to_additional_ui_effects_juncs_tables",
      "unit_abilities_additional_ui_effects_tables",
      "special_ability_groups_to_unit_abilities_junctions_tables",
      "special_ability_groups_tables",
      "special_ability_to_auto_deactivate_flags_tables",
    ];
    for (const table of abilityTooltipTablesToRead) {
      for (const resolvedTable of resolveTable(table).map((resolvedTable) => `db\\${resolvedTable}\\`)) {
        if (!tablesToRead.includes(resolvedTable)) tablesToRead.push(resolvedTable);
      }
    }
    // const effectsTablesToRead = resolveTable("effects_tables").map((table) => `db\\${table}\\`);
    // for (const effectsTable of effectsTablesToRead) {
    //   if (!tablesToRead.includes(effectsTable)) tablesToRead.push(effectsTable);
    // }
    console.log("RESOLVED tablesToRead:", tablesToRead);
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;
    const vanillaPacksToRead = [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          packName.startsWith("local_en") ||
          (!packName.startsWith("audio_") &&
            !packName.startsWith("local_") &&
            !packName.startsWith("models") &&
            !packName.startsWith("movies") &&
            !packName.startsWith("tile") &&
            !packName.startsWith("variants") &&
            !packName.startsWith("warmachines") &&
            !packName.startsWith("terrain")),
      )
      .map((packName) => nodePath.join(dataFolder, packName));
    const cachedVanillaSkillsCore = await getVanillaSkillsDataCoreFromCache({
      dataFolder,
      currentGame: appData.currentGame,
      userDataPath: app.getPath("userData"),
    });
    if (cachedVanillaSkillsCore) {
      console.log("getSkillsData: using cached vanilla skills core data");
      if (mods.length > 0) {
        await readMods(mods, false, true, false, true, tablesToRead, undefined, false);
      }
      const vanillaLocs = await getVanillaLocLookup(getVanillaLocalisationPackPaths(dataFolder));
      const enabledModPacks = appData.packsData.filter((packData) => mods.some((mod) => mod.path == packData.path));
      const mergedSkillsCore = cloneSkillsDataCore(cachedVanillaSkillsCore);
      if (mods.length > 0) {
        const sortedMods = sortByNameAndLoadOrder(mods);
        const unsortedModPacksTableData = getPacksTableData(enabledModPacks, tablesToRead, true) || [];
        const orderedModPacksTableData = [] as PackViewData[];
        for (const mod of sortedMods.toReversed()) {
          const packTableData = unsortedModPacksTableData.find((ptd) => ptd.packPath == mod.path);
          if (packTableData) orderedModPacksTableData.push(packTableData);
        }
        applyModOverlayToSkillsDataCore(mergedSkillsCore, orderedModPacksTableData, getTableRowData);
      }
      // Vanilla first, matching the order these were merged in before: the lookups read the record
      // in insertion order and take the first hit.
      const locs = { ...vanillaLocs, ...getLocsFromPacks(enabledModPacks, getLocsTrie) };
      const skillIconPaths = getSkillAndEffectIconPaths(
        mergedSkillsCore.skills,
        mergedSkillsCore.skillsToEffects,
        mergedSkillsCore.effectsToEffectData,
      );
      // Vanilla is read on this path for its icons and nothing else, so only the handful of packs
      // that hold one gets indexed. The icon paths have to be known first, which is why this sits
      // below the merge rather than beside the mod read.
      const vanillaPacks = await getIconPacks(
        (await findVanillaPacksHoldingIcons(skillIconPaths)) ?? vanillaPacksToRead,
      );
      const icons = await loadIconsFromPacks(vanillaPacks.concat(enabledModPacks), skillIconPaths);
      appData.skillsData = {
        ...mergedSkillsCore,
        locs,
        icons,
        iconGeneration: registerIconAssets(icons),
        skillsDataPackPaths: vanillaPacks.concat(enabledModPacks).map((pack) => pack.path),
      };
      appData.lastSkillsDataSignature = skillsDataSignature;
      // The overlay has been folded into the core above, so the mod rows it was read from are done
      // with. Vanilla was never parsed on this path - it is only read for its icons.
      releaseParsedTables(enabledModPacks, tablesToRead);
      const defaultSubtype = getDefaultSkillsSubtype(mergedSkillsCore.subtypesToSet);
      if (defaultSubtype) {
        await getSkillsForSubtype(defaultSubtype, 0);
      }
      return;
    }
    await readMods(mods, false, true, false, true, tablesToRead, undefined, false);
    // Only the packs that hold these tables, and their rows from the vanilla db cache where it can
    // serve them. The vanilla locs are not read here at all - they come from the loc cache below -
    // and undefined means a pack another operation was reading was not parsed. Building on that
    // produces skills data holding only the mods' rows, which the vanilla core cache would then
    // persist as if it were the base game's. Give up instead: the next request rebuilds from scratch.
    const vanillaSkillsPacks = await readVanillaTablePacks(dataFolder, tablesToRead, vanillaPacksToRead, false);
    if (!vanillaSkillsPacks) {
      console.log("getSkillsData: the vanilla skills tables were not read, not building");
      return;
    }
    const vanillaSkillsPackPaths = new Set(vanillaSkillsPacks.map((pack) => pack.path));
    const unsortedPacksTableData = getPacksTableData(
      appData.packsData.filter(
        (pack) => vanillaSkillsPackPaths.has(pack.path) || mods.some((mod) => mod.path === pack.path),
      ),
      tablesToRead,
      true,
    );
    if (!unsortedPacksTableData) return;
    const packsTableData = [] as PackViewData[];
    // sort the mods by load priority
    const sortedMods = sortByNameAndLoadOrder(mods);
    const vanillaPacksTableData = vanillaSkillsPacks
      .map((pack) => unsortedPacksTableData.find((ptd) => ptd.packPath == pack.path))
      .filter((packTableData): packTableData is PackViewData => !!packTableData);
    packsTableData.push(...vanillaPacksTableData);
    for (const mod of sortedMods.toReversed()) {
      const packTableData = unsortedPacksTableData.find((ptd) => ptd.packPath == mod.path);
      if (packTableData) packsTableData.push(packTableData);
    }
    assert(unsortedPacksTableData.length == packsTableData.length);
    const effects: EffectData[] = [];
    getTableRowData(packsTableData, "effects_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      const icon = schemaFieldRow.find((sF) => sF.name == "icon")?.resolvedKeyValue;
      const isPositive = schemaFieldRow.find((sF) => sF.name == "is_positive_value_good")?.resolvedKeyValue;
      const priority = schemaFieldRow.find((sF) => sF.name == "priority")?.resolvedKeyValue;
      if (key != undefined && icon != undefined && isPositive != undefined && priority != undefined) {
        const newEffect = {
          key,
          icon,
          isPositive,
          priority,
        };
        const existingIndex = effects.findIndex((effect) => effect.key == key);
        if (existingIndex > -1) {
          effects.splice(existingIndex, 1, newEffect);
        } else effects.push(newEffect);
      }
    });
    const effectsToEffectData: Record<string, EffectData> = {};
    for (const effectData of effects) {
      effectsToEffectData[effectData.key] = effectData;
    }
    const effectBonusValueIdsUnitSets: { bonusValueId: string; effect: string; unitSet: string }[] = [];
    getTableRowData(packsTableData, "effect_bonus_value_ids_unit_sets_tables", (schemaFieldRow) => {
      const bonusValueId = schemaFieldRow.find((sF) => sF.name == "bonus_value_id")?.resolvedKeyValue;
      const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      const unitSet = schemaFieldRow.find((sF) => sF.name == "unit_set")?.resolvedKeyValue;
      if (bonusValueId != undefined && effect != undefined && unitSet != undefined)
        effectBonusValueIdsUnitSets.push({
          bonusValueId,
          effect,
          unitSet,
        });
    });
    const effectToEffectBonusValueIdsUnitSetsData: Record<string, (typeof effectBonusValueIdsUnitSets)[0]> = {};
    for (const effectBonusValueIdsUnitSet of effectBonusValueIdsUnitSets) {
      effectToEffectBonusValueIdsUnitSetsData[effectBonusValueIdsUnitSet.effect] = effectBonusValueIdsUnitSet;
    }
    const subtypeAndSets: {
      key: string;
      agentSubtype: string;
      agentKey: string;
      campaignKey: string;
      factionKey: string;
      subculture: string;
      forArmy: string;
      forNavy: string;
    }[] = [];
    getTableRowData(packsTableData, "character_skill_node_sets_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const agentSubtype = schemaFieldRow.find((sF) => sF.name == "agent_subtype_key")?.resolvedKeyValue;
      const agentKey = schemaFieldRow.find((sF) => sF.name == "agent_key")?.resolvedKeyValue || "";
      const campaignKey = schemaFieldRow.find((sF) => sF.name == "campaign_key")?.resolvedKeyValue || "";
      const factionKey = schemaFieldRow.find((sF) => sF.name == "faction_key")?.resolvedKeyValue || "";
      const subculture = schemaFieldRow.find((sF) => sF.name == "subculture")?.resolvedKeyValue || "";
      const forArmy = schemaFieldRow.find((sF) => sF.name == "for_army")?.resolvedKeyValue || "false";
      const forNavy = schemaFieldRow.find((sF) => sF.name == "for_navy")?.resolvedKeyValue || "false";
      if (key && agentSubtype) {
        const newSubtypeAndSets = {
          key,
          agentSubtype,
          agentKey,
          campaignKey,
          factionKey,
          subculture,
          forArmy,
          forNavy,
        };
        const existingIndex = subtypeAndSets.findIndex((sas) => sas.key == key);
        if (existingIndex > -1) {
          subtypeAndSets.splice(existingIndex, 1, newSubtypeAndSets);
        } else subtypeAndSets.push(newSubtypeAndSets);
      }
    });
    const subtypesToSet: Record<string, string[]> = {};
    for (const { key, agentSubtype } of subtypeAndSets) {
      subtypesToSet[agentSubtype] = subtypesToSet[agentSubtype] || [];
      if (!subtypesToSet[agentSubtype].includes(key)) subtypesToSet[agentSubtype].push(key);
    }
    const setAndNodes: { set: string; node: string; modDisabled: string }[] = [];
    getTableRowData(packsTableData, "character_skill_node_set_items_tables", (schemaFieldRow) => {
      const set = schemaFieldRow.find((sF) => sF.name == "set")?.resolvedKeyValue;
      const node = schemaFieldRow.find((sF) => sF.name == "item")?.resolvedKeyValue;
      const modDisabled = schemaFieldRow.find((sF) => sF.name == "mod_disabled")?.resolvedKeyValue;
      if (set && node && modDisabled != undefined)
        setAndNodes.push({
          set,
          node,
          modDisabled,
        });
    });
    const setToNodes: Record<string, string[]> = {};
    for (const setAndNode of setAndNodes) {
      const set = setAndNode.set;
      if (!setToNodes[set]) setToNodes[set] = [];
      if (!setToNodes[set].includes(setAndNode.node)) setToNodes[set].push(setAndNode.node);
    }
    // set to node table can also be used to disable nodes for a set
    const setToNodesDisables: Record<string, string[]> = {};
    for (const setAndNode of setAndNodes) {
      const set = setAndNode.set;
      if (setAndNode.modDisabled == "0") continue;
      if (!setToNodesDisables[set]) setToNodesDisables[set] = [];
      if (!setToNodesDisables[set].includes(setAndNode.node)) setToNodesDisables[set].push(setAndNode.node);
    }
    // console.log("setToNodesDisables:", setToNodesDisables);
    // console.log("setToNodes KF:", setToNodes["wh_main_skill_node_set_emp_karl_franz"]);
    const nodeLinks: NodeLinks = {};
    getTableRowData(packsTableData, "character_skill_node_links_tables", (schemaFieldRow) => {
      const child_key = schemaFieldRow.find((sF) => sF.name == "child_key")?.resolvedKeyValue;
      const parent_key = schemaFieldRow.find((sF) => sF.name == "parent_key")?.resolvedKeyValue;
      const link_type = schemaFieldRow.find((sF) => sF.name == "link_type")?.resolvedKeyValue;
      const parent_link_position = schemaFieldRow.find((sF) => sF.name == "parent_link_position")?.resolvedKeyValue;
      const child_link_position = schemaFieldRow.find((sF) => sF.name == "child_link_position")?.resolvedKeyValue;
      if (
        child_key != undefined &&
        parent_key != undefined &&
        parent_link_position != undefined &&
        link_type != undefined &&
        (link_type == "REQUIRED" || link_type == "SUBSET_REQUIRED") &&
        child_link_position != undefined
      ) {
        nodeLinks[parent_key] = nodeLinks[parent_key] || [];
        nodeLinks[parent_key].push({
          child: child_key,
          childLinkPosition: child_link_position,
          parentLinkPosition: parent_link_position,
          linkType: link_type,
        });
      }
    });
    const nodeAndSkills: NodeSkill[] = [];
    getTableRowData(packsTableData, "character_skill_nodes_tables", (schemaFieldRow) => {
      const node = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const skill = schemaFieldRow.find((sF) => sF.name == "character_skill_key")?.resolvedKeyValue;
      const tier = schemaFieldRow.find((sF) => sF.name == "tier")?.resolvedKeyValue;
      const indent = schemaFieldRow.find((sF) => sF.name == "indent")?.resolvedKeyValue;
      const factionKey = schemaFieldRow.find((sF) => sF.name == "faction_key")?.resolvedKeyValue;
      const subculture = schemaFieldRow.find((sF) => sF.name == "subculture")?.resolvedKeyValue;
      const requiredNumParents = schemaFieldRow.find((sF) => sF.name == "required_num_parents")?.resolvedKeyValue;
      const visibleInUI = schemaFieldRow.find((sF) => sF.name == "visible_in_ui")?.resolvedKeyValue as "0" | "1";
      if (
        node &&
        skill &&
        tier != undefined &&
        indent != undefined &&
        visibleInUI != undefined &&
        factionKey != undefined &&
        subculture != undefined &&
        requiredNumParents != undefined &&
        (visibleInUI == "0" || visibleInUI == "1")
      ) {
        const newNodeAndSkill = {
          node,
          skill,
          tier,
          indent,
          visibleInUI,
          factionKey,
          subculture,
          requiredNumParents: Number.parseInt(requiredNumParents),
        };
        const existingIndex = nodeAndSkills.findIndex((nas) => nas.node == node);
        if (existingIndex > -1) {
          nodeAndSkills.splice(existingIndex, 1, newNodeAndSkill);
        } else nodeAndSkills.push(newNodeAndSkill);
      }
    });
    const nodeToSkill: Record<string, (typeof nodeAndSkills)[0]> = {};
    for (const nodeAndSkill of nodeAndSkills) {
      nodeToSkill[nodeAndSkill.node] = nodeAndSkill;
    }
    const skills: SkillAndIcons = [];
    getTableRowData(packsTableData, "character_skills_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const iconPath = schemaFieldRow.find((sF) => sF.name == "image_path")?.resolvedKeyValue;
      const unlockRank = schemaFieldRow.find((sF) => sF.name == "unlocked_at_rank")?.resolvedKeyValue;
      if (key != undefined && iconPath != undefined && unlockRank != undefined) {
        const newSkill = {
          key,
          iconPath,
          maxLevel: 1,
          unlockRank: Number(unlockRank),
        };
        const existingIndex = skills.findIndex((skill) => skill.key == key);
        if (existingIndex > -1) {
          skills.splice(existingIndex, 1, newSkill);
        } else skills.push(newSkill);
      }
    });
    const nodeToSkillLocks = {} as NodeToSkillLocks;
    getTableRowData(packsTableData, "character_skill_nodes_skill_locks_tables", (schemaFieldRow) => {
      const skill = schemaFieldRow.find((sF) => sF.name == "character_skill")?.resolvedKeyValue;
      const skillNode = schemaFieldRow.find((sF) => sF.name == "character_skill_node")?.resolvedKeyValue;
      const level = schemaFieldRow.find((sF) => sF.name == "level")?.resolvedKeyValue;
      if (skill != undefined && skillNode != undefined && level != undefined) {
        nodeToSkillLocks[skillNode] = nodeToSkillLocks[skillNode] || [];
        const levelAsNumber = Number(level);
        if (
          !nodeToSkillLocks[skillNode].find(
            (iterSkillLevel) => iterSkillLevel[0] == skill && iterSkillLevel[1] == levelAsNumber,
          )
        ) {
          nodeToSkillLocks[skillNode].push([skill, levelAsNumber]);
        }
      }
    });
    const skillsAndEffects: Effect[] = [];
    getTableRowData(packsTableData, "character_skill_level_to_effects_junctions_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "character_skill_key")?.resolvedKeyValue;
      const effectScope = schemaFieldRow.find((sF) => sF.name == "effect_scope")?.resolvedKeyValue;
      const level = schemaFieldRow.find((sF) => sF.name == "level")?.resolvedKeyValue;
      const value = schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue;
      const effectKey = schemaFieldRow.find((sF) => sF.name == "effect_key")?.resolvedKeyValue;
      if (
        key != undefined &&
        effectScope != undefined &&
        level != undefined &&
        value != undefined &&
        effectKey != undefined
      ) {
        if (!effectsToEffectData[effectKey]) {
          console.error("MISSING ICON FOR EFFECT", effectKey);
        }
        skillsAndEffects.push({
          key,
          effectScope,
          level: Number(level),
          value,
          effectKey,
          iconData: "",
          icon: effectsToEffectData[effectKey]?.icon,
          priority: effectsToEffectData[effectKey]?.priority,
        });
      }
    });
    const skillsToEffects: Record<string, (typeof skillsAndEffects)[0][]> = {};
    for (const skillAndEffect of skillsAndEffects) {
      const key = skillAndEffect.key;
      if (!skillsToEffects[key]) skillsToEffects[key] = [];
      skillsToEffects[key].push(skillAndEffect);
    }
    for (const skill of Object.keys(skillsToEffects)) {
      let maxLevel = 1;
      const effects = skillsToEffects[skill];
      for (let i = 0; i < effects.length; i++) {
        if (effects[i].level > maxLevel) maxLevel = effects[i].level;
      }
      const skillInSkills = skills.find((skillIter) => skillIter.key == skill);
      if (skillInSkills) skillInSkills.maxLevel = maxLevel;
    }
    const parseNumber = (value: string | undefined) => {
      if (value == undefined || value === "") return 0;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const parseBool = (value: string | undefined) => value == "true" || value == "1";
    const effectToUnitAbilityEnables = {} as Record<string, AbilityEnableMapping[]>;
    getTableRowData(packsTableData, "effect_bonus_value_unit_ability_junctions_tables", (schemaFieldRow) => {
      const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      const bonusValueId = schemaFieldRow.find((sF) => sF.name == "bonus_value_id")?.resolvedKeyValue;
      const unitAbilityKey = schemaFieldRow.find((sF) => sF.name == "unit_ability")?.resolvedKeyValue;
      if (!effect || !bonusValueId || !unitAbilityKey) return;
      if (!bonusValueId.startsWith("enable")) return;
      effectToUnitAbilityEnables[effect] = effectToUnitAbilityEnables[effect] || [];
      if (
        !effectToUnitAbilityEnables[effect].some(
          (iterEntry) => iterEntry.unitAbilityKey == unitAbilityKey && iterEntry.bonusValueId == bonusValueId,
        )
      ) {
        effectToUnitAbilityEnables[effect].push({
          unitAbilityKey,
          bonusValueId,
        });
      }
    });
    const unitAbilitiesByKey = {} as Record<
      string,
      { key: string; iconName: string; type: string; sourceType: string; overpowerOption?: string }
    >;
    getTableRowData(packsTableData, "unit_abilities_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const iconName = schemaFieldRow.find((sF) => sF.name == "icon_name")?.resolvedKeyValue;
      const type = schemaFieldRow.find((sF) => sF.name == "type")?.resolvedKeyValue;
      const sourceType = schemaFieldRow.find((sF) => sF.name == "source_type")?.resolvedKeyValue;
      const overpowerOption = schemaFieldRow.find((sF) => sF.name == "overpower_option")?.resolvedKeyValue;
      if (!key || !iconName || !type || !sourceType) return;
      unitAbilitiesByKey[key] = {
        key,
        iconName,
        type,
        sourceType,
        overpowerOption: overpowerOption || undefined,
      };
    });
    const unitSpecialAbilitiesByKey = {} as Record<
      string,
      {
        key: string;
        targetInterceptRange: number;
        rechargeTime: number;
        activeTime: number;
        effectRange: number;
        affectSelf: boolean;
        numEffectedFriendlyUnits: number;
        numEffectedEnemyUnits: number;
        targetFriends: boolean;
        targetEnemies: boolean;
        targetSelf: boolean;
        manaCost: number;
        miscastChance: number;
        minRange: number;
        activatedProjectile?: string;
        bombardment?: string;
        vortex?: string;
      }
    >;
    getTableRowData(packsTableData, "unit_special_abilities_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      if (!key) return;
      unitSpecialAbilitiesByKey[key] = {
        key,
        targetInterceptRange: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "target_intercept_range")?.resolvedKeyValue,
        ),
        rechargeTime: parseNumber(schemaFieldRow.find((sF) => sF.name == "recharge_time")?.resolvedKeyValue),
        activeTime: parseNumber(schemaFieldRow.find((sF) => sF.name == "active_time")?.resolvedKeyValue),
        effectRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "effect_range")?.resolvedKeyValue),
        affectSelf: parseBool(schemaFieldRow.find((sF) => sF.name == "affect_self")?.resolvedKeyValue),
        numEffectedFriendlyUnits: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "num_effected_friendly_units")?.resolvedKeyValue,
        ),
        numEffectedEnemyUnits: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "num_effected_enemy_units")?.resolvedKeyValue,
        ),
        targetFriends: parseBool(schemaFieldRow.find((sF) => sF.name == "target_friends")?.resolvedKeyValue),
        targetEnemies: parseBool(schemaFieldRow.find((sF) => sF.name == "target_enemies")?.resolvedKeyValue),
        targetSelf: parseBool(schemaFieldRow.find((sF) => sF.name == "target_self")?.resolvedKeyValue),
        manaCost: parseNumber(schemaFieldRow.find((sF) => sF.name == "mana_cost")?.resolvedKeyValue),
        miscastChance: parseNumber(schemaFieldRow.find((sF) => sF.name == "miscast_chance")?.resolvedKeyValue),
        minRange: parseNumber(schemaFieldRow.find((sF) => sF.name == "min_range")?.resolvedKeyValue),
        activatedProjectile:
          schemaFieldRow.find((sF) => sF.name == "activated_projectile")?.resolvedKeyValue || undefined,
        bombardment: schemaFieldRow.find((sF) => sF.name == "bombardment")?.resolvedKeyValue || undefined,
        vortex: schemaFieldRow.find((sF) => sF.name == "vortex")?.resolvedKeyValue || undefined,
      };
    });
    const bombardmentsByKey = {} as Record<string, { key: string; numProjectiles: number; projectileType: string }>;
    getTableRowData(packsTableData, "projectile_bombardments_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "bombardment_key")?.resolvedKeyValue;
      const projectileType = schemaFieldRow.find((sF) => sF.name == "projectile_type")?.resolvedKeyValue;
      const numProjectiles = parseNumber(schemaFieldRow.find((sF) => sF.name == "num_projectiles")?.resolvedKeyValue);
      if (!key || !projectileType) return;
      bombardmentsByKey[key] = {
        key,
        projectileType,
        numProjectiles,
      };
    });
    const projectilesByKey = {} as Record<
      string,
      {
        key: string;
        damage: number;
        apDamage: number;
        projectileNumber: number;
        explosionType?: string;
        spawnedVortex?: string;
      }
    >;
    getTableRowData(packsTableData, "projectiles_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      if (!key) return;
      projectilesByKey[key] = {
        key,
        damage: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage")?.resolvedKeyValue),
        apDamage: parseNumber(schemaFieldRow.find((sF) => sF.name == "ap_damage")?.resolvedKeyValue),
        projectileNumber: parseNumber(schemaFieldRow.find((sF) => sF.name == "projectile_number")?.resolvedKeyValue),
        explosionType: schemaFieldRow.find((sF) => sF.name == "explosion_type")?.resolvedKeyValue || undefined,
        spawnedVortex: schemaFieldRow.find((sF) => sF.name == "spawned_vortex")?.resolvedKeyValue || undefined,
      };
    });
    const explosionsByKey = {} as Record<
      string,
      {
        key: string;
        detonationDamage: number;
        detonationDamageAp: number;
        detonationRadius: number;
        detonationDuration: number;
      }
    >;
    getTableRowData(packsTableData, "projectiles_explosions_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      if (!key) return;
      explosionsByKey[key] = {
        key,
        detonationDamage: parseNumber(schemaFieldRow.find((sF) => sF.name == "detonation_damage")?.resolvedKeyValue),
        detonationDamageAp: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "detonation_damage_ap")?.resolvedKeyValue,
        ),
        detonationRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "detonation_radius")?.resolvedKeyValue),
        detonationDuration: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "detonation_duration")?.resolvedKeyValue,
        ),
      };
    });
    const vortexesByKey = {} as Record<
      string,
      {
        key: string;
        damage: number;
        damageAp: number;
        duration: number;
        goalRadius: number;
        startRadius: number;
        movementSpeed: number;
        numVortexes: number;
      }
    >;
    getTableRowData(packsTableData, "battle_vortexs_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "vortex_key")?.resolvedKeyValue;
      if (!key) return;
      vortexesByKey[key] = {
        key,
        damage: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage")?.resolvedKeyValue),
        damageAp: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage_ap")?.resolvedKeyValue),
        duration: parseNumber(schemaFieldRow.find((sF) => sF.name == "duration")?.resolvedKeyValue),
        goalRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "goal_radius")?.resolvedKeyValue),
        startRadius: parseNumber(schemaFieldRow.find((sF) => sF.name == "start_radius")?.resolvedKeyValue),
        movementSpeed: parseNumber(schemaFieldRow.find((sF) => sF.name == "movement_speed")?.resolvedKeyValue),
        numVortexes: parseNumber(schemaFieldRow.find((sF) => sF.name == "num_vortexes")?.resolvedKeyValue),
      };
    });
    const abilityToPhaseIds = {} as Record<string, string[]>;
    getTableRowData(packsTableData, "special_ability_to_special_ability_phase_junctions_tables", (schemaFieldRow) => {
      const abilityKey = schemaFieldRow.find((sF) => sF.name == "special_ability")?.resolvedKeyValue;
      const phaseId = schemaFieldRow.find((sF) => sF.name == "phase")?.resolvedKeyValue;
      if (!abilityKey || !phaseId) return;
      abilityToPhaseIds[abilityKey] = abilityToPhaseIds[abilityKey] || [];
      if (!abilityToPhaseIds[abilityKey].includes(phaseId)) abilityToPhaseIds[abilityKey].push(phaseId);
    });
    const phasesById = {} as Record<
      string,
      {
        id: string;
        damageAmount: number;
        maxDamagedEntities: number;
        hpChangeFrequency: number;
        duration: number;
        fatigueChangeRatio: number;
        affectsAllies: boolean;
        affectsEnemies: boolean;
      }
    >;
    getTableRowData(packsTableData, "special_ability_phases_tables", (schemaFieldRow) => {
      const id = schemaFieldRow.find((sF) => sF.name == "id")?.resolvedKeyValue;
      if (!id) return;
      phasesById[id] = {
        id,
        damageAmount: parseNumber(schemaFieldRow.find((sF) => sF.name == "damage_amount")?.resolvedKeyValue),
        maxDamagedEntities: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "max_damaged_entities")?.resolvedKeyValue,
        ),
        hpChangeFrequency: parseNumber(schemaFieldRow.find((sF) => sF.name == "hp_change_frequency")?.resolvedKeyValue),
        duration: parseNumber(schemaFieldRow.find((sF) => sF.name == "duration")?.resolvedKeyValue),
        fatigueChangeRatio: parseNumber(
          schemaFieldRow.find((sF) => sF.name == "fatigue_change_ratio")?.resolvedKeyValue,
        ),
        affectsAllies: parseBool(schemaFieldRow.find((sF) => sF.name == "affects_allies")?.resolvedKeyValue),
        affectsEnemies: parseBool(schemaFieldRow.find((sF) => sF.name == "affects_enemies")?.resolvedKeyValue),
      };
    });
    const phaseStatEffectsByPhaseId = {} as Record<string, { stat: string; value: number; how: string }[]>;
    getTableRowData(packsTableData, "special_ability_phase_stat_effects_tables", (schemaFieldRow) => {
      const phase = schemaFieldRow.find((sF) => sF.name == "phase")?.resolvedKeyValue;
      const stat = schemaFieldRow.find((sF) => sF.name == "stat")?.resolvedKeyValue;
      const value = parseNumber(schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue);
      const how = schemaFieldRow.find((sF) => sF.name == "how")?.resolvedKeyValue;
      if (!phase || !stat || !how) return;
      phaseStatEffectsByPhaseId[phase] = phaseStatEffectsByPhaseId[phase] || [];
      const existing = phaseStatEffectsByPhaseId[phase].find(
        (iterEffect) => iterEffect.stat == stat && iterEffect.how == how,
      );
      if (existing) {
        existing.value = value;
      } else {
        phaseStatEffectsByPhaseId[phase].push({ stat, value, how });
      }
    });
    const uiUnitStatIconsByStat = {} as Record<string, string>;
    getTableRowData(packsTableData, "ui_unit_stats_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const icon = schemaFieldRow.find((sF) => sF.name == "icon")?.resolvedKeyValue;
      if (!key || !icon) return;
      uiUnitStatIconsByStat[key] = icon;
    });
    let kvDirectDamageMinUnary = 0.5;
    let kvDirectDamageLarge = 0.75;
    getTableRowData(packsTableData, "_kv_unit_ability_scaling_rules_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const value = parseNumber(schemaFieldRow.find((sF) => sF.name == "value")?.resolvedKeyValue);
      if (key == "direct_damage_damage_scale_min_unary") kvDirectDamageMinUnary = value;
      if (key == "direct_damage_large") kvDirectDamageLarge = value;
    });
    const abilityToAdditionalUiEffectKeys = {} as Record<string, string[]>;
    getTableRowData(packsTableData, "unit_abilities_to_additional_ui_effects_juncs_tables", (schemaFieldRow) => {
      const ability = schemaFieldRow.find((sF) => sF.name == "ability")?.resolvedKeyValue;
      const effect = schemaFieldRow.find((sF) => sF.name == "effect")?.resolvedKeyValue;
      if (!ability || !effect) return;
      abilityToAdditionalUiEffectKeys[ability] = abilityToAdditionalUiEffectKeys[ability] || [];
      if (!abilityToAdditionalUiEffectKeys[ability].includes(effect)) {
        abilityToAdditionalUiEffectKeys[ability].push(effect);
      }
    });
    const additionalUiEffectsByKey = {} as Record<string, { key: string; sortOrder: number; effectState: string }>;
    getTableRowData(packsTableData, "unit_abilities_additional_ui_effects_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "key")?.resolvedKeyValue;
      const sortOrder = parseNumber(schemaFieldRow.find((sF) => sF.name == "sort_order")?.resolvedKeyValue);
      const effectState = schemaFieldRow.find((sF) => sF.name == "effect_state")?.resolvedKeyValue?.toString() || "";
      if (!key) return;
      additionalUiEffectsByKey[key] = { key, sortOrder, effectState };
    });
    const abilityToAutoDeactivateFlags = {} as Record<string, string[]>;
    getTableRowData(packsTableData, "special_ability_to_auto_deactivate_flags_tables", (schemaFieldRow) => {
      const ability = schemaFieldRow.find((sF) => sF.name == "special_ability")?.resolvedKeyValue;
      const deactivateFlag = schemaFieldRow.find((sF) => sF.name == "deactivate_flag")?.resolvedKeyValue;
      if (!ability || !deactivateFlag) return;
      abilityToAutoDeactivateFlags[ability] = abilityToAutoDeactivateFlags[ability] || [];
      if (!abilityToAutoDeactivateFlags[ability].includes(deactivateFlag)) {
        abilityToAutoDeactivateFlags[ability].push(deactivateFlag);
      }
    });
    const abilityToGroupKeys = {} as Record<string, string[]>;
    getTableRowData(packsTableData, "special_ability_groups_to_unit_abilities_junctions_tables", (schemaFieldRow) => {
      const group = schemaFieldRow.find((sF) => sF.name == "special_ability_groups")?.resolvedKeyValue;
      const ability = schemaFieldRow.find((sF) => sF.name == "unit_special_abilities")?.resolvedKeyValue;
      if (!ability || !group) return;
      abilityToGroupKeys[ability] = abilityToGroupKeys[ability] || [];
      if (!abilityToGroupKeys[ability].includes(group)) abilityToGroupKeys[ability].push(group);
    });
    const specialAbilityGroupsByKey = {} as Record<string, { key: string; iconPath: string }>;
    getTableRowData(packsTableData, "special_ability_groups_tables", (schemaFieldRow) => {
      const key = schemaFieldRow.find((sF) => sF.name == "ability_group")?.resolvedKeyValue;
      const iconPath = schemaFieldRow.find((sF) => sF.name == "icon_path")?.resolvedKeyValue;
      if (!key || !iconPath) return;
      specialAbilityGroupsByKey[key] = {
        key,
        iconPath,
      };
    });
    // const set = subtypeToSet["wh_main_emp_karl_franz"];
    // const nodes = setToNodes[set];
    // for (const node of nodes) {
    //   const nodeAndSkill = nodeToSkill[node];
    //   const skill = nodeAndSkill.skill;
    //   console.log("skill", skill);
    //   const effects = skillsToEffects[skill];
    //   for (const effect of effects) {
    //     console.log("effect", effect);
    //   }
    // }
    const skillIconPaths = getSkillAndEffectIconPaths(skills, skillsToEffects, effectsToEffectData);
    // const readList1 = appData.packsData.filter((packsData) =>
    //   mods.map((mod) => mod.name).includes(packsData.name)
    // );
    // const readList2 = appData.packsData.filter((packsData) => vanillaPacksToRead.includes(packsData.path));
    // console.log(
    //   "readList1:",
    //   readList1.map((mod) => mod.name)
    // );
    // console.log(
    //   "readList2:",
    //   readList2.map((mod) => mod.name)
    // );
    const enabledModPacks = appData.packsData.filter((packsData) =>
      mods.map((mod) => mod.name).includes(packsData.name),
    );
    // for (const pack of enabledModPacks)
    //   await readFromExistingPack(pack, { filesToRead: skillIconPaths, skipParsingTables: true });
    // The packs the tables came from hold hardly any of the icons, so this is a second, separate set:
    // the vanilla packs the file index says carry one, indexed and nothing more.
    const vanillaIconPacks = await getIconPacks(
      (await findVanillaPacksHoldingIcons(skillIconPaths)) ?? vanillaPacksToRead,
    );
    console.log(
      "getSkillsData: vanilla packs holding skill icons:",
      vanillaIconPacks.map((pack) => pack.name),
    );
    const icons = await loadIconsFromPacks(vanillaIconPacks.concat(enabledModPacks), skillIconPaths);
    // Vanilla first, then mods, matching the cached path above. These packs were read for their
    // tables regardless, so the saving here is the tries, which used to be retained for the session.
    const locs = {
      ...(await getVanillaLocLookup(getVanillaLocalisationPackPaths(dataFolder))),
      ...getLocsFromPacks(
        appData.packsData.filter((packsData) => mods.some((mod) => mod.name === packsData.name)),
        getLocsTrie,
      ),
    };
    // fs.writeFileSync("dumps/iconPaths.json", JSON.stringify(skillIconPaths));
    // To dump locs, flatten them here rather than on every build: doing it unconditionally cost a
    // ~180k entry object per pack to feed a writeFileSync that has always been commented out.
    // fs.writeFileSync("dumps/packsTableData.json", JSON.stringify(packsTableData));
    // fs.writeFileSync("dumps/subtypeAndSets.json", JSON.stringify(subtypeAndSets));
    // fs.writeFileSync("dumps/setAndNodes.json", JSON.stringify(setAndNodes));
    // fs.writeFileSync("dumps/nodeAndSkills.json", JSON.stringify(nodeAndSkills));
    // fs.writeFileSync("dumps/skills.json", JSON.stringify(skills));
    // fs.writeFileSync("dumps/skillsAndEffects.json", JSON.stringify(skillsAndEffects));
    // fs.writeFileSync("dumps/subtypeAndSets.json", JSON.stringify(subtypeAndSets));
    // fs.writeFileSync("dumps/subtypeToSet.json", JSON.stringify(subtypesToSet));
    // fs.writeFileSync("dumps/setToNodes.json", JSON.stringify(setToNodes));
    // fs.writeFileSync("dumps/nodeToSkill.json", JSON.stringify(nodeToSkill));
    // fs.writeFileSync("dumps/skillsToEffects.json", JSON.stringify(skillsToEffects));
    // fs.writeFileSync("dumps/nodeLinks.json", JSON.stringify(nodeLinks));
    // fs.writeFileSync("dumps/effectsToEffectData.json", JSON.stringify(effectsToEffectData));
    // fs.writeFileSync(
    //   "dumps/effectToEffectBonusValueIdsUnitSetsData.json",
    //   JSON.stringify(effectToEffectBonusValueIdsUnitSetsData)
    // );
    for (const [set, setToNodesToDisable] of Object.entries(setToNodesDisables)) {
      const nodes = setToNodes[set];
      const lenBefore = nodes.length;
      setToNodes[set] = setToNodes[set].filter((node) => !setToNodesToDisable.includes(node));
      const lenAfter = setToNodes[set].length;
      if (lenBefore != lenAfter) {
        console.log("from set", set, "removed", lenBefore - lenAfter, "elements");
      }
    }
    const setKF = subtypesToSet["wh_main_emp_karl_franz"][0];
    const skillsDataPackPaths = vanillaIconPacks.concat(enabledModPacks).map((pack) => pack.path);
    appData.skillsData = {
      subtypesToSet,
      subtypeAndSets,
      setToNodes,
      nodeLinks,
      nodeToSkill,
      skillsToEffects,
      nodeToSkillLocks,
      skills,
      locs,
      icons,
      iconGeneration: registerIconAssets(icons),
      effectsToEffectData,
      skillsDataPackPaths,
      effectToUnitAbilityEnables,
      unitAbilitiesByKey,
      unitSpecialAbilitiesByKey,
      bombardmentsByKey,
      projectilesByKey,
      explosionsByKey,
      vortexesByKey,
      abilityToPhaseIds,
      phasesById,
      phaseStatEffectsByPhaseId,
      uiUnitStatIconsByStat,
      kvDirectDamageMinUnary,
      kvDirectDamageLarge,
      abilityToAdditionalUiEffectKeys,
      additionalUiEffectsByKey,
      abilityToAutoDeactivateFlags,
      abilityToGroupKeys,
      specialAbilityGroupsByKey,
    };
    if (!cachedVanillaSkillsCore) {
      if (mods.length === 0) {
        void saveVanillaSkillsDataCoreCache({
          dataFolder,
          currentGame: appData.currentGame,
          userDataPath: app.getPath("userData"),
          skillsData: appData.skillsData,
        });
      } else if (vanillaPacksTableData.length > 0) {
        // Seed the vanilla cache from the vanilla packs only, even on a modded cold start.
        const vanillaCoreForCache = createEmptySkillsDataCore();
        applyModOverlayToSkillsDataCore(vanillaCoreForCache, vanillaPacksTableData, getTableRowData);
        void saveVanillaSkillsDataCoreCache({
          dataFolder,
          currentGame: appData.currentGame,
          userDataPath: app.getPath("userData"),
          skillsData: {
            ...vanillaCoreForCache,
            locs: {},
            icons: {},
            iconGeneration: 0,
            skillsDataPackPaths: [],
          },
        });
      }
    }
    // Both the live data and the vanilla core cache have been built off these rows by now, and what
    // follows works entirely off the structures above. This is the cold path, so the rows dropped
    // here are every skills table in the vanilla packs as well as the mods'. The icon packs are a
    // different set and were never parsed, so they are not in this list.
    releaseParsedTables(vanillaSkillsPacks.concat(enabledModPacks), tablesToRead);
    const nodesKF = setToNodes[setKF];
    // fs.writeFileSync("dumps/nodeToSkill.json", JSON.stringify(nodeToSkill));
    // fs.writeFileSync("dumps/setToNodes.json", JSON.stringify(setToNodes));
    // fs.writeFileSync("dumps/nodeLinks.json", JSON.stringify(nodeLinks));
    // fs.writeFileSync("dumps/nodesKF.json", JSON.stringify(nodesKF));
    const nodesToParents = getNodesToParents(nodesKF, nodeLinks, nodeToSkill, skillsToEffects);
    // fs.writeFileSync("dumps/nodesToParents.json", JSON.stringify(nodesToParents));
    const kfSkills = getSkills(nodesKF, nodeLinks, nodeToSkill, nodesToParents, skillsToEffects, skills);
    // const nodeToSkillsKF = nodesKF.reduce((acc, current) => {
    //   acc[current] = nodeToSkill[current];
    //   return acc;
    // }, {} as Record<string, (typeof nodeAndSkills)[0]>);
    // fs.writeFileSync("dumps/kfSkills.json", JSON.stringify(kfSkills));
    // fs.writeFileSync("dumps/nodeToSkillsKF.json", JSON.stringify(nodeToSkillsKF));
    const getLoc = (locId: string) => {
      for (const locsInPack of Object.values(locs)) {
        const localized = locsInPack.get(locId);
        if (localized) return localized;
      }
    };
    appendLocalizationsToSkills(kfSkills, getLoc);
    const effectKeysForCurrentSkills = Array.from(
      new Set(kfSkills.flatMap((skill) => skill.effects.map((effect) => effect.effectKey))),
    );
    const {
      abilityTooltipsByKey: kfAbilityTooltipsByKey,
      reducedEffectToUnitAbilityEnables: kfEffectToUnitAbilityEnables,
      iconPathsToLoad: kfAbilityIconPaths,
    } = buildAbilityTooltipDataForEffects({
      effectKeys: effectKeysForCurrentSkills,
      effectToUnitAbilityEnables,
      unitAbilitiesByKey,
      unitSpecialAbilitiesByKey,
      bombardmentsByKey,
      projectilesByKey,
      explosionsByKey,
      vortexesByKey,
      abilityToPhaseIds,
      phasesById,
      phaseStatEffectsByPhaseId,
      uiUnitStatIconsByStat,
      kvDirectDamageMinUnary,
      kvDirectDamageLarge,
      abilityToAdditionalUiEffectKeys,
      additionalUiEffectsByKey,
      abilityToAutoDeactivateFlags,
      abilityToGroupKeys,
      specialAbilityGroupsByKey,
      getLoc,
    });
    // Same as on the subtype switch below: the tooltip icons are not part of the sweep the vanilla
    // icon packs were chosen for, so whichever are still missing get their own packs looked up.
    const missingAbilityIconPaths = kfAbilityIconPaths.filter((iconPath) => !icons[iconPath]);
    const abilityIconPacks =
      missingAbilityIconPaths.length > 0
        ? await getIconPacks((await findVanillaPacksHoldingIcons(missingAbilityIconPaths)) ?? [])
        : [];
    const addedIconGeneration = await loadMissingIconsInto(
      icons,
      vanillaIconPacks
        .concat(abilityIconPacks.filter((pack) => !vanillaIconPacks.includes(pack)))
        .concat(enabledModPacks),
      kfAbilityIconPaths,
    );
    if (addedIconGeneration) appData.skillsData.iconGeneration = addedIconGeneration;
    const subtypes = Object.keys(subtypesToSet);
    const subtypeToNumSets = subtypes.reduce(
      (acc, curr) => {
        acc[curr] = subtypesToSet[curr].length;
        return acc;
      },
      {} as Record<string, number>,
    );
    const nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);
    appData.queuedSkillsData = {
      // subtypeToSkills: { wh_main_emp_karl_franz: kfSkills },
      currentSubtype: "wh_main_emp_karl_franz",
      currentSubtypeIndex: 0,
      subtypeToNumSets,
      subtypesToSet,
      subtypeAndSets,
      currentSkills: kfSkills,
      nodeLinks,
      nodeRequirements,
      icons: pickIconsForSkills(icons, appData.skillsData.iconGeneration, kfSkills, kfAbilityIconPaths),
      subtypes,
      nodeToSkillLocks,
      abilityTooltipsByKey: kfAbilityTooltipsByKey,
      effectToUnitAbilityEnables: kfEffectToUnitAbilityEnables,
      subtypesToLocalizedNames: subtypes.reduce(
        (acc, curr) => {
          const localized = getLoc(`agent_subtypes_onscreen_name_override_${curr}`);
          if (localized) acc[curr] = localized;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
    appData.lastSkillsDataSignature = skillsDataSignature;
    if (appData.queuedSkillsData) {
      pushSkillsDataToMainWindow();
      if (windows.skillsWindow) {
        sendQueuedDataToSkills();
      }
    }
  };
  const getSkillsForSubtype = async (subtype: string, subtypeIndex: number) => {
    console.log("getSkillsForSubtype:", subtype);
    const cachedSkillsData = appData.skillsData;
    if (!cachedSkillsData) {
      getSkillsData(appData.enabledMods);
      return;
    }
    appData.lastSkillsSelection = {
      currentSubtype: subtype,
      currentSubtypeIndex: subtypeIndex,
    };
    const setKF = cachedSkillsData.subtypesToSet[subtype];
    console.log("sets for subtype:", setKF);
    const nodesKF = cachedSkillsData.setToNodes[setKF[subtypeIndex]];
    const { nodeLinks, nodeToSkill, skillsToEffects, skills, locs, icons, subtypesToSet, nodeToSkillLocks } =
      cachedSkillsData;
    const nodesToParents = getNodesToParents(nodesKF, nodeLinks, nodeToSkill, skillsToEffects);
    const kfSkills = getSkills(nodesKF, nodeLinks, nodeToSkill, nodesToParents, skillsToEffects, skills);
    const getLoc = (locId: string) => {
      for (const locsInPack of Object.values(locs)) {
        const localized = locsInPack.get(locId);
        if (localized) return localized;
      }
    };
    appendLocalizationsToSkills(kfSkills, getLoc);
    const effectKeysForCurrentSkills = Array.from(
      new Set(kfSkills.flatMap((skill) => skill.effects.map((effect) => effect.effectKey))),
    );
    const {
      abilityTooltipsByKey,
      reducedEffectToUnitAbilityEnables,
      iconPathsToLoad: tooltipIconPaths,
    } = buildAbilityTooltipDataForEffects({
      effectKeys: effectKeysForCurrentSkills,
      effectToUnitAbilityEnables: cachedSkillsData.effectToUnitAbilityEnables,
      unitAbilitiesByKey: cachedSkillsData.unitAbilitiesByKey,
      unitSpecialAbilitiesByKey: cachedSkillsData.unitSpecialAbilitiesByKey,
      bombardmentsByKey: cachedSkillsData.bombardmentsByKey,
      projectilesByKey: cachedSkillsData.projectilesByKey,
      explosionsByKey: cachedSkillsData.explosionsByKey,
      vortexesByKey: cachedSkillsData.vortexesByKey,
      abilityToPhaseIds: cachedSkillsData.abilityToPhaseIds,
      phasesById: cachedSkillsData.phasesById,
      phaseStatEffectsByPhaseId: cachedSkillsData.phaseStatEffectsByPhaseId,
      uiUnitStatIconsByStat: cachedSkillsData.uiUnitStatIconsByStat,
      kvDirectDamageMinUnary: cachedSkillsData.kvDirectDamageMinUnary,
      kvDirectDamageLarge: cachedSkillsData.kvDirectDamageLarge,
      abilityToAdditionalUiEffectKeys: cachedSkillsData.abilityToAdditionalUiEffectKeys,
      additionalUiEffectsByKey: cachedSkillsData.additionalUiEffectsByKey,
      abilityToAutoDeactivateFlags: cachedSkillsData.abilityToAutoDeactivateFlags,
      abilityToGroupKeys: cachedSkillsData.abilityToGroupKeys,
      specialAbilityGroupsByKey: cachedSkillsData.specialAbilityGroupsByKey,
      getLoc,
    });
    // The tree's own icons were resolved when the data was built, so the build only had to index the
    // vanilla packs holding those. A tooltip's icons are not known until a subtype is opened and can
    // sit in a pack that set never included, so the ones still missing are looked up here rather than
    // being lost to the narrower read.
    const missingTooltipIconPaths = tooltipIconPaths.filter((iconPath) => !cachedSkillsData.icons[iconPath]);
    const tooltipIconPackPaths =
      missingTooltipIconPaths.length > 0 ? ((await findVanillaPacksHoldingIcons(missingTooltipIconPaths)) ?? []) : [];
    const iconPackPaths = [
      ...cachedSkillsData.skillsDataPackPaths,
      ...tooltipIconPackPaths.filter((packPath) => !cachedSkillsData.skillsDataPackPaths.includes(packPath)),
    ];
    const addedIconGeneration = await loadMissingIconsInto(
      cachedSkillsData.icons,
      await getIconPacks(iconPackPaths),
      tooltipIconPaths,
    );
    if (addedIconGeneration) cachedSkillsData.iconGeneration = addedIconGeneration;
    const subtypes = Object.keys(subtypesToSet);
    const subtypeToNumSets = subtypes.reduce(
      (acc, curr) => {
        acc[curr] = subtypesToSet[curr].length;
        return acc;
      },
      {} as Record<string, number>,
    );
    const nodeRequirements = getNodeRequirements(nodeLinks, nodeToSkill);
    appData.queuedSkillsData = {
      // subtypeToSkills: { [subtype]: kfSkills },
      currentSubtype: subtype,
      currentSubtypeIndex: subtypeIndex,
      currentSkills: kfSkills,
      subtypeToNumSets,
      subtypesToSet,
      subtypeAndSets: cachedSkillsData.subtypeAndSets,
      nodeLinks,
      nodeRequirements,
      nodeToSkillLocks,
      icons: pickIconsForSkills(icons, cachedSkillsData.iconGeneration, kfSkills, tooltipIconPaths),
      abilityTooltipsByKey,
      effectToUnitAbilityEnables: reducedEffectToUnitAbilityEnables,
      subtypes,
      subtypesToLocalizedNames: subtypes.reduce(
        (acc, curr) => {
          const localized = getLoc(`agent_subtypes_onscreen_name_override_${curr}`);
          if (localized) acc[curr] = localized;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
    if (appData.queuedSkillsData) {
      if (appData.skillTreesDisplayMode === "tab") {
        pushSkillsDataToMainWindow();
      }
      if (windows.skillsWindow) {
        sendQueuedDataToSkills();
      }
    }
  };
  /**
   * Everything the skill tree editor's pickers offer: every skill, every character effect, and the
   * whole icon record.
   *
   * Asked for when the editor opens rather than sent with the tree. It is several megabytes - the
   * icons alone are around 1,600 base64 encoded images, and every skill carries its localised
   * description - against a few dozen icons for the tree itself, and it was being rebuilt and sent on
   * every subtype switch for a modders-only feature most sessions never open.
   */
  ipcMain.handle("getSkillsEditorData", async (): Promise<SkillsEditorData | undefined> => {
    const cachedSkillsData = appData.skillsData;
    if (!cachedSkillsData) return undefined;
    const getLoc = (locId: string) => {
      for (const locsInPack of Object.values(cachedSkillsData.locs)) {
        const localized = locsInPack.get(locId);
        if (localized) return localized;
      }
    };
    const characterEffectKeys = new Set<string>();
    for (const effects of Object.values(cachedSkillsData.skillsToEffects)) {
      for (const effect of effects) {
        if (effect.effectScope.startsWith("character_")) {
          characterEffectKeys.add(effect.effectKey);
        }
      }
    }
    const allEffects = Object.values(cachedSkillsData.effectsToEffectData)
      .filter((ed) => characterEffectKeys.has(ed.key))
      .map((ed) => ({
        effectKey: ed.key,
        localizedKey: getRawEffectLocalization(ed.key, getLoc),
        icon: ed.icon,
        priority: ed.priority,
      }));
    const allSkills = cachedSkillsData.skills.map((skill) => ({
      key: skill.key,
      localizedName: getLoc(`character_skills_localised_name_${skill.key}`) || skill.key,
      localizedDescription: getLoc(`character_skills_localised_description_${skill.key}`) || "",
      iconPath: skill.iconPath,
      maxLevel: skill.maxLevel,
      unlockRank: skill.unlockRank,
      effects: (cachedSkillsData.skillsToEffects[skill.key] || []).map((e) => ({
        effectKey: e.effectKey,
        effectScope: e.effectScope,
        level: e.level,
        value: e.value,
        icon: e.icon,
        priority: e.priority,
      })),
    }));
    const allSkillIcons = Object.keys(cachedSkillsData.icons)
      .filter((iconPath) => iconPath.startsWith("ui\\campaign ui\\skills\\"))
      .sort()
      .map((iconPath) => ({
        path: iconPath,
        name: iconPath.replace("ui\\campaign ui\\skills\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
      }));
    const icons = Object.fromEntries(
      Object.keys(cachedSkillsData.icons).map((iconPath) => [
        iconPath,
        iconAssetUrl(cachedSkillsData.iconGeneration, iconPath),
      ]),
    );
    return { allEffects, allSkills, allSkillIcons, icons };
  });
  const getTableRowData = (
    packsTableData: PackViewData[],
    tableName: string,
    rowDataExtractor: (schemaFieldRow: AmendedSchemaField[], packViewData: PackViewData) => void,
  ) => {
    packsTableData.forEach((pTD) => {
      const skillNodeSetsFiles = Object.keys(pTD.packedFiles).filter((pFName) =>
        pFName.startsWith(`db\\${tableName}\\`),
      );
      for (const skillNodeSetFile of skillNodeSetsFiles) {
        const packedFile = pTD.packedFiles[skillNodeSetFile];
        const dbVersion = getDBVersion(packedFile);
        if (dbVersion === undefined) continue;
        const schemaFields = packedFile.schemaFields as AmendedSchemaField[];
        const chunkedShemaFields = chunkSchemaIntoRows(schemaFields, dbVersion) as AmendedSchemaField[][];
        for (const schemaFieldRow of chunkedShemaFields) {
          rowDataExtractor(schemaFieldRow, pTD);
        }
      }
    });
  };
  type CachedTechnologyData = {
    setsByKey: Record<string, TechnologyNodeSetSummary>;
    setRowsByKey: Record<string, Record<string, string>>;
    nodesByKey: Record<
      string,
      {
        nodeKey: string;
        technologyKey: string;
        setKey: string;
        tier: number;
        indent: number;
        requiredParents: number;
        campaignKey?: string;
        factionKey?: string;
        pixelOffsetX: number;
        pixelOffsetY: number;
        researchPointsRequired: number;
        optionalUiGroup?: string;
      }
    >;
    linksByKey: Record<string, TechnologyLinkData>;
    uiTabsByKey: Record<string, TechnologyUiTabData>;
    uiTabToNodes: Record<string, string[]>;
    uiGroupsByKey: Record<string, TechnologyUiGroupData>;
    uiGroupBounds: TechnologyUiGroupBoundsData[];
    technologiesByKey: Record<
      string,
      {
        key: string;
        iconName?: string;
        isHidden: boolean;
        buildingLevel?: string;
      }
    >;
    nodeRowsByKey: Record<string, Record<string, string>>;
    linkRowsByKey: Record<string, Record<string, string>>;
    technologyRowsByKey: Record<string, Record<string, string>>;
    technologyEffectRowsByKey: Record<string, Record<string, Record<string, string>>>;
    technologyEffectScopesByKey: Record<string, string>;
    locs: Record<string, KeyedLookup<string>>;
    icons: Record<string, AssetBytes>;
    iconGeneration: number;
    technologyToEffects: Record<string, { effectKey: string; value?: string }[]>;
    effectsForTech: Record<string, { icon?: string }>;
  };
  let cachedTechnologyData: CachedTechnologyData | undefined;
  let cachedTechnologyDataKey: string | undefined;
  const getSchemaFieldValue = (schemaFieldRow: AmendedSchemaField[], fieldName: string) =>
    schemaFieldRow.find((sF) => sF.name == fieldName)?.resolvedKeyValue;
  const parseOptionalString = (value: unknown) => {
    if (value == null) return undefined;
    const asString = `${value}`.trim();
    return asString === "" ? undefined : asString;
  };
  const parseOptionalNumber = (value: unknown, fallback = 0) => {
    if (value == null || `${value}`.trim() === "") return fallback;
    const parsed = Number.parseInt(`${value}`, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseOptionalFloat = (value: unknown, fallback = 0) => {
    if (value == null || `${value}`.trim() === "") return fallback;
    const parsed = Number.parseFloat(`${value}`);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseOptionalBool = (value: unknown, fallback = false) => {
    if (value == null) return fallback;
    const asString = `${value}`.trim().toLowerCase();
    if (asString === "true" || asString === "1") return true;
    if (asString === "false" || asString === "0") return false;
    return fallback;
  };
  const schemaRowToRecord = (schemaFieldRow: AmendedSchemaField[]) => {
    const rowRecord: Record<string, string> = {};
    for (const schemaField of schemaFieldRow) {
      const value = schemaField.resolvedKeyValue;
      if (value === undefined || value === null) {
        rowRecord[schemaField.name] = "";
        continue;
      }
      if (typeof value === "boolean") {
        rowRecord[schemaField.name] = value ? "true" : "false";
        continue;
      }
      rowRecord[schemaField.name] = `${value}`;
    }
    return rowRecord;
  };
  const getUnitViewerSignature = (mods: Mod[]) => buildSkillsDataSignature(mods, appData.currentGame);
  /**
   * One Unit Viewer build at a time. The build fills vanilla rows into the shared packs and releases
   * them at the end, so a second build running beside it would have those rows dropped mid-flight.
   */
  const unitViewerBuilds = createSerializedBuilds();

  const getUnitViewerAssetCandidates = (normalizedPath: string) => {
    const withoutExtension = normalizedPath.replace(/\.(png|webp|jpe?g)$/i, "");
    return Array.from(
      new Set([normalizedPath, `${withoutExtension}.png`, `${withoutExtension}.webp`, `${withoutExtension}.jpg`]),
    );
  };

  const cacheUnitViewerAsset = (
    session: UnitViewerSession,
    normalizedPath: string,
    entry: { buffer: Buffer; mimeType: string; bytes: number; resolvedPath: string },
  ) => {
    while (session.assetCacheBytes + entry.bytes > UNIT_VIEWER_ASSET_CACHE_MAX_BYTES && session.assetCache.size > 0) {
      const oldestKey = session.assetCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = session.assetCache.get(oldestKey);
      session.assetCache.delete(oldestKey);
      session.assetCacheBytes -= oldest?.bytes || 0;
    }
    session.assetCache.set(normalizedPath, entry);
    session.assetCacheBytes += entry.bytes;
  };

  const takeCachedUnitViewerAsset = (session: UnitViewerSession, normalizedPath: string) => {
    const cached = session.assetCache.get(normalizedPath);
    if (!cached) return undefined;
    session.assetCache.delete(normalizedPath);
    session.assetCache.set(normalizedPath, cached);
    return cached;
  };

  /**
   * The packs worth opening for a set of asset paths, highest priority first.
   *
   * A session's pack list is every vanilla pack the game ships bar the audio and terrain ones -
   * around 200 of them - and the walk below used to open each one's index in turn until the file
   * turned up, worst of all for a path nothing carries, which paid for all 200. The mods stay in the
   * walk: there are a handful and they outrank vanilla anyway. Vanilla is asked of the global file
   * index instead, which names the pack that wins a path without opening anything, and answers for
   * every vanilla pack there is - so a path it does not know is one no vanilla pack holds.
   *
   * Falls back to the whole list wherever the index cannot answer for certain: no index at all, or a
   * winning pack this session's filter excludes, where whether some lower-priority pack it does hold
   * carries the file too is exactly what the index cannot say.
   */
  const narrowUnitViewerAssetPackPaths = async (session: UnitViewerSession, normalizedPaths: readonly string[]) => {
    const packPathsByPriority = session.assetPackPaths.toReversed();
    const vanillaIndex = await getVanillaPackIndex();
    if (!vanillaIndex) return packPathsByPriority;
    return selectPackPathsToSearch(
      vanillaIndex,
      // Every spelling the walk itself would try, so a pack is kept if it wins any of them.
      normalizedPaths.flatMap((normalizedPath) => getUnitViewerAssetCandidates(normalizedPath)),
      packPathsByPriority,
      // The session's paths were built by joining these very names onto the data folder, so this
      // tells its vanilla packs from its mods exactly the way the list was assembled.
      new Set([...appData.allVanillaPackNames].map((packName) => packName.toLowerCase())),
    );
  };

  const getUnitViewerAsset = async (session: UnitViewerSession, requestedPath: string) => {
    const normalized = normalizePackFilePath(requestedPath).toLowerCase();
    const cached = takeCachedUnitViewerAsset(session, normalized);
    if (cached) return cached;
    const candidates = getUnitViewerAssetCandidates(normalized);
    for (const packPath of await narrowUnitViewerAssetPackPaths(session, [normalized])) {
      const pack = await getOrLoadPackFromAppData(packPath);
      if (!pack) continue;
      const indexedFile = candidates
        .map((candidate) => findPackedFileCaseInsensitive(pack, candidate))
        .find((candidate): candidate is PackedFile => !!candidate);
      if (!indexedFile) continue;
      await readFromExistingPack(pack, { filesToRead: [indexedFile.name], skipParsingTables: true });
      const loadedFile = findPackedFileCaseInsensitive(pack, indexedFile.name);
      if (!loadedFile?.buffer) continue;
      const entry = {
        buffer: loadedFile.buffer,
        mimeType: getPackedFileMimeType(loadedFile.name) || "image/png",
        bytes: loadedFile.buffer.length,
        resolvedPath: loadedFile.name,
      };
      cacheUnitViewerAsset(session, normalized, entry);
      return entry;
    }
    return undefined;
  };

  /**
   * Resolves many assets with at most one read per pack instead of one per asset: each pack is
   * asked for every asset still outstanding, and all of its hits are read in a single call.
   *
   * `withPayload: false` warms the session cache and reports only which paths resolved, which is
   * what every caller but the cache build wants: the images themselves are served over the asset
   * protocol out of that same cache, so nothing has to carry them.
   */
  const loadUnitViewerAssets = async (session: UnitViewerSession, requestedPaths: string[], withPayload: boolean) => {
    const assets: Record<string, AssetBytes> = {};
    const resolved: string[] = [];
    const outstanding = new Map<string, string[]>();
    const resolveFor = (requestedPath: string, entry: AssetBytes) => {
      resolved.push(requestedPath);
      if (withPayload) assets[requestedPath] = { buffer: entry.buffer, mimeType: entry.mimeType };
    };
    for (const requestedPath of requestedPaths) {
      const normalized = normalizePackFilePath(requestedPath).toLowerCase();
      const cached = takeCachedUnitViewerAsset(session, normalized);
      if (cached) {
        resolveFor(requestedPath, cached);
        continue;
      }
      const requestedFor = outstanding.get(normalized) || [];
      requestedFor.push(requestedPath);
      outstanding.set(normalized, requestedFor);
    }

    // Narrowed once against everything still outstanding rather than per pack: the set only shrinks
    // as the walk resolves paths, so the list picked here stays a superset of what is still wanted.
    for (const packPath of await narrowUnitViewerAssetPackPaths(session, Array.from(outstanding.keys()))) {
      if (outstanding.size === 0) break;
      const pack = await getOrLoadPackFromAppData(packPath);
      if (!pack) continue;
      const fileNamesByAsset = new Map<string, string>();
      for (const normalized of outstanding.keys()) {
        const indexedFile = getUnitViewerAssetCandidates(normalized)
          .map((candidate) => findPackedFileCaseInsensitive(pack, candidate))
          .find((candidate): candidate is PackedFile => !!candidate);
        if (indexedFile) fileNamesByAsset.set(normalized, indexedFile.name);
      }
      if (fileNamesByAsset.size === 0) continue;
      await readFromExistingPack(pack, {
        filesToRead: Array.from(fileNamesByAsset.values()),
        skipParsingTables: true,
      });
      for (const [normalized, fileName] of fileNamesByAsset) {
        const loadedFile = findPackedFileCaseInsensitive(pack, fileName);
        if (!loadedFile?.buffer) continue;
        const entry = {
          buffer: loadedFile.buffer,
          mimeType: getPackedFileMimeType(loadedFile.name) || "image/png",
          bytes: loadedFile.buffer.length,
          resolvedPath: loadedFile.name,
        };
        cacheUnitViewerAsset(session, normalized, entry);
        for (const requestedPath of outstanding.get(normalized) || []) resolveFor(requestedPath, entry);
        outstanding.delete(normalized);
      }
    }
    return { assets, resolved };
  };

  const buildUnitViewerSessionData = async (enabledMods: Mod[]) => {
    if (appData.currentGame !== "wh3") throw new Error("Unit Viewer is available only for Warhammer 3");
    const dataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
    if (!dataFolder) throw new Error("Warhammer 3 data folder is not configured");
    const tablesToRead = Array.from(
      new Set(
        UNIT_VIEWER_TABLES.flatMap((tableName) =>
          resolveTable(tableName).map((resolvedTable) => `db\\${resolvedTable}\\`),
        ),
      ),
    );
    const dbPackPath = nodePath.join(dataFolder, gameToPackWithDBTablesName.wh3);
    const localizationPackPaths = getVanillaLocalisationPackPaths(dataFolder);
    const assetPackPaths = [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          !packName.startsWith("audio_") &&
          !packName.startsWith("movies") &&
          !packName.startsWith("terrain") &&
          !packName.startsWith("tile"),
      )
      .map((packName) => nodePath.join(dataFolder, packName))
      .concat(
        sortByNameAndLoadOrder(enabledMods)
          .toReversed()
          .map((mod) => mod.path),
      );
    const identityPaths = [dbPackPath, ...localizationPackPaths, ...enabledMods.map((mod) => mod.path)];
    const identities = await Promise.all(
      identityPaths.map(async (packPath) => {
        try {
          const stat = await fs.promises.stat(packPath);
          return [nodePath.resolve(packPath), stat.size, stat.mtimeMs] as const;
        } catch {
          return [nodePath.resolve(packPath), -1, -1] as const;
        }
      }),
    );
    const signature = createHash("sha256")
      .update(
        JSON.stringify({
          feature: 14,
          game: appData.currentGame,
          schema: getVisualsSchemaHash(appData.currentGame),
          mods: getUnitViewerSignature(enabledMods),
          identities,
        }),
      )
      .digest("hex");
    if (cachedUnitViewerData?.signature === signature) return cachedUnitViewerData;
    const diskData = await loadUnitViewerDiskCache(app.getPath("userData"), signature);
    if (diskData) {
      cachedUnitViewerData = { signature, data: diskData, assetPackPaths };
      return cachedUnitViewerData;
    }

    const indexedDbPack = await readPack(dbPackPath, { skipParsingTables: true });
    const { unservedPrefixes } = await fillVanillaTablesFromCache(indexedDbPack, tablesToRead, getDBVersion);
    if (unservedPrefixes.length === 0) {
      indexedDbPack.readTables = [...tablesToRead];
      appendPacksData(indexedDbPack, undefined, false);
    } else {
      // A pack readModsByPath did not return is one it never read, and a catalog built without the
      // game's database pack holds no vanilla units at all - which reads as a real result and would
      // be cached under a signature that stays valid across restarts.
      const readDbPacks = await readModsByPath([dbPackPath], { skipParsingTables: false, tablesToRead }, true, false);
      if (readDbPacks.length === 0) {
        throw new Error("The game's database pack could not be read for the Unit Viewer");
      }
    }
    if (enabledMods.length > 0) {
      await readMods(enabledMods, false, true, false, true, tablesToRead, undefined, false);
    }
    // The game's locs are only read when the loc cache has to be built. On a hit nothing here
    // touches local_en.pack, which is the point: parsing it into a trie costs ~97 MB of heap.
    const vanillaLocLookups = Object.values(await getVanillaLocLookup(localizationPackPaths));

    const packsByPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
    const dbPack = packsByPath.get(dbPackPath);
    if (!dbPack) throw new Error("Could not read db.pack for Unit Viewer");
    // A prefix db.pack carries files for, yet has no parsed rows for, means the rows this build filled
    // in were dropped again before it got here - by a release from another build over the same tables,
    // or by a read that never happened. Building on that yields a catalog holding only mod units, and
    // the disk cache below would then serve it on every start until the mod list changes. Fail instead.
    const unparsedVanillaPrefixes = findUnparsedTablePrefixes([dbPack], tablesToRead);
    if (unparsedVanillaPrefixes.length > 0) {
      throw new Error(
        `The game's unit tables were not available when the Unit Viewer was built (${unparsedVanillaPrefixes.join(", ")}), try again`,
      );
    }
    const orderedMods = sortByNameAndLoadOrder(enabledMods)
      .toReversed()
      .map((mod) => packsByPath.get(mod.path))
      .filter((pack): pack is Pack => !!pack);
    const tablePacks = [dbPack, ...orderedMods];
    const packsTableData = getPacksTableData(tablePacks, tablesToRead, false) || [];
    const tables: UnitViewerTableRows = {};
    const originPackPathByUnit = new Map<string, string>();
    const originPackPathByLandUnit = new Map<string, string>();
    for (const canonicalTableName of UNIT_VIEWER_TABLES) {
      const rows: Array<Record<string, string>> = [];
      getTableRowData(packsTableData, canonicalTableName, (schemaFieldRow, packViewData) => {
        const row = schemaRowToRecord(schemaFieldRow);
        rows.push(row);
        if (packViewData.packPath === dbPackPath) return;
        if (canonicalTableName === "main_units_tables" && row.unit) {
          originPackPathByUnit.set(row.unit, packViewData.packPath);
        } else if (canonicalTableName === "land_units_tables" && row.key) {
          originPackPathByLandUnit.set(row.key, packViewData.packPath);
        }
      });
      tables[canonicalTableName] = rows;
    }
    for (const row of tables.main_units_tables || []) {
      const unitKey = row.unit;
      const landUnitOrigin = row.land_unit ? originPackPathByLandUnit.get(row.land_unit) : undefined;
      if (unitKey && landUnitOrigin) originPackPathByUnit.set(unitKey, landUnitOrigin);
    }

    // Vanilla first so mod locs, which stay on the live path, still shadow it.
    const data = buildUnitViewerData(
      tables,
      createLocLookup([...vanillaLocLookups, ...orderedMods.map((pack) => getLocsTrie(pack))]),
      originPackPathByUnit,
    );
    const statIconSession: UnitViewerSession = {
      sessionId: "unit-viewer-cache-build",
      data,
      assetPackPaths,
      assetCache: new Map(),
      assetCacheBytes: 0,
      pendingAssets: new Map(),
      createdAt: Date.now(),
    };
    const { assets: statIcons } = await loadUnitViewerAssets(
      statIconSession,
      Array.from(new Set(Object.values(data.constants.statIconPaths))),
      true,
    );
    for (const [iconPath, icon] of Object.entries(statIcons)) {
      data.statIcons[iconPath] = icon.buffer.toString("base64");
    }
    await saveUnitViewerDiskCache(app.getPath("userData"), signature, data);
    // Everything the Unit Viewer needs now lives in `data`, which is cached both here and on disk.
    // The rows it was built from are the expensive half and are never read again: the next build for
    // this mod list is served by the cache above, and a build for another one re-reads anyway.
    releaseParsedTables(tablePacks, tablesToRead);
    cachedUnitViewerData = { signature, data, assetPackPaths };
    return cachedUnitViewerData;
  };

  ipcMain.handle("getUnitViewerCatalog", async (_event, enabledMods: Mod[]) => {
    try {
      const built = await unitViewerBuilds.run(getUnitViewerSignature(enabledMods), () =>
        buildUnitViewerSessionData(enabledMods),
      );
      const sessionId = randomUUID();
      unitViewerSessions.set(sessionId, {
        sessionId,
        data: built.data,
        assetPackPaths: built.assetPackPaths,
        assetCache: new Map(),
        assetCacheBytes: 0,
        pendingAssets: new Map(),
        createdAt: Date.now(),
      });
      // The one being replaced is kept, and nothing older.
      //
      // Every asset URL carries the session it was built for, and a reload rebuilds all of them, so
      // a session two catalogs back can no longer be addressed by anything the renderer draws - it
      // is unreachable bytes, up to the asset cache cap each. The one slot of slack covers the
      // requests already in flight when the swap happens.
      while (unitViewerSessions.size > 2) {
        const oldest = Array.from(unitViewerSessions.values()).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!oldest) break;
        unitViewerSessions.delete(oldest.sessionId);
      }
      // The stat icons come back from the disk cache already encoded, which is how they stay cheap
      // to persist. Registering them decodes each one once, for a URL like every other icon.
      const statIconGeneration = registerIconAssets(
        Object.fromEntries(
          Object.entries(built.data.statIcons).map(([iconPath, base64]) => [
            iconPath,
            { buffer: Buffer.from(base64, "base64"), mimeType: getPackedFileMimeType(iconPath) || "image/png" },
          ]),
        ),
      );
      const statIcons = Object.fromEntries(
        Object.keys(built.data.statIcons).map((iconPath) => [iconPath, iconAssetUrl(statIconGeneration, iconPath)]),
      );
      return {
        success: true,
        sessionId,
        groups: built.data.groups,
        unitGroups: built.data.unitGroups,
        constants: built.data.constants,
        statIcons,
      };
    } catch (error) {
      console.error("Failed to build Unit Viewer catalog:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to load units" };
    }
  });

  ipcMain.handle("getUnitViewerDetails", async (_event, sessionId: string, unitKey: string) => {
    try {
      const session = unitViewerSessions.get(sessionId);
      if (!session) return { success: false, error: "Unit Viewer session expired" };
      const unit = session.data.units.get(unitKey);
      if (!unit) return { success: false, error: `Unit ${unitKey} was not found` };
      // Warmed in one pass over the packs rather than one request per icon, then handed over as URLs
      // the protocol serves straight from that session cache.
      const { resolved } = await loadUnitViewerAssets(session, session.data.iconPathsByUnit.get(unitKey) || [], false);
      const icons = Object.fromEntries(
        resolved.map((iconPath) => [iconPath, unitAssetUrl(sessionId, iconPath)] as const),
      );
      return { success: true, unit, icons };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to load unit" };
    }
  });

  /**
   * The unit viewer's images, served to `<img>` rather than sent as payloads.
   *
   * A miss still reads the file out of the packs, so a card nothing prewarmed still appears; the
   * prewarm below is what keeps a whole roster to one read per pack instead of one per card.
   */
  registerAssetProtocol({
    resolveUnitViewerAsset: async (sessionId, assetPath) => {
      const session = unitViewerSessions.get(sessionId);
      if (!session) return undefined;
      // The roster paints every card at once, so these arrive in a burst. Waiting behind a prewarm
      // lets that one pass over the packs serve the whole burst, and the pending map collapses what
      // is left: without either, a hundred images would start a hundred reads of the same packs.
      await session.pendingPrewarm?.catch(() => undefined);
      const normalized = normalizePackFilePath(assetPath).toLowerCase();
      const pending = session.pendingAssets.get(normalized);
      if (pending) return await pending;
      const load = getUnitViewerAsset(session, assetPath).finally(() => session.pendingAssets.delete(normalized));
      session.pendingAssets.set(normalized, load);
      return await load;
    },
  });

  ipcMain.handle("prewarmUnitViewerAssets", async (_event, sessionId: string, assetPaths: string[]) => {
    try {
      const session = unitViewerSessions.get(sessionId);
      if (!session) return { success: false, error: "Unit Viewer session expired" };
      const prewarm = loadUnitViewerAssets(session, Array.from(new Set(assetPaths || [])), false);
      session.pendingPrewarm = prewarm;
      try {
        const { resolved } = await prewarm;
        return { success: true, resolved };
      } finally {
        if (session.pendingPrewarm === prewarm) session.pendingPrewarm = undefined;
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to load assets" };
    }
  });

  const TECHNOLOGY_ICON_PREFIX = "ui\\campaign ui\\technologies\\";
  const TECHNOLOGY_ICON_EXTENSION = /\.(png|jpg|jpeg)$/i;
  const getTechnologyIconPath = (iconName: string | undefined) => {
    if (!iconName || iconName.trim() === "") return undefined;
    const withoutExtension = iconName.replace(TECHNOLOGY_ICON_EXTENSION, "");
    return `${TECHNOLOGY_ICON_PREFIX}${withoutExtension}.png`;
  };
  const getTechnologyIconNameFromPath = (iconPath: string | undefined) => {
    if (!iconPath || iconPath.trim() === "") return "";
    return iconPath
      .trim()
      .replace(/^.*[\\/]/, "")
      .replace(/\.(png|jpg|jpeg)$/i, "");
  };
  const getTechnologyBuildingLevelForWrite = (
    buildingLevel: string | undefined,
    originalTechnologyRow?: Record<string, string>,
  ) => {
    const explicitBuildingLevel = (buildingLevel || "").trim();
    if (explicitBuildingLevel !== "") return explicitBuildingLevel;
    if (originalTechnologyRow && "building_level" in originalTechnologyRow) {
      return originalTechnologyRow.building_level || "";
    }
    return "wh_main_chs_port_ruin";
  };
  const buildUsedTechnologyUniqueIndexes = (technologyRowsByKey: Record<string, Record<string, string>>) => {
    const usedIndexes = new Set<string>();
    for (const technologyRow of Object.values(technologyRowsByKey)) {
      const uniqueIndex = (technologyRow.unique_index || "").trim();
      if (uniqueIndex !== "") usedIndexes.add(uniqueIndex);
    }
    return usedIndexes;
  };
  const allocateTechnologyUniqueIndex = (usedIndexes: Set<string>) => {
    let nextUniqueIndex = "";
    do {
      nextUniqueIndex = randomInt(1, 0x7fffffff).toString();
    } while (usedIndexes.has(nextUniqueIndex));
    usedIndexes.add(nextUniqueIndex);
    return nextUniqueIndex;
  };
  const normalizeTechnologyBuildingLevel = (buildingLevel: string | undefined) => {
    if (buildingLevel === "wh_main_human_port_ruin" || buildingLevel === "wh_main_chs_port_ruin") {
      return undefined;
    }
    return buildingLevel;
  };
  const getLocById = (locs: Record<string, KeyedLookup<string>>, locId: string) => {
    for (const locsInPack of Object.values(locs)) {
      const localized = locsInPack.get(locId);
      if (localized) return localized;
    }
  };
  const getTechnologyDataCacheKey = () =>
    hash({
      game: appData.currentGame,
      dataFolder: appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder || "",
      enabledMods: sortByNameAndLoadOrder(appData.enabledMods).map((mod) => ({
        path: mod.path,
        loadOrder: mod.loadOrder,
        lastChangedLocal: mod.lastChangedLocal,
      })),
    });
  const buildTechnologyData = async (): Promise<CachedTechnologyData | undefined> => {
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return undefined;
    const technologyTablesToRead = [
      "technology_node_sets_tables",
      "technology_nodes_tables",
      "technology_node_links_tables",
      "technology_ui_tabs_tables",
      "technology_ui_tabs_to_technology_nodes_junctions_tables",
      "technology_ui_groups_tables",
      "technology_ui_groups_to_technology_nodes_junctions_tables",
      "technologies_tables",
      "effects_tables",
      "technology_effects_junction_tables",
    ];
    const tablesToRead: string[] = [];
    for (const tableName of technologyTablesToRead) {
      for (const resolvedTable of resolveTable(tableName)) {
        const resolvedPath = `db\\${resolvedTable}\\`;
        if (!tablesToRead.includes(resolvedPath)) tablesToRead.push(resolvedPath);
      }
    }
    const enabledMods = [...appData.enabledMods];
    if (enabledMods.length > 0) {
      await readMods(enabledMods, false, true, false, true, tablesToRead);
    }
    const vanillaPacksToRead = [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          packName.startsWith("local_en") ||
          (!packName.startsWith("audio_") &&
            !packName.startsWith("local_") &&
            !packName.startsWith("tile") &&
            !packName.startsWith("warmachines") &&
            !packName.startsWith("terrain")),
      )
      .map((packName) => nodePath.join(dataFolder, packName));
    // Only the packs that hold these tables, and their rows from the vanilla db cache where it can
    // serve them. The locs are not read here - they come from the loc cache below - and undefined
    // means a pack something else was already reading still carries its technology tables with no
    // rows in them. The result is held under a cache key for the rest of the session, so a tech tree
    // built from that would stay missing the base game's technologies.
    const vanillaPacks = await readVanillaTablePacks(dataFolder, tablesToRead, vanillaPacksToRead, true);
    if (!vanillaPacks) {
      console.log("buildTechnologyData: the vanilla technology tables were not read");
      return undefined;
    }
    const packsByPath = new Map(appData.packsData.map((packData) => [packData.path, packData]));
    const orderedEnabledMods = sortByNameAndLoadOrder(enabledMods).toReversed();
    const orderedModPacks = orderedEnabledMods
      .map((mod) => packsByPath.get(mod.path))
      .filter((pack): pack is Pack => !!pack);
    const orderedPacks = vanillaPacks.concat(orderedModPacks);
    const packsTableData = getPacksTableData(orderedPacks, tablesToRead, true) || [];
    const setsByKey: CachedTechnologyData["setsByKey"] = {};
    const setRowsByKey: CachedTechnologyData["setRowsByKey"] = {};
    const nodesByKey: CachedTechnologyData["nodesByKey"] = {};
    const linksByKey: CachedTechnologyData["linksByKey"] = {};
    const uiTabsByKey: CachedTechnologyData["uiTabsByKey"] = {};
    const uiTabToNodes: CachedTechnologyData["uiTabToNodes"] = {};
    const uiGroupsByKey: CachedTechnologyData["uiGroupsByKey"] = {};
    const uiGroupBoundsByKey: Record<string, TechnologyUiGroupBoundsData> = {};
    const technologiesByKey: CachedTechnologyData["technologiesByKey"] = {};
    const nodeRowsByKey: CachedTechnologyData["nodeRowsByKey"] = {};
    const linkRowsByKey: CachedTechnologyData["linkRowsByKey"] = {};
    const technologyRowsByKey: CachedTechnologyData["technologyRowsByKey"] = {};
    const technologyEffectRowsByKey: CachedTechnologyData["technologyEffectRowsByKey"] = {};
    getTableRowData(packsTableData, "technology_node_sets_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      setsByKey[key] = {
        key,
        campaignKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "campaign_key")),
        factionKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "faction_key")),
        culture: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "culture")),
        subculture: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "subculture")),
        technologyCategory: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology_category")),
        localizedName: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "localised_name") ??
            getSchemaFieldValue(schemaFieldRow, "localized_name"),
        ),
        tooltipString: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tooltip_string")),
      };
      setRowsByKey[key] = schemaRowToRecord(schemaFieldRow);
    });
    getTableRowData(packsTableData, "technology_nodes_tables", (schemaFieldRow) => {
      const nodeKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      const technologyKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology_key"));
      const setKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology_node_set"));
      if (!nodeKey || !technologyKey || !setKey) return;
      nodesByKey[nodeKey] = {
        nodeKey,
        technologyKey,
        setKey,
        tier: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "tier")),
        indent: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "indent")),
        requiredParents: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "required_parents"), 0),
        campaignKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "campaign_key")),
        factionKey: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "faction_key")),
        pixelOffsetX: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "pixel_offset_x"), 0),
        pixelOffsetY: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "pixel_offset_y"), 0),
        researchPointsRequired: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "research_points_required")),
        optionalUiGroup: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "optional_ui_group")),
      };
      nodeRowsByKey[nodeKey] = schemaRowToRecord(schemaFieldRow);
    });
    getTableRowData(packsTableData, "technology_node_links_tables", (schemaFieldRow) => {
      const parentKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "parent_key"));
      const childKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "child_key"));
      if (!parentKey || !childKey) return;
      const linkKey = `${parentKey}|${childKey}`;
      linksByKey[linkKey] = {
        parentKey,
        childKey,
        parentLinkPosition: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "parent_link_position"), 2),
        childLinkPosition: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "child_link_position"), 4),
        parentLinkPositionOffset: parseOptionalFloat(
          getSchemaFieldValue(schemaFieldRow, "parent_link_position_offset"),
          0,
        ),
        childLinkPositionOffset: parseOptionalFloat(
          getSchemaFieldValue(schemaFieldRow, "child_link_position_offset"),
          0,
        ),
        initialDescentTiers: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "initial_descent_tiers"), 0),
        visibleInUi: parseOptionalBool(getSchemaFieldValue(schemaFieldRow, "visible_in_ui"), true),
      };
      linkRowsByKey[linkKey] = schemaRowToRecord(schemaFieldRow);
    });
    getTableRowData(packsTableData, "technology_ui_tabs_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      uiTabsByKey[key] = {
        key,
        sortOrder: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "sort_order")),
        tierOffset: parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "tier_offset")),
        localizedName: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "localised_name") ??
            getSchemaFieldValue(schemaFieldRow, "localized_name"),
        ),
        tooltipString: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tooltip_string")),
      };
    });
    getTableRowData(packsTableData, "technology_ui_tabs_to_technology_nodes_junctions_tables", (schemaFieldRow) => {
      const tab = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tab"));
      const node = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "node"));
      if (!tab || !node) return;
      if (!uiTabToNodes[tab]) uiTabToNodes[tab] = [];
      if (!uiTabToNodes[tab].includes(node)) uiTabToNodes[tab].push(node);
    });
    getTableRowData(packsTableData, "technology_ui_groups_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      const explicitHex = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "colour_hex"));
      const red = parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "colour_red"), 0);
      const green = parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "colour_green"), 0);
      const blue = parseOptionalNumber(getSchemaFieldValue(schemaFieldRow, "colour_blue"), 0);
      const colourHex =
        explicitHex ??
        [red, green, blue]
          .map((component) => Math.max(0, Math.min(255, component)).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
      uiGroupsByKey[key] = {
        key,
        colourRed: red,
        colourGreen: green,
        colourBlue: blue,
        colourHex,
        optionalBackgroundImage: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "optional_background_image")),
        optionalDisplayName: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "optional_display_name")),
        optionalDisplayDescription: parseOptionalString(
          getSchemaFieldValue(schemaFieldRow, "optional_display_desctiption") ??
            getSchemaFieldValue(schemaFieldRow, "optional_display_description"),
        ),
      };
    });
    getTableRowData(packsTableData, "technology_ui_groups_to_technology_nodes_junctions_tables", (schemaFieldRow) => {
      const groupKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "tech_ui_group"));
      const topLeftNode = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "top_left_node"));
      const bottomRightNode = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "bottom_right_node"));
      if (!groupKey || !topLeftNode || !bottomRightNode) return;
      uiGroupBoundsByKey[groupKey] = {
        groupKey,
        topLeftNode,
        bottomRightNode,
        optionalTopRightNode: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "optional_top_right_node")),
        optionalBottomLeftNode: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "optional_bottom_left_node")),
      };
    });
    getTableRowData(packsTableData, "technologies_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "key"));
      if (!key) return;
      const iconName = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "icon_name"));
      technologiesByKey[key] = {
        key,
        iconName,
        isHidden: parseOptionalBool(getSchemaFieldValue(schemaFieldRow, "is_hidden"), false),
        buildingLevel: normalizeTechnologyBuildingLevel(
          parseOptionalString(getSchemaFieldValue(schemaFieldRow, "building_level")),
        ),
      };
      technologyRowsByKey[key] = schemaRowToRecord(schemaFieldRow);
    });
    const effectsForTech: Record<string, { icon?: string }> = {};
    getTableRowData(packsTableData, "effects_tables", (schemaFieldRow) => {
      const key = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "effect"));
      const icon = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "icon"));
      if (key) effectsForTech[key] = { icon };
    });
    const technologyToEffectsByKey: Record<string, Record<string, { effectKey: string; value?: string }>> = {};
    const technologyEffectScopesByKey: Record<string, string> = {};
    getTableRowData(packsTableData, "technology_effects_junction_tables", (schemaFieldRow) => {
      const techKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "technology"));
      const effectKey = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "effect"));
      if (!techKey || !effectKey) return;
      const effectScope = parseOptionalString(getSchemaFieldValue(schemaFieldRow, "effect_scope"));
      if (!technologyToEffectsByKey[techKey]) technologyToEffectsByKey[techKey] = {};
      technologyToEffectsByKey[techKey][effectKey] = {
        effectKey,
        value: parseOptionalString(getSchemaFieldValue(schemaFieldRow, "value")),
      };
      if (effectScope && !technologyEffectScopesByKey[effectKey]) {
        technologyEffectScopesByKey[effectKey] = effectScope;
      }
      if (!technologyEffectRowsByKey[techKey]) technologyEffectRowsByKey[techKey] = {};
      technologyEffectRowsByKey[techKey][effectKey] = schemaRowToRecord(schemaFieldRow);
    });
    const technologyToEffects: Record<string, { effectKey: string; value?: string }[]> = Object.fromEntries(
      Object.entries(technologyToEffectsByKey).map(([techKey, effectsByKey]) => [techKey, Object.values(effectsByKey)]),
    );
    const techIconPaths = Array.from(
      new Set(
        Object.values(technologiesByKey)
          .map((tech) => getTechnologyIconPath(tech.iconName))
          .filter((iconPath): iconPath is string => !!iconPath),
      ).values(),
    );
    // Every technology icon the game and the enabled mods ship, so the editor's picker can offer one
    // the current tree does not use. Vanilla's come from the file index rather than from indexing the
    // vanilla packs, which is what the whole vanilla set used to be read for.
    const isTechnologyIconPath = (iconPath: string) =>
      iconPath.toLowerCase().startsWith(TECHNOLOGY_ICON_PREFIX) && TECHNOLOGY_ICON_EXTENSION.test(iconPath);
    const vanillaIndex = await getVanillaPackIndex();
    const allTechnologyIconPaths = Array.from(
      new Set(
        (vanillaIndex
          ? [...collectVanillaFilesUnderPrefix(vanillaIndex, TECHNOLOGY_ICON_PREFIX).keys()]
          : vanillaPacks.flatMap((pack) => pack.packedFiles.map((packedFile) => packedFile.name))
        )
          .concat(orderedModPacks.flatMap((pack) => pack.packedFiles.map((packedFile) => packedFile.name)))
          .filter(isTechnologyIconPath),
      ).values(),
    );
    const effectIconPaths = Array.from(
      new Set(
        Object.values(technologyToEffects)
          .flat()
          .map((effect) => effectsForTech[effect.effectKey]?.icon)
          .filter((icon): icon is string => !!icon)
          .map((icon) => `ui\\campaign ui\\effect_bundles\\${icon}`),
      ).values(),
    );
    const iconPaths = Array.from(new Set([...techIconPaths, ...allTechnologyIconPaths, ...effectIconPaths]).values());
    // orderedPacks is vanilla then mods, and getLocById takes the first hit, so the cache reader
    // goes first to keep that precedence. The packs were read for their tables either way; what is
    // saved is the tries, which the cached technology data used to retain.
    const locs = {
      ...(await getVanillaLocLookup(getVanillaLocalisationPackPaths(dataFolder))),
      ...getLocsFromPacks(orderedModPacks, getLocsTrie),
    };
    // The table packs hold hardly any of these, so the packs the icons are read out of are resolved
    // separately and indexed only if they turn out to carry one.
    const vanillaIconPacks = await getIconPacks((await findVanillaPacksHoldingIcons(iconPaths)) ?? vanillaPacksToRead);
    const iconPacks = vanillaIconPacks
      .concat(vanillaPacks.filter((pack) => !vanillaIconPacks.includes(pack)))
      .concat(orderedModPacks);
    const icons = iconPaths.length > 0 ? await loadIconsFromPacks(iconPacks, iconPaths) : {};
    const iconGeneration = registerIconAssets(icons);
    // Every technology table has been read into the structures above, and the result is held in
    // `cachedTechnologyData` for as long as it stays valid, so nothing below the row extraction
    // touches the rows again: the icon paths come from the file index, and the locs from the loc
    // cache. Only the packs that were parsed are released; the icon packs never were.
    releaseParsedTables(orderedPacks, tablesToRead);
    return {
      setsByKey,
      setRowsByKey,
      nodesByKey,
      linksByKey,
      uiTabsByKey,
      uiTabToNodes,
      uiGroupsByKey,
      uiGroupBounds: Object.values(uiGroupBoundsByKey),
      technologiesByKey,
      nodeRowsByKey,
      linkRowsByKey,
      technologyRowsByKey,
      technologyEffectRowsByKey,
      technologyEffectScopesByKey,
      locs,
      icons,
      iconGeneration,
      technologyToEffects,
      effectsForTech,
    };
  };
  /** As for the other two: buildTechnologyData releases rows a second build beside it would need. */
  const technologyDataBuilds = createSerializedBuilds();
  const ensureTechnologyData = async () => {
    const cacheKey = getTechnologyDataCacheKey();
    if (cachedTechnologyData && cachedTechnologyDataKey == cacheKey) return cachedTechnologyData;
    return technologyDataBuilds.run(cacheKey, async () => {
      // The build this one queued behind may have produced exactly what it was about to read packs for.
      if (cachedTechnologyData && cachedTechnologyDataKey == cacheKey) return cachedTechnologyData;
      cachedTechnologyData = await buildTechnologyData();
      cachedTechnologyDataKey = cacheKey;
      return cachedTechnologyData;
    });
  };

  // --- Campaign map ----------------------------------------------------------
  const getEsfMapSignature = async (enabledMods: Mod[], campaignName: string | undefined): Promise<string> => {
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
    const englishLocalizationPackPaths = dataFolder
      ? getVanillaLocalisationPackPathsFor(appData.allVanillaPackNames, appData.currentLanguage, dataFolder, true)
      : [];
    const vanillaStartposPaths = dataFolder ? await getVanillaStartposFilePaths(dataFolder) : [];
    const vanillaPackPaths = dataFolder
      ? [...appData.allVanillaPackNames].map((packName) => nodePath.join(dataFolder, packName))
      : [];
    const identityPaths = [
      ...vanillaPackPaths,
      ...englishLocalizationPackPaths,
      ...vanillaStartposPaths,
      ...enabledMods.map((mod) => mod.path),
    ];
    const identities = await Promise.all(
      [...new Set(identityPaths)].map(async (filePath) => {
        try {
          const stat = await fs.promises.stat(filePath);
          return [nodePath.resolve(filePath), stat.size, stat.mtimeMs] as const;
        } catch {
          return [nodePath.resolve(filePath), -1, -1] as const;
        }
      }),
    );
    return createHash("sha256")
      .update(
        JSON.stringify({
          feature: 3,
          game: appData.currentGame,
          dataFolder: dataFolder ?? null,
          currentLanguage: appData.currentLanguage ?? null,
          useEnglishLocalizations: appData.isUsingEnglishLocalizations,
          campaignName: campaignName ?? null,
          vanillaPackNames: [...appData.allVanillaPackNames],
          mods: sortByNameAndLoadOrder(enabledMods).map((mod) => ({
            path: mod.path,
            loadOrder: mod.loadOrder ?? null,
            lastChangedLocal: mod.lastChangedLocal ?? null,
          })),
          identities,
        }),
      )
      .digest("hex");
  };

  ipcMain.handle("getEsfMap", async (_event, enabledMods: Mod[], campaignName?: string): Promise<EsfMapResponse> => {
    try {
      const signature = await getEsfMapSignature(enabledMods, campaignName);
      const buildings = await ensureBuildingsData(enabledMods);
      const registeredIconPath = (requestedPath: string) =>
        Object.keys(buildings.icons).find(
          (iconPath) => normalizeAssetPath(iconPath) === normalizeAssetPath(requestedPath),
        );
      const decorate = (map: import("./esfMap/types").EsfMapPayload) => {
        const withFactions = addFactionDataToEsfMap(map, buildings.data, (flagPath) => {
          const registeredPath = registeredIconPath(flagPath);
          return registeredPath ? iconAssetUrl(buildings.iconGeneration, registeredPath) : undefined;
        });
        return addSettlementTypeDataToEsfMap(withFactions, buildings.data);
      };
      if (cachedEsfMapData?.signature === signature) {
        return { success: true, map: decorate(cachedEsfMapData.data) };
      }

      const diskData = await loadEsfMapDiskCache(app.getPath("userData"), signature);
      if (diskData) {
        cachedEsfMapData = { signature, data: diskData };
        return { success: true, map: decorate(diskData) };
      }

      const extractedMap = await loadEsfMapData(enabledMods, campaignName);
      const data = decorate(extractedMap);
      const cacheData = {
        ...data,
        factions: data.factions.map(({ flagUrl: _flagUrl, ...faction }) => faction),
      };
      await saveEsfMapDiskCache(app.getPath("userData"), signature, cacheData);
      cachedEsfMapData = { signature, data: cacheData };
      return { success: true, map: data };
    } catch (error) {
      console.log("getEsfMap failed:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // --- Buildings -------------------------------------------------------------
  const BUILDING_FRAME_PATH = "ui\\skins\\default\\building_frame.png";
  const BUILDING_FRAME_PACK_NAME = "ui2.pack";
  /** Folders the game keeps building icons in. Scanned, not assumed: `icon` holds a bare name. */
  const BUILDING_ICON_PREFIXES = ["ui\\campaign ui\\building_icons\\", "ui\\buildings\\"];
  const BUILDING_ICON_BROWSE_PREFIX = "ui\\buildings\\icons\\";
  const IMAGE_EXTENSION = /\.(png|jpg|jpeg|webp|tga)$/i;

  /**
   * `basename without extension` -> full packed file path, for every building icon in the packs.
   *
   * Vanilla names come from the global pack index, which answers both folder and exact-path lookups
   * without reopening ~260 pack indices. Enabled mods are few and still inspected directly.
   */
  const buildBuildingIconIndex = async (dataFolder: string, vanillaPackPaths: string[], modPackPaths: string[]) => {
    const byBaseName: Record<string, string> = {};
    const browsePathsByNormalizedPath = new Map<string, string>();
    const recordBuildingIcons = (packedFileNames: Iterable<string>) => {
      for (const name of packedFileNames) {
        const lower = name.toLowerCase();
        if (!BUILDING_ICON_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
        if (!IMAGE_EXTENSION.test(lower)) continue;
        const baseName = lower.slice(lower.lastIndexOf("\\") + 1).replace(IMAGE_EXTENSION, "");
        byBaseName[baseName] = name;
        if (lower.startsWith(BUILDING_ICON_BROWSE_PREFIX)) {
          browsePathsByNormalizedPath.set(normalizeAssetPath(name), name);
        }
      }
    };

    const vanillaIndex = await getVanillaPackIndex();
    const fallbackVanillaNames = new Map<string, Set<string>>();
    if (vanillaIndex) {
      for (const prefix of BUILDING_ICON_PREFIXES) {
        recordBuildingIcons(collectVanillaFilesUnderPrefix(vanillaIndex, prefix).keys());
      }
    } else {
      // The global index can be unavailable after a failed build. Preserve a slower path rather than
      // losing every building image, but retain its results in the older per-pack filename cache.
      for (const packPath of vanillaPackPaths) {
        try {
          const names = await getVanillaPackedFileNames(packPath);
          fallbackVanillaNames.set(packPath, new Set(names.map(normalizeAssetPath)));
          recordBuildingIcons(names);
        } catch {
          // One unreadable art pack must not take down the Buildings panel.
        }
      }
    }

    const modNames = new Map<string, Set<string>>();
    for (const packPath of modPackPaths) {
      try {
        const names = await getVanillaPackedFileNames(packPath);
        modNames.set(packPath, new Set(names.map(normalizeAssetPath)));
        // Mods follow vanilla and later mods win, matching game load order.
        recordBuildingIcons(names);
      } catch {
        // An unreadable mod cannot contribute an icon, but its tables were handled separately.
      }
    }

    const sourcePackPath = (assetPath: string): string | undefined => {
      const normalized = normalizeAssetPath(assetPath);
      let source: string | undefined;
      if (vanillaIndex) {
        const packName = findVanillaPackContaining(vanillaIndex, normalized);
        source = packName ? nodePath.join(dataFolder, packName) : undefined;
      } else {
        source = vanillaPackPaths.findLast((packPath) => fallbackVanillaNames.get(packPath)?.has(normalized));
      }
      for (const packPath of modPackPaths) {
        if (modNames.get(packPath)?.has(normalized)) source = packPath;
      }
      return source;
    };

    return { byBaseName, buildingIconPaths: [...browsePathsByNormalizedPath.values()], sourcePackPath };
  };

  /** Strips any folder and extension so a raw `icon` cell can be matched against the index. */
  const buildingIconBaseName = (icon: string) => {
    const normalized = icon.replace(/\//g, "\\").toLowerCase();
    return normalized.slice(normalized.lastIndexOf("\\") + 1).replace(IMAGE_EXTENSION, "");
  };

  const buildBuildingsSessionData = async (enabledMods: Mod[]): Promise<CachedBuildingsData> => {
    if (appData.currentGame !== "wh3") throw new Error("Buildings are available only for Warhammer 3");
    const dataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
    if (!dataFolder) throw new Error("Warhammer 3 data folder is not configured");

    const tablesToRead = Array.from(
      new Set(
        BUILDINGS_TABLES.flatMap((tableName) =>
          resolveTable(tableName).map((resolvedTable) => `db\\${resolvedTable}\\`),
        ),
      ),
    );
    const dbPackPath = nodePath.join(dataFolder, gameToPackWithDBTablesName.wh3);
    const localizationPackPaths = getVanillaLocalisationPackPaths(dataFolder);
    const orderedEnabledMods = sortByNameAndLoadOrder(enabledMods).toReversed();
    const vanillaIconPackPaths = [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          !packName.startsWith("audio_") &&
          !packName.startsWith("movies") &&
          !packName.startsWith("terrain") &&
          !packName.startsWith("tile"),
      )
      .map((packName) => nodePath.join(dataFolder, packName));
    const modIconPackPaths = orderedEnabledMods.map((mod) => mod.path);

    const buildingFramePackPath = nodePath.join(dataFolder, BUILDING_FRAME_PACK_NAME);
    const identityPaths = [
      dbPackPath,
      buildingFramePackPath,
      ...localizationPackPaths,
      ...orderedEnabledMods.map((mod) => mod.path),
    ];
    const identities = await Promise.all(
      identityPaths.map(async (packPath) => {
        try {
          const stat = await fs.promises.stat(packPath);
          return [nodePath.resolve(packPath), stat.size, stat.mtimeMs] as const;
        } catch {
          return [nodePath.resolve(packPath), -1, -1] as const;
        }
      }),
    );
    const signatureInputs: BuildingsCacheSignatureInputs = {
      feature: 3,
      game: appData.currentGame,
      schema: getVisualsSchemaHash(appData.currentGame),
      mods: buildBuildingsModsSignature(enabledMods),
      identities,
    };
    const signature = createHash("sha256").update(JSON.stringify(signatureInputs)).digest("hex");
    if (cachedBuildingsData?.signature === signature) {
      console.log("buildBuildingsSessionData: using in-memory Buildings cache", { signature });
      return cachedBuildingsData;
    }
    if (cachedBuildingsData) {
      console.log("buildBuildingsSessionData: in-memory Buildings cache miss: signature changed", {
        cachedSignature: cachedBuildingsData.signature,
        requestedSignature: signature,
        changedInputs: describeBuildingsCacheSignatureChanges(cachedBuildingsData.signatureInputs, signatureInputs),
      });
    } else {
      console.log("buildBuildingsSessionData: in-memory Buildings cache miss: no cached data", {
        requestedSignature: signature,
      });
    }
    const diskData = await loadBuildingsDiskCache(app.getPath("userData"), signature, signatureInputs);
    if (diskData) {
      console.log("buildBuildingsSessionData: using disk Buildings cache", { signature });
      const hadBuildingFrame = !!diskData.data.buildingFrame;
      const icons = await registerBuildingIcons(diskData.data, dataFolder, vanillaIconPackPaths, modIconPackPaths);
      if (!hadBuildingFrame && diskData.data.buildingFrame) {
        await saveBuildingsDiskCache(
          app.getPath("userData"),
          signature,
          diskData.data,
          diskData.tables,
          diskData.localizations,
          signatureInputs,
        );
      }
      cachedBuildingsData = { signature, ...diskData, dbPackPath, ...icons };
      return cachedBuildingsData;
    }

    console.log("buildBuildingsSessionData: rebuilding Buildings cache from vanilla and mod packs", {
      reason: "no matching in-memory or disk cache entry",
      signature,
    });

    const indexedDbPack = await readPack(dbPackPath, { skipParsingTables: true });
    const { unservedPrefixes } = await fillVanillaTablesFromCache(indexedDbPack, tablesToRead, getDBVersion);
    if (unservedPrefixes.length === 0) {
      indexedDbPack.readTables = [...tablesToRead];
      appendPacksData(indexedDbPack, undefined, false);
    } else {
      // At this point every reported prefix has files in db.pack; an absent table family is already
      // a complete empty result, so these are genuine cache gaps or schema mismatches.
      console.log("buildBuildingsSessionData: prefixes the vanilla db cache did not serve:", unservedPrefixes);
      const readDbPacks = await readModsByPath([dbPackPath], { skipParsingTables: false, tablesToRead }, true, false);
      if (readDbPacks.length === 0) throw new Error("The game's database pack could not be read for Buildings");
    }
    if (enabledMods.length > 0) {
      await readMods(enabledMods, false, true, false, true, tablesToRead, undefined, false);
    }
    // Read separately from the tables: readVanillaPackFromCache refuses any request with readLocs,
    // so combining the two would give up the cache for the whole build.
    const vanillaLocLookups = Object.values(await getVanillaLocLookup(localizationPackPaths));

    const packsByPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
    const dbPack = packsByPath.get(dbPackPath);
    if (!dbPack) throw new Error("Could not read db.pack for Buildings");
    // Files present but no rows means the rows this build filled in were released underneath it.
    // Caching that would serve a buildings-less catalog until the mod list changes.
    const unparsedVanillaPrefixes = findUnparsedTablePrefixes([dbPack], tablesToRead);
    if (unparsedVanillaPrefixes.length > 0) {
      throw new Error(
        `The game's building tables were not available when Buildings was built (${unparsedVanillaPrefixes.join(", ")}), try again`,
      );
    }
    const orderedModPacks = orderedEnabledMods
      .map((mod) => packsByPath.get(mod.path))
      .filter((pack): pack is Pack => !!pack);
    const tablePacks = [dbPack, ...orderedModPacks];
    const packsTableData = getPacksTableData(tablePacks, tablesToRead, false) || [];
    const tables: BuildingsTableRows = {};
    for (const canonicalTableName of BUILDINGS_TABLES) {
      const rows: Array<Record<string, string>> = [];
      getTableRowData(packsTableData, canonicalTableName, (schemaFieldRow) => {
        rows.push(schemaRowToRecord(schemaFieldRow));
      });
      tables[canonicalTableName] = rows;
    }
    const startposSlotTemplateRows = await loadStartposRegionSlotTemplates(enabledMods);
    if (startposSlotTemplateRows.length > 0) {
      tables.start_pos_region_slot_templates_tables.push(...startposSlotTemplateRows);
    }

    // Vanilla first so mod locs, which stay on the live path, still shadow it. Record every lookup
    // the builder actually consumes; this compact snapshot is enough to rebuild after pending rows
    // change without retaining the much larger localization tries.
    const sourceLoc = createBuildingsLocLookup([
      ...vanillaLocLookups,
      ...orderedModPacks.map((pack) => getLocsTrie(pack)),
    ]);
    const localizations: Record<string, string> = {};
    const data = buildBuildingsData(tables, (key) => {
      const value = sourceLoc(key);
      if (value != undefined) localizations[key] = value;
      return value;
    });

    releaseParsedTables(tablePacks, tablesToRead);
    const icons = await registerBuildingIcons(data, dataFolder, vanillaIconPackPaths, modIconPackPaths);
    await saveBuildingsDiskCache(app.getPath("userData"), signature, data, tables, localizations, signatureInputs);
    cachedBuildingsData = { signature, signatureInputs, data, tables, localizations, dbPackPath, ...icons };
    return cachedBuildingsData;
  };

  /** Loads the icon bytes for every variant icon the data mentions and registers them for serving. */
  const registerBuildingIcons = async (
    data: BuiltBuildingsData,
    dataFolder: string,
    vanillaPackPaths: string[],
    modPackPaths: string[],
  ) => {
    let buildingFrame: AssetBytes | undefined;
    if (data.buildingFrame) {
      buildingFrame = { buffer: Buffer.from(data.buildingFrame, "base64"), mimeType: "image/png" };
    } else {
      const vanillaUiPackPath = vanillaPackPaths.find(
        (packPath) => nodePath.basename(packPath).toLowerCase() === BUILDING_FRAME_PACK_NAME,
      );
      if (vanillaUiPackPath) {
        const uiPack = (await getIconPacks([vanillaUiPackPath]))[0];
        if (uiPack) {
          const loadedFrame = await loadIconsFromPacks([uiPack], [BUILDING_FRAME_PATH]);
          buildingFrame = loadedFrame[BUILDING_FRAME_PATH];
          if (buildingFrame) data.buildingFrame = buildingFrame.buffer.toString("base64");
        }
      }
    }

    const iconIndex = await buildBuildingIconIndex(dataFolder, vanillaPackPaths, modPackPaths);
    const iconPathByBaseName: Record<string, string> = {};
    for (const variants of Object.values(data.variantsByLevel)) {
      for (const variant of variants) {
        if (!variant.icon) continue;
        const baseName = buildingIconBaseName(variant.icon);
        const packedFilePath = iconIndex.byBaseName[baseName];
        if (packedFilePath) iconPathByBaseName[baseName] = packedFilePath;
      }
    }
    const effectIconPaths = new Set<string>();
    for (const effects of Object.values(data.effectsByLevel)) {
      for (const effect of effects) {
        if (effect.icon) effectIconPaths.add(`ui\\campaign ui\\effect_bundles\\${effect.icon}`);
      }
    }
    const unitCardPaths = new Set<string>();
    for (const units of [...Object.values(data.garrisonByLevel), ...Object.values(data.recruitableByLevel)]) {
      for (const unit of units) if (unit.cardPath) unitCardPaths.add(unit.cardPath);
    }
    const factionFlagPaths = new Set<string>();
    for (const faction of data.factions) {
      const flagPath = factionFlagPath(faction.flagPath);
      if (flagPath) factionFlagPaths.add(flagPath);
    }
    const wantedPaths = Array.from(
      new Set([
        ...(buildingFrame ? [BUILDING_FRAME_PATH] : []),
        ...iconIndex.buildingIconPaths,
        ...Object.values(iconPathByBaseName),
        ...effectIconPaths,
        ...unitCardPaths,
        ...factionFlagPaths,
      ]),
    );
    const wantedPackPaths = new Set(
      wantedPaths.map(iconIndex.sourcePackPath).filter((packPath): packPath is string => !!packPath),
    );
    const neededPackPaths = [...vanillaPackPaths, ...modPackPaths].filter((packPath) => wantedPackPaths.has(packPath));
    const icons =
      wantedPaths.length > 0 ? await loadIconsFromPacks(await getIconPacks(neededPackPaths), wantedPaths) : {};
    if (buildingFrame) icons[BUILDING_FRAME_PATH] = buildingFrame;
    return {
      iconPathByBaseName,
      buildingIconPaths: iconIndex.buildingIconPaths,
      icons,
      iconGeneration: registerIconAssets(icons),
    };
  };

  /** The packs icon bytes are read out of, loaded lazily and only once per session. */
  const getIconPacks = async (iconPackPaths: string[]) => {
    const loaded = new Map(appData.packsData.map((pack) => [pack.path, pack]));
    const missing = iconPackPaths.filter((packPath) => !loaded.has(packPath));
    if (missing.length > 0) {
      await readModsByPath(missing, { skipParsingTables: true }, true, false);
    }
    const byPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
    return iconPackPaths.map((packPath) => byPath.get(packPath)).filter((pack): pack is Pack => !!pack);
  };

  const buildingsBuilds = createSerializedBuilds();
  const ensureBuildingsData = async (enabledMods: Mod[]) =>
    buildingsBuilds.run(buildBuildingsBuildKey(enabledMods, appData.currentGame), () =>
      buildBuildingsSessionData(enabledMods),
    );

  /**
   * The schema each buildings table's rows have to be written with.
   *
   * The version matters: writing rows against a different one than the game's own table uses makes
   * the pack unreadable. Same choice `saveSkillsPack` makes - prefer the version the vanilla pack
   * carries, fall back to the newest the schema knows.
   */
  const getBuildingsTableSchemas = async (): Promise<Record<string, DBVersion>> => {
    const defaultTableVersions = await getDefaultTableVersions();
    const schemas: Record<string, DBVersion> = {};
    for (const tableName of BUILDINGS_TABLES) {
      const versions = DBNameToDBVersions[appData.currentGame][tableName];
      if (!versions || versions.length === 0) continue;
      const defaultVersion = defaultTableVersions?.[tableName];
      schemas[tableName] = versions.find((version) => version.version === defaultVersion) || versions[0];
    }
    return schemas;
  };

  const toBuildingsCatalog = (
    built: CachedBuildingsData,
    tableSchemas: Record<string, DBVersion>,
  ): BuildingsCatalog => {
    const assetUrl = (packedFilePath: string | undefined) =>
      packedFilePath && built.icons[packedFilePath] ? iconAssetUrl(built.iconGeneration, packedFilePath) : undefined;
    const buildingIcons = built.buildingIconPaths
      .map((path) => ({
        path,
        name: buildingIconBaseName(path),
        iconUrl: assetUrl(path),
      }))
      .filter((icon): icon is { path: string; name: string; iconUrl: string } => icon.iconUrl !== undefined)
      .sort((first, second) => collator.compare(first.name, second.name) || collator.compare(first.path, second.path));
    const unitGroupsByUnit: Record<string, string[]> = {};
    for (const [unitGroup, units] of Object.entries(built.data.garrisonUnitsByGroup)) {
      for (const unit of units) {
        (unitGroupsByUnit[unit.unitKey] ||= []).push(unitGroup);
      }
    }

    return {
      tableSchemas,
      campaigns: built.data.campaigns,
      regions: built.data.regions,
      cultures: built.data.cultures,
      subcultures: built.data.subcultures,
      factions: built.data.factions,
      settlementTypes: built.data.settlementTypes,
      units: built.data.units,
      unitGroups: built.data.unitGroups,
      unitGroupsByUnit,
      cultureVariantsByBuilding: built.data.variantsByLevel,
      buildingIcons,
      effects: built.data.effects,
      effectScopes: built.data.effectScopes,
      chainKeys: Object.keys(built.data.chains).sort(),
      dbPackPath: built.dbPackPath,
      moddersPrefix: appData.moddersPrefix,
      nextNumericIds: built.data.nextNumericIds,
    };
  };

  /**
   * Rebuilds every structure and option list from the effective rows. Keeping this as the same
   * `buildBuildingsData` path used at initial load means a table cannot be consumed by the view yet
   * forgotten by a separate incremental updater. `start_pos_*` rows are deliberately immutable.
   */
  const applyPendingBuildingsRows = (built: CachedBuildingsData, pendingEdits?: BuildingsEditState) => {
    if (!pendingEdits) return built.data;
    const rowsByTable = newRowsByTable(pendingEdits);
    const hasApplicableRows = Object.keys(rowsByTable).some(
      (table) => table === LOC_TABLE || !table.startsWith("start_pos_"),
    );
    if (!hasApplicableRows) return built.data;

    const pendingLoc: Record<string, string> = {};
    for (const row of rowsByTable[LOC_TABLE] ?? []) {
      const key = (row.values.key ?? "").trim();
      if (key) pendingLoc[key] = row.values.text ?? "";
    }
    const data = applyNewRowsToBuildingsData(built.tables, pendingEdits, (tables) =>
      buildBuildingsData(tables, (key) =>
        Object.prototype.hasOwnProperty.call(pendingLoc, key) ? pendingLoc[key] : built.localizations[key],
      ),
    );
    // The shared frame is an asset added after table extraction rather than a DB-derived field.
    data.buildingFrame = built.data.buildingFrame;
    return data;
  };

  /** Fills in the icon URLs the renderer renders; the data itself holds only pack-relative paths. */
  const decorateBuildingsView = (view: BuildingsRegionView, built: CachedBuildingsData): BuildingsRegionView => {
    const assetUrl = (packedFilePath: string | undefined) =>
      packedFilePath && built.icons[packedFilePath] ? iconAssetUrl(built.iconGeneration, packedFilePath) : undefined;

    view.buildingFrameUrl = assetUrl(BUILDING_FRAME_PATH);
    for (const band of view.bands) {
      for (const column of band.columns) {
        for (const tile of column.tiles) {
          tile.iconUrl = assetUrl(
            tile.iconPath ? built.iconPathByBaseName[buildingIconBaseName(tile.iconPath)] : undefined,
          );
          for (const effect of tile.effects) {
            effect.iconUrl = assetUrl(effect.icon ? `ui\\campaign ui\\effect_bundles\\${effect.icon}` : undefined);
          }
          for (const unit of [...tile.garrison, ...tile.recruitable]) {
            unit.cardUrl = assetUrl(unit.cardPath);
          }
        }
      }
    }
    return view;
  };

  ipcMain.handle("getBuildingsCatalog", async (_event, enabledMods: Mod[]): Promise<BuildingsCatalogResponse> => {
    try {
      const built = await ensureBuildingsData(enabledMods);
      return { success: true, catalog: toBuildingsCatalog(built, await getBuildingsTableSchemas()) };
    } catch (error) {
      console.log("getBuildingsCatalog failed:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    "getBuildingsRegionView",
    async (
      _event,
      enabledMods: Mod[],
      query: BuildingsRegionQuery,
      pendingEdits?: BuildingsEditState,
    ): Promise<BuildingsRegionViewResponse> => {
      try {
        const built = await ensureBuildingsData(enabledMods);
        const data = applyPendingBuildingsRows(built, pendingEdits);
        const view = resolveRegionBuildings(data, query);
        // Validated against the base data, not `data`: every pending row exists in the latter by
        // construction, so an override would look like a perfectly ordinary key.
        const rowIssues = pendingEdits ? validateNewRows(built.data, pendingEdits) : undefined;
        const catalog = toBuildingsCatalog({ ...built, data }, await getBuildingsTableSchemas());
        return { success: true, view: decorateBuildingsView(view, built), catalog, rowIssues };
      } catch (error) {
        console.log("getBuildingsRegionView failed:", error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    "getBuildingsCaiRows",
    async (
      _event,
      enabledMods: Mod[],
      chainKey: string,
      pendingEdits?: BuildingsEditState,
    ): Promise<BuildingsCaiRowsResponse> => {
      try {
        const built = await ensureBuildingsData(enabledMods);
        const data = applyPendingBuildingsRows(built, pendingEdits);
        const rowsByTable: Record<string, Array<Record<string, string>>> = {};
        const values = data.caiValuesByChain[chainKey];
        if (values?.length) rowsByTable.cai_construction_system_building_values_tables = values;
        const synergies = data.caiSynergiesByChain[chainKey];
        if (synergies?.length) rowsByTable.cai_construction_system_synergies_tables = synergies;
        return { success: true, rowsByTable, superChain: data.chains[chainKey]?.superChain };
      } catch (error) {
        console.log("getBuildingsCaiRows failed:", error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // --- Ancillaries -----------------------------------------------------------
  const ANCILLARY_TABLE_PREFIXES = ANCILLARY_TABLES.map((tableName) => `db\\${tableName}\\`);

  /** Loc key prefixes the Ancillaries panel reads. Used to scan a mod's own loc entries. */
  const ANCILLARY_LOC_PREFIXES = [
    "ancillaries_onscreen_name_",
    "ancillaries_explanation_text_",
    "ancillaries_colour_text_",
    "ancillaries_categories_onscreen_name_",
    "ancillaries_subcategories_onscreen_name_",
    "effects_description_",
    "ui_text_replacements_localised_text_",
  ];

  /**
   * The rows and locs one pack contributes, read from that pack alone.
   *
   * `ownLocEntries` is a mod pack's complete loc table. Scanning it is what makes a *translation
   * only* mod work: such a pack defines no ancillary rows, so a purely row-driven capture would
   * record nothing from it and its override of a vanilla name would be lost. Vanilla has no
   * equivalent - its loc lookup is the cache reader, which cannot be enumerated - but it does not
   * need one, since its own rows define every key it can supply.
   */
  const readAncillariesSourceFromPacks = (
    packs: Pack[],
    getLoc: (key: string) => string | undefined,
    ownLocEntries?: Record<string, string>,
  ) => {
    const packsTableData = getPacksTableData(packs, ANCILLARY_TABLE_PREFIXES, false) || [];
    const tables: AncillariesTableRows = {};
    for (const tableName of ANCILLARY_TABLES) {
      const rows: Array<Record<string, string>> = [];
      getTableRowData(packsTableData, tableName, (schemaFieldRow) => {
        rows.push(schemaRowToRecord(schemaFieldRow));
      });
      tables[tableName] = rows;
    }

    // Capture only the keys this source's own rows can need. Recorded rather than retaining the loc
    // tries, which cost far more than the handful of strings a mod actually defines.
    const localizations: Record<string, string> = {};
    const record = (key: string) => {
      const value = getLoc(key);
      if (value != undefined) localizations[key] = value;
      return value;
    };
    /**
     * Records a key, and the keys its own text is built out of.
     *
     * Any of these strings can be a `{{tr:...}}` token, which `resolveTextReplacements` looks up as
     * a loc key of its own - one level of nesting included. Without recording those too, the cached
     * snapshot resolves the token to its bare name: a category reads "{{tr:foo}}" rather than its
     * name.
     */
    const recordWithReplacements = (key: string) => {
      const text = record(key);
      for (const match of text?.matchAll(/{{tr:(.*?)}}/gi) ?? []) {
        const token = match[1];
        if (!token) continue;
        const replacement = record(`ui_text_replacements_localised_text_${token}`) ?? record(token);
        const nested = replacement?.match(/^{{tr:(.*?)}}$/i)?.[1];
        if (nested && record(`ui_text_replacements_localised_text_${nested}`) === undefined) record(nested);
      }
      return text;
    };

    for (const row of tables.ancillaries_tables ?? []) {
      const key = (row.key ?? "").trim();
      if (!key) continue;
      recordWithReplacements(`ancillaries_onscreen_name_${key}`);
      recordWithReplacements(`ancillaries_explanation_text_${key}`);
      recordWithReplacements(`ancillaries_colour_text_${key}`);
    }
    for (const row of tables.ancillaries_categories_tables ?? []) {
      const key = (row.category ?? "").trim();
      if (key) recordWithReplacements(`ancillaries_categories_onscreen_name_${key}`);
    }
    for (const row of tables.ancillaries_subcategories_tables ?? []) {
      const key = (row.subcategory ?? "").trim();
      if (key) recordWithReplacements(`ancillaries_subcategories_onscreen_name_${key}`);
    }
    // Every effect, not only the ones an ancillary already has: the "+ Add effect" picker offers
    // all of them, and a key recorded here is the only way the panel can name one later.
    for (const row of tables.effects_tables ?? []) {
      const effect = (row.effect ?? "").trim();
      if (effect) recordWithReplacements(`effects_description_${effect}`);
    }
    for (const [key, value] of Object.entries(ownLocEntries ?? {})) {
      if (ANCILLARY_LOC_PREFIXES.some((prefix) => key.startsWith(prefix))) localizations[key] = value;
    }
    return { tables, localizations } satisfies AncillariesSource;
  };

  /**
   * The vanilla half: db.pack plus the localisation packs, keyed on their identities alone.
   *
   * No mod list goes into the signature, which is the whole point of the split - enabling or
   * disabling a mod leaves this valid and only the mod segments below are revisited.
   */
  const buildAncillariesVanillaSource = async (dataFolder: string): Promise<AncillariesSource> => {
    const localizationPackPaths = getVanillaLocalisationPackPaths(dataFolder);
    const dbPackPath = nodePath.join(dataFolder, gameToPackWithDBTablesName.wh3);
    const identityPaths = [dbPackPath, ...localizationPackPaths];
    const identities = await Promise.all(
      identityPaths.map(async (packPath) => {
        const [size, mtimeMs] = await readPackIdentity(packPath);
        return [nodePath.resolve(packPath), size, mtimeMs] as const;
      }),
    );
    const signatureInputs: AncillariesVanillaSignatureInputs = {
      feature: 1,
      game: appData.currentGame,
      schema: getVisualsSchemaHash(appData.currentGame),
      identities,
    };
    const signature = createHash("sha256").update(JSON.stringify(signatureInputs)).digest("hex");

    const cached = await loadVanillaAncillariesCache(app.getPath("userData"), signature, signatureInputs);
    if (cached) {
      console.log("Ancillaries: reusing the vanilla cache", { signature });
      return cached;
    }

    console.log("Ancillaries: rebuilding the vanilla half from the game's packs", { signature });
    const vanillaPacks = await readVanillaTablePacks(dataFolder, ANCILLARY_TABLE_PREFIXES, [dbPackPath], false);
    if (!vanillaPacks) {
      throw new Error("The game's ancillary tables could not be read, try again");
    }
    // Read separately from the tables: readVanillaPackFromCache refuses any request with readLocs,
    // so combining the two would give up the cache for the whole build.
    const vanillaLocLookups = Object.values(await getVanillaLocLookup(localizationPackPaths));
    const getLoc = createAncillariesLocLookup(vanillaLocLookups);
    const source = readAncillariesSourceFromPacks(vanillaPacks, getLoc);

    releaseParsedTables(vanillaPacks, ANCILLARY_TABLE_PREFIXES);
    await saveVanillaAncillariesCache(app.getPath("userData"), signature, source, signatureInputs);
    return source;
  };

  /**
   * The mod half: one segment per enabled mod, each keyed on that pack's own size and mtime.
   *
   * Packs are read one at a time rather than in a single merged call, because a segment is only
   * reusable if it holds exactly one pack's rows. That is the cost of not rebuilding all of them
   * when one mod changes.
   */
  const buildAncillariesModSources = async (
    dataFolder: string,
    orderedEnabledMods: Mod[],
  ): Promise<Array<{ packPath: string; source: AncillariesSource }>> => {
    if (orderedEnabledMods.length === 0) return [];

    const segments: AncillariesModSegments = { ...(await loadAncillariesModSegments(app.getPath("userData"))) };
    const identities = new Map(
      await Promise.all(orderedEnabledMods.map(async (mod) => [mod.path, await readPackIdentity(mod.path)] as const)),
    );
    const stale = orderedEnabledMods.filter(
      (mod) => !isSameIdentity(segments[modSegmentKey(mod.path)]?.identity, identities.get(mod.path)),
    );

    if (stale.length > 0) {
      console.log("Ancillaries: rebuilding mod cache segments", { count: stale.length, of: orderedEnabledMods.length });
      await readMods(stale, false, true, false, true, ANCILLARY_TABLE_PREFIXES, undefined, false);
      const packsByPath = new Map(appData.packsData.map((pack) => [pack.path, pack]));
      // Mod locs stay on the live path; the vanilla lookup is not consulted here so a segment never
      // captures a string it did not itself define.
      for (const mod of stale) {
        const pack = packsByPath.get(mod.path);
        if (!pack) continue;
        const trie = getLocsTrie(pack);
        const getLoc = createAncillariesLocLookup([trie]);
        segments[modSegmentKey(mod.path)] = {
          ...readAncillariesSourceFromPacks([pack], getLoc, trie?.getEntries()),
          identity: identities.get(mod.path) ?? [-1, -1],
          lastUsedMs: Date.now(),
        };
      }
      releaseParsedTables(
        stale.map((mod) => packsByPath.get(mod.path)).filter((pack): pack is Pack => !!pack),
        ANCILLARY_TABLE_PREFIXES,
      );
    } else {
      console.log("Ancillaries: every enabled mod's cache segment is current", { count: orderedEnabledMods.length });
    }

    // Refresh the LRU stamp on every segment this build used, reused or not, so the pruner drops
    // the mods that have actually gone quiet.
    const now = Date.now();
    for (const mod of orderedEnabledMods) {
      const segment = segments[modSegmentKey(mod.path)];
      if (segment) segment.lastUsedMs = now;
    }
    const saved = await saveAncillariesModSegments(app.getPath("userData"), segments);

    return orderedEnabledMods
      .map((mod) => ({ packPath: mod.path, source: saved[modSegmentKey(mod.path)] }))
      .filter((entry): entry is { packPath: string; source: AncillariesModSegment } => !!entry.source);
  };

  /**
   * Loads every icon the data mentions and registers it for serving.
   *
   * Four sources, all addressed by exact path, so the global vanilla file index answers "which
   * pack wins" without opening anything: the ancillary's own `ui_icon`, its category's icon, one
   * per effect, and every ancillary type's icon for the type picker.
   */
  const effectIconPath = (icon: string | undefined) => (icon ? `ui\\campaign ui\\effect_bundles\\${icon}` : undefined);

  const registerAncillaryIcons = async (data: BuiltAncillariesData, dataFolder: string, modPackPaths: string[]) => {
    const wantedPaths = new Set<string>();
    for (const ancillary of data.ancillaries) {
      if (ancillary.iconPath) wantedPaths.add(normalizeAssetPath(ancillary.iconPath));
    }
    for (const category of data.categories) {
      if (category.iconName) wantedPaths.add(normalizeAssetPath(categoryIconPath(category.iconName)));
    }
    // Types no ancillary uses yet still need their icon: the type picker offers all of them.
    for (const iconPath of Object.values(data.typeIcons)) wantedPaths.add(normalizeAssetPath(iconPath));
    // Every effect, not only the ones in use: the "+ Add effect" picker shows an icon per option.
    // Effects share icons heavily, so the deduped set stays a fraction of the effect count.
    for (const effect of data.effects) {
      const iconPath = effectIconPath(effect.icon);
      if (iconPath) wantedPaths.add(normalizeAssetPath(iconPath));
    }
    const paths = [...wantedPaths];
    if (paths.length === 0) return { icons: {} as Record<string, AssetBytes>, iconGeneration: registerIconAssets({}) };

    const vanillaPackPaths =
      (await findVanillaPacksHoldingIcons(paths)) ??
      [...appData.allVanillaPackNames].map((packName) => nodePath.join(dataFolder, packName));
    // Mods come after vanilla so a mod that replaces an icon wins, matching game load order.
    const icons = await loadIconsFromPacks(await getIconPacks([...vanillaPackPaths, ...modPackPaths]), paths);
    return { icons, iconGeneration: registerIconAssets(icons) };
  };

  const buildAncillariesSessionData = async (enabledMods: Mod[]): Promise<CachedAncillariesData> => {
    if (appData.currentGame !== "wh3") throw new Error("Ancillaries are available only for Warhammer 3");
    const dataFolder = appData.gamesToGameFolderPaths.wh3.dataFolder;
    if (!dataFolder) throw new Error("Warhammer 3 data folder is not configured");

    const orderedEnabledMods = sortByNameAndLoadOrder(enabledMods).toReversed();
    const vanilla = await buildAncillariesVanillaSource(dataFolder);
    const modSources = await buildAncillariesModSources(dataFolder, orderedEnabledMods);

    // Both halves are now current, so their identities are the whole signature. Recomputing it here
    // rather than up front is what lets each half decide independently whether it had to rebuild.
    const signature = createHash("sha256")
      .update(
        JSON.stringify({
          game: appData.currentGame,
          schema: getVisualsSchemaHash(appData.currentGame),
          vanillaRows: Object.fromEntries(
            ANCILLARY_TABLES.map((tableName) => [tableName, vanilla.tables[tableName]?.length ?? 0]),
          ),
          mods: modSources.map(({ packPath, source }) => [
            nodePath.resolve(packPath),
            source.tables.ancillaries_tables?.length ?? 0,
            source.tables.ancillary_to_effects_tables?.length ?? 0,
          ]),
        }),
      )
      .digest("hex");
    if (cachedAncillariesData?.signature === signature) {
      console.log("Ancillaries: using the in-memory cache", { signature });
      return cachedAncillariesData;
    }

    const merged = mergeAncillariesSources(vanilla, modSources);
    const data = buildAncillariesData(
      merged.tables,
      (key) => merged.localizations[key],
      merged.originPackPathByAncillary,
    );
    const icons = await registerAncillaryIcons(
      data,
      dataFolder,
      orderedEnabledMods.map((mod) => mod.path),
    );
    cachedAncillariesData = {
      signature,
      data,
      tables: merged.tables,
      localizations: merged.localizations,
      originPackPathByAncillary: merged.originPackPathByAncillary,
      dbPackPath: nodePath.join(dataFolder, gameToPackWithDBTablesName.wh3),
      ...icons,
    };
    return cachedAncillariesData;
  };

  const ancillariesBuilds = createSerializedBuilds();
  const ensureAncillariesData = async (enabledMods: Mod[]) =>
    ancillariesBuilds.run(buildBuildingsBuildKey(enabledMods, appData.currentGame), () =>
      buildAncillariesSessionData(enabledMods),
    );

  /**
   * The schema each ancillaries table's rows have to be written with.
   *
   * Same choice `getBuildingsTableSchemas` makes: prefer the version the vanilla pack carries, fall
   * back to the newest the schema knows. Writing rows against a different version than the game's
   * own table uses makes the pack unreadable.
   */
  const getAncillariesTableSchemas = async (): Promise<Record<string, DBVersion>> => {
    const defaultTableVersions = await getDefaultTableVersions();
    const schemas: Record<string, DBVersion> = {};
    for (const tableName of ANCILLARY_TABLES) {
      const versions = DBNameToDBVersions[appData.currentGame][tableName];
      if (!versions || versions.length === 0) continue;
      const defaultVersion = defaultTableVersions?.[tableName];
      schemas[tableName] = versions.find((version) => version.version === defaultVersion) || versions[0];
    }
    return schemas;
  };

  /** Fills in the icon URLs the renderer renders; the data itself holds only pack-relative paths. */
  const ancillaryIconUrl = (built: CachedAncillariesData, packedFilePath: string | undefined) => {
    if (!packedFilePath) return undefined;
    const normalized = normalizeAssetPath(packedFilePath);
    return built.icons[normalized] ? iconAssetUrl(built.iconGeneration, normalized) : undefined;
  };

  /** `ui\campaign ui\ancillaries\foo.png` -> `foo`, which is all the icon grid has room for. */
  const ancillaryIconName = (iconPath: string) =>
    (iconPath.split("\\").pop() ?? iconPath).replace(/\.(png|jpg|jpeg|tga|dds)$/i, "");

  const toAncillariesCatalog = (
    built: CachedAncillariesData,
    data: BuiltAncillariesData,
    tableSchemas: Record<string, DBVersion>,
  ): AncillariesCatalog => ({
    categories: data.categories.map((category) => ({
      ...category,
      iconUrl: ancillaryIconUrl(built, category.iconName ? categoryIconPath(category.iconName) : undefined),
    })),
    subcategories: data.subcategories,
    ancillaries: data.ancillaries.map((ancillary) => ({
      ...ancillary,
      iconUrl: ancillaryIconUrl(built, ancillary.iconPath),
    })),
    effects: data.effects.map((effect) => ({
      ...effect,
      iconUrl: ancillaryIconUrl(built, effectIconPath(effect.icon)),
    })),
    effectScopes: data.effectScopes,
    types: data.typeKeys.map((key) => ({
      key,
      localizedName: key,
      iconUrl: ancillaryIconUrl(built, data.typeIcons[key]),
    })),
    // Deduped because most icons are shared by several types, and an icon that failed to load is
    // left out rather than offered as an empty tile.
    icons: [...new Set(Object.values(data.typeIcons))]
      .map((iconPath) => ({
        path: iconPath,
        name: ancillaryIconName(iconPath),
        iconUrl: ancillaryIconUrl(built, iconPath),
      }))
      .filter((icon): icon is { path: string; name: string; iconUrl: string } => icon.iconUrl !== undefined)
      .sort((firstIcon, secondIcon) => collator.compare(firstIcon.name, secondIcon.name)),
    dbPackPath: built.dbPackPath,
    tableSchemas,
    moddersPrefix: appData.moddersPrefix,
    nextNumericIds: data.nextNumericIds,
  });

  /**
   * Rebuilds every structure from the effective rows. Keeping this on the same `buildAncillariesData`
   * path used at initial load means a table cannot be consumed by the view yet forgotten by a
   * separate incremental updater.
   */
  const applyPendingAncillariesRows = (built: CachedAncillariesData, pendingEdits?: AncillariesEditState) => {
    if (!pendingEdits) return built.data;
    const rowsByTable = ancillariesNewRowsByTable(pendingEdits);
    if (Object.keys(rowsByTable).length === 0) return built.data;

    const pendingLoc: Record<string, string> = {};
    for (const row of rowsByTable[ANCILLARIES_LOC_TABLE] ?? []) {
      const key = (row.values.key ?? "").trim();
      if (key) pendingLoc[key] = row.values.text ?? "";
    }
    return applyNewRowsToAncillariesData(built.tables, pendingEdits, (tables) =>
      buildAncillariesData(
        tables,
        (key) => (Object.prototype.hasOwnProperty.call(pendingLoc, key) ? pendingLoc[key] : built.localizations[key]),
        built.originPackPathByAncillary,
      ),
    );
  };

  /** Marks the effect rows that came from pending edits, which are the only removable ones. */
  const markPendingEffects = (
    effects: AncillaryEffectRow[],
    pendingEdits: AncillariesEditState | undefined,
  ): AncillaryEffectRow[] => {
    if (!pendingEdits) return effects;
    const pendingByPair = new Map<string, string>();
    for (const row of ancillariesNewRowsByTable(pendingEdits).ancillary_to_effects_tables ?? []) {
      pendingByPair.set(`${row.values.ancillary ?? ""}|${row.values.effect ?? ""}`, row.id);
    }
    return effects.map((effect) => {
      const pendingRowId = pendingByPair.get(`${effect.ancillary}|${effect.effectKey}`);
      return pendingRowId ? { ...effect, isPending: true, pendingRowId } : effect;
    });
  };

  const toAncillaryDetail = (
    built: CachedAncillariesData,
    data: BuiltAncillariesData,
    key: string,
    pendingEdits?: AncillariesEditState,
  ): AncillaryDetail | undefined => {
    const summary = data.ancillaries.find((ancillary) => ancillary.key === key);
    if (!summary) return undefined;
    const getLoc = (locKey: string) => built.localizations[locKey];
    const category = data.categories.find((row) => row.key === summary.category);
    const subcategory = data.subcategories.find((row) => row.key === summary.subcategory);
    return {
      ...summary,
      iconUrl: ancillaryIconUrl(built, summary.iconPath),
      explanation: getLoc(`ancillaries_explanation_text_${key}`),
      colourText: getLoc(`ancillaries_colour_text_${key}`),
      categoryName: category?.localizedName || summary.category,
      subcategoryName: subcategory?.localizedName,
      effects: markPendingEffects(data.effectsByAncillary[key] ?? [], pendingEdits).map((effect) => ({
        ...effect,
        iconUrl: ancillaryIconUrl(built, effectIconPath(effect.icon)),
      })),
      rowValues: data.rowValuesByKey[key] ?? {},
      hasInfoRow: data.infoKeys.includes(key),
    };
  };

  ipcMain.handle("getAncillariesCatalog", async (_event, enabledMods: Mod[]): Promise<AncillariesCatalogResponse> => {
    try {
      const built = await ensureAncillariesData(enabledMods);
      return { success: true, catalog: toAncillariesCatalog(built, built.data, await getAncillariesTableSchemas()) };
    } catch (error) {
      console.log("getAncillariesCatalog failed:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    "getAncillariesDetail",
    async (
      _event,
      enabledMods: Mod[],
      key: string,
      pendingEdits?: AncillariesEditState,
    ): Promise<AncillariesDetailResponse> => {
      try {
        const built = await ensureAncillariesData(enabledMods);
        const data = applyPendingAncillariesRows(built, pendingEdits);
        // Validated against the base data, not `data`: every pending row exists in the latter by
        // construction, so an override would look like a perfectly ordinary ancillary.
        const rowIssues = pendingEdits ? validateAncillariesNewRows(built.data, pendingEdits) : undefined;
        return {
          success: true,
          detail: toAncillaryDetail(built, data, key, pendingEdits),
          catalog: toAncillariesCatalog(built, data, await getAncillariesTableSchemas()),
          rowIssues,
        };
      } catch (error) {
        console.log("getAncillariesDetail failed:", error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  const setCurrentGame = async (newGame: SupportedGames): Promise<boolean> => {
    let didSwitchGame = false;
    try {
      // Readers hold an open handle and only check the pack and schema when they open, so drop them
      // here: coming back to this game later should revalidate rather than serve what was true before.
      closeVanillaDbCacheReaders();
      // Every registered icon belongs to the game being left, and the features that registered them
      // register again when they rebuild for the new one.
      clearIconAssets();
      // The buildings data is cached under a signature that includes the game, so coming back here
      // would otherwise serve icon URLs built with a generation clearIconAssets has just dropped.
      console.log("Buildings cache: clearing in-memory cache because the game/folders changed", { game: newGame });
      cachedBuildingsData = undefined;
      // Same reasoning for Ancillaries: its icon URLs carry a generation clearIconAssets just
      // dropped, and its vanilla half is keyed on the game being left.
      cachedAncillariesData = undefined;
      cachedEsfMapData = undefined;
      clearEsfMapMemoryCache();
      clearBuildingsMemoryCache();
      clearAncillariesMemoryCache();
      if (!appData.gamesToGameFolderPaths[newGame]) {
        await getFolderPaths(log, newGame);
      }
      const dataFolder = appData.gamesToGameFolderPaths[newGame].dataFolder;
      const contentFolder = appData.gamesToGameFolderPaths[newGame].contentFolder;
      const gamePath = appData.gamesToGameFolderPaths[newGame].gamePath;
      if (!gamePath || !contentFolder || !dataFolder) {
        await getFolderPaths(log, newGame);
        if (appData.gamesToGameFolderPaths[newGame].contentFolder) {
          appData.packsData = [];
          appData.saveSetupDone = false;
          console.log("Setting current game 1");
          appData.currentGame = newGame;
          initializeAllSchemaForGame(newGame);
          await getAllMods();
        }
      }
    } finally {
      let contentFolder = "",
        gamePath = "";
      if (appData.gamesToGameFolderPaths[newGame].contentFolder) {
        contentFolder = appData.gamesToGameFolderPaths[newGame].contentFolder ?? "";
        gamePath = appData.gamesToGameFolderPaths[newGame].gamePath ?? "";
        console.log("Setting current game 2");
        appData.currentGame = newGame;
        initializeAllSchemaForGame(newGame);
        await getAllMods();
        console.log("SENDING setAppFolderPaths", gamePath, contentFolder);
        // mainWindow?.webContents.send("setCurrentGameNaive", newGame);
        mainWindow?.webContents.send("setAppFolderPaths", {
          ...appData.gamesToGameFolderPaths[newGame],
          gamePath: gamePath || "",
          contentFolder: contentFolder || "",
        } as GameFolderPaths);
        didSwitchGame = true;
      } else {
        mainWindow?.webContents.send("requestGameFolderPaths", newGame);
      }
    }
    return didSwitchGame;
  };
  const refreshModsIfFoldersValid = async (requestedGame: SupportedGames | undefined) => {
    const game = requestedGame || appData.currentGame;
    // const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    // const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder;
    // const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    // if (contentFolder && gamePath && dataFolder) {
    //   console.log(contentFolder, gamePath, dataFolder);
    //   getAllMods();
    // }
    const didSwitchGame = await setCurrentGame(game);
    if (!didSwitchGame) return;
    const gameConfig = appData.gameToConfig[game];
    mainWindow?.webContents.send(
      "setCurrentGame",
      game,
      gameConfig.currentPreset,
      gameConfig.presets,
      gameConfig.modUserData,
    );
  };
  const setLastGameUpdateTimeUsingAppManifest = async () => {
    try {
      const timeOfLastGameUpdate = await getLastUpdated();
      if (timeOfLastGameUpdate) {
        mainWindow?.webContents.send("setDataModLastChangedLocal", parseInt(timeOfLastGameUpdate) * 1000);
      }
    } catch (e) {
      console.log(e);
    }
  };
  const fetchGameUpdates = async () => {
    try {
      if (appData.currentGame != "wh3") return await setLastGameUpdateTimeUsingAppManifest();
      const res = await fetch(
        `https://raw.githubusercontent.com/Shazbot/WH3-Mod-Manager/tw_updates/tw_updates/wh3.json`,
      );
      // eslint-disable-next-line prefer-const
      let gameUpdates = (await res.json()) as GameUpdateData[];
      // if (isDev) {
      //   gameUpdates = JSON.parse(fsdumb.readFileSync("./test/wh3.json", "utf-8")) as GameUpdateData[];
      // }
      appData.gameUpdates = gameUpdates;
      console.log("gameUpdates", gameUpdates);
      gameUpdates.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
      if (gameUpdates[0]) {
        mainWindow?.webContents.send("setDataModLastChangedLocal", parseInt(gameUpdates[0].timestamp) * 1000);
      }
    } catch (e) {
      console.log(e);
    }
  };
  const removeMod = async (mainWindow: BrowserWindow, modPath: string) => {
    mainWindow?.webContents.send("removeMod", modPath);
  };
  const isPathInsideFolder = (filePath: string, folderPath: string) => {
    const relativePath = nodePath.relative(folderPath, filePath);
    return relativePath !== "" && !relativePath.startsWith("..") && !nodePath.isAbsolute(relativePath);
  };
  const getMod = async (mainWindow: BrowserWindow, modPath: string) => {
    let mod: Mod | undefined;
    try {
      const gameFolderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
      const customFolder = (gameFolderPaths.customModFolders || []).find((folder) =>
        isPathInsideFolder(modPath, folder.path),
      );
      if (gameFolderPaths.dataFolder && isPathInsideFolder(modPath, gameFolderPaths.dataFolder)) {
        mod = await getDataMod(modPath, log);
      } else if (customFolder) {
        mod = await getCustomMod(modPath, customFolder.id, log);
      } else if (gameFolderPaths.contentFolder && isPathInsideFolder(modPath, gameFolderPaths.contentFolder)) {
        const modSubfolderName = nodePath.basename(nodePath.dirname(modPath));
        console.log("looking for ", modSubfolderName);
        mod = await getContentModInFolder(modSubfolderName, log);
      } else {
        console.log("looking for DATA MOD: ", modPath);
        mod = await getDataMod(modPath, log);
      }
    } catch (e) {
      console.log(e);
    }
    return mod;
  };
  const removePackFromCollisions = (packPath: string) => {
    if (appData.compatData) {
      appData.compatData.packTableCollisions = removeFromPackTableCollisions(
        appData.compatData.packTableCollisions,
        nodePath.basename(packPath),
      );
      appData.compatData.packFileCollisions = removeFromPackFileCollisions(
        appData.compatData.packFileCollisions,
        nodePath.basename(packPath),
      );
    }
  };
  const onNewPackFound = async (path: string, fromWatcher = false) => {
    if (!mainWindow) return;
    mainWindow.webContents.send("handleLog", "MOD ADDED: " + path);
    console.log("MOD ADDED: " + path);
    const mod = await getMod(mainWindow, path);
    if (mod) {
      try {
        const packHeaderData = await readPackHeaderCached(mod.path);
        mod.isMovie = packHeaderData.isMovie;
        mod.hasStartpos = packHeaderData.hasStartpos;
        mod.dependencyPacks = packHeaderData.dependencyPacks;
        await savePackHeaderCache();
      } catch (error) {
        if (error instanceof Error) log(error.message);
      }
      mainWindow?.webContents.send("addMod", mod);
      // we get onNewPackFound called by the data watcher if it's a symlink on app launch, ignore that case
      if (!fromWatcher || !mod.isSymbolicLink) {
        mainWindow?.webContents.send("addToast", {
          type: "success",
          messages: ["loc:addedMod", mod.name],
          startTime: Date.now(),
        } as Toast);
      }
      if (appData.modsToResubscribeTo.some((iterMod) => iterMod.name == mod.name)) {
        appData.modsToResubscribeTo = appData.modsToResubscribeTo.filter((iterMod) => iterMod.name != mod.name);
        if (appData.modsToResubscribeTo.length > 0) {
          forceResubscribeMods(appData.modsToResubscribeTo);
        }
      }
    }
  };
  const onPackDeleted = async (path: string, isDeletedFromContent = false) => {
    if (!mainWindow) return;
    mainWindow.webContents.send("handleLog", "MOD REMOVED: " + path);
    console.log("MOD REMOVED: " + path);
    await removeMod(mainWindow, path);
    if (appData.packsData && appData.packsData.some((pack) => pack.path == path)) {
      appData.packsData = appData.packsData.filter((pack) => pack.path != path);
    }
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (isDeletedFromContent && dataFolder) {
      try {
        const potentialSymlinkDataPath = nodePath.join(dataFolder, nodePath.basename(path));
        await fs.readlinkSync(potentialSymlinkDataPath);
        await fs.unlinkSync(potentialSymlinkDataPath);
        await removeMod(mainWindow, path);
      } catch (e) {
        console.log("deleted content pack doesn't have a symbolic link in data");
        console.log(e);
      }
    }
    removePackFromCollisions(path);
  };
  const matchTableNamePart = /^db\\(.*?)\\data__/;
  const getAllMods = async (afterModsPopulated?: () => void | Promise<void>) => {
    const timeStartedFetchingSubbedIds = Date.now();
    try {
      appData.subscribedModIds = [];
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "getSubscribedIds"],
        {},
      );
      child.on("message", (workshopIds: string[]) => {
        appData.subscribedModIds = workshopIds;
        console.log("getSubscribedIds returned:", workshopIds);
      });
    } catch (e) {
      console.log(e);
    }
    try {
      let mods = await getMods(log);
      while (Date.now() - timeStartedFetchingSubbedIds < 5000 && appData.subscribedModIds.length == 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log("before subscription filter:", mods.length);
      // for (const mod of mods) {
      //   if (!mod.isInData && !appData.subscribedModIds.includes(mod.workshopId)) console.log(mod.workshopId);
      // }
      if (appData.subscribedModIds.length != 0) {
        mods = mods.filter((mod) => !isWorkshopMod(mod) || appData.subscribedModIds.includes(mod.workshopId));
      }
      console.log("after subscription filter:", mods.length);
      mainWindow?.webContents.send("modsPopulated", mods);
      await afterModsPopulated?.();
      const packHeadersToSend: PackHeaderData[] = [];
      await Promise.all(
        mods.map(async (mod) => {
          try {
            if (mod == null || mod.path == null) {
              console.error("MOD OR MOD PATH IS NULL");
              return;
            }
            const packHeaderData = await readPackHeaderCached(mod.path);
            if (packHeaderData.isMovie || packHeaderData.hasStartpos || packHeaderData.dependencyPacks.length > 0)
              packHeadersToSend.push(packHeaderData);
          } catch (e) {
            if (e instanceof Error) {
              log(e.message);
            }
          }
        }),
      );
      mainWindow?.webContents.send("setPackHeaderData", packHeadersToSend);
      await savePackHeaderCache();
      if (!appData.saveSetupDone) {
        appData.saveSetupDone = true;
        getSaveFiles()
          .then(async (saves) => {
            await setupSavesWatcher((saves) => mainWindow?.webContents.send("savesPopulated", saves));
            mainWindow?.webContents.send("savesPopulated", saves);
          })
          .catch();
      }
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (dataFolder) {
        for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
          const baseVanillaPackName = vanillaPackData.name;
          const dataPackPath = nodePath.join(dataFolder, baseVanillaPackName);
          const dataMod: Mod = {
            humanName: "",
            name: baseVanillaPackName,
            path: dataPackPath,
            imgPath: "",
            workshopId: "",
            isEnabled: true,
            modDirectory: `${dataFolder}`,
            isInData: true,
            lastChanged: undefined,
            loadOrder: undefined,
            author: "",
            isDeleted: false,
            isMovie: false,
            size: 0,
            isSymbolicLink: false,
            tags: ["mod"],
          };
          if (appData.packsData.every((iterPack) => iterPack.path != dataPackPath)) {
            const vanillaCache = await loadVanillaPackFilesCache();
            let vanillaStat: { size: number; mtimeMs: number } | null = null;
            try {
              vanillaStat = await fs.promises.stat(dataPackPath);
            } catch {
              // pack doesn't exist, skip
            }
            const cacheEntry = vanillaStat && vanillaCache[dataPackPath];
            const cacheHit =
              cacheEntry &&
              cacheEntry.size === vanillaStat!.size &&
              cacheEntry.lastChangedLocal === vanillaStat!.mtimeMs;
            let packedFileNames: string[];
            if (cacheHit) {
              console.log("VANILLA PACK CACHE HIT:", dataPackPath);
              packedFileNames = cacheEntry.packedFileNames;
            } else {
              console.log("READING DATA PACK");
              const dataPackData = await readPackWhileRegistered(dataMod.path, {
                skipParsingTables: true,
              });
              if (dataPackData) {
                appData.vanillaPacks.push(dataPackData);
                if (appData.packsData.every((iterPack) => iterPack.path != dataPackData.path)) {
                  appendPacksData(dataPackData);
                }
                packedFileNames = dataPackData.packedFiles.map((pf) => pf.name);
                if (vanillaStat) {
                  vanillaCache[dataPackPath] = {
                    size: vanillaStat.size,
                    lastChangedLocal: vanillaStat.mtimeMs,
                    packedFileNames,
                  };
                  await saveVanillaPackFilesCache();
                }
              } else {
                packedFileNames = [];
              }
            }
            if (cacheHit) {
              // Reconstruct a minimal Pack for vanillaPacks and appendPacksData from cached file names
              const reconstructedPack: Pack = {
                name: baseVanillaPackName,
                path: dataPackPath,
                packedFiles: packedFileNames.map((name) => ({ name, file_size: 0, start_pos: 0 })),
                packHeader: {} as PackHeader,
                lastChangedLocal: vanillaStat!.mtimeMs,
                size: vanillaStat!.size,
                readTables: [],
              };
              appData.vanillaPacks.push(reconstructedPack);
              if (appData.packsData.every((iterPack) => iterPack.path != dataPackPath)) {
                appendPacksData(reconstructedPack);
              }
            }
            const vanillaDBFileNames = packedFileNames
              .map((name) => name.match(matchTableNamePart))
              .filter((matchResult) => matchResult)
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              .map((matchResult) => matchResult![1]);
            if (vanillaDBFileNames.length > 0) {
              appData.vanillaPacksDBFileNames = Array.from(
                new Set([...appData.vanillaPacksDBFileNames, ...vanillaDBFileNames]).values(),
              );
            }
          }
        }
        appData.vanillaPacksDBFileNames.sort((a, b) => collator.compare(a, b));
        await fetchGameUpdates();
      }
      try {
        const workshopUpdateChild = fork(
          nodePath.join(__dirname, "sub.js"),
          [
            gameToSteamId[appData.currentGame],
            "checkState",
            mods
              .filter(
                (mod) => isWorkshopMod(mod) && !isNaN(Number(mod.workshopId)) && !isNaN(parseFloat(mod.workshopId)),
              )
              .map((mod) => mod.workshopId)
              .join(";"),
          ],
          {},
        );
        let receivedWorkshopUpdateResult = false;
        workshopUpdateChild.on("message", (message: WorkshopUpdateCheckMessage) => {
          mainWindow.webContents.send("workshopUpdateCheck", message);
          if (message.type === "started") return;
          if (message.type === "progress") return;

          receivedWorkshopUpdateResult = true;
          if (message.items.length === 0) return;

          for (const item of message.items) {
            const mod = mods.find((iterMod) => isWorkshopMod(iterMod) && iterMod.workshopId === item.workshopId);
            const progress =
              item.downloadedBytes == null ? "unavailable" : `${item.downloadedBytes}/${item.totalBytes ?? "unknown"}`;
            log(
              `[Workshop update check] mod=${mod?.humanName || mod?.name || "unknown"}` +
                ` id=${item.workshopId}` +
                ` status=${item.status}` +
                ` initialState=${item.initialState}` +
                ` finalState=${item.finalState}` +
                ` requestAccepted=${item.requestAccepted}` +
                ` retryAccepted=${item.retryAccepted ?? "not-needed"}` +
                ` installTimestampBefore=${item.installTimestampBefore ?? "unavailable"}` +
                ` installTimestampAfter=${item.installTimestampAfter ?? "unavailable"}` +
                ` progress=${progress}` +
                (item.error ? ` error=${item.error}` : ""),
            );
          }
        });
        workshopUpdateChild.once("error", (error) => {
          log(`[Workshop update check] child process error: ${error.message}`);
        });
        workshopUpdateChild.once("exit", (code, signal) => {
          if (!receivedWorkshopUpdateResult) {
            log(`[Workshop update check] child exited without a final result (code=${code}, signal=${signal})`);
          }
        });
      } catch (e) {
        console.log(e);
      }
    } catch (err) {
      console.log(err);
    }
    await contentWatcher?.close();
    contentWatcher = undefined;
    await dataWatcher?.close();
    dataWatcher = undefined;
    await downloadsWatcher?.close();
    downloadsWatcher = undefined;
    await mergedWatcher?.close();
    mergedWatcher = undefined;
    await customModFoldersWatcher?.close();
    customModFoldersWatcher = undefined;
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder;
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    if (!contentFolder || !dataFolder || !gamePath) return;
    if (!contentWatcher) {
      const sanitizedContentFolder = contentFolder.replaceAll("\\", "/").replaceAll("//", "/");
      console.log("content folder:", contentFolder);
      contentWatcher = chokidar
        .watch(`${sanitizedContentFolder}/**/*.pack`, {
          ignoreInitial: true,
          ignored: /whmm_backups/,
          awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
          },
        })
        .on("add", async (path) => {
          console.log("NEW CONTENT ADD", path);
          onNewPackFound(path);
        })
        .on("unlink", async (path) => {
          console.log("NEW CONTENT UNLINK", path);
          onPackDeleted(path, true);
        })
        .on("change", async (path) => {
          console.log("NEW CONTENT CHANGE", path);
          onPackDeleted(path);
          onNewPackFound(path);
        });
    }
    if (!downloadsWatcher) {
      const downloadsFolder = contentFolder
        .replaceAll("\\", "/")
        .replaceAll("//", "/")
        .replace("/content/", "/downloads/");
      console.log("downloads folder:", downloadsFolder);
      downloadsWatcher = chokidar
        .watch(`${downloadsFolder}/**/*.pack`, {
          ignoreInitial: true,
          awaitWriteFinish: true,
          ignored: /whmm_backups/,
        })
        .on("add", async (path) => {
          console.log("NEW DOWNLOADS ADD", path);
          fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "justRun"], {});
        })
        .on("unlink", async (path) => {
          console.log("NEW DOWNLOADS UNLINK", path);
        });
    }
    if (!dataWatcher) {
      const sanitizedDataFolder = dataFolder.replaceAll("\\", "/").replaceAll("//", "/");
      dataWatcher = chokidar
        .watch([`${sanitizedDataFolder}/*.pack`, `${sanitizedDataFolder}/modding/*.pack`], {
          ignoreInitial: true,
          awaitWriteFinish: true,
          followSymlinks: false,
          ignored: /whmm_backups/,
        })
        .on("add", async (path) => {
          console.log("dataWatcher add:", path);
          onNewPackFound(path, true);
        })
        .on("unlink", async (path) => {
          onPackDeleted(path);
        })
        .on("change", async (path) => {
          console.log("data pack changed:", path);
          onPackDeleted(path);
          console.log("dataWatcher change:", path);
          onNewPackFound(path);
        });
    }
    const customFolders = appData.gamesToGameFolderPaths[appData.currentGame].customModFolders || [];
    const existingCustomFolders = customFolders.filter((folder) => fsExtra.existsSync(folder.path));
    if (!customModFoldersWatcher && existingCustomFolders.length > 0) {
      const customFolderPatterns = existingCustomFolders.flatMap((folder) => {
        const sanitizedFolder = folder.path.replaceAll("\\", "/").replaceAll("//", "/");
        return [`${sanitizedFolder}/*.pack`, `${sanitizedFolder}/*/*.pack`];
      });
      customModFoldersWatcher = chokidar
        .watch(customFolderPatterns, {
          ignoreInitial: true,
          awaitWriteFinish: true,
          followSymlinks: false,
          ignored: /whmm_backups/,
        })
        .on("add", async (path) => onNewPackFound(path, true))
        .on("unlink", async (path) => onPackDeleted(path))
        .on("change", async (path) => {
          await onPackDeleted(path);
          await onNewPackFound(path, true);
        });
    }
    if (!mergedWatcher) {
      const mergedDirPath = nodePath.join(gamePath, "/merged/");
      exec(`mkdir "${mergedDirPath}"`);
      while (!fsExtra.existsSync(mergedDirPath)) {
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      // await fsExtra.ensureDir(nodePath.join(gamePath, "/merged/"));
      const sanitizedGamePath = gamePath.replaceAll("\\", "/").replaceAll("//", "/");
      mergedWatcher = chokidar
        .watch([`${sanitizedGamePath}/merged/*.pack`], {
          ignoreInitial: false,
          awaitWriteFinish: {
            stabilityThreshold: 3000,
            pollInterval: 100,
          },
          ignored: /whmm_backups/,
          usePolling: true,
        })
        .on("add", async (path) => {
          onNewPackFound(path);
        })
        .on("unlink", async (path) => {
          onPackDeleted(path);
        })
        .on("change", async (path) => {
          console.log("pack changed:", path);
          onPackDeleted(path);
          onNewPackFound(path);
        });
    }
  };
  const readConfig = async (): Promise<ConfigForRenderer> => {
    try {
      // readAppConfig has already migrated anything older than the current config version
      const appState = await readAppConfig();
      if (!appData.hasReadConfig) {
        fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "justRun"], {}); // forces steam workshop to download mods
        setStartingConfig(appState);
      }
      appData.gamesToGameFolderPaths = appState.gameFolderPaths;
      for (const game of supportedGames) {
        const folderPaths = appData.gamesToGameFolderPaths[game];
        folderPaths.customModFolders = folderPaths.customModFolders || [];
        folderPaths.modSourceOrder = normalizeModSourceOrder(
          folderPaths,
          appState.isFeaturesForModdersEnabled || false,
        );
      }
      const currentGameFolderPaths = appData.gamesToGameFolderPaths[appState.currentGame];
      if (currentGameFolderPaths.contentFolder && !fs.existsSync(currentGameFolderPaths.contentFolder)) {
        currentGameFolderPaths.contentFolder = "";
      }
      if (currentGameFolderPaths.gamePath && !fs.existsSync(currentGameFolderPaths.gamePath)) {
        currentGameFolderPaths.gamePath = "";
      }

      appData.currentGame = appState.currentGame;
      initializeAllSchemaForGame(appData.currentGame);
      appData.gameToConfig = appState.games;
      appData.isChangingGameProcessPriority = appState.isChangingGameProcessPriority;
      appData.isFeaturesForModdersEnabled = appState.isFeaturesForModdersEnabled || false;
      appData.moddersPrefix = appState.moddersPrefix || "";
      appData.isShowingSkillNodeSetNames = appState.isShowingSkillNodeSetNames ?? appData.isShowingSkillNodeSetNames;
      appData.isShowingHiddenSkills = appState.isShowingHiddenSkills ?? appData.isShowingHiddenSkills;
      appData.isShowingHiddenModifiersInsideSkills =
        appState.isShowingHiddenModifiersInsideSkills ?? appData.isShowingHiddenModifiersInsideSkills;
      appData.isCheckingSkillRequirements = appState.isCheckingSkillRequirements ?? appData.isCheckingSkillRequirements;
      appData.skillTreesDisplayMode = appState.skillTreesDisplayMode ?? appData.skillTreesDisplayMode;
      appData.technologyTreesDisplayMode = appState.technologyTreesDisplayMode ?? appData.technologyTreesDisplayMode;

      // flatten to the single-game view the renderer works with
      const { games, gameFolderPaths, ...options } = appState;
      return {
        ...options,
        ...games[appState.currentGame],
        appFolderPaths: gameFolderPaths[appState.currentGame],
      };
    } finally {
      appData.hasReadConfig = true;
    }
  };
  ipcMain.on("getAllModData", (event, ids: string[]) => {
    // if we keep restarting the app in dev steam refuse requests eventually
    if (isDev) return;
    fetchModData(
      ids.filter((id) => id !== ""),
      (modData) => {
        tempModDatas.push(modData);
        sendModData();
      },
      (msg) => {
        mainWindow?.webContents.send("handleLog", msg);
        console.log(msg);
      },
    );
  });
  // Cache management for getCustomizableMods
  // This cache stores which tables each pack contains to avoid expensive file scanning
  // Cache entries are invalidated when pack size or lastChangedLocal changes
  interface CustomizableModsCacheEntry {
    size: number;
    lastChangedLocal: number;
    customizableTables: string[]; // Tables found in this pack (e.g., ["db\\abilities\\", "whmmflows\\"])
  }
  type CustomizableModsCache = Record<string, CustomizableModsCacheEntry>; // packPath -> cache entry
  const CACHE_FILE_NAME = "customizable-mods-cache.json";
  // In-memory cache - loaded once and kept in memory
  let customizableModsCache: CustomizableModsCache | null = null;
  /**
   * Loads the customizable mods cache from disk into memory (only called once)
   * @returns Cache object, or empty object if cache doesn't exist or is invalid
   */
  const loadCustomizableModsCache = async (): Promise<CustomizableModsCache> => {
    if (customizableModsCache !== null) {
      return customizableModsCache;
    }
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), CACHE_FILE_NAME);
      const data = await fs.promises.readFile(cacheFilePath, "utf8");
      customizableModsCache = JSON.parse(data);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return customizableModsCache!;
    } catch (err) {
      // Cache file doesn't exist or is invalid, return empty cache
      customizableModsCache = {};
      return customizableModsCache;
    }
  };
  /**
   * Saves the customizable mods cache to disk
   * @param cache Cache object to save
   */
  const saveCustomizableModsCache = async (cache: CustomizableModsCache): Promise<void> => {
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), CACHE_FILE_NAME);
      await fs.promises.writeFile(cacheFilePath, JSON.stringify(cache, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save customizable mods cache:", err);
    }
  };
  // Cache for cheap pack index metadata keyed by pack path.
  // Entries are invalidated when the file's size or mtime changes
  interface PackHeaderCacheEntry {
    size: number;
    lastChangedLocal: number;
    isMovie: boolean;
    hasStartpos: boolean;
    dependencyPacks: string[];
  }
  type PackHeaderCache = Record<string, PackHeaderCacheEntry>;
  const PACK_HEADER_CACHE_FILE = "pack-headers-cache.bin";
  let packHeaderCache: PackHeaderCache | null = null;
  const loadPackHeaderCache = async (): Promise<PackHeaderCache> => {
    if (packHeaderCache !== null) return packHeaderCache;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), PACK_HEADER_CACHE_FILE);
      const compressed = await fs.promises.readFile(cacheFilePath);
      const json = await zstdDecompress(compressed);
      packHeaderCache = JSON.parse(json.toString("utf8")) as PackHeaderCache;
      return packHeaderCache!;
    } catch {
      packHeaderCache = {};
      return packHeaderCache;
    }
  };
  const savePackHeaderCache = async (): Promise<void> => {
    if (!packHeaderCache) return;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), PACK_HEADER_CACHE_FILE);
      const json = Buffer.from(JSON.stringify(packHeaderCache), "utf8");
      const compressed = await zstdCompress(json, 1);
      await fs.promises.writeFile(cacheFilePath, compressed);
    } catch (err) {
      console.error("Failed to save pack header cache:", err);
    }
  };
  const readPackHeaderCached = async (path: string): Promise<PackHeaderData> => {
    const cache = await loadPackHeaderCache();
    let stat: { size: number; mtimeMs: number } | null = null;
    try {
      stat = await fs.promises.stat(path);
    } catch {
      // file may not exist — readPackHeader will throw properly
    }
    if (stat) {
      const entry = cache[path];
      if (
        entry &&
        entry.size === stat.size &&
        entry.lastChangedLocal === stat.mtimeMs &&
        typeof entry.hasStartpos === "boolean"
      ) {
        return {
          path,
          isMovie: entry.isMovie,
          hasStartpos: entry.hasStartpos,
          dependencyPacks: entry.dependencyPacks,
        };
      }
    }
    const data = await readPackHeader(path, supportsCompression[appData.currentGame]);
    if (stat) {
      cache[path] = {
        size: stat.size,
        lastChangedLocal: stat.mtimeMs,
        isMovie: data.isMovie,
        hasStartpos: data.hasStartpos,
        dependencyPacks: data.dependencyPacks,
      };
    }
    return data;
  };
  interface FlowExecutionCacheEntry {
    signatureHash: string;
    createdAt: number;
    modsWithFlows: Array<{ path: string; name: string }>;
    createdFlowPackFileNames: string[];
    /** Packs a flow wrote a full replacement for, which are left out of the mod list. */
    replacedPackPaths?: string[];
  }
  interface FlowExecutionCache {
    version: number;
    byGame: Partial<Record<SupportedGames, FlowExecutionCacheEntry>>;
  }
  const FLOW_EXECUTION_CACHE_FILE = "flow-execution-cache.bin";
  // 5: replacement outputs retain the source pack name; older cached outputs may use the Save
  // Changes node's configured name instead.
  const FLOW_EXECUTION_CACHE_VERSION = 5;
  let flowExecutionCache: FlowExecutionCache | null = null;
  const loadFlowExecutionCache = async (): Promise<FlowExecutionCache> => {
    if (flowExecutionCache !== null) return flowExecutionCache;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), FLOW_EXECUTION_CACHE_FILE);
      const compressed = await fs.promises.readFile(cacheFilePath);
      const json = await zstdDecompress(compressed);
      const parsed = JSON.parse(json.toString("utf8")) as FlowExecutionCache;
      if (
        parsed &&
        parsed.version === FLOW_EXECUTION_CACHE_VERSION &&
        parsed.byGame &&
        typeof parsed.byGame === "object"
      ) {
        flowExecutionCache = parsed;
      } else {
        flowExecutionCache = { version: FLOW_EXECUTION_CACHE_VERSION, byGame: {} };
      }
      return flowExecutionCache;
    } catch {
      flowExecutionCache = { version: FLOW_EXECUTION_CACHE_VERSION, byGame: {} };
      return flowExecutionCache;
    }
  };
  const saveFlowExecutionCache = async (): Promise<void> => {
    if (!flowExecutionCache) return;
    try {
      const cacheFilePath = nodePath.join(app.getPath("userData"), FLOW_EXECUTION_CACHE_FILE);
      const json = Buffer.from(JSON.stringify(flowExecutionCache), "utf8");
      const compressed = await zstdCompress(json, 1);
      await fs.promises.writeFile(cacheFilePath, compressed);
    } catch (err) {
      console.error("Failed to save flow execution cache:", err);
    }
  };
  const sortKeysDeep = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((entry) => sortKeysDeep(entry));
    if (value && typeof value === "object") {
      const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) =>
        first.localeCompare(second),
      );
      const sortedObject: Record<string, unknown> = {};
      for (const [key, entryValue] of sortedEntries) {
        sortedObject[key] = sortKeysDeep(entryValue);
      }
      return sortedObject;
    }
    return value;
  };
  const getModStatForFlowSignature = async (mod: Mod): Promise<{ size: number; mtimeMs: number } | null> => {
    try {
      const stat = await fs.promises.stat(mod.path);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      console.error(`Failed to stat enabled mod for flow signature: ${mod.path}`, error);
      return null;
    }
  };
  const getPackSignatureCached = async (
    packPath: string,
    cache?: PackHeaderCache,
  ): Promise<{ size: number; mtimeMs: number } | null> => {
    const headerCache = cache || (await loadPackHeaderCache());
    const cachedEntry = headerCache[packPath];
    if (cachedEntry) {
      return { size: cachedEntry.size, mtimeMs: cachedEntry.lastChangedLocal };
    }
    try {
      const stat = await fs.promises.stat(packPath);
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (error) {
      console.error(`Failed to stat pack for signature: ${packPath}`, error);
      return null;
    }
  };
  const getCompatVanillaPackPaths = (dataFolder: string): string[] => {
    return [...appData.allVanillaPackNames]
      .filter(
        (packName) =>
          packName.startsWith("local_en") || (!packName.startsWith("audio_") && !packName.startsWith("local_")),
      )
      .map((packName) => nodePath.join(dataFolder, packName))
      .toSorted((first, second) => first.localeCompare(second));
  };
  const getCompatVanillaTableToPackPaths = (vanillaPackPaths: string[]): Record<string, string[]> => {
    const vanillaPackPathsSet = new Set(vanillaPackPaths);
    const tableToPackPaths: Record<string, string[]> = {};
    for (const pack of appData.vanillaPacks) {
      if (!vanillaPackPathsSet.has(pack.path)) continue;
      for (const packedFile of pack.packedFiles) {
        const tableNameMatch = packedFile.name.match(matchTableNamePart);
        if (!tableNameMatch) continue;
        const tableName = tableNameMatch[1];
        tableToPackPaths[tableName] = tableToPackPaths[tableName] || [];
        if (!tableToPackPaths[tableName].includes(pack.path)) {
          tableToPackPaths[tableName].push(pack.path);
        }
      }
    }
    return tableToPackPaths;
  };
  const collectReferencedVanillaTablesForCompat = (mods: Mod[]): string[] => {
    const tablesAndDBFieldsThatReference = gameToDBFieldsThatReference[appData.currentGame];
    const modPaths = new Set(mods.map((mod) => mod.path));
    const referencedVanillaTables = new Set<string>();
    for (const pack of appData.packsData) {
      if (!modPaths.has(pack.path)) continue;
      for (const packedFile of pack.packedFiles) {
        if (!packedFile.schemaFields) continue;
        const tableNameMatch = packedFile.name.match(matchTableNamePart);
        if (!tableNameMatch) continue;
        const tableName = tableNameMatch[1];
        const dbVersion = getDBVersion(packedFile);
        if (!dbVersion) continue;
        const tableFieldRefs = tablesAndDBFieldsThatReference[tableName];
        if (!tableFieldRefs) continue;
        for (const dbField of dbVersion.fields) {
          const tableRef = tableFieldRefs[dbField.name];
          if (!tableRef) continue;
          const targetDBFileName = tableRef[0];
          if (appData.vanillaPacksDBFileNames.includes(targetDBFileName)) {
            referencedVanillaTables.add(targetDBFileName);
          }
        }
      }
    }
    return [...referencedVanillaTables].toSorted((first, second) => collator.compare(first, second));
  };
  const getLazyCompatVanillaReadPlan = (mods: Mod[], vanillaPackPaths: string[]) => {
    const tableToPackPaths = getCompatVanillaTableToPackPaths(vanillaPackPaths);
    const referencedVanillaTables = collectReferencedVanillaTablesForCompat(mods);
    const packPathsToRead = new Set<string>();
    const tablesToRead: string[] = [];
    for (const tableName of referencedVanillaTables) {
      const packPaths = tableToPackPaths[tableName];
      if (!packPaths || packPaths.length == 0) continue;
      tablesToRead.push(`db\\${tableName}\\`);
      for (const packPath of packPaths) {
        packPathsToRead.add(packPath);
      }
    }
    return {
      packPaths: [...packPathsToRead].toSorted((first, second) => first.localeCompare(second)),
      tablesToRead,
    };
  };
  const COMPAT_CHECK_CACHE_VERSION = 1;
  interface CompatCheckCacheEntry {
    signatureHash: string;
    createdAt: number;
    packCollisions: PackCollisions;
  }
  let compatCheckCache: CompatCheckCacheEntry | null = null;
  const buildCompatCheckSignature = async (mods: Mod[], vanillaPackPaths: string[]): Promise<string | null> => {
    const headerCache = await loadPackHeaderCache();
    const modSignatureData: Array<{
      path: string;
      name: string;
      loadOrder: number | null;
      size: number;
      mtimeMs: number;
    }> = [];
    const modsByPath = [...mods].toSorted((first, second) => first.path.localeCompare(second.path));
    for (const mod of modsByPath) {
      const packSig = await getPackSignatureCached(mod.path, headerCache);
      if (!packSig) return null;
      modSignatureData.push({
        path: mod.path,
        name: mod.name,
        loadOrder: mod.loadOrder ?? null,
        size: packSig.size,
        mtimeMs: packSig.mtimeMs,
      });
    }
    const vanillaSignatureData: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const vanillaPackPath of vanillaPackPaths) {
      const packSig = await getPackSignatureCached(vanillaPackPath, headerCache);
      if (!packSig) continue;
      vanillaSignatureData.push({
        path: vanillaPackPath,
        size: packSig.size,
        mtimeMs: packSig.mtimeMs,
      });
    }
    return hash({
      cacheVersion: COMPAT_CHECK_CACHE_VERSION,
      game: appData.currentGame,
      isCompatCheckingVanillaPacks: appData.isCompatCheckingVanillaPacks,
      mods: modSignatureData,
      vanillaPacks: vanillaSignatureData,
    });
  };
  const pathsMatch = (firstPath: string, secondPath: string) =>
    nodePath.resolve(firstPath) === nodePath.resolve(secondPath);
  const readPackForCompat = async (packPath: string, packReadingOptions: PackReadingOptions, displayName: string) => {
    mainWindow?.webContents.send("setCurrentlyReadingMod", displayName);
    try {
      return await readPackWhileRegistered(packPath, packReadingOptions);
    } finally {
      mainWindow?.webContents.send("setLastModThatWasRead", displayName);
    }
  };
  const replaceRetainedCompatPack = (newPack: Pack, mod?: Mod, isVanilla = false) => {
    const existingIndex = appData.packsData.findIndex((pack) => pathsMatch(pack.path, newPack.path));
    if (existingIndex !== -1) appData.packsData.splice(existingIndex, 1);
    appendPacksData(newPack, mod);

    if (isVanilla) {
      const vanillaIndex = appData.vanillaPacks.findIndex((pack) => pathsMatch(pack.path, newPack.path));
      if (vanillaIndex === -1) appData.vanillaPacks.push(newPack);
      else appData.vanillaPacks.splice(vanillaIndex, 1, newPack);
    }
  };
  const refreshCompatText = async (pack: Pack, displayName: string) => {
    if (!packNeedsCompatTextRefresh(pack)) return 0;
    const textPack = await readPackForCompat(pack.path, { skipParsingTables: true, readScripts: true }, displayName);
    return mergeCompatTextIntoPack(pack, textPack);
  };
  const prepareModsForCompat = async (mods: Mod[]) => {
    let reusedCount = 0;
    let parsedCount = 0;
    let refreshedTextCount = 0;
    for (const mod of mods) {
      const stat = await fs.promises.stat(mod.path);
      const retainedPack = appData.packsData.find((pack) => pathsMatch(pack.path, mod.path));
      if (retainedPack && canReuseParsedPackForCompat(retainedPack, stat)) {
        refreshedTextCount += await refreshCompatText(retainedPack, mod.name);
        reusedCount++;
        continue;
      }

      const parsedPack = await readPackForCompat(mod.path, { skipParsingTables: false, readScripts: true }, mod.name);
      replaceRetainedCompatPack(parsedPack, mod);
      parsedCount++;
    }
    console.log(
      `compat pack preparation: reused ${reusedCount}, parsed ${parsedCount}, refreshed ${refreshedTextCount} text files`,
    );
  };
  const prepareVanillaPacksForCompat = async (vanillaPackPaths: string[]) => {
    let reusedCount = 0;
    let readCount = 0;
    let refreshedTextCount = 0;
    for (const vanillaPackPath of vanillaPackPaths) {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(vanillaPackPath);
      } catch (error) {
        console.error(`Failed to stat vanilla pack for compat check: ${vanillaPackPath}`, error);
        continue;
      }

      const retainedPack = appData.packsData.find((pack) => pathsMatch(pack.path, vanillaPackPath));
      if (retainedPack && canReusePackIndexForCompat(retainedPack, stat)) {
        if (!appData.vanillaPacks.some((pack) => pathsMatch(pack.path, retainedPack.path))) {
          appData.vanillaPacks.push(retainedPack);
        }
        if (appData.isCompatCheckingVanillaPacks) {
          refreshedTextCount += await refreshCompatText(retainedPack, retainedPack.name);
        }
        reusedCount++;
        continue;
      }

      const vanillaPack = await readPackForCompat(
        vanillaPackPath,
        {
          skipParsingTables: true,
          readScripts: appData.isCompatCheckingVanillaPacks,
        },
        nodePath.basename(vanillaPackPath),
      );
      replaceRetainedCompatPack(vanillaPack, undefined, true);
      readCount++;
    }
    console.log(
      `compat vanilla preparation: reused ${reusedCount}, read ${readCount}, refreshed ${refreshedTextCount} text files`,
    );
  };
  const buildFlowExecutionSignature = async (
    sortedEnabledMods: Mod[],
    startGameOptions: StartGameOptions,
    dataFolderPath: string,
  ): Promise<string | null> => {
    const enabledModsSignatureData: Array<{
      path: string;
      name: string;
      loadOrder: number | null;
      size: number;
      mtimeMs: number;
    }> = [];
    for (const mod of sortedEnabledMods) {
      const stat = await getModStatForFlowSignature(mod);
      if (!stat) return null;
      enabledModsSignatureData.push({
        path: mod.path,
        name: mod.name,
        loadOrder: mod.loadOrder ?? null,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
    enabledModsSignatureData.sort((first, second) => first.path.localeCompare(second.path));
    const vanillaPacksSignatureData: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
      const vanillaPackPath = nodePath.join(dataFolderPath, vanillaPackData.name);
      try {
        const stat = await fs.promises.stat(vanillaPackPath);
        vanillaPacksSignatureData.push({ path: vanillaPackPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (error) {
        console.error(`Failed to stat vanilla pack for flow signature: ${vanillaPackPath}`, error);
        return null;
      }
    }
    vanillaPacksSignatureData.sort((first, second) => first.path.localeCompare(second.path));
    const signaturePayload = {
      cacheVersion: FLOW_EXECUTION_CACHE_VERSION,
      game: appData.currentGame,
      gamePath: appData.gamesToGameFolderPaths[appData.currentGame].gamePath || "",
      enabledMods: enabledModsSignatureData,
      vanillaPacks: vanillaPacksSignatureData,
      userFlowOptions: sortKeysDeep(startGameOptions.userFlowOptions ?? {}),
      packDataOverwrites: sortKeysDeep(startGameOptions.packDataOverwrites ?? {}),
    };
    return hash(signaturePayload);
  };
  ipcMain.on(
    "getCustomizableMods",
    async (event, modPaths: string[], tables: string[], customizableModsHash: string) => {
      // Load cache
      const cache = await loadCustomizableModsCache();
      const customizableMods = {} as Record<string, string[]>;
      for (const modPath of modPaths) {
        if (!appData.packMetaData[modPath]) {
          const stats = await fsExtra.stat(modPath);
          appData.packMetaData[modPath] = { size: stats.size, lastChangedLocal: stats.mtimeMs };
        }
      }
      if (modPaths.length == 0) return;
      // console.log("getCustomizableMods:", modPaths);
      modPaths.sort((firstPath, secondPath) => firstPath.localeCompare(secondPath));
      const newPaths = [] as string[];
      if (appData.lastGetCustomizableMods) {
        for (let i = 0, j = 0; i < modPaths.length + appData.lastGetCustomizableMods.length;) {
          if (i == modPaths.length) {
            break;
          }
          if (j == appData.lastGetCustomizableMods.length) {
            newPaths.push(...modPaths.slice(i));
            break;
          }
          const firstMod = modPaths[i];
          const secondMod = appData.lastGetCustomizableMods[j];
          const comparison = firstMod.localeCompare(secondMod);
          // console.log("comparing", firstMod, secondMod, comparison);
          if (comparison == 0) {
            i++;
            j++;
          } else if (comparison < 1) {
            newPaths.push(firstMod);
            i++;
          } else {
            j++;
          }
        }
        // console.log("old getCustomizableMods paths:", modPaths);
        // console.log("new getCustomizableMods paths:", newPaths);
        if (newPaths.length == 0) {
          appData.lastGetCustomizableMods = modPaths;
          return;
        }
      } else {
        newPaths.push(...modPaths);
      }
      const pathToPack = {} as Record<string, Pack>;
      const modPathsFromCache = [] as string[];
      const modPathsRead = [] as string[];
      for (const modPath of modPaths) {
        const cacheEntry = cache[modPath];
        const packMetaData = appData.packMetaData[modPath];
        // console.log(
        //   "COMPARING:",
        //   cacheEntry,
        //   packMetaData,
        //   cacheEntry.size === packMetaData.size &&
        //     cacheEntry.lastChangedLocal === packMetaData.lastChangedLocal
        // );
        if (
          cacheEntry &&
          packMetaData &&
          cacheEntry.size === packMetaData.size &&
          cacheEntry.lastChangedLocal === packMetaData.lastChangedLocal
        ) {
          customizableMods[modPath] = cacheEntry.customizableTables;
          modPathsFromCache.push(modPath);
          continue;
        }
        const pack = appData.packsData.find((pack) => pack.path == modPath);
        if (pack) {
          pathToPack[modPath] = pack;
        } else {
          modPathsRead.push(modPath);
          const pack = await readModsByPath([modPath], { skipParsingTables: true });
          if (pack[0]) pathToPack[modPath] = pack[0];
        }
      }
      console.log("getCustomizableMods modPathsFromCache:", modPathsFromCache);
      console.log("getCustomizableMods modPathsRead:", modPathsRead);
      const newPacks = Object.entries(pathToPack)
        .filter(([path]) => {
          return newPaths.includes(path);
        })
        .map(([, pack]) => pack);
      // const packs = appData.packsData.filter((pack) => newPaths.includes(pack.path));
      // if (newPacks.length != newPaths.length) {
      //   console.log("Some of the mods not yet read for getCustomizableMods.");
      //   console.log("newPacks:", newPacks);
      //   console.log("newPaths:", newPaths);
      //   return;
      // }
      const pathsWithPackedFiles = [];
      for (const path of modPaths) {
        const pack = pathToPack[path];
        if (pack && pack.packedFiles.length > 0) pathsWithPackedFiles.push(path);
      }
      appData.lastGetCustomizableMods = pathsWithPackedFiles;
      const tablesForMatching = tables.map((table) => `db\\${table}\\`);
      tablesForMatching.push("whmmflows\\");
      let cacheModified = false;
      for (const currentPack of newPacks) {
        const cacheEntry = cache[currentPack.path];
        let foundTables: string[] | undefined;
        // Check if cache is valid for this pack
        if (
          cacheEntry &&
          cacheEntry.size === currentPack.size &&
          cacheEntry.lastChangedLocal === currentPack.lastChangedLocal
        ) {
          // Use cached result
          foundTables = cacheEntry.customizableTables;
        } else {
          // Calculate and update cache
          foundTables = tablesForMatching.filter((tableForMatching) =>
            currentPack.packedFiles.some((packedFile) => packedFile.name.startsWith(tableForMatching)),
          );
          cache[currentPack.path] = {
            size: currentPack.size,
            lastChangedLocal: currentPack.lastChangedLocal,
            customizableTables: foundTables,
          };
          cacheModified = true;
        }
        if (foundTables.length > 0) {
          customizableMods[currentPack.path] = foundTables;
        }
      }
      // Save cache if modified
      if (cacheModified) {
        await saveCustomizableModsCache(cache);
      }
      for (const [packPath, tables] of Object.entries(customizableMods)) {
        appData.customizableMods[packPath] = tables;
      }
      if (hash(appData.customizableMods) == customizableModsHash) {
        console.log("customizableModsHash is the same as customizableMods, don't send it");
      } else {
        mainWindow?.webContents.send("setCustomizableMods", appData.customizableMods);
      }
    },
  );
  ipcMain.on("getPacksInSave", async (event, saveName: string) => {
    mainWindow?.webContents.send("packsInSave", await getPacksInSave(saveName));
  });
  ipcMain.on("requestSaves", async () => {
    mainWindow?.webContents.send("savesPopulated", await getSaveFiles());
  });
  ipcMain.handle("getListOfPacksInSave", async (event, saveName: string) => {
    return getPacksInSave(saveName);
  });
  ipcMain.handle("getPackFilesList", async (event, packPath: string) => {
    try {
      const pack = await readPack(packPath, { skipParsingTables: true });
      return pack.packedFiles.map((pf) => pf.name);
    } catch (error) {
      console.error("Failed to get pack files list:", error);
      throw error;
    }
  });
  ipcMain.handle(
    "renamePackedFiles",
    async (
      event,
      packPath: string,
      searchRegex: string,
      replaceText: string,
      useRegex: boolean,
      isDev?: boolean,
      pathFilter?: string,
    ) => {
      try {
        const { renamePackedFilesWithOptions } = await import("./packFileSerializer");
        await renamePackedFilesWithOptions(packPath, searchRegex, replaceText, useRegex, isDev, pathFilter);
      } catch (error) {
        console.error("Failed to rename packed files:", error);
        throw error;
      }
    },
  );
  ipcMain.handle(
    "executeNode",
    async (
      event,
      nodeExecutionRequest: {
        nodeId: string;
        nodeType: string;
        textValue: string;
        inputData: any;
      },
    ): Promise<{ success: boolean; data?: any; error?: string }> => {
      try {
        console.log(`Executing node ${nodeExecutionRequest.nodeId} (${nodeExecutionRequest.nodeType}) in backend`);
        // Import node execution functions
        const { executeNodeAction } = await import("./nodeExecutor");
        const result = await executeNodeAction(nodeExecutionRequest);
        return result;
      } catch (error) {
        console.error("Failed to execute node:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown execution error",
        };
      }
    },
  );
  ipcMain.handle(
    "executeNodeGraph",
    async (
      event,
      graphExecutionRequest: {
        nodes: SerializedNode[];
        connections: SerializedConnection[];
      },
    ): Promise<{
      success: boolean;
      executionResults: Array<[string, { success: boolean; data?: any; error?: string; warnings?: string[] }]>;
      totalExecuted: number;
      successCount: number;
      failureCount: number;
      error?: string;
    }> => {
      try {
        console.log(
          `Executing node graph with ${graphExecutionRequest.nodes.length} nodes and ${graphExecutionRequest.connections.length} connections`,
        );
        // Debug: Check generaterows nodes in the IPC request
        graphExecutionRequest.nodes.forEach((node) => {
          if (node.type === "generaterows") {
            console.log(`[IPC-RECEIVED] GenerateRows node ${node.id}:`);
            console.log(`  transformationsLength: ${((node.data as any).transformations || []).length}`);
            console.log(`  transformations:`, JSON.stringify((node.data as any).transformations));
            console.log(`  outputTablesLength: ${((node.data as any).outputTables || []).length}`);
            console.log(`  outputTables:`, JSON.stringify((node.data as any).outputTables));
            console.log(`  has DBNameToDBVersions: ${!!(node.data as any).DBNameToDBVersions}`);
          }
        });
        console.log("graphExecutionRequest summary:", {
          nodeCount: graphExecutionRequest.nodes.length,
          connectionCount: graphExecutionRequest.connections.length,
          nodeTypes: graphExecutionRequest.nodes.map((n) => ({ id: n.id, type: n.type })),
        });
        // Import graph execution function
        const { executeNodeGraph } = await import("./nodeGraphExecutor");
        const result = await executeNodeGraph(graphExecutionRequest);
        // Convert Map to Array for serialization
        const serializedExecutionResults = Array.from(result.executionResults.entries());
        return {
          ...result,
          executionResults: serializedExecutionResults,
        };
      } catch (error) {
        console.error("Failed to execute node graph:", error);
        return {
          success: false,
          executionResults: [],
          totalExecuted: 0,
          successCount: 0,
          failureCount: 0,
          error: error instanceof Error ? error.message : "Unknown graph execution error",
        };
      }
    },
  );
  ipcMain.handle("saveNodeFlow", async (event, flowName: string, flowData: string, packPath: string) => {
    try {
      console.log("saveNodeFlow:", flowName);
      let unsavedFiles = appData.unsavedPacksData[packPath];
      if (!unsavedFiles) {
        unsavedFiles = [];
        appData.unsavedPacksData[packPath] = unsavedFiles;
      }
      if (!flowName.startsWith("whmmflows\\")) flowName = `whmmflows\\${flowName}`;
      const buffer = Buffer.from(flowData);
      const newFile = {
        name: flowName,
        file_size: buffer.length,
        start_pos: -1,
        text: flowData,
      } as PackedFile;
      const existingFileIndex = unsavedFiles.findIndex((file) => file.name == flowName);
      if (existingFileIndex != -1) {
        unsavedFiles.splice(existingFileIndex, 1, newFile);
      } else {
        unsavedFiles.push(newFile);
      }
      mainWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);
      return { success: true, filePath: flowName };
    } catch (error) {
      console.error("Error saving node flow:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save flow",
      };
    }
  });
  ipcMain.handle("saveDBTableEdits", async (event, packPath: string, packedFile: PackedFile) => {
    try {
      if (!packedFile.schemaFields || !packedFile.tableSchema) {
        return {
          success: false,
          error: `Cannot save DB table "${packedFile.name}" without schema fields and table schema`,
        };
      }

      let unsavedFiles = appData.unsavedPacksData[packPath];
      if (!unsavedFiles) {
        unsavedFiles = [];
        appData.unsavedPacksData[packPath] = unsavedFiles;
      }

      const buffer = serializePackFileDataToBuffer({
        name: packedFile.name,
        schemaFields: packedFile.schemaFields,
        tableSchema: packedFile.tableSchema,
        version: packedFile.version,
      });

      const nextUnsavedFile = {
        ...packedFile,
        buffer,
        file_size: buffer.length,
      } as PackedFile;

      const existingFileIndex = unsavedFiles.findIndex((file) => file.name == packedFile.name);
      if (existingFileIndex != -1) {
        unsavedFiles.splice(existingFileIndex, 1, nextUnsavedFile);
      } else {
        unsavedFiles.push(nextUnsavedFile);
      }

      mainWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);

      return { success: true };
    } catch (error) {
      console.error("Error saving DB table edits:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save DB table edits",
      };
    }
  });
  ipcMain.handle("saveTextPackedFileEdits", async (event, packPath: string, filePath: string, text: string) => {
    try {
      let unsavedFiles = appData.unsavedPacksData[packPath];
      if (!unsavedFiles) {
        unsavedFiles = [];
        appData.unsavedPacksData[packPath] = unsavedFiles;
      }

      const buffer = Buffer.from(text, "utf8");
      const nextUnsavedFile = {
        name: filePath,
        file_size: buffer.length,
        start_pos: -1,
        text,
        buffer,
      } as PackedFile;

      const existingFileIndex = unsavedFiles.findIndex((file) => file.name == filePath);
      if (existingFileIndex != -1) {
        unsavedFiles.splice(existingFileIndex, 1, nextUnsavedFile);
      } else {
        unsavedFiles.push(nextUnsavedFile);
      }

      mainWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, unsavedFiles);

      return { success: true };
    } catch (error) {
      console.error("Error saving text packed file edits:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save text packed file edits",
      };
    }
  });
  /**
   * Drops everything read from a pack file that has just been written over, so the next read sees
   * the new contents instead of the old ones.
   */
  const invalidateCachedPackData = async (packPath: string) => {
    appData.packsData = appData.packsData.filter((packData) => packData.path !== packPath);
    delete appData.packMetaData[packPath];
    if (packHeaderCache) {
      delete packHeaderCache[packPath];
      await savePackHeaderCache();
    }
    if (flowExecutionCache) {
      delete flowExecutionCache.byGame[appData.currentGame];
      await saveFlowExecutionCache();
    }
  };
  ipcMain.handle("savePackWithUnsavedFiles", async (event, packPath: string) => {
    try {
      console.log("savePackWithUnsavedFiles:", packPath);
      // Memory packs must use "Save As" since they don't have a disk location
      if (packPath.startsWith("memory://")) {
        return {
          success: false,
          error: "Memory packs must use 'Save As' to specify a save location",
        };
      }
      const unsavedFiles = appData.unsavedPacksData[packPath];
      if (!unsavedFiles || unsavedFiles.length === 0) {
        return {
          success: false,
          error: "No unsaved files found for this pack",
        };
      }
      // Read the original pack
      const pack = await readPack(packPath, { skipParsingTables: true });
      // Convert unsaved files to format for writePack (similar to DBClone.ts)
      const filesToSave = unsavedFiles.map((file) => {
        const buffer = file.buffer || Buffer.from(file.text || "");
        return {
          name: file.name,
          buffer: buffer,
          file_size: buffer.length,
        };
      });
      // Sort files by name (as done in DBClone.ts)
      const sortedFilesToSave = filesToSave.toSorted((firstPf, secondPf) => {
        return firstPf.name.localeCompare(secondPf.name);
      });
      // Try to replace the existing pack
      let savePath = packPath;
      let replacedOriginal = true;
      try {
        // Write the pack with unsaved files appended/overwritten
        await writePack(sortedFilesToSave, savePath, pack, true);
        console.log(`Pack saved to: ${savePath}`);
      } catch (error) {
        // If we can't overwrite (file in use/locked), save as _modified instead
        if (error instanceof Error && error.message.includes("EPERM")) {
          console.log("Cannot overwrite pack (file in use), saving as _modified instead");
          const packDir = nodePath.dirname(packPath);
          const packName = nodePath.basename(packPath, ".pack");
          savePath = nodePath.join(packDir, `${packName}_modified.pack`);
          replacedOriginal = false;
          await writePack(sortedFilesToSave, savePath, pack, true);
          console.log(`Pack saved to: ${savePath}`);
        } else {
          throw error;
        }
      }
      if (replacedOriginal) {
        await invalidateCachedPackData(savePath);
      }
      // Clear unsaved files for this pack
      delete appData.unsavedPacksData[packPath];
      windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, []);
      return {
        success: true,
        savedPath: savePath,
        warning: !replacedOriginal
          ? "Could not replace original pack (file in use). Saved as _modified.pack instead."
          : undefined,
      };
    } catch (error) {
      console.error("Error saving pack with unsaved files:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save pack",
      };
    }
  });
  ipcMain.handle(
    "savePackAsWithUnsavedFiles",
    async (event, packPath: string, newPackName: string, newPackDirectory: string, overwriteExisting?: boolean) => {
      try {
        console.log("savePackAsWithUnsavedFiles:", packPath, newPackName, newPackDirectory);
        // No unsaved files is not an error: Save As on an untouched pack means "save a copy of it".
        const unsavedFiles = appData.unsavedPacksData[packPath] ?? [];
        const isMemoryPack = packPath.startsWith("memory://");
        // Create new pack path with user-provided name and directory
        const savePath = nodePath.join(newPackDirectory, `${newPackName}.pack`);
        const plan = planSaveAs({
          isMemoryPack,
          unsavedFileCount: unsavedFiles.length,
          targetExists: fsExtra.existsSync(savePath),
          targetIsSourcePack: !isMemoryPack && nodePath.resolve(savePath) === nodePath.resolve(packPath),
          overwriteExisting: !!overwriteExisting,
        });

        if (plan.action === "reject") return { success: false, error: plan.reason };
        if (plan.action === "confirmOverwrite") {
          // Its own outcome rather than a plain error, so the caller can offer to overwrite instead
          // of making the user pick another name. Nothing has been written at this point.
          return {
            success: false,
            alreadyExists: true,
            savedPath: savePath,
            error: `Pack file already exists at: ${savePath}`,
          };
        }
        if (plan.action === "leaveAsIs") {
          return {
            success: true,
            savedPath: savePath,
            warning: "There were no unsaved changes, so the pack was left as it is.",
          };
        }
        if (plan.action === "copyPack") {
          await fsExtra.copy(packPath, savePath, { overwrite: true });
          // A file copy carries the source's last-modified time over on Windows, so a pack saved
          // just now shows up as however old the pack it came from was. The written path gets a
          // current timestamp for free, and mod load order and update checks read this date, so the
          // copy is stamped to match.
          const savedAt = new Date();
          await fsExtra.utimes(savePath, savedAt, savedAt);
          console.log(`Pack copied to: ${savePath}`);
          if (overwriteExisting) await invalidateCachedPackData(savePath);
          return { success: true, savedPath: savePath };
        }

        // For memory packs, don't use fast append mode since there's no source pack to clone
        const pack = isMemoryPack ? undefined : await readPack(packPath, { skipParsingTables: true });
        const useFastAppendMode = !isMemoryPack;
        // Convert unsaved files to format for writePack (similar to DBClone.ts)
        const filesToSave = unsavedFiles.map((file) => {
          const buffer = file.buffer || Buffer.from(file.text || "");
          return {
            name: file.name,
            buffer: buffer,
            file_size: buffer.length,
          };
        });
        // Sort files by name (as done in DBClone.ts)
        const sortedFilesToSave = filesToSave.toSorted((firstPf, secondPf) => {
          return firstPf.name.localeCompare(secondPf.name);
        });
        // Write the pack with unsaved files appended/overwritten (as done in DBClone.ts)
        await writePack(sortedFilesToSave, savePath, pack, useFastAppendMode);
        console.log(`Pack saved to: ${savePath}`);
        // Whatever was read from the pack we just wrote over describes the old file now.
        if (overwriteExisting) await invalidateCachedPackData(savePath);
        // Clear unsaved files for this pack
        delete appData.unsavedPacksData[packPath];
        windows.viewerWindow?.webContents.send("setUnsavedPacksData", packPath, []);
        return { success: true, savedPath: savePath };
      } catch (error) {
        console.error("Error saving pack as with unsaved files:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save pack",
        };
      }
    },
  );
  ipcMain.handle("getVisualsUnitsData", async (event, enabledMods: Mod[]) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (!dataFolder) {
        return { success: false, error: "Data folder is not configured for the current game" };
      }
      const enabledModPaths = enabledMods.map((mod) => mod.path);
      const modPathToLabel = new Map<string, string>();
      for (const mod of enabledMods) {
        const trimmedHumanName = mod.humanName?.trim();
        if (trimmedHumanName) modPathToLabel.set(mod.path, trimmedHumanName);
        else {
          const baseName = nodePath.basename(mod.path);
          modPathToLabel.set(mod.path, baseName.toLowerCase().endsWith(".pack") ? baseName.slice(0, -5) : baseName);
        }
      }
      const tablesToRead = Array.from(
        new Set(
          ["land_units_tables", "unit_variants_tables", "variants_tables"]
            .flatMap((tableName) => resolveTable(tableName))
            .map((tableName) => `db\\${tableName}\\`),
        ),
      );
      const sortedEnabledMods = sortByNameAndLoadOrder(enabledMods);
      const dbPriorityMods = sortedEnabledMods.toReversed();
      const dbPackName = gameToPackWithDBTablesName[appData.currentGame] || "db.pack";
      const dbPackPath = nodePath.join(dataFolder, dbPackName);
      const dataPackPath = nodePath.join(dataFolder, "data.pack");
      const localPackPaths = getVanillaLocalisationPackPaths(dataFolder);
      const visualsCache = await loadVisualsDataCache();
      const schemaHash = getVisualsSchemaHash(appData.currentGame);
      const contributionPaths = Array.from(new Set([dbPackPath, ...enabledModPaths, ...localPackPaths]));
      const identities = new Map<string, VisualsPackCacheIdentity>();
      await Promise.all(
        contributionPaths.map(async (packPath) => {
          const identity = await getVisualsPackIdentity(packPath);
          if (identity) identities.set(packPath, identity);
        }),
      );
      const getCachedContribution = (packPath: string) => {
        const identity = identities.get(packPath);
        return identity ? getCurrentVisualsPackCacheEntry(visualsCache, identity) : undefined;
      };
      const hasCurrentTables = (entry: VisualsPackCacheEntry | undefined) =>
        !!getCurrentVisualsTableContribution(entry, schemaHash);

      const missingDbTables = !hasCurrentTables(getCachedContribution(dbPackPath));
      const missingModContributions = enabledModPaths.filter((packPath) => {
        const entry = getCachedContribution(packPath);
        return !hasCurrentTables(entry) || !entry?.locs;
      });
      const freshlyReadPacks = new Map<string, Pack>();
      const retainFreshPacks = (packs: Pack[]) => {
        for (const pack of packs) freshlyReadPacks.set(pack.path, pack);
      };
      if (missingDbTables) {
        // The same route the Unit Viewer and Buildings take. variants_tables and land_units_tables
        // are among the larger ones the game ships, and this ran a full parse of them out of the
        // pack every time the schema changed or the visuals cache missed; the vanilla db cache hands
        // back the same rows without touching db.pack. Only prefixes it cannot serve are parsed.
        const indexedDbPack = await readPack(dbPackPath, { skipParsingTables: true });
        const { unservedPrefixes } = await fillVanillaTablesFromCache(indexedDbPack, tablesToRead, getDBVersion);
        if (unservedPrefixes.length === 0) {
          indexedDbPack.readTables = [...tablesToRead];
          appendPacksData(indexedDbPack);
          // appendPacksData merges into a pack already held rather than replacing it, so the rows
          // just filled can land on the retained instance instead of this one. Retain whichever of
          // the two ends up in packsData, since that is the one carrying them.
          retainFreshPacks([appData.packsData.find((pack) => pack.path === dbPackPath) ?? indexedDbPack]);
        } else {
          retainFreshPacks(await readModsByPath([dbPackPath], { skipParsingTables: false, tablesToRead }, true));
        }
      }
      if (missingModContributions.length > 0) {
        retainFreshPacks(
          await readModsByPath(
            missingModContributions,
            { skipParsingTables: false, readLocs: true, tablesToRead },
            true,
          ),
        );
      }

      let didChangeVisualsCache = false;
      const fillCachedContribution = (
        packPath: string,
        options: { tables?: boolean; locs?: boolean },
      ): VisualsPackCacheEntry | undefined => {
        const identity = identities.get(packPath);
        if (!identity) return undefined;
        const entry = getOrCreateVisualsPackCacheEntry(visualsCache, identity);
        const pack =
          freshlyReadPacks.get(packPath) || appData.packsData.find((candidate) => candidate.path === packPath);
        if (options.tables && schemaHash && entry.tables?.schemaHash !== schemaHash) {
          if (!pack) return undefined;
          entry.tables = {
            schemaHash,
            contribution: getVisualsTableContribution(pack),
          };
          didChangeVisualsCache = true;
        }
        if (options.locs && !entry.locs) {
          if (!pack) return undefined;
          entry.locs = getVisualsLocContribution(pack);
          didChangeVisualsCache = true;
        }
        return entry;
      };

      const contributionByPath = new Map<string, VisualsPackCacheEntry>();
      const dbContribution = fillCachedContribution(dbPackPath, { tables: true });
      if (!dbContribution?.tables) {
        return { success: false, error: "Failed to build vanilla table data for visuals tab" };
      }
      contributionByPath.set(dbPackPath, dbContribution);
      for (const packPath of enabledModPaths) {
        const contribution = fillCachedContribution(packPath, { tables: true, locs: true });
        if (contribution) contributionByPath.set(packPath, contribution);
      }
      // The game's own locs come from the loc cache, so they are neither materialised into a map
      // here nor persisted per pack in the visuals cache. Its language choice is preserved: the
      // cache folds the same pack list in the same order, so local_en still lands last.
      const vanillaLoc = createLocLookup(Object.values(await getVanillaLocLookup(localPackPaths)));

      const tablePathsInMergeOrder = [dbPackPath, ...dbPriorityMods.map((mod) => mod.path)];
      const toTableContributions = (packPaths: string[]) =>
        packPaths.flatMap((packPath) => {
          const contribution = contributionByPath.get(packPath)?.tables?.contribution;
          return contribution ? [{ packPath, contribution }] : [];
        });
      const { variantsByName, unitToVariantRows, landUnitKeys, unitKeyToOriginPackPath } =
        mergeVisualsTableContributions(
          toTableContributions(tablePathsInMergeOrder),
          toTableContributions([...dbPriorityMods.map((mod) => mod.path), dbPackPath]),
        );
      // Mods only. They were merged after the game's locs and so overrode them; checking them
      // first and falling through to the cache keeps that precedence.
      const modLocalizedNames = mergeVisualsLocContributions(
        dbPriorityMods.map((mod) => contributionByPath.get(mod.path)?.locs || []),
      );
      const getLocalizedName = (locId: string) => modLocalizedNames.get(locId) ?? vanillaLoc(locId);
      const resolveVisualsLoc = (locId: string) => {
        const localized = getLocalizedName(locId);
        return resolveTextReplacements(localized, getLocalizedName) || localized;
      };
      const visualsUnits = [] as {
        unitKey: string;
        faction: string;
        localizedName: string;
        variantName?: string;
        variantMeshPath?: string;
        originPackPath: string;
        originLabel: string;
      }[];
      for (const unitKey of landUnitKeys) {
        const rows = unitToVariantRows.get(unitKey);
        const localizedName = resolveVisualsLoc(`land_units_onscreen_name_${unitKey}`) || unitKey;
        const originPackPath = unitKeyToOriginPackPath.get(unitKey) || dbPackPath;
        const originLabel =
          originPackPath === dbPackPath
            ? "Vanilla"
            : modPathToLabel.get(originPackPath) || nodePath.basename(originPackPath);
        if (!rows || rows.length === 0) {
          visualsUnits.push({ unitKey, faction: "", localizedName, originPackPath, originLabel });
          continue;
        }
        for (const row of rows) {
          const variantFilename = row.variantName ? variantsByName.get(row.variantName) : undefined;
          const variantMeshPath =
            variantFilename && variantFilename.trim() !== "" ? toVariantMeshDefinitionPath(variantFilename) : undefined;
          visualsUnits.push({
            unitKey,
            faction: row.faction,
            localizedName,
            variantName: row.variantName || undefined,
            variantMeshPath,
            originPackPath,
            originLabel,
          });
        }
      }
      visualsUnits.sort((first, second) => {
        const nameDiff = collator.compare(first.localizedName, second.localizedName);
        if (nameDiff !== 0) return nameDiff;
        const keyDiff = collator.compare(first.unitKey, second.unitKey);
        if (keyDiff !== 0) return keyDiff;
        return collator.compare(first.faction || "", second.faction || "");
      });
      const vanillaVariantsPackPaths = [...appData.allVanillaPackNames]
        .filter((packName) => packName.toLowerCase().startsWith("variants"))
        .map((packName) => nodePath.join(dataFolder, packName))
        .filter((packPath) => fsExtra.existsSync(packPath))
        .toSorted((first, second) => collator.compare(nodePath.basename(first), nodePath.basename(second)));
      // Keep this in low->high priority order so later packs override earlier ones in search aggregation.
      const fileSearchPackPaths = [
        ...vanillaVariantsPackPaths,
        ...(fsExtra.existsSync(dataPackPath) ? [dataPackPath] : []),
        ...sortedEnabledMods.map((mod) => mod.path),
      ];
      const cachedFileContributions: VisualsFileResult[][] = [];
      let areAllFileContributionsCached = true;
      for (const packPath of fileSearchPackPaths) {
        let identity = identities.get(packPath);
        if (!identity) {
          identity = await getVisualsPackIdentity(packPath);
          if (identity) identities.set(packPath, identity);
        }
        const files = identity ? getCurrentVisualsPackCacheEntry(visualsCache, identity)?.files : undefined;
        if (!files) {
          areAllFileContributionsCached = false;
          break;
        }
        cachedFileContributions.push(files);
      }
      if (didChangeVisualsCache) await saveVisualsDataCache(visualsCache);
      const sessionId = `visuals_${hash({
        game: appData.currentGame,
        language: appData.currentLanguage || "en",
        enabledModPaths: [...enabledModPaths].sort(),
      })}`;
      visualsSessions.set(sessionId, {
        sessionId,
        enabledModPaths,
        dbPriorityPackPaths: [dbPackPath, ...dbPriorityMods.map((mod) => mod.path)],
        fileSearchPackPaths,
        visualFiles: areAllFileContributionsCached ? mergeVisualsFileContributions(cachedFileContributions) : undefined,
        createdAt: Date.now(),
      });
      return {
        success: true,
        sessionId,
        units: visualsUnits,
      };
    } catch (error) {
      console.error("Error building visuals units data:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to build visuals units data",
      };
    }
  });
  ipcMain.handle("readVariantMeshDefinition", async (event, sessionId: string, fileName: string) => {
    try {
      const session = visualsSessions.get(sessionId);
      if (!session) return { success: false, error: "Visuals session expired or missing" };
      const resolved = await resolveVisualsFileInSession(session, fileName, {
        variantMeshDefinitionFallback: true,
      });
      if (!resolved?.requestedPath) return { success: false, error: "Missing variantmeshdefinition path" };
      if (!resolved.pack || !resolved.fileName) {
        return {
          success: false,
          error: `File not found in enabled mods or vanilla visuals packs (variants*.pack/data.pack): ${resolved.requestedPath}`,
        };
      }
      await readFromExistingPack(resolved.pack, {
        filesToRead: [resolved.fileName],
        skipParsingTables: true,
      });
      const refreshedFile = findPackedFileCaseInsensitive(resolved.pack, resolved.fileName);
      if (refreshedFile) {
        const text = decodePackedFileText(refreshedFile);
        if (text == null) {
          return { success: false, error: `Unable to decode ${resolved.fileName}` };
        }
        return {
          success: true,
          text,
          resolved: {
            packPath: resolved.packPath,
            fileName: resolved.fileName,
          },
        };
      }
      return { success: false, error: `File was found but could not be reloaded: ${resolved.fileName}` };
    } catch (error) {
      console.error("Error reading variantmeshdefinition:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read variantmeshdefinition",
      };
    }
  });
  ipcMain.handle("searchVisualsFiles", async (event, sessionId: string, query: string, offset = 0, limit = 200) => {
    try {
      const session = visualsSessions.get(sessionId);
      if (!session) return { success: false, error: "Visuals session expired or missing" };
      const normalizedQuery = normalizePackFilePathKey(query || "");
      const cachedFiles = await getVisualsFilesForSession(session);
      const allResults = normalizedQuery
        ? cachedFiles.filter((file) => normalizePackFilePathKey(file.path).includes(normalizedQuery))
        : cachedFiles;
      const safeOffset = Math.max(0, offset || 0);
      const safeLimit = Math.max(1, Math.min(1000, limit || 200));
      return {
        success: true,
        total: allResults.length,
        results: allResults.slice(safeOffset, safeOffset + safeLimit),
      };
    } catch (error) {
      console.error("Error searching visuals files:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to search visuals files",
      };
    }
  });
  ipcMain.handle(
    "openInAssetEditor",
    async (
      event,
      sessionId: string,
      packInternalPath: string,
      mode: "new" | "existing",
      preferredPackPath?: string,
    ) => {
      try {
        const session = visualsSessions.get(sessionId);
        if (!session) return { success: false, error: "Visuals session expired or missing" };
        if (mode !== "new" && mode !== "existing") {
          return { success: false, error: `Invalid AssetEditor open mode: ${String(mode)}` };
        }
        if (process.platform !== "win32") {
          return { success: false, error: "AssetEditor IPC is supported only on Windows." };
        }
        const resolved = await resolveVisualsFileInSession(session, packInternalPath, {
          variantMeshDefinitionFallback: true,
          preferredPackPath,
        });
        if (!resolved?.requestedPath) return { success: false, error: "Missing file path" };
        if (!resolved.packPath || !resolved.fileName) {
          return {
            success: false,
            error: `File not found in enabled mods or vanilla visuals packs (variants*.pack/data.pack): ${resolved.requestedPath}`,
          };
        }
        const response = await sendAssetEditorOpenRequest({
          path: resolved.fileName,
          packPathOnDisk: resolved.packPath,
          openInExistingKitbashTab: mode === "existing",
        });
        if (!response.ok) {
          return {
            success: false,
            error: response.error || "AssetEditor rejected the open request",
            resolved: {
              packPath: resolved.packPath,
              fileName: resolved.fileName,
            },
            response,
          };
        }
        return {
          success: true,
          resolved: {
            packPath: resolved.packPath,
            fileName: resolved.fileName,
          },
          response,
        };
      } catch (error) {
        console.error("Error sending AssetEditor open request:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to send AssetEditor open request",
        };
      }
    },
  );
  ipcMain.handle("readFileFromPack", async (event, packPath: string, fileName: string) => {
    try {
      console.log("readFileFromPack:", packPath, fileName);
      // Read the pack with the specific file
      const pack = await readPack(packPath, { filesToRead: [fileName] });
      // Find the file
      const file = pack.packedFiles.find((pf) => pf.name === fileName);
      if (!file) {
        return {
          success: false,
          error: `File "${fileName}" not found in pack`,
        };
      }
      const viewerKind = getPackedFileViewerKind(fileName);
      if (!viewerKind) {
        return {
          success: false,
          error: "Unsupported file type",
        };
      }
      if (viewerKind === "image") {
        if (!file.buffer) {
          return {
            success: false,
            error: "Image data is unavailable",
          };
        }
        return {
          success: true,
          base64: file.buffer.toString("base64"),
          mimeType: getPackedFileMimeType(fileName),
        };
      }
      if (file.text != null) {
        return { success: true, text: file.text };
      }
      if (!file.buffer) {
        return {
          success: false,
          error: "File has no readable content",
        };
      }
      return { success: true, text: decodePackedTextBuffer(file.buffer) };
    } catch (error) {
      console.error("Error reading file from pack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to read file from pack",
      };
    }
  });
  ipcMain.handle("getFlowFilesFromPack", async (event, packPath: string) => {
    try {
      console.log("getFlowFilesFromPack:", packPath);
      // Check if there are unsaved flow files for this pack
      const unsavedFiles = appData.unsavedPacksData[packPath] || [];
      const unsavedFlowFiles = unsavedFiles.filter((file) => file.name.startsWith("whmmflows\\"));
      // Read the pack to get flow files
      const pack = await readPack(packPath, { skipParsingTables: true, readFlows: true });
      // Find all flow files in the pack
      const packFlowFiles = pack.packedFiles.filter((pf) => pf.name.startsWith("whmmflows\\"));
      // Combine pack files with unsaved files (unsaved takes priority)
      const flowFiles: { name: string; content: string }[] = [];
      // Add pack flow files
      for (const file of packFlowFiles) {
        // Skip if there's an unsaved version
        if (unsavedFlowFiles.some((uf) => uf.name === file.name)) continue;
        let text: string;
        if (file.text) {
          text = file.text;
        } else if (file.buffer) {
          text = file.buffer.toString("utf-8");
        } else {
          console.log("CANNOT GET TEXT FOR FLOW FILE");
          continue;
        }
        flowFiles.push({ name: file.name, content: text });
      }
      // Add unsaved flow files
      for (const file of unsavedFlowFiles) {
        let text: string;
        if (file.text) {
          text = file.text;
        } else if (file.buffer) {
          text = file.buffer.toString("utf-8");
        } else {
          continue;
        }
        flowFiles.push({ name: file.name, content: text });
      }
      return { success: true, flowFiles };
    } catch (error) {
      console.error("Error getting flow files from pack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get flow files from pack",
      };
    }
  });
  ipcMain.handle("getFlowPackCatalog", async () => {
    const mods = appData.allMods.filter((mod) => !mod.isDeleted && !!mod.path);
    const enabledModPaths = new Set(appData.enabledMods.map((mod) => nodePath.resolve(mod.path)));
    const entries: FlowPackCatalogEntry[] = [];
    const seenPaths = new Set<string>();

    for (const mod of mods) {
      const resolvedPath = nodePath.resolve(mod.path);
      if (seenPaths.has(resolvedPath)) continue;
      seenPaths.add(resolvedPath);

      let hasFlows = appData.unsavedPacksData[mod.path]?.some((file) => file.name.startsWith("whmmflows\\")) ?? false;
      const retainedPack = appData.packsData.find((pack) => nodePath.resolve(pack.path) === resolvedPath);
      if (!hasFlows && retainedPack) {
        hasFlows = retainedPack.packedFiles.some((file) => file.name.startsWith("whmmflows\\"));
      }

      // Only enabled packs need an accurate answer for the promoted group. Other packs stay in the
      // complete list and are inspected when selected, avoiding a header read for every disabled mod.
      const isEnabled = enabledModPaths.size > 0 ? enabledModPaths.has(resolvedPath) : !!mod.isEnabled;
      if (!hasFlows && isEnabled) {
        try {
          const pack = await readPack(mod.path, { skipParsingTables: true });
          hasFlows = pack.packedFiles.some((file) => file.name.startsWith("whmmflows\\"));
        } catch (error) {
          console.error(`Failed to inspect pack for flows: ${mod.path}`, error);
        }
      }

      entries.push({
        path: mod.path,
        name: mod.name,
        humanName: mod.humanName,
        isEnabled,
        hasFlows,
        isInData: mod.isInData,
      });
    }

    return { success: true, packs: orderFlowPackCatalog(entries) };
  });
  ipcMain.handle(
    "saveFlowToPack",
    async (event, packPath: string, flowName: string, flowData: string, overwriteExisting = false) => {
      try {
        if (!packPath) return { success: false, error: "No target pack selected" };
        const normalizedFlowName = normalizePackedFlowName(flowName);
        if (!normalizedFlowName) {
          return { success: false, error: "Enter a valid flow name" };
        }

        const normalizedPackPath = packPath.toLowerCase().endsWith(".pack") ? packPath : `${packPath}.pack`;
        const targetExists = fsExtra.existsSync(normalizedPackPath);
        const existingPack = targetExists ? await readPack(normalizedPackPath, { skipParsingTables: true }) : undefined;
        const unsavedFiles = appData.unsavedPacksData[normalizedPackPath] || [];
        const existingFlowName = findExistingPackedFlowName(
          [...(existingPack?.packedFiles || []), ...unsavedFiles].map((file) => file.name),
          normalizedFlowName,
        );
        if (existingFlowName && !overwriteExisting) {
          return {
            success: false,
            alreadyExists: true,
            packPath: normalizedPackPath,
            flowName: existingFlowName,
          };
        }
        const flowNameToWrite = existingFlowName || normalizedFlowName;

        await fsExtra.ensureDir(nodePath.dirname(normalizedPackPath));
        const buffer = Buffer.from(flowData, "utf8");
        await writePack(
          [{ name: flowNameToWrite, buffer, file_size: buffer.length }],
          normalizedPackPath,
          existingPack,
          !!existingPack,
        );
        await invalidateCachedPackData(normalizedPackPath);

        if (unsavedFiles.length > 0) {
          const remainingUnsavedFiles = unsavedFiles.filter(
            (file) => file.name.toLowerCase() !== flowNameToWrite.toLowerCase(),
          );
          if (remainingUnsavedFiles.length > 0) {
            appData.unsavedPacksData[normalizedPackPath] = remainingUnsavedFiles;
          } else {
            delete appData.unsavedPacksData[normalizedPackPath];
          }
          mainWindow?.webContents.send("setUnsavedPacksData", normalizedPackPath, remainingUnsavedFiles);
          windows.viewerWindow?.webContents.send("setUnsavedPacksData", normalizedPackPath, remainingUnsavedFiles);
        }

        return {
          success: true,
          packPath: normalizedPackPath,
          flowName: flowNameToWrite,
        };
      } catch (error) {
        console.error("Error saving flow directly to pack:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save flow to pack",
        };
      }
    },
  );
  ipcMain.on("readAppConfig", async () => {
    let doesConfigExist = true;
    try {
      try {
        const appState = await readConfig();
        mainWindow?.webContents.send("fromAppConfig", appState);
        appData.isUsingEnglishLocalizations = !!appState.isUsingEnglishLocalizations;
        console.log("appState.currentLanguage:", appState.currentLanguage);
        if (appState.currentLanguage) {
          const languageInConfig = appState.currentLanguage || "en";
          if (i18n.language != languageInConfig || appData.currentLanguage != languageInConfig) {
            appData.currentLanguage = languageInConfig;
            i18n.changeLanguage(languageInConfig).then(() => {
              mainWindow?.webContents.send("setCurrentLanguage", languageInConfig);
            });
          }
        }
      } catch (err) {
        mainWindow?.webContents.send("failedReadingConfig");
        if (err instanceof Error) console.log(err.message);
        doesConfigExist = false;
      }
      const gamesToCheck = doesConfigExist ? [appData.currentGame] : supportedGames;
      for (const game of gamesToCheck) {
        console.log(`checking game: ${game}`);
        const dataFolder = appData.gamesToGameFolderPaths[game].dataFolder;
        const contentFolder = appData.gamesToGameFolderPaths[game].contentFolder;
        const gamePath = appData.gamesToGameFolderPaths[game].gamePath;
        if (!gamePath || !contentFolder || !dataFolder) {
          await getFolderPaths(log, game);
        }
        if (appData.gamesToGameFolderPaths[game].contentFolder) {
          appData.currentGame = game;
          initializeAllSchemaForGame(game);
          break;
        }
      }
      let modsToImport: string[] | undefined;
      if (!doesConfigExist) {
        try {
          const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
          if (gamePath) {
            const usedModsFilePath = nodePath.join(gamePath, "used_mods.txt");
            const encoding = appData.currentGame == "shogun2" ? "utf16le" : "utf8";
            const usedModsData = await fs.promises.readFile(usedModsFilePath, encoding);
            modsToImport = parseUsedMods(usedModsData);
          }
        } catch {
          // Ignore a missing used_mods fallback file.
        }
      }
      getAllMods(
        modsToImport
          ? () => {
              console.log("config doesn't exist, importing mods from used_mods.txt:", modsToImport);
              mainWindow?.webContents.send("importModsFromUsedMods", modsToImport);
            }
          : undefined,
      );
    } finally {
      const contentFolder = appData.gamesToGameFolderPaths[appData.currentGame].contentFolder;
      const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
      console.log("SENDING setAppFolderPaths", gamePath, contentFolder);
      mainWindow?.webContents.send("setAppFolderPaths", {
        ...appData.gamesToGameFolderPaths[appData.currentGame],
        gamePath: gamePath || "",
        contentFolder: contentFolder || "",
      } as GameFolderPaths);
      if (!doesConfigExist) {
        mainWindow?.webContents.send("setCurrentGame", appData.currentGame);
      }
      mainWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    }
    console.log(
      "NUM MODS IN APPDATA",
      appData.currentGame,
      appData.gameToConfig[appData.currentGame]?.currentPreset.mods.length,
    );
    // for testing, automatically opens db.pack
    if (appData.startArgs.includes("-testDBClone")) {
      if (appData.gamesToGameFolderPaths[appData.currentGame].dataFolder)
        ipcMain.emit(
          "requestOpenModInViewer",
          null,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame].dataFolder!, "db.pack"),
        );
    }
  });
  ipcMain.on("selectContentFolder", async (event, requestedGame: SupportedGames | undefined) => {
    try {
      if (!mainWindow) return;
      const dialogReturnValue = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "showHiddenFiles"],
      });
      if (!dialogReturnValue.canceled) {
        const contentFolderPath = dialogReturnValue.filePaths[0];
        const game = requestedGame || appData.currentGame;
        appData.gamesToGameFolderPaths[game].contentFolder = contentFolderPath;
        mainWindow?.webContents.send("setContentFolder", contentFolderPath);
        refreshModsIfFoldersValid(requestedGame);
      }
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("selectWarhammer3Folder", async (event, requestedGame: SupportedGames | undefined) => {
    try {
      if (!mainWindow) return;
      const dialogReturnValue = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "showHiddenFiles"],
      });
      if (!dialogReturnValue.canceled) {
        const wh3FolderPath = dialogReturnValue.filePaths[0];
        const game = requestedGame || appData.currentGame;
        appData.gamesToGameFolderPaths[game].gamePath = wh3FolderPath;
        appData.gamesToGameFolderPaths[game].dataFolder = nodePath.join(wh3FolderPath, "/data/");
        mainWindow?.webContents.send("setWarhammer3Folder", wh3FolderPath);
        if (appData.gamesToGameFolderPaths[game].gamePath == undefined) return;
        const calculatedContentPath = nodePath.join(
          appData.gamesToGameFolderPaths[game].gamePath as string,
          "..",
          "..",
          "workshop",
          "content",
          gameToSteamId[game],
        );
        if (fs.existsSync(calculatedContentPath)) {
          appData.gamesToGameFolderPaths[game].contentFolder = calculatedContentPath;
          mainWindow?.webContents.send("setContentFolder", calculatedContentPath);
        }
        // shogun 2 doesn't use the content folder, puts subscribed to mods directly into data
        if (requestedGame == "shogun2") {
          appData.gamesToGameFolderPaths[game].contentFolder = wh3FolderPath;
          mainWindow?.webContents.send("setContentFolder", wh3FolderPath);
        }
        refreshModsIfFoldersValid(requestedGame);
      }
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.handle("getSteamCollectionName", async (event, steamCollectionURL: string) => {
    try {
      console.log("getting steamCollectionURL name:", steamCollectionURL);
      const res = await fetch(steamCollectionURL);
      const cheerioObj = cheerio.load(await res.text());
      const collectionTitle = cheerioObj(".collectionHeaderContent").find(".workshopItemTitle").text();
      console.log("collection title:", collectionTitle);
      return collectionTitle;
    } catch (e) {
      console.log(e);
    }
    return "";
  });
  ipcMain.handle("translate", async (event, translationId: string, options?: Record<string, string | number>) => {
    if (i18n.language != appData.currentLanguage) {
      await i18n.changeLanguage(appData.currentLanguage);
    }
    return i18n.t(translationId, options);
  });
  ipcMain.handle(
    "translateAll",
    async (event, translationIdsWithOptions: Record<string, Record<string, string | number>>) => {
      if (i18n.language != appData.currentLanguage) {
        await i18n.changeLanguage(appData.currentLanguage);
      }
      const translated: Record<string, string> = {};
      for (const id of Object.keys(translationIdsWithOptions)) {
        translated[id] = i18n.t(id, translationIdsWithOptions[id]);
      }
      return translated;
    },
  );
  ipcMain.handle("translateAllStatic", async (event, translationIds: Record<string, string | number>) => {
    console.log("translateAllStatic handler, language is", i18n.language);
    if (i18n.language != appData.currentLanguage) {
      await i18n.changeLanguage(appData.currentLanguage);
    }
    const translated: Record<string, string> = {};
    for (const id of Object.keys(translationIds)) {
      translated[id] = i18n.t(id);
    }
    return translated;
  });
  ipcMain.on("getCompatData", async (event, mods: Mod[]) => {
    console.log("SET PACK COLLISIONS");
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;
    const vanillaPackPaths = getCompatVanillaPackPaths(dataFolder);
    const compatSignature = await buildCompatCheckSignature(mods, vanillaPackPaths);
    if (compatSignature && compatCheckCache?.signatureHash === compatSignature) {
      console.log("getCompatData: cache hit, sending cached collisions");
      mainWindow?.webContents.send("setPackCollisions", compatCheckCache.packCollisions);
      return;
    }
    await prepareModsForCompat(mods);
    // Startup retains vanilla file indexes. Reuse those unless the pack changed, and only reload
    // script/XML payloads when the optional vanilla analysis actually needs them.
    await prepareVanillaPacksForCompat(vanillaPackPaths);
    const lazyVanillaReadPlan = getLazyCompatVanillaReadPlan(mods, vanillaPackPaths);
    // Whatever the cache already holds is filled in place, so the reference scan below runs on the
    // same rows from a cheaper source. Only what it cannot serve is read from the packs.
    let tablesStillToRead = lazyVanillaReadPlan.tablesToRead;
    const cachedVanillaPack = appData.packsData.find((pack) =>
      lazyVanillaReadPlan.packPaths.some((packPath) => nodePath.resolve(packPath) === nodePath.resolve(pack.path)),
    );
    if (cachedVanillaPack && tablesStillToRead.length > 0) {
      const { servedTablePaths, unservedPrefixes } = await fillVanillaTablesFromCache(
        cachedVanillaPack,
        tablesStillToRead,
        // getDBVersionByTableName is what findPackTableReferencesOptimized resolves with, so the
        // layout check inside compares against the same answer the scan will get.
        (packedFile: PackedFile) => {
          const dbName = getDBName(packedFile);
          return dbName ? getDBVersionByTableName(packedFile, dbName) : undefined;
        },
      );
      if (servedTablePaths.length > 0) {
        console.log(
          `vanilla db cache served ${servedTablePaths.length} tables to the compat check,` +
            ` ${unservedPrefixes.length} of ${tablesStillToRead.length} still to read`,
        );
      }
      tablesStillToRead = unservedPrefixes;
    }
    if (lazyVanillaReadPlan.packPaths.length > 0 && tablesStillToRead.length > 0) {
      await readModsByPath(
        lazyVanillaReadPlan.packPaths,
        { skipParsingTables: false, tablesToRead: tablesStillToRead },
        true,
      );
    }
    // Only the packs this check was asked about, plus vanilla, which the reference resolution needs.
    //
    // appData.packsData accumulates every pack read at any point in the session - browsing a mod in
    // the viewer, a mod enabled and later disabled - and scanning all of it reported conflicts between
    // packs the user had not selected. It also made the result depend on session history, so the same
    // mods could produce different reports, and made compatCheckCache unsound: its key covers `mods`
    // and the vanilla packs, while the answer depended on whatever else happened to be loaded.
    const packsToCheck = selectPacksToCheck(appData.packsData, [...mods.map((mod) => mod.path), ...vanillaPackPaths]);
    console.log(`getCompatData: checking ${packsToCheck.length} packs of ${appData.packsData.length} loaded`);

    let lastProgressSentAt = 0;
    let lastProgressType: PackCollisionCheckType | undefined;
    const packCollisions = getCompatData(
      packsToCheck,
      (currentIndex, maxIndex, firstPackName, secondPackName, type) => {
        const now = Date.now();
        const isStageBoundary = type !== lastProgressType;
        const isFinalUpdate = currentIndex >= maxIndex;
        if (!isStageBoundary && !isFinalUpdate && now - lastProgressSentAt < 50) return;
        lastProgressSentAt = now;
        lastProgressType = type;
        mainWindow?.webContents.send("setPackCollisionsCheckProgress", {
          currentIndex,
          maxIndex,
          firstPackName,
          secondPackName,
          type,
        } as PackCollisionsCheckProgressData);
      },
    );
    if (compatSignature) {
      compatCheckCache = {
        signatureHash: compatSignature,
        createdAt: Date.now(),
        packCollisions,
      };
    }
    mainWindow?.webContents.send("setPackCollisions", packCollisions);
    emptyAllCompatDataCollections();
  });
  ipcMain.on("copyToData", async (event, modPathsToCopy?: string[]) => {
    if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) return;
    console.log("copyToData: modPathsToCopy:", modPathsToCopy);
    const mods = await getMods(log);
    let withoutDataMods = mods.filter((mod) => !mod.isInData);
    if (modPathsToCopy) {
      withoutDataMods = withoutDataMods.filter((mod) =>
        modPathsToCopy.some((modPathToCopy) => modPathToCopy == mod.path),
      );
    }
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow?.webContents.send(
        "handleLog",
        `COPYING ${mod.path} to ${appData.gamesToGameFolderPaths[appData.currentGame].gamePath}\\data\\${mod.name}`,
      );
      if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) throw new Error("game path not set");
      return fs.copyFileSync(
        mod.path,
        nodePath.join(appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string, "/data/", mod.name),
      );
    });
    await Promise.allSettled(copyPromises);
    // getAllMods();
  });
  const normalizeComparablePath = (folderPath: string) => {
    const normalizedPath = nodePath.resolve(folderPath);
    return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
  };
  const sourcePathsOverlap = (firstPath: string, secondPath: string) => {
    const first = normalizeComparablePath(firstPath);
    const second = normalizeComparablePath(secondPath);
    const firstToSecond = nodePath.relative(first, second);
    const secondToFirst = nodePath.relative(second, first);
    const isInside = (relativePath: string) =>
      relativePath === "" || (!relativePath.startsWith("..") && !nodePath.isAbsolute(relativePath));
    return isInside(firstToSecond) || isInside(secondToFirst);
  };
  const validateCustomModFolders = (game: SupportedGames, customFolders: CustomModFolder[]) => {
    const gameFolderPaths = appData.gamesToGameFolderPaths[game];
    const existingCustomIds = new Set((gameFolderPaths.customModFolders || []).map((folder) => folder.id));
    const seenIds = new Set<string>();
    const paths: Array<{ id: string; path: string }> = [];
    if (gameFolderPaths.dataFolder) paths.push({ id: DATA_MOD_SOURCE_ID, path: gameFolderPaths.dataFolder });
    if (gameFolderPaths.contentFolder) {
      paths.push({ id: WORKSHOP_MOD_SOURCE_ID, path: gameFolderPaths.contentFolder });
    }

    for (const folder of customFolders) {
      if (!folder.id || !folder.path) return "Custom mod folders must have an ID and path.";
      if (seenIds.has(folder.id)) return `Duplicate custom folder ID: ${folder.id}`;
      seenIds.add(folder.id);
      if (!existingCustomIds.has(folder.id)) {
        try {
          if (!fs.statSync(folder.path).isDirectory()) return `Not a directory: ${folder.path}`;
        } catch {
          return `Folder does not exist: ${folder.path}`;
        }
      }
      const overlappingSource = paths.find((source) => sourcePathsOverlap(source.path, folder.path));
      if (overlappingSource) return `Folder overlaps another mod source: ${overlappingSource.path}`;
      paths.push(folder);
    }
    return undefined;
  };
  ipcMain.handle(
    "updateCustomModSources",
    async (event, data: { game: SupportedGames; customModFolders: CustomModFolder[]; modSourceOrder: string[] }) => {
      const error = validateCustomModFolders(data.game, data.customModFolders);
      if (error) return { success: false, error };

      const folderPaths = appData.gamesToGameFolderPaths[data.game];
      const didFolderListChange =
        JSON.stringify(folderPaths.customModFolders || []) !== JSON.stringify(data.customModFolders);
      folderPaths.customModFolders = data.customModFolders;
      folderPaths.modSourceOrder = normalizeModSourceOrder(
        { ...folderPaths, modSourceOrder: data.modSourceOrder },
        appData.isFeaturesForModdersEnabled,
      );
      if (data.game === appData.currentGame) {
        mainWindow?.webContents.send("setAppFolderPaths", folderPaths);
        if (didFolderListChange) await getAllMods();
      }
      return { success: true, folderPaths };
    },
  );
  ipcMain.handle("getCustomModFolderStatuses", (event, folderPaths: string[]) =>
    Object.fromEntries(
      folderPaths.map((folderPath) => {
        try {
          return [folderPath, fs.statSync(folderPath).isDirectory()];
        } catch {
          return [folderPath, false];
        }
      }),
    ),
  );
  ipcMain.handle(
    "copyModsToNewCustomFolder",
    async (event, data: { destinationPath: string; modPaths: string[]; overwrite: boolean }) => {
      if (data.modPaths.length === 0) return { success: false, error: "No mods selected." };
      const folderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
      const candidateFolder = { id: `custom-${randomUUID()}`, path: data.destinationPath };
      const validationError = validateCustomModFolders(appData.currentGame, [
        ...(folderPaths.customModFolders || []),
        candidateFolder,
      ]);
      if (validationError) return { success: false, error: validationError };

      const conflicts = data.modPaths
        .map((modPath) => nodePath.basename(modPath))
        .filter((modName) => fsExtra.existsSync(nodePath.join(data.destinationPath, modName)));
      if (conflicts.length > 0 && !data.overwrite) {
        return { success: false, requiresConfirmation: true, conflicts };
      }

      const knownMods = appData.allMods.length > 0 ? appData.allMods : await getMods(log);
      const copied: string[] = [];
      const failed: Array<{ path: string; error: string }> = [];
      for (const modPath of data.modPaths) {
        try {
          const modName = nodePath.basename(modPath);
          await fs.promises.copyFile(modPath, nodePath.join(data.destinationPath, modName));
          copied.push(modName);
          const sourceMod = knownMods.find((mod) => mod.path === modPath);
          if (sourceMod?.imgPath && fsExtra.existsSync(sourceMod.imgPath)) {
            const thumbnailExtension = nodePath.extname(sourceMod.imgPath).toLowerCase();
            if (thumbnailExtension === ".png" || thumbnailExtension === ".jpg") {
              const thumbnailName = `${nodePath.basename(modName, nodePath.extname(modName))}${thumbnailExtension}`;
              try {
                await fs.promises.copyFile(sourceMod.imgPath, nodePath.join(data.destinationPath, thumbnailName));
              } catch (error) {
                failed.push({
                  path: sourceMod.imgPath,
                  error: error instanceof Error ? error.message : "Unknown thumbnail copy error",
                });
              }
            }
          }
        } catch (error) {
          failed.push({
            path: modPath,
            error: error instanceof Error ? error.message : "Unknown copy error",
          });
        }
      }

      if (copied.length === 0) return { success: false, error: "No mods could be copied.", failed };

      folderPaths.customModFolders = [...(folderPaths.customModFolders || []), candidateFolder];
      folderPaths.modSourceOrder = insertCustomSourceAfterData(
        normalizeModSourceOrder(folderPaths, appData.isFeaturesForModdersEnabled),
        candidateFolder.id,
      );
      mainWindow?.webContents.send("setAppFolderPaths", folderPaths);
      await getAllMods();
      return { success: true, copied, failed, folderPaths };
    },
  );
  ipcMain.handle(
    "syncWorkshopModsToCustomFolder",
    async (event, data: { customSourceId: string; enabledWorkshopModNames: string[] }) => {
      const folderPaths = appData.gamesToGameFolderPaths[appData.currentGame];
      const customFolder = (folderPaths.customModFolders || []).find((folder) => folder.id === data.customSourceId);
      if (!customFolder) return { success: false, error: "Custom mod folder not found." };
      try {
        if (!fs.statSync(customFolder.path).isDirectory()) {
          return { success: false, error: "Custom mod folder is not a directory." };
        }
      } catch {
        return { success: false, error: "Custom mod folder does not exist." };
      }

      const knownMods = await getMods(log);
      const syncItems = getWorkshopModSyncItems(knownMods, customFolder.id, data.enabledWorkshopModNames);
      const updated: string[] = [];
      const added: string[] = [];
      const failed: Array<{ path: string; error: string }> = [];

      for (const { workshopMod, customMod } of syncItems) {
        const destinationPackPath = customMod?.path || nodePath.join(customFolder.path, workshopMod.name);
        try {
          await fs.promises.copyFile(workshopMod.path, destinationPackPath);
          (customMod ? updated : added).push(workshopMod.name);

          if (workshopMod.imgPath && fsExtra.existsSync(workshopMod.imgPath)) {
            const thumbnailExtension = nodePath.extname(workshopMod.imgPath).toLowerCase();
            if (thumbnailExtension === ".png" || thumbnailExtension === ".jpg") {
              const thumbnailName = `${nodePath.basename(
                destinationPackPath,
                nodePath.extname(destinationPackPath),
              )}${thumbnailExtension}`;
              try {
                await fs.promises.copyFile(
                  workshopMod.imgPath,
                  nodePath.join(nodePath.dirname(destinationPackPath), thumbnailName),
                );
              } catch (error) {
                failed.push({
                  path: workshopMod.imgPath,
                  error: error instanceof Error ? error.message : "Unknown thumbnail copy error",
                });
              }
            }
          }
        } catch (error) {
          failed.push({
            path: workshopMod.path,
            error: error instanceof Error ? error.message : "Unknown copy error",
          });
        }
      }

      if (updated.length > 0 || added.length > 0) await getAllMods();
      return { success: true, updated, added, failed };
    },
  );
  ipcMain.on("copyToDataAsSymbolicLink", async (event, modPathsToCopy?: string[]) => {
    console.log("copyToDataAsSymbolicLink modPathsToCopy:", modPathsToCopy);
    const mods = await getMods(log);
    let withoutDataMods = mods.filter((mod) => !mod.isInData);
    if (modPathsToCopy) {
      withoutDataMods = withoutDataMods.filter((mod) =>
        modPathsToCopy.some((modPathToCopy) => modPathToCopy == mod.path),
      );
    }
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
    if (!gamePath) return;
    const pathsOfNewSymLinks = withoutDataMods.map((mod) => nodePath.join(gamePath ?? "", "/data/", mod.name));
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow?.webContents.send("handleLog", `CREATING SYMLINK of ${mod.path} to ${gamePath}\\data\\${mod.name}`);
      if (!gamePath) throw new Error("game path not set");
      return fsExtra.symlink(mod.path, nodePath.join(gamePath, "/data/", mod.name));
    });
    await Promise.allSettled(copyPromises);
    // should be tracked automatically by the data watcher, but chokidar can choke on symlinks here
    for (const pathsOfNewSymLink of pathsOfNewSymLinks) {
      onNewPackFound(pathsOfNewSymLink);
    }
    // getAllMods();
  });
  ipcMain.on("cleanData", async () => {
    const mods = await getMods(log);
    mods.forEach((mod) => {
      if (mod.isInData) mainWindow?.webContents.send("handleLog", `is in data ${mod.name}`);
    });
    const modsInBothPlaces = mods.filter(
      (mod) =>
        mod.isInData &&
        !mod.isInModding &&
        mods.find((modSecond) => !modSecond.isInData && !modSecond.isInData && modSecond.name === mod.name),
    );
    const deletePromises = modsInBothPlaces.map((mod) => {
      mainWindow?.webContents.send("handleLog", `DELETING ${mod.path}`);
      return fs.unlinkSync(mod.path);
    });
    await Promise.allSettled(deletePromises);
    // Clear whmm_overwrites directory
    try {
      const gamePath = appData.gamesToGameFolderPaths[appData.currentGame]?.gamePath;
      if (gamePath) {
        const overwritesDirPath = nodePath.join(gamePath, "whmm_overwrites");
        if (fsExtra.existsSync(overwritesDirPath)) {
          console.log(`DELETING whmm_overwrites directory: ${overwritesDirPath}`);
          fsExtra.removeSync(overwritesDirPath);
          console.log("Successfully cleared whmm_overwrites");
        }
      }
    } catch (error) {
      console.log(`Error clearing whmm_overwrites: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    // getAllMods();
  });
  ipcMain.on("cleanSymbolicLinksInData", async () => {
    const mods = await getMods(log);
    const symLinksToDelete = mods.filter((mod) => mod.isInData && mod.isSymbolicLink);
    console.log("symLinksToDelete", symLinksToDelete);
    const deletePromises = symLinksToDelete.map((mod) => {
      mainWindow?.webContents.send("handleLog", `DELETING SYMLINK ${mod.path}`);
      return fs.unlinkSync(mod.path);
    });
    await Promise.allSettled(deletePromises);
    // should be tracked automatically by the data watcher, but chokidar can choke on symlinks here
    for (const deletedSymLink of symLinksToDelete) {
      onPackDeleted(deletedSymLink.path);
    }
    // getAllMods();
  });
  ipcMain.on("saveConfig", (event, payload: ConfigSavePayload) => {
    console.log("saveConfig");
    const { config } = payload;

    applyConfigSavePayloadToAppData(payload);

    const hiddenModNames = new Set(config.hiddenModNames);
    const hiddenAndEnabledCount = appData.enabledMods.filter((mod) => hiddenModNames.has(mod.name)).length;
    mainWindow?.setTitle(
      `WH3 Mod Manager v${version}: ${appData.enabledMods.length} mods enabled` +
        (hiddenAndEnabledCount > 0 ? ` (${hiddenAndEnabledCount} of those hidden)` : "") +
        ` for ${gameToGameName[appData.currentGame]}`,
    );
    writeAppConfig(payload);
  });
  ipcMain.on("getSkillsForSubtype", async (event, subtype: string, subtypeIndex: number) => {
    getSkillsForSubtype(subtype, subtypeIndex);
  });
  ipcMain.on("createNewSkillTree", async (event, subtype: string) => {
    const cachedSkillsData = appData.skillsData;
    if (!cachedSkillsData) return;
    const newSetKey = `new_skill_set_${subtype}_${Date.now()}`;
    // Copy agent type/subtype data from the existing set
    const originalSet = cachedSkillsData.subtypeAndSets.find((s) => s.agentSubtype === subtype);
    cachedSkillsData.subtypeAndSets.push({
      key: newSetKey,
      agentSubtype: subtype,
      agentKey: originalSet?.agentKey || "",
      campaignKey: originalSet?.campaignKey || "",
      factionKey: originalSet?.factionKey || "",
      subculture: originalSet?.subculture || "",
      forArmy: originalSet?.forArmy || "false",
      forNavy: originalSet?.forNavy || "false",
    });
    if (!cachedSkillsData.subtypesToSet[subtype]) {
      cachedSkillsData.subtypesToSet[subtype] = [];
    }
    cachedSkillsData.subtypesToSet[subtype].push(newSetKey);
    cachedSkillsData.setToNodes[newSetKey] = [];
    const newSubtypeIndex = cachedSkillsData.subtypesToSet[subtype].length - 1;
    getSkillsForSubtype(subtype, newSubtypeIndex);
  });
  ipcMain.handle("saveSkillsPack", async (event, data: SaveSkillsPackPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const ts = data.generationTimestamp || Date.now().toString();
      const {
        subtype,
        subtypeIndex,
        nodes,
        edges,
        packName,
        packDirectory,
        cloneAllSkills,
        tableNameTemplate,
        nodeKeyTemplate,
        skillKeyTemplate,
      } = data;
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const kp = defaultModdersPrefix || "custom";
      const setSuffix = buildDefaultSkillSetSuffix(subtype);
      const currentSetKey = appData.skillsData?.subtypesToSet?.[subtype]?.[subtypeIndex];
      const currentSetCampaignKey =
        appData.skillsData?.subtypeAndSets?.find((set) => set.key === currentSetKey)?.campaignKey || "";
      const tn = resolveSkillGenerationTemplate(tableNameTemplate?.trim() || "${prefix}_${setSuffix}_${timestamp}", {
        prefix: kp,
        setSuffix,
        timestamp: ts,
        row: "",
        column: "",
      });
      // Build key mappings: old nodeId → new node key, index-based new skill key
      const nodeIdToNewNodeKey: Record<string, string> = {};
      const nodeIdToNewSkillKey: Record<string, string> = {};
      for (let i = 0; i < nodes.length; i++) {
        nodeIdToNewNodeKey[nodes[i].nodeId] = appendScopedSkillNodeHash(
          resolveSkillGenerationTemplate(nodeKeyTemplate?.trim() || "${prefix}_skill_node_${row}_${column}", {
            prefix: kp,
            setSuffix,
            timestamp: ts,
            row: nodes[i].row.toString(),
            column: nodes[i].column.toString(),
          }),
          currentSetCampaignKey,
          nodes[i].faction,
          nodes[i].subculture,
        );
        if (!cloneAllSkills && nodes[i].existingSkillKey) {
          nodeIdToNewSkillKey[nodes[i].nodeId] = nodes[i].existingSkillKey!;
        } else {
          nodeIdToNewSkillKey[nodes[i].nodeId] = appendScopedSkillNodeHash(
            resolveSkillGenerationTemplate(skillKeyTemplate?.trim() || "${prefix}_skill_${row}_${column}", {
              prefix: kp,
              setSuffix,
              timestamp: ts,
              row: nodes[i].row.toString(),
              column: nodes[i].column.toString(),
            }),
            currentSetCampaignKey,
            nodes[i].faction,
            nodes[i].subculture,
          );
        }
      }
      const customNodes = cloneAllSkills ? nodes : nodes.filter((n) => !n.existingSkillKey);
      const newSetKey = `${kp}_${setSuffix}`;
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        // Version marker
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        // Version number (int32 LE)
        const vBuf = Buffer.alloc(4);
        vBuf.writeInt32LE(version, 0);
        parts.push(vBuf);
        // Marker byte
        parts.push(Buffer.from([0x01]));
        // Entry count (int32 LE)
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        // Row data
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xff, 0xfe])); // BOM
        parts.push(Buffer.from([0x4c, 0x4f, 0x43])); // "LOC"
        parts.push(Buffer.from([0x00])); // marker
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(1, 0);
        parts.push(cBuf);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < LocFields.length; i++) {
            parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableName: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableName];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableName}`);
        const defaultVersion = defaultTableVersions?.[tableName];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const packFiles: NewPackedFile[] = [];
      // 1. character_skill_node_sets_tables — one row
      {
        const tableName = "character_skill_node_sets_tables";
        const schema = getPreferredSchema(tableName);
        const originalSet = appData.skillsData?.subtypeAndSets?.find((s) => s.agentSubtype === subtype);
        const rows = [
          buildRowFromSchema(schema.fields, {
            key: newSetKey,
            agent_subtype_key: subtype,
            agent_key: originalSet?.agentKey || "",
            campaign_key: originalSet?.campaignKey || "",
            faction_key: originalSet?.factionKey || "",
            subculture: originalSet?.subculture || "",
            for_army: originalSet?.forArmy || "false",
            for_navy: originalSet?.forNavy || "false",
          }),
        ];
        const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
        packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
      }
      // 2. character_skills_tables — one row per custom node (existing skills already exist)
      {
        const tableName = "character_skills_tables";
        const schema = getPreferredSchema(tableName);
        const rows = customNodes.map((node, i) =>
          buildRowFromSchema(schema.fields, {
            key: nodeIdToNewSkillKey[node.nodeId],
            image_path: node.imgPath || "",
            unlocked_at_rank: node.unlockRank.toString(),
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 3. character_skill_nodes_tables — one row per node
      {
        const tableName = "character_skill_nodes_tables";
        const schema = getPreferredSchema(tableName);
        const rows = nodes.map((node, i) =>
          buildRowFromSchema(schema.fields, {
            key: nodeIdToNewNodeKey[node.nodeId],
            character_skill_key: nodeIdToNewSkillKey[node.nodeId],
            tier: node.column.toString(),
            indent: node.row.toString(),
            visible_in_ui: "1",
            faction_key: node.faction || "",
            subculture: node.subculture || "",
            required_num_parents: (node.requiredNumParents || 0).toString(),
          }),
        );
        const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
        packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
      }
      // 4. character_skill_node_set_items_tables — one row per node
      {
        const tableName = "character_skill_node_set_items_tables";
        const schema = getPreferredSchema(tableName);
        const rows = nodes.map((node) =>
          buildRowFromSchema(schema.fields, {
            set: newSetKey,
            item: nodeIdToNewNodeKey[node.nodeId],
            mod_disabled: "false",
          }),
        );
        const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
        packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
      }
      // 5. character_skill_node_links_tables — one row per edge
      if (edges.length > 0) {
        const tableName = "character_skill_node_links_tables";
        const schema = getPreferredSchema(tableName);
        const rows = edges
          .filter((e) => nodeIdToNewNodeKey[e.source] && nodeIdToNewNodeKey[e.target])
          .map((edge) =>
            buildRowFromSchema(schema.fields, {
              parent_key: nodeIdToNewNodeKey[edge.source],
              child_key: nodeIdToNewNodeKey[edge.target],
              link_type: edge.linkType || "REQUIRED",
              parent_link_position: "1",
              child_link_position: "1",
            }),
          );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 6. character_skill_level_to_effects_junctions_tables — one row per effect per custom skill (existing skills already have effects)
      {
        const tableName = "character_skill_level_to_effects_junctions_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        for (const node of customNodes) {
          const skillKey = nodeIdToNewSkillKey[node.nodeId];
          for (const effect of node.effects) {
            rows.push(
              buildRowFromSchema(schema.fields, {
                character_skill_key: skillKey,
                effect_key: effect.effectKey,
                effect_scope: effect.effectScope || "character_to_character_own",
                level: (effect.level || 1).toString(),
                value: effect.value || "0",
              }),
            );
          }
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 7. character_skill_nodes_skill_locks_tables — one row per skill lock
      if (data.skillLocks && data.skillLocks.length > 0) {
        const tableName = "character_skill_nodes_skill_locks_tables";
        const schema = getPreferredSchema(tableName);
        const rows = data.skillLocks
          .filter((lock) => nodes.some((n) => n.nodeId === lock.lockedNodeId))
          .map((lock) => {
            const lockingNode = nodes.find((n) => n.skillId === lock.lockingSkillKey);
            return buildRowFromSchema(schema.fields, {
              character_skill: lockingNode
                ? nodeIdToNewSkillKey[lockingNode.nodeId] || lock.lockingSkillKey
                : lock.lockingSkillKey,
              character_skill_node: nodeIdToNewNodeKey[lock.lockedNodeId] || lock.lockedNodeId,
              level: lock.requiredLevel.toString(),
            });
          });
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 8. Loc file — name and description for each custom skill
      {
        const rows: (string | boolean)[][] = [];
        for (const node of customNodes) {
          const skillKey = nodeIdToNewSkillKey[node.nodeId];
          rows.push([`character_skills_localised_name_${skillKey}`, node.label, false]);
          rows.push([`character_skills_localised_description_${skillKey}`, node.description, false]);
        }
        if (rows.length > 0) {
          const buffer = await buildLocFileBuffer(rows);
          packFiles.push({ name: `text\\db\\${tn}.loc`, file_size: buffer.length, buffer });
        }
      }
      const finalPackName = packName.endsWith(".pack") ? packName : `${packName}.pack`;
      const packPath = nodePath.join(packDirectory || dataFolder, finalPackName);
      console.log(
        `Writing skills pack to ${packPath} with ${packFiles.length} tables (including ${data.skillLocks?.length || 0} skill locks)`,
      );
      for (const pf of packFiles) {
        console.log(`  ${pf.name}: ${pf.file_size} bytes`);
      }
      await writePack(packFiles, packPath);
      console.log("Skills pack written successfully");
      return { success: true, packPath, packName: finalPackName };
    } catch (err: any) {
      console.error("Failed to save skills pack:", err);
      return { success: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle("saveSkillsChanges", async (event, data: SaveSkillsChangesPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const ts = data.generationTimestamp || Date.now().toString();
      const {
        subtype,
        subtypeIndex,
        overrideNodes,
        replacedNodes,
        newNodes,
        deletedNodeKeys,
        edges,
        packName,
        packDirectory,
        tableNameTemplate,
      } = data;
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const kp = defaultModdersPrefix || "custom";
      const setSuffix = buildDefaultSkillSetSuffix(subtype);
      const tn = resolveSkillGenerationTemplate(tableNameTemplate?.trim() || "${prefix}_${setSuffix}_${timestamp}", {
        prefix: kp,
        setSuffix,
        timestamp: ts,
        row: "",
        column: "",
      });
      // Get original set key
      const subtypeSets = appData.skillsData?.subtypesToSet?.[subtype];
      if (!subtypeSets || !subtypeSets[subtypeIndex]) {
        return { success: false, error: `No skill set found for ${subtype} index ${subtypeIndex}` };
      }
      const originalSetKey = subtypeSets[subtypeIndex];
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        const vBuf = Buffer.alloc(4);
        vBuf.writeInt32LE(version, 0);
        parts.push(vBuf);
        parts.push(Buffer.from([0x01]));
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xff, 0xfe]));
        parts.push(Buffer.from([0x4c, 0x4f, 0x43]));
        parts.push(Buffer.from([0x00]));
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(1, 0);
        parts.push(cBuf);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < LocFields.length; i++) {
            parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableName: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableName];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableName}`);
        const defaultVersion = defaultTableVersions?.[tableName];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const packFiles: NewPackedFile[] = [];
      // 1. character_skill_nodes_tables — override nodes (same key) + replacement/new nodes (new keys)
      {
        const tableName = "character_skill_nodes_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        for (const node of overrideNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              key: node.originalNodeKey,
              character_skill_key: node.characterSkillKey,
              tier: node.tier.toString(),
              indent: node.indent.toString(),
              visible_in_ui: "1",
              faction_key: node.faction || "",
              subculture: node.subculture || "",
              required_num_parents: (node.requiredNumParents || 0).toString(),
            }),
          );
        }
        for (const node of replacedNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              key: node.newNodeKey,
              character_skill_key: node.characterSkillKey,
              tier: node.tier.toString(),
              indent: node.indent.toString(),
              visible_in_ui: "1",
              faction_key: node.faction || "",
              subculture: node.subculture || "",
              required_num_parents: (node.requiredNumParents || 0).toString(),
            }),
          );
        }
        for (const node of newNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              key: node.newNodeKey,
              character_skill_key: node.newSkillKey,
              tier: node.tier.toString(),
              indent: node.indent.toString(),
              visible_in_ui: "1",
              faction_key: node.faction || "",
              subculture: node.subculture || "",
              required_num_parents: (node.requiredNumParents || 0).toString(),
            }),
          );
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 2. character_skill_node_set_items_tables — disable replaced/deleted originals, add replacement/new nodes
      {
        const tableName = "character_skill_node_set_items_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        // Disable original nodes that are being replaced
        for (const node of replacedNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: node.originalNodeKey,
              mod_disabled: "true",
            }),
          );
        }
        // Disable deleted nodes
        for (const nodeKey of deletedNodeKeys) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: nodeKey,
              mod_disabled: "true",
            }),
          );
        }
        // Add replacement nodes to set
        for (const node of replacedNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: node.newNodeKey,
              mod_disabled: "false",
            }),
          );
        }
        // Add new nodes to set
        for (const node of newNodes) {
          rows.push(
            buildRowFromSchema(schema.fields, {
              set: originalSetKey,
              item: node.newNodeKey,
              mod_disabled: "false",
            }),
          );
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 3. character_skill_node_links_tables — edges for replaced/new nodes
      if (edges.length > 0) {
        const tableName = "character_skill_node_links_tables";
        const schema = getPreferredSchema(tableName);
        const rows = edges.map((edge) =>
          buildRowFromSchema(schema.fields, {
            parent_key: edge.parentKey,
            child_key: edge.childKey,
            link_type: edge.linkType || "REQUIRED",
            parent_link_position: "1",
            child_link_position: "1",
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 4. character_skills_tables — only for new nodes with custom skills (not reusing existing skills)
      const customSkillNodes = newNodes.filter((n) => n.shouldCreateCharacterSkill);
      if (customSkillNodes.length > 0) {
        const tableName = "character_skills_tables";
        const schema = getPreferredSchema(tableName);
        const rows = customSkillNodes.map((node) =>
          buildRowFromSchema(schema.fields, {
            key: node.newSkillKey,
            image_path: node.imgPath || "",
            unlocked_at_rank: node.unlockRank.toString(),
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 5. character_skill_level_to_effects_junctions_tables — effects for new custom skills
      {
        const tableName = "character_skill_level_to_effects_junctions_tables";
        const schema = getPreferredSchema(tableName);
        const rows: (string | boolean)[][] = [];
        for (const node of customSkillNodes) {
          for (const effect of node.effects) {
            rows.push(
              buildRowFromSchema(schema.fields, {
                character_skill_key: node.newSkillKey,
                effect_key: effect.effectKey,
                effect_scope: effect.effectScope || "character_to_character_own",
                level: (effect.level || 1).toString(),
                value: effect.value || "0",
              }),
            );
          }
        }
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 6. character_skill_nodes_skill_locks_tables
      if (data.skillLocks && data.skillLocks.length > 0) {
        const tableName = "character_skill_nodes_skill_locks_tables";
        const schema = getPreferredSchema(tableName);
        const rows = data.skillLocks.map((lock) =>
          buildRowFromSchema(schema.fields, {
            character_skill: lock.lockingSkillKey,
            character_skill_node: lock.lockedNodeKey,
            level: lock.requiredLevel.toString(),
          }),
        );
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\${tableName}\\${tn}`, file_size: buffer.length, buffer });
        }
      }
      // 7. Loc file — name and description for new custom skills
      {
        const rows: (string | boolean)[][] = [];
        for (const node of customSkillNodes) {
          rows.push([`character_skills_localised_name_${node.newSkillKey}`, node.label, false]);
          rows.push([`character_skills_localised_description_${node.newSkillKey}`, node.description, false]);
        }
        if (rows.length > 0) {
          const buffer = await buildLocFileBuffer(rows);
          packFiles.push({ name: `text\\db\\${tn}.loc`, file_size: buffer.length, buffer });
        }
      }
      if (packFiles.length === 0) {
        return { success: false, error: "No changes detected" };
      }
      const finalPackName = packName.endsWith(".pack") ? packName : `${packName}.pack`;
      const packPath = nodePath.join(packDirectory || dataFolder, finalPackName);
      console.log(`Writing changes pack to ${packPath} with ${packFiles.length} tables`);
      for (const pf of packFiles) {
        console.log(`  ${pf.name}: ${pf.file_size} bytes`);
      }
      await writePack(packFiles, packPath);
      console.log("Changes pack written successfully");
      return { success: true, packPath, packName: finalPackName };
    } catch (err: any) {
      console.error("Failed to save changes pack:", err);
      return { success: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle("getTechnologyNodeSets", async () => {
    const technologyData = await ensureTechnologyData();
    if (!technologyData) return [];
    return Object.values(technologyData.setsByKey).sort((firstSet, secondSet) =>
      collator.compare(firstSet.localizedName || firstSet.key, secondSet.localizedName || secondSet.key),
    );
  });
  ipcMain.handle("getTechnologyTree", async (event, setKey: string) => {
    const technologyData = await ensureTechnologyData();
    if (!technologyData) return undefined;
    const technologySet = technologyData.setsByKey[setKey];
    if (!technologySet) return undefined;
    const nodesInSet = Object.values(technologyData.nodesByKey).filter((node) => node.setKey == setKey);
    const nodeSet = new Set(nodesInSet.map((node) => node.nodeKey));
    const getLoc = (locId: string) => getLocById(technologyData.locs, locId);
    const resolveTechnologyLoc = (locId: string) => {
      const localized = getLoc(locId);
      return resolveTextReplacements(localized, getLoc) || localized;
    };
    const mapEffectsForTechnology = (technologyKey: string): TechEffect[] => {
      const rawEffects = technologyData.technologyToEffects[technologyKey] || [];
      return rawEffects.map((effect) => {
        const iconFile = technologyData.effectsForTech[effect.effectKey]?.icon;
        const effectIconPath = iconFile ? `ui\\campaign ui\\effect_bundles\\${iconFile}` : undefined;
        return {
          effectKey: effect.effectKey,
          localizedKey: formatEffectLocalization(effect.effectKey, effect.value, getLoc),
          value: effect.value,
          icon: iconFile,
          iconData:
            effectIconPath && technologyData.icons[effectIconPath]
              ? iconAssetUrl(technologyData.iconGeneration, effectIconPath)
              : undefined,
        };
      });
    };
    const nodes: TechnologyNodeData[] = nodesInSet.map((node) => {
      const technology = technologyData.technologiesByKey[node.technologyKey];
      const iconPath = getTechnologyIconPath(technology?.iconName);
      return {
        nodeKey: node.nodeKey,
        technologyKey: node.technologyKey,
        setKey: node.setKey,
        tier: node.tier,
        indent: node.indent,
        requiredParents: node.requiredParents,
        campaignKey: node.campaignKey,
        factionKey: node.factionKey,
        pixelOffsetX: node.pixelOffsetX,
        pixelOffsetY: node.pixelOffsetY,
        researchPointsRequired: node.researchPointsRequired,
        optionalUiGroup: node.optionalUiGroup,
        localizedName: resolveTechnologyLoc(`technologies_onscreen_name_${node.technologyKey}`) || node.technologyKey,
        shortDescription: resolveTechnologyLoc(`technologies_short_description_${node.technologyKey}`),
        longDescription: resolveTechnologyLoc(`technologies_long_description_${node.technologyKey}`),
        iconPath,
        iconData:
          iconPath && technologyData.icons[iconPath]
            ? iconAssetUrl(technologyData.iconGeneration, iconPath)
            : undefined,
        isHidden: technology?.isHidden || false,
        buildingLevel: technology?.buildingLevel,
        effects: mapEffectsForTechnology(node.technologyKey),
      };
    });
    const allTechnologies: TechnologyCatalogEntry[] = Object.values(technologyData.technologiesByKey)
      .map((technology) => {
        const iconPath = getTechnologyIconPath(technology.iconName);
        const technologyRow = technologyData.technologyRowsByKey[technology.key] || {};
        return {
          key: technology.key,
          localizedName: resolveTechnologyLoc(`technologies_onscreen_name_${technology.key}`) || technology.key,
          researchPointsRequired: parseOptionalNumber(technologyRow.research_points_required, 0),
          buildingLevel: technology.buildingLevel,
          shortDescription: resolveTechnologyLoc(`technologies_short_description_${technology.key}`),
          longDescription: resolveTechnologyLoc(`technologies_long_description_${technology.key}`),
          iconPath,
          iconData:
            iconPath && technologyData.icons[iconPath]
              ? iconAssetUrl(technologyData.iconGeneration, iconPath)
              : undefined,
          isHidden: technology.isHidden,
          effects: mapEffectsForTechnology(technology.key),
        };
      })
      .sort((firstTechnology, secondTechnology) =>
        collator.compare(
          firstTechnology.localizedName || firstTechnology.key,
          secondTechnology.localizedName || secondTechnology.key,
        ),
      );
    const allTechnologyIcons: TechnologyIconEntry[] = Object.entries(technologyData.icons)
      .filter(([iconPath]) => iconPath.toLowerCase().startsWith("ui\\campaign ui\\technologies\\"))
      .map(([path]) => ({
        path,
        name: path.replace("ui\\campaign ui\\technologies\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
        iconData: iconAssetUrl(technologyData.iconGeneration, path),
      }))
      .sort((firstIcon, secondIcon) => collator.compare(firstIcon.name, secondIcon.name));
    const allEffectKeys = new Set<string>([
      ...Object.keys(technologyData.effectsForTech),
      ...Object.values(technologyData.technologyToEffects)
        .flat()
        .map((effect) => effect.effectKey),
    ]);
    const allEffects: TechEffect[] = [...allEffectKeys]
      .map((effectKey) => {
        const iconFile = technologyData.effectsForTech[effectKey]?.icon;
        const effectIconPath = iconFile ? `ui\\campaign ui\\effect_bundles\\${iconFile}` : undefined;
        return {
          effectKey,
          localizedKey: getRawEffectLocalization(effectKey, getLoc),
          icon: iconFile,
          iconData:
            effectIconPath && technologyData.icons[effectIconPath]
              ? iconAssetUrl(technologyData.iconGeneration, effectIconPath)
              : undefined,
        };
      })
      .sort((firstEffect, secondEffect) =>
        collator.compare(
          firstEffect.localizedKey || firstEffect.effectKey,
          secondEffect.localizedKey || secondEffect.effectKey,
        ),
      );
    const links = Object.values(technologyData.linksByKey).filter(
      (link) => nodeSet.has(link.parentKey) && nodeSet.has(link.childKey),
    );
    const uiTabToNodes: Record<string, string[]> = {};
    const uiTabs = Object.values(technologyData.uiTabsByKey)
      .filter((uiTab) => {
        const nodesForTab = technologyData.uiTabToNodes[uiTab.key] || [];
        const filteredNodes = nodesForTab.filter((nodeKey) => nodeSet.has(nodeKey));
        if (filteredNodes.length < 1) return false;
        uiTabToNodes[uiTab.key] = filteredNodes;
        return true;
      })
      .sort((firstTab, secondTab) => firstTab.sortOrder - secondTab.sortOrder)
      .map((uiTab) => ({
        ...uiTab,
        localizedName:
          uiTab.localizedName ||
          getLocById(technologyData.locs, `technology_ui_tabs_localised_name_${uiTab.key}`) ||
          uiTab.key,
        tooltipString:
          uiTab.tooltipString || getLocById(technologyData.locs, `technology_ui_tabs_tooltip_string_${uiTab.key}`),
      }));
    const relevantGroupKeys = new Set(
      nodesInSet
        .map((node) => node.optionalUiGroup)
        .filter((uiGroupKey): uiGroupKey is string => !!uiGroupKey && uiGroupKey.trim() !== ""),
    );
    for (const bounds of technologyData.uiGroupBounds) {
      if (nodeSet.has(bounds.topLeftNode) || nodeSet.has(bounds.bottomRightNode)) {
        relevantGroupKeys.add(bounds.groupKey);
      }
    }
    const uiGroups = Object.values(technologyData.uiGroupsByKey)
      .filter((uiGroup) => relevantGroupKeys.has(uiGroup.key))
      .map((uiGroup) => ({
        ...uiGroup,
        optionalDisplayName:
          uiGroup.optionalDisplayName ||
          getLocById(technologyData.locs, `technology_ui_groups_optional_display_name_${uiGroup.key}`),
        optionalDisplayDescription:
          uiGroup.optionalDisplayDescription ||
          getLocById(technologyData.locs, `technology_ui_groups_optional_display_desctiption_${uiGroup.key}`),
      }));
    const uiGroupBounds = technologyData.uiGroupBounds.filter((bounds) => {
      if (!relevantGroupKeys.has(bounds.groupKey)) return false;
      return nodeSet.has(bounds.topLeftNode) && nodeSet.has(bounds.bottomRightNode);
    });
    return {
      set: technologySet,
      nodes,
      links,
      uiTabs,
      uiTabToNodes,
      uiGroups,
      uiGroupBounds,
      allTechnologies,
      allTechnologyIcons,
      allEffects,
    } as TechnologyTreePayload;
  });
  ipcMain.handle("saveTechnologyPack", async (event, data: SaveTechnologyPackPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const technologyData = await ensureTechnologyData();
      if (!technologyData) return { success: false, error: "Technology data could not be loaded" };
      if (!data.packName?.trim()) return { success: false, error: "Pack name is required" };
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const generationPrefix = defaultModdersPrefix || "custom";
      const resolveGenerationTemplate = (
        template: string,
        variables: { prefix: string; nodeSet: string; row: string; column: string; timestamp?: string },
      ) =>
        template
          .replaceAll("${prefix}", variables.prefix)
          .replaceAll("${xxx}", variables.prefix)
          .replaceAll("${nodeSet}", variables.nodeSet)
          .replaceAll("${yyy}", variables.nodeSet)
          .replaceAll("${timestamp}", variables.timestamp ?? "")
          .replaceAll("${row}", variables.row)
          .replaceAll("${r}", variables.row)
          .replaceAll("${column}", variables.column)
          .replaceAll("${c}", variables.column);
      const generationTimestamp = Date.now().toString();
      const targetSetKey = data.technologyNodeSetOverride?.trim()
        ? resolveGenerationTemplate(data.technologyNodeSetOverride.trim(), {
            prefix: generationPrefix,
            nodeSet: data.setKey,
            row: "",
            column: "",
            timestamp: generationTimestamp,
          })
        : data.setKey;
      if (!targetSetKey.trim()) return { success: false, error: "Technology node set is required" };
      const shouldCloneNodeSet = targetSetKey !== data.setKey;
      const sourceSetExists = !!technologyData.setsByKey[data.setKey];
      const shouldWriteNodeSet = shouldCloneNodeSet || !sourceSetExists;
      const shouldCloneTechnologies = !!data.cloneTechnologies;
      const usedTechnologyUniqueIndexes = buildUsedTechnologyUniqueIndexes(technologyData.technologyRowsByKey);
      const finalPackName = data.packName.endsWith(".pack") ? data.packName : `${data.packName}.pack`;
      const packPath = nodePath.join(data.packDirectory || dataFolder, finalPackName);
      const nodeKeyTemplate = data.nodeKeyTemplate?.trim() || "${prefix}_tech_node_${nodeSet}_${row}_${column}";
      const technologyKeyTemplate = data.technologyKeyTemplate?.trim() || "${prefix}_tech_${nodeSet}_${row}_${column}";
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        const versionBuffer = Buffer.alloc(4);
        versionBuffer.writeInt32LE(version, 0);
        parts.push(versionBuffer);
        parts.push(Buffer.from([0x01]));
        const countBuffer = Buffer.alloc(4);
        countBuffer.writeInt32LE(rows.length, 0);
        parts.push(countBuffer);
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xff, 0xfe]));
        parts.push(Buffer.from([0x4c, 0x4f, 0x43]));
        parts.push(Buffer.from([0x00]));
        const cBuf = Buffer.alloc(4);
        cBuf.writeInt32LE(1, 0);
        parts.push(cBuf);
        cBuf.writeInt32LE(rows.length, 0);
        parts.push(cBuf);
        for (const row of rows) {
          for (let i = 0; i < LocFields.length; i++) {
            parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableNameToResolve: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableNameToResolve];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableNameToResolve}`);
        const defaultVersion = defaultTableVersions?.[tableNameToResolve];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const tableName = resolveGenerationTemplate(
        data.tableNameOverride?.trim() || "${prefix}_${nodeSet}_${timestamp}",
        {
          prefix: generationPrefix,
          nodeSet: targetSetKey,
          row: "",
          column: "",
          timestamp: generationTimestamp,
        },
      );
      const packFiles: NewPackedFile[] = [];
      const dedupedNodesByNodeKey = new Map<string, SaveTechnologyPackPayload["nodes"][number]>();
      for (const node of data.nodes) {
        if (node.setKey !== data.setKey) continue;
        dedupedNodesByNodeKey.set(node.nodeKey, node);
      }
      const sourceNodes = [...dedupedNodesByNodeKey.values()];
      if (sourceNodes.length < 1) return { success: false, error: "No technology nodes provided" };

      const nodeKeyRemap = new Map<string, string>();
      const remappedNodes = sourceNodes.map((sourceNode) => {
        const templateVariables = {
          prefix: generationPrefix,
          nodeSet: targetSetKey,
          row: sourceNode.indent.toString(),
          column: sourceNode.tier.toString(),
        };
        const generatedNodeKey = resolveGenerationTemplate(nodeKeyTemplate, templateVariables);
        const generatedTechnologyKey = resolveGenerationTemplate(technologyKeyTemplate, templateVariables);
        const finalNode = {
          ...sourceNode,
          nodeKey: appendScopedTechNodeHash(generatedNodeKey, sourceNode.campaignKey, sourceNode.factionKey),
          technologyKey: shouldCloneTechnologies
            ? appendScopedTechNodeHash(generatedTechnologyKey, sourceNode.campaignKey, sourceNode.factionKey)
            : sourceNode.technologyKey,
          setKey: targetSetKey,
        };
        nodeKeyRemap.set(sourceNode.nodeKey, finalNode.nodeKey);
        return { sourceNode, finalNode };
      });

      const seenNodeKeys = new Set<string>();
      const seenTechnologyKeys = new Set<string>();
      for (const { finalNode } of remappedNodes) {
        if (seenNodeKeys.has(finalNode.nodeKey)) {
          return {
            success: false,
            error: `Generated duplicate technology node key: ${finalNode.nodeKey}`,
          };
        }
        seenNodeKeys.add(finalNode.nodeKey);
        if (shouldCloneTechnologies) {
          if (seenTechnologyKeys.has(finalNode.technologyKey)) {
            return {
              success: false,
              error: `Generated duplicate technology key: ${finalNode.technologyKey}`,
            };
          }
          seenTechnologyKeys.add(finalNode.technologyKey);
        }
      }

      const finalNodes = remappedNodes.map(({ finalNode }) => finalNode);
      const shouldWriteNodeMappings =
        shouldCloneNodeSet ||
        remappedNodes.some(({ sourceNode, finalNode }) => sourceNode.nodeKey !== finalNode.nodeKey);
      const referencedUiGroupKeys = new Set(
        finalNodes
          .map((node) => node.optionalUiGroup)
          .filter((groupKey): groupKey is string => !!groupKey && groupKey.trim() !== ""),
      );
      if (shouldWriteNodeMappings) {
        for (const bounds of data.uiGroupBounds || []) {
          referencedUiGroupKeys.add(bounds.groupKey);
        }
      }
      const uiGroupKeyRemap = new Map<string, string>();
      [...referencedUiGroupKeys]
        .sort((left, right) => collator.compare(left, right))
        .forEach((groupKey, index) => {
          uiGroupKeyRemap.set(groupKey, `${generationPrefix}_${targetSetKey}_${index + 1}`);
        });

      if (shouldWriteNodeSet) {
        const setSchema = getPreferredSchema("technology_node_sets_tables");
        const originalSetRow = technologyData.setRowsByKey[data.setKey] || {};
        const originalSet = technologyData.setsByKey[data.setKey];
        const setRows = [
          buildRowFromSchema(setSchema.fields, {
            ...originalSetRow,
            key: targetSetKey,
            campaign_key: originalSet?.campaignKey || "",
            faction_key: originalSet?.factionKey || "",
            culture: originalSet?.culture || "",
            subculture: originalSet?.subculture || "",
            technology_category: originalSet?.technologyCategory || "",
            localised_name: originalSet?.localizedName || "",
            localized_name: originalSet?.localizedName || "",
            tooltip_string: originalSet?.tooltipString || "",
          }),
        ];
        const buffer = await buildDBFileBuffer(setSchema.version, setRows, setSchema.fields);
        packFiles.push({
          name: `db\\technology_node_sets_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }

      const nodeSchema = getPreferredSchema("technology_nodes_tables");
      const nodeRows = remappedNodes.map(({ sourceNode, finalNode }) =>
        buildRowFromSchema(nodeSchema.fields, {
          ...(technologyData.nodeRowsByKey[sourceNode.nodeKey] || {}),
          key: finalNode.nodeKey,
          technology_key: finalNode.technologyKey,
          technology_node_set: targetSetKey,
          tier: finalNode.tier.toString(),
          indent: finalNode.indent.toString(),
          required_parents: finalNode.requiredParents.toString(),
          campaign_key: finalNode.campaignKey || "",
          faction_key: finalNode.factionKey || "",
          pixel_offset_x: finalNode.pixelOffsetX.toString(),
          pixel_offset_y: finalNode.pixelOffsetY.toString(),
          research_points_required: finalNode.researchPointsRequired.toString(),
          optional_ui_group: finalNode.optionalUiGroup ? (uiGroupKeyRemap.get(finalNode.optionalUiGroup) ?? "") : "",
        }),
      );
      if (nodeRows.length > 0) {
        const buffer = await buildDBFileBuffer(nodeSchema.version, nodeRows, nodeSchema.fields);
        packFiles.push({
          name: `db\\technology_nodes_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }
      if (referencedUiGroupKeys.size > 0) {
        const uiGroupsSchema = getPreferredSchema("technology_ui_groups_tables");
        const uiGroupRows = [...referencedUiGroupKeys]
          .map((groupKey) => {
            const group = technologyData.uiGroupsByKey[groupKey];
            if (!group) return undefined;
            return buildRowFromSchema(uiGroupsSchema.fields, {
              key: uiGroupKeyRemap.get(group.key) || group.key,
              colour_red: group.colourRed.toString(),
              colour_green: group.colourGreen.toString(),
              colour_blue: group.colourBlue.toString(),
              colour_hex: group.colourHex,
              optional_background_image: group.optionalBackgroundImage || "",
              optional_display_name: group.optionalDisplayName || "",
              optional_display_desctiption: group.optionalDisplayDescription || "",
              optional_display_description: group.optionalDisplayDescription || "",
            });
          })
          .filter((row): row is (string | boolean)[] => !!row);
        if (uiGroupRows.length > 0) {
          const buffer = await buildDBFileBuffer(uiGroupsSchema.version, uiGroupRows, uiGroupsSchema.fields);
          packFiles.push({
            name: `db\\technology_ui_groups_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }
      }

      if (shouldWriteNodeMappings) {
        const uiTabsToNodesSchema = getPreferredSchema("technology_ui_tabs_to_technology_nodes_junctions_tables");
        const uiTabsToNodesRows = Object.entries(data.uiTabToNodes || {}).flatMap(([tab, nodeKeys]) =>
          nodeKeys
            .map((nodeKey) => nodeKeyRemap.get(nodeKey))
            .filter((nodeKey): nodeKey is string => !!nodeKey)
            .map((nodeKey) =>
              buildRowFromSchema(uiTabsToNodesSchema.fields, {
                tab,
                node: nodeKey,
              }),
            ),
        );
        if (uiTabsToNodesRows.length > 0) {
          const buffer = await buildDBFileBuffer(
            uiTabsToNodesSchema.version,
            uiTabsToNodesRows,
            uiTabsToNodesSchema.fields,
          );
          packFiles.push({
            name: `db\\technology_ui_tabs_to_technology_nodes_junctions_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }

        const uiGroupBoundsSchema = getPreferredSchema("technology_ui_groups_to_technology_nodes_junctions_tables");
        const uiGroupBoundsRows = (data.uiGroupBounds || []).flatMap((bounds) => {
          const topLeftNode = nodeKeyRemap.get(bounds.topLeftNode);
          const bottomRightNode = nodeKeyRemap.get(bounds.bottomRightNode);
          if (!topLeftNode || !bottomRightNode) return [];
          return [
            buildRowFromSchema(uiGroupBoundsSchema.fields, {
              tech_ui_group: uiGroupKeyRemap.get(bounds.groupKey) || bounds.groupKey,
              top_left_node: topLeftNode,
              bottom_right_node: bottomRightNode,
              optional_top_right_node: bounds.optionalTopRightNode
                ? (nodeKeyRemap.get(bounds.optionalTopRightNode) ?? "")
                : "",
              optional_bottom_left_node: bounds.optionalBottomLeftNode
                ? (nodeKeyRemap.get(bounds.optionalBottomLeftNode) ?? "")
                : "",
            }),
          ];
        });
        if (uiGroupBoundsRows.length > 0) {
          const buffer = await buildDBFileBuffer(
            uiGroupBoundsSchema.version,
            uiGroupBoundsRows,
            uiGroupBoundsSchema.fields,
          );
          packFiles.push({
            name: `db\\technology_ui_groups_to_technology_nodes_junctions_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }
      }

      const finalNodeKeySet = new Set(finalNodes.map((node) => node.nodeKey));
      const dedupedLinksByKey = new Map<string, { sourceLinkKey: string; link: TechnologyLinkData }>();
      for (const link of data.links) {
        const parentKey = nodeKeyRemap.get(link.parentKey) || link.parentKey;
        const childKey = nodeKeyRemap.get(link.childKey) || link.childKey;
        if (!finalNodeKeySet.has(parentKey) || !finalNodeKeySet.has(childKey)) continue;
        dedupedLinksByKey.set(`${parentKey}|${childKey}`, {
          sourceLinkKey: `${link.parentKey}|${link.childKey}`,
          link: {
            ...link,
            parentKey,
            childKey,
          },
        });
      }
      const linkSchema = getPreferredSchema("technology_node_links_tables");
      const linkRows = [...dedupedLinksByKey.values()].map(({ sourceLinkKey, link }) =>
        buildRowFromSchema(linkSchema.fields, {
          ...(technologyData.linkRowsByKey[sourceLinkKey] || {}),
          parent_key: link.parentKey,
          child_key: link.childKey,
          parent_link_position: link.parentLinkPosition.toString(),
          child_link_position: link.childLinkPosition.toString(),
          parent_link_position_offset: link.parentLinkPositionOffset.toString(),
          child_link_position_offset: link.childLinkPositionOffset.toString(),
          initial_descent_tiers: link.initialDescentTiers.toString(),
          visible_in_ui: link.visibleInUi ? "1" : "0",
        }),
      );
      if (linkRows.length > 0) {
        const buffer = await buildDBFileBuffer(linkSchema.version, linkRows, linkSchema.fields);
        packFiles.push({
          name: `db\\technology_node_links_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }

      const nodesByTechnologyKey = new Map<
        string,
        { finalNode: SaveTechnologyPackPayload["nodes"][number]; sourceTechnologyKey: string }
      >();
      for (const { sourceNode, finalNode } of remappedNodes) {
        if (!nodesByTechnologyKey.has(finalNode.technologyKey)) {
          nodesByTechnologyKey.set(finalNode.technologyKey, {
            finalNode,
            sourceTechnologyKey: sourceNode.technologyKey,
          });
        }
      }
      const normalizeComparableString = (value: string | undefined) => (value || "").trim();
      const normalizeComparableNumber = (value: string | undefined) => parseOptionalNumber(value, 0).toString();
      const normalizeComparableBool = (value: string | undefined) =>
        parseOptionalBool(value, false) ? "true" : "false";
      const normalizeComparableIconName = (value: string | undefined) =>
        normalizeComparableString(value)
          .replace(/\.(png|jpg|jpeg)$/i, "")
          .toLowerCase();
      const buildEffectsSignature = (effects: { effectKey?: string; value?: string }[] | undefined) =>
        JSON.stringify(
          (effects || [])
            .map((effect) => ({
              effectKey: normalizeComparableString(effect.effectKey),
              value: normalizeComparableString(effect.value),
            }))
            .filter((effect) => effect.effectKey !== "")
            .sort((left, right) =>
              left.effectKey === right.effectKey
                ? left.value.localeCompare(right.value)
                : left.effectKey.localeCompare(right.effectKey),
            ),
        );
      const getLoc = (locId: string) => getLocById(technologyData.locs, locId);
      const resolveTechnologyLoc = (locId: string) => {
        const localized = getLoc(locId);
        return resolveTextReplacements(localized, getLoc) || localized;
      };
      const getOriginalTechnologyDisplayName = (technologyKey: string) =>
        resolveTechnologyLoc(`technologies_onscreen_name_${technologyKey}`) || technologyKey;
      const getOriginalTechnologyShortDescription = (technologyKey: string) =>
        resolveTechnologyLoc(`technologies_short_description_${technologyKey}`) || "";
      const getOriginalTechnologyLongDescription = (technologyKey: string) =>
        resolveTechnologyLoc(`technologies_long_description_${technologyKey}`) || "";
      const techSchema = getPreferredSchema("technologies_tables");
      const technologyFieldNames = new Set(techSchema.fields.map((field) => field.name));
      const technologyEntries = [...nodesByTechnologyKey.entries()].map(
        ([technologyKey, { finalNode, sourceTechnologyKey }]) => {
          const originalTechnologyRow = technologyData.technologyRowsByKey[sourceTechnologyKey];
          const nextTechnologyRow = {
            key: technologyKey,
            research_points_required: finalNode.researchPointsRequired.toString(),
            icon_name: getTechnologyIconNameFromPath(finalNode.iconPath),
            is_hidden: finalNode.isHidden ? "true" : "false",
            building_level: getTechnologyBuildingLevelForWrite(finalNode.buildingLevel, originalTechnologyRow),
          };
          const rowDifferences = {
            missingOriginalRow: !originalTechnologyRow,
            key:
              technologyFieldNames.has("key") &&
              normalizeComparableString(originalTechnologyRow?.key) !==
                normalizeComparableString(nextTechnologyRow.key),
            research_points_required:
              technologyFieldNames.has("research_points_required") &&
              normalizeComparableNumber(originalTechnologyRow?.research_points_required) !==
                normalizeComparableNumber(nextTechnologyRow.research_points_required),
            icon_name:
              technologyFieldNames.has("icon_name") &&
              normalizeComparableIconName(originalTechnologyRow?.icon_name) !==
                normalizeComparableIconName(nextTechnologyRow.icon_name),
            is_hidden:
              technologyFieldNames.has("is_hidden") &&
              normalizeComparableBool(originalTechnologyRow?.is_hidden) !==
                normalizeComparableBool(nextTechnologyRow.is_hidden),
            building_level:
              technologyFieldNames.has("building_level") &&
              normalizeComparableString(originalTechnologyRow?.building_level) !==
                normalizeComparableString(nextTechnologyRow.building_level),
          };
          const basicDataChanged =
            rowDifferences.missingOriginalRow ||
            rowDifferences.key ||
            rowDifferences.research_points_required ||
            rowDifferences.icon_name ||
            rowDifferences.is_hidden ||
            rowDifferences.building_level;
          const locChanged =
            technologyKey !== sourceTechnologyKey ||
            normalizeComparableString(getOriginalTechnologyDisplayName(sourceTechnologyKey)) !==
              normalizeComparableString(finalNode.displayName || technologyKey) ||
            normalizeComparableString(getOriginalTechnologyShortDescription(sourceTechnologyKey)) !==
              normalizeComparableString(finalNode.shortDescription) ||
            normalizeComparableString(getOriginalTechnologyLongDescription(sourceTechnologyKey)) !==
              normalizeComparableString(finalNode.longDescription);
          const effectsChanged =
            technologyKey !== sourceTechnologyKey ||
            buildEffectsSignature(technologyData.technologyToEffects[sourceTechnologyKey]) !==
              buildEffectsSignature(finalNode.effects);
          return {
            technologyKey,
            sourceTechnologyKey,
            finalNode,
            rowDifferences,
            shouldWriteTechnologyRow: shouldCloneTechnologies || basicDataChanged,
            shouldWriteEffects: shouldCloneTechnologies || effectsChanged || basicDataChanged,
            shouldWriteLoc: shouldCloneTechnologies || locChanged,
          };
        },
      );
      const techRows = technologyEntries
        .filter(({ shouldWriteTechnologyRow }) => shouldWriteTechnologyRow)
        .map(({ technologyKey, sourceTechnologyKey, finalNode }) => {
          const originalTechnologyRow = technologyData.technologyRowsByKey[sourceTechnologyKey];
          const isBrandNewTechnology = !originalTechnologyRow;
          const shouldAllocateNewUniqueIndex = shouldCloneTechnologies || isBrandNewTechnology;
          return buildRowFromSchema(techSchema.fields, {
            ...(originalTechnologyRow || {}),
            key: technologyKey,
            research_points_required: finalNode.researchPointsRequired.toString(),
            icon_name: getTechnologyIconNameFromPath(finalNode.iconPath),
            is_hidden: finalNode.isHidden ? "true" : "false",
            building_level: getTechnologyBuildingLevelForWrite(finalNode.buildingLevel, originalTechnologyRow),
            unique_index: shouldAllocateNewUniqueIndex
              ? allocateTechnologyUniqueIndex(usedTechnologyUniqueIndexes)
              : originalTechnologyRow.unique_index || "",
            is_military: isBrandNewTechnology ? "true" : originalTechnologyRow.is_military,
          });
        });
      if (techRows.length > 0) {
        const buffer = await buildDBFileBuffer(techSchema.version, techRows, techSchema.fields);
        packFiles.push({ name: `db\\technologies_tables\\${tableName}`, file_size: buffer.length, buffer });
      }
      const techEffectsSchema = getPreferredSchema("technology_effects_junction_tables");
      const techEffectsRows: (string | boolean)[][] = [];
      const seenTechnologyEffects = new Set<string>();
      let defaultTechnologyEffectScopeFallbackCount = 0;
      for (const { technologyKey, sourceTechnologyKey, finalNode, shouldWriteEffects } of technologyEntries) {
        if (!shouldWriteEffects) continue;
        for (const effect of finalNode.effects || []) {
          const effectKey = `${effect.effectKey || ""}`.trim();
          if (!effectKey) continue;
          const rowKey = `${technologyKey}|${effectKey}`;
          if (seenTechnologyEffects.has(rowKey)) continue;
          seenTechnologyEffects.add(rowKey);
          const resolvedEffectScope =
            technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey]?.effect_scope ||
            technologyData.technologyEffectScopesByKey[effectKey] ||
            "default";
          if (resolvedEffectScope === "default") {
            defaultTechnologyEffectScopeFallbackCount += 1;
          }
          techEffectsRows.push(
            buildRowFromSchema(techEffectsSchema.fields, {
              ...(technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey] || {}),
              technology: technologyKey,
              effect: effectKey,
              effect_scope: resolvedEffectScope,
              value: effect.value || "",
            }),
          );
        }
      }
      if (techEffectsRows.length > 0) {
        const buffer = await buildDBFileBuffer(techEffectsSchema.version, techEffectsRows, techEffectsSchema.fields);
        packFiles.push({
          name: `db\\technology_effects_junction_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }
      const locRowsByKey: Record<string, string> = {};
      for (const { technologyKey, finalNode, shouldWriteLoc } of technologyEntries) {
        if (!shouldWriteLoc) continue;
        locRowsByKey[`technologies_onscreen_name_${technologyKey}`] = finalNode.displayName || technologyKey;
        if (finalNode.shortDescription !== undefined) {
          locRowsByKey[`technologies_short_description_${technologyKey}`] = finalNode.shortDescription;
        }
        if (finalNode.longDescription !== undefined) {
          locRowsByKey[`technologies_long_description_${technologyKey}`] = finalNode.longDescription;
        }
      }
      for (const remappedGroupKey of uiGroupKeyRemap.values()) {
        locRowsByKey[`technology_ui_groups_optional_display_name_${remappedGroupKey}`] = "";
        locRowsByKey[`technology_ui_groups_optional_display_desctiption_${remappedGroupKey}`] = "";
      }
      const locRows = Object.entries(locRowsByKey).map(([key, text]) => [key, text, false] as (string | boolean)[]);
      if (locRows.length > 0) {
        const buffer = await buildLocFileBuffer(locRows);
        packFiles.push({ name: `text\\db\\${tableName}.loc`, file_size: buffer.length, buffer });
      }
      if (packFiles.length < 1) return { success: false, error: "No technology data to save" };
      await writePack(packFiles, packPath);
      cachedTechnologyData = undefined;
      cachedTechnologyDataKey = undefined;
      return {
        success: true,
        packPath,
        packName: finalPackName,
        warning:
          defaultTechnologyEffectScopeFallbackCount > 0
            ? `${defaultTechnologyEffectScopeFallbackCount} technology effect row${defaultTechnologyEffectScopeFallbackCount === 1 ? "" : "s"} used fallback effect_scope 'default'.`
            : undefined,
      };
    } catch (error: any) {
      console.error("Failed to save technology tree:", error);
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle("saveTechnologyChanges", async (event, data: SaveTechnologyChangesPayload) => {
    try {
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      if (!dataFolder) return { success: false, error: "Data folder not found" };
      const technologyData = await ensureTechnologyData();
      if (!technologyData) return { success: false, error: "Technology data could not be loaded" };
      const usedTechnologyUniqueIndexes = buildUsedTechnologyUniqueIndexes(technologyData.technologyRowsByKey);
      const defaultModdersPrefix = normalizeGeneratedPrefix(appData.moddersPrefix);
      const generationTimestamp = Date.now().toString();
      const resolveGenerationTemplate = (
        template: string,
        variables: { prefix: string; nodeSet: string; row: string; column: string; timestamp?: string },
      ) =>
        template
          .replaceAll("${prefix}", variables.prefix)
          .replaceAll("${xxx}", variables.prefix)
          .replaceAll("${nodeSet}", variables.nodeSet)
          .replaceAll("${yyy}", variables.nodeSet)
          .replaceAll("${timestamp}", variables.timestamp ?? "")
          .replaceAll("${row}", variables.row)
          .replaceAll("${r}", variables.row)
          .replaceAll("${column}", variables.column)
          .replaceAll("${c}", variables.column);
      const tableName = resolveGenerationTemplate(
        data.tableNameOverride?.trim() || "${prefix}_${nodeSet}_${timestamp}",
        {
          prefix: defaultModdersPrefix || "custom",
          nodeSet: data.setKey,
          row: "",
          column: "",
          timestamp: generationTimestamp,
        },
      );
      const finalPackName = data.packName.endsWith(".pack") ? data.packName : `${data.packName}.pack`;
      const packPath = nodePath.join(data.packDirectory || dataFolder, finalPackName);
      const buildRowFromSchema = (
        dbFields: DBField[],
        values: Record<string, string | boolean>,
      ): (string | boolean)[] => {
        return dbFields.map((field) => {
          if (values[field.name] !== undefined) return values[field.name];
          return field.default_value ?? "";
        });
      };
      const buildDBFileBuffer = async (
        version: number,
        rows: (string | boolean)[][],
        dbFields: DBField[],
      ): Promise<Buffer> => {
        const parts: Buffer[] = [];
        parts.push(Buffer.from([0xfc, 0xfd, 0xfe, 0xff]));
        const versionBuffer = Buffer.alloc(4);
        versionBuffer.writeInt32LE(version, 0);
        parts.push(versionBuffer);
        parts.push(Buffer.from([0x01]));
        const countBuffer = Buffer.alloc(4);
        countBuffer.writeInt32LE(rows.length, 0);
        parts.push(countBuffer);
        for (const row of rows) {
          for (let i = 0; i < dbFields.length; i++) {
            parts.push(await typeToBuffer(dbFields[i].field_type, row[i]));
          }
        }
        return Buffer.concat(parts);
      };
      const defaultTableVersions = await getDefaultTableVersions();
      const getPreferredSchema = (tableNameToResolve: string) => {
        const versions = DBNameToDBVersions[appData.currentGame][tableNameToResolve];
        if (!versions || versions.length === 0) throw new Error(`No schema found for ${tableNameToResolve}`);
        const defaultVersion = defaultTableVersions?.[tableNameToResolve];
        return versions.find((version) => version.version === defaultVersion) || versions[0];
      };
      const packFiles: NewPackedFile[] = [];
      const hasNodeDeletions = data.deletedNodeKeys && data.deletedNodeKeys.length > 0;
      const hasNodeEdits = data.editedNodes && data.editedNodes.length > 0;
      if (data.changedNodes.length > 0 || hasNodeDeletions || hasNodeEdits) {
        const schema = getPreferredSchema("technology_nodes_tables");
        const deletedNodeSet = new Set(data.deletedNodeKeys || []);
        const dedupedRowsByNodeKey: Record<string, Record<string, string | boolean>> = {};
        if (hasNodeDeletions) {
          // Write complete replacement: all original nodes minus deleted ones
          for (const [nodeKey, originalRow] of Object.entries(technologyData.nodeRowsByKey)) {
            if (deletedNodeSet.has(nodeKey)) continue;
            dedupedRowsByNodeKey[nodeKey] = { ...originalRow };
          }
        }
        for (const changedNode of data.changedNodes) {
          if (deletedNodeSet.has(changedNode.nodeKey)) continue;
          const originalNodeRow = technologyData.nodeRowsByKey[changedNode.nodeKey];
          if (!originalNodeRow) continue;
          dedupedRowsByNodeKey[changedNode.nodeKey] = {
            ...originalNodeRow,
            key: changedNode.nodeKey,
            tier: changedNode.tier.toString(),
            indent: changedNode.indent.toString(),
          };
        }
        // Apply property edits
        if (data.editedNodes) {
          for (const editedNode of data.editedNodes) {
            if (deletedNodeSet.has(editedNode.nodeKey)) continue;
            const existingRow =
              dedupedRowsByNodeKey[editedNode.nodeKey] || technologyData.nodeRowsByKey[editedNode.nodeKey];
            if (!existingRow) continue;
            const updatedRow: Record<string, string | boolean> = { ...existingRow };
            if (editedNode.technologyKey !== undefined && editedNode.technologyKey.trim() !== "") {
              updatedRow.technology_key = editedNode.technologyKey.trim();
            }
            if (editedNode.researchPointsRequired !== undefined) {
              updatedRow.research_points_required = editedNode.researchPointsRequired.toString();
            }
            if (editedNode.requiredParents !== undefined) {
              updatedRow.required_parents = editedNode.requiredParents.toString();
            }
            if (editedNode.campaignKey !== undefined) {
              updatedRow.campaign_key = editedNode.campaignKey;
            }
            if (editedNode.factionKey !== undefined) {
              updatedRow.faction_key = editedNode.factionKey;
            }
            if (editedNode.pixelOffsetX !== undefined) {
              updatedRow.pixel_offset_x = editedNode.pixelOffsetX.toString();
            }
            if (editedNode.pixelOffsetY !== undefined) {
              updatedRow.pixel_offset_y = editedNode.pixelOffsetY.toString();
            }
            dedupedRowsByNodeKey[editedNode.nodeKey] = updatedRow;
          }
        }
        const rows = Object.values(dedupedRowsByNodeKey).map((row) => buildRowFromSchema(schema.fields, row));
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({
            name: `db\\technology_nodes_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }
      }
      // Handle edited nodes in technologies_tables (for display name, building level, etc.)
      if (hasNodeEdits && data.editedNodes) {
        const techSchema = getPreferredSchema("technologies_tables");
        const dedupedRows: Record<string, Record<string, string | boolean>> = {};
        for (const editedNode of data.editedNodes) {
          const nodeRow = technologyData.nodeRowsByKey[editedNode.nodeKey];
          const technologyKey = (editedNode.technologyKey || (nodeRow?.technology_key as string) || "").trim();
          if (!technologyKey) continue;
          const originalTechRow = technologyData.technologyRowsByKey[technologyKey];
          const sourceTechnologyKey = (nodeRow?.technology_key as string) || "";
          const sourceTechRowForClone = technologyData.technologyRowsByKey[sourceTechnologyKey];
          const baseTechRow = originalTechRow || sourceTechRowForClone || {};
          const isBrandNewTechnology = !originalTechRow;
          const updatedRow: Record<string, string | boolean> = {
            ...baseTechRow,
            key: technologyKey,
          };
          if (editedNode.researchPointsRequired !== undefined) {
            updatedRow.research_points_required = editedNode.researchPointsRequired.toString();
          }
          if (editedNode.isHidden !== undefined) {
            updatedRow.is_hidden = editedNode.isHidden ? "true" : "false";
          }
          if (editedNode.iconPath !== undefined) {
            updatedRow.icon_name = getTechnologyIconNameFromPath(editedNode.iconPath);
          }
          if (editedNode.buildingLevel !== undefined) {
            updatedRow.building_level = getTechnologyBuildingLevelForWrite(
              editedNode.buildingLevel,
              originalTechRow || sourceTechRowForClone,
            );
          }
          if (isBrandNewTechnology) {
            updatedRow.unique_index = allocateTechnologyUniqueIndex(usedTechnologyUniqueIndexes);
            updatedRow.is_military = updatedRow.is_military ?? "true";
          }
          dedupedRows[technologyKey] = updatedRow;
        }
        const rows = Object.values(dedupedRows).map((row) => buildRowFromSchema(techSchema.fields, row));
        if (rows.length > 0) {
          const existingTechFile = packFiles.find((f) => f.name.startsWith("db\\technologies_tables\\"));
          if (existingTechFile) {
            // Merge: rebuild with combined rows
            const buffer = await buildDBFileBuffer(techSchema.version, rows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}_edits`,
              file_size: buffer.length,
              buffer,
            });
          } else {
            const buffer = await buildDBFileBuffer(techSchema.version, rows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}`,
              file_size: buffer.length,
              buffer,
            });
          }
        }
      }
      const hasLinkDeletions = data.deletedLinkKeys && data.deletedLinkKeys.length > 0;
      if (data.changedLinks.length > 0 || hasLinkDeletions) {
        const schema = getPreferredSchema("technology_node_links_tables");
        const deletedLinkSet = new Set(data.deletedLinkKeys || []);
        const dedupedRowsByLinkKey: Record<string, Record<string, string | boolean>> = {};
        if (hasLinkDeletions) {
          // Write complete replacement: all original links minus deleted ones
          for (const [linkKey, originalRow] of Object.entries(technologyData.linkRowsByKey)) {
            if (deletedLinkSet.has(linkKey)) continue;
            dedupedRowsByLinkKey[linkKey] = { ...originalRow };
          }
        }
        for (const changedLink of data.changedLinks) {
          const linkKey = `${changedLink.parentKey}|${changedLink.childKey}`;
          if (deletedLinkSet.has(linkKey)) continue;
          const originalRow = technologyData.linkRowsByKey[linkKey] || {};
          dedupedRowsByLinkKey[linkKey] = {
            ...originalRow,
            parent_key: changedLink.parentKey,
            child_key: changedLink.childKey,
            parent_link_position: changedLink.parentLinkPosition.toString(),
            child_link_position: changedLink.childLinkPosition.toString(),
            parent_link_position_offset: changedLink.parentLinkPositionOffset.toString(),
            child_link_position_offset: changedLink.childLinkPositionOffset.toString(),
            initial_descent_tiers: changedLink.initialDescentTiers.toString(),
            visible_in_ui: changedLink.visibleInUi ? "1" : "0",
          };
        }
        const rows = Object.values(dedupedRowsByLinkKey).map((row) => buildRowFromSchema(schema.fields, row));
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({
            name: `db\\technology_node_links_tables\\${tableName}`,
            file_size: buffer.length,
            buffer,
          });
        }
      }
      if (data.hiddenTechnologies.length > 0) {
        const schema = getPreferredSchema("technologies_tables");
        const dedupedRowsByTechnologyKey: Record<string, Record<string, string | boolean>> = {};
        for (const hiddenTechnology of data.hiddenTechnologies) {
          const originalRow = technologyData.technologyRowsByKey[hiddenTechnology.technologyKey];
          if (!originalRow) continue;
          dedupedRowsByTechnologyKey[hiddenTechnology.technologyKey] = {
            ...originalRow,
            key: hiddenTechnology.technologyKey,
            is_hidden: hiddenTechnology.isHidden ? "true" : "false",
            building_level: hiddenTechnology.isHidden ? "wh_main_chs_port_ruin" : originalRow.building_level || "",
          };
        }
        const rows = Object.values(dedupedRowsByTechnologyKey).map((row) => buildRowFromSchema(schema.fields, row));
        if (rows.length > 0) {
          const buffer = await buildDBFileBuffer(schema.version, rows, schema.fields);
          packFiles.push({ name: `db\\technologies_tables\\${tableName}`, file_size: buffer.length, buffer });
        }
      }
      if (data.newNodes && data.newNodes.length > 0) {
        // Write new entries to technology_nodes_tables
        const nodeSchema = getPreferredSchema("technology_nodes_tables");
        const newNodeRows = data.newNodes.map((newNode) =>
          buildRowFromSchema(nodeSchema.fields, {
            key: newNode.nodeKey,
            technology_key: newNode.technologyKey,
            technology_node_set: newNode.setKey,
            tier: newNode.tier.toString(),
            indent: newNode.indent.toString(),
            required_parents: newNode.requiredParents.toString(),
            campaign_key: newNode.campaignKey || "",
            faction_key: newNode.factionKey || "",
            pixel_offset_x: newNode.pixelOffsetX.toString(),
            pixel_offset_y: newNode.pixelOffsetY.toString(),
            research_points_required: newNode.researchPointsRequired.toString(),
          }),
        );
        if (newNodeRows.length > 0) {
          // Merge with any existing changed node rows for the same table
          const existingNodeFile = packFiles.find((f) => f.name.startsWith("db\\technology_nodes_tables\\"));
          if (existingNodeFile) {
            // Re-build with combined rows: need to re-parse existing buffer rows + new rows
            // For simplicity, just add a separate table entry
            const buffer = await buildDBFileBuffer(nodeSchema.version, newNodeRows, nodeSchema.fields);
            packFiles.push({
              name: `db\\technology_nodes_tables\\${tableName}_new`,
              file_size: buffer.length,
              buffer,
            });
          } else {
            const buffer = await buildDBFileBuffer(nodeSchema.version, newNodeRows, nodeSchema.fields);
            packFiles.push({
              name: `db\\technology_nodes_tables\\${tableName}`,
              file_size: buffer.length,
              buffer,
            });
          }
        }
        // Write new entries to technologies_tables
        const techSchema = getPreferredSchema("technologies_tables");
        const newTechRowsByKey = new Map<string, (string | boolean)[]>();
        for (const newNode of data.newNodes) {
          if (technologyData.technologyRowsByKey[newNode.technologyKey]) continue;
          if (newTechRowsByKey.has(newNode.technologyKey)) continue;
          newTechRowsByKey.set(
            newNode.technologyKey,
            buildRowFromSchema(techSchema.fields, {
              key: newNode.technologyKey,
              research_points_required: newNode.researchPointsRequired.toString(),
              icon_name: getTechnologyIconNameFromPath(newNode.iconPath),
              is_hidden: newNode.isHidden ? "true" : "false",
              building_level: getTechnologyBuildingLevelForWrite(newNode.buildingLevel),
              unique_index: allocateTechnologyUniqueIndex(usedTechnologyUniqueIndexes),
              is_military: "true",
            }),
          );
        }
        const newTechRows = [...newTechRowsByKey.values()];
        if (newTechRows.length > 0) {
          const existingTechFile = packFiles.find((f) => f.name.startsWith("db\\technologies_tables\\"));
          if (existingTechFile) {
            const buffer = await buildDBFileBuffer(techSchema.version, newTechRows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}_new`,
              file_size: buffer.length,
              buffer,
            });
          } else {
            const buffer = await buildDBFileBuffer(techSchema.version, newTechRows, techSchema.fields);
            packFiles.push({
              name: `db\\technologies_tables\\${tableName}`,
              file_size: buffer.length,
              buffer,
            });
          }
        }
      }
      const techEffectsSchema = getPreferredSchema("technology_effects_junction_tables");
      const techEffectsRows: (string | boolean)[][] = [];
      const seenTechnologyEffects = new Set<string>();
      let defaultTechnologyEffectScopeFallbackCount = 0;
      const pushTechnologyEffects = (
        technologyKey: string,
        effects: TechEffect[] | undefined,
        sourceTechnologyKey?: string,
      ) => {
        if (!effects || effects.length < 1) return;
        for (const effect of effects) {
          const effectKey = `${effect.effectKey || ""}`.trim();
          if (!effectKey) continue;
          const rowKey = `${technologyKey}|${effectKey}`;
          if (seenTechnologyEffects.has(rowKey)) continue;
          seenTechnologyEffects.add(rowKey);
          const resolvedEffectScope =
            (sourceTechnologyKey
              ? technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey]?.effect_scope
              : undefined) ||
            technologyData.technologyEffectScopesByKey[effectKey] ||
            "default";
          if (resolvedEffectScope === "default") {
            defaultTechnologyEffectScopeFallbackCount += 1;
          }
          techEffectsRows.push(
            buildRowFromSchema(techEffectsSchema.fields, {
              ...(sourceTechnologyKey
                ? technologyData.technologyEffectRowsByKey[sourceTechnologyKey]?.[effectKey] || {}
                : {}),
              technology: technologyKey,
              effect: effectKey,
              effect_scope: resolvedEffectScope,
              value: effect.value || "",
            }),
          );
        }
      };
      if (data.newNodes) {
        for (const newNode of data.newNodes) {
          if (technologyData.technologyRowsByKey[newNode.technologyKey]) continue;
          pushTechnologyEffects(newNode.technologyKey, newNode.effects);
        }
      }
      if (data.editedNodes) {
        for (const editedNode of data.editedNodes) {
          const nodeRow = technologyData.nodeRowsByKey[editedNode.nodeKey];
          const technologyKey = (editedNode.technologyKey || (nodeRow?.technology_key as string) || "").trim();
          if (!technologyKey) continue;
          if (technologyData.technologyRowsByKey[technologyKey]) continue;
          pushTechnologyEffects(technologyKey, editedNode.effects, nodeRow?.technology_key as string | undefined);
        }
      }
      if (techEffectsRows.length > 0) {
        const buffer = await buildDBFileBuffer(techEffectsSchema.version, techEffectsRows, techEffectsSchema.fields);
        packFiles.push({
          name: `db\\technology_effects_junction_tables\\${tableName}`,
          file_size: buffer.length,
          buffer,
        });
      }
      // Write loc entries for new and edited node names/descriptions
      const locRows: (string | boolean)[][] = [];
      if (data.newNodes) {
        for (const newNode of data.newNodes) {
          if (technologyData.technologyRowsByKey[newNode.technologyKey]) continue;
          if (newNode.displayName) {
            locRows.push([`technologies_onscreen_name_${newNode.technologyKey}`, newNode.displayName, false]);
          }
          if (newNode.shortDescription) {
            locRows.push([`technologies_short_description_${newNode.technologyKey}`, newNode.shortDescription, false]);
          }
          if (newNode.longDescription) {
            locRows.push([`technologies_long_description_${newNode.technologyKey}`, newNode.longDescription, false]);
          }
        }
      }
      if (data.editedNodes) {
        for (const editedNode of data.editedNodes) {
          const nodeRow = technologyData.nodeRowsByKey[editedNode.nodeKey];
          const technologyKey = (editedNode.technologyKey || (nodeRow?.technology_key as string) || "").trim();
          if (!technologyKey) continue;
          if (editedNode.displayName !== undefined) {
            locRows.push([`technologies_onscreen_name_${technologyKey}`, editedNode.displayName, false]);
          }
          if (editedNode.shortDescription !== undefined) {
            locRows.push([`technologies_short_description_${technologyKey}`, editedNode.shortDescription, false]);
          }
          if (editedNode.longDescription !== undefined) {
            locRows.push([`technologies_long_description_${technologyKey}`, editedNode.longDescription, false]);
          }
        }
      }
      if (locRows.length > 0) {
        const buildLocFileBuffer = async (rows: (string | boolean)[][]): Promise<Buffer> => {
          const parts: Buffer[] = [];
          parts.push(Buffer.from([0xff, 0xfe]));
          parts.push(Buffer.from([0x4c, 0x4f, 0x43]));
          parts.push(Buffer.from([0x00]));
          const cBuf = Buffer.alloc(4);
          cBuf.writeInt32LE(1, 0);
          parts.push(cBuf);
          const countBuf = Buffer.alloc(4);
          countBuf.writeInt32LE(rows.length, 0);
          parts.push(countBuf);
          for (const row of rows) {
            for (let i = 0; i < LocFields.length; i++) {
              parts.push(await typeToBuffer(LocFields[i].field_type, row[i]));
            }
          }
          return Buffer.concat(parts);
        };
        const buffer = await buildLocFileBuffer(locRows);
        packFiles.push({ name: `text\\db\\${tableName}.loc`, file_size: buffer.length, buffer });
      }
      if (packFiles.length < 1) return { success: false, error: "No technology changes detected" };
      await writePack(packFiles, packPath);
      cachedTechnologyData = undefined;
      cachedTechnologyDataKey = undefined;
      return {
        success: true,
        packPath,
        packName: finalPackName,
        warning:
          defaultTechnologyEffectScopeFallbackCount > 0
            ? `${defaultTechnologyEffectScopeFallbackCount} technology effect row${defaultTechnologyEffectScopeFallbackCount === 1 ? "" : "s"} used fallback effect_scope 'default'.`
            : undefined,
      };
    } catch (error: any) {
      console.error("Failed to save technology changes:", error);
      return { success: false, error: error?.message || String(error) };
    }
  });
  ipcMain.on("getPackData", async (event, packPath: string, table?: DBTable) => {
    getPackData(packPath, table);
  });
  ipcMain.on("getPackDataWithLocs", async (event, packPath: string, table?: DBTable) => {
    getPackData(packPath, table, true);
  });
  const getLiveViewerWindow = () => {
    if (!windows.viewerWindow) return undefined;
    if (windows.viewerWindow.isDestroyed()) {
      windows.viewerWindow = undefined;
      appData.isViewerReady = false;
      return undefined;
    }
    return windows.viewerWindow;
  };
  const createViewerWindow = () => {
    if (getLiveViewerWindow()) return;
    const viewerWindowState = windowStateKeeper({
      file: "viewer_window.json",
      defaultWidth: 1280,
      defaultHeight: 900,
    });
    windows.viewerWindow = new BrowserWindow({
      x: viewerWindowState.x,
      y: viewerWindowState.y,
      width: viewerWindowState.width,
      height: viewerWindowState.height,
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#374151",
        symbolColor: "#9ca3af",
        height: 28,
      },
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: VIEWER_PRELOAD_WEBPACK_ENTRY,
        spellcheck: false,
      },
      title: "WH3 Mod Manager Mod Viewer",
      icon: "./assets/modmanager.ico",
    });
    const viewerWindow = windows.viewerWindow;
    const viewerWebContentsId = viewerWindow.webContents.id;
    viewerWindowState.manage(viewerWindow);
    viewerWindow.loadURL(VIEWER_WEBPACK_ENTRY);
    viewerWindow.on("page-title-updated", (evt) => {
      evt.preventDefault();
    });
    viewerWindow.on("closed", () => {
      dbIndirectReferenceCacheByWebContentsId.delete(viewerWebContentsId);
      dbDuplicationCancelStateByWebContentsId.delete(viewerWebContentsId);
      if (windows.viewerWindow === viewerWindow) {
        windows.viewerWindow = undefined;
      }
      appData.isViewerReady = false;
    });
  };
  const createSkillsWindow = () => {
    if (windows.skillsWindow) return;
    const skillsWindowState = windowStateKeeper({
      file: "skills_window.json",
      defaultWidth: 1280,
      defaultHeight: 900,
    });
    windows.skillsWindow = new BrowserWindow({
      x: skillsWindowState.x,
      y: skillsWindowState.y,
      width: skillsWindowState.width,
      height: skillsWindowState.height,
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#374151",
        symbolColor: "#9ca3af",
        height: 28,
      },
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: SKILLS_PRELOAD_WEBPACK_ENTRY,
        spellcheck: false,
      },
      title: "WH3 Mod Manager Mod Viewer",
      icon: "./assets/modmanager.ico",
    });
    skillsWindowState.manage(windows.skillsWindow);
    windows.skillsWindow.loadURL(SKILLS_WEBPACK_ENTRY);
    windows.skillsWindow.on("page-title-updated", (evt) => {
      evt.preventDefault();
    });
    windows.skillsWindow.on("closed", () => {
      windows.skillsWindow = undefined;
      appData.areSkillsReady = false;
    });
  };
  const createTechTreesWindow = () => {
    if (windows.techTreesWindow) return;
    const techTreesWindowState = windowStateKeeper({
      file: "tech_trees_window.json",
      defaultWidth: 1280,
      defaultHeight: 900,
    });
    windows.techTreesWindow = new BrowserWindow({
      x: techTreesWindowState.x,
      y: techTreesWindowState.y,
      width: techTreesWindowState.width,
      height: techTreesWindowState.height,
      autoHideMenuBar: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#374151",
        symbolColor: "#9ca3af",
        height: 28,
      },
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        preload: TECH_TREES_PRELOAD_WEBPACK_ENTRY,
        spellcheck: false,
      },
      title: "WH3 Mod Manager Tech Trees",
      icon: "./assets/modmanager.ico",
    });
    techTreesWindowState.manage(windows.techTreesWindow);
    windows.techTreesWindow.loadURL(TECH_TREES_WEBPACK_ENTRY);
    windows.techTreesWindow.on("page-title-updated", (evt) => {
      evt.preventDefault();
    });
    windows.techTreesWindow.on("closed", () => {
      windows.techTreesWindow = undefined;
    });
  };
  const openModInViewerWindow = (modPath: string) => {
    for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
      const baseVanillaPackName = vanillaPackData.name;
      if (modPath == baseVanillaPackName) {
        modPath = nodePath.join(
          appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string,
          baseVanillaPackName,
        );
      }
    }
    console.log("ON requestOpenModInViewer", modPath);
    appData.lastOpenedViewerPackPath = modPath;
    let viewerWindow = getLiveViewerWindow();
    if (!viewerWindow) {
      createViewerWindow();
      viewerWindow = getLiveViewerWindow();
    }
    getPackData(modPath);
    if (viewerWindow?.webContents && !viewerWindow.webContents.isDestroyed() && appData.isViewerReady) {
      viewerWindow.webContents.send("openModInViewer", modPath);
      viewerWindow.setTitle(`WH3 Mod Manager v${version}: viewing ${nodePath.basename(modPath)}`);
      viewerWindow.focus();
    } else if (viewerWindow) {
      viewerWindow.focus();
    }
  };
  openModInViewerFromMainProcess = openModInViewerWindow;

  ipcMain.on("requestOpenModInViewer", (_event, modPath: string) => openModInViewerWindow(modPath));
  ipcMain.on("requestOpenSkillsWindow", async (event, mods: Mod[]) => {
    console.log("ON requestOpenSkillsWindow");
    const enabledMods = mods.filter((mod) => mod.isEnabled);
    appData.enabledMods = enabledMods;
    if (windows.skillsWindow) {
      windows.skillsWindow.focus();
      return;
    }

    const skillsDataSignature = buildSkillsDataSignature(enabledMods, appData.currentGame);
    if (appData.skillsData && appData.lastSkillsDataSignature === skillsDataSignature) {
      const cachedSelection = getCachedSkillsSelection();
      if (cachedSelection) {
        await getSkillsForSubtype(cachedSelection.currentSubtype, cachedSelection.currentSubtypeIndex);
      }
      createSkillsWindow();
      return;
    }

    getSkillsData(enabledMods);
    createSkillsWindow();
  });
  ipcMain.on("requestSkillsData", (event, mods: Mod[]) => {
    console.log("ON requestSkillsData");
    appData.enabledMods = mods.filter((mod) => mod.isEnabled);
    getSkillsData(mods.filter((mod) => mod.isEnabled));
  });
  ipcMain.on("requestOpenTechTreesWindow", () => {
    console.log("ON requestOpenTechTreesWindow");
    if (appData.currentGame !== "wh3") return;
    if (windows.techTreesWindow) {
      windows.techTreesWindow.focus();
    } else {
      createTechTreesWindow();
    }
  });
  ipcMain.on("setSkillsViewOptions", (event, skillsViewOptions: SkillsViewOptions) => {
    appData.isShowingSkillNodeSetNames = skillsViewOptions.isShowingSkillNodeSetNames;
    appData.isShowingHiddenSkills = skillsViewOptions.isShowingHiddenSkills;
    appData.isShowingHiddenModifiersInsideSkills = skillsViewOptions.isShowingHiddenModifiersInsideSkills;
    appData.isCheckingSkillRequirements = skillsViewOptions.isCheckingSkillRequirements;
    windows.mainWindow?.webContents.send("setSkillsViewOptions", skillsViewOptions);
    windows.skillsWindow?.webContents.send("setSkillsViewOptions", skillsViewOptions);
  });
  ipcMain.on("requestLanguageChange", async (event, language: string) => {
    console.log("requestLanguageChange:", language);
    await i18n.changeLanguage(language);
    appData.currentLanguage = language as SupportedLanguage;
    windows.mainWindow?.webContents.send("setCurrentLanguage", language);
    windows.skillsWindow?.webContents.send("setCurrentLanguage", language);
    windows.viewerWindow?.webContents.send("setCurrentLanguage", language);
    windows.techTreesWindow?.webContents.send("setCurrentLanguage", language);
  });
  ipcMain.on("requestGameChange", async (event, game: SupportedGames, payload: ConfigSavePayload) => {
    // console.log("game before change is", appData.currentGame, "to", game);
    console.log(`Requesting game change to ${game}`);
    console.log(`Current game is ${payload.currentGame}`);
    // Capture even a not-yet-debounced edit before leaving. writeAppConfig updates gameToConfig
    // synchronously before its queued disk write, so returning later uses this exact state.
    applyConfigSavePayloadToAppData(payload);
    writeAppConfig(payload);
    const didSwitchGame = await setCurrentGame(game);
    // Until the requested game's folders are configured, main and renderer both remain on the old
    // game. refreshModsIfFoldersValid completes the switch after a folder is selected.
    if (!didSwitchGame) return;

    const gameConfig = appData.gameToConfig[game];
    console.log("SENDING setCurrentGame", game);
    mainWindow?.webContents.send(
      "setCurrentGame",
      game,
      gameConfig.currentPreset,
      gameConfig.presets,
      gameConfig.modUserData,
    );
  });
  const terminateCurrentGame = () => {
    const name = gameToProcessName[appData.currentGame];
    try {
      switch (process.platform) {
        case "win32": {
          exec(`taskkill /f /t /im ${name}`, (error) => {
            if (error) console.error("taskkill error:", error);
          });
          break;
        }
        case "linux": {
          exec(`pkill -f ${name}`, (error) => {
            if (error) console.error("pkill error:", error);
          });
          break;
        }
      }
    } catch (e) {
      console.error("killWrapper error:", e);
    }
  };
  ipcMain.on("terminateGame", () => {
    terminateCurrentGame();
  });
  const dbTableToString = (dbTable: DBTable) => {
    // Honours dbFolder so a spare copy is read from where it actually lives, not from db\.
    return getDBPackedFilePath(dbTable as DBTableSelection);
  };
  const viewerTableRequests = createInFlightTableRequests();
  const sendPackViewData = (packViewData: PackViewData | undefined) => {
    if (!packViewData) return;
    const toSend = [packViewData];
    const viewerWindow = getLiveViewerWindow();
    mainWindow?.webContents.send("setPacksData", toSend);
    viewerWindow?.webContents.send("setPacksData", toSend);
    // Main-window consumers also request pack data. Queue it only when a viewer window actually
    // exists and is still starting; otherwise a future viewer would receive an unrelated stale pack.
    if (viewerWindow && !appData.isViewerReady) {
      console.log("VIEWER NOT READY, QUEUEING");
      appData.queuedViewerData = toSend;
    }
  };

  const getLoadedPackViewData = (pack: Pack, table: DBTable): PackViewData | undefined => {
    const packedFilePath = dbTableToString(table);
    const packedFiles = pack.packedFiles.filter(
      (packedFile) =>
        packedFile.name.startsWith(packedFilePath) &&
        packedFile.tableSchema != undefined &&
        packedFile.schemaFields != undefined,
    );
    if (packedFiles.length === 0) return undefined;

    return {
      packName: pack.name,
      packPath: pack.path,
      tables: pack.packedFiles.map((packedFile) => packedFile.name),
      packedFiles: Object.fromEntries(packedFiles.map((packedFile) => [packedFile.name, packedFile])),
    };
  };

  const getPackData = async (packPath: string, table?: DBTable, getLocs?: boolean) => {
    console.log(`getPackData ${packPath}`);
    // A loc is parsed by the loc reader, not the db one, so asking for it has to turn that on.
    if (table && isLocPackedFilePath(dbTableToString(table))) getLocs = true;
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (table) console.log("GETTING TABLE ", table.dbName, table.dbSubname);
    for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
      const baseVanillaPackName = vanillaPackData.name;
      if (packPath == baseVanillaPackName || nodePath.basename(packPath) == baseVanillaPackName) {
        if (!dataFolder) {
          console.log("WAIT FOR DATAFOLDER TO BE SET");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          console.log("DONE WAITING FOR DATAFOLDER");
          getPackData(packPath, table, getLocs);
          return;
        }
        if (packPath == baseVanillaPackName) {
          console.log("data folder is", dataFolder);
          packPath = nodePath.join(dataFolder as string, baseVanillaPackName);
        }
      }
    }
    console.log("CURRENTLY READING:", packReads.reading());
    console.log("before join", dataFolder, packPath);
    if (!packPath.includes("\\")) {
      // if we provided pack name instead of pack path as argument
      if (!dataFolder) {
        console.log("WAIT FOR DATAFOLDER TO BE SET");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("DONE WAITING FOR DATAFOLDER");
        getPackData(packPath, table, getLocs);
        return;
      }
      packPath = nodePath.join(dataFolder as string, packPath);
    }
    const packedFilePath = table ? dbTableToString(table) : "";
    const requestKey = JSON.stringify([packPath, packedFilePath, Boolean(getLocs)]);
    await viewerTableRequests.run(requestKey, async () => {
      const packData = appData.packsData.find((pack) => pack.path === packPath);

      if (packData && !table) {
        sendPackViewData(getPackViewData(packData, undefined, getLocs));
        return;
      }

      // A parsed table retained by the main process is already in renderer-ready form. Do not amend
      // every cell again merely because a second window asked for it.
      if (packData && table && !getLocs) {
        const loaded = getLoadedPackViewData(packData, table);
        if (loaded) {
          sendPackViewData(loaded);
          return;
        }
      }

      console.log(`READING ${packPath}${packedFilePath ? `:${packedFilePath}` : ""}`);
      // The retained pack supplies the file index. Only when this is the first request for the pack
      // do we read that index from disk. The selected descriptor is cloned because filling and view
      // preparation mutate it.
      const readFromCache = async () => {
        if (!packedFilePath || getLocs || !canUseVanillaDbCacheForPack(packPath)) return undefined;

        const indexedPack = packData ?? (await readPack(packPath, { skipParsingTables: true }));
        const cloned = clonePackIndexForTable(indexedPack, packedFilePath);
        if (!cloned) return undefined;
        // getDBVersion is the same resolver getPackViewData uses below, so a disagreement about the
        // layout is caught here rather than chunking the rows by the wrong field count.
        const filled = await fillPackedFileFromVanillaCache(packPath, packedFilePath, cloned.packedFile, getDBVersion);
        if (!filled) return undefined;
        console.log(`vanilla db cache served ${packedFilePath}`);
        return cloned.pack;
      };

      const newPack =
        (await readFromCache()) ??
        (await readPack(packPath, table && { tablesToRead: [packedFilePath], readLocs: getLocs }));
      if (appData.packsData.every((pack) => pack.path != packPath)) {
        console.log("APPENDING packsData", packPath);
        appendPacksData(newPack);
      }
      sendPackViewData(getPackViewData(newPack, table, getLocs));
    });
  };
  const readMods = async (
    mods: Mod[],
    skipParsingTables = true,
    skipCollisionCheck = true,
    readScripts = false,
    readLocs = false,
    tablesToRead?: string[],
    filesToRead?: string[],
    emitToMainWindow = true,
  ) => {
    if (!skipParsingTables) {
      appData.packsData = appData.packsData.filter((pack) => !mods.some((mod) => mod.path == pack.path));
    }
    for (const mod of mods) {
      // Wait for a read of this mod already in flight before deciding. Skipping on it left the mod
      // out of packsData entirely when parsing was asked for, since the filter above has already
      // dropped it - a catalog built here would then be missing that mod altogether.
      if (!(await packReads.waitUntilFree(mod.path))) {
        console.log("readMods: waited too long for a read of", mod.path, "to end, reading it anyway");
      }
      if (appData.packsData.every((pack) => pack.path != mod.path)) {
        console.log("READING " + mod.name);
        if (!skipParsingTables && emitToMainWindow) mainWindow?.webContents.send("setCurrentlyReadingMod", mod.name);
        const newPack = await readPackWhileRegistered(mod.path, {
          skipParsingTables,
          readScripts,
          tablesToRead,
          filesToRead,
          readLocs,
        });
        if (!skipParsingTables && emitToMainWindow) mainWindow?.webContents.send("setLastModThatWasRead", mod.name);
        if (appData.packsData.every((pack) => pack.path != mod.path)) {
          appendPacksData(newPack, mod, emitToMainWindow);
        }
        if (!skipCollisionCheck) {
          appendCollisions(newPack);
        }
      }
    }
    if (!skipCollisionCheck) {
      mainWindow?.webContents.send("setPackCollisions", {
        packFileCollisions: appData.compatData.packFileCollisions,
        packTableCollisions: appData.compatData.packTableCollisions,
      } as PackCollisions);
    }
  };
  let lastReadModsReceived = [];
  ipcMain.on(
    "readMods",
    async (
      event,
      mods: Mod[],
      skipCollisionCheck = true,
      canUseCustomizableCache = true,
      customizableModsHash?: string,
    ) => {
      let modsToRead = mods;
      if (canUseCustomizableCache) {
        const customizableModsCache = await loadCustomizableModsCache();
        const customizableModsCachePaths = Object.keys(customizableModsCache);
        const modsNotInCustomizableCache = mods.filter((mod) => !customizableModsCachePaths.includes(mod.path));
        if (modsNotInCustomizableCache.length == 0) {
          console.log("Skipping readMods, all are already in the customizable mods cache!");
          if (customizableModsHash != hash(appData.customizableMods)) {
            console.log("Skipping setCustomizableMods in readMods, hash is the same!");
            mainWindow?.webContents.send("setCustomizableMods", appData.customizableMods);
          }
          return;
        }
        modsToRead = modsNotInCustomizableCache;
      }
      if (lastReadModsReceived.length != mods.length) {
        console.log(
          "READ MODS RECEIVED",
          mods.map((mod) => mod.name),
        );
        lastReadModsReceived = [...mods];
      }
      readMods(modsToRead, skipCollisionCheck, skipCollisionCheck);
    },
  );
  const sendQueuedDataToViewer = async () => {
    if (!appData.isViewerReady) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      sendQueuedDataToViewer();
      return;
    }
    console.log("SENDING QUEUED DATA TO VIEWER");
    const queuedPackPath = appData.queuedViewerData[0]?.packPath;
    if (queuedPackPath) {
      appData.lastOpenedViewerPackPath = queuedPackPath;
    }
    windows.viewerWindow?.webContents.send("setCurrentGameNaive", appData.currentGame);
    windows.viewerWindow?.webContents.send("setPacksData", appData.queuedViewerData);
    windows.viewerWindow?.webContents.send("openModInViewer", queuedPackPath);
    if (queuedPackPath)
      windows.viewerWindow?.setTitle(`WH3 Mod Manager v${version}: viewing ${nodePath.basename(queuedPackPath)}`);
    windows.viewerWindow?.focus();
    appData.queuedViewerData = [];
  };
  ipcMain.on("viewerIsReady", async () => {
    console.log("VIEWER IS NOW READY");
    appData.isViewerReady = true;
    await initializeAllSchemaForGame(appData.currentGame);
    console.log("viewerIsReady appData.currentGame", appData.currentGame);
    if (isDev) {
      setTimeout(() => {
        windows.viewerWindow?.webContents.openDevTools({ mode: "right" });
      }, 1000);
    }
    windows.viewerWindow?.webContents.send(
      "setDBNameToDBVersions",
      DBNameToDBVersions[appData.currentGame],
      gameToDBFieldsThatReference[appData.currentGame],
      gameToReferences[appData.currentGame],
    );
    windows.viewerWindow?.webContents.send("setStartArgs", appData.startArgs);
    windows.viewerWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    windows.viewerWindow?.webContents.send("setIsFeaturesForModdersEnabled", appData.isFeaturesForModdersEnabled);
    windows.viewerWindow?.webContents.send("setModdersPrefix", appData.moddersPrefix);
    // console.log("QUEUED DATA IS ", queuedViewerData);
    if (appData.queuedViewerData.length > 0) {
      sendQueuedDataToViewer();
    } else if (appData.lastOpenedViewerPackPath) {
      windows.viewerWindow?.webContents.send("setCurrentGameNaive", appData.currentGame);
      getPackData(appData.lastOpenedViewerPackPath);
      windows.viewerWindow?.webContents.send("openModInViewer", appData.lastOpenedViewerPackPath);
      windows.viewerWindow?.setTitle(
        `WH3 Mod Manager v${version}: viewing ${nodePath.basename(appData.lastOpenedViewerPackPath)}`,
      );
    }
  });
  const sendQueuedDataToSkills = async () => {
    if (!appData.queuedSkillsData) {
      console.log("sendQueuedDataToSkills called but queuedSkillsData not ready");
      return;
    }
    if (!appData.areSkillsReady) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      sendQueuedDataToSkills();
      return;
    }
    console.log("SENDING QUEUED DATA TO SKILLS");
    // windows.skillsWindow?.webContents.send("setCurrentGameNaive", appData.currentGame);
    windows.skillsWindow?.webContents.send("setSkillsData", appData.queuedSkillsData);
    windows.skillsWindow?.webContents.send("setIsFeaturesForModdersEnabled", appData.isFeaturesForModdersEnabled);
    windows.skillsWindow?.focus();
    appData.queuedSkillsData = undefined;
  };
  const pushSkillsDataToMainWindow = () => {
    if (!appData.queuedSkillsData) return;
    windows.mainWindow?.webContents.send("setSkillsData", appData.queuedSkillsData);
  };
  ipcMain.on("skillsAreReady", () => {
    console.log("SKILLS ARE NOW READY");
    appData.areSkillsReady = true;
    if (isDev) {
      setTimeout(() => {
        windows.skillsWindow?.webContents.openDevTools({ mode: "right" });
      }, 1000);
    }
    windows.skillsWindow?.webContents.send("setStartArgs", appData.startArgs);
    windows.skillsWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    windows.skillsWindow?.webContents.send("setIsFeaturesForModdersEnabled", appData.isFeaturesForModdersEnabled);
    windows.skillsWindow?.webContents.send("setModdersPrefix", appData.moddersPrefix);
    windows.skillsWindow?.webContents.send("setSkillsViewOptions", {
      isShowingSkillNodeSetNames: appData.isShowingSkillNodeSetNames,
      isShowingHiddenSkills: appData.isShowingHiddenSkills,
      isShowingHiddenModifiersInsideSkills: appData.isShowingHiddenModifiersInsideSkills,
      isCheckingSkillRequirements: appData.isCheckingSkillRequirements,
    } as SkillsViewOptions);
    // console.log("QUEUED DATA IS ", queuedViewerData);
    if (appData.queuedSkillsData) {
      sendQueuedDataToSkills();
    }
  });
  ipcMain.on("techTreesAreReady", () => {
    console.log("TECH TREES ARE NOW READY");
    if (isDev) {
      setTimeout(() => {
        windows.techTreesWindow?.webContents.openDevTools({ mode: "right" });
      }, 1000);
    }
    windows.techTreesWindow?.webContents.send("setStartArgs", appData.startArgs);
    windows.techTreesWindow?.webContents.send("setCurrentLanguage", appData.currentLanguage);
    windows.techTreesWindow?.webContents.send("setIsFeaturesForModdersEnabled", appData.isFeaturesForModdersEnabled);
    windows.techTreesWindow?.webContents.send("setModdersPrefix", appData.moddersPrefix);
  });
  ipcMain.on("openFolderInExplorer", (event, path: string) => {
    shell.showItemInFolder(path);
  });
  ipcMain.on("openDirectoryInExplorer", (event, path: string) => {
    void shell.openPath(path);
  });
  ipcMain.removeHandler("openDiagnosticPath");
  ipcMain.handle(
    "openDiagnosticPath",
    async (_event, target: DiagnosticPathTarget, copyPath: boolean): Promise<DiagnosticPathResult> => {
      try {
        let targetPath: string;

        if (target === "appLogFile") {
          targetPath = electronLog.transports.file.getFile().path;
        } else if (target === "appLogsFolder") {
          targetPath = nodePath.dirname(electronLog.transports.file.getFile().path);
        } else if (target === "latestGameScriptLog") {
          const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
          if (!gamePath) {
            return { success: false, error: "The game folder is not configured." };
          }

          const latestScriptLog = await findLatestScriptLog(gamePath);
          if (!latestScriptLog) {
            return {
              success: false,
              error: `No script_log_* files were found in ${gamePath}.`,
            };
          }
          targetPath = latestScriptLog;
        } else {
          return { success: false, error: "Unknown log path target." };
        }

        if (copyPath) {
          clipboard.writeText(targetPath);
          return { success: true, path: targetPath };
        }

        const openError = await shell.openPath(targetPath);
        if (openError) return { success: false, path: targetPath, error: openError };
        return { success: true, path: targetPath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  const openInSteam = (url: string) => {
    exec(`start steam://openurl/${url}`);
  };
  ipcMain.on("openInSteam", (event, url: string) => {
    openInSteam(url);
  });
  ipcMain.on("openPack", (event, path: string) => {
    shell.openPath(path);
  });
  ipcMain.on("putPathInClipboard", (event, path: string) => {
    clipboard.writeText(path);
  });
  ipcMain.on("copyModToData", (event, path: string) => {
    const baseName = nodePath.basename(path);
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
    if (!dataFolder) return;
    const destPath = nodePath.join(dataFolder, baseName);
    fs.copyFileSync(path, destPath);
  });
  const checkIsModThumbnailValid = (modThumbnailPath: string) => {
    if (modThumbnailPath == "" || !fs.existsSync(modThumbnailPath)) {
      mainWindow?.webContents.send("addToast", {
        type: "warning",
        messages: ["loc:missingModThumbnail"],
        startTime: Date.now(),
      } as Toast);
      return false;
    }
    if (fs.statSync(modThumbnailPath).size > 1024 * 1024) {
      mainWindow?.webContents.send("addToast", {
        type: "warning",
        messages: ["loc:thumbnailTooBig"],
        startTime: Date.now(),
      } as Toast);
      return false;
    }
    return true;
  };
  ipcMain.on("uploadMod", async (event, mod: Mod) => {
    if (!checkIsModThumbnailValid(mod.imgPath)) return;
    const child = fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "upload"], {});
    child.on("message", (response: ModUploadResponseError | ModUploadResponseSuccess) => {
      console.log("upload response:", response);
      if (response && "type" in response) {
        switch (response.type) {
          case "success":
            mainWindow?.webContents.send("addToast", {
              type: "success",
              messages: ["loc:modCreated"],
              startTime: Date.now(),
            } as Toast);
            if ("needsToAcceptAgreement" in response && response.needsToAcceptAgreement) {
              mainWindow?.webContents.send("addToast", {
                type: "info",
                messages: ["loc:needsToAcceptSteamWorkshopAgreement"],
                startTime: Date.now(),
              } as Toast);
            }
            updateMod(mod, response.workshopId, mod.tags, mod.name, true);
            break;
          case "error":
            mainWindow?.webContents.send("addToast", {
              type: "warning",
              messages: ["loc:failedUploadingMod"],
              startTime: Date.now(),
            } as Toast);
            break;
        }
      }
    });
  });
  const updateMod = async (
    mod: Mod,
    workshopId: string,
    tags: string[],
    modTitle?: string,
    openInSteamAfterUpdate = false,
  ) => {
    const uploadFolderName = workshopId;
    const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_uploads_" + uploadFolderName);
    if (!checkIsModThumbnailValid(mod.imgPath)) return;
    await fs.rmSync(uploadFolderPath, { recursive: true, force: true });
    await fs.mkdirSync(uploadFolderPath, { recursive: true });
    await fs.linkSync(mod.path, nodePath.join(uploadFolderPath, mod.name));
    await fs.linkSync(mod.imgPath, nodePath.join(uploadFolderPath, nodePath.basename(mod.imgPath)));
    const args = [
      gameToSteamId[appData.currentGame],
      "update",
      workshopId,
      uploadFolderPath,
      mod.imgPath,
      tags.join(";"),
    ];
    console.log("UPDATING MOD:", modTitle, tags);
    // return;
    if (modTitle) args.push(modTitle);
    const child = fork(nodePath.join(__dirname, "sub.js"), args, {});
    child.on("message", (response: ModUpdateResponseError | ModUpdateResponseProgress | ModUpdateResponseSuccess) => {
      console.log("update response:", response);
      if (response && "type" in response) {
        switch (response.type) {
          case "success":
            mainWindow?.webContents.send("addToast", {
              type: "success",
              messages: ["loc:modUpdated"],
              startTime: Date.now(),
            } as Toast);
            if ("needsToAcceptAgreement" in response && response.needsToAcceptAgreement) {
              mainWindow?.webContents.send("addToast", {
                type: "info",
                messages: ["loc:needsToAcceptSteamWorkshopAgreement"],
                startTime: Date.now(),
              } as Toast);
            }
            fs.rmSync(uploadFolderPath, { recursive: true, force: true });
            if (openInSteamAfterUpdate) {
              openInSteam(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`);
            }
            break;
          case "error":
            mainWindow?.webContents.send("addToast", {
              type: "warning",
              messages: ["loc:failedUpdatingMod"],
              startTime: Date.now(),
            } as Toast);
            if ("err" in response) {
              try {
                console.log(response.err);
              } catch (e) {
                /* empty */
              }
            }
            fs.rmSync(uploadFolderPath, { recursive: true, force: true });
            break;
          case "progress":
            if ("progress" in response && "total" in response && response.total > 0) {
              mainWindow?.webContents.send("addToast", {
                type: "info",
                messages: [
                  "loc:uploadingMod",
                  `${Math.round((<number>response.progress / <number>response.total + Number.EPSILON) * 100)}%`,
                ],
                startTime: Date.now(),
                staticToastId: uploadFolderPath,
              } as Toast);
            }
            break;
        }
      }
      //
    });
  };
  ipcMain.on("updateMod", async (event, mod: Mod, contentMod: Mod) => {
    updateMod(mod, contentMod.workshopId, contentMod.tags);
  });
  ipcMain.on("fakeUpdatePack", async (event, mod: Mod) => {
    try {
      const backupFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_backups");
      const backupFilePath = nodePath.join(
        backupFolderPath,
        nodePath.parse(mod.name).name + "-" + format(new Date(), "dd-MM-yyyy-HH-mm") + nodePath.parse(mod.name).ext,
      );
      const uploadFilePath = nodePath.join(
        backupFolderPath,
        nodePath.parse(mod.name).name + "-NEW-" + format(new Date(), "dd-MM-yyyy-HH-mm") + nodePath.parse(mod.name).ext,
      );
      await fs.mkdirSync(backupFolderPath, { recursive: true });
      await fs.copyFileSync(mod.path, backupFilePath);
      await addFakeUpdate(mod.path, uploadFilePath);
      const command = `cd /d "${nodePath.dirname(mod.path)}" && del "${nodePath.basename(
        mod.path,
      )}" && move /y "whmm_backups\\${nodePath.basename(uploadFilePath)}" "${nodePath.basename(mod.path)}"`;
      console.log(command);
      exec(command);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("makePackBackup", async (event, mod: Mod) => {
    try {
      const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_backups");
      const backupFilePath = nodePath.join(
        uploadFolderPath,
        nodePath.parse(mod.name).name + "-" + format(new Date(), "dd-MM-yyyy-HH-mm") + nodePath.parse(mod.name).ext,
      );
      await fs.mkdirSync(uploadFolderPath, { recursive: true });
      await fs.copyFileSync(mod.path, backupFilePath);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on(
    "importSteamCollection",
    async (
      event,
      steamCollectionURL: string,
      isImmediateImport: boolean,
      doDisableOtherMods: boolean,
      isLoadOrdered: boolean,
      doCreatePreset: boolean,
      presetName: string,
      isPresetLoadOrdered: boolean,
    ) => {
      try {
        console.log("getting steamCollectionURL:", steamCollectionURL);
        const res = await fetch(steamCollectionURL);
        const cheerioObj = cheerio.load(await res.text());
        const collectionTitle = cheerioObj(".collectionHeaderContent").find(".workshopItemTitle").text();
        console.log("collection title:", collectionTitle);
        const modIds = cheerioObj(".collectionItem")
          .map((_, elem) => elem.attribs["id"].replace("sharedfile_", ""))
          .toArray();
        if (!collectionTitle) return;
        mainWindow?.webContents.send("importSteamCollectionResponse", {
          name: collectionTitle,
          modIds,
          isImmediateImport,
          doDisableOtherMods,
          isLoadOrdered,
          doCreatePreset,
          presetName,
          isPresetLoadOrdered,
        } as ImportSteamCollection);
        console.log(modIds);
      } catch (e) {
        console.log(e);
      }
    },
  );
  ipcMain.on("forceModDownload", async (event, mod: Mod) => {
    try {
      fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "download", mod.workshopId], {});
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("reMerge", async (event, mod: Mod, modsToMerge: Mod[]) => {
    try {
      mergeMods(modsToMerge, mod.path);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("deletePack", async (event, mod: Mod) => {
    try {
      await fsExtra.remove(mod.path);
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("forceDownloadMods", async (event, modIds: string[]) => {
    try {
      for (const id of modIds) {
        if (!appData.waitForModIds.includes(id)) {
          appData.waitForModIds.push(id);
        }
      }
      fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "download", modIds.join(";")], {});
    } catch (e) {
      console.log(e);
    }
  });
  const resubscribeToMods = async (modIds: string[]) => {
    await subscribeToMods(modIds);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "getSubscribedIds"],
        {},
      );
      child.on("message", (workshopIds: string[]) => {
        console.log("getSubscribedIds returned:", workshopIds);
        const failedToSubTo = modIds.filter((modId) => !workshopIds.includes(modId));
        console.log("failedToSubTo:", failedToSubTo);
        if (failedToSubTo.length > 0) {
          resubscribeToMods(failedToSubTo);
        }
      });
    } catch (e) {
      console.log(e);
    }
  };
  const forceResubscribeMods = (mods: Mod[]) => {
    try {
      appData.modsToResubscribeTo = mods;
      const mod = mods[0];
      mainWindow?.webContents.send("addToast", {
        type: "info",
        messages: [
          "loc:resubscribing",
          mod.humanName != "" ? mod.humanName : mod.name,
          "loc:queue",
          (mods.length - 1).toString(),
        ],
        startTime: Date.now(),
      } as Toast);
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
        {},
      );
      child.on("message", async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        console.log("unsubscribe finished, deleting file:", mod.path);
        try {
          fsExtra.removeSync(nodePath.dirname(mod.path));
        } catch (e) {
          /* empty */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        resubscribeToMods([mod.workshopId]);
      });
    } catch (e) {
      console.log(e);
    }
  };
  let activeWorkshopRepair:
    | {
        workshopIds: Set<string>;
        cancelAndGetMods: () => Mod[];
      }
    | undefined;
  ipcMain.on("repairOutdatedWorkshopMods", (event, requests: WorkshopModRepairRequest[]) => {
    const validRequests = requests.flatMap(({ mod, remoteTimestampMs }) => {
      if (!/^\d+$/.test(mod.workshopId) || !Number.isFinite(remoteTimestampMs) || remoteTimestampMs <= 0) {
        return [];
      }
      const knownWorkshopMod = appData.allMods.find(
        (knownMod) => isWorkshopMod(knownMod) && knownMod.workshopId === mod.workshopId,
      );
      return knownWorkshopMod ? [{ mod: knownWorkshopMod, remoteTimestampMs }] : [];
    });
    if (validRequests.length === 0) return;

    const workshopIds = validRequests.map(({ mod }) => mod.workshopId);
    const expectedTimestamps = validRequests
      .map(({ mod, remoteTimestampMs }) => `${mod.workshopId}:${Math.floor(remoteTimestampMs / 1000)}`)
      .join(";");
    let receivedFinalResult = false;
    let startedItems: WorkshopUpdateCheckItem[] = [];
    let didStartFallback = false;
    let repairChild: ReturnType<typeof fork> | undefined;
    let thisWorkshopRepair: typeof activeWorkshopRepair;

    const clearActiveWorkshopRepair = () => {
      if (activeWorkshopRepair === thisWorkshopRepair) activeWorkshopRepair = undefined;
    };

    const cancelAndGetMods = () => {
      const repairMods = validRequests.map(({ mod }) => mod);
      if (receivedFinalResult || didStartFallback) return repairMods;
      receivedFinalResult = true;
      didStartFallback = true;
      clearActiveWorkshopRepair();
      const items =
        startedItems.length > 0
          ? startedItems
          : validRequests.map(({ mod }): WorkshopUpdateCheckItem => ({
              workshopId: mod.workshopId,
              initialState: 0,
              finalState: 0,
              status: "requested",
              requestAccepted: true,
            }));
      mainWindow.webContents.send("workshopUpdateCheck", {
        type: "finished",
        checkedCount: validRequests.length,
        items: items.map((item) => ({
          ...item,
          status: "resubscribing" as const,
          error: "Force update cancelled by the user.",
        })),
      } satisfies WorkshopUpdateCheckMessage);
      repairChild?.kill();
      log(`[Workshop repair] force update cancelled; resubscribing ${repairMods.length} mod(s)`);
      return repairMods;
    };

    const fallbackToResubscribe = (items: WorkshopUpdateCheckItem[], reason: string) => {
      if (didStartFallback) return;
      didStartFallback = true;
      clearActiveWorkshopRepair();
      const failedIds = new Set(items.map((item) => item.workshopId));
      const modsToResubscribe = validRequests.filter(({ mod }) => failedIds.has(mod.workshopId)).map(({ mod }) => mod);
      if (modsToResubscribe.length === 0) return;

      const resubscribingItems = items.map((item) => ({
        ...item,
        status: "resubscribing" as const,
        error: item.error || reason,
      }));
      const fallbackMessage: WorkshopUpdateCheckMessage = {
        type: "finished",
        checkedCount: validRequests.length,
        items: resubscribingItems,
      };
      mainWindow.webContents.send("workshopUpdateCheck", fallbackMessage);
      log(`[Workshop repair] force download failed for ${modsToResubscribe.length} mod(s); resubscribing`);
      forceResubscribeMods(modsToResubscribe);
    };

    try {
      repairChild = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "checkState", workshopIds.join(";"), expectedTimestamps, "force"],
        {},
      );
      thisWorkshopRepair = {
        workshopIds: new Set(workshopIds),
        cancelAndGetMods,
      };
      activeWorkshopRepair = thisWorkshopRepair;
      repairChild.on("message", (message: WorkshopUpdateCheckMessage) => {
        if (didStartFallback) return;
        mainWindow.webContents.send("workshopUpdateCheck", message);
        if (message.type === "started") {
          startedItems = message.items;
          log(`[Workshop repair] forcing download for ${message.items.length} mod(s)`);
          return;
        }
        if (message.type === "progress") return;

        receivedFinalResult = true;
        clearActiveWorkshopRepair();
        const failedItems = message.items.filter((item) => item.status !== "updated");
        if (failedItems.length > 0) {
          fallbackToResubscribe(failedItems, "Force download did not install the Workshop version.");
        } else {
          log(`[Workshop repair] force download updated ${message.items.length} mod(s)`);
        }
      });
      repairChild.once("error", (error) => {
        const fallbackItems =
          startedItems.length > 0
            ? startedItems
            : validRequests.map(({ mod }): WorkshopUpdateCheckItem => ({
                workshopId: mod.workshopId,
                initialState: 0,
                finalState: 0,
                status: "request-failed",
                requestAccepted: false,
                error: error.message,
              }));
        fallbackToResubscribe(fallbackItems, error.message);
      });
      repairChild.once("exit", (code, signal) => {
        if (receivedFinalResult || didStartFallback) return;
        const fallbackItems =
          startedItems.length > 0
            ? startedItems
            : validRequests.map(({ mod }): WorkshopUpdateCheckItem => ({
                workshopId: mod.workshopId,
                initialState: 0,
                finalState: 0,
                status: "request-failed",
                requestAccepted: false,
              }));
        fallbackToResubscribe(
          fallbackItems,
          `Workshop update worker exited without a result (code=${code}, signal=${signal}).`,
        );
      });
    } catch (error) {
      const fallbackItems = validRequests.map(({ mod }): WorkshopUpdateCheckItem => ({
        workshopId: mod.workshopId,
        initialState: 0,
        finalState: 0,
        status: "request-failed",
        requestAccepted: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      fallbackToResubscribe(fallbackItems, "Could not start the Workshop update worker.");
    }
  });
  ipcMain.on("cancelWorkshopRepairAndResubscribeMods", (event, mods: Mod[]) => {
    const requestedWorkshopIds = new Set(mods.map((mod) => mod.workshopId));
    const shouldCancelActiveRepair = [...(activeWorkshopRepair?.workshopIds ?? [])].some((workshopId) =>
      requestedWorkshopIds.has(workshopId),
    );
    const modsToResubscribe = shouldCancelActiveRepair ? (activeWorkshopRepair?.cancelAndGetMods() ?? mods) : mods;
    forceResubscribeMods(modsToResubscribe);
  });
  ipcMain.on("forceResubscribeMods", async (event, mods: Mod[]) => {
    console.log(
      "in forceResubscribeMods, mods are:",
      mods.map((mod) => mod.name),
    );
    forceResubscribeMods(mods);
  });
  ipcMain.on("unsubscribeToMod", async (event, mod: Mod) => {
    try {
      const child = fork(
        nodePath.join(__dirname, "sub.js"),
        [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
        {},
      );
      child.on("message", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log("unsubscribe finished, deleting file:", mod.path);
        // why do we need to unsubscribe twice? who knows, but otherwise Steam unsubs AND happily downloads the mod into content after we unsub the first time
        fork(
          nodePath.join(__dirname, "sub.js"),
          [gameToSteamId[appData.currentGame], "unsubscribe", mod.workshopId],
          {},
        );
        fsExtra.removeSync(nodePath.dirname(mod.path));
      });
    } catch (e) {
      console.log(e);
    }
  });
  ipcMain.on("mergeMods", async (event, mods: Mod[]) => {
    try {
      mergeMods(mods).then((targetPath) => {
        mainWindow?.webContents.send("createdMergedPack", targetPath);
      });
    } catch (e) {
      console.log(e);
    }
  });
  const subscribeToMods = async (ids: string[]) => {
    fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "sub", ids.join(";")], {});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const id of ids) {
      if (!appData.waitForModIds.includes(id)) {
        appData.waitForModIds.push(id);
      }
    }
    for (const modId of ids) {
      fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "download", modId], {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // fork(nodePath.join(__dirname, "sub.js"), [gameToSteamId[appData.currentGame], "justRun"], {});
    // await new Promise((resolve) => setTimeout(resolve, 500));
    mainWindow?.webContents.send("subscribedToMods", ids);
  };
  ipcMain.on("subscribeToMods", async (event, ids: string[]) => {
    await subscribeToMods(ids);
  });
  ipcMain.on("exportModsToClipboard", async (event, mods: Mod[], availableMods: Mod[]) => {
    clipboard.writeText(serializeSharedModList(mods, availableMods));
  });
  ipcMain.on("exportModNamesToClipboard", async (event, mods: Mod[]) => {
    const sortedMods = sortByNameAndLoadOrder(mods);
    const enabledMods = sortedMods.filter((mod) => mod.isEnabled);
    const exportedMods = enabledMods
      .filter((mod) => mod.humanName != "")
      .map((mod) => mod.humanName)
      .join("\n");
    clipboard.writeText(exportedMods);
  });
  ipcMain.on("createSteamCollection", async (event, mods: Mod[]) => {
    const workshopIDs = mods.map((mod) => mod.workshopId);
    const scriptWithIDs = steamCollectionScript.replace(
      "var workshopIds = []",
      "var workshopIds = [" + workshopIDs.map((wID) => `"${wID}"`).join(",") + "]",
    );
    clipboard.writeText(scriptWithIDs);
  });
  const appendToSearchInsidePacks = (mods: Mod[], modsIndex: number, packNamesAll: string[], searchTerm: string) => {
    if (mods.length < modsIndex * 10) {
      console.log("setPackSearchResults", modsIndex);
      mainWindow?.webContents.send("setPackSearchResults", Array.from(new Set([...packNamesAll])));
      return;
    }
    const slicedMods = mods.slice(modsIndex * 10, modsIndex * 10 + 10);
    const modsArray = slicedMods.map((mod) => `'${mod.path.replaceAll("'", "''")}'`).join(",");
    console.log("modsArray is", modsArray, "i is", modsIndex, searchTerm, "num mods is", slicedMods.length);
    exec(
      `powershell.exe -Command "$strarry = @(${modsArray}); Select-String -Path $strarry -Pattern '${searchTerm}' | Select-Object -Unique -ExpandProperty Filename"`,
      (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          mainWindow?.webContents.send("setPackSearchResults", ["error:", error]);
          return;
        }
        console.log("stdout:", stdout);
        console.log("stderr:", stderr);
        const packNames = stdout
          .split("\n")
          .map((line) => line.split(".pack:")[0])
          .filter((packName) => packName != "");
        console.log("packNames:", packNames);
        // Then search again for unicode text.
        exec(
          `powershell.exe -Command "$strarry = @(${modsArray}); Select-String -Encoding unicode -Path $strarry -Pattern '${searchTerm}' | Select-Object -Unique -ExpandProperty Filename"`,
          (error, stdout) => {
            if (error) {
              console.error(`exec error: ${error}`);
              mainWindow?.webContents.send("setPackSearchResults", ["error:", error]);
              return;
            }
            const packNamesUnicodeSearch = stdout
              .split("\n")
              .map((line) => line.split(".pack:")[0])
              .filter((packName) => packName != "");
            console.log("packNames unicode:", packNames, packNamesUnicodeSearch);
            packNamesAll = packNamesAll.concat(packNames);
            packNamesAll = packNamesAll.concat(packNamesUnicodeSearch);
            appendToSearchInsidePacks(mods, modsIndex + 1, packNamesAll, searchTerm);
          },
        );
      },
    );
  };
  ipcMain.on("searchInsidePacks", async (event, searchTerm: string, mods: Mod[]) => {
    const packNamesAll = [] as string[];
    console.log("search inside mods:", searchTerm, "num mods:", mods.length);
    appendToSearchInsidePacks(mods, 0, packNamesAll, searchTerm);
  });
  const readTablesFromMods = async (mods: Mod[], tablesToRead: string[]) => {
    for (const mod of mods) {
      const existingPack = appData.packsData.find((pack) => pack.path == mod.path);
      let needsReRead = false;
      if (existingPack) {
        const lastChangedLocal = (await fsExtra.stat(mod.path)).mtimeMs;
        if (lastChangedLocal != existingPack.lastChangedLocal) {
          needsReRead = true;
          appData.packsData = appData.packsData.filter((pack) => pack.path != mod.path);
        }
      }
      console.log("READING FOR GAME START " + mod.name);
      let newPack: Pack | null = null;
      if (existingPack && !needsReRead) {
        console.log("existingPack.readTables", existingPack.readTables);
        console.log("tablesToRead", tablesToRead);
        if (existingPack.readTables === "all") {
          console.log("don't need to read tables for", existingPack.name, "all tables in pack are parsed");
          continue;
        }
        if (
          tablesToRead.every((tableToRead) =>
            (existingPack.readTables as string[]).some((iterTableName) => iterTableName == tableToRead),
          )
        ) {
          console.log("don't need to read tables for", existingPack.name, tablesToRead, "are parsed");
          continue;
        }
        console.log("reading from existing pack");
        newPack = await readFromExistingPack(existingPack, {
          tablesToRead,
        });
      } else {
        console.log("reading from new pack");
        newPack = await readPack(mod.path, {
          tablesToRead,
        });
      }
      appendPacksData(newPack, mod);
    }
  };
  const getDBsForGameStartOptions = async (mods: Mod[], startGameOptions: StartGameOptions) => {
    const tablesToRead: string[] = [];
    if (startGameOptions.isMakeUnitsGeneralsEnabled) {
      tablesToRead.push("db\\units_custom_battle_permissions_tables\\");
    }
    if (tablesToRead.length == 0) return;
    mainWindow?.webContents.send("addToast", {
      type: "info",
      messages: ["loc:processingMods"],
      startTime: Date.now(),
    } as Toast);
    await readTablesFromMods(mods, tablesToRead);
  };
  ipcMain.handle(
    "executeDBDuplication",
    async (
      event,
      packPath: string,
      nodesNamesToDuplicate: string[],
      nodeNameToRef: Record<string, IViewerTreeNodeWithData>,
      nodeNameToRenameValue: Record<string, string>,
      defaultNodeNameToRenameValue: Record<string, string>,
      treeData: IViewerTreeNodeWithData,
      DBCloneSaveOptions: DBCloneSaveOptions,
    ) => {
      const webContentsId = event.sender.id;
      const cancelState = { canceled: false };
      dbDuplicationCancelStateByWebContentsId.set(webContentsId, cancelState);
      try {
        const { executeDBDuplication } = await import("./DBClone");
        const result = await executeDBDuplication(
          packPath,
          nodesNamesToDuplicate,
          nodeNameToRef,
          nodeNameToRenameValue,
          defaultNodeNameToRenameValue,
          treeData,
          DBCloneSaveOptions,
          {
            isCanceled: () => cancelState.canceled,
            report: (progress) => {
              if (event.sender.isDestroyed()) return;
              try {
                event.sender.send("setDBDuplicationProgress", progress);
              } catch (error) {
                console.log("Couldn't report DB duplication progress:", error);
              }
            },
          },
        );
        return result;
      } catch (error) {
        console.log("executeDBDuplication IPC failed:", error);
        return {
          ok: false,
          error: `DB duplication failed: ${error instanceof Error ? error.message : String(error)}`,
        } as DBCloneExecutionResult;
      } finally {
        dbDuplicationCancelStateByWebContentsId.delete(webContentsId);
      }
    },
  );
  ipcMain.on("cancelDBDuplication", (event) => {
    const cancelState = dbDuplicationCancelStateByWebContentsId.get(event.sender.id);
    if (cancelState) cancelState.canceled = true;
  });
  ipcMain.on(
    "getTableReferences",
    async (event, packPath: string, tableReferenceRequests: TableReferenceRequest[], withPack: boolean) => {
      console.log("ON getTableReferences, with pack:", withPack);
      console.log("to read:", tableReferenceRequests);
      const newPack = await readPack(packPath, {
        tablesToRead: tableReferenceRequests.map(
          (req) => (req.tableName.startsWith("db") && req.tableName) || `db\\${req.tableName}`,
        ),
      });
      // console.log(
      //   "after getting refs1",
      //   newPack.packedFiles.filter((packedFile) => packedFile.schemaFields).map((pf) => pf.name)
      // );
      if (!packDataStore[packPath]) {
        packDataStore[packPath] = newPack;
      } else {
        const existingPack = packDataStore[packPath];
        newPack.packedFiles
          .filter((packedFile) => packedFile.schemaFields)
          .forEach((newPackedFile) => {
            const index = existingPack.packedFiles.findIndex(
              (existingPackedFile) => existingPackedFile.name == newPackedFile.name,
            );
            if (index != -1) {
              existingPack.packedFiles.splice(index, 1);
            }
            existingPack.packedFiles.push(newPackedFile);
          });
        // console.log(
        //   "after getting refs2",
        //   newPack.packedFiles.filter((packedFile) => packedFile.schemaFields).map((pf) => pf.name)
        // );
      }
      packDataStore[packPath].packedFiles
        .filter((pF) => pF.schemaFields)
        .forEach((pF) => {
          const dbVersion = getDBVersion(pF);
          if (!dbVersion) {
            return;
          }
          if (pF.schemaFields) {
            pF.schemaFields = amendSchemaField(pF.schemaFields, dbVersion);
            pF.tableSchema = dbVersion;
          }
        });
      // console.log("packDataStore in INDEX", packDataStore);
      if (withPack)
        windows.viewerWindow?.webContents.send(
          "setPackDataStore",
          packPath,
          packDataStore[packPath],
          tableReferenceRequests,
        );
      else {
        const onlyAskedForPFs = newPack.packedFiles
          .filter((pF) => pF.schemaFields)
          .map((pF) => packDataStore[packPath].packedFiles.find((amendedPF) => amendedPF.name == pF.name))
          .filter((pF) => pF);
        windows.viewerWindow?.webContents.send(
          "appendPackDataStore",
          packPath,
          onlyAskedForPFs,
          tableReferenceRequests,
        );
      }
    },
  );
  ipcMain.handle(
    "buildDBReferenceTree",
    async (
      event,
      packPath: string,
      currentDBTableSelection: DBTableSelection,
      deepCloneTarget: { row: number; col: number },
      existingRefs: DBCell[],
      selectedNodesByName: IViewerTreeNodeWithData[],
      existingTree?: IViewerTreeNodeWithData,
    ) => {
      return buildDBReferenceTree(
        packPath,
        currentDBTableSelection,
        deepCloneTarget,
        existingRefs,
        selectedNodesByName,
        existingTree,
      );
    },
  );
  ipcMain.handle(
    "buildDBIndirectReferences",
    async (event, packPath: string, selectedNode: IViewerTreeNodeWithData, existingRefs: DBCell[]) => {
      const webContentsId = event.sender.id;
      let cacheContext = dbIndirectReferenceCacheByWebContentsId.get(webContentsId);
      if (!cacheContext) {
        cacheContext = createDBIndirectReferenceCacheContext();
        dbIndirectReferenceCacheByWebContentsId.set(webContentsId, cacheContext);
      }
      return buildDBIndirectReferences(packPath, selectedNode, existingRefs, cacheContext);
    },
  );
  ipcMain.handle("getDBNameToDBVersions", async (event) => {
    return DBNameToDBVersions[appData.currentGame];
  });
  ipcMain.handle("getDefaultTableVersions", async (event) => {
    return await getDefaultTableVersions();
  });
  /** The current game's data folder, so windows other than the main one can offer it as a default. */
  ipcMain.handle("getDataFolder", async (event) => {
    return appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
  });
  ipcMain.on(
    "startGame",
    async (event, mods: Mod[], areModsPresorted: boolean, startGameOptions: StartGameOptions, saveName?: string) => {
      console.log("before start:");
      for (const pack of appData.packsData) {
        console.log(pack.name, pack.readTables);
      }
      try {
        // getSkillsData(mods.filter((mod) => mod.isEnabled));
        // return;
        for (const supportedGameOption of supportedGameOptions) {
          if (!gameToSupportedGameOptions[appData.currentGame].includes(supportedGameOption)) {
            const startGameOption = supportedGameOptionToStartGameOption[supportedGameOption];
            console.log(`setting startGameOption ${startGameOption} to false`);
            startGameOptions[startGameOption] = false;
          }
        }
        const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath;
        const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
        if (!gamePath) return;
        if (!dataFolder) return;
        const appDataPath = app.getPath("userData");
        const myModsPath = nodePath.join(gamePath, "my_mods.txt");
        const usedModsPath = nodePath.join(gamePath, "used_mods.txt");
        const sortedMods = sortByNameAndLoadOrder(mods.filter((mod) => mod.isEnabled));
        const linuxBit = process.platform === "linux" ? "Z:" : "";
        const vanillaPacks = [];
        for (const vanillaPackData of gameToVanillaPacksData[appData.currentGame]) {
          const baseVanillaPackName = vanillaPackData.name;
          const dataMod: Mod = {
            humanName: "",
            name: baseVanillaPackName,
            path: nodePath.join(dataFolder as string, baseVanillaPackName),
            imgPath: "",
            workshopId: "",
            isEnabled: true,
            modDirectory: `${dataFolder}`,
            isInData: true,
            lastChanged: undefined,
            loadOrder: undefined,
            author: "",
            isDeleted: false,
            isMovie: false,
            size: 0,
            isSymbolicLink: false,
            tags: ["mod"],
          };
          vanillaPacks.push(dataMod);
        }
        let extraEnabledMods = "";
        if (
          startGameOptions.isMakeUnitsGeneralsEnabled ||
          startGameOptions.isScriptLoggingEnabled ||
          startGameOptions.isSkipIntroMoviesEnabled ||
          startGameOptions.isAutoStartCustomBattleEnabled
        ) {
          log("making temp dir");
          await fs.mkdirSync(nodePath.join(appDataPath, "tempPacks"), { recursive: true });
          log("getting start game dbs");
          await getDBsForGameStartOptions(sortedMods.concat(vanillaPacks), startGameOptions);
          console.log("before start:");
          for (const pack of appData.packsData) {
            console.log(pack.name, pack.readTables);
          }
          const tempPackName = "!!!!out.pack";
          const tempPackPath = nodePath.join(appDataPath, "tempPacks", tempPackName);
          log("writing start game pack");
          let failedWriting = true;
          for (let i = 0; i < 10; i++) {
            try {
              tryOpenFile(tempPackPath);
              await writeStartGamePack(
                appData.packsData,
                tempPackPath,
                sortedMods.concat(vanillaPacks),
                startGameOptions,
              );
              failedWriting = false;
              break;
            } catch (e) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              if (i == 0) {
                mainWindow?.webContents.send("addToast", {
                  type: "info",
                  messages: ["Game still closing, retrying..."],
                  startTime: Date.now(),
                } as Toast);
              }
              if (i == 9) {
                terminateCurrentGame();
              }
            }
          }
          if (!failedWriting) {
            log("done writing temp pack");
            extraEnabledMods =
              `\nadd_working_directory "${linuxBit + nodePath.join(appDataPath, "tempPacks")}";` +
              `\nmod "${tempPackName}";`;
          } else {
            log("gave up trying to write temp pack");
          }
        }
        const modPathsInsideMergedMods = sortedMods
          .filter((mod) => mod.mergedModsData)
          .map((mod) => (mod.mergedModsData as MergedModsData[]).map((mod) => mod.path))
          .flatMap((paths) => paths);
        let enabledModsWithoutMergedInMods = sortedMods.filter(
          (mod) => !modPathsInsideMergedMods.some((path) => path == mod.path),
        );
        const enabledModsWithOverwrites = enabledModsWithoutMergedInMods.filter(
          (iterMod) => startGameOptions.packDataOverwrites[iterMod.path],
        );
        enabledModsWithoutMergedInMods = enabledModsWithoutMergedInMods.filter(
          (iterMod) => !startGameOptions.packDataOverwrites[iterMod.path],
        );
        console.log("enabledModsWithOverwrites:", enabledModsWithOverwrites);
        const overwriteModEntries: Array<{ sourcePath: string; name: string }> = [];
        /** Original pack path -> the overwrite copy a flow should read in its place. */
        const packPathSubstitutes = new Map<string, string>();
        /** Packs a flow wrote a whole replacement for; the original must not be loaded alongside it. */
        const replacedPackPaths = new Set<string>();
        if (enabledModsWithOverwrites.length > 0) {
          const overwritesDirPath = nodePath.join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
            "/whmm_overwrites/",
          );
          if (!fsExtra.existsSync(overwritesDirPath)) {
            exec(`mkdir "${overwritesDirPath}"`);
            await new Promise((resolve) => {
              setTimeout(resolve, 100);
            });
          }
          extraEnabledMods += `\nadd_working_directory "${linuxBit + overwritesDirPath}";`;
          for (const pack of enabledModsWithOverwrites) {
            await createOverwritePack(
              pack.path,
              nodePath.join(overwritesDirPath, pack.name),
              startGameOptions.packDataOverwrites[pack.path],
            );
            // Held back rather than appended, because a flow may still replace this pack outright -
            // and that decision is only known once flows have run, further down.
            overwriteModEntries.push({ sourcePath: pack.path, name: pack.name });
            // Flows must read this copy, not the original, or they would work from data the user
            // has already edited away.
            packPathSubstitutes.set(pack.path, nodePath.join(overwritesDirPath, pack.name));
          }
        }
        console.log("userFlowOptions:", startGameOptions.userFlowOptions);
        const whmmFlowsPath = nodePath.join(gamePath as string, "whmm_flows");
        const flowExecutionSignatureHash = await buildFlowExecutionSignature(sortedMods, startGameOptions, dataFolder);
        let shouldExecuteFlows = true;
        let enabledModsWithFlows: Mod[] = [];
        let createdFlowPacks: string[] = [];
        let flowExecutionHadErrors = false;
        if (flowExecutionSignatureHash) {
          const flowCache = await loadFlowExecutionCache();
          const cachedEntry = flowCache.byGame[appData.currentGame];
          if (cachedEntry && cachedEntry.signatureHash === flowExecutionSignatureHash) {
            if (cachedEntry.modsWithFlows.length === 0) {
              shouldExecuteFlows = false;
              console.log("Flow execution cache hit: no flow mods found in previous launch.");
            } else {
              if (!fsExtra.existsSync(whmmFlowsPath)) {
                fsExtra.mkdirSync(whmmFlowsPath, { recursive: true });
              }
              const cachedFlowPackPaths = cachedEntry.createdFlowPackFileNames.map((packFileName) =>
                nodePath.join(whmmFlowsPath, packFileName),
              );
              const missingCachedFlowPacks = cachedFlowPackPaths.filter(
                (flowPackPath) => !fsExtra.existsSync(flowPackPath),
              );
              if (missingCachedFlowPacks.length === 0) {
                shouldExecuteFlows = false;
                createdFlowPacks = cachedFlowPackPaths;
                enabledModsWithFlows = sortedMods.filter((mod) =>
                  cachedEntry.modsWithFlows.some((cachedMod) => cachedMod.path === mod.path),
                );
                for (const replacedPath of cachedEntry.replacedPackPaths ?? []) {
                  replacedPackPaths.add(replacedPath);
                }
                mainWindow?.webContents.send("addToast", {
                  type: "info",
                  messages: ["Using cached flow output..."],
                  startTime: Date.now(),
                } as Toast);
                console.log(
                  `Flow execution cache hit: reusing ${createdFlowPacks.length} cached flow pack(s).`,
                  createdFlowPacks,
                );
              } else {
                console.log(`Flow execution cache miss: ${missingCachedFlowPacks.length} cached flow pack(s) missing.`);
              }
            }
          } else {
            console.log("Flow execution cache miss: signature changed or no prior cache entry.");
          }
        } else {
          console.log("Flow execution cache unavailable: failed to build signature, executing flows normally.");
        }
        if (shouldExecuteFlows) {
          for (const packPath of sortedMods.map((mod) => mod.path)) {
            const pack = appData.packsData.find((packData) => packData.path == packPath);
            if (!pack || (pack && pack.packedFiles.length == 0)) {
              await readModsByPath([packPath], { readFlows: true, skipParsingTables: true });
            }
          }
          for (const packPath of Object.keys(startGameOptions.userFlowOptions)) {
            const mod = sortedMods.find((mod) => mod.path === packPath || mod.name == packPath);
            if (mod) {
              console.log("FOUND MOD TO READ FOR FLOWS:", mod.name);
              const pack = appData.packsData.find((packData) => packData.path == mod.path);
              if (!pack || (pack && pack.packedFiles.length == 0)) {
                console.log("need to read pack for flows:", mod.name);
                await readModsByPath([mod.path], { readFlows: true, skipParsingTables: true });
              }
            }
          }
          // Execute flows for enabled mods
          enabledModsWithFlows = sortedMods.filter((iterMod) => {
            const pack = appData.packsData.find((packData) => packData.path == iterMod.path);
            return pack && pack.packedFiles.some((file) => file.name.startsWith("whmmflows\\"));
          });
          if (enabledModsWithFlows.length > 0) {
            console.log(`Found ${enabledModsWithFlows.length} mods with flows to execute`);
            // Clear whmm_flows directory
            try {
              if (fsExtra.existsSync(whmmFlowsPath)) {
                console.log(`Clearing files in whmm_flows directory: ${whmmFlowsPath}`);
                const entries = fsExtra.readdirSync(whmmFlowsPath);
                for (const entry of entries) {
                  fsExtra.removeSync(nodePath.join(whmmFlowsPath, entry));
                }
                console.log("Successfully cleared whmm_flows contents");
              }
            } catch (error) {
              console.log(`Error clearing whmm_flows: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
            // Create whmm_flows directory
            if (!fsExtra.existsSync(whmmFlowsPath)) {
              fsExtra.mkdirSync(whmmFlowsPath, { recursive: true });
            }
            // Get the overwrite directory path if it exists
            const mergedDirPath = nodePath.join(
              appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
              "/whmm_overwrites/",
            );
            mainWindow?.webContents.send("addToast", {
              type: "info",
              messages: ["Processing flows..."],
              startTime: Date.now(),
            } as Toast);
            // Reset counter tracking once at the start of game launch
            // This ensures counters are maintained across all flows in all packs
            const { resetCounterTracking } = await import("./nodeExecutor");
            resetCounterTracking();
            console.log("Reset counter tracking for game launch - counters will be maintained across all flows");
            for (const pack of enabledModsWithFlows) {
              // Check if this pack has overwrites - if so, use the overwritten pack
              const hasOverwrites = enabledModsWithOverwrites.some((overwritePack) => overwritePack.path === pack.path);
              const packPathToUse = hasOverwrites ? nodePath.join(mergedDirPath, pack.name) : pack.path;
              const sourcePackForFlowExecution = hasOverwrites
                ? undefined
                : appData.packsData.find((packData) => packData.path === pack.path);
              console.log(
                `Executing flows for pack: ${pack.name} (using ${hasOverwrites ? "overwritten" : "original"} pack)`,
              );
              const {
                createdPackPaths,
                replacedPackPaths: flowReplacedPackPaths,
                hadErrors,
              } = await executeFlowsForPack(
                packPathToUse,
                "", // No target path needed
                startGameOptions.userFlowOptions,
                pack.name,
                sourcePackForFlowExecution,
                packPathSubstitutes,
              );
              createdFlowPacks.push(...createdPackPaths);
              for (const replacedPath of flowReplacedPackPaths) replacedPackPaths.add(replacedPath);
              flowExecutionHadErrors = flowExecutionHadErrors || hadErrors;
            }
            console.log(`Created ${createdFlowPacks.length} pack(s) from flows:`, createdFlowPacks);
          }
          if (flowExecutionSignatureHash) {
            const flowCache = await loadFlowExecutionCache();
            if (enabledModsWithFlows.length === 0) {
              flowCache.byGame[appData.currentGame] = {
                signatureHash: flowExecutionSignatureHash,
                createdAt: Date.now(),
                modsWithFlows: [],
                createdFlowPackFileNames: [],
              };
              await saveFlowExecutionCache();
            } else if (!flowExecutionHadErrors) {
              flowCache.byGame[appData.currentGame] = {
                signatureHash: flowExecutionSignatureHash,
                createdAt: Date.now(),
                modsWithFlows: enabledModsWithFlows.map((mod) => ({ path: mod.path, name: mod.name })),
                createdFlowPackFileNames: [...new Set(createdFlowPacks.map((path) => nodePath.basename(path)))],
                replacedPackPaths: [...replacedPackPaths],
              };
              await saveFlowExecutionCache();
            } else {
              console.log("Skipping flow execution cache update because at least one flow failed.");
            }
          }
        }
        // A flow that copied a pack wholesale wrote a replacement for it, so the original is dropped
        // from the mod list - loading both would put the files the flow removed back in.
        if (replacedPackPaths.size > 0) {
          console.log("Packs replaced by flow output:", [...replacedPackPaths]);
          enabledModsWithoutMergedInMods = enabledModsWithoutMergedInMods.filter(
            (iterMod) => !replacedPackPaths.has(iterMod.path),
          );
        }
        for (const overwriteEntry of overwriteModEntries) {
          if (replacedPackPaths.has(overwriteEntry.sourcePath)) continue;
          extraEnabledMods += `\nmod "${overwriteEntry.name}";`;
        }
        // Add flow packs to the mod list
        if (createdFlowPacks.length > 0) {
          extraEnabledMods += `\nadd_working_directory "${linuxBit + whmmFlowsPath}";`;
          for (const flowPackPath of createdFlowPacks) {
            const packFileName = nodePath.basename(flowPackPath);
            extraEnabledMods += `\nmod "${packFileName}";`;
            console.log(`Added flow pack to mod list: ${packFileName}`);
          }
        }
        const workingDirectoryLines = Array.from(
          new Set(
            enabledModsWithoutMergedInMods
              .filter((mod) => !mod.isInModding)
              .filter(
                (mod) =>
                  nodePath.relative(
                    appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string,
                    mod.modDirectory,
                  ) != "",
              )
              .map((mod) => `add_working_directory "${linuxBit + mod.modDirectory}";`),
          ),
        );
        const text =
          workingDirectoryLines.concat(enabledModsWithoutMergedInMods.map((mod) => `mod "${mod.name}";`)).join("\n") +
          extraEnabledMods;
        try {
          enabledModsWithoutMergedInMods
            .filter((mod) => mod.isInModding)
            .forEach((mod) => {
              const newPath = nodePath.join(dataFolder, mod.name);
              const stats = fs.statSync(mod.path);
              if (fs.existsSync(newPath)) {
                const statsCurrent = fs.statSync(newPath);
                // console.log("new times:", stats.atime, stats.mtime);
                // console.log("current times:", statsCurrent.atime, statsCurrent.mtime);
                if (statsCurrent.mtime > stats.mtime) {
                  mainWindow?.webContents.send("addToast", {
                    type: "warning",
                    messages: [`Mod ${mod.name} in modding is older than the one in data!`],
                    startTime: Date.now(),
                  } as Toast);
                  throw new Error(`Mod ${mod.path} is older than the one in data, user needs to resolve this!`);
                }
              }
              fs.copyFileSync(mod.path, newPath);
              fs.utimesSync(newPath, stats.atime, stats.mtime);
            });
        } catch (e) {
          console.error(e);
          return;
        }
        let fileNameWithModList = "used_mods.txt";
        try {
          const encoding = appData.currentGame == "shogun2" ? "utf16le" : "utf8";
          log("writing used_mods.txt");
          await fs.writeFileSync(usedModsPath, text, { encoding });
        } catch (e) {
          log("failed writing to used_mods.txt, trying to use my_mods.txt");
          fileNameWithModList = "my_mods.txt";
          await fs.writeFileSync(myModsPath, text);
        }
        let batData = `start /d "${appData.gamesToGameFolderPaths[appData.currentGame].gamePath}" ${
          gameToProcessName[appData.currentGame]
        }`;
        if (process.platform === "linux") {
          if (!appData.gamesToGameFolderPaths[appData.currentGame].gamePath) {
            // should throw an error here?
            console.error("Game path is undefined for current game");
            return;
          }
          const gamePath = join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath!,
            gameToProcessName[appData.currentGame],
          );
          batData = `protontricks-launch --cwd-app --appid ${gameToSteamId[appData.currentGame]} "${gamePath}"`;
        }
        console.log("batData so far:", batData);
        if (saveName) {
          batData += ` game_startup_mode campaign_load "${saveName}" ;`;
        }
        // file with the list of mods for the game to use, used_mods.txt or my_mods.txt
        batData += ` ${fileNameWithModList};`;
        // Create steam_appid.txt for Attila
        if (appData.currentGame === "attila" || appData.currentGame === "rome2" || appData.currentGame == "shogun2") {
          const steamAppIdPath = nodePath.join(
            appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string,
            "steam_appid.txt",
          );
          const steamId = gameToSteamId[appData.currentGame];
          try {
            fs.writeFileSync(steamAppIdPath, steamId);
          } catch (e) {
            console.error("Failed to create steam_appid.txt:", e);
          }
        }
        mainWindow?.webContents.send("handleLog", "starting game:");
        mainWindow?.webContents.send("handleLog", batData);
        exec(batData, (error) => {
          console.error(error);
        });
        appData.compatData = {
          packTableCollisions: [],
          packFileCollisions: [],
          missingTableReferences: {},
          uniqueIdsCollisions: {},
          scriptListenerCollisions: {},
          packFileAnalysisErrors: {},
          missingFileRefs: {},
        };
        appData.packsData = [];
        appData.queuedSkillsData = undefined;
        if (startGameOptions.isClosedOnPlay) {
          await new Promise((resolve) => {
            setTimeout(resolve, 5000);
          });
          app.exit();
        }
      } catch (e) {
        console.log(e);
      }
    },
  );
  /**
   * Writes a compatibility report to a file the user picks.
   *
   * The renderer supplies either canonical JSON for comparing builds or a self-contained HTML view;
   * this handler selects the matching save-dialog filter and writes the text unchanged.
   */
  ipcMain.handle("exportCompatReport", async (event, reportText: string, suggestedName: string) => {
    const requestingWindow = BrowserWindow.fromWebContents(event.sender);
    try {
      const extension = nodePath.extname(suggestedName).slice(1).toLowerCase();
      const filters =
        extension === "html" ? [{ name: "HTML", extensions: ["html"] }] : [{ name: "JSON", extensions: ["json"] }];
      const result = await dialog.showSaveDialog(requestingWindow || mainWindow || new BrowserWindow(), {
        defaultPath: nodePath.join(app.getPath("documents"), suggestedName),
        filters,
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };

      await fs.promises.writeFile(result.filePath, reportText, "utf8");
      return { success: true, savedPath: result.filePath };
    } catch (error) {
      console.error("Error exporting compat report:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    } finally {
      if (requestingWindow && !requestingWindow.isDestroyed()) requestingWindow.focus();
    }
  });
  ipcMain.handle("selectDirectory", async (event, defaultPath?: string) => {
    // Parent the dialog on whichever window asked, not always the main one: parenting it elsewhere
    // moves focus to that window, and the caller is left behind when the dialog closes.
    const requestingWindow = BrowserWindow.fromWebContents(event.sender);
    try {
      const result = await dialog.showOpenDialog(requestingWindow || mainWindow || new BrowserWindow(), {
        properties: ["openDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      });
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
      return undefined;
    } catch (error) {
      console.error("Error selecting directory:", error);
      return undefined;
    } finally {
      // A modal dialog on Windows can hand focus back to the main window rather than its own parent.
      if (requestingWindow && !requestingWindow.isDestroyed()) requestingWindow.focus();
    }
  });
  ipcMain.handle("selectFlowPackFile", async (event) => {
    const requestingWindow = BrowserWindow.fromWebContents(event.sender);
    try {
      const result = await dialog.showOpenDialog(requestingWindow || mainWindow || new BrowserWindow(), {
        properties: ["openFile"],
        filters: [{ name: "Pack files", extensions: ["pack"] }],
      });
      return result.canceled ? undefined : result.filePaths[0];
    } finally {
      if (requestingWindow && !requestingWindow.isDestroyed()) requestingWindow.focus();
    }
  });
  ipcMain.handle("selectFlowPackSavePath", async (event, suggestedName?: string) => {
    const requestingWindow = BrowserWindow.fromWebContents(event.sender);
    try {
      const defaultDirectory =
        appData.gamesToGameFolderPaths[appData.currentGame].dataFolder || app.getPath("documents");
      const defaultName = suggestedName?.trim() || "flows.pack";
      const result = await dialog.showSaveDialog(requestingWindow || mainWindow || new BrowserWindow(), {
        defaultPath: nodePath.join(defaultDirectory, defaultName),
        filters: [{ name: "Pack files", extensions: ["pack"] }],
      });
      if (result.canceled || !result.filePath) return undefined;
      return result.filePath.toLowerCase().endsWith(".pack") ? result.filePath : `${result.filePath}.pack`;
    } finally {
      if (requestingWindow && !requestingWindow.isDestroyed()) requestingWindow.focus();
    }
  });
  ipcMain.handle(
    "writeTextFilesToDirectory",
    async (
      event,
      baseDirectory: string,
      files: { relativePath: string; content: string }[],
    ): Promise<{ success: boolean; writtenFiles?: string[]; error?: string }> => {
      try {
        if (!baseDirectory) {
          return { success: false, error: "No output directory selected" };
        }
        if (!Array.isArray(files) || files.length === 0) {
          return { success: false, error: "No files to write" };
        }
        const resolvedBaseDirectory = nodePath.resolve(baseDirectory);
        const writtenFiles: string[] = [];
        for (const file of files) {
          const normalizedRelativePath = file.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
          if (normalizedRelativePath.includes("..")) {
            return { success: false, error: `Invalid relative path: ${file.relativePath}` };
          }
          const outputPath = nodePath.resolve(resolvedBaseDirectory, normalizedRelativePath);
          const baseWithSep = resolvedBaseDirectory.endsWith(nodePath.sep)
            ? resolvedBaseDirectory
            : `${resolvedBaseDirectory}${nodePath.sep}`;
          if (outputPath !== resolvedBaseDirectory && !outputPath.startsWith(baseWithSep)) {
            return { success: false, error: `Invalid output path: ${file.relativePath}` };
          }
          await fsExtra.ensureDir(nodePath.dirname(outputPath));
          await fs.promises.writeFile(outputPath, file.content, "utf8");
          writtenFiles.push(outputPath);
        }
        return { success: true, writtenFiles };
      } catch (error) {
        console.error("Error writing text files to directory:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to write files",
        };
      }
    },
  );
  ipcMain.handle("createNewPack", async (event, packName: string, packDirectory: string) => {
    try {
      console.log("createNewPack:", packName, packDirectory);
      const savePath = nodePath.join(packDirectory, `${packName}.pack`);
      // Check if file already exists
      if (fsExtra.existsSync(savePath)) {
        return {
          success: false,
          error: `Pack file already exists at: ${savePath}`,
        };
      }
      // Create an empty pack file
      const { writePack } = await import("./packFileSerializer");
      await writePack([], savePath);
      console.log(`Pack created at: ${savePath}`);
      return { success: true, packPath: savePath };
    } catch (error) {
      console.error("Error creating pack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create pack",
      };
    }
  });
  ipcMain.on("syncIsFeaturesForModdersEnabled", (event, isFeaturesForModdersEnabled: boolean) => {
    console.log("syncIsFeaturesForModdersEnabled:", isFeaturesForModdersEnabled);
    appData.isFeaturesForModdersEnabled = isFeaturesForModdersEnabled;
    if (!isFeaturesForModdersEnabled) appData.isCompatCheckingVanillaPacks = false;
    // Send to viewer window
    windows.viewerWindow?.webContents.send("setIsFeaturesForModdersEnabled", isFeaturesForModdersEnabled);
    windows.skillsWindow?.webContents.send("setIsFeaturesForModdersEnabled", isFeaturesForModdersEnabled);
    windows.techTreesWindow?.webContents.send("setIsFeaturesForModdersEnabled", isFeaturesForModdersEnabled);
  });
  ipcMain.on("syncModdersPrefix", (event, moddersPrefix: string) => {
    appData.moddersPrefix = moddersPrefix;
    windows.viewerWindow?.webContents.send("setModdersPrefix", moddersPrefix);
    windows.skillsWindow?.webContents.send("setModdersPrefix", moddersPrefix);
    windows.techTreesWindow?.webContents.send("setModdersPrefix", moddersPrefix);
  });
  ipcMain.on(
    "syncTreeDisplayModes",
    (
      event,
      treeDisplayModes: {
        skillTreesDisplayMode: TreeDisplayMode;
        technologyTreesDisplayMode: TreeDisplayMode;
      },
    ) => {
      appData.skillTreesDisplayMode = treeDisplayModes.skillTreesDisplayMode;
      appData.technologyTreesDisplayMode = treeDisplayModes.technologyTreesDisplayMode;

      if (treeDisplayModes.skillTreesDisplayMode !== "window" && windows.skillsWindow) {
        windows.skillsWindow.close();
      }
      if (treeDisplayModes.technologyTreesDisplayMode !== "window" && windows.techTreesWindow) {
        windows.techTreesWindow.close();
      }
    },
  );
};
