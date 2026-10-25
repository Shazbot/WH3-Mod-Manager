import { app, dialog, type BrowserWindow, type OpenDialogOptions } from "electron";
import * as path from "node:path";

let lastOpenDirectory: string | undefined;

/** Electron 43 stopped restoring the OS dialog's last directory. Remember it for this session. */
export const showOpenDialog = async (owner: BrowserWindow | undefined, options: OpenDialogOptions) => {
  const dialogOptions = {
    ...options,
    defaultPath: options.defaultPath || lastOpenDirectory || app.getPath("documents"),
  };
  const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  if (!result.canceled && result.filePaths.length > 0) {
    lastOpenDirectory = options.properties?.includes("openDirectory")
      ? result.filePaths[0]
      : path.dirname(result.filePaths[0]);
  }
  return result;
};
