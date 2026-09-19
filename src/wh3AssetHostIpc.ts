import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import appData from "./appData";
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
let startingHostClient: Wh3AssetHostClient | null = null;
let hostShutdownRequested = false;
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
 * followed by a sibling `assedFork` checkout. Packaged builds use the self-contained host copied
 * beside the app's resources.
 */
export const resolveWh3AssetHostExecutablePath = (): string => {
  const configuredPath = process.env.WH3_ASSET_HOST_PATH?.trim();
  const candidates = [
    configuredPath,
    ...(app.isPackaged
      ? [nodePath.join(process.resourcesPath, "WH3AssetHost", HOST_EXECUTABLE_NAME)]
      : getDevelopmentHostCandidates()),
  ].filter((candidate): candidate is string => !!candidate);

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (executablePath) return executablePath;

  throw new Error(
    [
      "WH3AssetHost.exe was not found.",
      "Provide tools/WH3AssetHost/WH3AssetHost.exe or set WH3_ASSET_HOST_PATH.",
      candidates.length > 0 ? `Checked: ${candidates.join(" | ")}` : "No executable candidates were available.",
    ].join(" "),
  );
};

const disposeRunningHost = () => {
  cancelPendingDecisionResponses();
  runningHost?.client.dispose();
  runningHost = null;
  startingHostClient?.dispose();
  startingHostClient = null;
};

const startHost = async (): Promise<RunningHost> => {
  if (hostShutdownRequested) throw new Error("WH3AssetHost is shutting down.");
  if (runningHost?.client.isConnected) return runningHost;
  if (startingHost) return startingHost;

  disposeRunningHost();
  startingHost = (async () => {
    await ensureWh3AssetHostVanillaCache();

    const client = new Wh3AssetHostClient({
      executablePath: resolveWh3AssetHostExecutablePath(),
      onDecisionRequest: requestDecisionFromManager,
    });
    startingHostClient = client;
    try {
      await client.start();
      await client.hello();
      if (hostShutdownRequested) throw new Error("WH3AssetHost is shutting down.");
      const host = {
        client,
        packInitializer: new Wh3AssetHostPackInitializer(client, getVanillaPackFilesCachePath()),
      };
      runningHost = host;
      return host;
    } catch (error) {
      cancelPendingDecisionResponses();
      client.dispose();
      throw error;
    } finally {
      if (startingHostClient === client) startingHostClient = null;
    }
  })();

  try {
    return await startingHost;
  } finally {
    startingHost = null;
  }
};

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

const prepareVisualsModelHost = async (enabledModsValue: unknown) => {
  await prepareOutputRoot();
  const host = await startHost();
  const enabledMods = sanitizeEnabledMods(enabledModsValue);
  const packPaths = getWh3AssetHostPackPathsForMods(enabledMods);
  await host.packInitializer.ensureInitializedForPackPaths(packPaths, getOutputRoot());
  return host;
};

const getVisualsModelAnimationCatalogNow = async (assetPath: string, enabledModsValue: unknown) => {
  const normalized = normalizeVisualsModelAssetPath(assetPath);
  if (!normalized.success) return normalized;

  try {
    const host = await prepareVisualsModelHost(enabledModsValue);
    return await host.client.getAnimationCatalog(normalized.assetPath);
  } catch (error) {
    disposeRunningHost();
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

  try {
    const prepareHostStartedAt = performance.now();
    const host = await prepareVisualsModelHost(enabledMods);
    const prepareHostMs = performance.now() - prepareHostStartedAt;

    const hostExportStartedAt = performance.now();
    const result = await host.client.exportModel({
      assetPath: normalized.assetPath,
      outputPath,
      animationPaths,
      variantSelections,
    });
    const hostExportMs = performance.now() - hostExportStartedAt;

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
    // A transport/process failure invalidates both the host runtime and the initializer revision.
    // The next preview request starts a fresh process and reinitializes its pack universe.
    disposeRunningHost();
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
    return exportVisualsModel(() =>
      exportVisualsModelNow(assetPath, enabledMods, animationPaths, variantSelections, queuedAtMs),
    );
  },
);

ipcMain.removeHandler("getVisualsModelAnimationCatalog");
ipcMain.handle("getVisualsModelAnimationCatalog", async (_event, assetPath: string, enabledMods: unknown) =>
  exportVisualsModel(() => getVisualsModelAnimationCatalogNow(assetPath, enabledMods)),
);

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

const stopHostForAppExit = () => {
  hostShutdownRequested = true;
  for (const previewId of previews.keys()) {
    revokeModelPreviewFile(previewId);
  }
  previews.clear();
  disposeRunningHost();
};

app.once("before-quit", stopHostForAppExit);
process.once("exit", stopHostForAppExit);
