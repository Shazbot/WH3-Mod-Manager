import React, { memo, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Wh3Ktx2Loader, type Wh3Ktx2Timing } from "../visuals/Wh3Ktx2Loader";
import {
  exportVisualsModel,
  releaseVisualsModelPreview,
  type VisualsModelPreviewMod,
} from "../visuals/modelPreviewApi";
import type { VariantMeshSelection } from "../visuals/variantMesh";
import {
  generateArmyBenchmarkRoster,
  parseArmyBenchmarkRoster,
  serializeArmyBenchmarkRoster,
  type ArmyBenchmarkCandidate,
  type ArmyBenchmarkRosterFile,
} from "../visuals/armyBenchmark";

type BenchmarkMod = VisualsModelPreviewMod & {
  isEnabled?: boolean;
};

type BenchmarkPackPair = {
  id: string;
  original: BenchmarkMod;
  atlas: BenchmarkMod;
};

type BenchmarkProfile = "quick" | "deep";
type BenchmarkMode = "asset" | "army";

type BenchmarkRow = {
  instances: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  rendererTextureObjects: number;
  cpuMeanMs: number;
  cpuMedianMs: number;
  cpuP95Ms: number;
  cpuP99Ms: number;
  gpuMeanMs?: number;
};

type BenchmarkSourceResult = {
  packPath: string;
  exportMs: number;
  loadMs: number;
  texturePreloadMs: number;
  materialTextureObjects: number;
  ktx2: Wh3Ktx2Timing;
  rows: BenchmarkRow[];
};

type BenchmarkComparisonResult = {
  mode: BenchmarkMode;
  assetPath: string;
  armyRoster?: ArmyBenchmarkRosterFile;
  profile: BenchmarkProfile;
  warmupFrames: number;
  sampleFrames: number;
  width: number;
  height: number;
  generatedAt: string;
  original: BenchmarkSourceResult;
  atlas: BenchmarkSourceResult;
};

type VisualsRenderBenchmarkProps = {
  assetPath: string;
  availableMods: readonly BenchmarkMod[];
  enabledMods: readonly BenchmarkMod[];
  variantSelections: readonly VariantMeshSelection[];
  benchmarkUnits: readonly ArmyBenchmarkCandidate[];
  disabled?: boolean;
  onRunningChange?: (running: boolean) => void;
};

type GpuTimerExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

const BENCHMARK_COUNTS = [1, 10, 25, 50, 100, 250] as const;
const BENCHMARK_WIDTH = 960;
const BENCHMARK_HEIGHT = 540;
const BENCHMARK_PROFILES: Record<BenchmarkProfile, { warmupFrames: number; sampleFrames: number }> = {
  quick: { warmupFrames: 40, sampleFrames: 160 },
  deep: { warmupFrames: 300, sampleFrames: 1000 },
};

const normalizePath = (value: string) => value.replace(/\//g, "\\").toLowerCase();
const fileName = (value: string) => value.replace(/\\/g, "/").split("/").pop() ?? value;
const directoryName = (value: string) => {
  const normalized = value.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator).toLowerCase();
};
const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const findPackPairs = (mods: readonly BenchmarkMod[]): BenchmarkPackPair[] => {
  const byFileName = new Map<string, BenchmarkMod[]>();
  for (const mod of mods) {
    const name = fileName(mod.path).toLowerCase();
    const entries = byFileName.get(name) ?? [];
    entries.push(mod);
    byFileName.set(name, entries);
  }

  const pairs: BenchmarkPackPair[] = [];
  for (const atlas of mods) {
    const atlasName = fileName(atlas.path);
    if (!/_atlas\.pack$/i.test(atlasName)) continue;
    const originalName = atlasName.replace(/_atlas(\.pack)$/i, "$1").toLowerCase();
    const originals = byFileName.get(originalName) ?? [];
    const atlasDirectory = directoryName(atlas.path);
    const original =
      originals.find(
        (candidate) =>
          directoryName(candidate.path) === atlasDirectory
          && !normalizePath(candidate.path).includes("_atlas.pack"),
      )
      ?? originals.find((candidate) => !normalizePath(candidate.path).includes("_atlas.pack"));
    if (!original) continue;
    pairs.push({
      id: `${normalizePath(original.path)}\0${normalizePath(atlas.path)}`,
      original,
      atlas,
    });
  }

  return pairs.sort((left, right) =>
    fileName(left.original.path).localeCompare(fileName(right.original.path), undefined, { sensitivity: "base" }),
  );
};

const percentile = (sorted: readonly number[], fraction: number) => {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
};

const summarizeCpuTimes = (samples: readonly number[]) => {
  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    mean: sorted.length > 0 ? sum / sorted.length : 0,
    median:
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)],
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
};

const getGpuTimer = (renderer: THREE.WebGLRenderer) => {
  const gl = renderer.getContext();
  if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return undefined;
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as GpuTimerExtension | null;
  return extension ? { gl, extension } : undefined;
};

const waitForGpuQuery = async (
  gl: WebGL2RenderingContext,
  extension: GpuTimerExtension,
  query: WebGLQuery,
): Promise<number | undefined> => {
  const startedAt = performance.now();
  while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
    if (performance.now() - startedAt > 15000) {
      gl.deleteQuery(query);
      return undefined;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 4));
  }

  const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
  const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
  gl.deleteQuery(query);
  return disjoint || !Number.isFinite(nanoseconds) ? undefined : nanoseconds / 1_000_000;
};

const getMaterialTextureObjects = (root: THREE.Object3D) => {
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  return [...textures];
};

const disposeSkinnedInstanceResources = (root: THREE.Object3D) => {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) skeletons.add(child.skeleton);
  });
  skeletons.forEach((skeleton) => skeleton.dispose());
};

const disposeLoadedObject = (root: THREE.Object3D) => {
  disposeSkinnedInstanceResources(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
};

const buildInstanceGroup = (source: THREE.Object3D, instanceCount: number) => {
  const sourceBounds = new THREE.Box3().setFromObject(source);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const spacingX = Math.max(sourceSize.x, 0.25) * 1.2;
  const spacingZ = Math.max(sourceSize.z, 0.25) * 1.2;
  const columns = Math.ceil(Math.sqrt(instanceCount));
  const rows = Math.ceil(instanceCount / columns);
  const group = new THREE.Group();

  for (let index = 0; index < instanceCount; index += 1) {
    const clone = cloneSkinnedObject(source);
    const column = index % columns;
    const row = Math.floor(index / columns);
    clone.position.x += (column - (columns - 1) / 2) * spacingX;
    clone.position.z += (row - (rows - 1) / 2) * spacingZ;
    group.add(clone);
  }

  return group;
};

const frameBenchmarkGroup = (
  camera: THREE.PerspectiveCamera,
  group: THREE.Object3D,
) => {
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.25);
  const fovRadians = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDimension / (2 * Math.tan(fovRadians / 2))) * 1.35;
  const direction = new THREE.Vector3(1, 0.7, 1).normalize();

  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(100, distance * 10 + maxDimension * 2);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
};

const runPreparedGroup = async (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  group: THREE.Group,
  instances: number,
  warmupFrames: number,
  sampleFrames: number,
): Promise<BenchmarkRow> => {
  scene.add(group);
  frameBenchmarkGroup(camera, group);

  try {
    for (let frame = 0; frame < warmupFrames; frame += 1) {
      renderer.render(scene, camera);
      if ((frame + 1) % 20 === 0) await yieldToUi();
    }

    renderer.getContext().finish();

    const cpuSamples: number[] = [];
    const gpuTimer = getGpuTimer(renderer);
    let query: WebGLQuery | undefined;
    if (gpuTimer) {
      query = gpuTimer.gl.createQuery() ?? undefined;
      if (query) gpuTimer.gl.beginQuery(gpuTimer.extension.TIME_ELAPSED_EXT, query);
    }

    try {
      for (let frame = 0; frame < sampleFrames; frame += 1) {
        const startedAt = performance.now();
        renderer.render(scene, camera);
        cpuSamples.push(performance.now() - startedAt);
        if ((frame + 1) % 20 === 0) await yieldToUi();
      }
    } finally {
      if (query && gpuTimer) {
        gpuTimer.gl.endQuery(gpuTimer.extension.TIME_ELAPSED_EXT);
        gpuTimer.gl.flush();
      }
    }

    const cpu = summarizeCpuTimes(cpuSamples);
    const gpuTotalMs =
      query && gpuTimer
        ? await waitForGpuQuery(gpuTimer.gl, gpuTimer.extension, query)
        : undefined;

    return {
      instances,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      rendererTextureObjects: renderer.info.memory.textures,
      cpuMeanMs: cpu.mean,
      cpuMedianMs: cpu.median,
      cpuP95Ms: cpu.p95,
      cpuP99Ms: cpu.p99,
      gpuMeanMs: gpuTotalMs == null ? undefined : gpuTotalMs / sampleFrames,
    };
  } finally {
    scene.remove(group);
    disposeSkinnedInstanceResources(group);
    group.clear();

    // Skeleton bone textures are allocated lazily per cloned skinned instance.
    // Flush a frame after disposing them so renderer.info and the next sample do
    // not inherit GPU resources from earlier instance-count steps.
    renderer.info.reset();
    renderer.render(scene, camera);
    renderer.getContext().finish();
    renderer.info.reset();
  }
};

const runInstanceCount = (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  source: THREE.Object3D,
  instances: number,
  warmupFrames: number,
  sampleFrames: number,
): Promise<BenchmarkRow> =>
  runPreparedGroup(
    renderer,
    scene,
    camera,
    buildInstanceGroup(source, instances),
    instances,
    warmupFrames,
    sampleFrames,
  );

type LoadedArmyAsset = {
  source: THREE.Object3D;
  entities: number;
};

const buildArmyGroup = async (assets: readonly LoadedArmyAsset[]) => {
  let maxWidth = 0.25;
  let maxDepth = 0.25;
  let totalEntities = 0;
  for (const asset of assets) {
    const size = new THREE.Box3().setFromObject(asset.source).getSize(new THREE.Vector3());
    maxWidth = Math.max(maxWidth, size.x);
    maxDepth = Math.max(maxDepth, size.z);
    totalEntities += asset.entities;
  }

  const spacingX = maxWidth * 1.2;
  const spacingZ = maxDepth * 1.2;
  const columns = Math.ceil(Math.sqrt(totalEntities));
  const group = new THREE.Group();
  let entityIndex = 0;

  for (const asset of assets) {
    for (let index = 0; index < asset.entities; index += 1) {
      const clone = cloneSkinnedObject(asset.source);
      const column = entityIndex % columns;
      const row = Math.floor(entityIndex / columns);
      clone.position.x += (column - (columns - 1) / 2) * spacingX;
      clone.position.z += (row - (rows - 1) / 2) * spacingZ;
      group.add(clone);
      entityIndex += 1;
      if (entityIndex % 100 === 0) await yieldToUi();
    }
  }

  return { group, totalEntities };
};

const createBenchmarkRenderer = () => {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(BENCHMARK_WIDTH, BENCHMARK_HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  return renderer;
};

const createBenchmarkEnvironment = () => {
  const renderer = createBenchmarkRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111827);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
  keyLight.position.set(4, 7, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xbfd7ff, 1.4);
  fillLight.position.set(-4, 3, -2);
  scene.add(fillLight);
  const camera = new THREE.PerspectiveCamera(
    35,
    BENCHMARK_WIDTH / BENCHMARK_HEIGHT,
    0.01,
    1000,
  );
  return { renderer, scene, camera };
};

const disposeBenchmarkEnvironment = (environment: ReturnType<typeof createBenchmarkEnvironment>) => {
  environment.renderer.dispose();
  environment.renderer.forceContextLoss();
};

const buildSourceMods = (
  enabledMods: readonly BenchmarkMod[],
  pair: BenchmarkPackPair,
  source: BenchmarkMod,
): VisualsModelPreviewMod[] => {
  const originalPath = normalizePath(pair.original.path);
  const atlasPath = normalizePath(pair.atlas.path);
  const activePairMod = enabledMods.find((mod) => {
    const path = normalizePath(mod.path);
    return mod.isEnabled !== false && (path === originalPath || path === atlasPath);
  });
  const pairLoadOrder =
    activePairMod?.loadOrder
    ?? pair.original.loadOrder
    ?? pair.atlas.loadOrder;

  const common = enabledMods
    .filter((mod) => mod.isEnabled !== false)
    .filter((mod) => {
      const path = normalizePath(mod.path);
      return path !== originalPath && path !== atlasPath;
    })
    .map(({ name, path, loadOrder }) => ({ name, path, loadOrder }));

  return [
    ...common,
    { name: source.name, path: source.path, loadOrder: pairLoadOrder },
  ].sort((left, right) => (left.loadOrder ?? 0) - (right.loadOrder ?? 0));
};

const benchmarkSource = async (
  assetPath: string,
  enabledMods: readonly BenchmarkMod[],
  pair: BenchmarkPackPair,
  source: BenchmarkMod,
  variantSelections: readonly VariantMeshSelection[],
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  warmupFrames: number,
  sampleFrames: number,
  onProgress: (message: string) => void,
): Promise<BenchmarkSourceResult> => {
  const sourceMods = buildSourceMods(enabledMods, pair, source);
  const exportStartedAt = performance.now();
  const exported = await exportVisualsModel(assetPath, sourceMods, [], variantSelections);
  const exportMs = performance.now() - exportStartedAt;
  if (!exported.success || !exported.previewId || !exported.url) {
    throw new Error(exported.error || `Failed to export ${fileName(source.path)}.`);
  }

  const previewId = exported.previewId;
  let loadedRoot: THREE.Object3D | undefined;
  try {
    const ktx2Loader = new Wh3Ktx2Loader(renderer);
    ktx2Loader.detectSupport(renderer);
    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2Loader);

    const loadStartedAt = performance.now();
    const gltf = await loader.loadAsync(exported.url);
    const loadMs = performance.now() - loadStartedAt;
    loadedRoot = gltf.scene;
    const materialTextures = getMaterialTextureObjects(loadedRoot);
    const materialTextureObjects = materialTextures.length;

    // WHMM's normal preview path explicitly uploads textures after GLTFLoader has
    // applied sampler state. Do the same here so the measured render queries never
    // absorb lazy texture initialization/upload work.
    const texturePreloadStartedAt = performance.now();
    for (const texture of materialTextures) ktx2Loader.preloadTexture(texture);
    renderer.getContext().finish();
    const texturePreloadMs = performance.now() - texturePreloadStartedAt;

    const rows: BenchmarkRow[] = [];
    for (const instances of BENCHMARK_COUNTS) {
      onProgress(`${fileName(source.path)} · ${instances} instance${instances === 1 ? "" : "s"}`);
      rows.push(
        await runInstanceCount(
          renderer,
          scene,
          camera,
          loadedRoot,
          instances,
          warmupFrames,
          sampleFrames,
        ),
      );
    }

    const ktx2 = ktx2Loader.getTiming();
    ktx2Loader.clearRawTextureDataCache();
    return {
      packPath: source.path,
      exportMs,
      loadMs,
      texturePreloadMs,
      materialTextureObjects,
      ktx2,
      rows,
    };
  } finally {
    if (loadedRoot) disposeLoadedObject(loadedRoot);
    await releaseVisualsModelPreview(previewId).catch(() => undefined);
  }
};

const benchmarkArmySource = async (
  roster: ArmyBenchmarkRosterFile,
  enabledMods: readonly BenchmarkMod[],
  pair: BenchmarkPackPair,
  source: BenchmarkMod,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  warmupFrames: number,
  sampleFrames: number,
  onProgress: (message: string) => void,
): Promise<BenchmarkSourceResult> => {
  const sourceMods = buildSourceMods(enabledMods, pair, source);
  const byAssetPath = new Map<string, { assetPath: string; entities: number; names: string[] }>();
  for (const unit of roster.units) {
    const key = normalizePath(unit.assetPath);
    const existing = byAssetPath.get(key);
    if (existing) {
      existing.entities += unit.entities;
      existing.names.push(unit.name);
    } else {
      byAssetPath.set(key, {
        assetPath: unit.assetPath,
        entities: unit.entities,
        names: [unit.name],
      });
    }
  }

  const loadedAssets: LoadedArmyAsset[] = [];
  const previewIds: string[] = [];
  const loadedRoots: THREE.Object3D[] = [];
  const materialTextures = new Set<THREE.Texture>();
  let exportMs = 0;
  let loadMs = 0;
  let group: THREE.Group | undefined;
  const ktx2Loader = new Wh3Ktx2Loader(renderer);
  ktx2Loader.detectSupport(renderer);
  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader);

  try {
    const entries = [...byAssetPath.values()];
    for (const [index, entry] of entries.entries()) {
      onProgress(
        `${fileName(source.path)} · loading army unit ${index + 1}/${entries.length} · ${entry.names[0]}`,
      );
      const exportStartedAt = performance.now();
      const exported = await exportVisualsModel(entry.assetPath, sourceMods, [], []);
      exportMs += performance.now() - exportStartedAt;
      if (!exported.success || !exported.previewId || !exported.url) {
        throw new Error(exported.error || `Failed to export ${entry.assetPath}.`);
      }
      previewIds.push(exported.previewId);

      const loadStartedAt = performance.now();
      const gltf = await loader.loadAsync(exported.url);
      loadMs += performance.now() - loadStartedAt;
      const root = gltf.scene;
      loadedRoots.push(root);
      getMaterialTextureObjects(root).forEach((texture) => materialTextures.add(texture));
      loadedAssets.push({ source: root, entities: entry.entities });
      await yieldToUi();
    }

    const texturePreloadStartedAt = performance.now();
    for (const texture of materialTextures) ktx2Loader.preloadTexture(texture);
    renderer.getContext().finish();
    const texturePreloadMs = performance.now() - texturePreloadStartedAt;

    onProgress(
      `${fileName(source.path)} · building ${roster.units.length}-unit army · ${roster.units.reduce((sum, unit) => sum + unit.entities, 0).toLocaleString()} entities`,
    );
    const built = await buildArmyGroup(loadedAssets);
    group = built.group;
    onProgress(
      `${fileName(source.path)} · measuring whole army · ${built.totalEntities.toLocaleString()} entities`,
    );
    const row = await runPreparedGroup(
      renderer,
      scene,
      camera,
      group,
      built.totalEntities,
      warmupFrames,
      sampleFrames,
    );
    group = undefined;

    const ktx2 = ktx2Loader.getTiming();
    ktx2Loader.clearRawTextureDataCache();
    return {
      packPath: source.path,
      exportMs,
      loadMs,
      texturePreloadMs,
      materialTextureObjects: materialTextures.size,
      ktx2,
      rows: [row],
    };
  } finally {
    if (group) {
      disposeSkinnedInstanceResources(group);
      group.clear();
    }
    for (const root of loadedRoots) disposeLoadedObject(root);
    await Promise.all(previewIds.map((previewId) => releaseVisualsModelPreview(previewId).catch(() => undefined)));
  }
};

const downloadJson = (fileNameValue: string, value: string) => {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileNameValue;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const formatMs = (value?: number) => (value == null ? "—" : value.toFixed(value < 1 ? 3 : 2));
const formatMiB = (bytes?: number) => (bytes == null ? "—" : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`);
const formatDelta = (baseline: number | undefined, candidate: number | undefined) => {
  if (baseline == null || candidate == null || baseline === 0) return "—";
  const delta = ((candidate / baseline) - 1) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
};

const VisualsRenderBenchmark = memo(({
  assetPath,
  availableMods,
  enabledMods,
  variantSelections,
  benchmarkUnits,
  disabled = false,
  onRunningChange,
}: VisualsRenderBenchmarkProps) => {
  const pairs = useMemo(() => findPackPairs(availableMods), [availableMods]);
  const [selectedPairId, setSelectedPairId] = useState("");
  const [mode, setMode] = useState<BenchmarkMode>("asset");
  const [profile, setProfile] = useState<BenchmarkProfile>("quick");
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<BenchmarkComparisonResult>();
  const [armyRoster, setArmyRoster] = useState<ArmyBenchmarkRosterFile>();
  const armyImportRef = useRef<HTMLInputElement>(null);

  const selectedPair =
    pairs.find((pair) => pair.id === selectedPairId)
    ?? pairs[0];

  const createRandomArmy = () => {
    if (!selectedPair) return undefined;
    const originalPath = normalizePath(selectedPair.original.path);
    const atlasPath = normalizePath(selectedPair.atlas.path);
    // Visuals data describes whichever side of the pair is currently enabled. Treat
    // units originating from the atlas pack as belonging to the original pack too,
    // so random generation stays scoped to this mod before falling back globally.
    const generationUnits = benchmarkUnits.map((unit) => {
      const origin = normalizePath(unit.originPackPath);
      return origin === originalPath || origin === atlasPath
        ? { ...unit, originPackPath: selectedPair.original.path }
        : unit;
    });
    const roster = generateArmyBenchmarkRoster(generationUnits, selectedPair.original.path);
    setArmyRoster(roster);
    setError("");
    return roster;
  };

  const exportArmy = () => {
    if (!armyRoster) return;
    const stamp = armyRoster.generatedAt.replace(/[:.]/g, "-");
    downloadJson(`whmm-army-benchmark-${stamp}.json`, serializeArmyBenchmarkRoster(armyRoster));
  };

  const importArmy = async (file?: File) => {
    if (!file) return;
    try {
      const roster = parseArmyBenchmarkRoster(await file.text());
      setArmyRoster(roster);
      setMode("army");
      setResult(undefined);
      setError("");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import army benchmark list.");
    }
  };

  const runBenchmark = () => {
    if (!selectedPair || isRunning) return;
    void (async () => {
      setIsRunning(true);
      onRunningChange?.(true);
      setError("");
      setResult(undefined);
      const benchmarkProfile = BENCHMARK_PROFILES[profile];

      try {
        const rosterForRun =
          mode === "army"
            ? armyRoster ?? createRandomArmy()
            : undefined;
        if (mode === "army" && !rosterForRun) {
          throw new Error("No army benchmark roster is available.");
        }
        let originalEnvironment: ReturnType<typeof createBenchmarkEnvironment>;
        try {
          originalEnvironment = createBenchmarkEnvironment();
        } catch (rendererError) {
          throw new Error(
            rendererError instanceof Error
              ? rendererError.message
              : "Unable to create the original benchmark WebGL renderer.",
          );
        }

        let original: BenchmarkSourceResult;
        try {
          setProgress(`Exporting ${fileName(selectedPair.original.path)}`);
          original =
            mode === "army"
              ? await benchmarkArmySource(
                  rosterForRun!,
                  enabledMods,
                  selectedPair,
                  selectedPair.original,
                  originalEnvironment.renderer,
                  originalEnvironment.scene,
                  originalEnvironment.camera,
                  benchmarkProfile.warmupFrames,
                  benchmarkProfile.sampleFrames,
                  setProgress,
                )
              : await benchmarkSource(
                  assetPath,
                  enabledMods,
                  selectedPair,
                  selectedPair.original,
                  variantSelections,
                  originalEnvironment.renderer,
                  originalEnvironment.scene,
                  originalEnvironment.camera,
                  benchmarkProfile.warmupFrames,
                  benchmarkProfile.sampleFrames,
                  setProgress,
                );
        } finally {
          disposeBenchmarkEnvironment(originalEnvironment);
        }

        await yieldToUi();

        let atlasEnvironment: ReturnType<typeof createBenchmarkEnvironment>;
        try {
          atlasEnvironment = createBenchmarkEnvironment();
        } catch (rendererError) {
          throw new Error(
            rendererError instanceof Error
              ? rendererError.message
              : "Unable to create the atlas benchmark WebGL renderer.",
          );
        }

        let atlas: BenchmarkSourceResult;
        try {
          setProgress(`Exporting ${fileName(selectedPair.atlas.path)}`);
          atlas =
            mode === "army"
              ? await benchmarkArmySource(
                  rosterForRun!,
                  enabledMods,
                  selectedPair,
                  selectedPair.atlas,
                  atlasEnvironment.renderer,
                  atlasEnvironment.scene,
                  atlasEnvironment.camera,
                  benchmarkProfile.warmupFrames,
                  benchmarkProfile.sampleFrames,
                  setProgress,
                )
              : await benchmarkSource(
                  assetPath,
                  enabledMods,
                  selectedPair,
                  selectedPair.atlas,
                  variantSelections,
                  atlasEnvironment.renderer,
                  atlasEnvironment.scene,
                  atlasEnvironment.camera,
                  benchmarkProfile.warmupFrames,
                  benchmarkProfile.sampleFrames,
                  setProgress,
                );
        } finally {
          disposeBenchmarkEnvironment(atlasEnvironment);
        }

        setResult({
          mode,
          assetPath,
          ...(rosterForRun ? { armyRoster: rosterForRun } : {}),
          profile,
          warmupFrames: benchmarkProfile.warmupFrames,
          sampleFrames: benchmarkProfile.sampleFrames,
          width: BENCHMARK_WIDTH,
          height: BENCHMARK_HEIGHT,
          generatedAt: new Date().toISOString(),
          original,
          atlas,
        });
        setProgress("Complete");
      } catch (benchmarkError) {
        setError(
          benchmarkError instanceof Error
            ? benchmarkError.message
            : "Render benchmark failed.",
        );
        setProgress("");
      } finally {
        onRunningChange?.(false);
        setIsRunning(false);
      }
    })();
  };

  const copyResult = () => {
    if (!result) return;
    void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  };

  return (
    <div className="shrink-0 border-t border-fuchsia-900/70 bg-gray-950 text-[11px] text-gray-300">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-gray-900"
      >
        <span className="font-semibold text-fuchsia-300">DEV · Three.js atlas A/B benchmark</span>
        <span className="text-gray-500">{isOpen ? "Hide" : "Show"}</span>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t border-gray-800 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-72 flex-1 items-center gap-2">
              <span className="shrink-0 text-gray-500">Pack pair</span>
              <select
                value={selectedPair?.id ?? ""}
                onChange={(event) => setSelectedPairId(event.target.value)}
                disabled={isRunning || pairs.length === 0}
                className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200 disabled:opacity-50"
              >
                {pairs.length === 0 && <option value="">No *_atlas.pack pair found</option>}
                {pairs.map((pair) => (
                  <option key={pair.id} value={pair.id}>
                    {fileName(pair.original.path)} ↔ {fileName(pair.atlas.path)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1">
              <span className="text-gray-500">Test</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as BenchmarkMode)}
                disabled={isRunning}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
              >
                <option value="asset">Current asset</option>
                <option value="army">Random army</option>
              </select>
            </label>

            <label className="flex items-center gap-1">
              <span className="text-gray-500">Profile</span>
              <select
                value={profile}
                onChange={(event) => setProfile(event.target.value as BenchmarkProfile)}
                disabled={isRunning}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-200"
              >
                <option value="quick">Quick · 40 warmup / 160 measured</option>
                <option value="deep">Deep · 300 warmup / 1000 measured</option>
              </select>
            </label>

            {mode === "army" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      createRandomArmy();
                    } catch (generationError) {
                      setError(
                        generationError instanceof Error
                          ? generationError.message
                          : "Failed to generate an army benchmark list.",
                      );
                    }
                  }}
                  disabled={isRunning || !selectedPair || benchmarkUnits.length === 0}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Generate another army from DB-backed units using the 1/2/9/4/3/2 template."
                >
                  Generate army
                </button>
                <button
                  type="button"
                  onClick={exportArmy}
                  disabled={isRunning || !armyRoster}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Export list
                </button>
                <button
                  type="button"
                  onClick={() => armyImportRef.current?.click()}
                  disabled={isRunning}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Import list
                </button>
                <input
                  ref={armyImportRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void importArmy(file);
                  }}
                />
              </>
            )}

            <button
              type="button"
              onClick={runBenchmark}
              disabled={disabled || isRunning || !selectedPair}
              className="rounded border border-fuchsia-700 bg-fuchsia-950/50 px-2 py-1 font-medium text-fuchsia-200 hover:border-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                disabled
                  ? "Benchmarking requires a fully loaded preview."
                  : mode === "army"
                    ? "Benchmark one reproducible 21-slot army against the original and _atlas pack."
                    : "Benchmark the same asset and appearance against the original and _atlas pack."
              }
            >
              {isRunning ? "Running…" : "Run A/B"}
            </button>

            {result && (
              <button
                type="button"
                onClick={copyResult}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 hover:border-gray-500"
              >
                Copy JSON
              </button>
            )}
          </div>

          <div className="text-gray-500">
            {mode === "army" ? (
              <>
                Whole-army render at 960×540 with the established template: 1 lord, 2 heroes, 9 infantry/missile,
                4 cavalry/chariots, 3 monsters/beasts, and 2 artillery/war machines. Each selected regiment uses
                its DB num_men entity count; repeated VMDs share loaded geometry/material/texture resources.
              </>
            ) : (
              <>
                Static model, 960×540, shadows off, shared geometry/material/texture resources between instances.
                The camera fits the full instance grid. Counts: {BENCHMARK_COUNTS.join(", ")}.
              </>
            )}
            {" "}GPU timing uses EXT_disjoint_timer_query_webgl2 when available. Export/load timings are diagnostic only
            and can be dominated by WH3AssetHost/browser cache state.
          </div>

          {mode === "army" && armyRoster && (
            <div className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1 text-gray-400">
              <div>
                Army list: {armyRoster.units.length} unit slots ·{" "}
                {armyRoster.units.reduce((sum, unit) => sum + unit.entities, 0).toLocaleString()} entities
                {armyRoster.cultureKey ? ` · ${armyRoster.cultureKey}` : ""}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-gray-300">Show selected units</summary>
                <div className="mt-1 grid gap-x-3 gap-y-0.5 md:grid-cols-2 xl:grid-cols-3">
                  {armyRoster.units.map((unit) => (
                    <div key={`${unit.slot}:${unit.unitKey}:${unit.faction}`} title={unit.assetPath}>
                      {unit.slot + 1}. {unit.category} · {unit.name} · {unit.entities}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {progress && <div className="text-fuchsia-300">{progress}</div>}
          {error && <div className="text-red-300">{error}</div>}

          {result && (
            <div className="overflow-x-auto">
              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-gray-500">
                <span>
                  Original export/load/preload: {formatMs(result.original.exportMs)} / {formatMs(result.original.loadMs)} / {formatMs(result.original.texturePreloadMs)} ms
                </span>
                <span>
                  Atlas export/load/preload: {formatMs(result.atlas.exportMs)} / {formatMs(result.atlas.loadMs)} / {formatMs(result.atlas.texturePreloadMs)} ms
                </span>
                <span>
                  Material texture objects: {result.original.materialTextureObjects} → {result.atlas.materialTextureObjects}
                </span>
                <span>
                  Raw texture payload: {formatMiB(result.original.ktx2.compressedBytes)} → {formatMiB(result.atlas.ktx2.compressedBytes)}
                </span>
                <span>
                  Decoded RGBA texture bytes: {formatMiB(result.original.ktx2.decodedBytes)} → {formatMiB(result.atlas.ktx2.decodedBytes)}
                </span>
                <span>
                  Raw KTX2 textures: {result.original.ktx2.rawTextureCount} → {result.atlas.ktx2.rawTextureCount}
                </span>
                <span>
                  KTX2 decode wall: {formatMs(result.original.ktx2.rawTextureWallMs)} → {formatMs(result.atlas.ktx2.rawTextureWallMs)} ms
                </span>
                <span>
                  {result.warmupFrames} warmup + {result.sampleFrames} measured frames
                  {result.mode === "army" ? " for the whole army" : " per count"}
                </span>
              </div>
              {result.mode === "asset"
                && result.original.rows[0]
                && result.atlas.rows[0]
                && result.original.rows[0].drawCalls === result.atlas.rows[0].drawCalls
                && result.original.rows[0].triangles === result.atlas.rows[0].triangles && (
                  <div className="mb-2 rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-amber-300">
                    No 1-instance structural render difference detected: draw calls and triangles are identical.
                    This asset/appearance does not exercise the atlas mesh-merge benefit, so timing deltas here are mostly noise.
                  </div>
                )}
              <table className="w-full min-w-[900px] border-collapse text-right tabular-nums">
                <thead className="text-gray-500">
                  <tr>
                    <th className="border-b border-gray-800 px-1 py-1 text-left">
                      {result.mode === "army" ? "Entities" : "Instances"}
                    </th>
                    <th className="border-b border-gray-800 px-1 py-1">Calls orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">Calls atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ calls</th>
                    <th className="border-b border-gray-800 px-1 py-1">CPU p95 orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">CPU p95 atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ CPU</th>
                    <th className="border-b border-gray-800 px-1 py-1">GPU avg orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">GPU avg atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ GPU</th>
                    <th className="border-b border-gray-800 px-1 py-1">Triangles orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">Triangles atlas</th>
                  </tr>
                </thead>
                <tbody>
                  {result.original.rows.map((originalRow, index) => {
                    const atlasRow = result.atlas.rows[index];
                    if (!atlasRow) return null;
                    return (
                      <tr key={originalRow.instances} className="odd:bg-gray-900/40">
                        <td className="px-1 py-1 text-left font-medium text-gray-200">{originalRow.instances}</td>
                        <td className="px-1 py-1">{originalRow.drawCalls.toLocaleString()}</td>
                        <td className="px-1 py-1">{atlasRow.drawCalls.toLocaleString()}</td>
                        <td className="px-1 py-1 text-fuchsia-200">
                          {formatDelta(originalRow.drawCalls, atlasRow.drawCalls)}
                        </td>
                        <td className="px-1 py-1">{formatMs(originalRow.cpuP95Ms)} ms</td>
                        <td className="px-1 py-1">{formatMs(atlasRow.cpuP95Ms)} ms</td>
                        <td className="px-1 py-1 text-fuchsia-200">
                          {formatDelta(originalRow.cpuP95Ms, atlasRow.cpuP95Ms)}
                        </td>
                        <td className="px-1 py-1">{formatMs(originalRow.gpuMeanMs)} ms</td>
                        <td className="px-1 py-1">{formatMs(atlasRow.gpuMeanMs)} ms</td>
                        <td className="px-1 py-1 text-fuchsia-200">
                          {formatDelta(originalRow.gpuMeanMs, atlasRow.gpuMeanMs)}
                        </td>
                        <td className="px-1 py-1">{originalRow.triangles.toLocaleString()}</td>
                        <td className="px-1 py-1">{atlasRow.triangles.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

VisualsRenderBenchmark.displayName = "VisualsRenderBenchmark";

export default VisualsRenderBenchmark;
