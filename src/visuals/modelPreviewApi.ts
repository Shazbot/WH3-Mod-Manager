import { ipcRenderer } from "electron";

export interface VisualsModelPreviewExportResult {
  success: boolean;
  previewId?: string;
  url?: string;
  warnings?: string[];
  error?: string;
}

/** Renderer-facing surface for the model preview integration. Model bytes stay on disk. */
export const exportVisualsModel = (assetPath: string): Promise<VisualsModelPreviewExportResult> =>
  ipcRenderer.invoke("exportVisualsModel", assetPath);

export const releaseVisualsModelPreview = (previewId: string): Promise<{ success: boolean }> =>
  ipcRenderer.invoke("releaseVisualsModelPreview", previewId);
