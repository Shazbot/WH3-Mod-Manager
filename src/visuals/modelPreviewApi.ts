import type { VariantMeshSelection } from "./variantMesh";

export type VisualsModelPreviewMod = Pick<Mod, "name" | "path" | "loadOrder">;

export interface VisualsModelPreviewMainTiming {
  queueWaitMs: number;
  prepareHostMs: number;
  hostExportMs: number;
  registerMs: number;
  totalMs: number;
  glbBytes?: number;
}

export interface VisualsModelPreviewKtx2Timing {
  rawTextureCount: number;
  compressedBytes: number;
  decodedBytes: number;
  rawTextureWallMs: number;
  zstdDecodeMs: number;
  textureCreateMs: number;
  textureUploadMs: number;
}

export interface VisualsModelPreviewTimingReport {
  assetPath: string;
  previewId: string;
  totalMs: number;
  exportRoundTripMs: number;
  gltfLoadMs: number;
  sceneSetupMs: number;
  firstFrameWaitMs: number;
  firstRenderMs: number;
  main?: VisualsModelPreviewMainTiming;
  ktx2: VisualsModelPreviewKtx2Timing;
}

export interface VisualsModelPreviewExportResult {
  success: boolean;
  previewId?: string;
  url?: string;
  warnings?: string[];
  error?: string;
  timings?: VisualsModelPreviewMainTiming;
}

export interface VisualsModelPreviewBatchItem {
  variantSelections: readonly VariantMeshSelection[];
}

export interface VisualsModelPreviewBatchExportItemResult {
  previewId: string;
  url: string;
  warnings?: string[];
}

export interface VisualsModelPreviewBatchExportResult {
  success: boolean;
  items?: VisualsModelPreviewBatchExportItemResult[];
  warnings?: string[];
  error?: string;
  timings?: VisualsModelPreviewMainTiming;
}

export interface VisualsModelPreviewAnimationCatalogResult {
  success: boolean;
  skeletonName?: string | null;
  animations?: Array<{ path: string }>;
  diagnostics?: string[];
  error?: string;
}

export interface UnitPainterTextureExport {
  fileName: string;
  sourceVirtualPath: string;
  width: number;
  height: number;
  rgbaBytes: Uint8Array;
}

export interface UnitPainterTextureExportResult {
  success: boolean;
  packPath?: string;
  files?: string[];
  variantMeshPath?: string;
  warnings?: string[];
  canceled?: boolean;
  error?: string;
}

export interface UnitPainterProjectDecalTransfer {
  targetSourceVirtualPath: string;
  sourceName: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceRgbaBytes: Uint8Array;
  centerU: number;
  centerV: number;
  widthU: number;
  heightV: number;
  rotationDeg: number;
  tintEnabled: boolean;
  tint: { r: number; g: number; b: number };
  affectNormal: boolean;
  normalStrength: number;
  normalHeightSource: "alpha" | "luminance";
}

export interface UnitPainterProjectLayerTransfer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  kind?: "paint" | "decal";
  decal?: UnitPainterProjectDecalTransfer;
  textures: Array<{
    sourceVirtualPath: string;
    width: number;
    height: number;
    tiles: Array<{
      key: number;
      rgbaBytes: Uint8Array;
    }>;
  }>;
}

export interface UnitPainterProjectStateTransfer {
  activeLayerId: string;
  layers: UnitPainterProjectLayerTransfer[];
  usedColorHistory?: string[];
  selectedColor?: string;
}

export type UnitPainterOpenedProject = {
  formatVersion: 3;
  sourceVariantMeshDefinition: string;
  variantSelections: VariantMeshSelection[];
  activeLayerId: string;
  layers: UnitPainterProjectLayerTransfer[];
  usedColorHistory?: string[];
  selectedColor?: string;
};

export interface UnitPainterProjectOpenResult {
  success: boolean;
  canceled?: boolean;
  error?: string;
  packPath?: string;
  project?: UnitPainterOpenedProject;
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

export const exportVisualsModelBatch = async (
  assetPath: string,
  enabledMods: readonly VisualsModelPreviewMod[],
  animationPaths: readonly string[] = [],
  items: readonly VisualsModelPreviewBatchItem[] = [],
): Promise<VisualsModelPreviewBatchExportResult> =>
  (await getRendererIpc().invoke(
    "exportVisualsModelBatch",
    assetPath,
    enabledMods.map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [...animationPaths],
    items.map((item) => ({ variantSelections: [...item.variantSelections] })),
  )) as VisualsModelPreviewBatchExportResult;

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


export const reportVisualsModelPreviewTiming = async (report: VisualsModelPreviewTimingReport): Promise<void> => {
  await getRendererIpc().invoke("reportVisualsModelPreviewTiming", report);
};

export const exportUnitPainterTextures = async (
  assetPath: string,
  enabledMods: readonly VisualsModelPreviewMod[],
  variantSelections: readonly VariantMeshSelection[],
  textures: readonly UnitPainterTextureExport[],
  projectState: UnitPainterProjectStateTransfer,
  targetPackPath?: string,
): Promise<UnitPainterTextureExportResult> =>
  (await getRendererIpc().invoke(
    "exportUnitPainterTextures",
    assetPath,
    enabledMods.map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [...variantSelections],
    textures.map((texture) => ({
      fileName: texture.fileName,
      sourceVirtualPath: texture.sourceVirtualPath,
      width: texture.width,
      height: texture.height,
      rgbaBytes: texture.rgbaBytes,
    })),
    {
      activeLayerId: projectState.activeLayerId,
      usedColorHistory: projectState.usedColorHistory ? [...projectState.usedColorHistory] : undefined,
      selectedColor: projectState.selectedColor,
      layers: projectState.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        kind: layer.kind,
        decal: layer.decal
          ? {
              targetSourceVirtualPath: layer.decal.targetSourceVirtualPath,
              sourceName: layer.decal.sourceName,
              sourceWidth: layer.decal.sourceWidth,
              sourceHeight: layer.decal.sourceHeight,
              sourceRgbaBytes: layer.decal.sourceRgbaBytes,
              centerU: layer.decal.centerU,
              centerV: layer.decal.centerV,
              widthU: layer.decal.widthU,
              heightV: layer.decal.heightV,
              rotationDeg: layer.decal.rotationDeg,
              tintEnabled: layer.decal.tintEnabled,
              tint: { ...layer.decal.tint },
              affectNormal: layer.decal.affectNormal,
              normalStrength: layer.decal.normalStrength,
              normalHeightSource: layer.decal.normalHeightSource,
            }
          : undefined,
        textures: layer.textures.map((texture) => ({
          sourceVirtualPath: texture.sourceVirtualPath,
          width: texture.width,
          height: texture.height,
          tiles: texture.tiles.map((tile) => ({
            key: tile.key,
            rgbaBytes: tile.rgbaBytes,
          })),
        })),
      })),
    },
    targetPackPath,
  )) as UnitPainterTextureExportResult;


export const openUnitPainterProject = async (packPath?: string): Promise<UnitPainterProjectOpenResult> =>
  (await getRendererIpc().invoke("openUnitPainterProject", packPath)) as UnitPainterProjectOpenResult;
