import React, { memo, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Wh3Ktx2Loader } from "../visuals/Wh3Ktx2Loader";
import {
  exportVisualsModel,
  releaseVisualsModelPreview,
  type VisualsModelPreviewMod,
} from "../visuals/modelPreviewApi";
import type { VariantMeshSelection } from "../visuals/variantMesh";

type BenchmarkMod = VisualsModelPreviewMod & {
  isEnabled?: boolean;
};

type BenchmarkPackPair = {
  id: string;
  original: BenchmarkMod;
  atlas: BenchmarkMod;
};

type BenchmarkProfile = "quick" | "deep";

type BenchmarkRow = {
  instances: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
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
  rows: BenchmarkRow[];
};

type BenchmarkComparisonResult = {
  assetPath: string;
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

const disposeLoadedObject = (root: THREE.Object3D) => {
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

const runInstanceCount = async (
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  source: THREE.Object3D,
  instances: number,
  warmupFrames: number,
  sampleFrames: number,
): Promise<BenchmarkRow> => {
  const group = buildInstanceGroup(source, instances);
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
      textures: renderer.info.memory.textures,
      cpuMeanMs: cpu.mean,
      cpuMedianMs: cpu.median,
      cpuP95Ms: cpu.p95,
      cpuP99Ms: cpu.p99,
      gpuMeanMs: gpuTotalMs == null ? undefined : gpuTotalMs / sampleFrames,
    };
  } finally {
    scene.remove(group);
    group.clear();
  }
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

    ktx2Loader.clearRawTextureDataCache();
    return {
      packPath: source.path,
      exportMs,
      loadMs,
      rows,
    };
  } finally {
    if (loadedRoot) disposeLoadedObject(loadedRoot);
    await releaseVisualsModelPreview(previewId).catch(() => undefined);
  }
};

const formatMs = (value?: number) => (value == null ? "—" : value.toFixed(value < 1 ? 3 : 2));
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
  disabled = false,
  onRunningChange,
}: VisualsRenderBenchmarkProps) => {
  const pairs = useMemo(() => findPackPairs(availableMods), [availableMods]);
  const [selectedPairId, setSelectedPairId] = useState("");
  const [profile, setProfile] = useState<BenchmarkProfile>("quick");
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<BenchmarkComparisonResult>();

  const selectedPair =
    pairs.find((pair) => pair.id === selectedPairId)
    ?? pairs[0];

  const runBenchmark = () => {
    if (!selectedPair || isRunning) return;
    void (async () => {
      setIsRunning(true);
      onRunningChange?.(true);
      setError("");
      setResult(undefined);
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
      const benchmarkProfile = BENCHMARK_PROFILES[profile];

      try {
        setProgress(`Exporting ${fileName(selectedPair.original.path)}`);
        const original = await benchmarkSource(
          assetPath,
          enabledMods,
          selectedPair,
          selectedPair.original,
          variantSelections,
          renderer,
          scene,
          camera,
          benchmarkProfile.warmupFrames,
          benchmarkProfile.sampleFrames,
          setProgress,
        );

        renderer.info.reset();
        setProgress(`Exporting ${fileName(selectedPair.atlas.path)}`);
        const atlas = await benchmarkSource(
          assetPath,
          enabledMods,
          selectedPair,
          selectedPair.atlas,
          variantSelections,
          renderer,
          scene,
          camera,
          benchmarkProfile.warmupFrames,
          benchmarkProfile.sampleFrames,
          setProgress,
        );

        setResult({
          assetPath,
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
        renderer.dispose();
        renderer.forceContextLoss();
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

            <button
              type="button"
              onClick={runBenchmark}
              disabled={disabled || isRunning || !selectedPair}
              className="rounded border border-fuchsia-700 bg-fuchsia-950/50 px-2 py-1 font-medium text-fuchsia-200 hover:border-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                disabled
                  ? "Benchmarking requires one fully loaded model."
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
            Static model, 960×540, shadows off, shared geometry/material/texture resources between instances.
            Counts: {BENCHMARK_COUNTS.join(", ")}. GPU timing uses EXT_disjoint_timer_query_webgl2 when available.
          </div>

          {progress && <div className="text-fuchsia-300">{progress}</div>}
          {error && <div className="text-red-300">{error}</div>}

          {result && (
            <div className="overflow-x-auto">
              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-gray-500">
                <span>
                  Original export/load: {formatMs(result.original.exportMs)} / {formatMs(result.original.loadMs)} ms
                </span>
                <span>
                  Atlas export/load: {formatMs(result.atlas.exportMs)} / {formatMs(result.atlas.loadMs)} ms
                </span>
                <span>
                  {result.warmupFrames} warmup + {result.sampleFrames} measured frames per count
                </span>
              </div>
              <table className="w-full min-w-[900px] border-collapse text-right tabular-nums">
                <thead className="text-gray-500">
                  <tr>
                    <th className="border-b border-gray-800 px-1 py-1 text-left">Instances</th>
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
