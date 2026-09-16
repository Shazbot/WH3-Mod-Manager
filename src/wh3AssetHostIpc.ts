import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import appData from "./appData";
import { modelPreviewAssetUrl, registerModelPreviewFile, revokeModelPreviewFile } from "./assetProtocol";
import { Wh3AssetHostClient } from "./wh3AssetHostClient";
import {
  Wh3AssetHostPackInitializer,
  getWh3AssetHostPackPathsForMods,
  type Wh3AssetHostMod,
} from "./wh3AssetHostPacks";

const MODEL_PREVIEW_OUTPUT_DIR = "model-previews";
const HOST_EXECUTABLE_NAME = "WH3AssetHost.exe";
const HOST_PROJECT_RELATIVE_PATH = nodePath.join("Tools", "WH3AssetHost");

type RunningHost = {
  client: Wh3AssetHostClient;
  packInitializer: Wh3AssetHostPackInitializer;
};

type PreviewRecord = {
  directory: string;
};

let runningHost: RunningHost | null = null;
let startingHost: Promise<RunningHost> | null = null;
let prepareOutputRootPromise: Promise<void> | null = null;
let previewExportQueue: Promise<void> = Promise.resolve();
const previews = new Map<string, PreviewRecord>();

const getOutputRoot = () => nodePath.join(app.getPath("userData"), MODEL_PREVIEW_OUTPUT_DIR);

const getDevelopmentHostCandidates = (): string[] => {
  const assetEditorRoot = nodePath.resolve(app.getAppPath(), "..", "assedFork");
  return [
    nodePath.join(assetEditorRoot, HOST_PROJECT_RELATIVE_PATH, "bin", "Debug", "net10.0-windows", HOST_EXECUTABLE_NAME),
    nodePath.join(assetEditorRoot, HOST_PROJECT_RELATIVE_PATH, "bin", "Release", "net10.0-windows", HOST_EXECUTABLE_NAME),
    nodePath.join(
      assetEditorRoot,
      HOST_PROJECT_RELATIVE_PATH,
      "bin",
      "Release",
      "net10.0-windows",
      "win-x64",
      HOST_EXECUTABLE_NAME,
    ),
  ];
};

/**
 * Development prefers WH3_ASSET_HOST_PATH, then a sibling `assedFork` checkout (the normal local
 * layout for this integration). Packaged builds will use the self-contained host copied beside the
 * app's resources in the packaging milestone.
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
      "Build Tools/WH3AssetHost/WH3AssetHost.csproj in the AssetEditor checkout or set WH3_ASSET_HOST_PATH.",
      candidates.length > 0 ? `Checked: ${candidates.join(" | ")}` : "No executable candidates were available.",
    ].join(" "),
  );
};

const disposeRunningHost = () => {
  runningHost?.client.dispose();
  runningHost = null;
};

const startHost = async (): Promise<RunningHost> => {
  if (runningHost?.client.isConnected) return runningHost;
  if (startingHost) return startingHost;

  disposeRunningHost();
  startingHost = (async () => {
    const client = new Wh3AssetHostClient({ executablePath: resolveWh3AssetHostExecutablePath() });
    try {
      await client.start();
      await client.hello();
      const host = {
        client,
        packInitializer: new Wh3AssetHostPackInitializer(client),
      };
      runningHost = host;
      return host;
    } catch (error) {
      client.dispose();
      throw error;
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

const exportVisualsModelNow = async (assetPath: string, enabledModsValue: unknown) => {
  if (process.platform !== "win32") {
    return { success: false as const, error: "The WH3 model preview host currently requires Windows." };
  }
  if (appData.currentGame !== "wh3") {
    return { success: false as const, error: "3D model previews currently support Total War: WARHAMMER III only." };
  }

  const normalizedAssetPath = assetPath?.trim();
  if (!normalizedAssetPath) return { success: false as const, error: "No model asset path was provided." };

  const enabledMods = sanitizeEnabledMods(enabledModsValue);
  const previewId = randomUUID();
  const outputRoot = getOutputRoot();
  const previewDirectory = nodePath.join(outputRoot, previewId);
  const outputPath = `${previewId}\\model.glb`;
  let registered = false;

  try {
    await prepareOutputRoot();
    const host = await startHost();
    const packPaths = getWh3AssetHostPackPathsForMods(enabledMods);
    await host.packInitializer.ensureInitializedForPackPaths(packPaths, outputRoot);
    const result = await host.client.exportModel({
      assetPath: normalizedAssetPath,
      outputPath,
    });

    if (!result.success || !result.primaryFile) {
      const hostErrors = result.errors?.map((error) => error.message).filter(Boolean).join(" | ");
      return {
        success: false as const,
        error: hostErrors || "WH3AssetHost did not produce a GLB for this model.",
        warnings: result.warnings?.map((warning) => warning.message) ?? [],
      };
    }

    registerModelPreviewFile(previewId, result.primaryFile);
    previews.set(previewId, { directory: nodePath.dirname(result.primaryFile) });
    registered = true;
    return {
      success: true as const,
      previewId,
      url: modelPreviewAssetUrl(previewId),
      warnings: result.warnings?.map((warning) => warning.message) ?? [],
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
ipcMain.handle("exportVisualsModel", async (_event, assetPath: string, enabledMods: unknown) =>
  exportVisualsModel(() => exportVisualsModelNow(assetPath, enabledMods)),
);

ipcMain.removeHandler("releaseVisualsModelPreview");
ipcMain.handle("releaseVisualsModelPreview", async (_event, previewId: string) => {
  if (previewId) await removePreview(previewId);
  return { success: true };
});

app.once("before-quit", () => {
  for (const previewId of previews.keys()) {
    revokeModelPreviewFile(previewId);
  }
  previews.clear();
  disposeRunningHost();
});