import type { VariantMeshSelection } from "./variantMesh";

export type VisualsModelPreviewMod = Pick<Mod, "name" | "path" | "loadOrder">;

export interface VisualsModelPreviewExportResult {
  success: boolean;
  previewId?: string;
  url?: string;
  warnings?: string[];
  error?: string;
}

export interface VisualsModelPreviewAnimationCatalogResult {
  success: boolean;
  skeletonName?: string | null;
  animations?: Array<{ path: string }>;
  diagnostics?: string[];
  error?: string;
}

type RendererIpc = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

/**
 * The app currently runs the main renderer with nodeIntegration enabled and contextIsolation disabled.
 * Resolve Electron at runtime through the renderer's Node require instead of statically importing it:
 * a static `import "electron"` makes Webpack try to bundle Electron itself and its Node-only `fs`
 * dependency into the renderer bundle.
 */
const getRendererIpc = (): RendererIpc => {
  const rendererWindow = window as typeof window & {
    require?: (moduleName: string) => { ipcRenderer?: RendererIpc };
  };
  const ipcRenderer = rendererWindow.require?.("electron")?.ipcRenderer;
  if (!ipcRenderer) throw new Error("Electron ipcRenderer is not available in this renderer.");
  return ipcRenderer;
};

/** Renderer-facing surface for the model preview integration. Model bytes stay on disk. */
export const exportVisualsModel = async (
  assetPath: string,
  enabledMods: readonly VisualsModelPreviewMod[],
  animationPaths: readonly string[] = [],
  variantSelections: readonly VariantMeshSelection[] = [],
): Promise<VisualsModelPreviewExportResult> =>
  (await getRendererIpc().invoke(
    "exportVisualsModel",
    assetPath,
    enabledMods.map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [...animationPaths],
    [...variantSelections],
  )) as VisualsModelPreviewExportResult;

export const getVisualsModelAnimationCatalog = async (
  assetPath: string,
  enabledMods: readonly VisualsModelPreviewMod[],
): Promise<VisualsModelPreviewAnimationCatalogResult> =>
  (await getRendererIpc().invoke(
    "getVisualsModelAnimationCatalog",
    assetPath,
    enabledMods.map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
  )) as VisualsModelPreviewAnimationCatalogResult;

export const releaseVisualsModelPreview = async (previewId: string): Promise<{ success: boolean }> =>
  (await getRendererIpc().invoke("releaseVisualsModelPreview", previewId)) as { success: boolean };
