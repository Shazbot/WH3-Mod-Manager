import { ipcRenderer } from "electron";

export type VisualsModelPreviewMod = Pick<Mod, "name" | "path" | "loadOrder">;

export interface VisualsModelPreviewExportResult {
  success: boolean;
  previewId?: string;
  url?: string;
  warnings?: string[];
  error?: string;
}

/** Renderer-facing surface for the model preview integration. Model bytes stay on disk. */
export const exportVisualsModel = (
  assetPath: string,
  enabledMods: readonly VisualsModelPreviewMod[],
): Promise<VisualsModelPreviewExportResult> =>
  ipcRenderer.invoke(
    "exportVisualsModel",
    assetPath,
    enabledMods.map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
  );

export const releaseVisualsModelPreview = (previewId: string): Promise<{ success: boolean }> =>
  ipcRenderer.invoke("releaseVisualsModelPreview", previewId);
