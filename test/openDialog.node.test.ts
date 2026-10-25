import * as path from "node:path";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeOpenDialog } = vi.hoisted(() => ({ nativeOpenDialog: vi.fn() }));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => path.join("home", "Documents")) },
  dialog: { showOpenDialog: nativeOpenDialog },
}));

describe("open-dialog directory history", () => {
  beforeEach(() => {
    vi.resetModules();
    nativeOpenDialog.mockReset();
    nativeOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  });

  it("uses Documents initially and remembers the directory of an imported file", async () => {
    const { showOpenDialog } = await import("../src/openDialog");
    const owner = {} as BrowserWindow;
    nativeOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path.join("mods", "import.pack")] });

    await showOpenDialog(owner, { properties: ["openFile", "multiSelections"] });
    expect(nativeOpenDialog).toHaveBeenLastCalledWith(owner, {
      properties: ["openFile", "multiSelections"],
      defaultPath: path.join("home", "Documents"),
    });
    await showOpenDialog(undefined, { properties: ["openFile"] });
    expect(nativeOpenDialog).toHaveBeenLastCalledWith({ properties: ["openFile"], defaultPath: "mods" });
  });

  it("remembers a selected directory itself and preserves explicit defaults", async () => {
    const { showOpenDialog } = await import("../src/openDialog");
    nativeOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path.join("mods", "textures")] });
    await showOpenDialog(undefined, { properties: ["openDirectory"] });
    await showOpenDialog(undefined, { properties: ["openFile"], defaultPath: "game" });
    expect(nativeOpenDialog).toHaveBeenLastCalledWith({ properties: ["openFile"], defaultPath: "game" });

    await showOpenDialog(undefined, { properties: ["openDirectory"] });
    expect(nativeOpenDialog).toHaveBeenLastCalledWith({
      properties: ["openDirectory"],
      defaultPath: path.join("mods", "textures"),
    });
  });

  it("does not replace history when the dialog is canceled or fails", async () => {
    const { showOpenDialog } = await import("../src/openDialog");
    nativeOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path.join("mods", "import.pack")] });
    await showOpenDialog(undefined, { properties: ["openFile"] });
    nativeOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [path.join("other", "ignored.pack")] });
    await showOpenDialog(undefined, { properties: ["openFile"] });
    nativeOpenDialog.mockRejectedValueOnce(new Error("dialog failed"));
    await expect(showOpenDialog(undefined, { properties: ["openFile"] })).rejects.toThrow("dialog failed");
    await showOpenDialog(undefined, { properties: ["openFile"] });
    expect(nativeOpenDialog).toHaveBeenLastCalledWith({ properties: ["openFile"], defaultPath: "mods" });
  });
});
