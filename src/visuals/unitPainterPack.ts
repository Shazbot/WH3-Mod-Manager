import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";

import type { NewPackedFile } from "../packFileTypes";
import type { VariantMeshSelection } from "./variantMesh";

export const UNIT_PAINTER_PROJECT_MANIFEST_PATH = "whmm_unit_painter\\project.json";
export const UNIT_PAINTER_PROJECT_FORMAT_VERSION = 3;
export const UNIT_PAINTER_PROJECT_MAX_COLOR_HISTORY = 64;
export const UNIT_PAINTER_PROJECT_TILE_SIZE = 64;
export const UNIT_PAINTER_PROJECT_TILE_BYTES = UNIT_PAINTER_PROJECT_TILE_SIZE * UNIT_PAINTER_PROJECT_TILE_SIZE * 4;

export type UnitPainterProjectTileInput = {
  key: number;
  rgbaBytes: Uint8Array;
};

export type UnitPainterProjectTexture = {
  sourceVirtualPath: string;
  width: number;
  height: number;
  tiles: UnitPainterProjectTileInput[];
};

export type UnitPainterProjectLayerInput = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  textures: UnitPainterProjectTexture[];
};

export type UnitPainterProjectStateInput = {
  activeLayerId: string;
  layers: UnitPainterProjectLayerInput[];
  usedColorHistory?: readonly string[];
  selectedColor?: string;
};

export type UnitPainterProjectStoredTexture = {
  sourceVirtualPath: string;
  width: number;
  height: number;
  tileSize: 64;
  tileKeys: number[];
  filePath: string;
  encoding: "zstd";
};

export type UnitPainterProjectManifest = {
  formatVersion: 3;
  sourceVariantMeshDefinition: string;
  variantSelections: VariantMeshSelection[];
  activeLayerId: string;
  usedColorHistory?: string[];
  selectedColor?: string;
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    textures: UnitPainterProjectStoredTexture[];
  }>;
};

const normalizePackPath = (value: string): string => value.replace(/\//g, "\\").trim();

const isSafePackPath = (value: string): boolean => {
  if (
    !value
    || value.includes("\0")
    || value.startsWith("\\")
    || /^[a-zA-Z]:/.test(value)
    || nodePath.isAbsolute(value)
  ) {
    return false;
  }
  return !value.split("\\").some((part) => part === ".." || part === "." || part === "");
};

const isPainterManifestPath = (value: string): boolean =>
  !value.includes("\\") && /^whmm_unit_painter_manifest_.+\.json$/i.test(value);

export const ensureUnitPainterPackExtension = (filePath: string): string =>
  filePath.toLowerCase().endsWith(".pack") ? filePath : `${filePath}.pack`;

export const getUnitPainterDefaultPackName = (assetPath: string): string => {
  const fileName = normalizePackPath(assetPath).split("\\").pop() || "unit";
  const stem = fileName.replace(/\.variantmeshdefinition$/i, "").replace(/\.[^.]+$/, "");
  const safeStem = stem
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${safeStem || "unit"}_painted.pack`;
};

export const getUnitPainterNamespaceName = (packPath: string, assetPath: string): string => {
  const packFileName = packPath.replace(/\//g, "\\").split("\\").pop() || "";
  const packStem = packFileName.replace(/\.pack$/i, "");
  const sourceStem = getUnitPainterDefaultPackName(assetPath).replace(/\.pack$/i, "");
  const candidate = packStem || sourceStem;
  const sanitized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return sanitized || "painted_unit";
};

export const buildUnitPainterPackFiles = async (
  generatedDirectory: string,
  generatedVirtualPaths: readonly string[],
  expectedVariantMeshPath: string,
): Promise<NewPackedFile[]> => {
  const root = nodePath.resolve(generatedDirectory);
  const expectedVmd = normalizePackPath(expectedVariantMeshPath);
  const expectedVmdKey = expectedVmd.toLowerCase();
  const seen = new Set<string>();
  const output: NewPackedFile[] = [];
  let foundExpectedVmd = false;

  for (const rawPath of generatedVirtualPaths) {
    if (typeof rawPath !== "string") throw new Error("WH3AssetHost returned an invalid generated file path.");

    const virtualPath = normalizePackPath(rawPath);
    if (!isSafePackPath(virtualPath)) {
      throw new Error(`WH3AssetHost returned an unsafe generated file path: ${rawPath}`);
    }
    if (isPainterManifestPath(virtualPath)) continue;

    const key = virtualPath.toLowerCase();
    if (seen.has(key)) throw new Error(`WH3AssetHost returned the generated file twice: ${virtualPath}`);
    seen.add(key);

    const fullPath = nodePath.resolve(root, ...virtualPath.split("\\"));
    const relative = nodePath.relative(root, fullPath);
    if (relative === ".." || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
      throw new Error(`Generated painter file escaped its staging directory: ${virtualPath}`);
    }

    const buffer = await fs.readFile(fullPath);
    output.push({
      name: virtualPath,
      buffer,
      file_size: buffer.length,
    });

    if (key === expectedVmdKey) foundExpectedVmd = true;
  }

  if (!foundExpectedVmd) {
    throw new Error(
      `Painted export did not contain the source VariantMeshDefinition override '${expectedVmd}'.`,
    );
  }
  if (output.length === 0) throw new Error("Painted export did not produce any packable game files.");

  return output;
};


const normalizeProjectSourcePath = (value: string) => normalizePackPath(value).replace(/^\\+/, "");

const normalizeProjectColor = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : undefined;
};

const normalizeProjectColorHistory = (value: unknown): string[] | undefined => {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new Error("The unit painter project contains an invalid used-color history.");
  const colors: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const color = normalizeProjectColor(raw);
    if (!color) throw new Error("The unit painter project contains an invalid used color.");
    if (seen.has(color)) continue;
    seen.add(color);
    colors.push(color);
    if (colors.length >= UNIT_PAINTER_PROJECT_MAX_COLOR_HISTORY) break;
  }
  return colors;
};

const normalizeVariantSelections = (variantSelections: readonly VariantMeshSelection[]) =>
  [...variantSelections]
    .map((selection) => ({ slotPath: selection.slotPath, choiceIndex: selection.choiceIndex }))
    .sort((a, b) => a.slotPath.localeCompare(b.slotPath));

const validateProjectTextureInput = (texture: UnitPainterProjectTexture) => {
  const sourceVirtualPath = normalizeProjectSourcePath(texture.sourceVirtualPath);
  if (!isSafePackPath(sourceVirtualPath)) {
    throw new Error("The unit painter project contains an invalid source texture path.");
  }
  if (
    !Number.isInteger(texture.width)
    || !Number.isInteger(texture.height)
    || texture.width <= 0
    || texture.height <= 0
    || texture.width > 16384
    || texture.height > 16384
  ) {
    throw new Error(`The unit painter project texture '${sourceVirtualPath}' has invalid dimensions.`);
  }
  if (!Array.isArray(texture.tiles)) {
    throw new Error(`The unit painter project texture '${sourceVirtualPath}' has invalid tile data.`);
  }

  const tilesPerRow = Math.ceil(texture.width / UNIT_PAINTER_PROJECT_TILE_SIZE);
  const tileRows = Math.ceil(texture.height / UNIT_PAINTER_PROJECT_TILE_SIZE);
  const maxTileKey = tilesPerRow * tileRows;
  const seenTileKeys = new Set<number>();
  for (const tile of texture.tiles) {
    if (
      !tile
      || !Number.isInteger(tile.key)
      || tile.key < 0
      || tile.key >= maxTileKey
      || seenTileKeys.has(tile.key)
      || !(tile.rgbaBytes instanceof Uint8Array)
      || tile.rgbaBytes.length !== UNIT_PAINTER_PROJECT_TILE_BYTES
    ) {
      throw new Error(`The unit painter project texture '${sourceVirtualPath}' contains an invalid tile.`);
    }
    seenTileKeys.add(tile.key);
  }
  return sourceVirtualPath;
};

export const buildUnitPainterProjectPackFiles = async (
  sourceVariantMeshDefinition: string,
  variantSelections: readonly VariantMeshSelection[],
  project: UnitPainterProjectStateInput,
): Promise<NewPackedFile[]> => {
  const sourceVmd = normalizeProjectSourcePath(sourceVariantMeshDefinition);
  if (!isSafePackPath(sourceVmd) || !/\.variantmeshdefinition$/i.test(sourceVmd)) {
    throw new Error("The unit painter project contains an invalid source VariantMeshDefinition path.");
  }
  if (!project.layers.length || project.layers.length > 32) {
    throw new Error("A unit painter project must contain between 1 and 32 paint layers.");
  }

  const seenLayerIds = new Set<string>();
  const storedLayers: UnitPainterProjectManifest["layers"] = [];
  const packedTextureFiles: NewPackedFile[] = [];

  for (let layerIndex = 0; layerIndex < project.layers.length; layerIndex += 1) {
    const layer = project.layers[layerIndex];
    const id = layer.id.trim();
    const name = layer.name.trim().slice(0, 80);
    if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seenLayerIds.has(id) || !name) {
      throw new Error("The unit painter project contains an invalid or duplicate paint layer.");
    }
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
      throw new Error(`Paint layer '${name}' has an invalid opacity.`);
    }
    seenLayerIds.add(id);

    const seenSources = new Set<string>();
    const storedTextures: UnitPainterProjectStoredTexture[] = [];
    for (let textureIndex = 0; textureIndex < layer.textures.length; textureIndex += 1) {
      const texture = layer.textures[textureIndex];
      const sourceVirtualPath = validateProjectTextureInput(texture);
      const sourceKey = sourceVirtualPath.toLowerCase();
      if (seenSources.has(sourceKey)) {
        throw new Error(`Paint layer '${name}' repeats source texture '${sourceVirtualPath}'.`);
      }
      seenSources.add(sourceKey);

      const sortedTiles = [...texture.tiles].sort((a, b) => a.key - b.key);
      const tileKeys = sortedTiles.map((tile) => tile.key);
      const payload = Buffer.allocUnsafe(sortedTiles.length * UNIT_PAINTER_PROJECT_TILE_BYTES);
      for (let tileIndex = 0; tileIndex < sortedTiles.length; tileIndex += 1) {
        Buffer.from(
          sortedTiles[tileIndex].rgbaBytes.buffer,
          sortedTiles[tileIndex].rgbaBytes.byteOffset,
          sortedTiles[tileIndex].rgbaBytes.byteLength,
        ).copy(payload, tileIndex * UNIT_PAINTER_PROJECT_TILE_BYTES);
      }

      const filePath =
        `whmm_unit_painter\\layers\\${String(layerIndex + 1).padStart(2, "0")}_${id}`
        + `\\textures\\${String(textureIndex + 1).padStart(3, "0")}.tiles.zst`;
      const buffer = await zstdCompress(payload, 1);
      packedTextureFiles.push({ name: filePath, buffer, file_size: buffer.length });
      storedTextures.push({
        sourceVirtualPath,
        width: texture.width,
        height: texture.height,
        tileSize: UNIT_PAINTER_PROJECT_TILE_SIZE,
        tileKeys,
        filePath,
        encoding: "zstd",
      });
    }

    storedLayers.push({
      id,
      name,
      visible: !!layer.visible,
      opacity: layer.opacity,
      textures: storedTextures,
    });
  }

  if (!seenLayerIds.has(project.activeLayerId)) {
    throw new Error("The unit painter project active layer does not exist.");
  }

  const usedColorHistory = normalizeProjectColorHistory(project.usedColorHistory);
  const selectedColor =
    project.selectedColor == null ? undefined : normalizeProjectColor(project.selectedColor);
  if (project.selectedColor != null && !selectedColor) {
    throw new Error("The unit painter project contains an invalid selected color.");
  }

  const manifest: UnitPainterProjectManifest = {
    formatVersion: UNIT_PAINTER_PROJECT_FORMAT_VERSION,
    sourceVariantMeshDefinition: sourceVmd,
    variantSelections: normalizeVariantSelections(variantSelections),
    activeLayerId: project.activeLayerId,
    ...(usedColorHistory ? { usedColorHistory } : {}),
    ...(selectedColor ? { selectedColor } : {}),
    layers: storedLayers,
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  return [
    {
      name: UNIT_PAINTER_PROJECT_MANIFEST_PATH,
      buffer: manifestBuffer,
      file_size: manifestBuffer.length,
    },
    ...packedTextureFiles,
  ];
};

const parseCommonManifestFields = (candidate: {
  sourceVariantMeshDefinition?: unknown;
  variantSelections?: unknown;
}) => {
  if (typeof candidate.sourceVariantMeshDefinition !== "string" || !candidate.sourceVariantMeshDefinition.trim()) {
    throw new Error("The unit painter project is missing its source VariantMeshDefinition.");
  }
  const sourceVariantMeshDefinition = normalizeProjectSourcePath(candidate.sourceVariantMeshDefinition);
  if (!isSafePackPath(sourceVariantMeshDefinition) || !/\.variantmeshdefinition$/i.test(sourceVariantMeshDefinition)) {
    throw new Error("The unit painter project contains an invalid source VariantMeshDefinition path.");
  }
  if (!Array.isArray(candidate.variantSelections)) {
    throw new Error("The unit painter project manifest is incomplete.");
  }

  const variantSelections: VariantMeshSelection[] = [];
  const seenSlots = new Set<string>();
  for (const raw of candidate.variantSelections) {
    if (!raw || typeof raw !== "object") throw new Error("The unit painter project contains an invalid variant selection.");
    const selection = raw as Partial<VariantMeshSelection>;
    const slotPath = typeof selection.slotPath === "string" ? selection.slotPath.trim() : "";
    if (!slotPath || !Number.isInteger(selection.choiceIndex) || selection.choiceIndex! < 0) {
      throw new Error("The unit painter project contains an invalid variant selection.");
    }
    const key = slotPath.toLowerCase();
    if (seenSlots.has(key)) throw new Error(`The unit painter project repeats slot '${slotPath}'.`);
    seenSlots.add(key);
    variantSelections.push({ slotPath, choiceIndex: selection.choiceIndex! });
  }
  return { sourceVariantMeshDefinition, variantSelections };
};

const parseStoredTexture = (
  raw: unknown,
  seenSources: Set<string>,
  seenFiles: Set<string>,
): UnitPainterProjectStoredTexture => {
  if (!raw || typeof raw !== "object") throw new Error("The unit painter project contains an invalid painted texture.");
  const texture = raw as Partial<UnitPainterProjectStoredTexture>;
  const sourceVirtualPath =
    typeof texture.sourceVirtualPath === "string" ? normalizeProjectSourcePath(texture.sourceVirtualPath) : "";
  const filePath = typeof texture.filePath === "string" ? normalizePackPath(texture.filePath) : "";
  const width = typeof texture.width === "number" && Number.isInteger(texture.width) ? texture.width : 0;
  const height = typeof texture.height === "number" && Number.isInteger(texture.height) ? texture.height : 0;
  if (
    !sourceVirtualPath
    || !isSafePackPath(sourceVirtualPath)
    || !filePath
    || !isSafePackPath(filePath)
    || !/^whmm_unit_painter\\layers\\.+\\textures\\.+\.tiles\.zst$/i.test(filePath)
    || texture.encoding !== "zstd"
    || texture.tileSize !== UNIT_PAINTER_PROJECT_TILE_SIZE
    || width <= 0
    || height <= 0
    || width > 16384
    || height > 16384
    || !Array.isArray(texture.tileKeys)
  ) {
    throw new Error("The unit painter project contains an invalid painted texture.");
  }

  const tilesPerRow = Math.ceil(width / UNIT_PAINTER_PROJECT_TILE_SIZE);
  const tileRows = Math.ceil(height / UNIT_PAINTER_PROJECT_TILE_SIZE);
  const maxTileKey = tilesPerRow * tileRows;
  const tileKeys: number[] = [];
  const seenTiles = new Set<number>();
  for (const rawKey of texture.tileKeys) {
    if (
      typeof rawKey !== "number"
      || !Number.isInteger(rawKey)
      || rawKey < 0
      || rawKey >= maxTileKey
      || seenTiles.has(rawKey)
    ) {
      throw new Error("The unit painter project contains invalid or duplicate tile keys.");
    }
    seenTiles.add(rawKey);
    tileKeys.push(rawKey);
  }

  const sourceKey = sourceVirtualPath.toLowerCase();
  const fileKey = filePath.toLowerCase();
  if (seenSources.has(sourceKey) || seenFiles.has(fileKey)) {
    throw new Error("The unit painter project contains duplicate texture entries.");
  }
  seenSources.add(sourceKey);
  seenFiles.add(fileKey);
  return {
    sourceVirtualPath,
    width,
    height,
    tileSize: UNIT_PAINTER_PROJECT_TILE_SIZE,
    tileKeys,
    filePath,
    encoding: "zstd",
  };
};

export const parseUnitPainterProjectManifest = (buffer: Uint8Array): UnitPainterProjectManifest => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    throw new Error("The unit painter project manifest is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("The unit painter project manifest is invalid.");
  const candidate = value as Record<string, unknown>;
  if (candidate.formatVersion !== UNIT_PAINTER_PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported unit painter project format '${String(candidate.formatVersion)}'. Expected version ${UNIT_PAINTER_PROJECT_FORMAT_VERSION}.`,
    );
  }

  const common = parseCommonManifestFields(candidate);
  if (!Array.isArray(candidate.layers) || candidate.layers.length === 0 || candidate.layers.length > 32) {
    throw new Error("The unit painter project contains an invalid paint layer stack.");
  }
  const activeLayerId = typeof candidate.activeLayerId === "string" ? candidate.activeLayerId.trim() : "";
  const seenLayerIds = new Set<string>();
  const seenFiles = new Set<string>();
  const layers: UnitPainterProjectManifest["layers"] = [];

  for (const rawLayer of candidate.layers) {
    if (!rawLayer || typeof rawLayer !== "object") throw new Error("The unit painter project contains an invalid paint layer.");
    const layer = rawLayer as Record<string, unknown>;
    const id = typeof layer.id === "string" ? layer.id.trim() : "";
    const name = typeof layer.name === "string" ? layer.name.trim().slice(0, 80) : "";
    const opacity = typeof layer.opacity === "number" ? layer.opacity : Number.NaN;
    if (
      !id
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)
      || seenLayerIds.has(id)
      || !name
      || typeof layer.visible !== "boolean"
      || !Number.isFinite(opacity)
      || opacity < 0
      || opacity > 1
      || !Array.isArray(layer.textures)
    ) {
      throw new Error("The unit painter project contains an invalid paint layer.");
    }
    seenLayerIds.add(id);
    const seenSources = new Set<string>();
    const textures = layer.textures.map((raw) => parseStoredTexture(raw, seenSources, seenFiles));
    layers.push({ id, name, visible: layer.visible, opacity, textures });
  }

  if (!activeLayerId || !seenLayerIds.has(activeLayerId)) {
    throw new Error("The unit painter project active layer is invalid.");
  }

  const usedColorHistory = normalizeProjectColorHistory(candidate.usedColorHistory);
  const selectedColor =
    candidate.selectedColor == null ? undefined : normalizeProjectColor(candidate.selectedColor);
  if (candidate.selectedColor != null && !selectedColor) {
    throw new Error("The unit painter project contains an invalid selected color.");
  }

  return {
    formatVersion: UNIT_PAINTER_PROJECT_FORMAT_VERSION,
    ...common,
    activeLayerId,
    ...(usedColorHistory ? { usedColorHistory } : {}),
    ...(selectedColor ? { selectedColor } : {}),
    layers,
  };
};

export const decodeUnitPainterProjectTiles = async (
  compressed: Uint8Array,
  tileCount: number,
): Promise<Buffer> => {
  if (!Number.isInteger(tileCount) || tileCount < 0) {
    throw new Error("The saved painter tile count is invalid.");
  }
  const expectedBytes = tileCount * UNIT_PAINTER_PROJECT_TILE_BYTES;
  const decoded = await zstdDecompress(Buffer.from(compressed));
  if (decoded.length !== expectedBytes) {
    throw new Error(`The saved painter tiles decoded to ${decoded.length} bytes; expected ${expectedBytes}.`);
  }
  return decoded;
};
