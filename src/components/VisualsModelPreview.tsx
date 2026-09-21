import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Wh3Ktx2Loader } from "../visuals/Wh3Ktx2Loader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IoPause, IoPlay, IoRefresh } from "react-icons/io5";
import { useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import {
  exportUnitPainterTextures,
  openUnitPainterProject,
  exportVisualsModel,
  exportVisualsModelBatch,
  getVisualsModelAnimationCatalog,
  releaseVisualsModelPreview,
  reportVisualsModelPreviewTiming,
  type UnitPainterProjectOpenResult,
} from "../visuals/modelPreviewApi";
import { filterVisualsModelPreviewWarnings } from "../visuals/modelPreviewWarnings";
import UnitPainterTextureEditor from "./UnitPainterTextureEditor";
import { selectDefaultAnimation } from "../visuals/animationSelection";
import { getActiveVariantMeshSlots, type VariantMeshCatalog, type VariantMeshSelection } from "../visuals/variantMesh";
import {
  createUnitPainterSession,
  getUnitPainterBrushSpacing,
  mirrorRayAcrossObjectLocalX,
  sampleUnitPainterStrokeSegment,
  type UnitPainterBrushMode,
  type UnitPainterLayerInfo,
  type UnitPainterSelectionInfo,
  type UnitPainterSelectionScope,
  type UnitPainterSelectionSplitKind,
  type UnitPainterSurfaceHighlight,
  type UnitPainterTextureHover,
} from "../visuals/unitPainter";

type PainterStrokeRuntimeProfile = {
  startedAt: number;
  pointerEvents: number;
  normalRaycasts: number;
  normalRaycastMs: number;
  symmetryRaycasts: number;
  symmetryRaycastMs: number;
  paintBatches: number;
  primaryStamps: number;
  mirroredStamps: number;
  paintCpuMs: number;
  renderFrames: number;
  renderCpuMs: number;
  maxRenderCpuMs: number;
  bvhRefitPasses: number;
  bvhRefits: number;
  bvhRefitMs: number;
  maxBvhRefitMs: number;
};

type VisualsModelPreviewProps = {
  assetPath: string;
  /** False while the owning main-window tab is kept mounted but hidden. */
  isActive?: boolean;
  /** Whether to show the ground wireframe beneath the model. */
  showWireframe?: boolean;
  /** Whether comparison models should start at independent points in the selected animation cycle. */
  unsyncedAnimations?: boolean;
  /** Session used to inspect VMD slots and select appearances. */
  variantMeshSessionId?: string;
  variantMeshSessionType?: "unitViewer" | "visuals";
  /** Enables the experimental direct-on-model base-colour painter. */
  enablePainting?: boolean;
};

type ThreePreviewContext = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ktx2Loader: Wh3Ktx2Loader;
  controls: OrbitControls;
  grid: THREE.GridHelper;
  mixers: THREE.AnimationMixer[];
  actions: THREE.AnimationAction[];
  isPlaying: boolean;
  afterNextRender: ((timing: { renderMs: number; completedAt: number }) => void) | null;
};

type CameraView = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};

type PreviewAnimation = {
  path: string;
  label: string;
};

type UnitPainterSelectMode = "material" | "island" | "similar";

const NONE_ANIMATION: PreviewAnimation = { path: "", label: "None" };
const ALL_VARIANTS = -1;
const MAX_COMPARISON_MODELS = 100;
const ALT_ORBIT_DRAG_THRESHOLD_PX = 4;
const PAINT_COLOR_HISTORY_LIMIT = 64;
const DEFAULT_PAINT_COLOR = "#c43030";
const PREVIEW_GEOMETRY_KEY = "__wh3PreviewGeometryKey";

const adjustRangeFromWheel = (
  event: React.WheelEvent<HTMLInputElement>,
  setValue: (value: number) => void,
) => {
  if (event.currentTarget.disabled || event.deltaY === 0) return;
  // React/Chromium may attach wheel listeners as passive, so preventDefault()
  // emits a console warning. Stopping propagation is enough to keep the wheel
  // from reaching the model/texture zoom handlers.
  event.stopPropagation();

  const input = event.currentTarget;
  const min = input.min === "" ? Number.NEGATIVE_INFINITY : Number(input.min);
  const max = input.max === "" ? Number.POSITIVE_INFINITY : Number(input.max);
  const step = input.step === "" || input.step === "any" ? 1 : Number(input.step);
  if (!Number.isFinite(step) || step <= 0) return;

  const current = Number(input.value);
  if (!Number.isFinite(current)) return;
  const direction = event.deltaY < 0 ? 1 : -1;
  const decimals = input.step.includes(".") ? input.step.split(".")[1].length : 0;
  const next = Math.max(min, Math.min(max, current + direction * step));
  setValue(Number(next.toFixed(decimals)));
};

type PreviewResourcePool = {
  geometries: Map<string, THREE.BufferGeometry>;
  textures: Map<string, THREE.Texture>;
  preloadedTextures: Set<THREE.Texture>;
};

type PreviewResourceSession = {
  key: string;
  pool: PreviewResourcePool;
};

const createPreviewResourcePool = (): PreviewResourcePool => ({
  geometries: new Map(),
  textures: new Map(),
  preloadedTextures: new Set(),
});

const disposePreviewResourcePool = (pool: PreviewResourcePool) => {
  for (const geometry of new Set(pool.geometries.values())) geometry.dispose();
  for (const texture of new Set(pool.textures.values())) texture.dispose();
  pool.geometries.clear();
  pool.textures.clear();
  pool.preloadedTextures.clear();
};

type ComparisonVariant = {
  rowIndex: number;
  columnIndex: number;
  layerIndex: number;
  selections: VariantMeshSelection[];
};

const disposeMaterial = (material: THREE.Material) => {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
};

const disposeObject = (object: THREE.Object3D, preservedPool?: PreviewResourcePool) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  const preservedGeometries = preservedPool ? new Set(preservedPool.geometries.values()) : undefined;
  const preservedTextures = preservedPool ? new Set(preservedPool.textures.values()) : undefined;
  for (const geometry of geometries) {
    if (!preservedGeometries?.has(geometry)) geometry.dispose();
  }
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    if (!preservedTextures?.has(texture)) texture.dispose();
  }
};

const disposePainterSurfaceOverlay = (overlay: THREE.Mesh | null) => {
  if (!overlay) return;
  overlay.parent?.remove(overlay);

  // The overlay intentionally shares the source mesh's vertex attributes so only
  // the selected triangle index buffer is allocated. Detach shared attributes
  // before dispose so Three does not release the source geometry's GPU buffers.
  for (const attributeName of Object.keys(overlay.geometry.attributes)) {
    overlay.geometry.deleteAttribute(attributeName);
  }
  overlay.geometry.morphAttributes = {};
  overlay.geometry.dispose();

  const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
  for (const material of materials) material.dispose();
};

const createPainterSurfaceOverlay = (
  surface: UnitPainterSurfaceHighlight,
  opacity: number,
) => {
  const source = surface.object;
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.morphAttributes = source.geometry.morphAttributes;
  geometry.morphTargetsRelative = source.geometry.morphTargetsRelative;
  geometry.setIndex(surface.indices);

  const material = new THREE.MeshBasicMaterial({
    color: surface.scope === "island" ? 0xa78bfa : 0x22d3ee,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.toneMapped = false;

  let overlay: THREE.Mesh;
  if (source instanceof THREE.SkinnedMesh) {
    const skinned = new THREE.SkinnedMesh(geometry, material);
    skinned.skeleton = source.skeleton;
    skinned.bindMode = source.bindMode;
    skinned.bindMatrix.copy(source.bindMatrix);
    skinned.bindMatrixInverse.copy(source.bindMatrixInverse);
    skinned.morphTargetDictionary = source.morphTargetDictionary;
    skinned.morphTargetInfluences = source.morphTargetInfluences;
    overlay = skinned;
  } else {
    overlay = new THREE.Mesh(geometry, material);
    overlay.morphTargetDictionary = source.morphTargetDictionary;
    overlay.morphTargetInfluences = source.morphTargetInfluences;
  }

  overlay.name = "__whmm_unit_painter_surface_highlight";
  overlay.frustumCulled = false;
  overlay.renderOrder = 2000;
  overlay.raycast = () => undefined;
  source.add(overlay);
  return overlay;
};

const hashGeometry = (geometry: THREE.BufferGeometry) => {
  const cached = geometry.userData[PREVIEW_GEOMETRY_KEY];
  if (typeof cached === "string") return cached;

  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let totalBytes = 0;
  const hashArray = (array: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    totalBytes += bytes.byteLength;
    for (let index = 0; index < bytes.length; index += 1) {
      const value = bytes[index];
      first = Math.imul(first ^ value, 0x01000193);
      second = Math.imul(second ^ (value + index), 0x85ebca6b);
      second = (second << 13) | (second >>> 19);
    }
  };

  const attributeMetadata: string[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes).sort(([firstName], [secondName]) =>
    firstName.localeCompare(secondName),
  )) {
    attributeMetadata.push(`${name}:${attribute.itemSize}:${attribute.count}:${attribute.normalized ? 1 : 0}`);
    const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
    hashArray(array);
  }
  if (geometry.index) {
    attributeMetadata.push(`index:${geometry.index.itemSize}:${geometry.index.count}`);
    hashArray(geometry.index.array);
  }

  const key = `${totalBytes}:${first >>> 0}:${second >>> 0}:${attributeMetadata.join("|")}`;
  geometry.userData[PREVIEW_GEOMETRY_KEY] = key;
  return key;
};

const texturePoolKey = (texture: THREE.Texture) => {
  const rawKey = texture.userData.wh3RawKtx2CacheKey;
  if (typeof rawKey !== "string") return undefined;
  const sourceVirtualPath =
    typeof texture.userData.wh3SourceVirtualPath === "string"
      ? texture.userData.wh3SourceVirtualPath.toLowerCase()
      : "";
  return [
    rawKey,
    sourceVirtualPath,
    texture.wrapS,
    texture.wrapT,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.mapping,
    texture.channel,
    texture.offset.x,
    texture.offset.y,
    texture.repeat.x,
    texture.repeat.y,
    texture.center.x,
    texture.center.y,
    texture.rotation,
    texture.flipY ? 1 : 0,
    texture.colorSpace,
  ].join("|");
};

const internObjectResources = (object: THREE.Object3D, pool: PreviewResourcePool) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.geometry) {
      const key = hashGeometry(child.geometry);
      const shared = pool.geometries.get(key);
      if (shared && shared !== child.geometry) {
        child.geometry.dispose();
        child.geometry = shared;
      } else {
        pool.geometries.set(key, child.geometry);
      }
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      const values = material as unknown as Record<string, unknown>;
      for (const [propertyName, value] of Object.entries(values)) {
        if (!(value instanceof THREE.Texture)) continue;
        const key = texturePoolKey(value);
        if (!key) continue;
        const shared = pool.textures.get(key);
        if (shared && shared !== value) {
          values[propertyName] = shared;
          value.dispose();
        } else {
          pool.textures.set(key, value);
        }
      }
    }
  });
};

const getComparisonActiveVariantMeshSlots = (
  catalog: VariantMeshCatalog,
  selections: Readonly<Record<string, number>>,
) => {
  const slotsByPath = new Map(catalog.slots.map((slot) => [slot.slotPath, slot]));
  const activeCache = new Map<string, boolean>();
  const isActive = (slot: VariantMeshCatalog["slots"][number]): boolean => {
    const cached = activeCache.get(slot.slotPath);
    if (cached !== undefined) return cached;
    const parent = slot.parent;
    const parentSlot = parent ? slotsByPath.get(parent.slotPath) : undefined;
    const parentSelection = parentSlot
      ? selections[parentSlot.slotPath] ?? parentSlot.defaultChoiceIndex
      : undefined;
    const active =
      !parent ||
      (!!parentSlot &&
        isActive(parentSlot) &&
        (parentSelection === ALL_VARIANTS || parentSelection === parent.choiceIndex));
    activeCache.set(slot.slotPath, active);
    return active;
  };
  return catalog.slots.filter(isActive);
};

const layoutComparisonModels = (
  models: readonly THREE.Object3D[],
  columnCount: number,
  rowCount: number,
  layerCount: number,
) => {
  if (models.length === 0) return;
  const bounds = models.map((model) => new THREE.Box3().setFromObject(model));
  const sizes = bounds.map((box) => box.getSize(new THREE.Vector3()));
  const maxWidth = Math.max(...sizes.map((size) => size.x), 0.25);
  const maxHeight = Math.max(...sizes.map((size) => size.y), 0.25);
  const maxDepth = Math.max(...sizes.map((size) => size.z), 0.25);
  const columnSpacing = maxWidth * 1.35;
  const rowSpacing = maxDepth * 1.75;
  const layerSpacing = maxHeight * 1.5;
  const xOrigin = ((columnCount - 1) * columnSpacing) / 2;
  const yOrigin = ((layerCount - 1) * layerSpacing) / 2;
  const zOrigin = ((rowCount - 1) * rowSpacing) / 2;
  const modelsPerLayer = columnCount * rowCount;

  models.forEach((model, index) => {
    const layerIndex = Math.floor(index / modelsPerLayer);
    const indexWithinLayer = index % modelsPerLayer;
    const rowIndex = Math.floor(indexWithinLayer / columnCount);
    const columnIndex = indexWithinLayer % columnCount;
    const box = bounds[index];
    const center = box.getCenter(new THREE.Vector3());
    model.position.x += columnIndex * columnSpacing - xOrigin - center.x;
    model.position.y += layerIndex * layerSpacing - yOrigin - center.y;
    model.position.z += rowIndex * rowSpacing - zOrigin - center.z;
  });
};

const disposeGrid = (grid: THREE.GridHelper) => {
  grid.geometry.dispose();
  if (Array.isArray(grid.material)) grid.material.forEach(disposeMaterial);
  else disposeMaterial(grid.material);
};

const preloadObjectTextures = (
  context: ThreePreviewContext,
  object: THREE.Object3D,
  pool: PreviewResourcePool,
) => {
  const textures = new Set<THREE.Texture>();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  for (const texture of textures) {
    if (pool.preloadedTextures.has(texture)) continue;
    context.ktx2Loader.preloadTexture(texture);
    pool.preloadedTextures.add(texture);
  }
};

const frameObject = (context: ThreePreviewContext, object: THREE.Object3D) => {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
  const halfFovRadians = THREE.MathUtils.degToRad(context.camera.fov * 0.5);
  const distance = ((maxDimension * 0.5) / Math.tan(halfFovRadians)) * 1.45;
  const direction = new THREE.Vector3(1, 0.55, 1).normalize();

  context.camera.position.copy(center).addScaledVector(direction, distance);
  context.camera.near = Math.max(distance / 1000, 0.001);
  context.camera.far = Math.max(distance * 100, maxDimension * 100);
  context.camera.updateProjectionMatrix();

  context.controls.target.copy(center);
  context.controls.minDistance = Math.max(maxDimension * 0.05, 0.01);
  context.controls.maxDistance = Math.max(maxDimension * 20, distance * 5);
  context.controls.update();

  const gridBaseSize = 10;
  context.grid.scale.setScalar(Math.max(maxDimension * 2, 1) / gridBaseSize);
  context.grid.position.set(center.x, box.min.y, center.z);
};

const captureCameraView = (context: ThreePreviewContext): CameraView => ({
  position: context.camera.position.clone(),
  target: context.controls.target.clone(),
});

const restoreCameraView = (context: ThreePreviewContext, view: CameraView) => {
  context.camera.position.copy(view.position);
  context.controls.target.copy(view.target);
  context.controls.update();
};

const getAnimationLabel = (path: string) => {
  const fileName = path.split(/[\\/]/).pop() || path;
  return fileName.replace(/\.anim$/i, "").replace(/[_-]+/g, " ");
};

const formatAnimationTime = (seconds: number) => {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
};

const ANIMATION_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const VisualsModelPreview = memo((props: VisualsModelPreviewProps) => {
  const {
    assetPath,
    isActive = true,
    showWireframe = true,
    unsyncedAnimations = true,
    variantMeshSessionId,
    variantMeshSessionType = "unitViewer",
    enablePainting = false,
  } = props;
  const localized = useLocalizations();
  const currentPresetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const enabledMods = useMemo(
    () =>
      currentPresetMods.filter((mod) => mod.isEnabled).map(({ name, path, loadOrder }) => ({ name, path, loadOrder })),
    [currentPresetMods],
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<ThreePreviewContext | null>(null);
  const previewResourceSessionRef = useRef<PreviewResourceSession | null>(null);
  const paintRootRef = useRef<THREE.Object3D | null>(null);
  const paintSessionRef = useRef<ReturnType<typeof createUnitPainterSession> | null>(null);
  const paintSelectionHelperRef = useRef<THREE.Mesh[]>([]);
  const paintHoverHelperRef = useRef<THREE.Mesh | null>(null);
  const paintHoverKeyRef = useRef("");
  const textureLinkedHoverSinkRef = useRef<((hover?: UnitPainterTextureHover) => void)>();
  const textureToModelHoverRef = useRef<
    (hover?: { textureId: string; x: number; y: number }) => void
  >();
  const painterEnabledRef = useRef(false);
  const paintViewModeRef = useRef<"model" | "split" | "texture">("model");
  const eyedropperActiveRef = useRef(false);
  const selectToolModeRef = useRef<UnitPainterSelectMode>();
  const similarToleranceRef = useRef(8);
  const symmetryEnabledRef = useRef(false);
  const paintScopeRef = useRef<UnitPainterSelectionScope>("all");
  const brushSettingsRef = useRef({
    radiusPx: 24,
    opacity: 0.9,
    hardness: 0.8,
    mode: "recolor" as UnitPainterBrushMode,
    color: { r: 196, g: 48, b: 48 },
  });
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const brushHardnessCursorRef = useRef<HTMLDivElement>(null);
  const altEyedropperHeldRef = useRef(false);
  const lastPaintBrushModeRef = useRef<Exclude<UnitPainterBrushMode, "restore">>("recolor");
  const showWireframeRef = useRef(showWireframe);
  showWireframeRef.current = showWireframe;
  const [status, setStatus] = useState<"exporting" | "loading" | "ready" | "error">("exporting");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [animationOptions, setAnimationOptions] = useState<PreviewAnimation[]>([]);
  const [selectedAnimationPath, setSelectedAnimationPath] = useState("");
  const [animationCatalogReady, setAnimationCatalogReady] = useState(false);
  const [catalogDiagnostics, setCatalogDiagnostics] = useState<string[]>([]);
  const [variantCatalog, setVariantCatalog] = useState<VariantMeshCatalog>();
  const [variantCatalogReady, setVariantCatalogReady] = useState(!variantMeshSessionId);
  const [variantCatalogDiagnostics, setVariantCatalogDiagnostics] = useState<string[]>([]);
  const [variantSelections, setVariantSelections] = useState<Record<string, number>>({});
  const [clipDuration, setClipDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [isPainterEnabled, setIsPainterEnabled] = useState(false);
  const [paintViewMode, setPaintViewMode] = useState<"model" | "split" | "texture">("model");
  const [paintTextureViewId, setPaintTextureViewId] = useState<string>();
  const [paintTexturePadding, setPaintTexturePadding] = useState(0);
  const [paintColor, setPaintColor] = useState(DEFAULT_PAINT_COLOR);
  const [paintColorHistory, setPaintColorHistory] = useState<string[]>([]);
  const [isPaintColorHistoryOpen, setIsPaintColorHistoryOpen] = useState(false);
  const [paintBrushRadius, setPaintBrushRadius] = useState(24);
  const [paintBrushOpacity, setPaintBrushOpacity] = useState(0.9);
  const [paintBrushHardness, setPaintBrushHardness] = useState(0.8);
  const [paintBrushMode, setPaintBrushMode] = useState<UnitPainterBrushMode>("recolor");
  const [isPaintEyedropperActive, setIsPaintEyedropperActive] = useState(false);
  const [paintSelectMode, setPaintSelectMode] = useState<UnitPainterSelectMode>();
  const [paintSimilarTolerance, setPaintSimilarTolerance] = useState(8);
  const [isPaintSymmetryEnabled, setIsPaintSymmetryEnabled] = useState(false);
  const [paintScope, setPaintScope] = useState<UnitPainterSelectionScope>("all");
  const [paintSelection, setPaintSelection] = useState<UnitPainterSelectionInfo>();
  const [paintTextureCount, setPaintTextureCount] = useState(-1);
  const [paintExportStatus, setPaintExportStatus] = useState("");
  const [paintPackPath, setPaintPackPath] = useState<string>();
  const [paintExcludedPackPaths, setPaintExcludedPackPaths] = useState<string[]>([]);
  const [isPaintExporting, setIsPaintExporting] = useState(false);
  const [isPaintProjectOpening, setIsPaintProjectOpening] = useState(false);
  const [paintProjectReloadVersion, setPaintProjectReloadVersion] = useState(0);
  const [paintHistoryVersion, setPaintHistoryVersion] = useState(0);
  const [isPaintLayersOpen, setIsPaintLayersOpen] = useState(false);
  const pendingPaintProjectRef = useRef<UnitPainterProjectOpenResult | null>(null);
  const effectiveEnabledMods = useMemo(() => {
    if (paintExcludedPackPaths.length === 0) return enabledMods;
    const excluded = new Set(paintExcludedPackPaths.map((path) => path.replace(/\//g, "\\").toLowerCase()));
    return enabledMods.filter((mod) => !excluded.has(mod.path.replace(/\//g, "\\").toLowerCase()));
  }, [enabledMods, paintExcludedPackPaths]);
  const catalogLoadingRef = useRef(true);
  const isPlayingRef = useRef(true);
  const animationSpeedRef = useRef(1);
  const pendingCameraViewRef = useRef<{ assetPath: string; view: CameraView } | null>(null);
  const loadedAnimationCatalogKeyRef = useRef<string>();
  const loadedVariantCatalogKeyRef = useRef<string>();
  const animationCatalogKey = useMemo(
    () => JSON.stringify([assetPath, effectiveEnabledMods]),
    [assetPath, effectiveEnabledMods],
  );
  const variantCatalogKey = `${variantMeshSessionType}\0${variantMeshSessionId ?? ""}\0${assetPath}`;
  const visibleWarnings = filterVisualsModelPreviewWarnings(warnings, isFeaturesForModdersEnabled);
  const paintColorValue = Number.parseInt(paintColor.slice(1), 16);
  const paintHasUnsavedChanges = paintSessionRef.current?.hasUnsavedChanges ?? false;
  const paintLayers: UnitPainterLayerInfo[] = paintSessionRef.current?.layers ?? [];
  const paintActiveLayerId = paintSessionRef.current?.activeLayerId ?? "";
  const paintActiveLayer = paintLayers.find((layer) => layer.id === paintActiveLayerId);
  const paintActiveLayerIndex = paintLayers.findIndex((layer) => layer.id === paintActiveLayerId);
  const paintRecentColors = paintColorHistory.slice(0, 8);
  void paintHistoryVersion;
  if (paintBrushMode !== "restore") lastPaintBrushModeRef.current = paintBrushMode;

  const rememberUsedPaintColor = (color: string) => {
    const normalized = color.toLowerCase();
    setPaintColorHistory((current) => [
      normalized,
      ...current.filter((value) => value !== normalized),
    ].slice(0, PAINT_COLOR_HISTORY_LIMIT));
  };

  const choosePaintColor = (color: string) => {
    setPaintColor(color.toLowerCase());
  };

  painterEnabledRef.current = enablePainting && isPainterEnabled && status === "ready";
  paintViewModeRef.current = paintViewMode;
  eyedropperActiveRef.current = isPaintEyedropperActive;
  selectToolModeRef.current = paintSelectMode;
  similarToleranceRef.current = paintSimilarTolerance;
  symmetryEnabledRef.current = paintViewMode !== "texture" && isPaintSymmetryEnabled;
  paintScopeRef.current = paintScope;
  brushSettingsRef.current = {
    radiusPx: paintBrushRadius,
    opacity: paintBrushOpacity,
    hardness: paintBrushHardness,
    mode: paintBrushMode,
    color: {
      r: (paintColorValue >> 16) & 0xff,
      g: (paintColorValue >> 8) & 0xff,
      b: paintColorValue & 0xff,
    },
  };

  const clearPaintSelectionVisual = () => {
    for (const overlay of paintSelectionHelperRef.current) disposePainterSurfaceOverlay(overlay);
    paintSelectionHelperRef.current = [];
  };

  const clearPaintHoverVisual = () => {
    disposePainterSurfaceOverlay(paintHoverHelperRef.current);
    paintHoverHelperRef.current = null;
    paintHoverKeyRef.current = "";
  };

  const showPaintHoverSurface = (surface: UnitPainterSurfaceHighlight | undefined) => {
    if (!surface) {
      clearPaintHoverVisual();
      return;
    }
    if (paintHoverKeyRef.current === surface.key && paintHoverHelperRef.current) return;
    clearPaintHoverVisual();
    paintHoverHelperRef.current = createPainterSurfaceOverlay(surface, 0.16);
    paintHoverKeyRef.current = surface.key;
  };

  const refreshPaintSelectionVisual = (scope: UnitPainterSelectionScope = paintScopeRef.current) => {
    clearPaintSelectionVisual();
    if (scope === "all" || scope === "similar") return;
    for (const surface of paintSessionRef.current?.getSelectionSurfaceHighlights(scope) ?? []) {
      paintSelectionHelperRef.current.push(createPainterSurfaceOverlay(surface, 0.34));
    }
  };

  const updatePaintHoverVisual = (intersection?: THREE.Intersection<THREE.Object3D>) => {
    const selectMode = selectToolModeRef.current;
    if (!selectMode || selectMode === "similar" || !intersection) {
      clearPaintHoverVisual();
      return;
    }
    showPaintHoverSurface(
      paintSessionRef.current?.getIntersectionSurfaceHighlight(intersection, selectMode),
    );
  };

  textureToModelHoverRef.current = (hover) => {
    if (!hover) {
      clearPaintHoverVisual();
      return;
    }
    const session = paintSessionRef.current;
    if (!session) {
      clearPaintHoverVisual();
      return;
    }
    const hoverScope =
      selectToolModeRef.current
      ?? (paintScopeRef.current === "all" ? "island" : paintScopeRef.current);
    if (hoverScope === "similar") {
      clearPaintHoverVisual();
      return;
    }
    showPaintHoverSurface(
      session.getTexturePointSurfaceHighlight(
        hover.textureId,
        hover.x,
        hover.y,
        hoverScope,
      ),
    );
  };

  const clearPaintSelection = () => {
    paintSessionRef.current?.clearSelection();
    clearPaintSelectionVisual();
    clearPaintHoverVisual();
    setPaintSelection(undefined);
    setPaintScope("all");
    paintScopeRef.current = "all";
    selectToolModeRef.current = undefined;
    setPaintSelectMode(undefined);
  };

  const selectPaintIntersection = (
    intersection: THREE.Intersection<THREE.Object3D>,
    operation: "replace" | "add" | "toggle" = "replace",
  ) => {
    const session = paintSessionRef.current;
    const selectMode = selectToolModeRef.current;
    if (!session || !selectMode) return false;

    let clicked = false;
    if (selectMode === "similar") {
      clicked = session.selectSimilarIntersection(
        intersection,
        similarToleranceRef.current,
        operation,
      );
    } else {
      // Never fall back from Select Island to the whole material. If the hit has no
      // resolvable UV island, leave the current selection untouched.
      const surface = session.getIntersectionSurfaceHighlight(intersection, selectMode);
      if (!surface) return false;
      clicked = !!session.selectIntersection(intersection, selectMode, operation);
    }
    if (!clicked) return false;

    clearPaintHoverVisual();
    const selection = session.selectionInfo;
    setPaintSelection(selection);
    if (selection) {
      setPaintTextureViewId(selection.textureId);
      setPaintScope(selectMode);
      paintScopeRef.current = selectMode;
    } else {
      setPaintScope("all");
      paintScopeRef.current = "all";
    }
    refreshPaintSelectionVisual(selection ? selectMode : "all");
    setPaintHistoryVersion((value) => value + 1);
    return true;
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    // Imported game meshes often contain thin/double-sided surfaces. With no ground receiver in
    // this preview, shadow maps only add self-shadow artifacts that are not present in-game.
    renderer.domElement.className = "block h-full w-full";
    mount.appendChild(renderer.domElement);

    // WH3AssetHost uses a low-latency raw RGBA + Zstd KTX2 flavor for
    // previews. The compatibility loader handles that format directly and
    // delegates standards-compliant Basis/UASTC KTX2 to Three's KTX2Loader.
    const ktx2Loader = new Wh3Ktx2Loader(renderer);
    ktx2Loader.detectSupport(renderer);

    const clearHostSessionCache = () => {
      const resourceSession = previewResourceSessionRef.current;
      if (resourceSession) {
        disposePreviewResourcePool(resourceSession.pool);
        previewResourceSessionRef.current = null;
      }
      ktx2Loader.clearRawTextureDataCache();
    };
    const removeHostResetListener = window.api?.onWh3AssetHostReset?.(clearHostSessionCache);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x334155, 2.2);
    scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbfd7ff, 1.4);
    fillLight.position.set(-4, 3, -2);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(10, 20, 0x4b5563, 0x273244);
    grid.visible = showWireframeRef.current;
    scene.add(grid);

    const context: ThreePreviewContext = {
      scene,
      camera,
      renderer,
      ktx2Loader,
      controls,
      grid,
      mixers: [],
      actions: [],
      isPlaying: true,
      afterNextRender: null,
    };
    contextRef.current = context;

    const raycaster = new THREE.Raycaster();
    const symmetryRaycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    symmetryRaycaster.firstHitOnly = true;
    const symmetryCamera = new THREE.PerspectiveCamera();
    const mirroredRay = new THREE.Ray();
    const pointer = new THREE.Vector2();
    const lastPaintPoint = new THREE.Vector2();
    const altOrbitStart = new THREE.Vector2();
    const altOrbitLast = new THREE.Vector2();
    const orbitOffset = new THREE.Vector3();
    const orbitSpherical = new THREE.Spherical();
    let hasLastPaintPoint = false;
    let lastPaintIntersection: THREE.Intersection<THREE.Object3D> | undefined;
    let lastMirroredPaintIntersection: THREE.Intersection<THREE.Object3D> | undefined;
    let distanceSinceLastPaintStamp = 0;
    let isPainting = false;
    let activePointerId: number | undefined;
    let activeStrokeColor = "";
    let activeStrokeMode: UnitPainterBrushMode | undefined;
    let activeStrokeProfile: PainterStrokeRuntimeProfile | undefined;
    let altOrbitPointerId: number | undefined;
    let isAltOrbiting = false;

    const updateBrushCursor = (event: PointerEvent, visible = true) => {
      const cursor = brushCursorRef.current;
      const hardnessCursor = brushHardnessCursorRef.current;
      if (!cursor) return;
      if (!visible || !painterEnabledRef.current) {
        cursor.style.display = "none";
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const eyedropperActive = event.altKey || altEyedropperHeldRef.current || eyedropperActiveRef.current;
      const selectMode = selectToolModeRef.current;
      const precisionToolActive = eyedropperActive || !!selectMode;
      const radius = precisionToolActive ? 5 : brushSettingsRef.current.radiusPx;
      const cursorColor = eyedropperActive
        ? "#67e8f9"
        : selectMode === "island"
          ? "#a78bfa"
          : selectMode === "material"
            ? "#22d3ee"
            : brushSettingsRef.current.mode === "restore"
              ? "#f59e0b"
              : "rgba(255,255,255,0.9)";

      cursor.style.display = "block";
      cursor.style.width = `${radius * 2}px`;
      cursor.style.height = `${radius * 2}px`;
      cursor.style.borderColor = cursorColor;
      cursor.style.transform = `translate(${event.clientX - rect.left - radius}px, ${
        event.clientY - rect.top - radius
      }px)`;

      if (hardnessCursor) {
        const hardness = Math.max(0, Math.min(1, brushSettingsRef.current.hardness));
        if (precisionToolActive || hardness <= 0.01 || hardness >= 0.99) {
          hardnessCursor.style.display = "none";
        } else {
          hardnessCursor.style.display = "block";
          hardnessCursor.style.width = `${radius * hardness * 2}px`;
          hardnessCursor.style.height = `${radius * hardness * 2}px`;
          hardnessCursor.style.borderColor = cursorColor;
        }
      }
    };

    const profilePaintCall = (stamps: number, mirrored: boolean, paint: () => void) => {
      const startedAt = performance.now();
      paint();
      const profile = activeStrokeProfile;
      if (!profile) return;
      profile.paintCpuMs += performance.now() - startedAt;
      profile.paintBatches += 1;
      if (mirrored) profile.mirroredStamps += stamps;
      else profile.primaryStamps += stamps;
    };

    const getPaintIntersection = (clientX: number, clientY: number) => {
      const root = paintRootRef.current;
      if (!root) return undefined;

      const rect = renderer.domElement.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return undefined;

      const viewportHeight = Math.max(rect.height, 1);
      pointer.set(
        (localX / Math.max(rect.width, 1)) * 2 - 1,
        -(localY / viewportHeight) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(root, true)[0];
      return hit ? { hit, viewportHeight } : undefined;
    };

    const getMirroredPaintIntersection = (
      projected: { hit: THREE.Intersection<THREE.Object3D>; viewportHeight: number },
      scope: UnitPainterSelectionScope,
    ) => {
      const session = paintSessionRef.current;
      const root = paintRootRef.current;
      if (
        !session
        || !root
        || !symmetryEnabledRef.current
        || !session.matchesSelectionScope(projected.hit, scope)
      ) {
        return undefined;
      }

      mirrorRayAcrossObjectLocalX(raycaster.ray, root, mirroredRay);
      symmetryRaycaster.ray.copy(mirroredRay);
      symmetryRaycaster.near = raycaster.near;
      symmetryRaycaster.far = raycaster.far;
      const raycastStartedAt = performance.now();
      const mirroredHit = symmetryRaycaster.intersectObject(root, true)[0];
      if (activeStrokeProfile) {
        activeStrokeProfile.symmetryRaycasts += 1;
        activeStrokeProfile.symmetryRaycastMs += performance.now() - raycastStartedAt;
      }
      if (!mirroredHit) return undefined;
      if (
        mirroredHit.object === projected.hit.object
        && mirroredHit.faceIndex === projected.hit.faceIndex
        && mirroredHit.point.distanceToSquared(projected.hit.point) < 1e-8
      ) {
        return undefined;
      }

      symmetryCamera.fov = camera.fov;
      symmetryCamera.position.copy(mirroredRay.origin);
      symmetryCamera.updateProjectionMatrix();
      symmetryCamera.updateMatrixWorld(true);
      return mirroredHit;
    };

    /**
     * Raycast only the current pointer position. Intermediate brush stamps are
     * interpolated in texture/UV space when both endpoint hits resolve to the
     * same texture and UV island. This removes the scene-raycast multiplier from
     * dense brush spacing while preserving a safe endpoint fallback at seams.
     */
    const paintToPointer = (event: PointerEvent, flushTail = false) => {
      const session = paintSessionRef.current;
      const nextX = event.clientX;
      const nextY = event.clientY;
      const raycastStartedAt = performance.now();
      const projected = getPaintIntersection(nextX, nextY);
      if (activeStrokeProfile) {
        activeStrokeProfile.pointerEvents += 1;
        activeStrokeProfile.normalRaycasts += 1;
        activeStrokeProfile.normalRaycastMs += performance.now() - raycastStartedAt;
      }
      const scope = paintScopeRef.current;

      if (!hasLastPaintPoint) {
        if (projected && session) {
          profilePaintCall(1, false, () => {
            session.paintIntersection(
              projected.hit,
              brushSettingsRef.current,
              camera,
              projected.viewportHeight,
              brushSettingsRef.current.radiusPx,
              scope,
            );
          });
          const mirroredHit = getMirroredPaintIntersection(projected, scope);
          if (mirroredHit) {
            profilePaintCall(1, true, () => {
              session.paintIntersection(
                mirroredHit,
                brushSettingsRef.current,
                symmetryCamera,
                projected.viewportHeight,
                brushSettingsRef.current.radiusPx,
                "all",
              );
            });
          }
          lastPaintIntersection = projected.hit;
          lastMirroredPaintIntersection = mirroredHit;
        } else {
          lastPaintIntersection = undefined;
          lastMirroredPaintIntersection = undefined;
        }
        lastPaintPoint.set(nextX, nextY);
        hasLastPaintPoint = true;
        distanceSinceLastPaintStamp = 0;
        return projected;
      }

      const sampled = sampleUnitPainterStrokeSegment(
        lastPaintPoint.x,
        lastPaintPoint.y,
        nextX,
        nextY,
        getUnitPainterBrushSpacing(brushSettingsRef.current.radiusPx),
        distanceSinceLastPaintStamp,
      );
      const sampleAmounts = sampled.samples.map((sample) => sample.amount);
      if (flushTail && sampled.distanceSinceLastStamp > 0.5) {
        if (sampleAmounts.at(-1) !== 1) sampleAmounts.push(1);
        distanceSinceLastPaintStamp = 0;
      } else {
        distanceSinceLastPaintStamp = sampled.distanceSinceLastStamp;
      }

      const mirroredHit = projected
        ? getMirroredPaintIntersection(projected, scope)
        : undefined;

      if (projected && session && sampleAmounts.length > 0) {
        if (lastPaintIntersection) {
          profilePaintCall(sampleAmounts.length, false, () => {
            session.paintIntersectionSamples(
              lastPaintIntersection!,
              projected.hit,
              sampleAmounts,
              brushSettingsRef.current,
              camera,
              projected.viewportHeight,
              brushSettingsRef.current.radiusPx,
              scope,
            );
          });
        } else {
          profilePaintCall(1, false, () => {
            session.paintIntersection(
              projected.hit,
              brushSettingsRef.current,
              camera,
              projected.viewportHeight,
              brushSettingsRef.current.radiusPx,
              scope,
            );
          });
        }

        if (mirroredHit) {
          if (lastMirroredPaintIntersection) {
            profilePaintCall(sampleAmounts.length, true, () => {
              session.paintIntersectionSamples(
                lastMirroredPaintIntersection!,
                mirroredHit,
                sampleAmounts,
                brushSettingsRef.current,
                symmetryCamera,
                projected.viewportHeight,
                brushSettingsRef.current.radiusPx,
                "all",
              );
            });
          } else {
            profilePaintCall(1, true, () => {
              session.paintIntersection(
                mirroredHit,
                brushSettingsRef.current,
                symmetryCamera,
                projected.viewportHeight,
                brushSettingsRef.current.radiusPx,
                "all",
              );
            });
          }
        }
      }

      lastMirroredPaintIntersection = mirroredHit;
      lastPaintIntersection = projected?.hit;
      lastPaintPoint.set(nextX, nextY);
      return projected;
    };

    const brushColorToHex = () => {
      const { r, g, b } = brushSettingsRef.current.color;
      const toHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };

    const samplePaintColor = (clientX: number, clientY: number) => {
      const session = paintSessionRef.current;
      if (!session) return false;
      const projected = getPaintIntersection(clientX, clientY);
      const sampled = projected ? session.sampleIntersection(projected.hit) : undefined;
      if (!sampled) return false;
      const toHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
      choosePaintColor(`#${toHex(sampled.r)}${toHex(sampled.g)}${toHex(sampled.b)}`);
      return true;
    };

    const orbitPaintCamera = (deltaX: number, deltaY: number) => {
      const viewportHeight = Math.max(renderer.domElement.clientHeight, 1);
      orbitOffset.copy(camera.position).sub(controls.target);
      orbitSpherical.setFromVector3(orbitOffset);
      const radiansPerPixel = (2 * Math.PI * controls.rotateSpeed) / viewportHeight;
      orbitSpherical.theta -= deltaX * radiansPerPixel;
      orbitSpherical.phi -= deltaY * radiansPerPixel;
      orbitSpherical.makeSafe();
      orbitOffset.setFromSpherical(orbitSpherical);
      camera.position.copy(controls.target).add(orbitOffset);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      controls.update();
    };

    const finishAltOrbitGesture = (event?: PointerEvent, canceled = false) => {
      if (altOrbitPointerId == null) return;
      if (!canceled && !isAltOrbiting && event) samplePaintColor(event.clientX, event.clientY);
      if (renderer.domElement.hasPointerCapture(altOrbitPointerId)) {
        renderer.domElement.releasePointerCapture(altOrbitPointerId);
      }
      altOrbitPointerId = undefined;
      isAltOrbiting = false;
      controls.enabled = true;
    };

    const finishPaintStroke = (event?: PointerEvent) => {
      if (!isPainting) return;
      isPainting = false;
      hasLastPaintPoint = false;
      lastPaintIntersection = undefined;
      lastMirroredPaintIntersection = undefined;
      distanceSinceLastPaintStamp = 0;
      controls.enabled = true;
      const session = paintSessionRef.current;
      const changed = session?.endStroke() ?? false;
      const profile = activeStrokeProfile;
      activeStrokeProfile = undefined;
      if (profile && session) {
        const gpu = session.lastStrokeGpuProfile;
        const durationMs = performance.now() - profile.startedAt;
        const round = (value: number) => Number(value.toFixed(2));
        console.log("[UnitPainterProfile] 3D stroke", {
          changed,
          viewMode: paintViewModeRef.current,
          symmetry: symmetryEnabledRef.current,
          durationMs: round(durationMs),
          pointerEvents: profile.pointerEvents,
          normalRaycasts: profile.normalRaycasts,
          normalRaycastMs: round(profile.normalRaycastMs),
          symmetryRaycasts: profile.symmetryRaycasts,
          symmetryRaycastMs: round(profile.symmetryRaycastMs),
          paintBatches: profile.paintBatches,
          primaryStamps: profile.primaryStamps,
          mirroredStamps: profile.mirroredStamps,
          paintCpuMs: round(profile.paintCpuMs),
          renderFrames: profile.renderFrames,
          renderCpuMs: round(profile.renderCpuMs),
          avgRenderCpuMs: round(
            profile.renderFrames > 0 ? profile.renderCpuMs / profile.renderFrames : 0,
          ),
          maxRenderCpuMs: round(profile.maxRenderCpuMs),
          bvhRefitPasses: profile.bvhRefitPasses,
          bvhRefits: profile.bvhRefits,
          bvhRefitMs: round(profile.bvhRefitMs),
          avgBvhRefitMs: round(
            profile.bvhRefitPasses > 0 ? profile.bvhRefitMs / profile.bvhRefitPasses : 0,
          ),
          maxBvhRefitMs: round(profile.maxBvhRefitMs),
          gpuUpdateRanges: gpu.updateRanges,
          gpuUpdateMiB: round(gpu.updateBytes / 1024 / 1024),
        });
      }
      if (changed) {
        setPaintHistoryVersion((value) => value + 1);
        if (activeStrokeMode !== "restore" && activeStrokeColor) {
          rememberUsedPaintColor(activeStrokeColor);
        }
      }
      activeStrokeColor = "";
      activeStrokeMode = undefined;
      if (
        event &&
        activePointerId != null &&
        renderer.domElement.hasPointerCapture(activePointerId)
      ) {
        renderer.domElement.releasePointerCapture(activePointerId);
      }
      activePointerId = undefined;
    };

    const onPointerDown = (event: PointerEvent) => {
      updateBrushCursor(event);
      const session = paintSessionRef.current;
      if (!painterEnabledRef.current || event.button !== 0 || !session) return;

      // Alt+click remains the temporary eyedropper, but Alt+drag crosses a small
      // threshold and becomes a camera orbit without leaving paint mode.
      if (event.altKey || altEyedropperHeldRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        altOrbitPointerId = event.pointerId;
        altOrbitStart.set(event.clientX, event.clientY);
        altOrbitLast.copy(altOrbitStart);
        isAltOrbiting = false;
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        clearPaintHoverVisual();
        return;
      }

      if (eyedropperActiveRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (samplePaintColor(event.clientX, event.clientY)) setIsPaintEyedropperActive(false);
        return;
      }

      if (selectToolModeRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const projected = getPaintIntersection(event.clientX, event.clientY);
        const operation = event.ctrlKey ? "toggle" : event.shiftKey ? "add" : "replace";
        if (projected) selectPaintIntersection(projected.hit, operation);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      isPainting = true;
      hasLastPaintPoint = false;
      distanceSinceLastPaintStamp = 0;
      activePointerId = event.pointerId;
      activeStrokeColor = brushColorToHex();
      activeStrokeMode = brushSettingsRef.current.mode;
      activeStrokeProfile = {
        startedAt: performance.now(),
        pointerEvents: 0,
        normalRaycasts: 0,
        normalRaycastMs: 0,
        symmetryRaycasts: 0,
        symmetryRaycastMs: 0,
        paintBatches: 0,
        primaryStamps: 0,
        mirroredStamps: 0,
        paintCpuMs: 0,
        renderFrames: 0,
        renderCpuMs: 0,
        maxRenderCpuMs: 0,
        bvhRefitPasses: 0,
        bvhRefits: 0,
        bvhRefitMs: 0,
        maxBvhRefitMs: 0,
      };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      session.beginStroke();
      paintToPointer(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateBrushCursor(event);

      if (event.pointerId === altOrbitPointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!isAltOrbiting) {
          const totalDistance = Math.hypot(
            event.clientX - altOrbitStart.x,
            event.clientY - altOrbitStart.y,
          );
          if (totalDistance >= ALT_ORBIT_DRAG_THRESHOLD_PX) isAltOrbiting = true;
        }
        if (isAltOrbiting) {
          orbitPaintCamera(event.clientX - altOrbitLast.x, event.clientY - altOrbitLast.y);
        }
        altOrbitLast.set(event.clientX, event.clientY);
        textureLinkedHoverSinkRef.current?.(undefined);
        return;
      }

      const needsLinkedHover = paintViewModeRef.current === "split";
      if (isPainting && event.pointerId === activePointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const projected = paintToPointer(event);
        if (needsLinkedHover) {
          const session = paintSessionRef.current;
          const hoverScope =
            paintScopeRef.current === "all" ? "island" : paintScopeRef.current;
          textureLinkedHoverSinkRef.current?.(
            projected?.hit && session
              ? session.getIntersectionTextureHover(projected.hit, hoverScope)
              : undefined,
          );
        }
        return;
      }

      const needsSelectionHover = !!selectToolModeRef.current;
      if (needsSelectionHover || needsLinkedHover) {
        const projected = getPaintIntersection(event.clientX, event.clientY);
        if (needsSelectionHover) updatePaintHoverVisual(projected?.hit);
        if (needsLinkedHover) {
          const session = paintSessionRef.current;
          const hoverScope =
            selectToolModeRef.current
            ?? (paintScopeRef.current === "all" ? "island" : paintScopeRef.current);
          textureLinkedHoverSinkRef.current?.(
            projected?.hit && session
              ? session.getIntersectionTextureHover(projected.hit, hoverScope)
              : undefined,
          );
        }
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId === altOrbitPointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finishAltOrbitGesture(event);
        return;
      }
      if (!isPainting || event.pointerId !== activePointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      paintToPointer(event, true);
      finishPaintStroke(event);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === altOrbitPointerId) {
        finishAltOrbitGesture(event, true);
        return;
      }
      finishPaintStroke(event);
    };
    const onPointerLeave = (event: PointerEvent) => {
      textureLinkedHoverSinkRef.current?.(undefined);
      if (!isPainting) {
        updateBrushCursor(event, false);
        clearPaintHoverVisual();
      }
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown, true);
    renderer.domElement.addEventListener("pointermove", onPointerMove, true);
    renderer.domElement.addEventListener("pointerup", onPointerUp, true);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel, true);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave, true);

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let isVisible = true;
    const intersectionObserver = new IntersectionObserver((entries) => {
      isVisible = entries[0]?.isIntersecting ?? true;
    });
    intersectionObserver.observe(mount);

    let previousFrameTime = performance.now();
    renderer.setAnimationLoop((timestamp) => {
      const now = typeof timestamp === "number" ? timestamp : performance.now();
      const delta = Math.min(Math.max((now - previousFrameTime) / 1000, 0), 0.1);
      previousFrameTime = now;
      if (!isVisible) return;
      if (context.isPlaying) {
        for (const mixer of context.mixers) mixer.update(delta);
      }
      controls.update();
      const renderStartedAt = performance.now();
      renderer.render(scene, camera);
      const completedAt = performance.now();
      if (activeStrokeProfile) {
        const renderCpuMs = completedAt - renderStartedAt;
        activeStrokeProfile.renderFrames += 1;
        activeStrokeProfile.renderCpuMs += renderCpuMs;
        activeStrokeProfile.maxRenderCpuMs = Math.max(
          activeStrokeProfile.maxRenderCpuMs,
          renderCpuMs,
        );
      }

      if (context.isPlaying && paintSessionRef.current) {
        const refitStartedAt = performance.now();
        const bvhRefits = paintSessionRef.current.refitRaycastAcceleration();
        if (activeStrokeProfile && bvhRefits > 0) {
          const bvhRefitMs = performance.now() - refitStartedAt;
          activeStrokeProfile.bvhRefitPasses += 1;
          activeStrokeProfile.bvhRefits += bvhRefits;
          activeStrokeProfile.bvhRefitMs += bvhRefitMs;
          activeStrokeProfile.maxBvhRefitMs = Math.max(
            activeStrokeProfile.maxBvhRefitMs,
            bvhRefitMs,
          );
        }
      }
      const afterNextRender = context.afterNextRender;
      if (afterNextRender) {
        context.afterNextRender = null;
        afterNextRender({ renderMs: completedAt - renderStartedAt, completedAt });
      }
    });

    return () => {
      removeHostResetListener?.();
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      for (const mixer of context.mixers) mixer.stopAllAction();
      context.mixers = [];
      context.actions = [];
      context.afterNextRender = null;
      finishPaintStroke();
      finishAltOrbitGesture(undefined, true);
      paintSessionRef.current?.dispose();
      paintSessionRef.current = null;
      clearPaintSelectionVisual();
      clearPaintHoverVisual();
      textureLinkedHoverSinkRef.current?.(undefined);
      textureToModelHoverRef.current = undefined;
      paintRootRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, true);
      renderer.domElement.removeEventListener("pointermove", onPointerMove, true);
      renderer.domElement.removeEventListener("pointerup", onPointerUp, true);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel, true);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave, true);
      controls.dispose();
      disposeGrid(grid);
      clearHostSessionCache();
      ktx2Loader.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const grid = contextRef.current?.grid;
    if (grid) grid.visible = showWireframe;
  }, [showWireframe]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const context = contextRef.current;
    if (!context) return;
    context.isPlaying = isPlaying;
    for (const action of context.actions) action.paused = !isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    animationSpeedRef.current = animationSpeed;
    for (const action of contextRef.current?.actions ?? []) action.timeScale = animationSpeed;
  }, [animationSpeed]);

  useEffect(() => {
    if (!isActive || loadedAnimationCatalogKeyRef.current === animationCatalogKey) return;

    let isCancelled = false;
    loadedAnimationCatalogKeyRef.current = undefined;
    catalogLoadingRef.current = true;
    setAnimationCatalogReady(false);
    setAnimationOptions([]);
    setSelectedAnimationPath("");
    setCatalogDiagnostics([]);
    setClipDuration(0);
    setCurrentTime(0);

    const loadCatalog = async () => {
      try {
        const result = await getVisualsModelAnimationCatalog(assetPath, effectiveEnabledMods);
        if (isCancelled) return;
        const animations = (result.animations || [])
          .filter((animation) => animation.path?.trim())
          .map((animation) => ({ path: animation.path, label: getAnimationLabel(animation.path) }))
          .filter((animation, index, all) => all.findIndex((candidate) => candidate.path === animation.path) === index)
          .sort((first, second) => first.label.localeCompare(second.label) || first.path.localeCompare(second.path));
        const options = [NONE_ANIMATION, ...animations];
        const defaultAnimation = selectDefaultAnimation(animations);
        setAnimationOptions(options);
        setSelectedAnimationPath(defaultAnimation?.path || "");
        setCatalogDiagnostics(result.diagnostics || (result.error ? [result.error] : []));
        if (result.success) loadedAnimationCatalogKeyRef.current = animationCatalogKey;
      } catch (catalogError) {
        if (!isCancelled) {
          setAnimationOptions([NONE_ANIMATION]);
          setSelectedAnimationPath("");
          setCatalogDiagnostics([
            catalogError instanceof Error ? catalogError.message : "Unable to resolve model animations.",
          ]);
        }
      } finally {
        if (!isCancelled) {
          catalogLoadingRef.current = false;
          setAnimationCatalogReady(true);
        }
      }
    };

    void loadCatalog();
    return () => {
      isCancelled = true;
    };
  }, [animationCatalogKey, assetPath, effectiveEnabledMods, isActive]);

  useEffect(() => {
    if (!isActive || loadedVariantCatalogKeyRef.current === variantCatalogKey) return;

    let isCancelled = false;
    loadedVariantCatalogKeyRef.current = undefined;
    setVariantCatalog(undefined);
    setVariantCatalogDiagnostics([]);
    setVariantSelections({});
    setVariantCatalogReady(!variantMeshSessionId);
    if (!variantMeshSessionId) {
      loadedVariantCatalogKeyRef.current = variantCatalogKey;
      return;
    }

    const loadVariantCatalog = async () => {
      try {
        const result =
          variantMeshSessionType === "visuals"
            ? await window.api?.getVisualsVariantMeshCatalog(variantMeshSessionId, assetPath)
            : await window.api?.getUnitViewerVariantMeshCatalog(variantMeshSessionId, assetPath);
        if (isCancelled) return;
        if (!result?.success || !result.catalog) {
          throw new Error(result?.error || "Unable to resolve unit appearances.");
        }
        setVariantCatalog(result.catalog);
        setVariantCatalogDiagnostics(result.catalog.diagnostics);
        setVariantSelections(
          Object.fromEntries(result.catalog.slots.map((slot) => [slot.slotPath, slot.defaultChoiceIndex] as const)),
        );
        loadedVariantCatalogKeyRef.current = variantCatalogKey;
      } catch (catalogError) {
        if (!isCancelled) {
          setVariantCatalog(undefined);
          setVariantCatalogDiagnostics([
            catalogError instanceof Error ? catalogError.message : "Unable to resolve unit appearances.",
          ]);
        }
      } finally {
        if (!isCancelled) setVariantCatalogReady(true);
      }
    };

    void loadVariantCatalog();
    return () => {
      isCancelled = true;
    };
  }, [assetPath, isActive, variantCatalogKey, variantMeshSessionId, variantMeshSessionType]);

  const activeVariantSlots = useMemo(
    () =>
      variantCatalog
        ? getComparisonActiveVariantMeshSlots(variantCatalog, variantSelections).filter((slot) => slot.choices.length > 1)
        : [],
    [variantCatalog, variantSelections],
  );
  const allVariantSlots = useMemo(
    () => activeVariantSlots.filter((slot) => variantSelections[slot.slotPath] === ALL_VARIANTS),
    [activeVariantSlots, variantSelections],
  );
  const allVariantSlotPaths = useMemo(
    () => new Set(allVariantSlots.map((slot) => slot.slotPath)),
    [allVariantSlots],
  );
  const comparisonColumnSlot = allVariantSlots[0];
  const comparisonRowSlot = allVariantSlots[1];
  const comparisonLayerSlot = allVariantSlots[2];
  const comparisonColumnCount = comparisonColumnSlot?.choices.length ?? 1;
  const comparisonRowCount = comparisonRowSlot?.choices.length ?? 1;
  const comparisonLayerCount = comparisonLayerSlot?.choices.length ?? 1;
  const comparisonVariants = useMemo<ComparisonVariant[]>(() => {
    if (!variantCatalog) return [{ rowIndex: 0, columnIndex: 0, layerIndex: 0, selections: [] }];

    const columnChoices = comparisonColumnSlot?.choices ?? [undefined];
    const rowChoices = comparisonRowSlot?.choices ?? [undefined];
    const layerChoices = comparisonLayerSlot?.choices ?? [undefined];
    const variants: ComparisonVariant[] = [];

    layerChoices.forEach((layerChoice, layerIndex) => {
      rowChoices.forEach((rowChoice, rowIndex) => {
        columnChoices.forEach((columnChoice, columnIndex) => {
          const concreteSelections = Object.fromEntries(
            variantCatalog.slots.map((slot) => {
              const selected = variantSelections[slot.slotPath];
              return [slot.slotPath, selected == null || selected === ALL_VARIANTS ? slot.defaultChoiceIndex : selected];
            }),
          ) as Record<string, number>;
          if (comparisonColumnSlot && columnChoice) {
            concreteSelections[comparisonColumnSlot.slotPath] = columnChoice.index;
          }
          if (comparisonRowSlot && rowChoice) {
            concreteSelections[comparisonRowSlot.slotPath] = rowChoice.index;
          }
          if (comparisonLayerSlot && layerChoice) {
            concreteSelections[comparisonLayerSlot.slotPath] = layerChoice.index;
          }

          const selections = getActiveVariantMeshSlots(variantCatalog, concreteSelections).map((slot) => ({
            slotPath: slot.slotPath,
            choiceIndex: concreteSelections[slot.slotPath] ?? slot.defaultChoiceIndex,
          }));
          variants.push({ rowIndex, columnIndex, layerIndex, selections });
        });
      });
    });

    return variants;
  }, [comparisonColumnSlot, comparisonLayerSlot, comparisonRowSlot, variantCatalog, variantSelections]);
  const comparisonModelCount = comparisonVariants.length;
  const comparisonTooLarge = comparisonModelCount > MAX_COMPARISON_MODELS;

  useEffect(() => {
    if (isActive || status !== "ready") return;
    const context = contextRef.current;
    if (!context || !assetPath) return;
    pendingCameraViewRef.current = { assetPath, view: captureCameraView(context) };
  }, [assetPath, isActive, status]);

  useEffect(() => {
    if (!isActive || !animationCatalogReady || !variantCatalogReady || catalogLoadingRef.current) return;
    const context = contextRef.current;
    if (!context || !assetPath) return;
    if (pendingCameraViewRef.current?.assetPath !== assetPath) pendingCameraViewRef.current = null;

    let isCancelled = false;
    const ownedGroup = new THREE.Group();
    const ownedModels: THREE.Object3D[] = [];
    const ownedMixers: THREE.AnimationMixer[] = [];
    const ownedActions: THREE.AnimationAction[] = [];
    const ownedPreviewIds = new Set<string>();
    const resourceSessionKey = animationCatalogKey;
    let resourceSession = previewResourceSessionRef.current;
    if (!resourceSession || resourceSession.key !== resourceSessionKey) {
      if (resourceSession) disposePreviewResourcePool(resourceSession.pool);
      context.ktx2Loader.clearRawTextureDataCache();
      resourceSession = {
        key: resourceSessionKey,
        pool: createPreviewResourcePool(),
      };
      previewResourceSessionRef.current = resourceSession;
    }
    const resourcePool = resourceSession.pool;
    const loadingPreviewIds = new Set<string>();

    const releasePreview = (previewId: string) => {
      void releaseVisualsModelPreview(previewId).catch(() => undefined);
    };

    const cleanupOwnedPreview = () => {
      context.afterNextRender = null;
      for (const mixer of ownedMixers) mixer.stopAllAction();
      ownedMixers.forEach((mixer, index) => {
        const model = ownedModels[index];
        if (model) mixer.uncacheRoot(model);
      });
      context.mixers = [];
      context.actions = [];
      context.scene.remove(ownedGroup);
      if (paintSessionRef.current) {
        paintSessionRef.current.dispose();
        paintSessionRef.current = null;
      }
      clearPaintSelectionVisual();
      clearPaintHoverVisual();
      setPaintSelection(undefined);
      setPaintScope("all");
      setPaintSelectMode(undefined);
      paintRootRef.current = null;
      disposeObject(ownedGroup, resourcePool);
      ownedModels.length = 0;
      ownedMixers.length = 0;
      ownedActions.length = 0;
      for (const previewId of [...ownedPreviewIds]) {
        if (loadingPreviewIds.has(previewId)) continue;
        releasePreview(previewId);
        ownedPreviewIds.delete(previewId);
      }
    };

    const run = async () => {
      const previewStartedAt = performance.now();
      setStatus("exporting");
      setError(null);
      setClipDuration(0);
      setCurrentTime(0);
      setPaintTextureCount(-1);
      setPaintExportStatus("");
      setWarnings([...catalogDiagnostics, ...variantCatalogDiagnostics]);
      context.ktx2Loader.resetTiming();

      if (comparisonTooLarge) {
        setStatus("error");
        setError(
          `This comparison would render ${comparisonModelCount} models. Reduce the number of All selections or choices (maximum ${MAX_COMPARISON_MODELS}).`,
        );
        return;
      }

      try {
        const warningSet = new Set([...catalogDiagnostics, ...variantCatalogDiagnostics]);
        let singleExportResult: Awaited<ReturnType<typeof exportVisualsModel>> | undefined;
        let singleExportRoundTripMs = 0;
        let singleGltfLoadMs = 0;
        let maxClipDuration = 0;
        let exportsToLoad: Array<{
          previewId: string;
          url: string;
          warnings?: string[];
        }>;

        if (comparisonVariants.length === 1) {
          const exportStartedAt = performance.now();
          const exportResult = await exportVisualsModel(
            assetPath,
            effectiveEnabledMods,
            selectedAnimationPath ? [selectedAnimationPath] : [],
            comparisonVariants[0].selections,
          );
          singleExportRoundTripMs = performance.now() - exportStartedAt;
          if (!exportResult.success || !exportResult.previewId || !exportResult.url) {
            throw new Error(exportResult.error || "Failed to export this model.");
          }
          singleExportResult = exportResult;
          exportsToLoad = [{
            previewId: exportResult.previewId,
            url: exportResult.url,
            warnings: exportResult.warnings,
          }];
        } else {
          const batchResult = await exportVisualsModelBatch(
            assetPath,
            effectiveEnabledMods,
            selectedAnimationPath ? [selectedAnimationPath] : [],
            comparisonVariants.map((variant) => ({ variantSelections: variant.selections })),
          );
          if (!batchResult.success || !batchResult.items) {
            throw new Error(batchResult.error || "Failed to export the slot comparison.");
          }
          if (batchResult.items.length !== comparisonVariants.length) {
            for (const item of batchResult.items) releasePreview(item.previewId);
            throw new Error(
              `WH3AssetHost returned ${batchResult.items.length} comparison models; expected ${comparisonVariants.length}.`,
            );
          }
          exportsToLoad = batchResult.items;
          for (const warning of batchResult.warnings ?? []) warningSet.add(warning);
        }

        for (const exportItem of exportsToLoad) {
          ownedPreviewIds.add(exportItem.previewId);
          for (const warning of exportItem.warnings ?? []) warningSet.add(warning);
        }

        if (isCancelled) {
          for (const previewId of ownedPreviewIds) releasePreview(previewId);
          ownedPreviewIds.clear();
          return;
        }

        setStatus("loading");
        for (const exportItem of exportsToLoad) {
          if (isCancelled) return;

          const previewId = exportItem.previewId;
          loadingPreviewIds.add(previewId);
          const gltfLoader = new GLTFLoader();
          gltfLoader.setKTX2Loader(context.ktx2Loader);
          const gltfLoadStartedAt = performance.now();
          let gltf: Awaited<ReturnType<typeof gltfLoader.loadAsync>>;
          try {
            gltf = await gltfLoader.loadAsync(exportItem.url);
          } catch (loadError) {
            loadingPreviewIds.delete(previewId);
            throw loadError;
          }
          const gltfLoadMs = performance.now() - gltfLoadStartedAt;
          loadingPreviewIds.delete(previewId);
          if (comparisonVariants.length === 1) singleGltfLoadMs = gltfLoadMs;

          if (isCancelled) {
            disposeObject(gltf.scene);
            if (ownedPreviewIds.has(previewId)) {
              releasePreview(previewId);
              ownedPreviewIds.delete(previewId);
            }
            return;
          }

          internObjectResources(gltf.scene, resourcePool);
          preloadObjectTextures(context, gltf.scene, resourcePool);
          ownedModels.push(gltf.scene);
          ownedGroup.add(gltf.scene);

          if (selectedAnimationPath && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(gltf.scene);
            const animation = gltf.animations[0];
            const action = mixer.clipAction(animation);
            action.setLoop(THREE.LoopRepeat, Infinity);
            if (unsyncedAnimations && comparisonVariants.length > 1 && animation.duration > 0) {
              action.time = Math.random() * animation.duration;
            }
            action.timeScale = animationSpeedRef.current;
            action.play();
            action.paused = !isPlayingRef.current;
            ownedMixers.push(mixer);
            ownedActions.push(action);
            maxClipDuration = Math.max(maxClipDuration, gltf.animations[0].duration);
          }
        }

        if (isCancelled) return;

        const sceneSetupStartedAt = performance.now();
        layoutComparisonModels(
          ownedModels,
          comparisonColumnCount,
          comparisonRowCount,
          comparisonLayerCount,
        );
        paintRootRef.current = comparisonVariants.length === 1 ? ownedModels[0] ?? null : null;
        context.scene.add(ownedGroup);
        context.mixers = ownedMixers;
        context.actions = ownedActions;
        if (maxClipDuration > 0) {
          setClipDuration(maxClipDuration);
          setCurrentTime(0);
        }

        frameObject(context, ownedGroup);
        const pendingCameraView = pendingCameraViewRef.current;
        if (pendingCameraView?.assetPath === assetPath) {
          restoreCameraView(context, pendingCameraView.view);
          pendingCameraViewRef.current = null;
        }
        const sceneSetupMs = performance.now() - sceneSetupStartedAt;
        const sceneReadyAt = performance.now();
        setWarnings([...warningSet]);

        if (
          comparisonVariants.length === 1 &&
          singleExportResult?.previewId &&
          singleExportResult.timings
        ) {
          const timingPreviewId = singleExportResult.previewId;
          context.afterNextRender = ({ renderMs, completedAt }) => {
            if (isCancelled || !ownedPreviewIds.has(timingPreviewId)) return;
            void reportVisualsModelPreviewTiming({
              assetPath,
              previewId: timingPreviewId,
              totalMs: completedAt - previewStartedAt,
              exportRoundTripMs: singleExportRoundTripMs,
              gltfLoadMs: singleGltfLoadMs,
              sceneSetupMs,
              firstFrameWaitMs: completedAt - sceneReadyAt,
              firstRenderMs: renderMs,
              main: singleExportResult?.timings,
              ktx2: context.ktx2Loader.getTiming(),
            }).catch(() => undefined);
          };
        }

        setStatus("ready");
      } catch (previewError) {
        cleanupOwnedPreview();
        if (!isCancelled) {
          setStatus("error");
          setError(previewError instanceof Error ? previewError.message : "Failed to render the model comparison.");
        }
      }
    };

    void run();

    return () => {
      isCancelled = true;
      cleanupOwnedPreview();
    };
  }, [
    animationCatalogKey,
    animationCatalogReady,
    assetPath,
    catalogDiagnostics,
    comparisonColumnCount,
    comparisonLayerCount,
    comparisonModelCount,
    comparisonRowCount,
    comparisonTooLarge,
    comparisonVariants,
    effectiveEnabledMods,
    isActive,
    paintProjectReloadVersion,
    selectedAnimationPath,
    unsyncedAnimations,
    variantCatalogDiagnostics,
    variantCatalogReady,
  ]);

  useEffect(() => {
    setPaintPackPath(undefined);
    setPaintExcludedPackPaths([]);
    setPaintColorHistory([]);
    setPaintColor(DEFAULT_PAINT_COLOR);
    setPaintViewMode("model");
    setPaintTextureViewId(undefined);
    setPaintTexturePadding(0);
    setIsPaintColorHistoryOpen(false);
    pendingPaintProjectRef.current = null;
  }, [assetPath]);

  useEffect(() => {
    if (comparisonModelCount !== 1 && isPainterEnabled) setIsPainterEnabled(false);
  }, [comparisonModelCount, isPainterEnabled]);

  useEffect(() => {
    if (!painterEnabledRef.current) {
      const cursor = brushCursorRef.current;
      if (cursor) cursor.style.display = "none";
      if (isPaintEyedropperActive) setIsPaintEyedropperActive(false);
      if (isPaintLayersOpen) setIsPaintLayersOpen(false);
      if (isPaintColorHistoryOpen) setIsPaintColorHistoryOpen(false);
      clearPaintHoverVisual();
      if (paintSelectMode || paintSelection) clearPaintSelection();
    }
  }, [
    enablePainting,
    isPainterEnabled,
    isPaintEyedropperActive,
    paintSelectMode,
    isPaintLayersOpen,
    isPaintColorHistoryOpen,
    paintSelection,
    status,
    comparisonModelCount,
  ]);

  useEffect(() => {
    if (
      !enablePainting ||
      !isPainterEnabled ||
      status !== "ready" ||
      comparisonModelCount !== 1 ||
      !paintRootRef.current ||
      paintSessionRef.current
    ) {
      return;
    }
    const session = createUnitPainterSession(paintRootRef.current);
    paintSessionRef.current = session;
    const pendingProject = pendingPaintProjectRef.current;
    if (pendingProject?.project && pendingProject.packPath) {
      pendingPaintProjectRef.current = null;
      try {
        session.loadProjectLayers({
          activeLayerId: pendingProject.project.activeLayerId,
          layers: pendingProject.project.layers,
        });
        const restoredColorHistory =
          pendingProject.project.usedColorHistory?.slice(0, PAINT_COLOR_HISTORY_LIMIT) ?? [];
        setPaintColorHistory(restoredColorHistory);
        setPaintColor(
          pendingProject.project.selectedColor
          ?? restoredColorHistory[0]
          ?? DEFAULT_PAINT_COLOR,
        );
        setPaintPackPath(pendingProject.packPath);
        setPaintExportStatus(`Opened painted mod: ${pendingProject.packPath}`);
      } catch (projectError) {
        setPaintPackPath(undefined);
        setPaintExportStatus(
          projectError instanceof Error ? projectError.message : "Failed to restore painted project textures.",
        );
      }
    }
    setPaintTextureCount(session.textureCount);
    setPaintTextureViewId((current) =>
      session.textureViews.some((view) => view.id === current)
        ? current
        : session.textureViews[0]?.id,
    );
    setPaintHistoryVersion((value) => value + 1);
  }, [comparisonModelCount, enablePainting, isPainterEnabled, status]);

  useEffect(() => {
    const isEditingControl = (target: EventTarget | null) =>
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!painterEnabledRef.current || isEditingControl(event.target)) return;

      if (event.key === "Alt") {
        altEyedropperHeldRef.current = true;
        event.preventDefault();
        return;
      }

      const key = event.key.toLowerCase();
      const session = paintSessionRef.current;

      if (event.ctrlKey || event.metaKey) {
        if (!session || (key !== "z" && key !== "y")) return;
        const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
        const changed = wantsRedo ? session.redo() : session.undo();
        if (!changed) return;
        event.preventDefault();
        setPaintHistoryVersion((value) => value + 1);
        return;
      }
      if (event.altKey) return;

      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        const direction = event.code === "BracketRight" ? 1 : -1;
        if (event.shiftKey) {
          setPaintBrushHardness((value) =>
            Math.max(0, Math.min(1, Math.round((value + direction * 0.05) * 20) / 20)),
          );
        } else {
          setPaintBrushRadius((value) => Math.max(4, Math.min(64, value + direction * 2)));
        }
        event.preventDefault();
        return;
      }

      if (key === "b") {
        setPaintBrushMode(lastPaintBrushModeRef.current);
        event.preventDefault();
        return;
      }
      if (key === "e") {
        setPaintBrushMode("restore");
        event.preventDefault();
        return;
      }
      if (key === "x") {
        if (paintViewModeRef.current === "texture") return;
        setIsPaintSymmetryEnabled((enabled) => !enabled);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        setIsPaintLayersOpen(false);
        setIsPaintColorHistoryOpen(false);
        setIsPaintEyedropperActive(false);
        clearPaintSelection();
        event.preventDefault();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") altEyedropperHeldRef.current = false;
    };
    const onBlur = () => {
      altEyedropperHeldRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || clipDuration <= 0) return;
    const timer = window.setInterval(() => {
      const action = contextRef.current?.actions[0];
      if (action) setCurrentTime(Math.min(action.time, clipDuration));
    }, 100);
    return () => window.clearInterval(timer);
  }, [clipDuration, status]);

  const seekAnimation = (value: number) => {
    const actions = contextRef.current?.actions ?? [];
    if (actions.length === 0) return;
    const nextTime = Math.max(0, Math.min(value, clipDuration));
    for (const action of actions) action.time = nextTime;
    setCurrentTime(nextTime);
  };

  const openPaintedMod = () => {
    if (isPaintProjectOpening || isPaintExporting) return;
    void (async () => {
      setIsPaintProjectOpening(true);
      setPaintExportStatus("Opening painted mod…");
      try {
        const result = await openUnitPainterProject();
        if (result.canceled) {
          setPaintExportStatus("");
          return;
        }
        if (!result.success || !result.project || !result.packPath) {
          setPaintExportStatus(result.error || "Failed to open painted mod.");
          return;
        }
        const normalize = (value: string) => value.replace(/\//g, "\\").replace(/^\\+/, "").toLowerCase();
        if (normalize(result.project.sourceVariantMeshDefinition) !== normalize(assetPath)) {
          setPaintExportStatus(
            `This painted mod targets '${result.project.sourceVariantMeshDefinition}', not the currently viewed unit '${assetPath}'.`,
          );
          return;
        }

        paintSessionRef.current?.dispose();
        paintSessionRef.current = null;
        clearPaintSelection();
        pendingPaintProjectRef.current = result;
        setPaintPackPath(result.packPath);
        setPaintExcludedPackPaths((current) => {
          const key = normalize(result.packPath!);
          return current.some((path) => normalize(path) === key) ? current : [...current, result.packPath!];
        });
        setVariantSelections(
          Object.fromEntries(result.project.variantSelections.map((selection) => [selection.slotPath, selection.choiceIndex])),
        );
        setIsPainterEnabled(true);
        setIsPlaying(false);
        setPaintProjectReloadVersion((value) => value + 1);
      } catch (projectError) {
        setPaintExportStatus(
          projectError instanceof Error ? projectError.message : "Failed to open painted mod.",
        );
      } finally {
        setIsPaintProjectOpening(false);
      }
    })();
  };

  const savePaintedMod = (mode: "create" | "save" | "saveAs") => {
    const session = paintSessionRef.current;
    if (!session || isPaintExporting) return;
    const targetPackPath = mode === "save" ? paintPackPath : undefined;
    if (mode === "save" && !targetPackPath) return;

    void (async () => {
      setIsPaintExporting(true);
      setPaintExportStatus(mode === "save" ? "Saving painted mod…" : "Preparing painted mod…");
      try {
        const textures = await session.exportModifiedTextures();
        const projectState = {
          ...session.exportProjectState(),
          usedColorHistory: paintColorHistory.slice(0, PAINT_COLOR_HISTORY_LIMIT),
          selectedColor: paintColor,
        };
        if (
          textures.length === 0
          && !targetPackPath
          && !paintPackPath
          && !session.hasUnsavedChanges
        ) {
          setPaintExportStatus("Nothing has been painted yet.");
          return;
        }
        const result = await exportUnitPainterTextures(
          assetPath,
          effectiveEnabledMods,
          comparisonVariants[0]?.selections ?? [],
          textures,
          projectState,
          targetPackPath,
        );
        if (result.canceled) {
          setPaintExportStatus("");
          return;
        }
        if (!result.success) {
          setPaintExportStatus(result.error || "Painted mod save failed.");
          return;
        }

        if (result.packPath) {
          setPaintPackPath(result.packPath);
          setPaintExcludedPackPaths((current) => {
            const normalize = (value: string) => value.replace(/\//g, "\\").toLowerCase();
            const key = normalize(result.packPath!);
            return current.some((path) => normalize(path) === key) ? current : [...current, result.packPath!];
          });
        }
        session.markSaved();
        setPaintHistoryVersion((value) => value + 1);
        const warningSuffix = result.warnings?.length
          ? ` · ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`
          : "";
        const successLabel =
          mode === "save"
            ? "Saved mod"
            : mode === "saveAs"
              ? "Saved as"
              : "Created mod";
        setPaintExportStatus(
          result.packPath
            ? `${successLabel}: ${result.packPath}${warningSuffix}`
            : `${successLabel}${warningSuffix}`,
        );
      } catch (exportError) {
        setPaintExportStatus(
          exportError instanceof Error ? exportError.message : "Painted mod save failed.",
        );
      } finally {
        setIsPaintExporting(false);
      }
    })();
  };

  const paintSelectionPartition = paintSessionRef.current?.selectionPartitionInfo;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      <div className="relative min-h-0 flex-1 w-full overflow-hidden">
        <div
          ref={mountRef}
          className={
            !isPainterEnabled || status !== "ready"
              ? "absolute inset-0"
              : paintViewMode === "texture"
                ? "invisible pointer-events-none absolute inset-0"
                : paintViewMode === "split"
                  ? "absolute bottom-0 left-0 top-0 w-1/2"
                  : "absolute inset-0"
          }
        />
        {isPainterEnabled
          && paintViewMode !== "model"
          && status === "ready"
          && comparisonModelCount === 1
          && paintSessionRef.current && (
            <div
              className={
                paintViewMode === "split"
                  ? "absolute bottom-0 right-0 top-0 w-1/2 border-l border-gray-700"
                  : "absolute inset-0"
              }
            >
            <UnitPainterTextureEditor
              session={paintSessionRef.current}
              historyVersion={paintHistoryVersion}
              selectionKey={`${paintScope}:${paintSessionRef.current?.selectionCount ?? 0}:${paintHistoryVersion}`}
              selectedTextureId={paintTextureViewId}
              onSelectedTextureIdChange={setPaintTextureViewId}
              brushSettings={brushSettingsRef.current}
              scope={paintScope}
              paddingPx={paintTexturePadding}
              onPaddingPxChange={setPaintTexturePadding}
              selectMode={paintSelectMode}
              similarTolerance={paintSimilarTolerance}
              eyedropperActive={isPaintEyedropperActive}
              onEyedropperComplete={(sampled) => {
                const toHex = (value: number) =>
                  Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
                choosePaintColor(`#${toHex(sampled.r)}${toHex(sampled.g)}${toHex(sampled.b)}`);
                if (isPaintEyedropperActive) setIsPaintEyedropperActive(false);
              }}
              onSelectionComplete={(selection, mode) => {
                setPaintSelection(selection);
                if (selection) {
                  setPaintTextureViewId(selection.textureId);
                  setPaintScope(mode);
                  paintScopeRef.current = mode;
                } else {
                  setPaintScope("all");
                  paintScopeRef.current = "all";
                }
                refreshPaintSelectionVisual(selection ? mode : "all");
                setPaintHistoryVersion((value) => value + 1);
              }}
              linkedHoverSinkRef={textureLinkedHoverSinkRef}
              onTextureHover={(textureId, x, y) => {
                textureToModelHoverRef.current?.({ textureId, x, y });
              }}
              onTextureHoverEnd={() => {
                textureToModelHoverRef.current?.(undefined);
              }}
              onStrokeComplete={(changed) => {
                if (!changed) return;
                setPaintExportStatus("");
                setPaintHistoryVersion((value) => value + 1);
                if (brushSettingsRef.current.mode !== "restore") rememberUsedPaintColor(paintColor);
              }}
            />
            </div>
          )}
        {status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-950/70 text-sm text-gray-200">
            {status === "exporting" &&
              (comparisonModelCount > 1
                ? `Exporting ${comparisonModelCount} slot variants with WH3AssetHost...`
                : "Exporting model with WH3AssetHost...")}
            {status === "loading" &&
              (comparisonModelCount > 1
                ? `Loading ${comparisonModelCount} slot variants...`
                : "Loading exported model...")}
            {status === "error" && <span className="max-w-2xl px-6 text-center text-red-300">{error}</span>}
          </div>
        )}
        <div
          ref={brushCursorRef}
          className="pointer-events-none absolute left-0 top-0 z-20 hidden rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
          style={paintViewMode === "texture" ? { display: "none" } : undefined}
        >
          <div
            ref={brushHardnessCursorRef}
            className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          />
        </div>
        {enablePainting && (
          <div className="absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded border border-gray-600 bg-gray-900/95 px-2 py-1 text-xs text-gray-200 shadow-lg">
            <button
              type="button"
              disabled={status !== "ready" || comparisonModelCount !== 1}
              onClick={() => {
                setIsPainterEnabled((enabled) => {
                  if (!enabled) setIsPlaying(false);
                  else {
                    setIsPaintEyedropperActive(false);
                    clearPaintSelection();
                  }
                  return !enabled;
                });
              }}
              className={`rounded border px-2 py-1 ${
                isPainterEnabled
                  ? "border-blue-400 bg-blue-700/50 text-white"
                  : "border-gray-600 bg-gray-800 hover:border-blue-400"
              } disabled:cursor-not-allowed disabled:opacity-40`}
              title={comparisonModelCount !== 1 ? "Painting is available for one model at a time." : "Paint directly on the unit"}
            >
              Paint
            </button>
            {isPainterEnabled && status === "ready" && comparisonModelCount === 1 && (
              <div className="flex overflow-hidden rounded border border-gray-600">
                <button
                  type="button"
                  onClick={() => setPaintViewMode("model")}
                  className={`px-2 py-1 ${
                    paintViewMode === "model"
                      ? "bg-blue-700/60 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                  title="Paint directly on the 3D model"
                >
                  3D
                </button>
                <button
                  type="button"
                  onClick={() => setPaintViewMode("split")}
                  className={`border-l border-gray-600 px-2 py-1 ${
                    paintViewMode === "split"
                      ? "bg-blue-700/60 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                  title="Show the 3D model and BaseColour texture together"
                >
                  Split
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaintViewMode("texture");
                    setIsPaintSymmetryEnabled(false);
                  }}
                  className={`border-l border-gray-600 px-2 py-1 ${
                    paintViewMode === "texture"
                      ? "bg-blue-700/60 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                  title="Paint directly on the BaseColour texture"
                >
                  Texture
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={status !== "ready" || comparisonModelCount !== 1 || isPaintProjectOpening || isPaintExporting}
              onClick={openPaintedMod}
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              title="Open a WHMM painted mod for continued editing"
            >
              {isPaintProjectOpening ? "Opening…" : "Open painted mod…"}
            </button>
            {!isPainterEnabled && paintExportStatus && (
              <span className="max-w-80 truncate text-gray-300" title={paintExportStatus}>
                {paintExportStatus}
              </span>
            )}
            {isPainterEnabled && status === "ready" && comparisonModelCount === 1 && (
              <>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsPaintLayersOpen((open) => !open)}
                    className={`rounded border px-2 py-1 ${
                      isPaintLayersOpen
                        ? "border-violet-400 bg-violet-900/50 text-violet-100"
                        : "border-gray-600 bg-gray-800 hover:border-violet-400"
                    }`}
                    title="Open paint layers"
                  >
                    Layers {paintLayers.length} · {paintActiveLayer?.name ?? "None"}
                  </button>
                  {isPaintLayersOpen && (
                    <div className="absolute left-0 top-full z-40 mt-1 w-80 rounded border border-gray-600 bg-gray-950/95 p-2 shadow-xl">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-gray-200">BaseColour layers</span>
                        <span className="text-gray-500">top → bottom</span>
                      </div>
                      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                        {[...paintLayers].reverse().map((layer) => {
                          const index = paintLayers.findIndex((candidate) => candidate.id === layer.id);
                          const isActive = layer.id === paintActiveLayerId;
                          return (
                            <div
                              key={layer.id}
                              className={`flex items-center gap-1 rounded border px-1 py-1 ${
                                isActive
                                  ? "border-violet-400 bg-violet-950/60"
                                  : "border-gray-700 bg-gray-900/80 hover:border-gray-500"
                              }`}
                              onClick={() => {
                                if (paintSessionRef.current?.setActiveLayer(layer.id)) {
                                  setPaintHistoryVersion((value) => value + 1);
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={layer.visible}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  if (paintSessionRef.current?.setLayerVisible(layer.id, event.target.checked)) {
                                    setPaintExportStatus("");
                                    setPaintHistoryVersion((value) => value + 1);
                                  }
                                }}
                                title="Layer visibility"
                                aria-label={`Visibility: ${layer.name}`}
                              />
                              <input
                                key={`${layer.id}:${layer.name}`}
                                defaultValue={layer.name}
                                onClick={(event) => event.stopPropagation()}
                                onFocus={() => {
                                  if (paintSessionRef.current?.setActiveLayer(layer.id)) {
                                    setPaintHistoryVersion((value) => value + 1);
                                  }
                                }}
                                onBlur={(event) => {
                                  if (paintSessionRef.current?.renameLayer(layer.id, event.currentTarget.value)) {
                                    setPaintExportStatus("");
                                    setPaintHistoryVersion((value) => value + 1);
                                  } else {
                                    event.currentTarget.value = layer.name;
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                aria-label={`Layer name: ${layer.name}`}
                                className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-[11px] text-gray-100"
                              />
                              <input
                                key={`${layer.id}:${layer.opacity}`}
                                type="number"
                                min={0}
                                max={100}
                                step={5}
                                defaultValue={Math.round(layer.opacity * 100)}
                                onClick={(event) => event.stopPropagation()}
                                onFocus={() => {
                                  if (paintSessionRef.current?.setActiveLayer(layer.id)) {
                                    setPaintHistoryVersion((value) => value + 1);
                                  }
                                }}
                                onBlur={(event) => {
                                  const next = Number(event.currentTarget.value);
                                  if (
                                    Number.isFinite(next)
                                    && paintSessionRef.current?.setLayerOpacity(layer.id, next / 100)
                                  ) {
                                    setPaintExportStatus("");
                                    setPaintHistoryVersion((value) => value + 1);
                                  } else {
                                    event.currentTarget.value = String(Math.round(layer.opacity * 100));
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                aria-label={`Layer opacity: ${layer.name}`}
                                className="w-12 rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-right text-[11px] text-gray-100"
                              />
                              <span className="text-[10px] text-gray-500">%</span>
                              <button
                                type="button"
                                disabled={index >= paintLayers.length - 1}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (paintSessionRef.current?.moveLayer(layer.id, 1)) {
                                    setPaintExportStatus("");
                                    setPaintHistoryVersion((value) => value + 1);
                                  }
                                }}
                                className="rounded px-1 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-25"
                                title="Move layer up"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={index <= 0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (paintSessionRef.current?.moveLayer(layer.id, -1)) {
                                    setPaintExportStatus("");
                                    setPaintHistoryVersion((value) => value + 1);
                                  }
                                }}
                                className="rounded px-1 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-25"
                                title="Move layer down"
                              >
                                ↓
                              </button>
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-900/50 px-2 py-1 text-[11px] text-gray-500">
                          <span title="Immutable source BaseColour">🔒 Base</span>
                          <span className="ml-auto">100%</span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 border-t border-gray-800 pt-2">
                        <button
                          type="button"
                          disabled={paintLayers.length >= 32}
                          onClick={() => {
                            if (paintSessionRef.current?.addLayer()) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400 disabled:opacity-40"
                          title={paintLayers.length >= 32 ? "Maximum 32 paint layers" : "Add paint layer"}
                        >
                          + Layer
                        </button>
                        <button
                          type="button"
                          disabled={!paintActiveLayer || paintLayers.length >= 32}
                          onClick={() => {
                            if (paintSessionRef.current?.duplicateActiveLayer()) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400 disabled:opacity-40"
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          disabled={paintLayers.length <= 1}
                          onClick={() => {
                            if (paintSessionRef.current?.deleteActiveLayer()) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-red-400 disabled:opacity-40"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          disabled={paintActiveLayerIndex <= 0}
                          onClick={() => {
                            if (paintSessionRef.current?.mergeActiveLayerDown()) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-violet-400 disabled:opacity-40"
                          title="Merge active layer down, baking visibility and opacity"
                        >
                          Merge Down
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-1 text-gray-400">
                  Color
                  <input
                    type="color"
                    value={paintColor}
                    disabled={paintBrushMode === "restore"}
                    onChange={(event) => choosePaintColor(event.target.value)}
                    className="h-6 w-8 cursor-pointer rounded border border-gray-600 bg-gray-800 p-0 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Paint color"
                  />
                </label>
                <div className="relative">
                  <div
                    className="flex min-h-5 items-center gap-1"
                    aria-label="Recently used paint colors"
                    title={
                      paintColorHistory.length > 0
                        ? "Recently used colors. Right-click to show full color history."
                        : "Colors appear here after they actually change painted pixels."
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (paintColorHistory.length > 0) setIsPaintColorHistoryOpen(true);
                    }}
                  >
                    {paintRecentColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        disabled={paintBrushMode === "restore"}
                        onClick={() => choosePaintColor(color)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setIsPaintColorHistoryOpen(true);
                        }}
                        className={`h-5 w-5 rounded-sm border disabled:cursor-not-allowed disabled:opacity-40 ${
                          paintColor === color ? "border-white" : "border-gray-600"
                        }`}
                        style={{ backgroundColor: color }}
                        title={`Use recent color ${color}; right-click for full history`}
                        aria-label={`Use recent color ${color}`}
                      />
                    ))}
                  </div>
                  {isPaintColorHistoryOpen && paintColorHistory.length > 0 && (
                    <div
                      className="absolute left-0 top-full z-50 mt-1 w-56 rounded border border-gray-600 bg-gray-950/95 p-2 shadow-xl"
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-gray-200">Used color history</span>
                        <button
                          type="button"
                          onClick={() => setIsPaintColorHistoryOpen(false)}
                          className="rounded px-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                          aria-label="Close color history"
                        >
                          ×
                        </button>
                      </div>
                      <div className="grid max-h-48 grid-cols-8 gap-1 overflow-y-auto">
                        {paintColorHistory.map((color) => (
                          <button
                            key={color}
                            type="button"
                            disabled={paintBrushMode === "restore"}
                            onClick={() => {
                              choosePaintColor(color);
                              setIsPaintColorHistoryOpen(false);
                            }}
                            className={`h-5 w-5 rounded-sm border disabled:cursor-not-allowed disabled:opacity-40 ${
                              paintColor === color ? "border-white" : "border-gray-600"
                            }`}
                            style={{ backgroundColor: color }}
                            title={`Use color ${color}`}
                            aria-label={`Use color ${color} from paint history`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setIsPaintEyedropperActive((active) => {
                      const next = !active;
                      if (next) {
                        setPaintSelectMode(undefined);
                        clearPaintHoverVisual();
                      }
                      return next;
                    })
                  }
                  className={`rounded border px-2 py-1 ${
                    isPaintEyedropperActive
                      ? "border-cyan-400 bg-cyan-900/60 text-cyan-100"
                      : "border-gray-600 bg-gray-800 hover:border-cyan-400"
                  }`}
                  title="Pick a BaseColour from the model, or hold Alt while clicking the model"
                >
                  Pick
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = paintSelectMode === "material" ? undefined : "material";
                    selectToolModeRef.current = next;
                    setPaintSelectMode(next);
                    setIsPaintEyedropperActive(false);
                    clearPaintHoverVisual();
                  }}
                  className={`rounded border px-2 py-1 ${
                    paintSelectMode === "material"
                      ? "border-cyan-400 bg-cyan-900/60 text-cyan-100"
                      : "border-gray-600 bg-gray-800 hover:border-cyan-400"
                  }`}
                  title="Select a material. Shift-click adds; Ctrl-click toggles."
                >
                  Select Material
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = paintSelectMode === "island" ? undefined : "island";
                    selectToolModeRef.current = next;
                    setPaintSelectMode(next);
                    setIsPaintEyedropperActive(false);
                    clearPaintHoverVisual();
                  }}
                  className={`rounded border px-2 py-1 ${
                    paintSelectMode === "island"
                      ? "border-violet-400 bg-violet-900/60 text-violet-100"
                      : "border-gray-600 bg-gray-800 hover:border-violet-400"
                  }`}
                  title="Select a UV island. Shift-click adds; Ctrl-click toggles."
                >
                  Select Island
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = paintSelectMode === "similar" ? undefined : "similar";
                    selectToolModeRef.current = next;
                    setPaintSelectMode(next);
                    setIsPaintEyedropperActive(false);
                    clearPaintHoverVisual();
                  }}
                  className={`rounded border px-2 py-1 ${
                    paintSelectMode === "similar"
                      ? "border-yellow-400 bg-yellow-900/60 text-yellow-100"
                      : "border-gray-600 bg-gray-800 hover:border-yellow-400"
                  }`}
                  title="Select texels similar to the clicked visible color. Shift adds; Ctrl toggles."
                >
                  Select Similar
                </button>
                {paintSelectMode === "similar" && (
                  <label className="flex items-center gap-1 text-gray-400" title="Perceptual OKLab color tolerance">
                    Tol
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={paintSimilarTolerance}
                      onChange={(event) => setPaintSimilarTolerance(Number(event.target.value))}
                      onWheel={(event) => adjustRangeFromWheel(event, setPaintSimilarTolerance)}
                      className="w-20 accent-yellow-500"
                      aria-label="Select Similar tolerance"
                    />
                    <span className="min-w-6 text-right tabular-nums text-yellow-200">{paintSimilarTolerance}</span>
                  </label>
                )}
                <label className="flex items-center gap-1 text-gray-400">
                  Size
                  <input
                    type="range"
                    min={4}
                    max={64}
                    step={1}
                    value={paintBrushRadius}
                    onChange={(event) => setPaintBrushRadius(Number(event.target.value))}
                    onWheel={(event) => adjustRangeFromWheel(event, setPaintBrushRadius)}
                    className="w-20 accent-blue-500"
                    aria-label="Brush size"
                  />
                </label>
                <label className="flex items-center gap-1 text-gray-400">
                  Opacity
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={paintBrushOpacity}
                    onChange={(event) => setPaintBrushOpacity(Number(event.target.value))}
                    onWheel={(event) => adjustRangeFromWheel(event, setPaintBrushOpacity)}
                    className="w-16 accent-blue-500"
                    aria-label="Brush opacity"
                  />
                </label>
                <label className="flex items-center gap-1 text-gray-400">
                  Hardness
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={paintBrushHardness}
                    onChange={(event) => setPaintBrushHardness(Number(event.target.value))}
                    onWheel={(event) => adjustRangeFromWheel(event, setPaintBrushHardness)}
                    className="w-16 accent-blue-500"
                    aria-label="Brush hardness"
                  />
                </label>
                <select
                  value={paintBrushMode}
                  onChange={(event) => setPaintBrushMode(event.target.value as UnitPainterBrushMode)}
                  aria-label="Brush mode"
                  title={paintBrushMode === "restore" ? "Erase the active layer to reveal layers/Base below" : "Brush mode"}
                  className="rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-xs text-gray-100"
                >
                  <option value="recolor">Recolor</option>
                  <option value="paint">Paint</option>
                  <option value="restore">Restore</option>
                </select>
                <button
                  type="button"
                  disabled={paintViewMode === "texture"}
                  onClick={() => setIsPaintSymmetryEnabled((enabled) => !enabled)}
                  className={`rounded border px-2 py-1 ${
                    isPaintSymmetryEnabled && paintViewMode !== "texture"
                      ? "border-fuchsia-400 bg-fuchsia-900/50 text-fuchsia-100"
                      : "border-gray-600 bg-gray-800 hover:border-fuchsia-400"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                  title={
                    paintViewMode === "texture"
                      ? "Model-space symmetry is available in the 3D or Split view."
                      : "Mirror brush strokes left/right across the model's local X=0 plane"
                  }
                >
                  Symmetry X
                </button>
                <label className="flex items-center gap-1 text-gray-400">
                  Scope
                  <select
                    value={paintScope}
                    onChange={(event) => {
                      const nextScope = event.target.value as UnitPainterSelectionScope;
                      if (paintSelectionPartition?.sourceScope !== nextScope) {
                        paintSessionRef.current?.removeSelectionPartition();
                      }
                      setPaintScope(nextScope);
                      paintScopeRef.current = nextScope;
                      refreshPaintSelectionVisual(nextScope);
                      clearPaintHoverVisual();
                    }}
                    disabled={!!paintSelectionPartition}
                    title={
                      paintSelectionPartition
                        ? "Remove the split before changing selection scope"
                        : "Paint scope"
                    }
                    aria-label="Paint scope"
                    className="rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-xs text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="all">All parts</option>
                    <option value="material" disabled={!paintSelection || paintScope === "similar"}>Selected material</option>
                    <option value="island" disabled={!paintSessionRef.current?.selectionHasUvIsland}>Selected UV island</option>
                    <option value="similar" disabled={!paintSessionRef.current?.hasSimilarSelection}>Selected similar colors</option>
                  </select>
                </label>
                {paintSelection && paintScope !== "similar" && !paintSelectionPartition && (
                  <label
                    className="flex items-center gap-1 text-gray-400"
                    title="Padding used by Fill and by scoped painting in the Texture view"
                  >
                    Pad
                    <select
                      value={paintTexturePadding}
                      onChange={(event) => setPaintTexturePadding(Number(event.target.value))}
                      aria-label="UV padding"
                      className="rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-xs text-gray-100"
                    >
                      {[0, 2, 4, 8].map((padding) => (
                        <option key={padding} value={padding}>{padding}px</option>
                      ))}
                    </select>
                  </label>
                )}
                {paintSelection && (
                  <>
                    <span
                      className={`max-w-40 truncate ${
                        paintScope === "island"
                          ? "text-violet-300"
                          : paintScope === "similar"
                            ? "text-yellow-300"
                            : "text-cyan-300"
                      }`}
                      title={
                        (paintSessionRef.current?.selectionCount ?? 0) > 1
                          ? `${paintSessionRef.current?.selectionCount} selections`
                          : `${paintSelection.objectName} · ${paintSelection.materialName}`
                      }
                    >
                      {paintScope === "similar"
                        ? "Similar colors selected"
                        : (paintSessionRef.current?.selectionCount ?? 0) > 1
                          ? `${paintSessionRef.current?.selectionCount} ${
                              paintScope === "island" ? "UV islands" : "materials"
                            } selected`
                          : `${paintSelection.objectName} · ${paintSelection.materialName}`}
                    </span>
                    {paintScope !== "all" && (
                      <>
                        <span className="text-gray-500">Split</span>
                        {([
                          ["vertical", "V", "Vertical split"],
                          ["horizontal", "H", "Horizontal split"],
                          ["slash", "/", "Diagonal / split"],
                          ["backslash", "\\", "Diagonal \\ split"],
                          ["x", "X", "Both diagonals"],
                        ] as Array<[UnitPainterSelectionSplitKind, string, string]>).map(([kind, label, title]) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => {
                              const session = paintSessionRef.current;
                              if (!session) return;
                              if (session.splitSelection(paintScope, kind)) {
                                clearPaintSelectionVisual();
                                setPaintHistoryVersion((value) => value + 1);
                              }
                            }}
                            className={`rounded border px-1.5 py-1 ${
                              paintSelectionPartition?.kind === kind
                                ? "border-yellow-400 bg-yellow-900/50 text-yellow-100"
                                : "border-gray-600 bg-gray-800 hover:border-yellow-400"
                            }`}
                            title={title}
                          >
                            {label}
                          </button>
                        ))}
                      </>
                    )}
                    {paintSelectionPartition && (
                      <>
                        <span className="text-gray-500">Region</span>
                        {paintSelectionPartition.regions.map((region) => (
                          <button
                            key={region.id}
                            type="button"
                            onClick={(event) => {
                              const operation =
                                event.ctrlKey ? "toggle" : event.shiftKey ? "add" : "replace";
                              if (paintSessionRef.current?.setSelectionPartitionRegion(region.id, operation)) {
                                setPaintHistoryVersion((value) => value + 1);
                              }
                            }}
                            className={`rounded border px-1.5 py-1 ${
                              region.active
                                ? "border-yellow-400 bg-yellow-900/50 text-yellow-100"
                                : "border-gray-600 bg-gray-800 hover:border-yellow-400"
                            }`}
                            title="Click selects this region. Shift adds; Ctrl toggles."
                          >
                            {region.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            if (paintSessionRef.current?.selectAllSelectionPartitionRegions()) {
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className={`rounded border px-1.5 py-1 ${
                            paintSelectionPartition.allActive
                              ? "border-yellow-400 bg-yellow-900/50 text-yellow-100"
                              : "border-gray-600 bg-gray-800 hover:border-yellow-400"
                          }`}
                          title="Activate the complete parent selection while keeping the split"
                        >
                          {paintSelectionPartition.regions.length === 2 ? "Both" : "All"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (paintSessionRef.current?.removeSelectionPartition()) {
                              refreshPaintSelectionVisual(paintScope);
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-1.5 py-1 hover:border-gray-400"
                          title="Remove the split and return to the parent selection"
                        >
                          Unsplit
                        </button>
                      </>
                    )}
                    {paintSelectionPartition ? (
                      <>
                        <button
                          type="button"
                          disabled={paintBrushMode === "restore"}
                          onClick={() => {
                            const scope = paintSelectionPartition?.sourceScope;
                            if (
                              scope
                              && paintSessionRef.current?.fillSelection(scope, brushSettingsRef.current)
                            ) {
                              rememberUsedPaintColor(paintColor);
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Fill the currently active split region"
                        >
                          Fill region
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const scope = paintSelectionPartition?.sourceScope;
                            if (scope && paintSessionRef.current?.resetSelection(scope)) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-amber-400"
                          title="Clear the active paint layer inside the current split region"
                        >
                          Clear region
                        </button>
                      </>
                    ) : paintScope === "similar" ? (
                      <>
                        <button
                          type="button"
                          disabled={paintBrushMode === "restore"}
                          onClick={() => {
                            if (paintSessionRef.current?.fillSelection("similar", brushSettingsRef.current)) {
                              rememberUsedPaintColor(paintColor);
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            paintBrushMode === "restore"
                              ? "Use Clear similar to erase this area from the active layer"
                              : "Fill the frozen similar-color selection"
                          }
                        >
                          Fill similar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (paintSessionRef.current?.resetSelection("similar")) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-amber-400"
                          title="Clear the active paint layer inside the similar-color selection"
                        >
                          Clear similar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={paintBrushMode === "restore"}
                          onClick={() => {
                            if (paintSessionRef.current?.fillSelection("material", brushSettingsRef.current, paintTexturePadding)) {
                              rememberUsedPaintColor(paintColor);
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            paintBrushMode === "restore"
                              ? "Use Clear material to erase this area from the active layer"
                              : "Fill the selected material UV footprint with the current color"
                          }
                        >
                          Fill material
                        </button>
                        <button
                          type="button"
                          disabled={!paintSessionRef.current?.selectionHasUvIsland || paintBrushMode === "restore"}
                          onClick={() => {
                            if (paintSessionRef.current?.fillSelection("island", brushSettingsRef.current, paintTexturePadding)) {
                              rememberUsedPaintColor(paintColor);
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            paintBrushMode === "restore"
                              ? "Use Clear island to erase this area from the active layer"
                              : "Fill only the selected UV island with the current color"
                          }
                        >
                          Fill island
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (paintSessionRef.current?.resetSelection("material")) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-amber-400"
                          title="Clear the active paint layer inside the selected material"
                        >
                          Clear material
                        </button>
                        <button
                          type="button"
                          disabled={!paintSessionRef.current?.selectionHasUvIsland}
                          onClick={() => {
                            if (paintSessionRef.current?.resetSelection("island")) {
                              setPaintExportStatus("");
                              setPaintHistoryVersion((value) => value + 1);
                            }
                          }}
                          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Clear the active paint layer inside the selected UV island"
                        >
                          Clear island
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={clearPaintSelection}
                      className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-gray-400"
                      title="Clear the current painter selection"
                    >
                      Clear selection
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={!paintSessionRef.current?.canUndo}
                  onClick={() => {
                    if (paintSessionRef.current?.undo()) setPaintHistoryVersion((value) => value + 1);
                  }}
                  title="Undo (Ctrl+Z)"
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={!paintSessionRef.current?.canRedo}
                  onClick={() => {
                    if (paintSessionRef.current?.redo()) setPaintHistoryVersion((value) => value + 1);
                  }}
                  title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Redo
                </button>
                <button
                  type="button"
                  disabled={!paintSessionRef.current}
                  onClick={() => {
                    if (paintSessionRef.current?.reset()) {
                      setPaintExportStatus("");
                      setPaintHistoryVersion((value) => value + 1);
                    }
                  }}
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Clear all paint from the active layer"
                >
                  Clear layer
                </button>
                <button
                  type="button"
                  disabled={!paintSessionRef.current || isPaintExporting}
                  onClick={() => savePaintedMod(paintPackPath ? "save" : "create")}
                  className="rounded border border-blue-500 bg-blue-700/40 px-2 py-1 text-blue-100 hover:bg-blue-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                  title={paintPackPath ? `Save to ${paintPackPath}` : "Create a painted mod pack"}
                >
                  {isPaintExporting
                    ? paintPackPath
                      ? "Saving…"
                      : "Creating…"
                    : paintPackPath
                      ? "Save painted mod"
                      : "Create painted mod"}
                </button>
                {paintPackPath && (
                  <button
                    type="button"
                    disabled={!paintSessionRef.current || isPaintExporting}
                    onClick={() => savePaintedMod("saveAs")}
                    className="rounded border border-gray-600 bg-gray-800 px-2 py-1 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Save the painted mod to a different pack"
                  >
                    Save As…
                  </button>
                )}
                {paintPackPath ? (
                  <span
                    className={paintHasUnsavedChanges ? "font-medium text-amber-300" : "font-medium text-emerald-300"}
                    title={paintHasUnsavedChanges ? "The painted mod has unsaved changes" : "The painted mod matches the last successful save"}
                  >
                    {paintHasUnsavedChanges ? "Modified" : "Saved"}
                  </span>
                ) : paintHasUnsavedChanges ? (
                  <span className="font-medium text-amber-300" title="Paint changes have not been saved to a mod yet">
                    Modified
                  </span>
                ) : null}
                {paintTextureCount === 0 && <span className="text-amber-300">No editable base-colour texture</span>}
                {paintExportStatus && <span className="max-w-56 truncate text-gray-300" title={paintExportStatus}>{paintExportStatus}</span>}
              </>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-black/50 px-2 py-1 text-[11px] text-gray-300">
          {painterEnabledRef.current
            ? "Left drag: paint · B: brush · E: restore · [/]: size · Shift+[/]: hardness · X: symmetry · Alt+click: pick color · Alt+drag: orbit · Select Material/Island: hover then click to lock · Esc: clear selection · Ctrl+Z/Y: undo/redo · Right drag: pan · Wheel: zoom"
            : "Left drag: orbit · Right drag: pan · Wheel: zoom"}
        </div>
      </div>
      {variantMeshSessionId && !variantCatalogReady && (
        <div className="shrink-0 border-t border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-400">
          {localized.unitViewerLoadingAppearances || "Loading unit appearances…"}
        </div>
      )}
      {variantMeshSessionId && variantCatalog && activeVariantSlots.length > 0 && (
        <div className="shrink-0 border-t border-gray-700 bg-gray-900 px-3 py-2">
          <div className="mb-1 flex items-baseline gap-2 text-xs">
            <span className="font-semibold text-gray-200">{localized.unitViewerAppearance || "Appearance"}</span>
            <span className="text-gray-500">
              {(localized.unitViewerAppearanceCombinations || "{{count}} combinations").replace(
                "{{count}}",
                `${variantCatalog.combinationCount.toLocaleString()}${variantCatalog.combinationCountCapped ? "+" : ""}`,
              )}
            </span>
            {allVariantSlots.length > 0 && (
              <span className="text-blue-300">
                {comparisonModelCount} models
                {comparisonColumnSlot ? ` · columns: ${comparisonColumnSlot.label}` : ""}
                {comparisonRowSlot ? ` · rows: ${comparisonRowSlot.label}` : ""}
                {comparisonLayerSlot ? ` · layers: ${comparisonLayerSlot.label}` : ""}
              </span>
            )}
          </div>
          <div className="flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-auto">
            {activeVariantSlots.map((slot) => (
              <label key={slot.slotPath} className="flex min-w-36 flex-1 items-center gap-1 text-[11px] text-gray-400">
                <span className="max-w-28 shrink-0 truncate" title={slot.slotPath}>
                  {slot.label}
                </span>
                <select
                  aria-label={`Appearance: ${slot.label}`}
                  value={variantSelections[slot.slotPath] ?? slot.defaultChoiceIndex}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    const previousValue = variantSelections[slot.slotPath] ?? slot.defaultChoiceIndex;
                    const context = contextRef.current;
                    if (
                      status === "ready" &&
                      context &&
                      previousValue !== ALL_VARIANTS &&
                      nextValue !== ALL_VARIANTS
                    ) {
                      pendingCameraViewRef.current = { assetPath, view: captureCameraView(context) };
                    } else if (previousValue === ALL_VARIANTS || nextValue === ALL_VARIANTS) {
                      pendingCameraViewRef.current = null;
                    }
                    setVariantSelections((current) => ({
                      ...current,
                      [slot.slotPath]: nextValue,
                    }));
                  }}
                  className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-xs text-gray-100"
                >
                  <option
                    value={ALL_VARIANTS}
                    disabled={!allVariantSlotPaths.has(slot.slotPath) && allVariantSlotPaths.size >= 3}
                  >
                    All
                  </option>
                  {slot.choices.map((choice) => (
                    <option key={choice.key} value={choice.index}>
                      {choice.index + 1} · {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {comparisonColumnSlot && (
            <div
              className="mt-1 truncate text-[10px] text-gray-500"
              title={comparisonColumnSlot.choices.map((choice) => `${choice.index + 1}: ${choice.label}`).join(" · ")}
            >
              Columns: {comparisonColumnSlot.choices.map((choice) => `${choice.index + 1}: ${choice.label}`).join(" · ")}
            </div>
          )}
          {comparisonRowSlot && (
            <div
              className="truncate text-[10px] text-gray-500"
              title={comparisonRowSlot.choices.map((choice) => `${choice.index + 1}: ${choice.label}`).join(" · ")}
            >
              Rows: {comparisonRowSlot.choices.map((choice) => `${choice.index + 1}: ${choice.label}`).join(" · ")}
            </div>
          )}
          {comparisonLayerSlot && (
            <div
              className="truncate text-[10px] text-gray-500"
              title={comparisonLayerSlot.choices.map((choice) => `${choice.index + 1}: ${choice.label}`).join(" · ")}
            >
              Layers: {comparisonLayerSlot.choices.map((choice) => `${choice.index + 1}: ${choice.label}`).join(" · ")}
            </div>
          )}
        </div>
      )}
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-t border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300">
        <button
          type="button"
          disabled={!clipDuration}
          onClick={() => setIsPlaying((playing) => !playing)}
          aria-label={isPlaying ? "Pause animation" : "Play animation"}
          title={isPlaying ? "Pause animation" : "Play animation"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? <IoPause size={14} /> : <IoPlay size={14} />}
        </button>
        <button
          type="button"
          disabled={!clipDuration}
          onClick={() => {
            seekAnimation(0);
            setIsPlaying(true);
          }}
          aria-label="Restart animation"
          title="Restart animation"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IoRefresh size={14} />
        </button>
        {animationOptions.length > 0 ? (
          <select
            value={selectedAnimationPath}
            onChange={(event) => {
              setCurrentTime(0);
              setIsPlaying(true);
              setSelectedAnimationPath(event.target.value);
            }}
            aria-label="Animation"
            title={selectedAnimationPath}
            className="min-w-0 max-w-[18rem] flex-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100"
          >
            {animationOptions.map((animation) => (
              <option key={animation.path} value={animation.path}>
                {animation.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-gray-500">No animations available</span>
        )}
        <select
          value={animationSpeed}
          onChange={(event) => setAnimationSpeed(Number(event.target.value))}
          aria-label="Animation speed"
          title="Animation speed"
          disabled={!clipDuration}
          className="w-[4.5rem] shrink-0 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ANIMATION_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {Math.round(speed * 100)}%
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={clipDuration || 1}
          step={0.01}
          value={Math.min(currentTime, clipDuration || 1)}
          onChange={(event) => seekAnimation(Number(event.target.value))}
          onWheel={(event) => adjustRangeFromWheel(event, seekAnimation)}
          aria-label="Animation timeline"
          disabled={!clipDuration}
          className="hidden min-w-24 flex-[2] accent-blue-500 sm:block"
        />
        <span className="w-16 shrink-0 text-right tabular-nums text-gray-500">
          {clipDuration ? `${formatAnimationTime(currentTime)} / ${formatAnimationTime(clipDuration)}` : "—"}
        </span>
      </div>
      {visibleWarnings.length > 0 && (
        <div className="shrink-0 border-t border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {visibleWarnings.join(" | ")}
        </div>
      )}
    </div>
  );
});

export default VisualsModelPreview;
