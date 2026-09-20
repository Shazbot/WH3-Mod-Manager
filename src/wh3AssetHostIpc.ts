import { app, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import appData from "./appData";
import { getDataMod } from "./modFunctions";
import { gameToVanillaPacksData } from "./supportedGames";
import {
  getModelPreviewServeTiming,
  modelPreviewAssetUrl,
  registerModelPreviewFile,
  revokeModelPreviewFile,
} from "./assetProtocol";
import {
  Wh3AssetHostClient,
  type Wh3AssetHostDecisionAction,
  type Wh3AssetHostDecisionRequest,
} from "./wh3AssetHostClient";
import { windows } from "./ipcMainListeners";
import {
  Wh3AssetHostPackInitializer,
  getWh3AssetHostPackPathsForMods,
  type Wh3AssetHostMod,
} from "./wh3AssetHostPacks";
import { getVanillaPackFilesCachePath } from "./vanillaPackFilesCache";
import { ensureWh3AssetHostVanillaCache } from "./wh3AssetHostVanillaCache";
import type { VariantMeshSelection } from "./visuals/variantMesh";
import type { VisualsModelPreviewTimingReport } from "./visuals/modelPreviewApi";
import { readPack, writePack } from "./packFileSerializer";
import {
  buildUnitPainterPackFiles,
  buildUnitPainterProjectPackFiles,
  decodeUnitPainterProjectTexture,
  ensureUnitPainterPackExtension,
  getUnitPainterDefaultPackName,
  getUnitPainterNamespaceName,
  parseUnitPainterProjectManifest,
  UNIT_PAINTER_PROJECT_MANIFEST_PATH,
} from "./visuals/unitPainterPack";

const MODEL_PREVIEW_OUTPUT_DIR = "model-previews";
const HOST_EXECUTABLE_NAME = "WH3AssetHost.exe";
const HOST_REPOSITORY_RELATIVE_PATH = nodePath.join("tools", "WH3AssetHost", HOST_EXECUTABLE_NAME);
const HOST_PROJECT_RELATIVE_PATH = nodePath.join("Tools", "WH3AssetHost");
const DECISION_RESPONSE_TIMEOUT_MS = 110_000;

type RunningHost = {
  client: Wh3AssetHostClient;
  packInitializer: Wh3AssetHostPackInitializer;
};

type PreviewRecord = {
  directory: string;
};

let runningHost: RunningHost | null = null;
let startingHost: Promise<RunningHost> | null = null;
let startingHostGeneration: number | null = null;
let startingHostClient: Wh3AssetHostClient | null = null;
let hostShutdownRequested = false;
let hostLifecycleActive = false;
let hostLifecycleGeneration = 0;
let prepareOutputRootPromise: Promise<void> | null = null;
let previewExportQueue: Promise<void> = Promise.resolve();
const previews = new Map<string, PreviewRecord>();
const pendingDecisionResponses = new Map<
  string,
  { resolve: (action: Wh3AssetHostDecisionAction) => void; timeout: NodeJS.Timeout }
>();

const settleDecisionResponse = (requestId: string, action: Wh3AssetHostDecisionAction) => {
  const pending = pendingDecisionResponses.get(requestId);
  if (!pending) return false;
  pendingDecisionResponses.delete(requestId);
  clearTimeout(pending.timeout);
  pending.resolve(action);
  return true;
};

const cancelPendingDecisionResponses = () => {
  for (const requestId of pendingDecisionResponses.keys()) settleDecisionResponse(requestId, "cancelExport");
};

const requestDecisionFromManager = (request: Wh3AssetHostDecisionRequest) =>
  new Promise<Wh3AssetHostDecisionAction>((resolve) => {
    const timeout = setTimeout(
      () => settleDecisionResponse(request.requestId, "cancelExport"),
      DECISION_RESPONSE_TIMEOUT_MS,
    );
    pendingDecisionResponses.set(request.requestId, { resolve, timeout });
    const mainWindow = windows.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) {
      settleDecisionResponse(request.requestId, "cancelExport");
      return;
    }
    try {
      mainWindow.webContents.send("wh3AssetHostDecisionRequest", request);
    } catch {
      settleDecisionResponse(request.requestId, "cancelExport");
    }
  });

ipcMain.removeHandler("respondWh3AssetHostDecision");
ipcMain.handle(
  "respondWh3AssetHostDecision",
  async (_event, requestId: unknown, action: unknown): Promise<{ success: boolean; error?: string }> => {
    if (typeof requestId !== "string" || !requestId) {
      return { success: false, error: "A decision request id is required." };
    }
    if (action !== "continueWithoutSkeleton" && action !== "cancelExport") {
      return { success: false, error: "Unsupported asset-host decision." };
    }

    if (!settleDecisionResponse(requestId, action)) {
      return { success: false, error: "The asset-host decision is no longer pending." };
    }
    return { success: true };
  },
);

const getOutputRoot = () => nodePath.join(app.getPath("userData"), MODEL_PREVIEW_OUTPUT_DIR);

const getDevelopmentHostCandidates = (): string[] => {
  const assetEditorRoot = nodePath.resolve(app.getAppPath(), "..", "assedFork");
  return [
    nodePath.resolve(app.getAppPath(), HOST_REPOSITORY_RELATIVE_PATH),
    nodePath.join(assetEditorRoot, HOST_PROJECT_RELATIVE_PATH, "bin", "Debug", "net10.0-windows", HOST_EXECUTABLE_NAME),
    nodePath.join(
      assetEditorRoot,
      HOST_PROJECT_RELATIVE_PATH,
      "bin",
      "Release",
      "net10.0-windows",
      HOST_EXECUTABLE_NAME,
    ),
    nodePath.join(
      assetEditorRoot,
      HOST_PROJECT_RELATIVE_PATH,
      "bin",
      "Release",
      "net10.0-windows",
      "win-x64",
      HOST_EXECUTABLE_NAME,
    ),
    nodePath.join(
      assetEditorRoot,
      HOST_PROJECT_RELATIVE_PATH,
      "bin",
      "Release",
      "net10.0-windows",
      "win-x64",
      "publish",
      HOST_EXECUTABLE_NAME,
    ),
  ];
};

/**
 * Development prefers WH3_ASSET_HOST_PATH, then the repository host under `tools/WH3AssetHost`,
 * followed by a sibling `assedFork` checkout. Packaged builds always use the bundled host.
 */
export const resolveWh3AssetHostExecutablePath = (): string => {
  const bundledPath = nodePath.join(process.resourcesPath, "WH3AssetHost", HOST_EXECUTABLE_NAME);
  const configuredPath = process.env.WH3_ASSET_HOST_PATH?.trim();
  const candidates = app.isPackaged
    ? [bundledPath]
    : [configuredPath, ...getDevelopmentHostCandidates()].filter(
        (candidate): candidate is string => !!candidate,
      );

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (executablePath) return executablePath;

  if (app.isPackaged) {
    throw new Error(`Bundled WH3AssetHost.exe was not found at '${bundledPath}'.`);
  }

  throw new Error(
    [
      "WH3AssetHost.exe was not found.",
      "Provide tools/WH3AssetHost/WH3AssetHost.exe or set WH3_ASSET_HOST_PATH.",
      candidates.length > 0 ? `Checked: ${candidates.join(" | ")}` : "No executable candidates were available.",
    ].join(" "),
  );
};

const notifyWh3AssetHostReset = () => {
  const mainWindow = windows.mainWindow;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("wh3AssetHostReset");
  } catch {
    // The renderer may already be closing while the host is being disposed.
  }
};

const disposeRunningHost = () => {
  const disposedHost = runningHost != null || startingHostClient != null;
  cancelPendingDecisionResponses();
  runningHost?.client.dispose();
  runningHost = null;
  startingHostClient?.dispose();
  startingHostClient = null;
  if (disposedHost) notifyWh3AssetHostReset();
};

/** Dispose only the host used by a failed operation; an older request must never tear down a newer host. */
const disposeOperationHost = (host: RunningHost | undefined) => {
  if (!host) return;
  if (runningHost?.client === host.client) {
    disposeRunningHost();
    return;
  }
  host.client.dispose();
  notifyWh3AssetHostReset();
};

const assertHostLifecycleActive = (generation: number) => {
  if (!hostLifecycleActive || generation !== hostLifecycleGeneration) {
    throw new Error("WH3AssetHost is no longer needed because its viewer tab is inactive.");
  }
};

const startHost = async (generation = hostLifecycleGeneration): Promise<RunningHost> => {
  if (hostShutdownRequested) throw new Error("WH3AssetHost is shutting down.");
  assertHostLifecycleActive(generation);
  if (runningHost?.client.isConnected) return runningHost;
  if (startingHost) {
    const pendingStart = startingHost;
    if (startingHostGeneration === generation) return pendingStart;
    await pendingStart.catch(() => undefined);
    return startHost(generation);
  }

  disposeRunningHost();
  const pendingStart = (async () => {
    assertHostLifecycleActive(generation);
    const client = new Wh3AssetHostClient({
      executablePath: resolveWh3AssetHostExecutablePath(),
      onDecisionRequest: requestDecisionFromManager,
    });
    startingHostClient = client;
    try {
      await client.start();
      await client.hello();
      // Start the process before warming the manager-owned cache. The host is already alive while
      // the cache is prepared, so entering a viewer does not wait to launch it until the first model.
      await ensureWh3AssetHostVanillaCache();
      if (hostShutdownRequested) throw new Error("WH3AssetHost is shutting down.");
      assertHostLifecycleActive(generation);
      const host = {
        client,
        packInitializer: new Wh3AssetHostPackInitializer(client, getVanillaPackFilesCachePath()),
      };
      runningHost = host;
      return host;
    } catch (error) {
      cancelPendingDecisionResponses();
      client.dispose();
      notifyWh3AssetHostReset();
      throw error;
    } finally {
      if (startingHostClient === client) startingHostClient = null;
    }
  })();
  startingHost = pendingStart;
  startingHostGeneration = generation;

  try {
    return await pendingStart;
  } finally {
    if (startingHost === pendingStart) {
      startingHost = null;
      startingHostGeneration = null;
    }
  }
};

ipcMain.removeHandler("startWh3AssetHost");
ipcMain.handle("startWh3AssetHost", async (): Promise<{ success: boolean; error?: string }> => {
  if (!hostLifecycleActive) {
    hostLifecycleActive = true;
    hostLifecycleGeneration += 1;
  }
  const generation = hostLifecycleGeneration;
  try {
    await startHost(generation);
    return { success: true };
  } catch (error) {
    if (generation === hostLifecycleGeneration && hostLifecycleActive) disposeRunningHost();
    return { success: false, error: error instanceof Error ? error.message : "Failed to start WH3AssetHost." };
  }
});

ipcMain.removeHandler("stopWh3AssetHost");
ipcMain.handle("stopWh3AssetHost", (): { success: boolean } => {
  hostLifecycleActive = false;
  hostLifecycleGeneration += 1;
  startingHost = null;
  startingHostGeneration = null;
  disposeRunningHost();
  return { success: true };
});

/** Clear previews abandoned by a previous app/process crash, once, before this run's first export. */
const prepareOutputRoot = async () => {
  if (!prepareOutputRootPromise) {
    const outputRoot = getOutputRoot();
    prepareOutputRootPromise = (async () => {
      await fs.promises.rm(outputRoot, { recursive: true, force: true });
      await fs.promises.mkdir(outputRoot, { recursive: true });
    })();
  }
  return prepareOutputRootPromise;
};

const removePreview = async (previewId: string) => {
  const record = previews.get(previewId);
  previews.delete(previewId);
  revokeModelPreviewFile(previewId);
  if (!record) return;
  try {
    await fs.promises.rm(record.directory, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to remove Visuals model preview '${previewId}':`, error);
  }
};

const sanitizeEnabledMods = (value: unknown): Wh3AssetHostMod[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<Wh3AssetHostMod>;
    if (typeof candidate.name !== "string" || typeof candidate.path !== "string") return [];
    const loadOrder = candidate.loadOrder;
    if (loadOrder != null && (!Number.isInteger(loadOrder) || loadOrder < 0)) return [];
    return [{ name: candidate.name, path: candidate.path, loadOrder }];
  });
};

const sanitizeAnimationPaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const path = entry.trim();
    if (path) paths.add(path);
  }
  return [...paths];
};

const sanitizeVariantSelections = (value: unknown): VariantMeshSelection[] => {
  if (!Array.isArray(value)) return [];
  const selections = new Map<string, VariantMeshSelection>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<VariantMeshSelection>;
    const slotPath = typeof candidate.slotPath === "string" ? candidate.slotPath.trim() : "";
    if (!slotPath || !Number.isInteger(candidate.choiceIndex) || candidate.choiceIndex! < 0) continue;
    selections.set(slotPath, { slotPath, choiceIndex: candidate.choiceIndex! });
  }
  return [...selections.values()];
};

const sanitizeVariantSelectionBatch = (value: unknown): Array<{ variantSelections: VariantMeshSelection[] }> => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as { variantSelections?: unknown };
    return [{ variantSelections: sanitizeVariantSelections(candidate.variantSelections) }];
  });
};

const normalizeVisualsModelAssetPath = (assetPath: string) => {
  if (process.platform !== "win32") {
    return { success: false as const, error: "The WH3 model preview host currently requires Windows." };
  }
  if (appData.currentGame !== "wh3") {
    return { success: false as const, error: "3D model previews currently support Total War: WARHAMMER III only." };
  }

  const normalizedAssetPath = assetPath?.trim();
  if (!normalizedAssetPath) return { success: false as const, error: "No model asset path was provided." };
  return { success: true as const, assetPath: normalizedAssetPath };
};

const prepareVisualsModelHost = async (enabledModsValue: unknown, generation: number) => {
  assertHostLifecycleActive(generation);
  await prepareOutputRoot();
  assertHostLifecycleActive(generation);
  const host = await startHost(generation);
  try {
    assertHostLifecycleActive(generation);
    const enabledMods = sanitizeEnabledMods(enabledModsValue);
    const packPaths = getWh3AssetHostPackPathsForMods(enabledMods);
    await host.packInitializer.ensureInitializedForPackPaths(packPaths, getOutputRoot());
    assertHostLifecycleActive(generation);
    return host;
  } catch (error) {
    disposeOperationHost(host);
    throw error;
  }
};

const getVisualsModelAnimationCatalogNow = async (
  assetPath: string,
  enabledModsValue: unknown,
  generation: number,
) => {
  const normalized = normalizeVisualsModelAssetPath(assetPath);
  if (!normalized.success) return normalized;

  let host: RunningHost | undefined;
  try {
    host = await prepareVisualsModelHost(enabledModsValue, generation);
    const result = await host.client.getAnimationCatalog(normalized.assetPath);
    assertHostLifecycleActive(generation);
    return result;
  } catch (error) {
    disposeOperationHost(host);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to resolve model animations.",
    };
  }
};

const exportVisualsModelNow = async (
  assetPath: string,
  enabledModsValue: unknown,
  animationPathsValue: unknown,
  variantSelectionsValue: unknown,
  queuedAtMs: number,
  generation: number,
) => {
  const operationStartedAt = performance.now();
  const queueWaitMs = operationStartedAt - queuedAtMs;
  const normalized = normalizeVisualsModelAssetPath(assetPath);
  if (!normalized.success) return normalized;

  const enabledMods = sanitizeEnabledMods(enabledModsValue);
  const animationPaths = sanitizeAnimationPaths(animationPathsValue);
  const variantSelections = sanitizeVariantSelections(variantSelectionsValue);
  const previewId = randomUUID();
  const outputRoot = getOutputRoot();
  const previewDirectory = nodePath.join(outputRoot, previewId);
  const outputPath = `${previewId}\\model.glb`;
  let registered = false;
  let host: RunningHost | undefined;

  try {
    const prepareHostStartedAt = performance.now();
    host = await prepareVisualsModelHost(enabledMods, generation);
    const prepareHostMs = performance.now() - prepareHostStartedAt;

    const hostExportStartedAt = performance.now();
    const result = await host.client.exportModel({
      assetPath: normalized.assetPath,
      outputPath,
      animationPaths,
      variantSelections,
    });
    const hostExportMs = performance.now() - hostExportStartedAt;
    assertHostLifecycleActive(generation);

    if (!result.success || !result.primaryFile) {
      const hostErrors = result.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(" | ");
      return {
        success: false as const,
        error: hostErrors || "WH3AssetHost did not produce a GLB for this model.",
        warnings: result.warnings?.map((warning) => warning.message) ?? [],
        timings: {
          queueWaitMs,
          prepareHostMs,
          hostExportMs,
          registerMs: 0,
          totalMs: performance.now() - queuedAtMs,
        },
      };
    }

    const registerStartedAt = performance.now();
    const glbBytes = (await fs.promises.stat(result.primaryFile)).size;
    assertHostLifecycleActive(generation);
    registerModelPreviewFile(previewId, result.primaryFile);
    previews.set(previewId, { directory: nodePath.dirname(result.primaryFile) });
    registered = true;
    const registerMs = performance.now() - registerStartedAt;

    return {
      success: true as const,
      previewId,
      url: modelPreviewAssetUrl(previewId),
      warnings: result.warnings?.map((warning) => warning.message) ?? [],
      timings: {
        queueWaitMs,
        prepareHostMs,
        hostExportMs,
        registerMs,
        totalMs: performance.now() - queuedAtMs,
        glbBytes,
      },
    };
  } catch (error) {
    // A transport/process failure invalidates the host used by this operation. If this request belongs
    // to an older lifecycle generation, leave the replacement host alone.
    disposeOperationHost(host);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to export the model preview.",
    };
  } finally {
    if (!registered) {
      try {
        await fs.promises.rm(previewDirectory, { recursive: true, force: true });
      } catch {
        // Failed exports are already surfaced to the caller; leftover temp cleanup is best-effort.
      }
    }
  }
};


const exportVisualsModelBatchNow = async (
  assetPath: string,
  enabledModsValue: unknown,
  animationPathsValue: unknown,
  itemsValue: unknown,
  queuedAtMs: number,
  generation: number,
) => {
  const operationStartedAt = performance.now();
  const queueWaitMs = operationStartedAt - queuedAtMs;
  const normalized = normalizeVisualsModelAssetPath(assetPath);
  if (!normalized.success) return normalized;

  const enabledMods = sanitizeEnabledMods(enabledModsValue);
  const animationPaths = sanitizeAnimationPaths(animationPathsValue);
  const items = sanitizeVariantSelectionBatch(itemsValue);
  if (items.length === 0) {
    return { success: false as const, error: "At least one comparison model is required." };
  }

  const batchId = randomUUID();
  const batchDirectory = nodePath.join(getOutputRoot(), batchId);
  const previewsToCreate = items.map((item) => {
    const previewId = randomUUID();
    return {
      previewId,
      outputPath: `${batchId}\\${previewId}\\model.glb`,
      variantSelections: item.variantSelections,
    };
  });
  const registeredPreviewIds: string[] = [];
  let host: RunningHost | undefined;

  try {
    const prepareHostStartedAt = performance.now();
    host = await prepareVisualsModelHost(enabledMods, generation);
    const prepareHostMs = performance.now() - prepareHostStartedAt;

    const hostExportStartedAt = performance.now();
    const batchResult = await host.client.exportModels({
      assetPath: normalized.assetPath,
      animationPaths,
      items: previewsToCreate.map(({ outputPath, variantSelections }) => ({ outputPath, variantSelections })),
    });
    const hostExportMs = performance.now() - hostExportStartedAt;
    assertHostLifecycleActive(generation);

    if (batchResult.exports.length !== previewsToCreate.length) {
      return {
        success: false as const,
        error: `WH3AssetHost returned ${batchResult.exports.length} batch results for ${previewsToCreate.length} requests.`,
      };
    }

    const failed = batchResult.exports.find((result) => !result.success || !result.primaryFile);
    if (failed) {
      const hostErrors = failed.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join(" | ");
      return {
        success: false as const,
        error: hostErrors || "WH3AssetHost did not produce every comparison GLB.",
        warnings: batchResult.exports.flatMap((result) => result.warnings?.map((warning) => warning.message) ?? []),
      };
    }

    const glbBytes = (
      await Promise.all(
        batchResult.exports.map(async (result) => (await fs.promises.stat(result.primaryFile!)).size),
      )
    ).reduce((total, bytes) => total + bytes, 0);
    assertHostLifecycleActive(generation);

    const resultItems = batchResult.exports.map((result, index) => {
      const previewId = previewsToCreate[index].previewId;
      registerModelPreviewFile(previewId, result.primaryFile!);
      previews.set(previewId, { directory: nodePath.dirname(result.primaryFile!) });
      registeredPreviewIds.push(previewId);
      return {
        previewId,
        url: modelPreviewAssetUrl(previewId),
        warnings: result.warnings?.map((warning) => warning.message) ?? [],
      };
    });

    return {
      success: true as const,
      items: resultItems,
      warnings: resultItems.flatMap((item) => item.warnings),
      timings: {
        queueWaitMs,
        prepareHostMs,
        hostExportMs,
        registerMs: 0,
        totalMs: performance.now() - queuedAtMs,
        glbBytes,
      },
    };
  } catch (error) {
    disposeOperationHost(host);
    for (const previewId of registeredPreviewIds) {
      previews.delete(previewId);
      revokeModelPreviewFile(previewId);
    }
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to export the model comparison.",
    };
  } finally {
    if (registeredPreviewIds.length !== previewsToCreate.length) {
      try {
        await fs.promises.rm(batchDirectory, { recursive: true, force: true });
      } catch {
        // Failed batch cleanup is best-effort; the output root is cleared next run.
      }
    }
  }
};

/**
 * Keep initialize + export atomic with respect to the host runtime. Without this queue, a mod-list
 * change could enqueue initialize(A), initialize(B), export(A), making the first export accidentally
 * resolve against B after both initialize requests were accepted by the single pipe server.
 */
const exportVisualsModel = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = previewExportQueue.then(operation, operation);
  previewExportQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

ipcMain.removeHandler("exportVisualsModel");
ipcMain.handle(
  "exportVisualsModel",
  async (_event, assetPath: string, enabledMods: unknown, animationPaths: unknown, variantSelections: unknown) => {
    const queuedAtMs = performance.now();
    const generation = hostLifecycleGeneration;
    return exportVisualsModel(() =>
      exportVisualsModelNow(assetPath, enabledMods, animationPaths, variantSelections, queuedAtMs, generation),
    );
  },
);

ipcMain.removeHandler("exportVisualsModelBatch");
ipcMain.handle(
  "exportVisualsModelBatch",
  async (_event, assetPath: string, enabledMods: unknown, animationPaths: unknown, items: unknown) => {
    const queuedAtMs = performance.now();
    const generation = hostLifecycleGeneration;
    return exportVisualsModel(() =>
      exportVisualsModelBatchNow(assetPath, enabledMods, animationPaths, items, queuedAtMs, generation),
    );
  },
);

ipcMain.removeHandler("getVisualsModelAnimationCatalog");
ipcMain.handle("getVisualsModelAnimationCatalog", async (_event, assetPath: string, enabledMods: unknown) => {
  const generation = hostLifecycleGeneration;
  return exportVisualsModel(() => getVisualsModelAnimationCatalogNow(assetPath, enabledMods, generation));
});

const finiteNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const formatTiming = (value: unknown) => finiteNumber(value).toFixed(1);

ipcMain.removeHandler("reportVisualsModelPreviewTiming");
ipcMain.handle("reportVisualsModelPreviewTiming", async (_event, value: unknown) => {
  if (!value || typeof value !== "object") return { success: false };

  const report = value as Partial<VisualsModelPreviewTimingReport>;
  const previewId = typeof report.previewId === "string" ? report.previewId : "";
  const assetPath = typeof report.assetPath === "string" ? report.assetPath : "<unknown>";
  const main = report.main;
  const ktx2 = report.ktx2;
  const protocolTiming = previewId ? getModelPreviewServeTiming(previewId) : undefined;
  const protocolWindowMs =
    protocolTiming?.firstRequestStartMs == null || protocolTiming.lastResponseReadyMs == null
      ? 0
      : protocolTiming.lastResponseReadyMs - protocolTiming.firstRequestStartMs;

  console.log(
    [
      `Visuals model preview timing: asset="${assetPath}"`,
      `total=${formatTiming(report.totalMs)}ms`,
      `exportRoundTrip=${formatTiming(report.exportRoundTripMs)}ms`,
      `main=${formatTiming(main?.totalMs)}ms(queue=${formatTiming(main?.queueWaitMs)},prepareHost=${formatTiming(main?.prepareHostMs)},hostExport=${formatTiming(main?.hostExportMs)},register=${formatTiming(main?.registerMs)})`,
      `glbBytes=${Math.round(finiteNumber(main?.glbBytes))}`,
      `glbLoad=${formatTiming(report.gltfLoadMs)}ms`,
      `protocolRead=${formatTiming(protocolTiming?.fileReadMs)}ms`,
      `protocolWindow=${protocolWindowMs.toFixed(1)}ms`,
      `protocolRequests=${protocolTiming?.requestCount ?? 0}`,
      `protocolBytes=${protocolTiming?.bytesRead ?? 0}`,
      `rawKtx2=${ktx2?.rawTextureCount ?? 0}`,
      `rawKtx2Wall=${formatTiming(ktx2?.rawTextureWallMs)}ms`,
      `zstdDecodeCpu=${formatTiming(ktx2?.zstdDecodeMs)}ms`,
      `textureCreateCpu=${formatTiming(ktx2?.textureCreateMs)}ms`,
      `textureUploadCpu=${formatTiming(ktx2?.textureUploadMs)}ms`,
      `rawCompressedBytes=${Math.round(finiteNumber(ktx2?.compressedBytes))}`,
      `rawDecodedBytes=${Math.round(finiteNumber(ktx2?.decodedBytes))}`,
      `sceneSetup=${formatTiming(report.sceneSetupMs)}ms`,
      `firstFrameWait=${formatTiming(report.firstFrameWaitMs)}ms`,
      `firstRender=${formatTiming(report.firstRenderMs)}ms`,
    ].join(", "),
  );

  return { success: true };
});

ipcMain.removeHandler("releaseVisualsModelPreview");
ipcMain.handle("releaseVisualsModelPreview", async (_event, previewId: string) => {
  if (previewId) await removePreview(previewId);
  return { success: true };
});

const MAX_UNIT_PAINTER_TEXTURES = 64;
const MAX_UNIT_PAINTER_RGBA_BYTES = 64 * 1024 * 1024;
const MAX_UNIT_PAINTER_TOTAL_BYTES = 256 * 1024 * 1024;

const sanitizeUnitPainterFileName = (value: unknown, index: number) => {
  if (typeof value !== "string") return `painted_texture_${String(index + 1).padStart(2, "0")}.rgba`;
  const baseName = nodePath.basename(value.trim()).replace(/[^a-zA-Z0-9._-]+/g, "_");
  const stem = baseName.replace(/\.rgba$/i, "").replace(/^[_\.]+|[_\.]+$/g, "");
  return `${stem || `painted_texture_${String(index + 1).padStart(2, "0")}`}.rgba`;
};

const sanitizeUnitPainterSourcePath = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\//g, "\\").trim().replace(/^\\+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("\\").some((part) => part === "..") ||
    !normalized.toLowerCase().endsWith(".dds")
  ) {
    return undefined;
  }
  return normalized;
};

const readUnitPainterRgba = (value: unknown, width: number, height: number) => {
  if (!ArrayBuffer.isView(value)) return undefined;
  const expectedBytes = width * height * 4;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_UNIT_PAINTER_RGBA_BYTES) {
    return undefined;
  }
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return bytes.length === expectedBytes ? bytes : undefined;
};


const sanitizeUnitPainterProjectState = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { activeLayerId?: unknown; layers?: unknown };
  const activeLayerId = typeof candidate.activeLayerId === "string" ? candidate.activeLayerId.trim() : "";
  if (!activeLayerId || !Array.isArray(candidate.layers) || candidate.layers.length < 1 || candidate.layers.length > 32) {
    return undefined;
  }

  let totalBytes = 0;
  const seenLayerIds = new Set<string>();
  const layers = [];
  for (const rawLayer of candidate.layers) {
    if (!rawLayer || typeof rawLayer !== "object") return undefined;
    const layer = rawLayer as {
      id?: unknown;
      name?: unknown;
      visible?: unknown;
      opacity?: unknown;
      textures?: unknown;
    };
    const id = typeof layer.id === "string" ? layer.id.trim() : "";
    const name = typeof layer.name === "string" ? layer.name.trim().slice(0, 80) : "";
    const opacity = typeof layer.opacity === "number" ? layer.opacity : Number.NaN;
    if (
      !id
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)
      || seenLayerIds.has(id)
      || !name
      || typeof layer.visible !== "boolean"
      || !Number.isFinite(opacity)
      || opacity < 0
      || opacity > 1
      || !Array.isArray(layer.textures)
      || layer.textures.length > MAX_UNIT_PAINTER_TEXTURES
    ) {
      return undefined;
    }
    seenLayerIds.add(id);

    const seenSources = new Set<string>();
    const textures = [];
    for (const rawTexture of layer.textures) {
      if (!rawTexture || typeof rawTexture !== "object") return undefined;
      const texture = rawTexture as {
        sourceVirtualPath?: unknown;
        width?: unknown;
        height?: unknown;
        rgbaBytes?: unknown;
      };
      const sourceVirtualPath = sanitizeUnitPainterSourcePath(texture.sourceVirtualPath);
      const width = typeof texture.width === "number" && Number.isInteger(texture.width) ? texture.width : 0;
      const height = typeof texture.height === "number" && Number.isInteger(texture.height) ? texture.height : 0;
      const rgbaBytes =
        width > 0 && height > 0 && width <= 16384 && height <= 16384
          ? readUnitPainterRgba(texture.rgbaBytes, width, height)
          : undefined;
      if (!sourceVirtualPath || !rgbaBytes) return undefined;
      const sourceKey = sourceVirtualPath.toLowerCase();
      if (seenSources.has(sourceKey)) return undefined;
      seenSources.add(sourceKey);
      totalBytes += rgbaBytes.length;
      if (totalBytes > MAX_UNIT_PAINTER_TOTAL_BYTES) return undefined;
      textures.push({ sourceVirtualPath, width, height, rgbaBytes });
    }

    layers.push({ id, name, visible: layer.visible, opacity, textures });
  }

  if (!seenLayerIds.has(activeLayerId)) return undefined;
  return { activeLayerId, layers };
};

const exportUnitPainterVariantNow = async (
  assetPathValue: unknown,
  enabledModsValue: unknown,
  variantSelectionsValue: unknown,
  texturesValue: unknown,
  projectStateValue: unknown,
  targetPackPathValue: unknown,
  generation: number,
) => {
  const assetPath = typeof assetPathValue === "string" ? assetPathValue.trim() : "";
  const normalizedAsset = normalizeVisualsModelAssetPath(assetPath);
  if (!normalizedAsset.success) return normalizedAsset;

  const projectState = sanitizeUnitPainterProjectState(projectStateValue);
  if (!projectState) {
    return { success: false as const, error: "The unit painter layer project payload is invalid." };
  }

  const requestedPackPath =
    typeof targetPackPathValue === "string" ? targetPackPathValue.trim() : "";
  if (!Array.isArray(texturesValue)) {
    return { success: false as const, error: "The painted texture export payload is invalid." };
  }
  if (texturesValue.length > MAX_UNIT_PAINTER_TEXTURES) {
    return {
      success: false as const,
      error: `A unit-painter export may contain at most ${MAX_UNIT_PAINTER_TEXTURES} textures.`,
    };
  }

  const textures: Array<{
    fileName: string;
    sourceVirtualPath: string;
    width: number;
    height: number;
    rgbaBytes: Buffer;
  }> = [];
  const seenSourcePaths = new Set<string>();
  let totalBytes = 0;
  for (let index = 0; index < texturesValue.length; index += 1) {
    const value = texturesValue[index];
    if (!value || typeof value !== "object") {
      return { success: false as const, error: "The painted texture export payload is invalid." };
    }

    const candidate = value as {
      fileName?: unknown;
      sourceVirtualPath?: unknown;
      width?: unknown;
      height?: unknown;
      rgbaBytes?: unknown;
    };
    const sourceVirtualPath = sanitizeUnitPainterSourcePath(candidate.sourceVirtualPath);
    const width = typeof candidate.width === "number" && Number.isInteger(candidate.width) ? candidate.width : 0;
    const height = typeof candidate.height === "number" && Number.isInteger(candidate.height) ? candidate.height : 0;
    const rgbaBytes =
      width > 0 && height > 0 && width <= 16384 && height <= 16384
        ? readUnitPainterRgba(candidate.rgbaBytes, width, height)
        : undefined;
    if (!rgbaBytes || !sourceVirtualPath) {
      return { success: false as const, error: "One of the painted textures is invalid." };
    }

    const sourceKey = sourceVirtualPath.toLowerCase();
    if (seenSourcePaths.has(sourceKey)) {
      return {
        success: false as const,
        error: `The source texture '${sourceVirtualPath}' appears more than once in this paint export.`,
      };
    }
    seenSourcePaths.add(sourceKey);

    totalBytes += rgbaBytes.length;
    if (totalBytes > MAX_UNIT_PAINTER_TOTAL_BYTES) {
      return { success: false as const, error: "The painted texture export is too large." };
    }

    textures.push({
      fileName: sanitizeUnitPainterFileName(candidate.fileName, index),
      sourceVirtualPath,
      width,
      height,
      rgbaBytes,
    });
  }

  const ownerWindow = windows.mainWindow && !windows.mainWindow.isDestroyed() ? windows.mainWindow : undefined;
  const suggestedPackName = getUnitPainterDefaultPackName(normalizedAsset.assetPath);
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
  let packPath: string;
  if (requestedPackPath) {
    packPath = ensureUnitPainterPackExtension(nodePath.resolve(requestedPackPath));
  } else {
    const dialogOptions: SaveDialogOptions = {
      title: "Save painted WH3 mod",
      buttonLabel: "Save Mod",
      defaultPath: dataFolder ? nodePath.join(dataFolder, suggestedPackName) : suggestedPackName,
      filters: [{ name: "Total War pack", extensions: ["pack"] }],
    };
    const selection = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (selection.canceled || !selection.filePath) {
      return { success: false as const, canceled: true };
    }
    packPath = ensureUnitPainterPackExtension(selection.filePath);
  }
  const packName = nodePath.basename(packPath);
  const vanillaPackNames = new Set(
    [
      ...gameToVanillaPacksData[appData.currentGame].map((pack) => pack.name),
      ...appData.allVanillaPackNames,
    ].map((name) => name.toLowerCase()),
  );
  if (vanillaPackNames.has(packName.toLowerCase())) {
    return {
      success: false as const,
      error: `'${packName}' is a vanilla game pack and cannot be overwritten by the unit painter.`,
    };
  }

  const variantSelections = sanitizeVariantSelections(variantSelectionsValue);
  if (textures.length === 0) {
    const projectFiles = await buildUnitPainterProjectPackFiles(
      normalizedAsset.assetPath,
      variantSelections,
      projectState,
    );
    await writePack(projectFiles, packPath);
    return {
      success: true as const,
      packPath,
      files: projectFiles.map((file) => file.name),
      warnings: [] as string[],
    };
  }

  const variantName = getUnitPainterNamespaceName(packPath, normalizedAsset.assetPath);
  const stageId = `unit-painter-${randomUUID()}`;
  const stageRoot = nodePath.join(getOutputRoot(), stageId);
  const inputDirectory = nodePath.join(stageRoot, "input");
  const generatedDirectory = nodePath.join(stageRoot, "generated");
  let host: RunningHost | undefined;

  try {
    host = await prepareVisualsModelHost(enabledModsValue, generation);
    assertHostLifecycleActive(generation);
    await fs.promises.mkdir(inputDirectory, { recursive: true });
    await fs.promises.mkdir(generatedDirectory, { recursive: true });

    const stagedTextures: Array<{
      sourceVirtualPath: string;
      rgbaPath: string;
      width: number;
      height: number;
    }> = [];
    for (let index = 0; index < textures.length; index += 1) {
      const texture = textures[index];
      const stagedName = `${String(index + 1).padStart(2, "0")}_${texture.fileName}`;
      const stagedPath = nodePath.join(inputDirectory, stagedName);
      await fs.promises.writeFile(stagedPath, texture.rgbaBytes);
      stagedTextures.push({
        sourceVirtualPath: texture.sourceVirtualPath,
        rgbaPath: nodePath.relative(getOutputRoot(), stagedPath),
        width: texture.width,
        height: texture.height,
      });
    }

    const result = await host.client.exportPaintedVariant({
      assetPath: normalizedAsset.assetPath,
      outputDirectory: nodePath.relative(getOutputRoot(), generatedDirectory),
      variantName,
      textures: stagedTextures,
      variantSelections,
    });
    assertHostLifecycleActive(generation);

    if (!result.success || !result.variantMeshVirtualPath) {
      const hostErrors = result.errors?.map((error) => error.message).filter(Boolean).join(" | ");
      return {
        success: false as const,
        error: hostErrors || "WH3AssetHost could not create the painted unit variant.",
        warnings: result.warnings ?? [],
      };
    }

    const normalizeVirtualPath = (value: string) =>
      value.replace(/\//g, "\\").trim().replace(/^\\+/, "").toLowerCase();
    if (normalizeVirtualPath(result.variantMeshVirtualPath) !== normalizeVirtualPath(normalizedAsset.assetPath)) {
      return {
        success: false as const,
        error:
          "WH3AssetHost did not export the painted VariantMeshDefinition at the source path. "
          + "Rebuild the bundled asset host before creating a painted mod.",
        warnings: result.warnings ?? [],
      };
    }

    const gamePackFiles = await buildUnitPainterPackFiles(
      generatedDirectory,
      result.files ?? [],
      normalizedAsset.assetPath,
    );
    const projectFiles = await buildUnitPainterProjectPackFiles(
      normalizedAsset.assetPath,
      variantSelections,
      projectState,
    );
    const packFiles = [...gamePackFiles, ...projectFiles];
    await writePack(packFiles, packPath);

    // The normal Data-folder watcher will discover this shortly. Defer the immediate
    // add/enable notification until after this IPC handler has returned so the painter
    // renderer can exclude its own output pack from the source stack before Redux sees it.
    const normalizedDataFolder = dataFolder ? nodePath.resolve(dataFolder).toLowerCase() : undefined;
    const normalizedPackDirectory = nodePath.resolve(nodePath.dirname(packPath)).toLowerCase();
    const normalizedModdingDirectory = dataFolder
      ? nodePath.resolve(dataFolder, "modding").toLowerCase()
      : undefined;
    const isManagedDataPack =
      !!normalizedDataFolder
      && (normalizedPackDirectory === normalizedDataFolder
        || normalizedPackDirectory === normalizedModdingDirectory);
    if (isManagedDataPack && windows.mainWindow && !windows.mainWindow.isDestroyed()) {
      setImmediate(() => {
        void (async () => {
          const mainWindow = windows.mainWindow;
          if (!mainWindow || mainWindow.isDestroyed()) return;
          try {
            const mod = await getDataMod(packPath, (message) => {
              windows.mainWindow?.webContents.send("handleLog", message);
            });
            mod.isEnabled = true;
            if (!mainWindow.isDestroyed()) mainWindow.webContents.send("addMod", mod);
          } catch (error) {
            if (!mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                "handleLog",
                `Painted mod was created but could not be added to the manager immediately: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        })();
      });
    }

    return {
      success: true as const,
      packPath,
      files: packFiles.map((file) => file.name),
      variantMeshPath: result.variantMeshVirtualPath,
      warnings: result.warnings ?? [],
    };
  } catch (error) {
    disposeOperationHost(host);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to create the painted unit mod.",
    };
  } finally {
    try {
      await fs.promises.rm(stageRoot, { recursive: true, force: true });
    } catch {
      // Unit-painter staging is disposable and will also be cleared on the next app run.
    }
  }
};

const openUnitPainterProjectNow = async (packPathValue: unknown) => {
  const ownerWindow = windows.mainWindow && !windows.mainWindow.isDestroyed() ? windows.mainWindow : undefined;
  let packPath = typeof packPathValue === "string" ? packPathValue.trim() : "";
  if (!packPath) {
    const options: OpenDialogOptions = {
      title: "Open painted WH3 mod",
      buttonLabel: "Edit Mod",
      properties: ["openFile"],
      filters: [{ name: "Total War pack", extensions: ["pack"] }],
    };
    const selection = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) {
      return { success: false as const, canceled: true };
    }
    packPath = selection.filePaths[0];
  }
  packPath = nodePath.resolve(packPath);

  try {
    const indexed = await readPack(packPath, { skipParsingTables: true });
    const manifestEntry = indexed.packedFiles.find(
      (file) => file.name.replace(/\//g, "\\").toLowerCase() === UNIT_PAINTER_PROJECT_MANIFEST_PATH.toLowerCase(),
    );
    if (!manifestEntry) {
      return {
        success: false as const,
        error: "This pack is not an editable WHMM unit-painter project. Older painter packs must be recreated once with the new format.",
      };
    }
    if (manifestEntry.file_size <= 0 || manifestEntry.file_size > 1024 * 1024) {
      return { success: false as const, error: "The unit painter project manifest has an invalid size." };
    }

    const withManifest = await readPack(packPath, {
      skipParsingTables: true,
      filesToRead: [manifestEntry.name],
    });
    const manifestBuffer = withManifest.packedFiles.find(
      (file) => file.name.toLowerCase() === manifestEntry.name.toLowerCase(),
    )?.buffer;
    if (!manifestBuffer) return { success: false as const, error: "The unit painter project manifest could not be read." };
    const manifest = parseUnitPainterProjectManifest(manifestBuffer);

    if (manifest.formatVersion === 1) {
      if (manifest.paintedTextures.length > MAX_UNIT_PAINTER_TEXTURES) {
        return {
          success: false as const,
          error: `A unit-painter project may contain at most ${MAX_UNIT_PAINTER_TEXTURES} painted textures.`,
        };
      }
      const texturePaths = manifest.paintedTextures.map((texture) => texture.filePath);
      const withTextures = texturePaths.length > 0
        ? await readPack(packPath, { skipParsingTables: true, filesToRead: texturePaths })
        : withManifest;
      const byPath = new Map(withTextures.packedFiles.map((file) => [file.name.toLowerCase(), file]));
      let totalBytes = 0;
      const textures = [];
      for (const texture of manifest.paintedTextures) {
        const packed = byPath.get(texture.filePath.toLowerCase());
        const compressed = packed?.buffer;
        if (!compressed) throw new Error(`The saved painter texture '${texture.filePath}' is missing.`);
        const expectedBytes = texture.width * texture.height * 4;
        totalBytes += expectedBytes;
        if (totalBytes > MAX_UNIT_PAINTER_TOTAL_BYTES) throw new Error("The saved unit painter project is too large.");
        const rgbaBytes = await decodeUnitPainterProjectTexture(compressed, expectedBytes);
        textures.push({
          sourceVirtualPath: texture.sourceVirtualPath,
          width: texture.width,
          height: texture.height,
          rgbaBytes,
        });
      }

      return {
        success: true as const,
        packPath,
        project: {
          formatVersion: 1 as const,
          sourceVariantMeshDefinition: manifest.sourceVariantMeshDefinition,
          variantSelections: manifest.variantSelections,
          textures,
        },
      };
    }

    if (manifest.layers.some((layer) => layer.textures.length > MAX_UNIT_PAINTER_TEXTURES)) {
      throw new Error(
        `Each unit-painter layer may contain at most ${MAX_UNIT_PAINTER_TEXTURES} painted textures.`,
      );
    }
    const textureEntries = manifest.layers.flatMap((layer) => layer.textures);
    const texturePaths = textureEntries.map((texture) => texture.filePath);
    const withTextures = texturePaths.length > 0
      ? await readPack(packPath, { skipParsingTables: true, filesToRead: texturePaths })
      : withManifest;
    const byPath = new Map(withTextures.packedFiles.map((file) => [file.name.toLowerCase(), file]));
    let totalBytes = 0;
    const layers = [];
    for (const layer of manifest.layers) {
      const textures = [];
      for (const texture of layer.textures) {
        const packed = byPath.get(texture.filePath.toLowerCase());
        const compressed = packed?.buffer;
        if (!compressed) throw new Error(`The saved painter layer texture '${texture.filePath}' is missing.`);
        const expectedBytes = texture.width * texture.height * 4;
        totalBytes += expectedBytes;
        if (totalBytes > MAX_UNIT_PAINTER_TOTAL_BYTES) throw new Error("The saved unit painter project is too large.");
        const rgbaBytes = await decodeUnitPainterProjectTexture(compressed, expectedBytes);
        textures.push({
          sourceVirtualPath: texture.sourceVirtualPath,
          width: texture.width,
          height: texture.height,
          rgbaBytes,
        });
      }
      layers.push({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        textures,
      });
    }

    return {
      success: true as const,
      packPath,
      project: {
        formatVersion: 2 as const,
        sourceVariantMeshDefinition: manifest.sourceVariantMeshDefinition,
        variantSelections: manifest.variantSelections,
        activeLayerId: manifest.activeLayerId,
        layers,
      },
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to open the unit painter project.",
    };
  }
};

ipcMain.removeHandler("openUnitPainterProject");
ipcMain.handle("openUnitPainterProject", async (_event, packPath: unknown) => openUnitPainterProjectNow(packPath));

ipcMain.removeHandler("exportUnitPainterTextures");
ipcMain.handle(
  "exportUnitPainterTextures",
  async (
    _event,
    assetPath: unknown,
    enabledMods: unknown,
    variantSelections: unknown,
    textures: unknown,
    projectState: unknown,
    targetPackPath: unknown,
  ) => {
    const generation = hostLifecycleGeneration;
    return exportVisualsModel(() =>
      exportUnitPainterVariantNow(
        assetPath,
        enabledMods,
        variantSelections,
        textures,
        projectState,
        targetPackPath,
        generation,
      ),
    );
  },
);

const stopHostForAppExit = () => {
  hostShutdownRequested = true;
  hostLifecycleActive = false;
  hostLifecycleGeneration += 1;
  startingHost = null;
  startingHostGeneration = null;
  for (const previewId of previews.keys()) {
    revokeModelPreviewFile(previewId);
  }
  previews.clear();
  disposeRunningHost();
};

app.once("before-quit", stopHostForAppExit);
process.once("exit", stopHostForAppExit);
