import * as THREE from "three";
import { MeshBVH, SkinnedMeshBVH, acceleratedRaycast } from "three-mesh-bvh";

export type UnitPainterBrushMode = "recolor" | "paint" | "restore";
export type UnitPainterSurfaceSelectionScope = "material" | "island";
export type UnitPainterSelectionScope = "all" | UnitPainterSurfaceSelectionScope | "similar";
export type UnitPainterSelectionOperation = "replace" | "add" | "toggle";
export type UnitPainterSelectionSplitKind = "vertical" | "horizontal" | "slash" | "backslash" | "x";

export type UnitPainterSelectionPartitionInfo = {
  kind: UnitPainterSelectionSplitKind;
  sourceScope: Exclude<UnitPainterSelectionScope, "all">;
  regions: Array<{ id: string; label: string; active: boolean }>;
  allActive: boolean;
};

export type UnitPainterSelectionInfo = {
  objectName: string;
  materialName: string;
  hasUvIsland: boolean;
  object: THREE.Mesh;
  textureId: string;
};

export type UnitPainterPixelMaskView = {
  width: number;
  height: number;
  tileSize: number;
  /** Packed one-bit selection tiles. Treat as read-only. */
  tiles: ReadonlyMap<number, Uint8Array>;
};

export type UnitPainterTextureView = {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Live flattened BaseColour data. Treat as read-only. */
  data: Uint8Array;
  /** x1,y1,x2,y2 in normalized transformed UV coordinates. */
  uvSegments: Float32Array;
  /** Current material/island selection in the same coordinate format. */
  selectedUvSegments: Float32Array;
  /** x1,y1,x2,y2,x3,y3 triangles for clipping/dimming the selected UV footprint. */
  selectedUvTriangles: Float32Array;
  /** Frozen pixel mask used by Select Similar. */
  selectedPixelMask?: UnitPainterPixelMaskView;
};

export type UnitPainterStrokeGpuProfile = {
  updateRanges: number;
  updateBytes: number;
};

export type UnitPainterTexturePaintResult = {
  changed: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type UnitPainterTextureHover = {
  textureId: string;
  x: number;
  y: number;
  scope: Exclude<UnitPainterSelectionScope, "all">;
  uvSegments: Float32Array;
};

export type UnitPainterSurfaceHighlight = {
  object: THREE.Mesh;
  scope: "material" | "island";
  materialIndex: number;
  islandId?: number;
  /** Triangle vertex indices into the source geometry. */
  indices: number[];
  /** Stable while the highlighted mesh/material/island is unchanged. */
  key: string;
};

/** Mirror a world-space point through an object's local X=0 plane. */
export const mirrorPointAcrossObjectLocalX = (
  point: THREE.Vector3,
  root: THREE.Object3D,
  target = new THREE.Vector3(),
) => {
  root.updateWorldMatrix(true, false);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  target.copy(point).applyMatrix4(inverse);
  target.x = -target.x;
  return target.applyMatrix4(root.matrixWorld);
};

/** Mirror a world-space ray through an object's local X=0 plane. */
export const mirrorRayAcrossObjectLocalX = (
  ray: THREE.Ray,
  root: THREE.Object3D,
  target = new THREE.Ray(),
) => {
  root.updateWorldMatrix(true, false);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  target.copy(ray).applyMatrix4(inverse);
  target.origin.x = -target.origin.x;
  target.direction.x = -target.direction.x;
  return target.applyMatrix4(root.matrixWorld);
};

export type UnitPainterBrushSettings = {
  radiusPx: number;
  opacity: number;
  hardness: number;
  mode: UnitPainterBrushMode;
  color: { r: number; g: number; b: number };
};

type PaintableMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  needsUpdate: boolean;
};

type PaintableTexture = {
  original: THREE.DataTexture;
  editable: THREE.DataTexture;
  /** Flattened Base + visible paint layers shown in Three and used for export. */
  data: Uint8Array;
  originalData: Uint8Array;
  width: number;
  height: number;
  sourceFileName: string;
  sourceVirtualPath?: string;
  textureId: string;
  revision: number;
  touchedLayerTiles: Set<number>;
  fullUploadPending: boolean;
};

type PaintableSurface = {
  mesh: THREE.Mesh;
  material: PaintableMaterial;
  geometry: THREE.BufferGeometry;
  materialIndex: number;
};

type LayerTile = {
  data: Uint8Array;
  nonZeroPixels: number;
};

type LayerTexture = {
  tiles: Map<number, LayerTile>;
};

export type UnitPainterDecalSource = {
  name: string;
  width: number;
  height: number;
  rgbaBytes: Uint8Array;
};

export type UnitPainterDecalHeightSource = "alpha" | "luminance";

type UnitPainterDecalState = {
  target: PaintableTexture;
  normalTarget?: PaintableTexture;
  source: UnitPainterDecalSource;
  centerU: number;
  centerV: number;
  widthU: number;
  heightV: number;
  rotationDeg: number;
  tintEnabled: boolean;
  tint: { r: number; g: number; b: number };
  affectNormal: boolean;
  normalStrength: number;
  normalHeightSource: UnitPainterDecalHeightSource;
};

type PaintLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  kind: "paint" | "decal";
  textures: Map<PaintableTexture, LayerTexture>;
  decal?: UnitPainterDecalState;
};

export type UnitPainterLayerInfo = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  kind: "paint" | "decal";
};

export type UnitPainterDecalInfo = {
  layerId: string;
  targetTextureId: string;
  sourceName: string;
  centerU: number;
  centerV: number;
  widthU: number;
  heightV: number;
  rotationDeg: number;
  tintEnabled: boolean;
  tint: { r: number; g: number; b: number };
  affectNormal: boolean;
  normalStrength: number;
  normalHeightSource: UnitPainterDecalHeightSource;
  hasNormalMap: boolean;
};

export type UnitPainterProjectTile = {
  key: number;
  rgbaBytes: Uint8Array;
};

export type UnitPainterProjectLayerTexture = {
  sourceVirtualPath: string;
  width: number;
  height: number;
  tiles: UnitPainterProjectTile[];
};

export type UnitPainterProjectDecal = {
  targetSourceVirtualPath: string;
  normalSourceVirtualPath?: string;
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
  normalHeightSource: UnitPainterDecalHeightSource;
};

export type UnitPainterProjectLayer = Omit<UnitPainterLayerInfo, "kind"> & {
  /** Missing kind is an older format-3 paint layer. */
  kind?: "paint" | "decal";
  textures: UnitPainterProjectLayerTexture[];
  decal?: UnitPainterProjectDecal;
};

export type UnitPainterProjectState = {
  activeLayerId: string;
  layers: UnitPainterProjectLayer[];
};

export type UnitPainterExportTexture = {
  fileName: string;
  sourceVirtualPath: string;
  width: number;
  height: number;
  rgbaBytes: Uint8Array;
};

type MaterialRestore = {
  material: PaintableMaterial;
  property: "map" | "normalMap";
  original: THREE.DataTexture;
};

type UnitPainterSelection = {
  mesh: THREE.Mesh;
  material: PaintableMaterial;
  materialIndex: number;
  target: PaintableTexture;
  islandId?: number;
  key: string;
};

type UnitPainterSelectionPartitionRegion = {
  id: string;
  label: string;
  masks: Map<PaintableTexture, UvIslandMask>;
};

type UnitPainterSelectionPartition = {
  kind: UnitPainterSelectionSplitKind;
  sourceScope: Exclude<UnitPainterSelectionScope, "all">;
  sourceMasks: Map<PaintableTexture, UvIslandMask>;
  regions: UnitPainterSelectionPartitionRegion[];
  activeRegionIds: Set<string>;
  activeMasks: Map<PaintableTexture, UvIslandMask>;
};

type PackedStrokeChange = {
  kind: "packed";
  layerId: string;
  target: PaintableTexture;
  byteIndices: Uint32Array;
  before: Uint32Array;
  after: Uint32Array;
};

type StrokeChange = PackedStrokeChange;

type LayerSnapshot = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  kind: "paint" | "decal";
  textures: Array<{ target: PaintableTexture; data: LayerTexture }>;
  decal?: UnitPainterDecalState;
};

type LayerMetadata = Pick<PaintLayer, "name" | "visible" | "opacity">;

type HistoryChange =
  | { kind: "pixels"; changes: StrokeChange[] }
  | {
      kind: "layer-add";
      layer: LayerSnapshot;
      index: number;
      beforeActiveLayerId: string;
      afterActiveLayerId: string;
    }
  | {
      kind: "layer-delete";
      layer: LayerSnapshot;
      index: number;
      beforeActiveLayerId: string;
      afterActiveLayerId: string;
    }
  | { kind: "layer-meta"; layerId: string; before: LayerMetadata; after: LayerMetadata }
  | { kind: "layer-order"; before: string[]; after: string[] }
  | {
      kind: "layer-replace";
      index: number;
      before: LayerSnapshot[];
      after: LayerSnapshot[];
      beforeActiveLayerId: string;
      afterActiveLayerId: string;
    };

type Stroke = {
  change: HistoryChange;
  beforeStateId: number;
  afterStateId: number;
  byteSize: number;
};

type UvTriangle = {
  faceIndex: number;
  uvA: THREE.Vector2;
  uvB: THREE.Vector2;
  uvC: THREE.Vector2;
};

type UvIslandTopology = {
  faceToIsland: Map<number, number>;
  islands: Map<number, UvTriangle[]>;
};

type UvIslandMask = {
  width: number;
  height: number;
  tiles: Map<number, Uint8Array>;
  byteSize: number;
};

type CachedUvMask = {
  cacheId: number;
  mask: UvIslandMask;
};

const MAX_HISTORY_STROKES = 30;
const MAX_HISTORY_BYTES = 96 * 1024 * 1024;
const HISTORY_BASE_OVERHEAD_BYTES = 256;
const HISTORY_SNAPSHOT_OVERHEAD_BYTES = 256;
const HISTORY_TEXTURE_OVERHEAD_BYTES = 128;
const HISTORY_TILE_OVERHEAD_BYTES = 64;
const MAX_PAINT_LAYERS = 32;
const LAYER_TILE_SIZE = 64;
const LAYER_TILE_PIXELS = LAYER_TILE_SIZE * LAYER_TILE_SIZE;
const LAYER_TILE_BYTES = LAYER_TILE_PIXELS * 4;
const MASK_TILE_SIZE = 64;
const MASK_TILE_PIXELS = MASK_TILE_SIZE * MASK_TILE_SIZE;
const MASK_TILE_BYTES = Math.ceil(MASK_TILE_PIXELS / 8);
const MAX_UV_MASK_CACHE_BYTES = 32 * 1024 * 1024;
const MIN_BRUSH_RADIUS_TEXELS = 1;
// A pathological UV/world-area ratio can otherwise turn a small screen brush into a
// million-pixel CPU stamp. GPU projection can remove this cap later; keep interaction responsive now.
const MAX_BRUSH_RADIUS_TEXELS = 192;
const MAX_BRUSH_TEXTURE_FRACTION = 0.15;
const BRUSH_SPACING_RATIO = 0.35;
const MAX_DECAL_SOURCE_DIMENSION = 8192;
const MAX_DECAL_SOURCE_BYTES = 64 * 1024 * 1024;

export const getUnitPainterBrushSpacing = (radiusPx: number) =>
  Math.max(2, Math.max(1, radiusPx) * BRUSH_SPACING_RATIO);

export type UnitPainterStrokeSample = { x: number; y: number; amount: number };

export const sampleUnitPainterStrokeSegment = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  spacing: number,
  distanceSinceLastStamp: number,
): { samples: UnitPainterStrokeSample[]; distanceSinceLastStamp: number } => {
  const safeSpacing = Math.max(0.001, spacing);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= Number.EPSILON) {
    return { samples: [], distanceSinceLastStamp: Math.max(0, distanceSinceLastStamp) };
  }

  let carried = Math.max(0, distanceSinceLastStamp) % safeSpacing;
  let travelled = 0;
  let distanceToNext = safeSpacing - carried;
  const samples: UnitPainterStrokeSample[] = [];

  while (travelled + distanceToNext <= distance + 1e-6) {
    travelled += distanceToNext;
    const amount = Math.min(1, travelled / distance);
    samples.push({
      x: startX + deltaX * amount,
      y: startY + deltaY * amount,
      amount,
    });
    carried = 0;
    distanceToNext = safeSpacing;
  }

  carried += Math.max(0, distance - travelled);
  if (Math.abs(carried - safeSpacing) <= 1e-6) carried = 0;
  return { samples, distanceSinceLastStamp: carried };
};

const sanitizeExportFileName = (value: string) => {
  const trimmed = value.replace(/[?#].*$/, "").split(/[\\/]/).pop() || "painted_texture";
  const stem = trimmed.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[_\.]+|[_\.]+$/g, "");
  return `${stem || "painted_texture"}.rgba`;
};

const getTextureExportFileName = (texture: THREE.DataTexture, index: number) => {
  const sourceVirtualPath = texture.userData.wh3SourceVirtualPath;
  if (typeof sourceVirtualPath === "string" && sourceVirtualPath) {
    return sanitizeExportFileName(sourceVirtualPath);
  }

  const previewUrl = texture.userData.wh3PreviewTextureUrl;
  if (typeof previewUrl === "string" && previewUrl) {
    try {
      return sanitizeExportFileName(decodeURIComponent(previewUrl));
    } catch {
      return sanitizeExportFileName(previewUrl);
    }
  }
  if (texture.name) return sanitizeExportFileName(texture.name);
  return `painted_texture_${String(index + 1).padStart(2, "0")}.rgba`;
};

const getDataTextureImage = (texture: THREE.DataTexture) => {
  const image = texture.image as { data?: ArrayBufferView; width?: number; height?: number } | undefined;
  if (
    !image ||
    !(image.data instanceof Uint8Array) ||
    typeof image.width !== "number" ||
    typeof image.height !== "number" ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return undefined;
  }
  return {
    data: image.data,
    width: image.width,
    height: image.height,
  };
};

const cloneEditableDataTexture = (texture: THREE.DataTexture, data: Uint8Array, width: number, height: number) => {
  const editable = new THREE.DataTexture(
    new Uint8Array(data),
    width,
    height,
    texture.format as THREE.PixelFormat,
    texture.type,
  );
  editable.name = texture.name;
  editable.mapping = texture.mapping;
  editable.channel = texture.channel;
  editable.wrapS = texture.wrapS;
  editable.wrapT = texture.wrapT;
  editable.magFilter = texture.magFilter;
  editable.minFilter = texture.minFilter;
  editable.anisotropy = texture.anisotropy;
  editable.colorSpace = texture.colorSpace;
  editable.offset.copy(texture.offset);
  editable.repeat.copy(texture.repeat);
  editable.center.copy(texture.center);
  editable.rotation = texture.rotation;
  editable.matrixAutoUpdate = texture.matrixAutoUpdate;
  editable.matrix.copy(texture.matrix);
  editable.generateMipmaps = false;
  editable.premultiplyAlpha = texture.premultiplyAlpha;
  editable.flipY = texture.flipY;
  editable.unpackAlignment = texture.unpackAlignment;
  editable.userData = { ...texture.userData, wh3UnitPainterEditable: true };
  delete editable.userData.wh3RawKtx2CacheKey;
  editable.needsUpdate = true;
  return editable;
};

const asPaintableMaterial = (material: THREE.Material): PaintableMaterial | undefined => {
  if (!("map" in material)) return undefined;
  return material as PaintableMaterial;
};

const getIntersectionMaterial = (intersection: THREE.Intersection<THREE.Object3D>) => {
  if (!(intersection.object instanceof THREE.Mesh)) return undefined;
  const material = intersection.object.material;
  if (!Array.isArray(material)) return asPaintableMaterial(material);
  const materialIndex = intersection.face?.materialIndex ?? 0;
  const selected = material[materialIndex];
  return selected ? asPaintableMaterial(selected) : undefined;
};

const packPixel = (data: Uint8Array, byteIndex: number) =>
  (data[byteIndex] |
    (data[byteIndex + 1] << 8) |
    (data[byteIndex + 2] << 16) |
    (data[byteIndex + 3] << 24)) >>>
  0;

const unpackPixel = (value: number, data: Uint8Array, byteIndex: number) => {
  data[byteIndex] = value & 0xff;
  data[byteIndex + 1] = (value >>> 8) & 0xff;
  data[byteIndex + 2] = (value >>> 16) & 0xff;
  data[byteIndex + 3] = (value >>> 24) & 0xff;
};

const createLayerTexture = (): LayerTexture => ({ tiles: new Map() });

const cloneLayerTexture = (source: LayerTexture): LayerTexture => ({
  tiles: new Map(
    [...source.tiles].map(([key, tile]) => [
      key,
      { data: new Uint8Array(tile.data), nonZeroPixels: tile.nonZeroPixels },
    ] as const),
  ),
});

const getLayerTileAddress = (target: PaintableTexture, byteIndex: number) => {
  const pixelIndex = Math.floor(byteIndex / 4);
  const x = pixelIndex % target.width;
  const y = Math.floor(pixelIndex / target.width);
  const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
  const tileX = Math.floor(x / LAYER_TILE_SIZE);
  const tileY = Math.floor(y / LAYER_TILE_SIZE);
  const tileKey = tileY * tilesPerRow + tileX;
  const localX = x - tileX * LAYER_TILE_SIZE;
  const localY = y - tileY * LAYER_TILE_SIZE;
  return {
    tileKey,
    localByteIndex: (localY * LAYER_TILE_SIZE + localX) * 4,
  };
};

const getLayerPixel = (texture: LayerTexture, target: PaintableTexture, byteIndex: number) => {
  const { tileKey, localByteIndex } = getLayerTileAddress(target, byteIndex);
  const tile = texture.tiles.get(tileKey);
  return tile ? packPixel(tile.data, localByteIndex) : 0;
};

const setLayerPixel = (
  texture: LayerTexture,
  target: PaintableTexture,
  byteIndex: number,
  packedValue: number,
) => {
  const { tileKey, localByteIndex } = getLayerTileAddress(target, byteIndex);
  const normalizedValue = ((packedValue >>> 24) & 0xff) === 0 ? 0 : packedValue >>> 0;
  let tile = texture.tiles.get(tileKey);
  if (!tile) {
    if (normalizedValue === 0) return;
    tile = { data: new Uint8Array(LAYER_TILE_BYTES), nonZeroPixels: 0 };
    texture.tiles.set(tileKey, tile);
  }

  const oldAlpha = tile.data[localByteIndex + 3];
  const newAlpha = (normalizedValue >>> 24) & 0xff;
  if (oldAlpha === 0 && newAlpha !== 0) tile.nonZeroPixels += 1;
  else if (oldAlpha !== 0 && newAlpha === 0) tile.nonZeroPixels -= 1;

  unpackPixel(normalizedValue, tile.data, localByteIndex);
  target.touchedLayerTiles.add(tileKey);
  if (tile.nonZeroPixels === 0) texture.tiles.delete(tileKey);
};

const forEachLayerPixel = (
  texture: LayerTexture,
  target: PaintableTexture,
  callback: (byteIndex: number, value: number) => void,
) => {
  const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
  for (const [tileKey, tile] of texture.tiles) {
    const tileX = tileKey % tilesPerRow;
    const tileY = Math.floor(tileKey / tilesPerRow);
    const startX = tileX * LAYER_TILE_SIZE;
    const startY = tileY * LAYER_TILE_SIZE;
    const width = Math.min(LAYER_TILE_SIZE, target.width - startX);
    const height = Math.min(LAYER_TILE_SIZE, target.height - startY);
    for (let localY = 0; localY < height; localY += 1) {
      for (let localX = 0; localX < width; localX += 1) {
        const localByteIndex = (localY * LAYER_TILE_SIZE + localX) * 4;
        if (tile.data[localByteIndex + 3] === 0) continue;
        const byteIndex = ((startY + localY) * target.width + startX + localX) * 4;
        callback(byteIndex, packPixel(tile.data, localByteIndex));
      }
    }
  }
};

const wrapCoordinate = (value: number, size: number, wrapping: THREE.Wrapping) => {
  if (wrapping === THREE.RepeatWrapping) return ((value % size) + size) % size;
  return Math.max(0, Math.min(size - 1, value));
};

const estimateBrushRadiusTexels = (
  intersection: THREE.Intersection<THREE.Object3D>,
  target: PaintableTexture,
  screenRadiusPx: number,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
) => {
  if (!(intersection.object instanceof THREE.Mesh) || !intersection.face || viewportHeight <= 0) {
    return Math.max(MIN_BRUSH_RADIUS_TEXELS, screenRadiusPx * 0.5);
  }

  const mesh = intersection.object;
  const geometry = mesh.geometry;
  const uvAttribute = geometry.getAttribute("uv");
  if (!uvAttribute) {
    return Math.max(MIN_BRUSH_RADIUS_TEXELS, screenRadiusPx * 0.5);
  }

  const { a, b, c } = intersection.face;
  const worldA = mesh.localToWorld(mesh.getVertexPosition(a, new THREE.Vector3()));
  const worldB = mesh.localToWorld(mesh.getVertexPosition(b, new THREE.Vector3()));
  const worldC = mesh.localToWorld(mesh.getVertexPosition(c, new THREE.Vector3()));
  const worldArea =
    worldB.clone().sub(worldA).cross(worldC.clone().sub(worldA)).length() * 0.5;
  if (worldArea <= Number.EPSILON) return MIN_BRUSH_RADIUS_TEXELS;

  target.editable.updateMatrix();
  const uvA = new THREE.Vector2(uvAttribute.getX(a), uvAttribute.getY(a)).applyMatrix3(target.editable.matrix);
  const uvB = new THREE.Vector2(uvAttribute.getX(b), uvAttribute.getY(b)).applyMatrix3(target.editable.matrix);
  const uvC = new THREE.Vector2(uvAttribute.getX(c), uvAttribute.getY(c)).applyMatrix3(target.editable.matrix);
  const uvArea =
    Math.abs(
      (uvB.x - uvA.x) * (uvC.y - uvA.y) -
        (uvB.y - uvA.y) * (uvC.x - uvA.x),
    ) * 0.5;
  if (uvArea <= Number.EPSILON) return MIN_BRUSH_RADIUS_TEXELS;

  const distance = Math.max(intersection.point.distanceTo(camera.position), 0.0001);
  const worldViewportHeight =
    2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  const worldRadius = (screenRadiusPx / viewportHeight) * worldViewportHeight;
  const uvPerWorld = Math.sqrt(uvArea / worldArea);
  const textureScale = Math.sqrt(target.width * target.height);
  const radius = worldRadius * uvPerWorld * textureScale;
  const maxRadius = Math.min(
    MAX_BRUSH_RADIUS_TEXELS,
    Math.max(target.width, target.height) * MAX_BRUSH_TEXTURE_FRACTION,
  );
  return Math.max(MIN_BRUSH_RADIUS_TEXELS, Math.min(radius, maxRadius));
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const getBrushFalloff = (distance: number, hardness: number) => {
  const clampedHardness = clamp01(hardness);
  if (distance > 1) return 0;
  if (distance <= clampedHardness || clampedHardness >= 0.999) return 1;
  const amount = clamp01((1 - distance) / Math.max(1 - clampedHardness, Number.EPSILON));
  return amount * amount * (3 - 2 * amount);
};

const uvPointKey = (point: THREE.Vector2) =>
  `${Math.round(point.x * 1_000_000)},${Math.round(point.y * 1_000_000)}`;

const uvEdgeKey = (first: THREE.Vector2, second: THREE.Vector2) => {
  const a = uvPointKey(first);
  const b = uvPointKey(second);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

const getTriangleMaterialIndex = (geometry: THREE.BufferGeometry, faceIndex: number) => {
  if (geometry.groups.length === 0) return 0;
  const offset = faceIndex * 3;
  const group = geometry.groups.find(
    (candidate) => offset >= candidate.start && offset < candidate.start + candidate.count,
  );
  return group?.materialIndex ?? 0;
};

const getTriangleVertexIndices = (geometry: THREE.BufferGeometry, faceIndex: number) => {
  const base = faceIndex * 3;
  if (geometry.index) {
    if (base + 2 >= geometry.index.count) return undefined;
    return [
      geometry.index.getX(base),
      geometry.index.getX(base + 1),
      geometry.index.getX(base + 2),
    ] as const;
  }

  const positions = geometry.getAttribute("position");
  if (!positions || base + 2 >= positions.count) return undefined;
  return [base, base + 1, base + 2] as const;
};

const getMaterialFaceIndices = (geometry: THREE.BufferGeometry, materialIndex: number) => {
  const positions = geometry.getAttribute("position");
  if (!positions) return [];
  const triangleCount = Math.floor((geometry.index?.count ?? positions.count) / 3);
  const faces: number[] = [];
  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    if (getTriangleMaterialIndex(geometry, faceIndex) === materialIndex) faces.push(faceIndex);
  }
  return faces;
};

const getSurfaceTriangleIndices = (geometry: THREE.BufferGeometry, faceIndices: readonly number[]) => {
  const indices: number[] = [];
  for (const faceIndex of faceIndices) {
    const triangle = getTriangleVertexIndices(geometry, faceIndex);
    if (!triangle) continue;
    indices.push(triangle[0], triangle[1], triangle[2]);
  }
  return indices;
};

const createUvIslandTopology = (
  geometry: THREE.BufferGeometry,
  materialIndex: number,
): UvIslandTopology | undefined => {
  const uv = geometry.getAttribute("uv");
  const positions = geometry.getAttribute("position");
  if (!uv || !positions) return undefined;

  const triangleCount = Math.floor((geometry.index?.count ?? positions.count) / 3);
  const triangles = new Map<number, UvTriangle>();
  const edgeToFaces = new Map<string, number[]>();

  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    if (getTriangleMaterialIndex(geometry, faceIndex) !== materialIndex) continue;
    const indices = getTriangleVertexIndices(geometry, faceIndex);
    if (!indices) continue;
    const [a, b, c] = indices;
    if (a >= uv.count || b >= uv.count || c >= uv.count) continue;

    const uvA = new THREE.Vector2(uv.getX(a), uv.getY(a));
    const uvB = new THREE.Vector2(uv.getX(b), uv.getY(b));
    const uvC = new THREE.Vector2(uv.getX(c), uv.getY(c));
    const twiceArea = Math.abs(
      (uvB.x - uvA.x) * (uvC.y - uvA.y) - (uvB.y - uvA.y) * (uvC.x - uvA.x),
    );
    if (twiceArea <= Number.EPSILON) continue;

    triangles.set(faceIndex, { faceIndex, uvA, uvB, uvC });
    for (const key of [uvEdgeKey(uvA, uvB), uvEdgeKey(uvB, uvC), uvEdgeKey(uvC, uvA)]) {
      const faces = edgeToFaces.get(key);
      if (faces) faces.push(faceIndex);
      else edgeToFaces.set(key, [faceIndex]);
    }
  }

  if (triangles.size === 0) return undefined;

  const neighbors = new Map<number, Set<number>>();
  const addNeighbor = (from: number, to: number) => {
    let values = neighbors.get(from);
    if (!values) {
      values = new Set();
      neighbors.set(from, values);
    }
    values.add(to);
  };
  for (const faces of edgeToFaces.values()) {
    if (faces.length < 2) continue;
    const first = faces[0];
    for (let index = 1; index < faces.length; index += 1) {
      addNeighbor(first, faces[index]);
      addNeighbor(faces[index], first);
    }
  }

  const faceToIsland = new Map<number, number>();
  const islands = new Map<number, UvTriangle[]>();
  let nextIsland = 0;
  for (const faceIndex of triangles.keys()) {
    if (faceToIsland.has(faceIndex)) continue;
    const islandId = nextIsland++;
    const pending = [faceIndex];
    const islandTriangles: UvTriangle[] = [];
    faceToIsland.set(faceIndex, islandId);

    while (pending.length > 0) {
      const current = pending.pop()!;
      const triangle = triangles.get(current);
      if (triangle) islandTriangles.push(triangle);
      for (const neighbor of neighbors.get(current) ?? []) {
        if (faceToIsland.has(neighbor)) continue;
        faceToIsland.set(neighbor, islandId);
        pending.push(neighbor);
      }
    }
    islands.set(islandId, islandTriangles);
  }

  return { faceToIsland, islands };
};

const pointInTriangle = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) => {
  const ab = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  const bc = (px - bx) * (cy - by) - (py - by) * (cx - bx);
  const ca = (px - cx) * (ay - cy) - (py - cy) * (ax - cx);
  const epsilon = 1e-6;
  const hasNegative = ab < -epsilon || bc < -epsilon || ca < -epsilon;
  const hasPositive = ab > epsilon || bc > epsilon || ca > epsilon;
  return !(hasNegative && hasPositive);
};

const getMaskTileAddress = (mask: UvIslandMask, x: number, y: number) => {
  const tilesPerRow = Math.ceil(mask.width / MASK_TILE_SIZE);
  const tileX = Math.floor(x / MASK_TILE_SIZE);
  const tileY = Math.floor(y / MASK_TILE_SIZE);
  const tileKey = tileY * tilesPerRow + tileX;
  const localX = x - tileX * MASK_TILE_SIZE;
  const localY = y - tileY * MASK_TILE_SIZE;
  return {
    tileKey,
    localIndex: localY * MASK_TILE_SIZE + localX,
  };
};

const setMaskPixel = (mask: UvIslandMask, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
  const { tileKey, localIndex } = getMaskTileAddress(mask, x, y);
  let tile = mask.tiles.get(tileKey);
  if (!tile) {
    tile = new Uint8Array(MASK_TILE_BYTES);
    mask.tiles.set(tileKey, tile);
    mask.byteSize += tile.byteLength;
  }
  const byteIndex = localIndex >> 3;
  const bit = 1 << (localIndex & 7);
  tile[byteIndex] |= bit;
};

const buildUvIslandMask = (
  triangles: readonly UvTriangle[],
  target: PaintableTexture,
): UvIslandMask | undefined => {
  if (triangles.length === 0) return undefined;

  target.editable.updateMatrix();
  const mask: UvIslandMask = {
    width: target.width,
    height: target.height,
    tiles: new Map(),
    byteSize: 0,
  };

  for (const triangle of triangles) {
    const uvA = triangle.uvA.clone();
    const uvB = triangle.uvB.clone();
    const uvC = triangle.uvC.clone();
    target.editable.transformUv(uvA);
    target.editable.transformUv(uvB);
    target.editable.transformUv(uvC);
    const a = new THREE.Vector2(uvA.x * target.width, uvA.y * target.height);
    const b = new THREE.Vector2(uvB.x * target.width, uvB.y * target.height);
    const c = new THREE.Vector2(uvC.x * target.width, uvC.y * target.height);

    const triangleMinY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const triangleMaxY = Math.min(target.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    if (triangleMaxY < triangleMinY) continue;

    const edges = [[a, b], [b, c], [c, a]] as const;
    for (let y = triangleMinY; y <= triangleMaxY; y += 1) {
      const scanY = y + 0.5;
      const intersections: number[] = [];

      for (const [first, second] of edges) {
        const minY = Math.min(first.y, second.y);
        const maxY = Math.max(first.y, second.y);
        if (scanY < minY - 1e-9 || scanY > maxY + 1e-9) continue;

        const dy = second.y - first.y;
        if (Math.abs(dy) <= 1e-12) {
          if (Math.abs(scanY - first.y) <= 1e-9) {
            intersections.push(first.x, second.x);
          }
          continue;
        }

        const amount = (scanY - first.y) / dy;
        if (amount < -1e-9 || amount > 1 + 1e-9) continue;
        intersections.push(first.x + (second.x - first.x) * amount);
      }

      if (intersections.length < 2) continue;
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      for (const x of intersections) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }

      // Pixel centers are at x + 0.5. Convert the continuous scanline span to
      // the inclusive integer texel range whose centers lie inside/on the triangle.
      const firstX = Math.ceil(minX - 0.5 - 1e-9);
      const lastX = Math.floor(maxX - 0.5 + 1e-9);
      if (lastX >= firstX) setMaskSpan(mask, y, firstX, lastX);
    }
  }

  return mask.tiles.size > 0 ? mask : undefined;
};

const maskContainsPixel = (mask: UvIslandMask, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const { tileKey, localIndex } = getMaskTileAddress(mask, x, y);
  const tile = mask.tiles.get(tileKey);
  if (!tile) return false;
  const byteIndex = localIndex >> 3;
  const bit = 1 << (localIndex & 7);
  return (tile[byteIndex] & bit) !== 0;
};

const clearMaskPixel = (mask: UvIslandMask, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
  const { tileKey, localIndex } = getMaskTileAddress(mask, x, y);
  const tile = mask.tiles.get(tileKey);
  if (!tile) return;
  const byteIndex = localIndex >> 3;
  const bit = 1 << (localIndex & 7);
  tile[byteIndex] &= (~bit) & 0xff;
};

const pruneEmptyMaskTiles = (mask: UvIslandMask) => {
  for (const [tileKey, tile] of [...mask.tiles]) {
    if (tile.some((value) => value !== 0)) continue;
    mask.tiles.delete(tileKey);
    mask.byteSize = Math.max(0, mask.byteSize - tile.byteLength);
  }
};

const unionUvMasks = (masks: readonly UvIslandMask[]): UvIslandMask | undefined => {
  const first = masks[0];
  if (!first) return undefined;
  const result: UvIslandMask = {
    width: first.width,
    height: first.height,
    tiles: new Map(),
    byteSize: 0,
  };

  for (const mask of masks) {
    if (mask.width !== result.width || mask.height !== result.height) continue;
    for (const [tileKey, tile] of mask.tiles) {
      let target = result.tiles.get(tileKey);
      if (!target) {
        target = new Uint8Array(tile.length);
        result.tiles.set(tileKey, target);
        result.byteSize += target.byteLength;
      }
      for (let index = 0; index < tile.length; index += 1) {
        target[index] |= tile[index];
      }
    }
  }
  return result.tiles.size > 0 ? result : undefined;
};

const xorUvMasks = (
  first: UvIslandMask | undefined,
  second: UvIslandMask,
): UvIslandMask | undefined => {
  if (!first) return second;
  const result: UvIslandMask = {
    width: first.width,
    height: first.height,
    tiles: new Map(),
    byteSize: 0,
  };
  const tileKeys = new Set([...first.tiles.keys(), ...second.tiles.keys()]);
  for (const tileKey of tileKeys) {
    const firstTile = first.tiles.get(tileKey);
    const secondTile = second.tiles.get(tileKey);
    const tileLength = firstTile?.length ?? secondTile?.length ?? MASK_TILE_BYTES;
    const target = new Uint8Array(tileLength);
    let nonZero = false;
    for (let index = 0; index < tileLength; index += 1) {
      target[index] = (firstTile?.[index] ?? 0) ^ (secondTile?.[index] ?? 0);
      if (target[index] !== 0) nonZero = true;
    }
    if (!nonZero) continue;
    result.tiles.set(tileKey, target);
    result.byteSize += target.byteLength;
  }
  return result.tiles.size > 0 ? result : undefined;
};

const getUvMaskBounds = (mask: UvIslandMask) => {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  forEachMaskPixel(mask, (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : undefined;
};

const getSelectionSplitRegionDefinitions = (
  kind: UnitPainterSelectionSplitKind,
): Array<{ id: string; label: string }> => {
  switch (kind) {
    case "vertical":
      return [{ id: "left", label: "Left" }, { id: "right", label: "Right" }];
    case "horizontal":
      return [{ id: "top", label: "Top" }, { id: "bottom", label: "Bottom" }];
    case "slash":
      return [{ id: "upperLeft", label: "Upper-left" }, { id: "lowerRight", label: "Lower-right" }];
    case "backslash":
      return [{ id: "upperRight", label: "Upper-right" }, { id: "lowerLeft", label: "Lower-left" }];
    case "x":
      return [
        { id: "top", label: "Top" },
        { id: "right", label: "Right" },
        { id: "bottom", label: "Bottom" },
        { id: "left", label: "Left" },
      ];
  }
};

const getSelectionSplitRegionId = (
  kind: UnitPainterSelectionSplitKind,
  u: number,
  v: number,
) => {
  switch (kind) {
    case "vertical":
      return u < 0.5 ? "left" : "right";
    case "horizontal":
      return v < 0.5 ? "top" : "bottom";
    case "slash":
      return u + v < 1 ? "upperLeft" : "lowerRight";
    case "backslash":
      return u >= v ? "upperRight" : "lowerLeft";
    case "x": {
      const slash = u + v - 1;
      const backslash = u - v;
      if (slash < 0 && backslash >= 0) return "top";
      if (slash >= 0 && backslash >= 0) return "right";
      if (slash >= 0 && backslash < 0) return "bottom";
      return "left";
    }
  }
};

const partitionUvMask = (
  source: UvIslandMask,
  kind: UnitPainterSelectionSplitKind,
) => {
  const definitions = getSelectionSplitRegionDefinitions(kind);
  const result = new Map<string, UvIslandMask>(
    definitions.map(({ id }) => [
      id,
      { width: source.width, height: source.height, tiles: new Map(), byteSize: 0 },
    ]),
  );
  const bounds = getUvMaskBounds(source);
  if (!bounds) return result;

  const width = Math.max(1, bounds.maxX - bounds.minX + 1);
  const height = Math.max(1, bounds.maxY - bounds.minY + 1);
  forEachMaskPixel(source, (x, y) => {
    const u = (x - bounds.minX + 0.5) / width;
    const v = (y - bounds.minY + 0.5) / height;
    const region = result.get(getSelectionSplitRegionId(kind, u, v));
    if (region) setMaskPixel(region, x, y);
  });
  return result;
};

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
});

const rgbBytesToOklab = (r: number, g: number, b: number) => {
  const linearR = SRGB_TO_LINEAR[r];
  const linearG = SRGB_TO_LINEAR[g];
  const linearB = SRGB_TO_LINEAR[b];

  const l = 0.4122214708 * linearR + 0.5363325363 * linearG + 0.0514459929 * linearB;
  const m = 0.2119034982 * linearR + 0.6806995451 * linearG + 0.1073969566 * linearB;
  const s = 0.0883024619 * linearR + 0.2817188376 * linearG + 0.6299787005 * linearB;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
};

const buildSimilarColorMask = (
  target: PaintableTexture,
  sampleX: number,
  sampleY: number,
  tolerance: number,
): UvIslandMask | undefined => {
  const x = Math.max(0, Math.min(target.width - 1, Math.floor(sampleX)));
  const y = Math.max(0, Math.min(target.height - 1, Math.floor(sampleY)));
  const sampleByteIndex = (y * target.width + x) * 4;
  const sampleR = target.data[sampleByteIndex];
  const sampleG = target.data[sampleByteIndex + 1];
  const sampleB = target.data[sampleByteIndex + 2];
  const mask: UvIslandMask = {
    width: target.width,
    height: target.height,
    tiles: new Map(),
    byteSize: 0,
  };

  const normalizedTolerance = Math.max(0, Math.min(100, tolerance));
  if (normalizedTolerance === 0) {
    for (let byteIndex = 0, pixelIndex = 0; byteIndex < target.data.length; byteIndex += 4, pixelIndex += 1) {
      if (
        target.data[byteIndex] !== sampleR
        || target.data[byteIndex + 1] !== sampleG
        || target.data[byteIndex + 2] !== sampleB
      ) {
        continue;
      }
      setMaskPixel(mask, pixelIndex % target.width, Math.floor(pixelIndex / target.width));
    }
    return mask.tiles.size > 0 ? mask : undefined;
  }

  const sample = rgbBytesToOklab(sampleR, sampleG, sampleB);
  // OKLab's useful sRGB gamut spans roughly this distance for practical paint colors.
  const threshold = (normalizedTolerance / 100) * 0.45;
  const thresholdSquared = threshold * threshold;
  for (let byteIndex = 0, pixelIndex = 0; byteIndex < target.data.length; byteIndex += 4, pixelIndex += 1) {
    const candidate = rgbBytesToOklab(
      target.data[byteIndex],
      target.data[byteIndex + 1],
      target.data[byteIndex + 2],
    );
    const deltaL = candidate.l - sample.l;
    const deltaA = candidate.a - sample.a;
    const deltaB = candidate.b - sample.b;
    if (deltaL * deltaL + deltaA * deltaA + deltaB * deltaB > thresholdSquared) continue;
    setMaskPixel(mask, pixelIndex % target.width, Math.floor(pixelIndex / target.width));
  }
  return mask.tiles.size > 0 ? mask : undefined;
};

const forEachMaskPixel = (
  mask: UvIslandMask,
  callback: (x: number, y: number) => void,
) => {
  const tilesPerRow = Math.ceil(mask.width / MASK_TILE_SIZE);
  for (const [tileKey, tile] of mask.tiles) {
    const tileX = tileKey % tilesPerRow;
    const tileY = Math.floor(tileKey / tilesPerRow);
    const startX = tileX * MASK_TILE_SIZE;
    const startY = tileY * MASK_TILE_SIZE;
    const width = Math.min(MASK_TILE_SIZE, mask.width - startX);
    const height = Math.min(MASK_TILE_SIZE, mask.height - startY);
    for (let localY = 0; localY < height; localY += 1) {
      for (let localX = 0; localX < width; localX += 1) {
        const localIndex = localY * MASK_TILE_SIZE + localX;
        const byteIndex = localIndex >> 3;
        const bit = 1 << (localIndex & 7);
        if ((tile[byteIndex] & bit) === 0) continue;
        callback(startX + localX, startY + localY);
      }
    }
  }
};

const setMaskSpan = (mask: UvIslandMask, y: number, startX: number, endX: number) => {
  if (y < 0 || y >= mask.height || endX < 0 || startX >= mask.width) return;
  const firstX = Math.max(0, startX);
  const lastX = Math.min(mask.width - 1, endX);
  const tilesPerRow = Math.ceil(mask.width / MASK_TILE_SIZE);
  const tileY = Math.floor(y / MASK_TILE_SIZE);
  const localY = y - tileY * MASK_TILE_SIZE;
  const firstTileX = Math.floor(firstX / MASK_TILE_SIZE);
  const lastTileX = Math.floor(lastX / MASK_TILE_SIZE);

  for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
    const tileStartX = tileX * MASK_TILE_SIZE;
    const localStartX = Math.max(0, firstX - tileStartX);
    const localEndX = Math.min(MASK_TILE_SIZE - 1, lastX - tileStartX);
    const tileKey = tileY * tilesPerRow + tileX;
    let tile = mask.tiles.get(tileKey);
    if (!tile) {
      tile = new Uint8Array(MASK_TILE_BYTES);
      mask.tiles.set(tileKey, tile);
      mask.byteSize += tile.byteLength;
    }

    const rowByteStart = localY * (MASK_TILE_SIZE / 8);
    const firstByte = Math.floor(localStartX / 8);
    const lastByte = Math.floor(localEndX / 8);
    const firstBit = localStartX & 7;
    const lastBit = localEndX & 7;
    if (firstByte === lastByte) {
      const maskBits = ((0xff << firstBit) & (0xff >>> (7 - lastBit))) & 0xff;
      tile[rowByteStart + firstByte] |= maskBits;
      continue;
    }

    tile[rowByteStart + firstByte] |= (0xff << firstBit) & 0xff;
    for (let byteIndex = firstByte + 1; byteIndex < lastByte; byteIndex += 1) {
      tile[rowByteStart + byteIndex] = 0xff;
    }
    tile[rowByteStart + lastByte] |= 0xff >>> (7 - lastBit);
  }
};

const dilateUvMask = (source: UvIslandMask, padding: number): UvIslandMask => {
  const radius = Math.max(0, Math.floor(padding));
  if (radius === 0) return source;

  const result: UvIslandMask = {
    width: source.width,
    height: source.height,
    tiles: new Map(),
    byteSize: 0,
  };

  for (let y = 0; y < source.height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= source.width; x += 1) {
      const inside = x < source.width && maskContainsPixel(source, x, y);
      if (inside && runStart < 0) {
        runStart = x;
        continue;
      }
      if (inside || runStart < 0) continue;

      const runEnd = x - 1;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const targetY = y + dy;
        if (targetY < 0 || targetY >= source.height) continue;
        const horizontal = Math.floor(Math.sqrt(radius * radius - dy * dy));
        setMaskSpan(result, targetY, runStart - horizontal, runEnd + horizontal);
      }
      runStart = -1;
    }
  }

  return result;
};

const protectOccupiedUvPixels = (
  padded: UvIslandMask,
  selected: UvIslandMask,
  occupied: UvIslandMask | undefined,
) => {
  if (!occupied) return padded;
  forEachMaskPixel(occupied, (x, y) => {
    if (!maskContainsPixel(selected, x, y)) clearMaskPixel(padded, x, y);
  });
  pruneEmptyMaskTiles(padded);
  return padded;
};

const blendLayerPixelFromStrokeStart = (
  target: PaintableTexture,
  byteIndex: number,
  sourcePacked: number,
  settings: UnitPainterBrushSettings,
  coverage: number,
) => {
  const sourceR = sourcePacked & 0xff;
  const sourceG = (sourcePacked >>> 8) & 0xff;
  const sourceB = (sourcePacked >>> 16) & 0xff;
  const sourceA = (sourcePacked >>> 24) & 0xff;

  const blend = clamp01(coverage);
  if (settings.mode === "restore") {
    const a = Math.round(sourceA * (1 - blend));
    if (a === 0) return 0;
    return (sourceR | (sourceG << 8) | (sourceB << 16) | (a << 24)) >>> 0;
  }

  let targetR = settings.color.r;
  let targetG = settings.color.g;
  let targetB = settings.color.b;
  if (settings.mode === "recolor") {
    const originalValue = Math.max(
      target.originalData[byteIndex],
      target.originalData[byteIndex + 1],
      target.originalData[byteIndex + 2],
    ) / 255;
    targetR *= originalValue;
    targetG *= originalValue;
    targetB *= originalValue;
  }

  // Layer tiles store straight-alpha color. Applying brush opacity to both RGB
  // and alpha would attenuate a fresh stroke twice during layer composition.
  const sourceAlpha = sourceA / 255;
  const outputAlpha = blend + sourceAlpha * (1 - blend);
  if (outputAlpha <= 0) return 0;
  const sourceWeight = sourceAlpha * (1 - blend);
  const r = Math.round((targetR * blend + sourceR * sourceWeight) / outputAlpha);
  const g = Math.round((targetG * blend + sourceG * sourceWeight) / outputAlpha);
  const b = Math.round((targetB * blend + sourceB * sourceWeight) / outputAlpha);
  const a = Math.round(outputAlpha * 255);
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
};

const cloneDecalSource = (source: UnitPainterDecalSource): UnitPainterDecalSource => ({
  name: source.name,
  width: source.width,
  height: source.height,
  rgbaBytes: new Uint8Array(source.rgbaBytes),
});

const cloneDecalState = (decal: UnitPainterDecalState): UnitPainterDecalState => ({
  target: decal.target,
  normalTarget: decal.normalTarget,
  // Source bytes are immutable after import; history snapshots share them instead
  // of cloning a potentially multi-megabyte bitmap for every transform step.
  source: decal.source,
  centerU: decal.centerU,
  centerV: decal.centerV,
  widthU: decal.widthU,
  heightV: decal.heightV,
  rotationDeg: decal.rotationDeg,
  tintEnabled: decal.tintEnabled,
  tint: { ...decal.tint },
  affectNormal: decal.affectNormal,
  normalStrength: decal.normalStrength,
  normalHeightSource: decal.normalHeightSource,
});

const validateDecalSource = (source: UnitPainterDecalSource) => {
  const expectedBytes = source.width * source.height * 4;
  return (
    !!source.name.trim()
    && Number.isInteger(source.width)
    && Number.isInteger(source.height)
    && source.width > 0
    && source.height > 0
    && source.width <= MAX_DECAL_SOURCE_DIMENSION
    && source.height <= MAX_DECAL_SOURCE_DIMENSION
    && Number.isSafeInteger(expectedBytes)
    && expectedBytes > 0
    && expectedBytes <= MAX_DECAL_SOURCE_BYTES
    && source.rgbaBytes instanceof Uint8Array
    && source.rgbaBytes.length === expectedBytes
  );
};

const sampleDecalSource = (
  source: UnitPainterDecalSource,
  u: number,
  v: number,
) => {
  if (u < 0 || v < 0 || u > 1 || v > 1) return undefined;
  const x = Math.max(0, Math.min(source.width - 1, Math.round(u * (source.width - 1))));
  const y = Math.max(0, Math.min(source.height - 1, Math.round(v * (source.height - 1))));
  const byteIndex = (y * source.width + x) * 4;
  return {
    r: source.rgbaBytes[byteIndex],
    g: source.rgbaBytes[byteIndex + 1],
    b: source.rgbaBytes[byteIndex + 2],
    a: source.rgbaBytes[byteIndex + 3],
  };
};

const getDecalSourceUv = (
  decal: UnitPainterDecalState,
  textureU: number,
  textureV: number,
) => {
  const radians = THREE.MathUtils.degToRad(decal.rotationDeg);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = textureU - decal.centerU;
  const dy = textureV - decal.centerV;
  const localX = cos * dx + sin * dy;
  const localY = -sin * dx + cos * dy;
  return {
    u: localX / Math.max(Math.abs(decal.widthU), 1e-6) + 0.5,
    v: localY / Math.max(Math.abs(decal.heightV), 1e-6) + 0.5,
  };
};

const getDecalBounds = (
  decal: UnitPainterDecalState,
  width: number,
  height: number,
) => {
  const radians = THREE.MathUtils.degToRad(decal.rotationDeg);
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfU = Math.abs(decal.widthU) * 0.5;
  const halfV = Math.abs(decal.heightV) * 0.5;
  const extentU = halfU * cos + halfV * sin;
  const extentV = halfU * sin + halfV * cos;
  return {
    minX: Math.max(0, Math.floor((decal.centerU - extentU) * width) - 1),
    maxX: Math.min(width - 1, Math.ceil((decal.centerU + extentU) * width) + 1),
    minY: Math.max(0, Math.floor((decal.centerV - extentV) * height) - 1),
    maxY: Math.min(height - 1, Math.ceil((decal.centerV + extentV) * height) + 1),
  };
};

const getDecalHeight = (
  decal: UnitPainterDecalState,
  textureU: number,
  textureV: number,
) => {
  const sourceUv = getDecalSourceUv(decal, textureU, textureV);
  const pixel = sampleDecalSource(decal.source, sourceUv.u, sourceUv.v);
  if (!pixel) return 0;
  const alpha = pixel.a / 255;
  if (decal.normalHeightSource === "alpha") return alpha;
  const luminance = (0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b) / 255;
  return luminance * alpha;
};

const decodeNormalByte = (value: number) => value / 127.5 - 1;
const encodeNormalByte = (value: number) => Math.round(clamp01(value * 0.5 + 0.5) * 255);

const blendReorientedNormal = (
  baseX: number,
  baseY: number,
  baseZ: number,
  detailX: number,
  detailY: number,
  detailZ: number,
) => {
  const tx = baseX;
  const ty = baseY;
  const tz = baseZ + 1;
  const ux = -detailX;
  const uy = -detailY;
  const uz = detailZ;
  const dot = tx * ux + ty * uy + tz * uz;
  const scale = dot / Math.max(tz, 1e-5);
  let x = tx * scale - ux;
  let y = ty * scale - uy;
  let z = tz * scale - uz;
  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;
  return { x, y, z };
};

type ResolvedBrushIntersection = {
  target: PaintableTexture;
  mask: UvIslandMask | undefined;
  centerX: number;
  centerY: number;
  radius: number;
};

type DirtyRowSpan = { minX: number; maxX: number };

export class UnitPainterSession {
  private readonly targetsByEditableTexture = new Map<THREE.Texture, PaintableTexture>();
  private readonly targetsBySourcePath = new Map<string, PaintableTexture>();
  private readonly normalTargetsByOriginal = new Map<THREE.DataTexture, PaintableTexture>();
  private readonly normalTargetsBySourcePath = new Map<string, PaintableTexture>();
  private readonly normalTargetByMaterial = new Map<PaintableMaterial, PaintableTexture>();
  private readonly normalTargetsByBaseTarget = new Map<PaintableTexture, Set<PaintableTexture>>();
  private readonly restores: MaterialRestore[] = [];
  private readonly surfacesByTarget = new Map<PaintableTexture, PaintableSurface[]>();
  private readonly textureChangeListeners = new Set<
    (textureId: string, dirty: UnitPainterTexturePaintResult) => void
  >();
  private readonly history: Stroke[] = [];
  private readonly redoHistory: Stroke[] = [];
  private retainedHistoryBytes = 0;
  private readonly uvTopologies = new WeakMap<THREE.BufferGeometry, Map<number, UvIslandTopology>>();
  private readonly uvMasksByTarget = new Map<
    PaintableTexture,
    WeakMap<THREE.BufferGeometry, Map<string, CachedUvMask>>
  >();
  private readonly uvCoverageMasksByTarget = new Map<PaintableTexture, Map<string, CachedUvMask>>();
  private readonly selectionMaskCache = new Map<PaintableTexture, Map<string, UvIslandMask>>();
  private readonly uvMaskCacheLru = new Map<
    number,
    { owner: Map<string, CachedUvMask>; key: string; mask: UvIslandMask }
  >();
  private uvMaskCacheBytes = 0;
  private nextUvMaskCacheId = 1;
  private currentStroke = new Map<PaintableTexture, Map<number, number>>();
  private currentStrokeCoverage = new Map<PaintableTexture, Map<number, number>>();
  private currentStrokeLayerId = "";
  private activeDecalTransformBefore?: LayerSnapshot;
  private currentStrokeGpuProfile: UnitPainterStrokeGpuProfile = { updateRanges: 0, updateBytes: 0 };
  private completedStrokeGpuProfile: UnitPainterStrokeGpuProfile = { updateRanges: 0, updateBytes: 0 };
  private isStrokeOpen = false;
  private selections: UnitPainterSelection[] = [];
  private readonly similarSelectionMasks = new Map<PaintableTexture, UvIslandMask>();
  private similarSelectionLastTarget?: PaintableTexture;
  private selectionPartition?: UnitPainterSelectionPartition;
  private selectionMode?: Exclude<UnitPainterSelectionScope, "all">;
  private paintLayers: PaintLayer[] = [];
  private activePaintLayerId = "";
  private nextLayerNumber = 1;
  private currentStateId = 0;
  private savedStateId = 0;
  private nextStateId = 1;
  private readonly raycastRestores: Array<{
    mesh: THREE.Mesh;
    raycast: THREE.Mesh["raycast"];
  }> = [];
  private readonly ownedStaticBoundsTrees = new Map<THREE.BufferGeometry, MeshBVH>();
  private readonly dynamicRaycastBvhs: Array<{ mesh: THREE.Mesh; bvh: SkinnedMeshBVH }> = [];

  constructor(root: THREE.Object3D) {
    const targetsByOriginal = new Map<THREE.DataTexture, PaintableTexture>();
    const processedMaterials = new Set<PaintableMaterial>();
    let textureIndex = 0;

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const rawMaterial of materials) {
        const material = asPaintableMaterial(rawMaterial);
        if (!material || processedMaterials.has(material) || !(material.map instanceof THREE.DataTexture)) continue;
        processedMaterials.add(material);
        const original = material.map;
        const image = getDataTextureImage(original);
        if (!image) continue;

        let target = targetsByOriginal.get(original);
        if (!target) {
          const editable = cloneEditableDataTexture(original, image.data, image.width, image.height);
          const editableImage = getDataTextureImage(editable);
          if (!editableImage) {
            editable.dispose();
            continue;
          }
          target = {
            original,
            editable,
            data: editableImage.data,
            originalData: image.data,
            width: image.width,
            height: image.height,
            sourceFileName: getTextureExportFileName(original, textureIndex++),
            sourceVirtualPath:
              typeof original.userData.wh3SourceVirtualPath === "string"
                ? original.userData.wh3SourceVirtualPath
                : undefined,
            textureId: `texture-${textureIndex}`,
            revision: 0,
            touchedLayerTiles: new Set(),
            fullUploadPending: true,
          };
          const paintTarget = target;
          editable.onUpdate = () => {
            paintTarget.fullUploadPending = false;
          };
          targetsByOriginal.set(original, target);
          this.targetsByEditableTexture.set(editable, target);
          if (target.sourceVirtualPath) {
            this.targetsBySourcePath.set(target.sourceVirtualPath.replace(/\//g, "\\").toLowerCase(), target);
          }
        }

        this.restores.push({ material, property: "map", original });
        material.map = target.editable;

        const normalOriginal = material.normalMap instanceof THREE.DataTexture
          ? material.normalMap
          : undefined;
        const normalImage = normalOriginal ? getDataTextureImage(normalOriginal) : undefined;
        if (normalOriginal && normalImage) {
          let normalTarget = this.normalTargetsByOriginal.get(normalOriginal);
          if (!normalTarget) {
            const editableNormal = cloneEditableDataTexture(
              normalOriginal,
              normalImage.data,
              normalImage.width,
              normalImage.height,
            );
            const editableNormalImage = getDataTextureImage(editableNormal);
            if (editableNormalImage) {
              normalTarget = {
                original: normalOriginal,
                editable: editableNormal,
                data: editableNormalImage.data,
                originalData: normalImage.data,
                width: normalImage.width,
                height: normalImage.height,
                sourceFileName: getTextureExportFileName(normalOriginal, textureIndex++),
                sourceVirtualPath:
                  typeof normalOriginal.userData.wh3SourceVirtualPath === "string"
                    ? normalOriginal.userData.wh3SourceVirtualPath
                    : undefined,
                textureId: `normal-${textureIndex}`,
                revision: 0,
                touchedLayerTiles: new Set(),
                fullUploadPending: true,
              };
              const paintNormalTarget = normalTarget;
              editableNormal.onUpdate = () => {
                paintNormalTarget.fullUploadPending = false;
              };
              this.normalTargetsByOriginal.set(normalOriginal, normalTarget);
              if (normalTarget.sourceVirtualPath) {
                this.normalTargetsBySourcePath.set(
                  normalTarget.sourceVirtualPath.replace(/\//g, "\\").toLowerCase(),
                  normalTarget,
                );
              }
            } else {
              editableNormal.dispose();
            }
          }
          if (normalTarget) {
            let normalTargets = this.normalTargetsByBaseTarget.get(target);
            if (!normalTargets) {
              normalTargets = new Set();
              this.normalTargetsByBaseTarget.set(target, normalTargets);
            }
            normalTargets.add(normalTarget);
            this.normalTargetByMaterial.set(material, normalTarget);
            this.restores.push({ material, property: "normalMap", original: normalOriginal });
            material.normalMap = normalTarget.editable;
          }
        }
        material.needsUpdate = true;
      }
    });

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((rawMaterial, materialIndex) => {
        const material = asPaintableMaterial(rawMaterial);
        if (!material?.map) return;
        const target = this.targetsByEditableTexture.get(material.map);
        if (!target) return;
        const surfaces = this.surfacesByTarget.get(target);
        const surface: PaintableSurface = {
          mesh: child,
          material,
          geometry: child.geometry,
          materialIndex,
        };
        if (surfaces) surfaces.push(surface);
        else this.surfacesByTarget.set(target, [surface]);
      });
    });

    this.enableRaycastAcceleration(root);

    const initialLayer = this.createEmptyLayer();
    this.paintLayers.push(initialLayer);
    this.activePaintLayerId = initialLayer.id;
  }

  private enableRaycastAcceleration(root: THREE.Object3D) {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const position = child.geometry.getAttribute("position");
      if (!position || position.count < 3) return;

      const originalRaycast = child.raycast;
      const hasMorphTargets = (child.geometry.morphAttributes.position?.length ?? 0) > 0;
      const hasDynamicVertices = child instanceof THREE.SkinnedMesh || hasMorphTargets;

      try {
        if (hasDynamicVertices) {
          // SkinnedMeshBVH currently expects a single material when forming hit data.
          // Keep Three's native path for the uncommon multi-material animated mesh so
          // material/island selection remains exact.
          if (Array.isArray(child.material)) return;
          const bvh = new SkinnedMeshBVH(child as THREE.SkinnedMesh, { indirect: true });
          child.raycast = (raycaster, intersects) => {
            bvh.raycastObject3D(child, raycaster, intersects);
          };
          this.dynamicRaycastBvhs.push({ mesh: child, bvh });
          this.raycastRestores.push({ mesh: child, raycast: originalRaycast });
          return;
        }

        if (!child.geometry.boundsTree) {
          const bvh = new MeshBVH(child.geometry, { indirect: true });
          child.geometry.boundsTree = bvh;
          this.ownedStaticBoundsTrees.set(child.geometry, bvh);
        }
        child.raycast = acceleratedRaycast;
        this.raycastRestores.push({ mesh: child, raycast: originalRaycast });
      } catch (error) {
        console.warn("[UnitPainter] Could not build BVH raycast acceleration", child.name, error);
      }
    });
  }

  refitRaycastAcceleration() {
    if (this.dynamicRaycastBvhs.length === 0) return 0;

    const updatedSkeletons = new Set<THREE.Skeleton>();
    for (const { mesh, bvh } of this.dynamicRaycastBvhs) {
      if (mesh instanceof THREE.SkinnedMesh && !updatedSkeletons.has(mesh.skeleton)) {
        mesh.skeleton.update();
        updatedSkeletons.add(mesh.skeleton);
      }
      bvh.refit();
    }
    return this.dynamicRaycastBvhs.length;
  }

  private getSelectionKey(
    mesh: THREE.Mesh,
    materialIndex: number,
    mode: UnitPainterSurfaceSelectionScope,
    islandId?: number,
  ) {
    return mode === "material"
      ? `${mesh.uuid}:material:${materialIndex}`
      : islandId == null
        ? undefined
        : `${mesh.uuid}:island:${materialIndex}:${islandId}`;
  }

  private createSelectionInfo(selection: UnitPainterSelection): UnitPainterSelectionInfo {
    return {
      objectName: selection.mesh.name || "Mesh",
      materialName: selection.material.name || `Material ${selection.materialIndex + 1}`,
      hasUvIsland: selection.islandId != null,
      object: selection.mesh,
      textureId: selection.target.textureId,
    };
  }

  private applySelection(
    selection: Omit<UnitPainterSelection, "key">,
    mode: UnitPainterSurfaceSelectionScope,
    operation: UnitPainterSelectionOperation,
  ) {
    this.selectionPartition = undefined;
    const key = this.getSelectionKey(
      selection.mesh,
      selection.materialIndex,
      mode,
      selection.islandId,
    );
    if (!key) return false;

    if (this.selectionMode !== mode) {
      this.selections = [];
      this.similarSelectionMasks.clear();
      this.similarSelectionLastTarget = undefined;
      this.selectionMode = mode;
      this.selectionMaskCache.clear();
      operation = "replace";
    }

    const next = { ...selection, key };
    const existingIndex = this.selections.findIndex((candidate) => candidate.key === key);

    let changed = false;
    if (operation === "replace") {
      const current = this.selections[0];
      changed =
        this.selections.length !== 1
        || current?.key !== key
        || current?.islandId !== next.islandId;
      this.selections = [next];
    } else if (operation === "add") {
      if (existingIndex < 0) {
        this.selections = [...this.selections, next];
        changed = true;
      }
    } else if (existingIndex >= 0) {
      this.selections = this.selections.filter((_, index) => index !== existingIndex);
      changed = true;
    } else {
      this.selections = [...this.selections, next];
      changed = true;
    }

    if (changed) this.selectionMaskCache.clear();
    if (this.selections.length === 0) this.selectionMode = undefined;
    return true;
  }

  private applySimilarSelection(
    target: PaintableTexture,
    mask: UvIslandMask,
    operation: UnitPainterSelectionOperation,
  ) {
    this.selectionPartition = undefined;
    if (this.selectionMode !== "similar") {
      this.selections = [];
      this.similarSelectionMasks.clear();
      this.selectionMaskCache.clear();
      this.selectionMode = "similar";
      operation = "replace";
    }

    if (operation === "replace") {
      this.similarSelectionMasks.clear();
      this.similarSelectionMasks.set(target, mask);
    } else if (operation === "add") {
      const existing = this.similarSelectionMasks.get(target);
      this.similarSelectionMasks.set(target, unionUvMasks(existing ? [existing, mask] : [mask])!);
    } else {
      const toggled = xorUvMasks(this.similarSelectionMasks.get(target), mask);
      if (toggled) this.similarSelectionMasks.set(target, toggled);
      else this.similarSelectionMasks.delete(target);
    }

    const remainingTargets = [...this.similarSelectionMasks.keys()];
    this.similarSelectionLastTarget =
      this.similarSelectionMasks.has(target)
        ? target
        : remainingTargets[remainingTargets.length - 1];
    if (this.similarSelectionMasks.size === 0) {
      this.selectionMode = undefined;
      this.similarSelectionLastTarget = undefined;
    }
    return true;
  }

  get selectionCount() {
    return this.selectionMode === "similar"
      ? this.similarSelectionMasks.size
      : this.selections.length;
  }

  get selectionInfo(): UnitPainterSelectionInfo | undefined {
    if (this.selectionMode === "similar") {
      const target = this.similarSelectionLastTarget;
      const surface = target ? this.surfacesByTarget.get(target)?.[0] : undefined;
      if (!target || !surface) return undefined;
      return {
        objectName: "Similar colors",
        materialName: "Custom color selection",
        hasUvIsland: false,
        object: surface.mesh,
        textureId: target.textureId,
      };
    }
    const selection = this.selections[this.selections.length - 1];
    return selection ? this.createSelectionInfo(selection) : undefined;
  }

  get selectionHasUvIsland() {
    return this.selectionMode !== "similar"
      && this.selections.some((selection) => selection.islandId != null);
  }

  get hasSimilarSelection() {
    return this.similarSelectionMasks.size > 0;
  }

  get selectionPartitionInfo(): UnitPainterSelectionPartitionInfo | undefined {
    const partition = this.selectionPartition;
    if (!partition) return undefined;
    return {
      kind: partition.kind,
      sourceScope: partition.sourceScope,
      regions: partition.regions.map((region) => ({
        id: region.id,
        label: region.label,
        active: partition.activeRegionIds.has(region.id),
      })),
      allActive:
        partition.regions.length > 0
        && partition.regions.every((region) => partition.activeRegionIds.has(region.id)),
    };
  }

  private getBaseSelectionTargets(scope: Exclude<UnitPainterSelectionScope, "all">) {
    return scope === "similar"
      ? [...this.similarSelectionMasks.keys()]
      : [...new Set(this.selections.map((selection) => selection.target))];
  }

  private rebuildSelectionPartitionActiveMasks() {
    const partition = this.selectionPartition;
    if (!partition) return;

    partition.activeMasks.clear();
    const allActive =
      partition.regions.length > 0
      && partition.regions.every((region) => partition.activeRegionIds.has(region.id));
    if (allActive) {
      for (const [target, mask] of partition.sourceMasks) partition.activeMasks.set(target, mask);
      return;
    }

    for (const target of partition.sourceMasks.keys()) {
      const masks = partition.regions
        .filter((region) => partition.activeRegionIds.has(region.id))
        .map((region) => region.masks.get(target))
        .filter((mask): mask is UvIslandMask => !!mask);
      const combined = masks.length === 1 ? masks[0] : unionUvMasks(masks);
      if (combined) partition.activeMasks.set(target, combined);
    }
  }

  splitSelection(
    scope: Exclude<UnitPainterSelectionScope, "all">,
    kind: UnitPainterSelectionSplitKind,
  ) {
    const sourceMasks = new Map<PaintableTexture, UvIslandMask>();
    for (const target of this.getBaseSelectionTargets(scope)) {
      const mask = this.getBaseSelectionMaskForTarget(target, scope);
      if (mask) sourceMasks.set(target, mask);
    }
    if (sourceMasks.size === 0) return false;

    const definitions = getSelectionSplitRegionDefinitions(kind);
    const regions: UnitPainterSelectionPartitionRegion[] = definitions.map(({ id, label }) => ({
      id,
      label,
      masks: new Map(),
    }));

    for (const [target, sourceMask] of sourceMasks) {
      const parts = partitionUvMask(sourceMask, kind);
      for (const region of regions) {
        const mask = parts.get(region.id);
        if (mask?.tiles.size) region.masks.set(target, mask);
      }
    }

    const nonEmptyRegions = regions.filter((region) => region.masks.size > 0);
    if (nonEmptyRegions.length < 2) return false;
    this.selectionPartition = {
      kind,
      sourceScope: scope,
      sourceMasks,
      regions: nonEmptyRegions,
      activeRegionIds: new Set([nonEmptyRegions[0].id]),
      activeMasks: new Map(),
    };
    this.rebuildSelectionPartitionActiveMasks();
    return true;
  }

  setSelectionPartitionRegion(
    regionId: string,
    operation: UnitPainterSelectionOperation = "replace",
  ) {
    const partition = this.selectionPartition;
    if (!partition || !partition.regions.some((region) => region.id === regionId)) return false;

    if (operation === "replace") {
      partition.activeRegionIds = new Set([regionId]);
    } else if (operation === "add") {
      partition.activeRegionIds.add(regionId);
    } else if (partition.activeRegionIds.has(regionId)) {
      partition.activeRegionIds.delete(regionId);
    } else {
      partition.activeRegionIds.add(regionId);
    }
    this.rebuildSelectionPartitionActiveMasks();
    return true;
  }

  selectAllSelectionPartitionRegions() {
    const partition = this.selectionPartition;
    if (!partition) return false;
    partition.activeRegionIds = new Set(partition.regions.map((region) => region.id));
    this.rebuildSelectionPartitionActiveMasks();
    return true;
  }

  removeSelectionPartition() {
    if (!this.selectionPartition) return false;
    this.selectionPartition = undefined;
    return true;
  }

  get textureCount() {
    return this.targetsByEditableTexture.size;
  }

  get layers(): UnitPainterLayerInfo[] {
    return this.paintLayers.map(({ id, name, visible, opacity, kind }) => ({
      id,
      name,
      visible,
      opacity,
      kind,
    }));
  }

  get activeDecalInfo(): UnitPainterDecalInfo | undefined {
    const layer = this.getActiveLayer();
    const decal = layer?.kind === "decal" ? layer.decal : undefined;
    if (!layer || !decal) return undefined;
    return {
      layerId: layer.id,
      targetTextureId: decal.target.textureId,
      sourceName: decal.source.name,
      centerU: decal.centerU,
      centerV: decal.centerV,
      widthU: decal.widthU,
      heightV: decal.heightV,
      rotationDeg: decal.rotationDeg,
      tintEnabled: decal.tintEnabled,
      tint: { ...decal.tint },
      affectNormal: decal.affectNormal,
      normalStrength: decal.normalStrength,
      normalHeightSource: decal.normalHeightSource,
      hasNormalMap: !!decal.normalTarget,
    };
  }

  get activeLayerId() {
    return this.activePaintLayerId;
  }

  setActiveLayer(layerId: string) {
    if (!this.paintLayers.some((layer) => layer.id === layerId)) return false;
    if (this.isStrokeOpen) this.endStroke();
    if (this.activeDecalTransformBefore) this.endActiveDecalTransform();
    this.activePaintLayerId = layerId;
    return true;
  }

  addLayer(name?: string) {
    if (this.paintLayers.length >= MAX_PAINT_LAYERS) return undefined;
    if (this.isStrokeOpen) this.endStroke();
    const beforeActiveLayerId = this.activePaintLayerId;
    const layer = this.createEmptyLayer(name);
    const index = this.paintLayers.length;
    this.paintLayers.push(layer);
    this.activePaintLayerId = layer.id;
    this.pushHistoryChange({
      kind: "layer-add",
      layer: this.snapshotLayer(layer),
      index,
      beforeActiveLayerId,
      afterActiveLayerId: layer.id,
    });
    return layer.id;
  }

  duplicateActiveLayer() {
    if (this.paintLayers.length >= MAX_PAINT_LAYERS) return undefined;
    if (this.isStrokeOpen) this.endStroke();
    const source = this.getActiveLayer();
    if (!source) return undefined;
    const duplicate = this.createEmptyLayer(`${source.name} copy`);
    duplicate.visible = source.visible;
    duplicate.opacity = source.opacity;
    duplicate.kind = source.kind;
    duplicate.decal = source.decal ? cloneDecalState(source.decal) : undefined;
    for (const [target, data] of source.textures) duplicate.textures.set(target, cloneLayerTexture(data));
    const sourceIndex = this.paintLayers.indexOf(source);
    const index = sourceIndex + 1;
    const beforeActiveLayerId = source.id;
    this.paintLayers.splice(index, 0, duplicate);
    this.activePaintLayerId = duplicate.id;
    this.recomposeTargets(duplicate.textures.keys());
    if (duplicate.kind === "decal" && duplicate.decal) {
      this.recomposeNormalTargetsForBase(duplicate.decal.target);
    }
    this.pushHistoryChange({
      kind: "layer-add",
      layer: this.snapshotLayer(duplicate),
      index,
      beforeActiveLayerId,
      afterActiveLayerId: duplicate.id,
    });
    return duplicate.id;
  }

  deleteActiveLayer() {
    if (this.paintLayers.length <= 1) return false;
    if (this.isStrokeOpen) this.endStroke();
    const layer = this.getActiveLayer();
    if (!layer) return false;
    const index = this.paintLayers.indexOf(layer);
    const snapshot = this.snapshotLayer(layer);
    const beforeActiveLayerId = layer.id;
    this.paintLayers.splice(index, 1);
    const nextActive = this.paintLayers[Math.min(index, this.paintLayers.length - 1)]!;
    this.activePaintLayerId = nextActive.id;
    const affectedTargets = [...layer.textures.keys()];
    this.recomposeTargets(affectedTargets);
    this.pruneTouchedLayerTiles(affectedTargets);
    if (layer.kind === "decal" && layer.decal) {
      this.recomposeNormalTargetsForBase(layer.decal.target);
    }
    this.pushHistoryChange({
      kind: "layer-delete",
      layer: snapshot,
      index,
      beforeActiveLayerId,
      afterActiveLayerId: nextActive.id,
    });
    return true;
  }

  renameLayer(layerId: string, name: string) {
    if (this.isStrokeOpen) this.endStroke();
    const layer = this.paintLayers.find((candidate) => candidate.id === layerId);
    const nextName = name.trim().slice(0, 80);
    if (!layer || !nextName || nextName === layer.name) return false;
    const before = this.layerMetadata(layer);
    layer.name = nextName;
    this.pushHistoryChange({ kind: "layer-meta", layerId, before, after: this.layerMetadata(layer) });
    return true;
  }

  setLayerVisible(layerId: string, visible: boolean) {
    if (this.isStrokeOpen) this.endStroke();
    const layer = this.paintLayers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.visible === visible) return false;
    const before = this.layerMetadata(layer);
    layer.visible = visible;
    this.recomposeTargets(layer.textures.keys());
    if (layer.kind === "decal" && layer.decal) this.recomposeNormalTargetsForBase(layer.decal.target);
    this.pushHistoryChange({ kind: "layer-meta", layerId, before, after: this.layerMetadata(layer) });
    return true;
  }

  setLayerOpacity(layerId: string, opacity: number, recordHistory = true) {
    if (this.isStrokeOpen) this.endStroke();
    const layer = this.paintLayers.find((candidate) => candidate.id === layerId);
    const nextOpacity = clamp01(opacity);
    if (!layer || Math.abs(layer.opacity - nextOpacity) < 0.0001) return false;
    const before = recordHistory ? this.layerMetadata(layer) : undefined;
    layer.opacity = nextOpacity;
    this.recomposeTargets(layer.textures.keys());
    if (layer.kind === "decal" && layer.decal) this.recomposeNormalTargetsForBase(layer.decal.target);
    if (before) {
      this.pushHistoryChange({ kind: "layer-meta", layerId, before, after: this.layerMetadata(layer) });
    }
    return true;
  }

  addDecalLayerAtTexturePoint(
    textureId: string,
    x: number,
    y: number,
    source: UnitPainterDecalSource,
  ) {
    const target = [...this.targetsByEditableTexture.values()].find(
      (candidate) => candidate.textureId === textureId,
    );
    if (!target) return undefined;
    const normalTargets = [...(this.normalTargetsByBaseTarget.get(target) ?? [])];
    return this.addDecalLayer(
      target,
      x / target.width,
      y / target.height,
      source,
      normalTargets.length === 1 ? normalTargets[0] : undefined,
    );
  }

  addDecalLayerAtIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    source: UnitPainterDecalSource,
  ) {
    if (!intersection.uv) return undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target || !material) return undefined;
    const normalTarget = this.normalTargetByMaterial.get(material);
    const uv = intersection.uv.clone();
    target.editable.updateMatrix();
    target.editable.transformUv(uv);
    return this.addDecalLayer(target, uv.x, uv.y, source, normalTarget);
  }

  private addDecalLayer(
    target: PaintableTexture,
    centerU: number,
    centerV: number,
    source: UnitPainterDecalSource,
    normalTarget?: PaintableTexture,
  ) {
    if (this.paintLayers.length >= MAX_PAINT_LAYERS || !validateDecalSource(source)) return undefined;
    if (this.isStrokeOpen) this.endStroke();

    const sourceCopy = cloneDecalSource(source);
    const number = this.nextLayerNumber++;
    const widthU = 0.2;
    const heightV = Math.max(
      0.01,
      widthU * (sourceCopy.height / sourceCopy.width) * (target.width / target.height),
    );
    const layer: PaintLayer = {
      id: `layer-${number}`,
      name: sourceCopy.name.replace(/\.[^.]+$/, "").trim().slice(0, 80) || `Decal ${number}`,
      visible: true,
      opacity: 1,
      kind: "decal",
      textures: new Map(),
      decal: {
        target,
        normalTarget,
        source: sourceCopy,
        centerU,
        centerV,
        widthU,
        heightV,
        rotationDeg: 0,
        tintEnabled: false,
        tint: { r: 255, g: 255, b: 255 },
        affectNormal: false,
        normalStrength: 1,
        normalHeightSource: "alpha",
      },
    };

    const beforeActiveLayerId = this.activePaintLayerId;
    const index = this.paintLayers.length;
    this.paintLayers.push(layer);
    this.activePaintLayerId = layer.id;
    this.rasterizeDecalLayer(layer, true);
    this.pushHistoryChange({
      kind: "layer-add",
      layer: this.snapshotLayer(layer),
      index,
      beforeActiveLayerId,
      afterActiveLayerId: layer.id,
    });
    return layer.id;
  }

  beginActiveDecalTransform() {
    const layer = this.getActiveLayer();
    if (!layer || layer.kind !== "decal" || !layer.decal || this.activeDecalTransformBefore) return false;
    if (this.isStrokeOpen) this.endStroke();
    this.activeDecalTransformBefore = this.snapshotLayer(layer);
    return true;
  }

  moveActiveDecalToTexturePoint(textureId: string, x: number, y: number, live = false) {
    const layer = this.getActiveLayer();
    const decal = layer?.kind === "decal" ? layer.decal : undefined;
    if (!layer || !decal || decal.target.textureId !== textureId) return false;
    decal.centerU = x / decal.target.width;
    decal.centerV = y / decal.target.height;
    this.rasterizeDecalLayer(layer, !live);
    return true;
  }

  moveActiveDecalToIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    live = false,
  ) {
    if (!intersection.uv) return false;
    const layer = this.getActiveLayer();
    const decal = layer?.kind === "decal" ? layer.decal : undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!layer || !decal || !target || target !== decal.target) return false;
    const uv = intersection.uv.clone();
    target.editable.updateMatrix();
    target.editable.transformUv(uv);
    decal.centerU = uv.x;
    decal.centerV = uv.y;
    this.rasterizeDecalLayer(layer, !live);
    return true;
  }

  endActiveDecalTransform() {
    const before = this.activeDecalTransformBefore;
    this.activeDecalTransformBefore = undefined;
    const layer = this.getActiveLayer();
    if (!before || !layer || layer.kind !== "decal" || !layer.decal) return false;
    this.rasterizeDecalLayer(layer, recordHistory);
    if (before) {
      const after = this.snapshotLayer(layer);
      const index = this.paintLayers.indexOf(layer);
      this.pushHistoryChange({
        kind: "layer-replace",
        index,
        before: [before],
        after: [after],
        beforeActiveLayerId: layer.id,
        afterActiveLayerId: layer.id,
      });
    }
    return true;
  }

  updateActiveDecal(
    patch: Partial<Pick<
      UnitPainterDecalInfo,
      "centerU" | "centerV" | "widthU" | "heightV" | "rotationDeg"
      | "tintEnabled" | "tint" | "affectNormal" | "normalStrength" | "normalHeightSource"
    >>,
    recordHistory = true,
  ) {
    const layer = this.getActiveLayer();
    const decal = layer?.kind === "decal" ? layer.decal : undefined;
    if (!layer || !decal) return false;
    if (this.isStrokeOpen) this.endStroke();
    const before = recordHistory ? this.snapshotLayer(layer) : undefined;

    if (patch.centerU != null) decal.centerU = patch.centerU;
    if (patch.centerV != null) decal.centerV = patch.centerV;
    if (patch.widthU != null) decal.widthU = Math.max(0.001, Math.abs(patch.widthU));
    if (patch.heightV != null) decal.heightV = Math.max(0.001, Math.abs(patch.heightV));
    if (patch.rotationDeg != null && Number.isFinite(patch.rotationDeg)) decal.rotationDeg = patch.rotationDeg;
    if (patch.tintEnabled != null) decal.tintEnabled = patch.tintEnabled;
    if (patch.tint) {
      decal.tint = {
        r: Math.max(0, Math.min(255, Math.round(patch.tint.r))),
        g: Math.max(0, Math.min(255, Math.round(patch.tint.g))),
        b: Math.max(0, Math.min(255, Math.round(patch.tint.b))),
      };
    }
    if (patch.affectNormal != null) decal.affectNormal = patch.affectNormal;
    if (patch.normalStrength != null && Number.isFinite(patch.normalStrength)) {
      decal.normalStrength = Math.max(0, Math.min(4, patch.normalStrength));
    }
    if (patch.normalHeightSource) decal.normalHeightSource = patch.normalHeightSource;

    this.rasterizeDecalLayer(layer, true);
    const after = this.snapshotLayer(layer);
    const index = this.paintLayers.indexOf(layer);
    this.pushHistoryChange({
      kind: "layer-replace",
      index,
      before: [before],
      after: [after],
      beforeActiveLayerId: layer.id,
      afterActiveLayerId: layer.id,
    });
    return true;
  }

  moveLayer(layerId: string, offset: -1 | 1) {
    if (this.isStrokeOpen) this.endStroke();
    const index = this.paintLayers.findIndex((layer) => layer.id === layerId);
    if (index < 0) return false;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= this.paintLayers.length) return false;
    const before = this.paintLayers.map((layer) => layer.id);
    const [layer] = this.paintLayers.splice(index, 1);
    this.paintLayers.splice(nextIndex, 0, layer);
    const after = this.paintLayers.map((candidate) => candidate.id);
    this.recomposeTargets(layer.textures.keys());
    if (layer.kind === "decal" && layer.decal) {
      this.recomposeNormalTargetsForBase(layer.decal.target);
    }
    this.pushHistoryChange({ kind: "layer-order", before, after });
    return true;
  }

  mergeActiveLayerDown() {
    if (this.isStrokeOpen) this.endStroke();
    const topIndex = this.paintLayers.findIndex((layer) => layer.id === this.activePaintLayerId);
    if (topIndex <= 0) return false;

    const bottom = this.paintLayers[topIndex - 1];
    const top = this.paintLayers[topIndex];
    if (bottom.kind !== "paint" || top.kind !== "paint") return false;
    const merged: PaintLayer = {
      id: bottom.id,
      name: bottom.name,
      visible: true,
      opacity: 1,
      kind: "paint",
      textures: new Map(),
    };

    const targets = new Set<PaintableTexture>([
      ...bottom.textures.keys(),
      ...top.textures.keys(),
    ]);
    for (const target of targets) {
      const bottomData = bottom.textures.get(target);
      const topData = top.textures.get(target);
      const output = createLayerTexture();
      const tileKeys = new Set<number>([
        ...(bottomData?.tiles.keys() ?? []),
        ...(topData?.tiles.keys() ?? []),
      ]);

      for (const tileKey of tileKeys) {
        const bottomTile = bottomData?.tiles.get(tileKey);
        const topTile = topData?.tiles.get(tileKey);
        const outputTile: LayerTile = {
          data: new Uint8Array(LAYER_TILE_BYTES),
          nonZeroPixels: 0,
        };

        for (let localByteIndex = 0; localByteIndex < LAYER_TILE_BYTES; localByteIndex += 4) {
          const bottomAlpha =
            bottom.visible && bottomTile ? (bottomTile.data[localByteIndex + 3] / 255) * bottom.opacity : 0;
          const topAlpha =
            top.visible && topTile ? (topTile.data[localByteIndex + 3] / 255) * top.opacity : 0;
          const alpha = topAlpha + bottomAlpha * (1 - topAlpha);
          const outputAlpha = Math.round(alpha * 255);
          if (outputAlpha === 0) continue;

          const bottomWeight = bottomAlpha * (1 - topAlpha);
          const topWeight = topAlpha;
          outputTile.data[localByteIndex] = Math.round(
            (((topTile?.data[localByteIndex] ?? 0) * topWeight)
              + ((bottomTile?.data[localByteIndex] ?? 0) * bottomWeight)) / alpha,
          );
          outputTile.data[localByteIndex + 1] = Math.round(
            (((topTile?.data[localByteIndex + 1] ?? 0) * topWeight)
              + ((bottomTile?.data[localByteIndex + 1] ?? 0) * bottomWeight)) / alpha,
          );
          outputTile.data[localByteIndex + 2] = Math.round(
            (((topTile?.data[localByteIndex + 2] ?? 0) * topWeight)
              + ((bottomTile?.data[localByteIndex + 2] ?? 0) * bottomWeight)) / alpha,
          );
          outputTile.data[localByteIndex + 3] = outputAlpha;
          outputTile.nonZeroPixels += 1;
        }

        if (outputTile.nonZeroPixels > 0) {
          output.tiles.set(tileKey, outputTile);
          target.touchedLayerTiles.add(tileKey);
        }
      }

      if (output.tiles.size > 0) merged.textures.set(target, output);
    }

    const before = [this.snapshotLayer(bottom), this.snapshotLayer(top)];
    const after = [this.snapshotLayer(merged)];
    const index = topIndex - 1;
    this.paintLayers.splice(index, 2, merged);
    this.activePaintLayerId = merged.id;
    this.recomposeTargets(targets);
    this.pruneTouchedLayerTiles(targets);
    this.pushHistoryChange({
      kind: "layer-replace",
      index,
      before,
      after,
      beforeActiveLayerId: top.id,
      afterActiveLayerId: merged.id,
    });
    return true;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get canRedo() {
    return this.redoHistory.length > 0;
  }

  get hasUnsavedChanges() {
    return this.currentStateId !== this.savedStateId;
  }

  markSaved() {
    if (this.isStrokeOpen) this.endStroke();
    this.savedStateId = this.currentStateId;
  }

  subscribeTextureChanges(
    listener: (textureId: string, dirty: UnitPainterTexturePaintResult) => void,
  ) {
    this.textureChangeListeners.add(listener);
    return () => {
      this.textureChangeListeners.delete(listener);
    };
  }

  private getUvSegmentsForFaces(
    target: PaintableTexture,
    geometry: THREE.BufferGeometry,
    faceIndices: readonly number[],
  ) {
    const uv = geometry.getAttribute("uv");
    if (!uv) return new Float32Array();
    target.editable.updateMatrix();
    const segments: number[] = [];
    const seenEdges = new Set<string>();
    for (const faceIndex of faceIndices) {
      const indices = getTriangleVertexIndices(geometry, faceIndex);
      if (!indices) continue;
      const points = indices.map((index) =>
        new THREE.Vector2(uv.getX(index), uv.getY(index)).applyMatrix3(target.editable.matrix),
      );
      for (const [firstIndex, secondIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
        const first = points[firstIndex];
        const second = points[secondIndex];
        const key = uvEdgeKey(first, second);
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        segments.push(first.x, first.y, second.x, second.y);
      }
    }
    return Float32Array.from(segments);
  }

  private getSurfaceHighlightForFace(
    mesh: THREE.Mesh,
    materialIndex: number,
    faceIndex: number,
    scope: UnitPainterSurfaceSelectionScope,
  ): UnitPainterSurfaceHighlight | undefined {
    if (scope === "material") {
      const indices = getSurfaceTriangleIndices(mesh.geometry, getMaterialFaceIndices(mesh.geometry, materialIndex));
      if (indices.length === 0) return undefined;
      return {
        object: mesh,
        scope,
        materialIndex,
        indices,
        key: `${mesh.uuid}:material:${materialIndex}`,
      };
    }

    const topology = this.getUvTopology(mesh.geometry, materialIndex);
    const islandId = topology?.faceToIsland.get(faceIndex);
    const triangles = islandId == null ? undefined : topology?.islands.get(islandId);
    if (islandId == null || !triangles) return undefined;
    const indices = getSurfaceTriangleIndices(
      mesh.geometry,
      triangles.map((triangle) => triangle.faceIndex),
    );
    if (indices.length === 0) return undefined;
    return {
      object: mesh,
      scope,
      materialIndex,
      islandId,
      indices,
      key: `${mesh.uuid}:island:${materialIndex}:${islandId}`,
    };
  }

  get textureViews(): UnitPainterTextureView[] {
    return this.getTextureViews("island");
  }

  getTextureViews(selectionScope: UnitPainterSelectionScope = "all"): UnitPainterTextureView[] {
    return [...this.targetsByEditableTexture.values()].map((target) => {
      const uvSegments: number[] = [];
      const seenEdges = new Set<string>();
      target.editable.updateMatrix();

      for (const surface of this.surfacesByTarget.get(target) ?? []) {
        const uv = surface.geometry.getAttribute("uv");
        if (!uv) continue;
        for (const faceIndex of getMaterialFaceIndices(surface.geometry, surface.materialIndex)) {
          const indices = getTriangleVertexIndices(surface.geometry, faceIndex);
          if (!indices) continue;
          const points = indices.map((index) =>
            new THREE.Vector2(uv.getX(index), uv.getY(index)).applyMatrix3(target.editable.matrix),
          );
          for (const [firstIndex, secondIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
            const first = points[firstIndex];
            const second = points[secondIndex];
            const key = uvEdgeKey(first, second);
            if (seenEdges.has(key)) continue;
            seenEdges.add(key);
            uvSegments.push(first.x, first.y, second.x, second.y);
          }
        }
      }

      const selectedUvSegments: number[] = [];
      const selectedUvTriangles: number[] = [];
      const seenSelectedEdges = new Set<string>();
      const seenSelectedFaces = new Set<string>();
      for (const selection of selectionScope === "similar" ? [] : this.selections) {
        if (selection.target !== target) continue;
        const geometry = selection.mesh.geometry;
        const uv = geometry.getAttribute("uv");
        if (!uv) continue;
        const selectedFaces =
          selectionScope === "material" || selection.islandId == null
            ? getMaterialFaceIndices(geometry, selection.materialIndex)
            : selectionScope === "island"
              ? (this.getUvTopology(geometry, selection.materialIndex)?.islands.get(selection.islandId) ?? [])
                  .map((triangle) => triangle.faceIndex)
              : [];
        for (const faceIndex of selectedFaces) {
          const faceKey = `${geometry.uuid}:${faceIndex}`;
          if (seenSelectedFaces.has(faceKey)) continue;
          seenSelectedFaces.add(faceKey);
          const indices = getTriangleVertexIndices(geometry, faceIndex);
          if (!indices) continue;
          const points = indices.map((index) =>
            new THREE.Vector2(uv.getX(index), uv.getY(index)).applyMatrix3(target.editable.matrix),
          );
          selectedUvTriangles.push(
            points[0].x, points[0].y,
            points[1].x, points[1].y,
            points[2].x, points[2].y,
          );
          for (const [firstIndex, secondIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
            const first = points[firstIndex];
            const second = points[secondIndex];
            const key = uvEdgeKey(first, second);
            if (seenSelectedEdges.has(key)) continue;
            seenSelectedEdges.add(key);
            selectedUvSegments.push(first.x, first.y, second.x, second.y);
          }
        }
      }

      return {
        id: target.textureId,
        label: target.sourceVirtualPath ?? target.sourceFileName,
        width: target.width,
        height: target.height,
        data: target.data,
        uvSegments: Float32Array.from(uvSegments),
        selectedUvSegments: Float32Array.from(selectedUvSegments),
        selectedUvTriangles: Float32Array.from(selectedUvTriangles),
        selectedPixelMask:
          this.selectionPartition?.sourceScope === selectionScope
            ? (() => {
                const mask = this.selectionPartition?.activeMasks.get(target);
                return mask
                  ? { width: mask.width, height: mask.height, tileSize: MASK_TILE_SIZE, tiles: mask.tiles }
                  : undefined;
              })()
            : selectionScope === "similar"
              ? (() => {
                  const mask = this.similarSelectionMasks.get(target);
                  return mask
                    ? { width: mask.width, height: mask.height, tileSize: MASK_TILE_SIZE, tiles: mask.tiles }
                    : undefined;
                })()
              : undefined,
      };
    });
  }

  getIntersectionTextureHover(
    intersection: THREE.Intersection<THREE.Object3D>,
    scope: Exclude<UnitPainterSelectionScope, "all">,
  ): UnitPainterTextureHover | undefined {
    if (!intersection.uv || !(intersection.object instanceof THREE.Mesh)) return undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target) return undefined;

    const mesh = intersection.object;
    const materialIndex =
      intersection.face?.materialIndex
      ?? (intersection.faceIndex != null ? getTriangleMaterialIndex(mesh.geometry, intersection.faceIndex) : 0);
    const transformedUv = intersection.uv.clone();
    target.editable.updateMatrix();
    target.editable.transformUv(transformedUv);

    let faceIndices: number[] = [];
    if (scope === "material") {
      faceIndices = getMaterialFaceIndices(mesh.geometry, materialIndex);
    } else if (scope === "island" && intersection.faceIndex != null) {
      const topology = this.getUvTopology(mesh.geometry, materialIndex);
      const islandId = topology?.faceToIsland.get(intersection.faceIndex);
      faceIndices =
        islandId == null
          ? [intersection.faceIndex]
          : (topology?.islands.get(islandId) ?? []).map((triangle) => triangle.faceIndex);
    }

    return {
      textureId: target.textureId,
      x: transformedUv.x * target.width,
      y: transformedUv.y * target.height,
      scope,
      uvSegments: this.getUvSegmentsForFaces(target, mesh.geometry, faceIndices),
    };
  }

  getTexturePointSurfaceHighlight(
    textureId: string,
    x: number,
    y: number,
    scope: UnitPainterSurfaceSelectionScope,
  ): UnitPainterSurfaceHighlight | undefined {
    const target = [...this.targetsByEditableTexture.values()].find(
      (candidate) => candidate.textureId === textureId,
    );
    if (!target) return undefined;
    target.editable.updateMatrix();

    for (const surface of this.surfacesByTarget.get(target) ?? []) {
      const uv = surface.geometry.getAttribute("uv");
      if (!uv) continue;
      for (const faceIndex of getMaterialFaceIndices(surface.geometry, surface.materialIndex)) {
        const indices = getTriangleVertexIndices(surface.geometry, faceIndex);
        if (!indices) continue;
        const [a, b, c] = indices.map((index) =>
          new THREE.Vector2(uv.getX(index), uv.getY(index)).applyMatrix3(target.editable.matrix),
        );
        if (
          !pointInTriangle(
            x,
            y,
            a.x * target.width,
            a.y * target.height,
            b.x * target.width,
            b.y * target.height,
            c.x * target.width,
            c.y * target.height,
          )
        ) {
          continue;
        }
        const highlight = this.getSurfaceHighlightForFace(
          surface.mesh,
          surface.materialIndex,
          faceIndex,
          scope,
        );
        if (highlight) return highlight;
      }
    }
    return undefined;
  }

  getTexturePointHover(
    textureId: string,
    x: number,
    y: number,
    scope: UnitPainterSurfaceSelectionScope,
  ): UnitPainterTextureHover | undefined {
    const target = [...this.targetsByEditableTexture.values()].find(
      (candidate) => candidate.textureId === textureId,
    );
    if (!target) return undefined;
    target.editable.updateMatrix();

    for (const surface of this.surfacesByTarget.get(target) ?? []) {
      const uv = surface.geometry.getAttribute("uv");
      if (!uv) continue;
      for (const faceIndex of getMaterialFaceIndices(surface.geometry, surface.materialIndex)) {
        const indices = getTriangleVertexIndices(surface.geometry, faceIndex);
        if (!indices) continue;
        const [a, b, c] = indices.map((index) =>
          new THREE.Vector2(uv.getX(index), uv.getY(index)).applyMatrix3(target.editable.matrix),
        );
        if (
          !pointInTriangle(
            x,
            y,
            a.x * target.width,
            a.y * target.height,
            b.x * target.width,
            b.y * target.height,
            c.x * target.width,
            c.y * target.height,
          )
        ) {
          continue;
        }

        let faceIndices: number[];
        if (scope === "material") {
          faceIndices = getMaterialFaceIndices(surface.geometry, surface.materialIndex);
        } else {
          const topology = this.getUvTopology(surface.geometry, surface.materialIndex);
          const islandId = topology?.faceToIsland.get(faceIndex);
          if (islandId == null) continue;
          faceIndices = (topology?.islands.get(islandId) ?? []).map((triangle) => triangle.faceIndex);
          if (faceIndices.length === 0) continue;
        }

        return {
          textureId,
          x,
          y,
          scope,
          uvSegments: this.getUvSegmentsForFaces(target, surface.geometry, faceIndices),
        };
      }
    }
    return undefined;
  }

  selectTexturePoint(
    textureId: string,
    x: number,
    y: number,
    mode: UnitPainterSurfaceSelectionScope,
    operation: UnitPainterSelectionOperation = "replace",
  ): UnitPainterSelectionInfo | undefined {
    const target = [...this.targetsByEditableTexture.values()].find((candidate) => candidate.textureId === textureId);
    if (!target) return undefined;
    target.editable.updateMatrix();

    for (const surface of this.surfacesByTarget.get(target) ?? []) {
      const uv = surface.geometry.getAttribute("uv");
      if (!uv) continue;
      for (const faceIndex of getMaterialFaceIndices(surface.geometry, surface.materialIndex)) {
        const indices = getTriangleVertexIndices(surface.geometry, faceIndex);
        if (!indices) continue;
        const [a, b, c] = indices.map((index) =>
          new THREE.Vector2(uv.getX(index), uv.getY(index)).applyMatrix3(target.editable.matrix),
        );
        if (
          !pointInTriangle(
            x,
            y,
            a.x * target.width,
            a.y * target.height,
            b.x * target.width,
            b.y * target.height,
            c.x * target.width,
            c.y * target.height,
          )
        ) {
          continue;
        }

        const topology = this.getUvTopology(surface.geometry, surface.materialIndex);
        const islandId = topology?.faceToIsland.get(faceIndex);
        if (mode === "island" && islandId == null) continue;
        const selection = {
          mesh: surface.mesh,
          material: surface.material,
          materialIndex: surface.materialIndex,
          target,
          islandId,
        };
        return this.applySelection(selection, mode, operation)
          ? this.createSelectionInfo({ ...selection, key: this.getSelectionKey(
              surface.mesh,
              surface.materialIndex,
              mode,
              islandId,
            )! })
          : undefined;
      }
    }
    return undefined;
  }

  selectSimilarTexturePoint(
    textureId: string,
    x: number,
    y: number,
    tolerance: number,
    operation: UnitPainterSelectionOperation = "replace",
  ) {
    const target = [...this.targetsByEditableTexture.values()].find(
      (candidate) => candidate.textureId === textureId,
    );
    if (!target) return false;
    const mask = buildSimilarColorMask(target, x, y, tolerance);
    return !!mask && this.applySimilarSelection(target, mask, operation);
  }

  selectSimilarIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    tolerance: number,
    operation: UnitPainterSelectionOperation = "replace",
  ) {
    if (!intersection.uv || !(intersection.object instanceof THREE.Mesh)) return false;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target) return false;
    const uv = intersection.uv.clone();
    target.editable.updateMatrix();
    target.editable.transformUv(uv);
    const mask = buildSimilarColorMask(target, uv.x * target.width, uv.y * target.height, tolerance);
    return !!mask && this.applySimilarSelection(target, mask, operation);
  }

  getTextureRevision(textureId: string) {
    return [...this.targetsByEditableTexture.values()].find(
      (candidate) => candidate.textureId === textureId,
    )?.revision ?? -1;
  }

  sampleTexturePoint(textureId: string, x: number, y: number) {
    const target = [...this.targetsByEditableTexture.values()].find((candidate) => candidate.textureId === textureId);
    if (!target) return undefined;
    const pixelX = Math.max(0, Math.min(target.width - 1, Math.floor(x)));
    const pixelY = Math.max(0, Math.min(target.height - 1, Math.floor(y)));
    const byteIndex = (pixelY * target.width + pixelX) * 4;
    return {
      r: target.data[byteIndex],
      g: target.data[byteIndex + 1],
      b: target.data[byteIndex + 2],
    };
  }

  paintTexturePoint(
    textureId: string,
    centerX: number,
    centerY: number,
    radiusTexels: number,
    settings: UnitPainterBrushSettings,
    scope: UnitPainterSelectionScope = "all",
    paddingPx = 0,
  ): UnitPainterTexturePaintResult | undefined {
    if (!this.isStrokeOpen) return undefined;
    const target = [...this.targetsByEditableTexture.values()].find((candidate) => candidate.textureId === textureId);
    if (!target) return undefined;

    let mask: UvIslandMask | undefined;
    if (scope !== "all") {
      mask = this.getSelectionMaskForTarget(target, scope, paddingPx);
      if (!mask) return undefined;
    }

    return this.paintTexturePointsInternal(
      target,
      [{
        x: centerX,
        y: centerY,
        radius: Math.max(MIN_BRUSH_RADIUS_TEXELS, radiusTexels),
      }],
      settings,
      mask,
      false,
    );
  }

  selectIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    mode: UnitPainterSurfaceSelectionScope = "island",
    operation: UnitPainterSelectionOperation = "replace",
  ): UnitPainterSelectionInfo | undefined {
    if (!(intersection.object instanceof THREE.Mesh)) return undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!material || !target) return undefined;

    const mesh = intersection.object;
    const materialIndex =
      intersection.face?.materialIndex
      ?? (intersection.faceIndex != null ? getTriangleMaterialIndex(mesh.geometry, intersection.faceIndex) : 0);
    const topology = this.getUvTopology(mesh.geometry, materialIndex);
    const islandId = intersection.faceIndex != null ? topology?.faceToIsland.get(intersection.faceIndex) : undefined;
    if (mode === "island" && islandId == null) return undefined;

    const selection = { mesh, material, materialIndex, target, islandId };
    return this.applySelection(selection, mode, operation)
      ? this.createSelectionInfo({
          ...selection,
          key: this.getSelectionKey(mesh, materialIndex, mode, islandId)!,
        })
      : undefined;
  }

  clearSelection() {
    this.selections = [];
    this.selectionPartition = undefined;
    this.similarSelectionMasks.clear();
    this.similarSelectionLastTarget = undefined;
    this.selectionMode = undefined;
    this.selectionMaskCache.clear();
  }

  getIntersectionSurfaceHighlight(
    intersection: THREE.Intersection<THREE.Object3D>,
    scope: UnitPainterSurfaceSelectionScope,
  ): UnitPainterSurfaceHighlight | undefined {
    if (!(intersection.object instanceof THREE.Mesh)) return undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!material || !target) return undefined;

    const mesh = intersection.object;
    const materialIndex =
      intersection.face?.materialIndex
      ?? (intersection.faceIndex != null ? getTriangleMaterialIndex(mesh.geometry, intersection.faceIndex) : 0);
    if (intersection.faceIndex == null) {
      if (scope === "island") return undefined;
      const firstFace = getMaterialFaceIndices(mesh.geometry, materialIndex)[0];
      return firstFace == null
        ? undefined
        : this.getSurfaceHighlightForFace(mesh, materialIndex, firstFace, scope);
    }
    return this.getSurfaceHighlightForFace(mesh, materialIndex, intersection.faceIndex, scope);
  }

  getSelectionSurfaceHighlights(
    scope: UnitPainterSurfaceSelectionScope,
  ): UnitPainterSurfaceHighlight[] {
    const highlights: UnitPainterSurfaceHighlight[] = [];
    const seen = new Set<string>();

    for (const selection of this.selections) {
      let highlight: UnitPainterSurfaceHighlight | undefined;
      if (scope === "material") {
        const firstFace = getMaterialFaceIndices(
          selection.mesh.geometry,
          selection.materialIndex,
        )[0];
        if (firstFace != null) {
          highlight = this.getSurfaceHighlightForFace(
            selection.mesh,
            selection.materialIndex,
            firstFace,
            "material",
          );
        }
      } else if (selection.islandId != null) {
        const triangle = this.getUvTopology(
          selection.mesh.geometry,
          selection.materialIndex,
        )?.islands.get(selection.islandId)?.[0];
        if (triangle) {
          highlight = this.getSurfaceHighlightForFace(
            selection.mesh,
            selection.materialIndex,
            triangle.faceIndex,
            "island",
          );
        }
      }

      if (!highlight || seen.has(highlight.key)) continue;
      seen.add(highlight.key);
      highlights.push(highlight);
    }

    return highlights;
  }

  getSelectionSurfaceHighlight(
    scope: UnitPainterSurfaceSelectionScope,
  ): UnitPainterSurfaceHighlight | undefined {
    return this.getSelectionSurfaceHighlights(scope)[0];
  }

  matchesSelectionScope(
    intersection: THREE.Intersection<THREE.Object3D>,
    scope: UnitPainterSelectionScope,
  ) {
    if (scope === "all") return true;
    if (!(intersection.object instanceof THREE.Mesh)) return false;

    const partitionMask =
      this.selectionPartition?.sourceScope === scope && intersection.uv
        ? (() => {
            const material = getIntersectionMaterial(intersection);
            const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
            const mask = target ? this.selectionPartition?.activeMasks.get(target) : undefined;
            if (!target || !mask) return false;
            const uv = intersection.uv.clone();
            target.editable.updateMatrix();
            target.editable.transformUv(uv);
            const pixelX = wrapCoordinate(Math.floor(uv.x * target.width), target.width, target.editable.wrapS);
            const pixelY = wrapCoordinate(Math.floor(uv.y * target.height), target.height, target.editable.wrapT);
            return maskContainsPixel(mask, pixelX, pixelY);
          })()
        : undefined;
    if (partitionMask !== undefined) return partitionMask;

    if (scope === "similar") {
      if (!intersection.uv) return false;
      const material = getIntersectionMaterial(intersection);
      const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
      const mask = target ? this.similarSelectionMasks.get(target) : undefined;
      if (!target || !mask) return false;
      const uv = intersection.uv.clone();
      target.editable.updateMatrix();
      target.editable.transformUv(uv);
      const pixelX = wrapCoordinate(Math.floor(uv.x * target.width), target.width, target.editable.wrapS);
      const pixelY = wrapCoordinate(Math.floor(uv.y * target.height), target.height, target.editable.wrapT);
      return maskContainsPixel(mask, pixelX, pixelY);
    }

    if (this.selections.length === 0) return false;
    const mesh = intersection.object;
    const materialIndex =
      intersection.face?.materialIndex
      ?? (intersection.faceIndex != null ? getTriangleMaterialIndex(mesh.geometry, intersection.faceIndex) : 0);
    const candidates = this.selections.filter(
      (selection) => selection.mesh === mesh && selection.materialIndex === materialIndex,
    );
    if (candidates.length === 0) return false;
    if (scope === "material") return true;
    if (intersection.faceIndex == null) return false;

    const islandId = this.getUvTopology(mesh.geometry, materialIndex)?.faceToIsland.get(intersection.faceIndex);
    return islandId != null && candidates.some((selection) => selection.islandId === islandId);
  }

  beginStroke() {
    if (this.getActiveLayer()?.kind !== "paint") return;
    if (this.isStrokeOpen) this.endStroke();
    this.currentStroke = new Map();
    this.currentStrokeCoverage = new Map();
    this.currentStrokeLayerId = this.activePaintLayerId;
    this.currentStrokeGpuProfile = { updateRanges: 0, updateBytes: 0 };
    this.isStrokeOpen = true;
  }

  get lastStrokeGpuProfile(): UnitPainterStrokeGpuProfile {
    return { ...this.completedStrokeGpuProfile };
  }

  private resolveBrushIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
    screenRadiusPx: number,
    scope: UnitPainterSelectionScope,
  ): ResolvedBrushIntersection | undefined {
    if (!this.isStrokeOpen || !intersection.uv || !(intersection.object instanceof THREE.Mesh)) return undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target || !this.matchesSelectionScope(intersection, scope)) return undefined;

    const partitionMask =
      this.selectionPartition?.sourceScope === scope
        ? this.selectionPartition.activeMasks.get(target)
        : undefined;
    const mask =
      partitionMask
      ?? (scope === "similar"
        ? this.similarSelectionMasks.get(target)
        : this.getUvIslandMask(intersection, target));
    if ((scope === "similar" || this.selectionPartition?.sourceScope === scope) && !mask) return undefined;
    const uv = intersection.uv.clone();
    target.editable.transformUv(uv);
    return {
      target,
      mask,
      centerX: uv.x * target.width,
      centerY: uv.y * target.height,
      radius: estimateBrushRadiusTexels(
        intersection,
        target,
        Math.max(1, screenRadiusPx),
        camera,
        viewportHeight,
      ),
    };
  }

  paintIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    settings: UnitPainterBrushSettings,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
    screenRadiusPx = settings.radiusPx,
    scope: UnitPainterSelectionScope = "all",
  ) {
    const resolved = this.resolveBrushIntersection(
      intersection,
      camera,
      viewportHeight,
      screenRadiusPx,
      scope,
    );
    if (!resolved) return false;
    return this.paintTexturePointsInternal(
      resolved.target,
      [{ x: resolved.centerX, y: resolved.centerY, radius: resolved.radius }],
      settings,
      resolved.mask,
      true,
    ).changed;
  }

  paintIntersectionSamples(
    previousIntersection: THREE.Intersection<THREE.Object3D>,
    intersection: THREE.Intersection<THREE.Object3D>,
    sampleAmounts: readonly number[],
    settings: UnitPainterBrushSettings,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
    screenRadiusPx = settings.radiusPx,
    scope: UnitPainterSelectionScope = "all",
  ) {
    if (sampleAmounts.length === 0) return false;
    const previous = this.resolveBrushIntersection(
      previousIntersection,
      camera,
      viewportHeight,
      screenRadiusPx,
      scope,
    );
    const current = this.resolveBrushIntersection(
      intersection,
      camera,
      viewportHeight,
      screenRadiusPx,
      scope,
    );
    if (!current) return false;

    // Crossing a mesh/texture/UV-island seam cannot safely be interpolated in UV
    // space. Paint the current hit once and resume UV interpolation from there.
    if (!previous || previous.target !== current.target || previous.mask !== current.mask) {
      return this.paintTexturePointsInternal(
        current.target,
        [{ x: current.centerX, y: current.centerY, radius: current.radius }],
        settings,
        current.mask,
        true,
      ).changed;
    }

    const points = sampleAmounts.map((rawAmount) => {
      const amount = clamp01(rawAmount);
      return {
        x: previous.centerX + (current.centerX - previous.centerX) * amount,
        y: previous.centerY + (current.centerY - previous.centerY) * amount,
        radius: previous.radius + (current.radius - previous.radius) * amount,
      };
    });
    return this.paintTexturePointsInternal(
      current.target,
      points,
      settings,
      current.mask,
      true,
    ).changed;
  }

  private paintTexturePointsInternal(
    target: PaintableTexture,
    points: readonly { x: number; y: number; radius: number }[],
    settings: UnitPainterBrushSettings,
    mask: UvIslandMask | undefined,
    useTextureWrapping: boolean,
  ): UnitPainterTexturePaintResult {
    const layer = this.paintLayers.find((candidate) => candidate.id === this.currentStrokeLayerId);
    if (!layer || points.length === 0) {
      return { changed: false, minX: 0, minY: 0, maxX: -1, maxY: -1 };
    }

    const layerData = this.getLayerTextureData(layer, target, true)!;
    let before = this.currentStroke.get(target);
    if (!before) {
      before = new Map();
      this.currentStroke.set(target, before);
    }
    let coverage = this.currentStrokeCoverage.get(target);
    if (!coverage) {
      coverage = new Map();
      this.currentStrokeCoverage.set(target, coverage);
    }

    const dirtyRows = new Map<number, DirtyRowSpan>();
    let changed = false;
    let changedMinX = target.width;
    let changedMinY = target.height;
    let changedMaxX = -1;
    let changedMaxY = -1;

    for (const point of points) {
      const radius = Math.max(MIN_BRUSH_RADIUS_TEXELS, point.radius);
      const minX = Math.floor(point.x - radius);
      const maxX = Math.ceil(point.x + radius);
      const minY = Math.floor(point.y - radius);
      const maxY = Math.ceil(point.y + radius);

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = (x + 0.5 - point.x) / radius;
          const dy = (y + 0.5 - point.y) / radius;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared > 1) continue;
          if (!useTextureWrapping && (x < 0 || y < 0 || x >= target.width || y >= target.height)) continue;

          const pixelX = useTextureWrapping ? wrapCoordinate(x, target.width, target.editable.wrapS) : x;
          const pixelY = useTextureWrapping ? wrapCoordinate(y, target.height, target.editable.wrapT) : y;
          if (mask && !maskContainsPixel(mask, pixelX, pixelY)) continue;

          const byteIndex = (pixelY * target.width + pixelX) * 4;
          const currentLayerValue = getLayerPixel(layerData, target, byteIndex);
          const strokeStartValue = before.get(byteIndex) ?? currentLayerValue;
          if (!before.has(byteIndex)) before.set(byteIndex, strokeStartValue);

          const falloff = getBrushFalloff(Math.sqrt(distanceSquared), settings.hardness);
          const previousCoverage = coverage.get(byteIndex) ?? 0;
          const nextCoverage = Math.max(previousCoverage, falloff * clamp01(settings.opacity));
          if (nextCoverage <= previousCoverage) continue;
          coverage.set(byteIndex, nextCoverage);

          const nextLayerValue =
            blendLayerPixelFromStrokeStart(target, byteIndex, strokeStartValue, settings, nextCoverage);
          if (nextLayerValue === currentLayerValue) continue;

          setLayerPixel(layerData, target, byteIndex, nextLayerValue);
          this.recomposeTargetPixel(target, byteIndex);

          const row = dirtyRows.get(pixelY);
          if (row) {
            row.minX = Math.min(row.minX, pixelX);
            row.maxX = Math.max(row.maxX, pixelX);
          } else {
            dirtyRows.set(pixelY, { minX: pixelX, maxX: pixelX });
          }
          changedMinX = Math.min(changedMinX, pixelX);
          changedMinY = Math.min(changedMinY, pixelY);
          changedMaxX = Math.max(changedMaxX, pixelX);
          changedMaxY = Math.max(changedMaxY, pixelY);
          changed = true;
        }
      }
    }

    if (changed) this.markTargetRowSpansDirty(target, dirtyRows);
    const result = {
      changed,
      minX: changed ? changedMinX : 0,
      minY: changed ? changedMinY : 0,
      maxX: changedMaxX,
      maxY: changedMaxY,
    };
    if (changed) {
      for (const listener of this.textureChangeListeners) listener(target.textureId, result);
    }
    return result;
  }



  sampleIntersection(intersection: THREE.Intersection<THREE.Object3D>) {
    if (!intersection.uv) return undefined;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target) return undefined;

    const uv = intersection.uv.clone();
    target.editable.transformUv(uv);
    const pixelX = wrapCoordinate(Math.floor(uv.x * target.width), target.width, target.editable.wrapS);
    const pixelY = wrapCoordinate(Math.floor(uv.y * target.height), target.height, target.editable.wrapT);
    const byteIndex = (pixelY * target.width + pixelX) * 4;
    return {
      r: target.data[byteIndex],
      g: target.data[byteIndex + 1],
      b: target.data[byteIndex + 2],
    };
  }

  private getBaseSelectionMaskForTarget(
    target: PaintableTexture,
    scope: Exclude<UnitPainterSelectionScope, "all">,
    paddingPx = 0,
  ) {
    if (scope === "similar") return this.similarSelectionMasks.get(target);

    const relevantSelections = this.selections.filter((selection) => selection.target === target);
    if (relevantSelections.length === 0) return undefined;

    let cache = this.selectionMaskCache.get(target);
    if (!cache) {
      cache = new Map();
      this.selectionMaskCache.set(target, cache);
    }
    const key = `${scope}:padding:${Math.max(0, Math.floor(paddingPx))}:${relevantSelections
      .map((selection) => selection.key)
      .sort()
      .join("|")}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const masks: UvIslandMask[] = [];
    for (const selection of relevantSelections) {
      const mask =
        scope === "island"
          ? selection.islandId == null
            ? undefined
            : this.getUvMask(
                target,
                selection.mesh.geometry,
                selection.materialIndex,
                selection.islandId,
                paddingPx,
              )
          : this.getMaterialMask(
              target,
              selection.mesh.geometry,
              selection.materialIndex,
              paddingPx,
            );
      if (mask) masks.push(mask);
    }
    const combined = masks.length === 1 ? masks[0] : unionUvMasks(masks);
    if (combined) cache.set(key, combined);
    return combined;
  }

  private getSelectionMaskForTarget(
    target: PaintableTexture,
    scope: Exclude<UnitPainterSelectionScope, "all">,
    paddingPx = 0,
  ) {
    if (this.selectionPartition?.sourceScope === scope) {
      return this.selectionPartition.activeMasks.get(target);
    }
    return this.getBaseSelectionMaskForTarget(target, scope, paddingPx);
  }

  fillSelection(
    scope: Exclude<UnitPainterSelectionScope, "all">,
    settings: UnitPainterBrushSettings,
    paddingPx = 0,
  ) {
    const layer = this.getActiveLayer();
    const targets = this.getBaseSelectionTargets(scope);
    if (targets.length === 0 || !layer || layer.kind !== "paint") return false;
    if (this.isStrokeOpen) this.endStroke();

    const changes: StrokeChange[] = [];
    for (const target of targets) {
      const mask = this.getSelectionMaskForTarget(target, scope, paddingPx);
      if (!mask) continue;

      const layerData = this.getLayerTextureData(layer, target, true)!;
      const byteIndices: number[] = [];
      const beforeValues: number[] = [];
      const afterValues: number[] = [];
      const fillOpacity = clamp01(settings.opacity);
      let dirtyStart = Number.POSITIVE_INFINITY;
      let dirtyEnd = 0;

      forEachMaskPixel(mask, (pixelX, pixelY) => {
        const byteIndex = (pixelY * target.width + pixelX) * 4;
        const currentValue = getLayerPixel(layerData, target, byteIndex);
        const nextValue =
          blendLayerPixelFromStrokeStart(target, byteIndex, currentValue, settings, fillOpacity);
        if (nextValue === currentValue) return;
        setLayerPixel(layerData, target, byteIndex, nextValue);
        byteIndices.push(byteIndex);
        beforeValues.push(currentValue);
        afterValues.push(nextValue);
        this.recomposeTargetPixel(target, byteIndex);
        dirtyStart = Math.min(dirtyStart, byteIndex);
        dirtyEnd = Math.max(dirtyEnd, byteIndex + 4);
      });

      if (byteIndices.length === 0) continue;
      this.markTargetRangeDirty(target, dirtyStart, dirtyEnd);
      changes.push({
        kind: "packed",
        layerId: layer.id,
        target,
        byteIndices: Uint32Array.from(byteIndices),
        before: Uint32Array.from(beforeValues),
        after: Uint32Array.from(afterValues),
      });
    }

    if (changes.length === 0) return false;
    this.pushHistory(changes);
    return true;
  }

  resetSelection(scope: Exclude<UnitPainterSelectionScope, "all">) {
    const layer = this.getActiveLayer();
    const targets = this.getBaseSelectionTargets(scope);
    if (targets.length === 0 || !layer || layer.kind !== "paint") return false;
    if (this.isStrokeOpen) this.endStroke();

    const changes: StrokeChange[] = [];
    const touchedTargets: PaintableTexture[] = [];
    for (const target of targets) {
      const mask = this.getSelectionMaskForTarget(target, scope);
      if (!mask) continue;
      const layerData = this.getLayerTextureData(layer, target);
      if (!layerData) continue;

      const byteIndices: number[] = [];
      const beforeValues: number[] = [];
      const afterValues: number[] = [];
      let dirtyStart = Number.POSITIVE_INFINITY;
      let dirtyEnd = 0;

      forEachMaskPixel(mask, (pixelX, pixelY) => {
        const byteIndex = (pixelY * target.width + pixelX) * 4;
        const currentValue = getLayerPixel(layerData, target, byteIndex);
        if (currentValue === 0) return;
        setLayerPixel(layerData, target, byteIndex, 0);
        byteIndices.push(byteIndex);
        beforeValues.push(currentValue);
        afterValues.push(0);
        this.recomposeTargetPixel(target, byteIndex);
        dirtyStart = Math.min(dirtyStart, byteIndex);
        dirtyEnd = Math.max(dirtyEnd, byteIndex + 4);
      });

      if (byteIndices.length === 0) continue;
      this.markTargetRangeDirty(target, dirtyStart, dirtyEnd);
      touchedTargets.push(target);
      changes.push({
        kind: "packed",
        layerId: layer.id,
        target,
        byteIndices: Uint32Array.from(byteIndices),
        before: Uint32Array.from(beforeValues),
        after: Uint32Array.from(afterValues),
      });
    }

    if (changes.length === 0) return false;
    this.pruneTouchedLayerTiles(touchedTargets);
    this.pushHistory(changes);
    return true;
  }

  endStroke() {
    if (!this.isStrokeOpen) return false;
    this.isStrokeOpen = false;

    const layer = this.paintLayers.find((candidate) => candidate.id === this.currentStrokeLayerId);
    const changes: StrokeChange[] = [];
    if (layer) {
      for (const [target, before] of this.currentStroke) {
        const layerData = this.getLayerTextureData(layer, target);
        if (!layerData) continue;
        const byteIndices: number[] = [];
        const beforeValues: number[] = [];
        const afterValues: number[] = [];
        for (const [byteIndex, oldValue] of before) {
          const newValue = getLayerPixel(layerData, target, byteIndex);
          if (newValue === oldValue) continue;
          byteIndices.push(byteIndex);
          beforeValues.push(oldValue);
          afterValues.push(newValue);
        }
        if (byteIndices.length > 0) {
          changes.push({
            kind: "packed",
            layerId: layer.id,
            target,
            byteIndices: Uint32Array.from(byteIndices),
            before: Uint32Array.from(beforeValues),
            after: Uint32Array.from(afterValues),
          });
        }
      }
    }
    const touchedTargets = [...this.currentStroke.keys()];
    this.currentStroke = new Map();
    this.currentStrokeCoverage = new Map();
    this.pruneTouchedLayerTiles(touchedTargets);
    this.completedStrokeGpuProfile = { ...this.currentStrokeGpuProfile };
    this.currentStrokeGpuProfile = { updateRanges: 0, updateBytes: 0 };
    this.currentStrokeLayerId = "";

    if (changes.length === 0) return false;
    this.pushHistory(changes);
    return true;
  }

  undo() {
    if (this.isStrokeOpen) this.endStroke();
    const stroke = this.history.pop();
    if (!stroke) return false;
    this.applyStroke(stroke, "before");
    this.currentStateId = stroke.beforeStateId;
    this.redoHistory.push(stroke);
    return true;
  }

  redo() {
    if (this.isStrokeOpen) this.endStroke();
    const stroke = this.redoHistory.pop();
    if (!stroke) return false;
    this.applyStroke(stroke, "after");
    this.currentStateId = stroke.afterStateId;
    this.history.push(stroke);
    return true;
  }

  reset() {
    if (this.isStrokeOpen) this.endStroke();
    const layer = this.getActiveLayer();
    if (!layer || layer.kind !== "paint") return false;
    const changes: StrokeChange[] = [];

    for (const [target, layerData] of layer.textures) {
      const byteIndices: number[] = [];
      const beforeValues: number[] = [];
      forEachLayerPixel(layerData, target, (byteIndex, value) => {
        byteIndices.push(byteIndex);
        beforeValues.push(value);
      });
      if (byteIndices.length === 0) continue;

      for (const byteIndex of byteIndices) setLayerPixel(layerData, target, byteIndex, 0);
      changes.push({
        kind: "packed",
        layerId: layer.id,
        target,
        byteIndices: Uint32Array.from(byteIndices),
        before: Uint32Array.from(beforeValues),
        after: new Uint32Array(byteIndices.length),
      });
      this.recomposeTarget(target);
      this.pruneTouchedLayerTiles([target]);
    }

    if (changes.length === 0) return false;
    this.pushHistory(changes);
    return true;
  }

  exportProjectState(): UnitPainterProjectState {
    if (this.isStrokeOpen) this.endStroke();
    for (const layer of this.paintLayers) {
      if (layer.decal && !layer.decal.target.sourceVirtualPath) {
        throw new Error(
          `The decal '${layer.name}' targets a texture without its original WH3 texture path.`,
        );
      }
    }
    return {
      activeLayerId: this.activePaintLayerId,
      layers: this.paintLayers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        kind: layer.kind,
        ...(layer.decal
          ? {
              decal: {
                targetSourceVirtualPath: layer.decal.target.sourceVirtualPath ?? "",
                ...(layer.decal.normalTarget?.sourceVirtualPath
                  ? { normalSourceVirtualPath: layer.decal.normalTarget.sourceVirtualPath }
                  : {}),
                sourceName: layer.decal.source.name,
                sourceWidth: layer.decal.source.width,
                sourceHeight: layer.decal.source.height,
                sourceRgbaBytes: new Uint8Array(layer.decal.source.rgbaBytes),
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
              },
            }
          : {}),
        textures: layer.kind === "decal"
          ? []
          : [...layer.textures.entries()]
          .filter(([, data]) => data.tiles.size > 0)
          .map(([target, data]) => {
            if (!target.sourceVirtualPath) {
              throw new Error(
                `The painted texture '${target.sourceFileName}' is missing its original WH3 texture path.`,
              );
            }
            return {
              sourceVirtualPath: target.sourceVirtualPath,
              width: target.width,
              height: target.height,
              tiles: [...data.tiles.entries()].map(([key, tile]) => ({
                key,
                rgbaBytes: new Uint8Array(tile.data),
              })),
            };
          }),
      })),
    };
  }

  loadProjectLayers(project: UnitPainterProjectState) {
    if (this.isStrokeOpen) this.endStroke();
    if (
      !Array.isArray(project.layers)
      || project.layers.length === 0
      || project.layers.length > MAX_PAINT_LAYERS
    ) {
      throw new Error("The painter project does not contain any paint layers.");
    }

    const seenLayerIds = new Set<string>();
    const layers: PaintLayer[] = project.layers.map((savedLayer, index) => {
      const id = savedLayer.id.trim();
      const name = savedLayer.name.trim();
      if (!id || seenLayerIds.has(id) || !name) throw new Error("The painter project contains an invalid layer.");
      seenLayerIds.add(id);
      const layer: PaintLayer = {
        id,
        name: name.slice(0, 80),
        visible: !!savedLayer.visible,
        opacity: clamp01(savedLayer.opacity),
        kind: savedLayer.kind === "decal" ? "decal" : "paint",
        textures: new Map(),
      };

      if (layer.kind === "decal") {
        const savedDecal = savedLayer.decal;
        const targetKey = savedDecal?.targetSourceVirtualPath.replace(/\//g, "\\").toLowerCase();
        const target = targetKey ? this.targetsBySourcePath.get(targetKey) : undefined;
        const normalKey = savedDecal?.normalSourceVirtualPath?.replace(/\//g, "\\").toLowerCase();
        const normalTarget = normalKey ? this.normalTargetsBySourcePath.get(normalKey) : undefined;
        if (
          !savedDecal
          || !target
          || !Number.isFinite(savedDecal.centerU)
          || !Number.isFinite(savedDecal.centerV)
          || !Number.isFinite(savedDecal.widthU)
          || !Number.isFinite(savedDecal.heightV)
          || !Number.isFinite(savedDecal.rotationDeg)
          || !Number.isFinite(savedDecal.normalStrength)
          || !savedDecal.tint
          || !Number.isFinite(savedDecal.tint.r)
          || !Number.isFinite(savedDecal.tint.g)
          || !Number.isFinite(savedDecal.tint.b)
          || !validateDecalSource({
            name: savedDecal.sourceName,
            width: savedDecal.sourceWidth,
            height: savedDecal.sourceHeight,
            rgbaBytes: savedDecal.sourceRgbaBytes,
          })
        ) {
          throw new Error(`The decal layer '${name}' is invalid or its target texture is no longer present.`);
        }
        layer.decal = {
          target,
          normalTarget,
          source: {
            name: savedDecal.sourceName,
            width: savedDecal.sourceWidth,
            height: savedDecal.sourceHeight,
            rgbaBytes: new Uint8Array(savedDecal.sourceRgbaBytes),
          },
          centerU: savedDecal.centerU,
          centerV: savedDecal.centerV,
          widthU: Math.max(0.001, Math.abs(savedDecal.widthU)),
          heightV: Math.max(0.001, Math.abs(savedDecal.heightV)),
          rotationDeg: savedDecal.rotationDeg,
          tintEnabled: !!savedDecal.tintEnabled,
          tint: {
            r: Math.max(0, Math.min(255, Math.round(savedDecal.tint.r))),
            g: Math.max(0, Math.min(255, Math.round(savedDecal.tint.g))),
            b: Math.max(0, Math.min(255, Math.round(savedDecal.tint.b))),
          },
          affectNormal: !!savedDecal.affectNormal,
          normalStrength: Math.max(0, Math.min(4, savedDecal.normalStrength)),
          normalHeightSource: savedDecal.normalHeightSource === "luminance" ? "luminance" : "alpha",
        };
      }

      if (layer.kind === "decal" && (savedLayer.textures?.length ?? 0) > 0) {
        throw new Error(`The decal layer '${name}' contains unexpected raster paint tiles.`);
      }

      for (const texture of savedLayer.textures ?? []) {
        const sourceKey = texture.sourceVirtualPath.replace(/\//g, "\\").toLowerCase();
        const target = this.targetsBySourcePath.get(sourceKey);
        if (!target) {
          throw new Error(
            `The painted source texture '${texture.sourceVirtualPath}' is no longer present on this unit. The source mod may have changed.`,
          );
        }
        if (target.width !== texture.width || target.height !== texture.height) {
          throw new Error(
            `The painted source texture '${texture.sourceVirtualPath}' changed size from ${texture.width}x${texture.height} to ${target.width}x${target.height}.`,
          );
        }

        const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
        const tileRows = Math.ceil(target.height / LAYER_TILE_SIZE);
        const maxTileKey = tilesPerRow * tileRows;
        const layerTexture = createLayerTexture();
        const seenTileKeys = new Set<number>();
        for (const savedTile of texture.tiles ?? []) {
          if (
            !Number.isInteger(savedTile.key)
            || savedTile.key < 0
            || savedTile.key >= maxTileKey
            || seenTileKeys.has(savedTile.key)
            || savedTile.rgbaBytes.length !== LAYER_TILE_BYTES
          ) {
            throw new Error(`The saved layer tiles for '${texture.sourceVirtualPath}' are invalid.`);
          }
          seenTileKeys.add(savedTile.key);

          let nonZeroPixels = 0;
          for (let byteIndex = 3; byteIndex < savedTile.rgbaBytes.length; byteIndex += 4) {
            if (savedTile.rgbaBytes[byteIndex] !== 0) nonZeroPixels += 1;
          }
          if (nonZeroPixels === 0) continue;

          layerTexture.tiles.set(savedTile.key, {
            data: new Uint8Array(savedTile.rgbaBytes),
            nonZeroPixels,
          });
          target.touchedLayerTiles.add(savedTile.key);
        }
        if (layerTexture.tiles.size > 0) layer.textures.set(target, layerTexture);
      }

      const numericId = /^layer-(\d+)$/.exec(id);
      if (numericId) this.nextLayerNumber = Math.max(this.nextLayerNumber, Number(numericId[1]) + 1);
      else if (index + 1 >= this.nextLayerNumber) this.nextLayerNumber = index + 2;
      return layer;
    });

    this.paintLayers = layers;
    this.activePaintLayerId = seenLayerIds.has(project.activeLayerId)
      ? project.activeLayerId
      : layers[layers.length - 1].id;
    for (const layer of this.paintLayers) {
      if (layer.kind === "decal") this.rasterizeDecalLayer(layer, false);
    }
    this.recomposeAllTargets();
    this.recomposeAllNormalTargets();
    this.history.length = 0;
    this.redoHistory.length = 0;
    this.retainedHistoryBytes = 0;
    this.currentStroke.clear();
    this.currentStrokeCoverage.clear();
    this.currentStrokeLayerId = "";
    this.currentStateId = 0;
    this.savedStateId = 0;
    this.nextStateId = 1;
  }

  exportModifiedTextures(): UnitPainterExportTexture[] {
    if (this.isStrokeOpen) this.endStroke();
    const modifiedTargets = [
      ...[...this.targetsByEditableTexture.values()].filter((target) => this.hasCompositeChanges(target)),
      ...[...this.normalTargetsByOriginal.values()].filter((target) => this.hasAnyDataChanges(target)),
    ];

    const usedNames = new Map<string, number>();
    const output: UnitPainterExportTexture[] = [];
    for (const target of modifiedTargets) {
      if (!target.sourceVirtualPath) {
        throw new Error(
          `The painted texture '${target.sourceFileName}' is missing its original WH3 texture path. Reload the unit with the updated WH3AssetHost and try again.`,
        );
      }

      const seenCount = usedNames.get(target.sourceFileName) ?? 0;
      usedNames.set(target.sourceFileName, seenCount + 1);
      const fileName =
        seenCount === 0
          ? target.sourceFileName
          : target.sourceFileName.replace(/\.rgba$/i, `_${seenCount + 1}.rgba`);
      output.push({
        fileName,
        sourceVirtualPath: target.sourceVirtualPath,
        width: target.width,
        height: target.height,
        rgbaBytes: target.data,
      });
    }
    return output;
  }

  dispose() {
    if (this.isStrokeOpen) this.endStroke();
    for (const { mesh, raycast } of this.raycastRestores) mesh.raycast = raycast;
    for (const [geometry, bvh] of this.ownedStaticBoundsTrees) {
      if (geometry.boundsTree === bvh) geometry.boundsTree = undefined;
    }
    this.raycastRestores.length = 0;
    this.dynamicRaycastBvhs.length = 0;
    this.ownedStaticBoundsTrees.clear();
    for (const { material, property, original } of this.restores) {
      material[property] = original;
      material.needsUpdate = true;
    }
    for (const target of this.targetsByEditableTexture.values()) target.editable.dispose();
    for (const target of this.normalTargetsByOriginal.values()) target.editable.dispose();
    this.restores.length = 0;
    this.targetsByEditableTexture.clear();
    this.targetsBySourcePath.clear();
    this.normalTargetsByOriginal.clear();
    this.normalTargetsBySourcePath.clear();
    this.normalTargetByMaterial.clear();
    this.normalTargetsByBaseTarget.clear();
    this.surfacesByTarget.clear();
    this.textureChangeListeners.clear();
    this.paintLayers.length = 0;
    this.activePaintLayerId = "";
    this.history.length = 0;
    this.redoHistory.length = 0;
    this.retainedHistoryBytes = 0;
    this.currentStroke.clear();
    this.currentStrokeCoverage.clear();
    this.uvMasksByTarget.clear();
    this.uvCoverageMasksByTarget.clear();
    this.selectionMaskCache.clear();
    this.selectionPartition = undefined;
    this.similarSelectionMasks.clear();
    this.similarSelectionLastTarget = undefined;
    this.uvMaskCacheLru.clear();
    this.uvMaskCacheBytes = 0;
    this.selections = [];
    this.selectionMode = undefined;
  }

  private getUvTopology(geometry: THREE.BufferGeometry, materialIndex: number) {
    let topologyByMaterial = this.uvTopologies.get(geometry);
    if (!topologyByMaterial) {
      topologyByMaterial = new Map();
      this.uvTopologies.set(geometry, topologyByMaterial);
    }

    let topology = topologyByMaterial.get(materialIndex);
    if (!topology) {
      topology = createUvIslandTopology(geometry, materialIndex);
      if (!topology) return undefined;
      topologyByMaterial.set(materialIndex, topology);
    }
    return topology;
  }

  private getCachedUvMask(cache: Map<string, CachedUvMask>, key: string) {
    const cached = cache.get(key);
    if (!cached) return undefined;
    const lruEntry = this.uvMaskCacheLru.get(cached.cacheId);
    if (lruEntry) {
      this.uvMaskCacheLru.delete(cached.cacheId);
      this.uvMaskCacheLru.set(cached.cacheId, lruEntry);
    }
    return cached.mask;
  }

  private cacheUvMask(cache: Map<string, CachedUvMask>, key: string, mask: UvIslandMask) {
    if (mask.byteSize > MAX_UV_MASK_CACHE_BYTES) return mask;

    while (
      this.uvMaskCacheBytes + mask.byteSize > MAX_UV_MASK_CACHE_BYTES
      && this.uvMaskCacheLru.size > 0
    ) {
      const oldest = this.uvMaskCacheLru.entries().next().value as
        | [number, { owner: Map<string, CachedUvMask>; key: string; mask: UvIslandMask }]
        | undefined;
      if (!oldest) break;
      const [cacheId, entry] = oldest;
      this.uvMaskCacheLru.delete(cacheId);
      const current = entry.owner.get(entry.key);
      if (current?.cacheId === cacheId) entry.owner.delete(entry.key);
      this.uvMaskCacheBytes = Math.max(0, this.uvMaskCacheBytes - entry.mask.byteSize);
    }

    const cacheId = this.nextUvMaskCacheId++;
    const cached: CachedUvMask = { cacheId, mask };
    cache.set(key, cached);
    this.uvMaskCacheLru.set(cacheId, { owner: cache, key, mask });
    this.uvMaskCacheBytes += mask.byteSize;
    return mask;
  }

  private getTargetUvCoverageMask(target: PaintableTexture) {
    let cache = this.uvCoverageMasksByTarget.get(target);
    if (!cache) {
      cache = new Map();
      this.uvCoverageMasksByTarget.set(target, cache);
    }
    const key = "target:coverage";
    const cached = this.getCachedUvMask(cache, key);
    if (cached) return cached;

    const triangles: UvTriangle[] = [];
    for (const surface of this.surfacesByTarget.get(target) ?? []) {
      const topology = this.getUvTopology(surface.geometry, surface.materialIndex);
      if (!topology) continue;
      for (const island of topology.islands.values()) triangles.push(...island);
    }
    const mask = buildUvIslandMask(triangles, target);
    if (!mask) return undefined;
    return this.cacheUvMask(cache, key, mask);
  }

  private getUvMask(
    target: PaintableTexture,
    geometry: THREE.BufferGeometry,
    materialIndex: number,
    islandId: number,
    paddingPx = 0,
  ) {
    const topology = this.getUvTopology(geometry, materialIndex);
    const triangles = topology?.islands.get(islandId);
    if (!triangles) return undefined;

    let masksByGeometry = this.uvMasksByTarget.get(target);
    if (!masksByGeometry) {
      masksByGeometry = new WeakMap();
      this.uvMasksByTarget.set(target, masksByGeometry);
    }
    let masks = masksByGeometry.get(geometry);
    if (!masks) {
      masks = new Map();
      masksByGeometry.set(geometry, masks);
    }

    const padding = Math.max(0, Math.floor(paddingPx));
    const key = `island:${materialIndex}:${islandId}:padding:${padding}`;
    const cached = this.getCachedUvMask(masks, key);
    if (cached) return cached;
    if (padding > 0) {
      const baseMask = this.getUvMask(target, geometry, materialIndex, islandId, 0);
      if (!baseMask) return undefined;
      const padded = protectOccupiedUvPixels(
        dilateUvMask(baseMask, padding),
        baseMask,
        this.getTargetUvCoverageMask(target),
      );
      return this.cacheUvMask(masks, key, padded);
    }
    const mask = buildUvIslandMask(triangles, target);
    if (!mask) return undefined;
    return this.cacheUvMask(masks, key, mask);
  }

  private getMaterialMask(
    target: PaintableTexture,
    geometry: THREE.BufferGeometry,
    materialIndex: number,
    paddingPx = 0,
  ) {
    const topology = this.getUvTopology(geometry, materialIndex);
    if (!topology) return undefined;

    let masksByGeometry = this.uvMasksByTarget.get(target);
    if (!masksByGeometry) {
      masksByGeometry = new WeakMap();
      this.uvMasksByTarget.set(target, masksByGeometry);
    }
    let masks = masksByGeometry.get(geometry);
    if (!masks) {
      masks = new Map();
      masksByGeometry.set(geometry, masks);
    }

    const padding = Math.max(0, Math.floor(paddingPx));
    const key = `material:${materialIndex}:padding:${padding}`;
    const cached = this.getCachedUvMask(masks, key);
    if (cached) return cached;
    if (padding > 0) {
      const baseMask = this.getMaterialMask(target, geometry, materialIndex, 0);
      if (!baseMask) return undefined;
      const padded = protectOccupiedUvPixels(
        dilateUvMask(baseMask, padding),
        baseMask,
        this.getTargetUvCoverageMask(target),
      );
      return this.cacheUvMask(masks, key, padded);
    }
    const triangles = [...topology.islands.values()].flat();
    const mask = buildUvIslandMask(triangles, target);
    if (!mask) return undefined;
    return this.cacheUvMask(masks, key, mask);
  }

  private getUvIslandMask(
    intersection: THREE.Intersection<THREE.Object3D>,
    target: PaintableTexture,
  ): UvIslandMask | undefined {
    if (!(intersection.object instanceof THREE.Mesh) || intersection.faceIndex == null) return undefined;
    const geometry = intersection.object.geometry;
    const materialIndex =
      intersection.face?.materialIndex ?? getTriangleMaterialIndex(geometry, intersection.faceIndex);
    const topology = this.getUvTopology(geometry, materialIndex);
    const islandId = topology?.faceToIsland.get(intersection.faceIndex);
    if (islandId == null) return undefined;
    return this.getUvMask(target, geometry, materialIndex, islandId);
  }

  private estimateLayerSnapshotBytes(snapshot: LayerSnapshot) {
    let bytes =
      HISTORY_SNAPSHOT_OVERHEAD_BYTES
      + (snapshot.id.length + snapshot.name.length) * 2;
    for (const { data } of snapshot.textures) {
      bytes += HISTORY_TEXTURE_OVERHEAD_BYTES;
      for (const tile of data.tiles.values()) {
        bytes += HISTORY_TILE_OVERHEAD_BYTES + tile.data.byteLength;
      }
    }
    if (snapshot.decal) bytes += snapshot.decal.source.rgbaBytes.byteLength + 256;
    return bytes;
  }

  private estimateHistoryChangeBytes(change: HistoryChange) {
    let bytes = HISTORY_BASE_OVERHEAD_BYTES;

    if (change.kind === "pixels") {
      for (const pixelChange of change.changes) {
        bytes +=
          HISTORY_TEXTURE_OVERHEAD_BYTES
          + pixelChange.layerId.length * 2
          + pixelChange.byteIndices.byteLength
          + pixelChange.before.byteLength
          + pixelChange.after.byteLength;
      }
      return bytes;
    }

    if (change.kind === "layer-add" || change.kind === "layer-delete") {
      return bytes
        + this.estimateLayerSnapshotBytes(change.layer)
        + (change.beforeActiveLayerId.length + change.afterActiveLayerId.length) * 2;
    }

    if (change.kind === "layer-replace") {
      for (const snapshot of change.before) bytes += this.estimateLayerSnapshotBytes(snapshot);
      for (const snapshot of change.after) bytes += this.estimateLayerSnapshotBytes(snapshot);
      return bytes
        + (change.beforeActiveLayerId.length + change.afterActiveLayerId.length) * 2;
    }

    if (change.kind === "layer-order") {
      return bytes
        + [...change.before, ...change.after].reduce((total, id) => total + id.length * 2, 0);
    }

    return bytes
      + change.layerId.length * 2
      + (change.before.name.length + change.after.name.length) * 2
      + 64;
  }

  private clearRedoHistory() {
    if (this.redoHistory.length === 0) return;
    for (const stroke of this.redoHistory) {
      this.retainedHistoryBytes -= stroke.byteSize;
    }
    this.retainedHistoryBytes = Math.max(0, this.retainedHistoryBytes);
    this.redoHistory.length = 0;
  }

  private trimHistoryToBudget() {
    while (
      this.history.length > 1
      && (
        this.history.length > MAX_HISTORY_STROKES
        || this.retainedHistoryBytes > MAX_HISTORY_BYTES
      )
    ) {
      const removed = this.history.shift();
      if (!removed) break;
      this.retainedHistoryBytes = Math.max(0, this.retainedHistoryBytes - removed.byteSize);
    }
  }

  private pushHistory(changes: StrokeChange[]) {
    this.pushHistoryChange({ kind: "pixels", changes });
  }

  private pushHistoryChange(change: HistoryChange) {
    this.clearRedoHistory();
    const stroke: Stroke = {
      change,
      beforeStateId: this.currentStateId,
      afterStateId: this.nextStateId++,
      byteSize: this.estimateHistoryChangeBytes(change),
    };
    this.currentStateId = stroke.afterStateId;
    this.history.push(stroke);
    this.retainedHistoryBytes += stroke.byteSize;
    this.trimHistoryToBudget();
  }

  private applyStroke(stroke: Stroke, side: "before" | "after") {
    const change = stroke.change;
    if (change.kind === "pixels") {
      const affectedTargets = new Set<PaintableTexture>();
      for (const pixelChange of change.changes) {
        affectedTargets.add(pixelChange.target);
        const layer = this.paintLayers.find((candidate) => candidate.id === pixelChange.layerId);
        if (!layer) continue;
        const layerData = this.getLayerTextureData(layer, pixelChange.target, true)!;
        let dirtyStart = Number.POSITIVE_INFINITY;
        let dirtyEnd = 0;
        const values = pixelChange[side];
        for (let index = 0; index < pixelChange.byteIndices.length; index += 1) {
          const byteIndex = pixelChange.byteIndices[index];
          setLayerPixel(layerData, pixelChange.target, byteIndex, values[index]);
          this.recomposeTargetPixel(pixelChange.target, byteIndex);
          dirtyStart = Math.min(dirtyStart, byteIndex);
          dirtyEnd = Math.max(dirtyEnd, byteIndex + 4);
        }
        if (dirtyEnd > dirtyStart) this.markTargetRangeDirty(pixelChange.target, dirtyStart, dirtyEnd);
      }
      this.pruneTouchedLayerTiles(affectedTargets);
      return;
    }

    if (change.kind === "layer-add") {
      if (side === "after") {
        this.paintLayers.splice(change.index, 0, this.layerFromSnapshot(change.layer));
        this.activePaintLayerId = change.afterActiveLayerId;
      } else {
        this.paintLayers = this.paintLayers.filter((layer) => layer.id !== change.layer.id);
        this.activePaintLayerId = change.beforeActiveLayerId;
      }
      const affectedTargets = change.layer.textures.map(({ target }) => target);
      this.recomposeTargets(affectedTargets);
      this.pruneTouchedLayerTiles(affectedTargets);
      this.recomposeAllNormalTargets();
      return;
    }

    if (change.kind === "layer-delete") {
      if (side === "before") {
        this.paintLayers.splice(change.index, 0, this.layerFromSnapshot(change.layer));
        this.activePaintLayerId = change.beforeActiveLayerId;
      } else {
        this.paintLayers = this.paintLayers.filter((layer) => layer.id !== change.layer.id);
        this.activePaintLayerId = change.afterActiveLayerId;
      }
      const affectedTargets = change.layer.textures.map(({ target }) => target);
      this.recomposeTargets(affectedTargets);
      this.pruneTouchedLayerTiles(affectedTargets);
      this.recomposeAllNormalTargets();
      return;
    }

    if (change.kind === "layer-meta") {
      const layer = this.paintLayers.find((candidate) => candidate.id === change.layerId);
      if (!layer) return;
      const metadata = change[side];
      const appearanceChanged =
        layer.visible !== metadata.visible || Math.abs(layer.opacity - metadata.opacity) >= 0.0001;
      layer.name = metadata.name;
      layer.visible = metadata.visible;
      layer.opacity = metadata.opacity;
      if (appearanceChanged) {
        this.recomposeTargets(layer.textures.keys());
        if (layer.kind === "decal" && layer.decal) this.recomposeNormalTargetsForBase(layer.decal.target);
      }
      return;
    }

    if (change.kind === "layer-replace") {
      const removeCount = side === "before" ? change.after.length : change.before.length;
      const insert = (side === "before" ? change.before : change.after).map((snapshot) =>
        this.layerFromSnapshot(snapshot),
      );
      this.paintLayers.splice(change.index, removeCount, ...insert);
      this.activePaintLayerId =
        side === "before" ? change.beforeActiveLayerId : change.afterActiveLayerId;
      const affectedTargets = [...change.before, ...change.after].flatMap((snapshot) =>
        snapshot.textures.map(({ target }) => target),
      );
      this.recomposeTargets(affectedTargets);
      this.pruneTouchedLayerTiles(affectedTargets);
      this.recomposeAllNormalTargets();
      return;
    }

    const order = change[side];
    const byId = new Map(this.paintLayers.map((layer) => [layer.id, layer]));
    const reordered = order.map((id) => byId.get(id)).filter((layer): layer is PaintLayer => !!layer);
    if (reordered.length === this.paintLayers.length) this.paintLayers = reordered;
    this.recomposeAllTargets();
    this.recomposeAllNormalTargets();
  }

  private createEmptyLayer(name?: string): PaintLayer {
    const number = this.nextLayerNumber++;
    return {
      id: `layer-${number}`,
      name: (name?.trim() || `Paint ${number}`).slice(0, 80),
      visible: true,
      opacity: 1,
      kind: "paint",
      textures: new Map(),
    };
  }

  private getActiveLayer() {
    return this.paintLayers.find((layer) => layer.id === this.activePaintLayerId);
  }

  private getLayerTextureData(layer: PaintLayer, target: PaintableTexture, create = false) {
    let data = layer.textures.get(target);
    if (!data && create) {
      data = createLayerTexture();
      layer.textures.set(target, data);
    }
    return data;
  }

  private layerMetadata(layer: PaintLayer): LayerMetadata {
    return { name: layer.name, visible: layer.visible, opacity: layer.opacity };
  }

  private snapshotLayer(layer: PaintLayer): LayerSnapshot {
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      kind: layer.kind,
      decal: layer.decal ? cloneDecalState(layer.decal) : undefined,
      textures: [...layer.textures.entries()].map(([target, data]) => ({
        target,
        data: cloneLayerTexture(data),
      })),
    };
  }

  private layerFromSnapshot(snapshot: LayerSnapshot): PaintLayer {
    for (const { target, data } of snapshot.textures) {
      for (const tileKey of data.tiles.keys()) target.touchedLayerTiles.add(tileKey);
    }
    return {
      id: snapshot.id,
      name: snapshot.name,
      visible: snapshot.visible,
      opacity: snapshot.opacity,
      kind: snapshot.kind,
      decal: snapshot.decal ? cloneDecalState(snapshot.decal) : undefined,
      textures: new Map<PaintableTexture, LayerTexture>(
        snapshot.textures.map(({ target, data }) => [target, cloneLayerTexture(data)] as const),
      ),
    };
  }

  private rasterizeDecalLayer(layer: PaintLayer, updateNormal: boolean) {
    const decal = layer.decal;
    if (layer.kind !== "decal" || !decal) return;

    const affectedTargets = new Set<PaintableTexture>([...layer.textures.keys(), decal.target]);
    layer.textures = new Map();
    const output = createLayerTexture();
    layer.textures.set(decal.target, output);

    const coverageMask = this.getTargetUvCoverageMask(decal.target);
    const bounds = getDecalBounds(decal, decal.target.width, decal.target.height);
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (coverageMask && !maskContainsPixel(coverageMask, x, y)) continue;
        const sourceUv = getDecalSourceUv(
          decal,
          (x + 0.5) / decal.target.width,
          (y + 0.5) / decal.target.height,
        );
        const sourcePixel = sampleDecalSource(decal.source, sourceUv.u, sourceUv.v);
        if (!sourcePixel || sourcePixel.a === 0) continue;

        let r = sourcePixel.r;
        let g = sourcePixel.g;
        let b = sourcePixel.b;
        if (decal.tintEnabled) {
          const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          r = Math.round(decal.tint.r * luminance);
          g = Math.round(decal.tint.g * luminance);
          b = Math.round(decal.tint.b * luminance);
        }
        const byteIndex = (y * decal.target.width + x) * 4;
        setLayerPixel(
          output,
          decal.target,
          byteIndex,
          (r | (g << 8) | (b << 16) | (sourcePixel.a << 24)) >>> 0,
        );
      }
    }

    this.recomposeTargets(affectedTargets);
    this.pruneTouchedLayerTiles(affectedTargets);
    if (updateNormal) this.recomposeNormalTargetsForBase(decal.target);
  }

  private applyDecalToNormalTarget(
    layer: PaintLayer,
    decal: UnitPainterDecalState,
    normalTarget: PaintableTexture,
  ) {
    if (
      !layer.visible
      || layer.opacity <= 0
      || !decal.affectNormal
      || decal.normalStrength <= 0
    ) {
      return;
    }

    const bounds = getDecalBounds(decal, normalTarget.width, normalTarget.height);
    const du = 1 / normalTarget.width;
    const dv = 1 / normalTarget.height;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const textureU = (x + 0.5) / normalTarget.width;
        const textureV = (y + 0.5) / normalTarget.height;
        const sourceUv = getDecalSourceUv(decal, textureU, textureV);
        const sourcePixel = sampleDecalSource(decal.source, sourceUv.u, sourceUv.v);
        if (!sourcePixel || sourcePixel.a === 0) continue;

        const left = getDecalHeight(decal, textureU - du, textureV);
        const right = getDecalHeight(decal, textureU + du, textureV);
        const up = getDecalHeight(decal, textureU, textureV - dv);
        const down = getDecalHeight(decal, textureU, textureV + dv);
        const slope = decal.normalStrength * 4;
        let detailX = -(right - left) * slope;
        let detailY = -(down - up) * slope;
        let detailZ = 1;
        const detailLength = Math.hypot(detailX, detailY, detailZ) || 1;
        detailX /= detailLength;
        detailY /= detailLength;
        detailZ /= detailLength;

        const byteIndex = (y * normalTarget.width + x) * 4;
        const baseX = decodeNormalByte(normalTarget.data[byteIndex]);
        const baseY = decodeNormalByte(normalTarget.data[byteIndex + 1]);
        const baseZ = decodeNormalByte(normalTarget.data[byteIndex + 2]);
        const composed = blendReorientedNormal(
          baseX,
          baseY,
          baseZ,
          detailX,
          detailY,
          detailZ,
        );
        const alpha = (sourcePixel.a / 255) * layer.opacity;
        const outX = baseX + (composed.x - baseX) * alpha;
        const outY = baseY + (composed.y - baseY) * alpha;
        const outZ = baseZ + (composed.z - baseZ) * alpha;
        const length = Math.hypot(outX, outY, outZ) || 1;
        normalTarget.data[byteIndex] = encodeNormalByte(outX / length);
        normalTarget.data[byteIndex + 1] = encodeNormalByte(outY / length);
        normalTarget.data[byteIndex + 2] = encodeNormalByte(outZ / length);
      }
    }
  }

  private recomposeNormalTargetsForBase(baseTarget: PaintableTexture) {
    const normalTargets = this.normalTargetsByBaseTarget.get(baseTarget);
    if (!normalTargets?.size) return;

    for (const normalTarget of normalTargets) {
      normalTarget.data.set(normalTarget.originalData);
      for (const layer of this.paintLayers) {
        const decal = layer.kind === "decal" ? layer.decal : undefined;
        if (!decal || decal.target !== baseTarget || decal.normalTarget !== normalTarget) continue;
        this.applyDecalToNormalTarget(layer, decal, normalTarget);
      }
      normalTarget.revision += 1;
      normalTarget.editable.clearUpdateRanges();
      normalTarget.editable.needsUpdate = true;
    }
  }

  private recomposeAllNormalTargets() {
    for (const baseTarget of this.normalTargetsByBaseTarget.keys()) {
      this.recomposeNormalTargetsForBase(baseTarget);
    }
  }

  private hasAnyDataChanges(target: PaintableTexture) {
    if (target.data.length !== target.originalData.length) return true;
    for (let index = 0; index < target.data.length; index += 1) {
      if (target.data[index] !== target.originalData[index]) return true;
    }
    return false;
  }

  private recomposeTargetPixel(target: PaintableTexture, byteIndex: number) {
    const { tileKey, localByteIndex } = getLayerTileAddress(target, byteIndex);
    let r = target.originalData[byteIndex];
    let g = target.originalData[byteIndex + 1];
    let b = target.originalData[byteIndex + 2];

    for (const layer of this.paintLayers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const tile = layer.textures.get(target)?.tiles.get(tileKey);
      if (!tile) continue;
      const alpha = (tile.data[localByteIndex + 3] / 255) * layer.opacity;
      if (alpha <= 0) continue;
      r += (tile.data[localByteIndex] - r) * alpha;
      g += (tile.data[localByteIndex + 1] - g) * alpha;
      b += (tile.data[localByteIndex + 2] - b) * alpha;
    }

    target.data[byteIndex] = Math.round(r);
    target.data[byteIndex + 1] = Math.round(g);
    target.data[byteIndex + 2] = Math.round(b);
    target.data[byteIndex + 3] = target.originalData[byteIndex + 3];
  }

  private restoreTargetTileFromOriginal(target: PaintableTexture, tileKey: number) {
    const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
    const tileX = tileKey % tilesPerRow;
    const tileY = Math.floor(tileKey / tilesPerRow);
    const startX = tileX * LAYER_TILE_SIZE;
    const startY = tileY * LAYER_TILE_SIZE;
    const width = Math.min(LAYER_TILE_SIZE, target.width - startX);
    const height = Math.min(LAYER_TILE_SIZE, target.height - startY);
    if (width <= 0 || height <= 0) return;

    for (let localY = 0; localY < height; localY += 1) {
      const byteStart = ((startY + localY) * target.width + startX) * 4;
      const byteEnd = byteStart + width * 4;
      target.data.set(target.originalData.subarray(byteStart, byteEnd), byteStart);
      this.markTargetRangeDirty(target, byteStart, byteEnd);
    }
  }

  private pruneTouchedLayerTiles(targets: Iterable<PaintableTexture>) {
    for (const target of new Set(targets)) {
      for (const layer of this.paintLayers) {
        const texture = layer.textures.get(target);
        if (texture && texture.tiles.size === 0) layer.textures.delete(target);
      }

      for (const tileKey of [...target.touchedLayerTiles]) {
        const stillUsed = this.paintLayers.some((layer) =>
          layer.textures.get(target)?.tiles.has(tileKey),
        );
        if (stillUsed) continue;
        this.restoreTargetTileFromOriginal(target, tileKey);
        target.touchedLayerTiles.delete(tileKey);
      }
    }
  }

  private hasCompositeChanges(target: PaintableTexture) {
    if (target.data.length !== target.originalData.length) return true;
    if (target.touchedLayerTiles.size === 0) return false;

    const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
    for (const tileKey of target.touchedLayerTiles) {
      const tileX = tileKey % tilesPerRow;
      const tileY = Math.floor(tileKey / tilesPerRow);
      const startX = tileX * LAYER_TILE_SIZE;
      const startY = tileY * LAYER_TILE_SIZE;
      const width = Math.min(LAYER_TILE_SIZE, target.width - startX);
      const height = Math.min(LAYER_TILE_SIZE, target.height - startY);
      for (let localY = 0; localY < height; localY += 1) {
        let byteIndex = ((startY + localY) * target.width + startX) * 4;
        const end = byteIndex + width * 4;
        for (; byteIndex < end; byteIndex += 1) {
          if (target.data[byteIndex] !== target.originalData[byteIndex]) return true;
        }
      }
    }
    return false;
  }

  private recordStrokeGpuUpdateRange(count: number) {
    if (!this.currentStrokeLayerId || count <= 0) return;
    this.currentStrokeGpuProfile.updateRanges += 1;
    this.currentStrokeGpuProfile.updateBytes += count;
  }

  private markTargetRowSpansDirty(target: PaintableTexture, dirtyRows: Map<number, DirtyRowSpan>) {
    if (dirtyRows.size === 0) return;
    if (!target.fullUploadPending) {
      for (const [row, span] of [...dirtyRows.entries()].sort((a, b) => a[0] - b[0])) {
        const start = (row * target.width + span.minX) * 4;
        const count = (span.maxX - span.minX + 1) * 4;
        target.editable.addUpdateRange(start, count);
        this.recordStrokeGpuUpdateRange(count);
      }
    }
    target.revision += 1;
    target.editable.needsUpdate = true;
  }

  private markTargetRangeDirty(target: PaintableTexture, start: number, endExclusive: number) {
    if (!Number.isFinite(start) || endExclusive <= start) return;
    // Three r186 uploads every DataTexture update range as one texSubImage2D row.
    // Never submit a range that crosses a row boundary: WebGL would interpret its
    // total component count as the width of a single-row upload.
    if (!target.fullUploadPending) {
      const rowBytes = target.width * 4;
      let cursor = start;
      while (cursor < endExclusive) {
        const rowEnd = (Math.floor(cursor / rowBytes) + 1) * rowBytes;
        const rangeEnd = Math.min(endExclusive, rowEnd);
        const count = rangeEnd - cursor;
        target.editable.addUpdateRange(cursor, count);
        this.recordStrokeGpuUpdateRange(count);
        cursor = rangeEnd;
      }
    }
    target.revision += 1;
    target.editable.needsUpdate = true;
  }

  private getTouchedTileUpdateRanges(target: Pick<PaintableTexture, "width" | "height" | "touchedLayerTiles">) {
    const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
    const tileRows = new Map<number, number[]>();

    for (const tileKey of target.touchedLayerTiles) {
      const tileX = tileKey % tilesPerRow;
      const tileY = Math.floor(tileKey / tilesPerRow);
      if (
        tileX < 0
        || tileX >= tilesPerRow
        || tileY < 0
        || tileY * LAYER_TILE_SIZE >= target.height
      ) {
        continue;
      }
      const row = tileRows.get(tileY);
      if (row) row.push(tileX);
      else tileRows.set(tileY, [tileX]);
    }

    const ranges: Array<{ start: number; count: number }> = [];

    for (const [tileY, rawTileXs] of [...tileRows.entries()].sort((a, b) => a[0] - b[0])) {
      const tileXs = [...new Set(rawTileXs)].sort((a, b) => a - b);
      const spans: Array<{ startX: number; endX: number }> = [];
      for (const tileX of tileXs) {
        const startX = tileX * LAYER_TILE_SIZE;
        const endX = Math.min(target.width, startX + LAYER_TILE_SIZE);
        const previous = spans[spans.length - 1];
        if (previous && previous.endX === startX) previous.endX = endX;
        else spans.push({ startX, endX });
      }

      const startY = tileY * LAYER_TILE_SIZE;
      const height = Math.min(LAYER_TILE_SIZE, target.height - startY);
      for (let localY = 0; localY < height; localY += 1) {
        const y = startY + localY;
        for (const span of spans) {
          ranges.push({
            start: (y * target.width + span.startX) * 4,
            count: (span.endX - span.startX) * 4,
          });
        }
      }
    }

    return ranges;
  }

  private markTouchedTilesDirty(target: PaintableTexture) {
    if (target.touchedLayerTiles.size === 0) return;
    // A complete recomposition supersedes any pending partial paint ranges because
    // every previously edited pixel lives inside one of these touched tiles.
    if (!target.fullUploadPending) {
      target.editable.clearUpdateRanges();
      for (const range of this.getTouchedTileUpdateRanges(target)) {
        target.editable.addUpdateRange(range.start, range.count);
        this.recordStrokeGpuUpdateRange(range.count);
      }
    }
    target.revision += 1;
    target.editable.needsUpdate = true;
  }

  private recomposeTarget(target: PaintableTexture) {
    if (target.touchedLayerTiles.size === 0) return;
    const tilesPerRow = Math.ceil(target.width / LAYER_TILE_SIZE);
    for (const tileKey of target.touchedLayerTiles) {
      const tileX = tileKey % tilesPerRow;
      const tileY = Math.floor(tileKey / tilesPerRow);
      const startX = tileX * LAYER_TILE_SIZE;
      const startY = tileY * LAYER_TILE_SIZE;
      const width = Math.min(LAYER_TILE_SIZE, target.width - startX);
      const height = Math.min(LAYER_TILE_SIZE, target.height - startY);
      for (let localY = 0; localY < height; localY += 1) {
        for (let localX = 0; localX < width; localX += 1) {
          const byteIndex = ((startY + localY) * target.width + startX + localX) * 4;
          this.recomposeTargetPixel(target, byteIndex);
        }
      }
    }
    this.markTouchedTilesDirty(target);
  }

  private recomposeTargets(targets: Iterable<PaintableTexture>) {
    const unique = new Set(targets);
    for (const target of unique) this.recomposeTarget(target);
  }

  private recomposeAllTargets() {
    this.recomposeTargets(this.targetsByEditableTexture.values());
  }

}

export const createUnitPainterSession = (root: THREE.Object3D) => new UnitPainterSession(root);
