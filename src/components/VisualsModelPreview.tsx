import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Wh3Ktx2Loader } from "../visuals/Wh3Ktx2Loader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IoPause, IoPlay, IoRefresh } from "react-icons/io5";
import { useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";
import {
  exportVisualsModel,
  exportVisualsModelBatch,
  getVisualsModelAnimationCatalog,
  releaseVisualsModelPreview,
  reportVisualsModelPreviewTiming,
} from "../visuals/modelPreviewApi";
import { filterVisualsModelPreviewWarnings } from "../visuals/modelPreviewWarnings";
import { selectDefaultAnimation } from "../visuals/animationSelection";
import { getActiveVariantMeshSlots, type VariantMeshCatalog, type VariantMeshSelection } from "../visuals/variantMesh";

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

const NONE_ANIMATION: PreviewAnimation = { path: "", label: "None" };
const ALL_VARIANTS = -1;
const MAX_COMPARISON_MODELS = 100;
const PREVIEW_GEOMETRY_KEY = "__wh3PreviewGeometryKey";

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
  return [
    rawKey,
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
  const catalogLoadingRef = useRef(true);
  const isPlayingRef = useRef(true);
  const animationSpeedRef = useRef(1);
  const pendingCameraViewRef = useRef<{ assetPath: string; view: CameraView } | null>(null);
  const loadedAnimationCatalogKeyRef = useRef<string>();
  const loadedVariantCatalogKeyRef = useRef<string>();
  const animationCatalogKey = useMemo(() => JSON.stringify([assetPath, enabledMods]), [assetPath, enabledMods]);
  const variantCatalogKey = `${variantMeshSessionType}\0${variantMeshSessionId ?? ""}\0${assetPath}`;
  const visibleWarnings = filterVisualsModelPreviewWarnings(warnings, isFeaturesForModdersEnabled);

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
        const result = await getVisualsModelAnimationCatalog(assetPath, enabledMods);
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
  }, [animationCatalogKey, assetPath, enabledMods, isActive]);

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
        let exportsToLoad: Array<{ previewId: string; url: string; warnings?: string[] }>;

        if (comparisonVariants.length === 1) {
          const exportStartedAt = performance.now();
          const exportResult = await exportVisualsModel(
            assetPath,
            enabledMods,
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
            enabledMods,
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
    enabledMods,
    isActive,
    selectedAnimationPath,
    unsyncedAnimations,
    variantCatalogDiagnostics,
    variantCatalogReady,
  ]);

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-950">
      <div className="relative min-h-0 flex-1 w-full overflow-hidden">
        <div ref={mountRef} className="absolute inset-0" />
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
        <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-black/50 px-2 py-1 text-[11px] text-gray-300">
          Left drag: orbit · Right drag: pan · Wheel: zoom
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
