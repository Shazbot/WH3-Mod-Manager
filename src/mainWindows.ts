import type { BrowserWindow } from "electron";

/** The app's open windows, set by the main process as each one is created. */
export const windows = {
  mainWindow: undefined as BrowserWindow | undefined,
  viewerWindow: undefined as BrowserWindow | undefined,
  skillsWindow: undefined as BrowserWindow | undefined,
  techTreesWindow: undefined as BrowserWindow | undefined,
};

/**
 * Opens a pack in the viewer, registered by registerIpcMainListeners via setOpenModInViewer.
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

export const setOpenModInViewer = (open: (modPath: string) => void) => {
  openModInViewerFromMainProcess = open;
};
