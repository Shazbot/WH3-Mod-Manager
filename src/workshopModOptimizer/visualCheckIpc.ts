import * as fs from "node:fs";
import * as nodePath from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import appData from "../appData";
import { getVanillaPackFilesCachePath } from "../vanillaPackFilesCache";
import { ensureWh3AssetHostVanillaCache } from "../wh3AssetHostVanillaCache";
import { resolveWh3AssetHostExecutablePath } from "../wh3AssetHostIpc";
import { getBundledSchemaPath } from "./runtime";
import {
  type VisualCheckFailureCode,
  type VisualCheckMod,
  type VisualCheckReport,
  type VisualCheckDeps,
  checkReportFileNameFor,
  dependencyPacksOf,
  runVisualAssetCheck,
} from "./visualCheck";

/**
 * The state of the (single) visual asset check, as the renderer sees it. The main process owns the
 * run; the renderer starts, cancels, dismisses and reads the state, and gets every change pushed.
 */
export type VisualAssetCheckState =
  | { state: "idle" }
  | { state: "running"; modName: string; modPath: string; stage?: string; item?: string; fraction: number }
  | { state: "done"; report: VisualCheckReport }
  | {
      state: "failed";
      modName: string;
      modPath: string;
      code: VisualCheckFailureCode | "BUSY" | "NO_GAME";
      message: string;
    };

export const VISUAL_CHECK_FOLDER = "visual-asset-checks";

/** Reports and scratch files live in the app data folder (%APPDATA%\wh3mm\visual-asset-checks), not in the game folder. */
export const getVisualCheckDirectories = (userDataFolder: string) => {
  const root = nodePath.join(userDataFolder, VISUAL_CHECK_FOLDER);
  return {
    root,
    reports: nodePath.join(root, "reports"),
    temp: nodePath.join(root, "tmp"),
    hostCache: nodePath.join(root, "host-cache"),
  };
};

const isPackPath = (path: unknown): path is string => typeof path === "string" && /\.pack$/i.test(path);

let current: VisualAssetCheckState = { state: "idle" };
let controller: AbortController | undefined;

export const registerVisualAssetCheckIpc = (mainWindow: BrowserWindow) => {
  const publish = (next: VisualAssetCheckState) => {
    current = next;
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("visualAssetCheckState", next);
  };

  ipcMain.handle("getVisualAssetCheckState", () => current);

  ipcMain.handle(
    "startVisualAssetCheck",
    async (_event, requested: VisualCheckMod, enabledMods?: { name: string; path: string; loadOrder?: number }[]) => {
      if (controller) return { success: false, code: "BUSY" as const };
      if (!requested || typeof requested.name !== "string" || !isPackPath(requested.path)) {
        return { success: false, code: "NOT_A_PACK" as const };
      }

      const mod: VisualCheckMod = { name: requested.name, path: requested.path };
      const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
      const vanillaFileIndexPath = getVanillaPackFilesCachePath();
      if (!dataFolder || !vanillaFileIndexPath) {
        publish({
          state: "failed",
          modName: mod.name,
          modPath: mod.path,
          code: "NO_GAME",
          message: "The game's data folder or the vanilla pack index is not available.",
        });
        return { success: false, code: "NO_GAME" as const };
      }

      let hostExecutablePath: string;
      try {
        hostExecutablePath = resolveWh3AssetHostExecutablePath();
      } catch (error) {
        publish({
          state: "failed",
          modName: mod.name,
          modPath: mod.path,
          code: "HOST_MISSING",
          message: error instanceof Error ? error.message : String(error),
        });
        return { success: false, code: "HOST_MISSING" as const };
      }

      const directories = getVisualCheckDirectories(app.getPath("userData"));
      const deps: VisualCheckDeps = {
        hostExecutablePath,
        vanillaFileIndexPath,
        gameDataFolder: dataFolder,
        reportsDirectory: directories.reports,
        tempDirectory: directories.temp,
        hostCacheDirectory: directories.hostCache,
        dbSchemaPath: fs.existsSync(getBundledSchemaPath()) ? getBundledSchemaPath() : undefined,
        ensureVanillaIndex: async () => {
          await ensureWh3AssetHostVanillaCache();
        },
        parentProcessId: process.pid,
        log: (message) => console.log(`[visual-check] ${message}`),
      };

      const run = new AbortController();
      controller = run;
      publish({ state: "running", modName: mod.name, modPath: mod.path, fraction: 0 });
      let lastPublished = 0;
      // Runs in the background of this handler: the renderer follows it through the pushed state.
      void runVisualAssetCheck(deps, mod, {
        signal: run.signal,
        dependencyPackPaths: dependencyPacksOf(mod, enabledMods),
        onProgress: (progress) => {
          const now = Date.now();
          if (now - lastPublished < 100) return;
          lastPublished = now;
          publish({
            state: "running",
            modName: mod.name,
            modPath: mod.path,
            stage: progress.stage,
            item: progress.item,
            fraction: progress.fraction,
          });
        },
      })
        .then((outcome) => {
          if (outcome.status === "done") publish({ state: "done", report: outcome.report });
          else if (outcome.status === "failed") {
            publish({
              state: "failed",
              modName: mod.name,
              modPath: mod.path,
              code: outcome.code,
              message: outcome.message,
            });
          } else publish({ state: "idle" });
        })
        .finally(() => {
          if (controller === run) controller = undefined;
        });
      return { success: true };
    },
  );

  // Cancels a running check; for a finished one it just returns the dialog to idle.
  ipcMain.on("cancelVisualAssetCheck", () => {
    if (controller) controller.abort();
    else publish({ state: "idle" });
  });

  const reportPathOf = (): string | undefined => {
    if (current.state !== "done") return undefined;
    const path =
      current.report.reportPath ||
      nodePath.join(
        getVisualCheckDirectories(app.getPath("userData")).reports,
        checkReportFileNameFor(current.report.modPath),
      );
    return fs.existsSync(path) ? path : undefined;
  };

  ipcMain.handle("openVisualAssetCheckReport", async () => {
    const path = reportPathOf();
    if (!path) return { success: false, error: "The report file no longer exists." };
    const failure = await shell.openPath(path);
    return failure ? { success: false, error: failure } : { success: true };
  });

  ipcMain.handle("showVisualAssetCheckReportInFolder", () => {
    const path = reportPathOf();
    if (!path) return { success: false, error: "The report file no longer exists." };
    shell.showItemInFolder(path);
    return { success: true };
  });

  ipcMain.handle("saveVisualAssetCheckReport", async (event) => {
    const path = reportPathOf();
    if (!path) return { success: false, error: "The report file no longer exists." };
    const requestingWindow = BrowserWindow.fromWebContents(event.sender);
    try {
      const result = await dialog.showSaveDialog(requestingWindow || mainWindow, {
        defaultPath: nodePath.join(app.getPath("documents"), nodePath.basename(path)),
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      await fs.promises.copyFile(path, result.filePath);
      return { success: true, savedPath: result.filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (requestingWindow && !requestingWindow.isDestroyed()) requestingWindow.focus();
    }
  });
};
