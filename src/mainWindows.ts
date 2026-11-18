import type { BrowserWindow } from "electron";

/** The app's open windows, set by the main process as each one is created. */
export const windows = {
  mainWindow: undefined as BrowserWindow | undefined,
  viewerWindow: undefined as BrowserWindow | undefined,
  skillsWindow: undefined as BrowserWindow | undefined,
  techTreesWindow: undefined as BrowserWindow | undefined,
};
