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
  loadArmyBenchmarkAssets,
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
  estimatedVramBytes: number;
  estimatedGeometryVramBytes: number;
  estimatedTextureVramBytes: number;
  estimatedSkeletonVramBytes: number;
  cpuMeanMs: number;
  cpuMedianMs: number;
  cpuP95Ms: number;
  cpuP99Ms: number;
  gpuMeanMs?: number;
};

type BenchmarkMeasurementRow = BenchmarkRow & {
  cpuSamplesMs: number[];
  gpuTotalMs?: number;
  gpuSampleFrames: number;
};

type BenchmarkArmyMeshStats = {
  name: string;
  triangles: number;
  draws: number;
};

type BenchmarkArmyAssetStats = {
  assetPath: string;
  names: string[];
  entities: number;
  meshDrawsPerEntity: number;
  weightedDraws: number;
  trianglesPerEntity: number;
  weightedTriangles: number;
  meshes: BenchmarkArmyMeshStats[];
};

type BenchmarkSourceResult = {
  packPath: string;
  exportMs: number;
  loadMs: number;
  texturePreloadMs: number;
  materialTextureObjects: number;
  ktx2: Wh3Ktx2Timing;
  rows: BenchmarkRow[];
  armyAssets?: BenchmarkArmyAssetStats[];
  warnings?: string[];
};

type BenchmarkSourceMeasurement = Omit<BenchmarkSourceResult, "rows"> & {
  rows: BenchmarkMeasurementRow[];
};

type BenchmarkComparisonResult = {
  mode: BenchmarkMode;
  assetPath: string;
  armyRoster?: ArmyBenchmarkRosterFile;
  profile: BenchmarkProfile;
  warmupFrames: number;
  sampleFrames: number;
  passesPerSource: number;
  measurementOrder: ["original", "atlas", "atlas", "original"];
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

const getRenderableMeshCount = (root: THREE.Object3D) => {
  let count = 0;
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) count += 1;
  });
  return count;
};


const getGeometryDrawCount = (geometry: THREE.BufferGeometry, start: number, count: number) => {
  const available = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  const drawStart = Math.max(0, geometry.drawRange.start ?? 0);
  const drawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.max(0, geometry.drawRange.count)
    : available - drawStart;
  const groupStart = Math.max(start, drawStart);
  const groupEnd = Math.min(start + count, drawStart + drawCount, available);
  return Math.max(0, groupEnd - groupStart);
};

const getStructuralRenderStats = (root: THREE.Object3D) => {
  let meshDraws = 0;
  let triangles = 0;

  root.traverseVisible((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;
    const geometry = child.geometry;
    const available = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    const materials = Array.isArray(child.material) ? child.material : [child.material];

    if (Array.isArray(child.material) && geometry.groups.length > 0) {
      for (const group of geometry.groups) {
        if (!materials[group.materialIndex ?? 0]) continue;
        const count = getGeometryDrawCount(geometry, group.start, group.count);
        if (count <= 0) continue;
        meshDraws += 1;
        triangles += count / 3;
      }
      return;
    }

    if (!materials[0]) return;
    const count = getGeometryDrawCount(geometry, 0, available);
    if (count <= 0) return;
    meshDraws += 1;
    triangles += count / 3;
  });

  return { meshDraws, triangles };
};


const getStructuralMeshStats = (root: THREE.Object3D): BenchmarkArmyMeshStats[] => {
  const result: BenchmarkArmyMeshStats[] = [];
  let unnamedIndex = 0;

  root.traverseVisible((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return;
    const geometry = child.geometry;
    const available = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    let draws = 0;
    let triangles = 0;

    if (Array.isArray(child.material) && geometry.groups.length > 0) {
      for (const group of geometry.groups) {
        if (!materials[group.materialIndex ?? 0]) continue;
        const count = getGeometryDrawCount(geometry, group.start, group.count);
        if (count <= 0) continue;
        draws += 1;
        triangles += count / 3;
      }
    } else if (materials[0]) {
      const count = getGeometryDrawCount(geometry, 0, available);
      if (count > 0) {
        draws = 1;
        triangles = count / 3;
      }
    }

    if (draws > 0) {
      result.push({
        name: child.name || `unnamed_mesh_${unnamedIndex++}`,
        triangles,
        draws,
      });
    }
  });

  return result.sort((left, right) =>
    right.triangles - left.triangles || left.name.localeCompare(right.name),
  );
};

const getUnmatchedMeshStats = (
  originalMeshes: readonly BenchmarkArmyMeshStats[],
  atlasMeshes: readonly BenchmarkArmyMeshStats[],
) => {
  const atlasByTriangles = new Map<number, BenchmarkArmyMeshStats[]>();
  for (const mesh of atlasMeshes) {
    const bucket = atlasByTriangles.get(mesh.triangles) ?? [];
    bucket.push(mesh);
    atlasByTriangles.set(mesh.triangles, bucket);
  }

  const unmatchedOriginal: BenchmarkArmyMeshStats[] = [];
  for (const mesh of originalMeshes) {
    const bucket = atlasByTriangles.get(mesh.triangles);
    if (bucket?.length) {
      bucket.pop();
      if (bucket.length === 0) atlasByTriangles.delete(mesh.triangles);
    } else {
      unmatchedOriginal.push(mesh);
    }
  }

  return {
    original: unmatchedOriginal,
    atlas: [...atlasByTriangles.values()].flat(),
  };
};


const estimateTextureBytes = (texture: THREE.Texture) => {
  const compressedMipmaps = (texture as THREE.CompressedTexture).mipmaps;
  if (Array.isArray(compressedMipmaps) && compressedMipmaps.length > 0) {
    return compressedMipmaps.reduce((sum, mipmap) => {
      const data = (mipmap as { data?: ArrayBufferView }).data;
      return sum + (data?.byteLength ?? 0);
    }, 0);
  }

  const image = texture.image as
    | { data?: ArrayBufferView; width?: number; height?: number; depth?: number }
    | undefined;
  if (!image) return 0;

  const baseBytes = image.data?.byteLength
    ?? ((image.width ?? 0) * (image.height ?? 0) * (image.depth ?? 1) * 4);
  if (!texture.generateMipmaps || !image.width || !image.height) return baseBytes;

  const basePixels = image.width * image.height * (image.depth ?? 1);
  if (basePixels <= 0) return baseBytes;
  let mipPixels = 0;
  let width = image.width;
  let height = image.height;
  let depth = image.depth ?? 1;
  while (true) {
    mipPixels += width * height * depth;
    if (width === 1 && height === 1 && depth === 1) break;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    depth = Math.max(1, Math.floor(depth / 2));
  }
  return Math.round(baseBytes * (mipPixels / basePixels));
};

const estimateResidentVram = (root: THREE.Object3D) => {
  const seenGeometryBuffers = new Set<object>();
  const seenTextures = new Set<THREE.Texture>();
  const seenSkeletons = new Set<THREE.Skeleton>();
  let geometryBytes = 0;
  let textureBytes = 0;
  let skeletonBytes = 0;

  const addAttribute = (
    attribute:
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | THREE.GLBufferAttribute
      | undefined,
  ) => {
    if (!attribute || attribute instanceof THREE.GLBufferAttribute) return;
    if (attribute instanceof THREE.InterleavedBufferAttribute) {
      if (seenGeometryBuffers.has(attribute.data)) return;
      seenGeometryBuffers.add(attribute.data);
      geometryBytes += attribute.data.array.byteLength;
      return;
    }
    if (seenGeometryBuffers.has(attribute)) return;
    seenGeometryBuffers.add(attribute);
    geometryBytes += attribute.array.byteLength;
  };

  root.traverseVisible((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const geometry = child.geometry;
    addAttribute(geometry.index ?? undefined);
    for (const attribute of Object.values(geometry.attributes) as Array<
      THREE.BufferAttribute | THREE.InterleavedBufferAttribute | THREE.GLBufferAttribute
    >) addAttribute(attribute);
    for (const attributes of Object.values(geometry.morphAttributes) as Array<
      Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute> | undefined
    >) {
      for (const attribute of attributes ?? []) addAttribute(attribute);
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture) || seenTextures.has(value)) continue;
        seenTextures.add(value);
        textureBytes += estimateTextureBytes(value);
      }
    }

    if (child instanceof THREE.SkinnedMesh && !seenSkeletons.has(child.skeleton)) {
      seenSkeletons.add(child.skeleton);
      const boneTexture = child.skeleton.boneTexture;
      if (boneTexture) {
        skeletonBytes += estimateTextureBytes(boneTexture);
      } else {
        // Fallback for render paths that keep bone matrices as uniforms.
        skeletonBytes += child.skeleton.boneMatrices?.byteLength ?? 0;
      }
    }
  });

  return {
    geometryBytes,
    textureBytes,
    skeletonBytes,
    totalBytes: geometryBytes + textureBytes + skeletonBytes,
  };
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


const getArmyTextureSharingKey = (texture: THREE.Texture) => {
  const rawCacheKey = texture.userData.wh3RawKtx2CacheKey;
  if (typeof rawCacheKey !== "string" || !rawCacheKey) return undefined;
  return [
    rawCacheKey,
    texture.wrapS,
    texture.wrapT,
    texture.magFilter,
    texture.minFilter,
    texture.anisotropy,
    texture.colorSpace,
    texture.flipY ? 1 : 0,
    texture.generateMipmaps ? 1 : 0,
    texture.premultiplyAlpha ? 1 : 0,
    texture.unpackAlignment,
    texture.mapping,
    texture.channel,
    texture.offset.x,
    texture.offset.y,
    texture.repeat.x,
    texture.repeat.y,
    texture.center.x,
    texture.center.y,
    texture.rotation,
    texture.matrixAutoUpdate ? 1 : 0,
  ].join("|");
};

/**
 * Army VMDs are exported as separate GLBs, so identical source textures otherwise become separate
 * Three Texture objects and separate GPU allocations. Share raw preview textures by content hash
 * plus sampler/transform state before upload so the benchmark models game-like texture residency.
 */
const shareArmyTextures = (
  root: THREE.Object3D,
  sharedTextures: Map<string, THREE.Texture>,
) => {
  const duplicates = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      const writableMaterial = material as unknown as Record<string, unknown>;
      for (const [property, value] of Object.entries(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        const key = getArmyTextureSharingKey(value);
        if (!key) continue;
        const existing = sharedTextures.get(key);
        if (existing && existing !== value) {
          writableMaterial[property] = existing;
          duplicates.add(value);
          material.needsUpdate = true;
        } else if (!existing) {
          sharedTextures.set(key, value);
        }
      }
    }
  });
  duplicates.forEach((texture) => texture.dispose());
  return duplicates.size;
};


const ARMY_BENCHMARK_TEXTURE_PROXY_SIZE = 128;

const createArmyTextureProxy = (source: THREE.Texture) => {
  const size = ARMY_BENCHMARK_TEXTURE_PROXY_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 128;
    data[offset + 1] = 128;
    data[offset + 2] = 128;
    data[offset + 3] = 255;
  }

  const proxy = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  proxy.name = source.name ? `${source.name} [army benchmark proxy]` : "army benchmark proxy";
  proxy.colorSpace = source.colorSpace;
  proxy.mapping = source.mapping;
  proxy.channel = source.channel;
  proxy.wrapS = source.wrapS;
  proxy.wrapT = source.wrapT;
  proxy.magFilter = source.magFilter;
  proxy.minFilter = source.minFilter;
  proxy.anisotropy = source.anisotropy;
  proxy.flipY = source.flipY;
  proxy.premultiplyAlpha = source.premultiplyAlpha;
  proxy.unpackAlignment = source.unpackAlignment;
  proxy.offset.copy(source.offset);
  proxy.repeat.copy(source.repeat);
  proxy.center.copy(source.center);
  proxy.rotation = source.rotation;
  proxy.matrixAutoUpdate = source.matrixAutoUpdate;
  proxy.matrix.copy(source.matrix);
  // Mipmapped samplers need a complete mip chain. Generating tiny proxy mips is
  // cheap and preserves the material's sampler behavior without retaining the
  // full-resolution raw preview texture on the GPU.
  proxy.generateMipmaps =
    source.generateMipmaps
    || source.minFilter === THREE.NearestMipmapNearestFilter
    || source.minFilter === THREE.NearestMipmapLinearFilter
    || source.minFilter === THREE.LinearMipmapNearestFilter
    || source.minFilter === THREE.LinearMipmapLinearFilter;
  proxy.userData = {
    ...source.userData,
    wh3ArmyBenchmarkProxy: true,
    wh3ArmyBenchmarkSourceWidth: (source.image as { width?: number } | undefined)?.width,
    wh3ArmyBenchmarkSourceHeight: (source.image as { height?: number } | undefined)?.height,
  };
  proxy.needsUpdate = true;
  return proxy;
};

const replaceArmyTexturesWithProxies = (roots: readonly THREE.Object3D[]) => {
  const proxyBySource = new Map<THREE.Texture, THREE.Texture>();
  const sourceTextures = new Set<THREE.Texture>();

  for (const root of roots) {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        const writableMaterial = material as unknown as Record<string, unknown>;
        for (const [property, value] of Object.entries(material)) {
          if (!(value instanceof THREE.Texture)) continue;
          let proxy = proxyBySource.get(value);
          if (!proxy) {
            proxy = createArmyTextureProxy(value);
            proxyBySource.set(value, proxy);
            sourceTextures.add(value);
          }
          writableMaterial[property] = proxy;
          material.needsUpdate = true;
        }
      }
    });
  }

  sourceTextures.forEach((texture) => texture.dispose());
  return {
    proxies: [...proxyBySource.values()],
    replacedTextureCount: sourceTextures.size,
  };
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
): Promise<BenchmarkMeasurementRow> => {
  const gl = renderer.getContext();
  if (gl.isContextLost()) {
    throw new Error("Benchmark WebGL context was already lost before rendering.");
  }

  let contextLost = false;
  const canvas = renderer.domElement;
  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  scene.add(group);
  frameBenchmarkGroup(camera, group);

  try {
    for (let frame = 0; frame < warmupFrames; frame += 1) {
      renderer.render(scene, camera);
      if (contextLost) {
        throw new Error("Benchmark WebGL context was lost during warmup.");
      }
      if ((frame + 1) % 20 === 0) await yieldToUi();
    }

    gl.finish();
    if (gl.isContextLost()) {
      throw new Error("Benchmark WebGL context was lost during warmup.");
    }

    const estimatedVram = estimateResidentVram(group);
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
        if (contextLost) {
          throw new Error("Benchmark WebGL context was lost during measured frames.");
        }
        cpuSamples.push(performance.now() - startedAt);
        if ((frame + 1) % 20 === 0) await yieldToUi();
      }
    } finally {
      if (query && gpuTimer && !contextLost && !gpuTimer.gl.isContextLost()) {
        gpuTimer.gl.endQuery(gpuTimer.extension.TIME_ELAPSED_EXT);
        gpuTimer.gl.flush();
      } else if (contextLost) {
        query = undefined;
      }
    }

    if (gl.isContextLost()) {
      throw new Error("Benchmark WebGL context was lost during measured frames.");
    }

    const cpu = summarizeCpuTimes(cpuSamples);
    const gpuTotalMs =
      query && gpuTimer
        ? await waitForGpuQuery(gpuTimer.gl, gpuTimer.extension, query)
        : undefined;

    const drawCalls = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;
    if (getRenderableMeshCount(group) > 0 && (drawCalls === 0 || triangles === 0)) {
      throw new Error(
        `Benchmark produced an invalid empty render result (drawCalls=${drawCalls}, triangles=${triangles}).`,
      );
    }

    return {
      instances,
      drawCalls,
      triangles,
      geometries: renderer.info.memory.geometries,
      rendererTextureObjects: renderer.info.memory.textures,
      estimatedVramBytes: estimatedVram.totalBytes,
      estimatedGeometryVramBytes: estimatedVram.geometryBytes,
      estimatedTextureVramBytes: estimatedVram.textureBytes,
      estimatedSkeletonVramBytes: estimatedVram.skeletonBytes,
      cpuMeanMs: cpu.mean,
      cpuMedianMs: cpu.median,
      cpuP95Ms: cpu.p95,
      cpuP99Ms: cpu.p99,
      gpuMeanMs: gpuTotalMs == null ? undefined : gpuTotalMs / sampleFrames,
      cpuSamplesMs,
      gpuTotalMs,
      gpuSampleFrames: gpuTotalMs == null ? 0 : sampleFrames,
    };
  } finally {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    scene.remove(group);
    disposeSkinnedInstanceResources(group);
    group.clear();

    // Skeleton bone textures are allocated lazily per cloned skinned instance.
    // Flush a frame after disposing them only while the context is healthy. Rendering
    // into a lost/restoring context can leave invalid shader programs behind.
    renderer.info.reset();
    if (!contextLost && !gl.isContextLost()) {
      renderer.render(scene, camera);
      gl.finish();
    }
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
): Promise<BenchmarkMeasurementRow> =>
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
  const rows = Math.ceil(totalEntities / columns);
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

const resetBenchmarkEnvironment = (environment: ReturnType<typeof createBenchmarkEnvironment>) => {
  environment.renderer.renderLists.dispose();
  environment.renderer.info.reset();
  environment.renderer.getContext().finish();
};

const disposeBenchmarkEnvironment = (environment: ReturnType<typeof createBenchmarkEnvironment>) => {
  environment.renderer.dispose();
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
): Promise<BenchmarkSourceMeasurement> => {
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

    const rows: BenchmarkMeasurementRow[] = [];
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
): Promise<BenchmarkSourceMeasurement> => {
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

  const previewIds: string[] = [];
  const loadedRoots: THREE.Object3D[] = [];
  const materialTextures = new Set<THREE.Texture>();
  const sharedArmyTextures = new Map<string, THREE.Texture>();
  const armyAssets: BenchmarkArmyAssetStats[] = [];
  let sharedTextureDuplicates = 0;
  let exportMs = 0;
  let loadMs = 0;
  let group: THREE.Group | undefined;
  const ktx2Loader = new Wh3Ktx2Loader(renderer);
  ktx2Loader.detectSupport(renderer);
  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader);

  try {
    const entries = [...byAssetPath.values()];
    let entryIndex = 0;
    const loadResult = await loadArmyBenchmarkAssets(entries, async (entry) => {
      entryIndex += 1;
      onProgress(
        `${fileName(source.path)} · loading army unit ${entryIndex}/${entries.length} · ${entry.names[0]}`,
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
      const renderableMeshCount = getRenderableMeshCount(root);
      if (renderableMeshCount === 0) {
        throw new Error(
          `${fileName(source.path)} exported an empty army GLB for ${entry.assetPath}. `
          + "The selected source pack does not appear to provide a renderable version of this VMD.",
        );
      }
      loadedRoots.push(root);
      const structural = getStructuralRenderStats(root);
      armyAssets.push({
        assetPath: entry.assetPath,
        names: [...entry.names],
        entities: entry.entities,
        meshDrawsPerEntity: structural.meshDraws,
        weightedDraws: structural.meshDraws * entry.entities,
        trianglesPerEntity: structural.triangles,
        weightedTriangles: structural.triangles * entry.entities,
        meshes: getStructuralMeshStats(root),
      });
      sharedTextureDuplicates += shareArmyTextures(root, sharedArmyTextures);
      getMaterialTextureObjects(root).forEach((texture) => materialTextures.add(texture));
      await yieldToUi();
      return { source: root, entities: entry.entities } satisfies LoadedArmyAsset;
    });

    const warnings = loadResult.failures.map(({ entry, error }) => {
      const warning = `Skipped army unit ${entry.names.join(", ")} (${entry.assetPath}): ${error}`;
      onProgress(`${fileName(source.path)} · ${warning}`);
      return warning;
    });
    if (loadResult.loaded.length === 0) {
      throw new Error(
        `No army units could be loaded from ${fileName(source.path)}.${warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}`,
      );
    }

    const loadedAssets = loadResult.loaded.map(({ value }) => value);
    if (warnings.length > 0) {
      onProgress(
        `${fileName(source.path)} · continuing with ${loadedAssets.length}/${entries.length} unique army assets`,
      );
    }

    // The host's raw preview KTX2 flavor becomes uncompressed RGBA DataTextures in
    // WebGL. Keeping every full-resolution army texture resident can use several
    // times more VRAM than WH3's BC-compressed textures and can reset Chromium's
    // whole GPU process. Keep the real source-byte/decode metrics above, but render
    // the army with one small proxy per unique material texture.
    const {
      proxies: armyRenderTextures,
      replacedTextureCount,
    } = replaceArmyTexturesWithProxies(loadedRoots);
    materialTextures.clear();
    armyRenderTextures.forEach((texture) => materialTextures.add(texture));
    ktx2Loader.clearRawTextureDataCache();

    const texturePreloadStartedAt = performance.now();
    for (const texture of materialTextures) ktx2Loader.preloadTexture(texture);
    const gl = renderer.getContext();
    gl.finish();
    if (gl.isContextLost()) {
      throw new Error(
        `Benchmark WebGL context was lost while preloading ${materialTextures.size.toLocaleString()} army proxy textures.`,
      );
    }
    const texturePreloadMs = performance.now() - texturePreloadStartedAt;

    onProgress(
      `${fileName(source.path)} · ${materialTextures.size.toLocaleString()} resident ${ARMY_BENCHMARK_TEXTURE_PROXY_SIZE}×${ARMY_BENCHMARK_TEXTURE_PROXY_SIZE} proxy textures · ${replacedTextureCount.toLocaleString()} full-resolution textures replaced · ${sharedTextureDuplicates.toLocaleString()} duplicate texture objects shared`,
    );
    await yieldToUi();
    onProgress(
      `${fileName(source.path)} · building ${loadedAssets.length}/${entries.length} unique army assets · ${loadedAssets.reduce((sum, asset) => sum + asset.entities, 0).toLocaleString()} entities`,
    );
    const built = await buildArmyGroup(loadedAssets);
    group = built.group;
    if (getRenderableMeshCount(group) === 0) {
      throw new Error(`${fileName(source.path)} produced an empty army render group.`);
    }
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
      armyAssets: armyAssets.sort((left, right) => normalizePath(left.assetPath).localeCompare(normalizePath(right.assetPath))),
      ...(warnings.length > 0 ? { warnings } : {}),
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

const average = (first: number, second: number) => (first + second) / 2;

const combineKtx2Timing = (first: Wh3Ktx2Timing, second: Wh3Ktx2Timing): Wh3Ktx2Timing => ({
  // These describe the source payload rather than runtime cost. Use the larger
  // observation so a warmed/cached second pass cannot make the source look smaller.
  rawTextureCount: Math.max(first.rawTextureCount, second.rawTextureCount),
  compressedBytes: Math.max(first.compressedBytes, second.compressedBytes),
  decodedBytes: Math.max(first.decodedBytes, second.decodedBytes),
  rawTextureWallMs: average(first.rawTextureWallMs, second.rawTextureWallMs),
  zstdDecodeMs: average(first.zstdDecodeMs, second.zstdDecodeMs),
  textureCreateMs: average(first.textureCreateMs, second.textureCreateMs),
  textureUploadMs: average(first.textureUploadMs, second.textureUploadMs),
});

const combineMeasurementRows = (
  first: BenchmarkMeasurementRow,
  second: BenchmarkMeasurementRow,
): BenchmarkRow => {
  if (first.instances !== second.instances) {
    throw new Error(
      `Counterbalanced benchmark row mismatch: ${first.instances} vs ${second.instances} instances.`,
    );
  }

  const cpuSamples = [...first.cpuSamplesMs, ...second.cpuSamplesMs];
  const cpu = summarizeCpuTimes(cpuSamples);
  const gpuTotalMs =
    (first.gpuTotalMs ?? 0) + (second.gpuTotalMs ?? 0);
  const gpuSampleFrames = first.gpuSampleFrames + second.gpuSampleFrames;

  return {
    instances: first.instances,
    // Structural/resource values should be stable between passes. Keep the first
    // observation rather than averaging discrete counts.
    drawCalls: first.drawCalls,
    triangles: first.triangles,
    geometries: first.geometries,
    rendererTextureObjects: first.rendererTextureObjects,
    estimatedVramBytes: first.estimatedVramBytes,
    estimatedGeometryVramBytes: first.estimatedGeometryVramBytes,
    estimatedTextureVramBytes: first.estimatedTextureVramBytes,
    estimatedSkeletonVramBytes: first.estimatedSkeletonVramBytes,
    cpuMeanMs: cpu.mean,
    cpuMedianMs: cpu.median,
    cpuP95Ms: cpu.p95,
    cpuP99Ms: cpu.p99,
    gpuMeanMs: gpuSampleFrames > 0 ? gpuTotalMs / gpuSampleFrames : undefined,
  };
};

const combineSourceMeasurements = (
  first: BenchmarkSourceMeasurement,
  second: BenchmarkSourceMeasurement,
): BenchmarkSourceResult => {
  if (first.rows.length !== second.rows.length) {
    throw new Error(
      `Counterbalanced benchmark row-count mismatch: ${first.rows.length} vs ${second.rows.length}.`,
    );
  }

  return {
    packPath: first.packPath,
    exportMs: average(first.exportMs, second.exportMs),
    loadMs: average(first.loadMs, second.loadMs),
    texturePreloadMs: average(first.texturePreloadMs, second.texturePreloadMs),
    materialTextureObjects: first.materialTextureObjects,
    ktx2: combineKtx2Timing(first.ktx2, second.ktx2),
    rows: first.rows.map((row, index) => combineMeasurementRows(row, second.rows[index])),
    ...(first.armyAssets ? { armyAssets: first.armyAssets } : {}),
    ...((first.warnings?.length || second.warnings?.length)
      ? { warnings: Array.from(new Set([...(first.warnings ?? []), ...(second.warnings ?? [])])) }
      : {}),
  };
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
  const [fetchedBenchmarkUnits, setFetchedBenchmarkUnits] = useState<ArmyBenchmarkCandidate[]>([]);
  const [isLoadingArmyUnits, setIsLoadingArmyUnits] = useState(false);
  const armyImportRef = useRef<HTMLInputElement>(null);

  const selectedPair =
    pairs.find((pair) => pair.id === selectedPairId)
    ?? pairs[0];

  const ensureBenchmarkUnits = async (): Promise<readonly ArmyBenchmarkCandidate[]> => {
    if (benchmarkUnits.length > 0) return benchmarkUnits;
    if (fetchedBenchmarkUnits.length > 0) return fetchedBenchmarkUnits;
    setIsLoadingArmyUnits(true);
    try {
      const activeMods = enabledMods.filter((mod) => mod.isEnabled !== false);
      const response = await window.api?.getVisualsUnitsData(Array.from(activeMods) as Mod[]);
      if (!response?.success || !response.units) {
        throw new Error(response?.error || "Unable to load the Visuals unit data for army generation.");
      }
      const units = response.units as ArmyBenchmarkCandidate[];
      setFetchedBenchmarkUnits(units);
      return units;
    } finally {
      setIsLoadingArmyUnits(false);
    }
  };

  const createRandomArmy = async () => {
    if (!selectedPair) return undefined;
    const unitPool = await ensureBenchmarkUnits();
    const originalPath = normalizePath(selectedPair.original.path);
    const atlasPath = normalizePath(selectedPair.atlas.path);
    // Visuals data describes whichever side of the pair is currently enabled. Treat
    // units originating from the atlas pack as belonging to the original pack too,
    // so random generation stays scoped to this mod before falling back globally.
    const generationUnits = unitPool.map((unit) => {
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
      const recordedPackPath = roster.sourcePackPath ? normalizePath(roster.sourcePackPath) : "";
      if (recordedPackPath) {
        const recordedPair = pairs.find(
          (pair) =>
            normalizePath(pair.original.path) === recordedPackPath
            || normalizePath(pair.atlas.path) === recordedPackPath,
        );
        if (recordedPair) setSelectedPairId(recordedPair.id);
      }
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
            ? armyRoster ?? await createRandomArmy()
            : undefined;
        if (mode === "army" && !rosterForRun) {
          throw new Error("No army benchmark roster is available.");
        }
        let environment: ReturnType<typeof createBenchmarkEnvironment>;
        try {
          environment = createBenchmarkEnvironment();
        } catch (rendererError) {
          throw new Error(
            rendererError instanceof Error
              ? rendererError.message
              : "Unable to create the benchmark WebGL renderer.",
          );
        }

        let originalFirst: BenchmarkSourceMeasurement;
        let atlasFirst: BenchmarkSourceMeasurement;
        let atlasSecond: BenchmarkSourceMeasurement;
        let originalSecond: BenchmarkSourceMeasurement;

        const runSource = async (
          source: BenchmarkMod,
          passLabel: string,
        ): Promise<BenchmarkSourceMeasurement> => {
          const progress = (message: string) => setProgress(`${passLabel} · ${message}`);
          setProgress(`${passLabel} · exporting ${fileName(source.path)}`);
          return mode === "army"
            ? benchmarkArmySource(
                rosterForRun!,
                enabledMods,
                selectedPair,
                source,
                environment.renderer,
                environment.scene,
                environment.camera,
                benchmarkProfile.warmupFrames,
                benchmarkProfile.sampleFrames,
                progress,
              )
            : benchmarkSource(
                assetPath,
                enabledMods,
                selectedPair,
                source,
                variantSelections,
                environment.renderer,
                environment.scene,
                environment.camera,
                benchmarkProfile.warmupFrames,
                benchmarkProfile.sampleFrames,
                progress,
              );
        };

        try {
          // Counterbalance source order so GC, driver queues, cache warmth, and
          // sustained GPU clocks do not systematically favor the second source.
          originalFirst = await runSource(selectedPair.original, "Pass 1/4 · original");
          resetBenchmarkEnvironment(environment);
          await yieldToUi();

          atlasFirst = await runSource(selectedPair.atlas, "Pass 2/4 · atlas");
          resetBenchmarkEnvironment(environment);
          await yieldToUi();

          atlasSecond = await runSource(selectedPair.atlas, "Pass 3/4 · atlas");
          resetBenchmarkEnvironment(environment);
          await yieldToUi();

          originalSecond = await runSource(selectedPair.original, "Pass 4/4 · original");
        } finally {
          disposeBenchmarkEnvironment(environment);
        }

        const original = combineSourceMeasurements(originalFirst, originalSecond);
        const atlas = combineSourceMeasurements(atlasFirst, atlasSecond);

        setResult({
          mode,
          assetPath,
          ...(rosterForRun ? { armyRoster: rosterForRun } : {}),
          profile,
          warmupFrames: benchmarkProfile.warmupFrames,
          sampleFrames: benchmarkProfile.sampleFrames,
          passesPerSource: 2,
          measurementOrder: ["original", "atlas", "atlas", "original"],
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
                    void createRandomArmy().catch((generationError) => {
                      setError(
                        generationError instanceof Error
                          ? generationError.message
                          : "Failed to generate an army benchmark list.",
                      );
                    });
                  }}
                  disabled={isRunning || isLoadingArmyUnits || !selectedPair}
                  className="rounded border border-gray-700 bg-gray-900 px-2 py-1 hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Generate another army from DB-backed units using the 1/2/9/4/3/2 template."
                >
                  {isLoadingArmyUnits ? "Loading units…" : "Generate army"}
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
              {isRunning ? "Running…" : "Run A/B + B/A"}
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
                its DB num_men entity count; repeated VMDs share loaded geometry/material/texture resources. Army rendering uses
                128×128 proxy textures to avoid WHMM raw-RGBA preview textures exhausting VRAM; source texture payload/decode
                metrics still use the real KTX2 data.
              </>
            ) : (
              <>
                Static model, 960×540, shadows off, shared geometry/material/texture resources between instances.
                The camera fits the full instance grid. Counts: {BENCHMARK_COUNTS.join(", ")}.
              </>
            )}
            {" "}Each source is measured twice in counterbalanced original → atlas → atlas → original order. CPU samples from
            both passes are pooled before mean/median/p95/p99 are calculated; GPU timing is combined across both passes.
            GPU timing uses EXT_disjoint_timer_query_webgl2 when available. Est. render VRAM covers resident Three.js geometry
            buffers, material textures, and skeleton bone textures after warmup; driver/shader/internal allocations are not
            exposed by WebGL. Export/load timings are averaged across the two passes and remain diagnostic only.
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
              {(result.original.warnings?.length || result.atlas.warnings?.length) ? (
                <div className="mb-2 rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1 text-left text-amber-300">
                  <div>Some army VMDs could not be exported and were skipped:</div>
                  <ul className="list-disc pl-4">
                    {[...(result.original.warnings ?? []), ...(result.atlas.warnings ?? [])].map((warning, index) => (
                      <li key={`${index}:${warning}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
                  {result.passesPerSource} passes/source · {result.warmupFrames} warmup + {result.sampleFrames} measured frames/pass
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
              {result.mode === "army" && result.original.armyAssets && result.atlas.armyAssets && (() => {
                const atlasByPath = new Map(
                  result.atlas.armyAssets.map((asset) => [normalizePath(asset.assetPath), asset]),
                );
                const differences = result.original.armyAssets.flatMap((originalAsset) => {
                  const atlasAsset = atlasByPath.get(normalizePath(originalAsset.assetPath));
                  if (!atlasAsset) return [];
                  const triangleDeltaPerEntity = atlasAsset.trianglesPerEntity - originalAsset.trianglesPerEntity;
                  const weightedTriangleDelta = atlasAsset.weightedTriangles - originalAsset.weightedTriangles;
                  if (Math.abs(weightedTriangleDelta) < 0.0001) return [];
                  return [{
                    originalAsset,
                    atlasAsset,
                    triangleDeltaPerEntity,
                    weightedTriangleDelta,
                  }];
                });
                const originalStructuralTriangles = result.original.armyAssets.reduce(
                  (sum, asset) => sum + asset.weightedTriangles,
                  0,
                );
                const atlasStructuralTriangles = result.atlas.armyAssets.reduce(
                  (sum, asset) => sum + asset.weightedTriangles,
                  0,
                );
                const originalStructuralDraws = result.original.armyAssets.reduce(
                  (sum, asset) => sum + asset.weightedDraws,
                  0,
                );
                const atlasStructuralDraws = result.atlas.armyAssets.reduce(
                  (sum, asset) => sum + asset.weightedDraws,
                  0,
                );
                const renderedDelta = (result.atlas.rows[0]?.triangles ?? 0) - (result.original.rows[0]?.triangles ?? 0);
                const structuralDelta = atlasStructuralTriangles - originalStructuralTriangles;

                return (
                  <div className="mb-2 rounded border border-gray-700 bg-gray-900/60 px-2 py-1 text-left text-gray-300">
                    <div>
                      Structural draws: {originalStructuralDraws.toLocaleString()} → {atlasStructuralDraws.toLocaleString()}{" "}
                      ({formatDelta(originalStructuralDraws, atlasStructuralDraws)}).
                    </div>
                    <div>
                      Geometry audit: structural triangles {originalStructuralTriangles.toLocaleString()} →{" "}
                      {atlasStructuralTriangles.toLocaleString()} ({structuralDelta >= 0 ? "+" : ""}{structuralDelta.toLocaleString()});
                      rendered Δ {renderedDelta >= 0 ? "+" : ""}{renderedDelta.toLocaleString()}.
                    </div>
                    {differences.length === 0 ? (
                      <div className="text-emerald-300">
                        No per-VMD triangle differences. Any rendered triangle delta is a renderer/frustum-culling artifact.
                      </div>
                    ) : (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-amber-300">
                          {differences.length} VMD{differences.length === 1 ? "" : "s"} changed triangle count
                        </summary>
                        <div className="mt-1 space-y-0.5">
                          {differences.map(({ originalAsset, atlasAsset, triangleDeltaPerEntity, weightedTriangleDelta }) => {
                            const unmatched = getUnmatchedMeshStats(originalAsset.meshes, atlasAsset.meshes);
                            const shownOriginal = unmatched.original.slice(0, 8);
                            const shownAtlas = unmatched.atlas.slice(0, 8);
                            return (
                              <div key={normalizePath(originalAsset.assetPath)} title={originalAsset.assetPath}>
                                <div>
                                  {originalAsset.names.join(", ")} · {originalAsset.entities} entities ·{" "}
                                  {originalAsset.trianglesPerEntity.toLocaleString()} → {atlasAsset.trianglesPerEntity.toLocaleString()} tri/entity ·{" "}
                                  Δ/entity {triangleDeltaPerEntity >= 0 ? "+" : ""}{triangleDeltaPerEntity.toLocaleString()} ·{" "}
                                  weighted Δ {weightedTriangleDelta >= 0 ? "+" : ""}{weightedTriangleDelta.toLocaleString()}
                                </div>
                                {(shownOriginal.length > 0 || shownAtlas.length > 0) && (
                                  <div className="ml-3 text-[10px] text-gray-400">
                                    <div>
                                      Unmatched original meshes: {shownOriginal.length > 0
                                        ? shownOriginal.map((mesh) => `${mesh.name} [${mesh.triangles.toLocaleString()} tri]`).join(" · ")
                                        : "none"}
                                    </div>
                                    <div>
                                      Unmatched atlas meshes: {shownAtlas.length > 0
                                        ? shownAtlas.map((mesh) => `${mesh.name} [${mesh.triangles.toLocaleString()} tri]`).join(" · ")
                                        : "none"}
                                    </div>
                                    {(unmatched.original.length > shownOriginal.length || unmatched.atlas.length > shownAtlas.length) && (
                                      <div>
                                        Additional unmatched meshes are available in Copy JSON.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}
              <table className="w-full min-w-[1250px] border-collapse text-right tabular-nums">
                <thead className="text-gray-500">
                  <tr>
                    <th className="border-b border-gray-800 px-1 py-1 text-left">
                      {result.mode === "army" ? "Entities" : "Instances"}
                    </th>
                    <th className="border-b border-gray-800 px-1 py-1">Calls orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">Calls atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ calls</th>
                    <th className="border-b border-gray-800 px-1 py-1">CPU median orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">CPU median atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ median</th>
                    <th className="border-b border-gray-800 px-1 py-1">CPU p95 orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">CPU p95 atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ p95</th>
                    <th className="border-b border-gray-800 px-1 py-1">GPU avg orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">GPU avg atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ GPU</th>
                    <th className="border-b border-gray-800 px-1 py-1">Est. render VRAM orig</th>
                    <th className="border-b border-gray-800 px-1 py-1">Est. render VRAM atlas</th>
                    <th className="border-b border-gray-800 px-1 py-1">Δ est. VRAM</th>
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
                        <td className="px-1 py-1">{formatMs(originalRow.cpuMedianMs)} ms</td>
                        <td className="px-1 py-1">{formatMs(atlasRow.cpuMedianMs)} ms</td>
                        <td className="px-1 py-1 text-fuchsia-200">
                          {formatDelta(originalRow.cpuMedianMs, atlasRow.cpuMedianMs)}
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
                        <td
                          className="px-1 py-1"
                          title={`geometry ${formatMiB(originalRow.estimatedGeometryVramBytes)} · textures ${formatMiB(originalRow.estimatedTextureVramBytes)} · skeletons ${formatMiB(originalRow.estimatedSkeletonVramBytes)}`}
                        >
                          {formatMiB(originalRow.estimatedVramBytes)}
                        </td>
                        <td
                          className="px-1 py-1"
                          title={`geometry ${formatMiB(atlasRow.estimatedGeometryVramBytes)} · textures ${formatMiB(atlasRow.estimatedTextureVramBytes)} · skeletons ${formatMiB(atlasRow.estimatedSkeletonVramBytes)}`}
                        >
                          {formatMiB(atlasRow.estimatedVramBytes)}
                        </td>
                        <td className="px-1 py-1 text-fuchsia-200">
                          {formatDelta(originalRow.estimatedVramBytes, atlasRow.estimatedVramBytes)}
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
