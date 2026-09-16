import { app, ipcMain } from "electron";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import appData from "./appData";
import {
  modelPreviewAssetUrl,
  registerModelPreviewFile,
  revokeModelPreviewFile,
} from "./assetProtocol";
import { Wh3AssetHostClient } from "./wh3AssetHostClient";
import { Wh3AssetHostPackInitializer } from "./wh3AssetHostPacks";

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

const exportVisualsModel = async (assetPath: string) => {
  if (process.platform !== "win32") {
    return { success: false as const, error: "The WH3 model preview host currently requires Windows." };
  }
  if (appData.currentGame !== "wh3") {
    return { success: false as const, error: "3D model previews currently support Total War: WARHAMMER III only." };
  }

  const normalizedAssetPath = assetPath?.trim();
  if (!normalizedAssetPath) return { success: false as const, error: "No model asset path was provided." };

  const previewId = randomUUID();
  const outputRoot = getOutputRoot();
  const outputPath = `${previewId}\\model.glb`;

  try {
    const host = await startHost();
    await host.packInitializer.ensureInitialized(outputRoot);
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
  }
};

ipcMain.removeHandler("exportVisualsModel");
ipcMain.handle("exportVisualsModel", async (_event, assetPath: string) => exportVisualsModel(assetPath));

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
