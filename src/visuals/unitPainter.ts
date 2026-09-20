import * as THREE from "three";

export type UnitPainterBrushMode = "recolor" | "paint";

export type UnitPainterBrushSettings = {
  radiusPx: number;
  opacity: number;
  hardness: number;
  mode: UnitPainterBrushMode;
  color: { r: number; g: number; b: number };
};

type PaintableMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  needsUpdate: boolean;
};

type PaintableTexture = {
  original: THREE.DataTexture;
  editable: THREE.DataTexture;
  data: Uint8Array;
  originalData: Uint8Array;
  width: number;
  height: number;
  sourceFileName: string;
  sourceVirtualPath?: string;
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
  original: THREE.DataTexture;
};

type StrokeChange = {
  target: PaintableTexture;
  before: Map<number, number>;
  after: Map<number, number>;
};

type Stroke = StrokeChange[];

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
  minX: number;
  minY: number;
  width: number;
  height: number;
  pixels: Uint8Array;
};

const MAX_HISTORY_STROKES = 30;
const MIN_BRUSH_RADIUS_TEXELS = 1;
// A pathological UV/world-area ratio can otherwise turn a small screen brush into a
// million-pixel CPU stamp. GPU projection can remove this cap later; keep interaction responsive now.
const MAX_BRUSH_RADIUS_TEXELS = 192;
const MAX_BRUSH_TEXTURE_FRACTION = 0.15;

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
  if (!(uvAttribute instanceof THREE.BufferAttribute)) {
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

const buildUvIslandMask = (
  triangles: readonly UvTriangle[],
  target: PaintableTexture,
): UvIslandMask | undefined => {
  if (triangles.length === 0) return undefined;

  target.editable.updateMatrix();
  const transformed = triangles.map((triangle) => {
    const uvA = triangle.uvA.clone();
    const uvB = triangle.uvB.clone();
    const uvC = triangle.uvC.clone();
    target.editable.transformUv(uvA);
    target.editable.transformUv(uvB);
    target.editable.transformUv(uvC);
    return [
      new THREE.Vector2(uvA.x * target.width, uvA.y * target.height),
      new THREE.Vector2(uvB.x * target.width, uvB.y * target.height),
      new THREE.Vector2(uvC.x * target.width, uvC.y * target.height),
    ] as const;
  });

  let minX = target.width - 1;
  let minY = target.height - 1;
  let maxX = 0;
  let maxY = 0;
  for (const [a, b, c] of transformed) {
    minX = Math.min(minX, Math.floor(Math.min(a.x, b.x, c.x)));
    minY = Math.min(minY, Math.floor(Math.min(a.y, b.y, c.y)));
    maxX = Math.max(maxX, Math.ceil(Math.max(a.x, b.x, c.x)));
    maxY = Math.max(maxY, Math.ceil(Math.max(a.y, b.y, c.y)));
  }

  minX = Math.max(0, minX);
  minY = Math.max(0, minY);
  maxX = Math.min(target.width - 1, maxX);
  maxY = Math.min(target.height - 1, maxY);
  if (maxX < minX || maxY < minY) return undefined;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const pixels = new Uint8Array(width * height);

  for (const [a, b, c] of transformed) {
    const triangleMinX = Math.max(minX, Math.floor(Math.min(a.x, b.x, c.x)));
    const triangleMinY = Math.max(minY, Math.floor(Math.min(a.y, b.y, c.y)));
    const triangleMaxX = Math.min(maxX, Math.ceil(Math.max(a.x, b.x, c.x)));
    const triangleMaxY = Math.min(maxY, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = triangleMinY; y <= triangleMaxY; y += 1) {
      for (let x = triangleMinX; x <= triangleMaxX; x += 1) {
        if (!pointInTriangle(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y, c.x, c.y)) continue;
        pixels[(y - minY) * width + (x - minX)] = 1;
      }
    }
  }

  return { minX, minY, width, height, pixels };
};

const maskContainsPixel = (mask: UvIslandMask, x: number, y: number) => {
  const localX = x - mask.minX;
  const localY = y - mask.minY;
  if (localX < 0 || localY < 0 || localX >= mask.width || localY >= mask.height) return false;
  return mask.pixels[localY * mask.width + localX] !== 0;
};

const blendPixelFromStrokeStart = (
  target: PaintableTexture,
  byteIndex: number,
  sourcePacked: number,
  settings: UnitPainterBrushSettings,
  coverage: number,
) => {
  const sourceR = sourcePacked & 0xff;
  const sourceG = (sourcePacked >>> 8) & 0xff;
  const sourceB = (sourcePacked >>> 16) & 0xff;

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

  const blend = Math.max(0, Math.min(1, coverage));
  target.data[byteIndex] = Math.round(sourceR + (targetR - sourceR) * blend);
  target.data[byteIndex + 1] = Math.round(sourceG + (targetG - sourceG) * blend);
  target.data[byteIndex + 2] = Math.round(sourceB + (targetB - sourceB) * blend);
};

export class UnitPainterSession {
  private readonly targetsByEditableTexture = new Map<THREE.Texture, PaintableTexture>();
  private readonly restores: MaterialRestore[] = [];
  private readonly history: Stroke[] = [];
  private readonly redoHistory: Stroke[] = [];
  private readonly uvTopologies = new WeakMap<THREE.BufferGeometry, Map<number, UvIslandTopology>>();
  private readonly uvMasksByTarget = new Map<
    PaintableTexture,
    WeakMap<THREE.BufferGeometry, Map<string, UvIslandMask>>
  >();
  private currentStroke = new Map<PaintableTexture, Map<number, number>>();
  private currentStrokeCoverage = new Map<PaintableTexture, Map<number, number>>();
  private isStrokeOpen = false;

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
          };
          targetsByOriginal.set(original, target);
          this.targetsByEditableTexture.set(editable, target);
        }

        this.restores.push({ material, original });
        material.map = target.editable;
        material.needsUpdate = true;
      }
    });
  }

  get textureCount() {
    return this.targetsByEditableTexture.size;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get canRedo() {
    return this.redoHistory.length > 0;
  }

  beginStroke() {
    if (this.isStrokeOpen) this.endStroke();
    this.currentStroke = new Map();
    this.currentStrokeCoverage = new Map();
    this.isStrokeOpen = true;
  }

  paintIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    settings: UnitPainterBrushSettings,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
    screenRadiusPx = settings.radiusPx,
  ) {
    if (!this.isStrokeOpen || !intersection.uv) return false;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target) return false;

    const islandMask = this.getUvIslandMask(intersection, target);
    const uv = intersection.uv.clone();
    target.editable.transformUv(uv);
    const radius = estimateBrushRadiusTexels(
      intersection,
      target,
      Math.max(1, screenRadiusPx),
      camera,
      viewportHeight,
    );
    const centerX = uv.x * target.width;
    const centerY = uv.y * target.height;
    const minX = Math.floor(centerX - radius);
    const maxX = Math.ceil(centerX + radius);
    const minY = Math.floor(centerY - radius);
    const maxY = Math.ceil(centerY + radius);
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

    let changed = false;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x + 0.5 - centerX) / radius;
        const dy = (y + 0.5 - centerY) / radius;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 1) continue;

        const pixelX = wrapCoordinate(x, target.width, target.editable.wrapS);
        const pixelY = wrapCoordinate(y, target.height, target.editable.wrapT);
        if (islandMask && !maskContainsPixel(islandMask, pixelX, pixelY)) continue;
        const byteIndex = (pixelY * target.width + pixelX) * 4;
        const currentValue = packPixel(target.data, byteIndex);
        const strokeStartValue = before.get(byteIndex) ?? currentValue;
        if (!before.has(byteIndex)) before.set(byteIndex, strokeStartValue);

        const falloff = getBrushFalloff(distance, settings.hardness);
        const nextCoverage = Math.max(coverage.get(byteIndex) ?? 0, falloff * clamp01(settings.opacity));
        if (nextCoverage <= (coverage.get(byteIndex) ?? 0)) continue;
        coverage.set(byteIndex, nextCoverage);
        blendPixelFromStrokeStart(target, byteIndex, strokeStartValue, settings, nextCoverage);
        if (packPixel(target.data, byteIndex) !== currentValue) changed = true;
      }
    }

    if (changed) target.editable.needsUpdate = true;
    return changed;
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

  endStroke() {
    if (!this.isStrokeOpen) return false;
    this.isStrokeOpen = false;

    const stroke: Stroke = [];
    for (const [target, before] of this.currentStroke) {
      const after = new Map<number, number>();
      const compactBefore = new Map<number, number>();
      for (const [byteIndex, oldValue] of before) {
        const newValue = packPixel(target.data, byteIndex);
        if (newValue === oldValue) continue;
        compactBefore.set(byteIndex, oldValue);
        after.set(byteIndex, newValue);
      }
      if (after.size > 0) stroke.push({ target, before: compactBefore, after });
    }
    this.currentStroke = new Map();
    this.currentStrokeCoverage = new Map();

    if (stroke.length === 0) return false;
    this.history.push(stroke);
    if (this.history.length > MAX_HISTORY_STROKES) this.history.shift();
    this.redoHistory.length = 0;
    return true;
  }

  undo() {
    if (this.isStrokeOpen) this.endStroke();
    const stroke = this.history.pop();
    if (!stroke) return false;
    this.applyStroke(stroke, "before");
    this.redoHistory.push(stroke);
    return true;
  }

  redo() {
    if (this.isStrokeOpen) this.endStroke();
    const stroke = this.redoHistory.pop();
    if (!stroke) return false;
    this.applyStroke(stroke, "after");
    this.history.push(stroke);
    return true;
  }

  reset() {
    if (this.isStrokeOpen) this.endStroke();
    for (const target of this.targetsByEditableTexture.values()) {
      target.data.set(target.originalData);
      target.editable.needsUpdate = true;
    }
    this.history.length = 0;
    this.redoHistory.length = 0;
  }

  exportModifiedTextures(): UnitPainterExportTexture[] {
    if (this.isStrokeOpen) this.endStroke();
    const modifiedTargets = [...this.targetsByEditableTexture.values()].filter((target) => {
      if (target.data.length !== target.originalData.length) return true;
      for (let index = 0; index < target.data.length; index += 1) {
        if (target.data[index] !== target.originalData[index]) return true;
      }
      return false;
    });

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
    for (const { material, original } of this.restores) {
      material.map = original;
      material.needsUpdate = true;
    }
    for (const target of this.targetsByEditableTexture.values()) target.editable.dispose();
    this.restores.length = 0;
    this.targetsByEditableTexture.clear();
    this.history.length = 0;
    this.redoHistory.length = 0;
    this.currentStroke.clear();
    this.currentStrokeCoverage.clear();
    this.uvMasksByTarget.clear();
  }

  private getUvIslandMask(
    intersection: THREE.Intersection<THREE.Object3D>,
    target: PaintableTexture,
  ): UvIslandMask | undefined {
    if (!(intersection.object instanceof THREE.Mesh) || intersection.faceIndex == null) return undefined;
    const geometry = intersection.object.geometry;
    const materialIndex = intersection.face?.materialIndex ?? getTriangleMaterialIndex(geometry, intersection.faceIndex);

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

    const islandId = topology.faceToIsland.get(intersection.faceIndex);
    if (islandId == null) return undefined;

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

    const key = `${materialIndex}:${islandId}`;
    const cached = masks.get(key);
    if (cached) return cached;

    const triangles = topology.islands.get(islandId);
    if (!triangles) return undefined;
    const mask = buildUvIslandMask(triangles, target);
    if (!mask) return undefined;
    masks.set(key, mask);
    return mask;
  }

  private applyStroke(stroke: Stroke, side: "before" | "after") {
    for (const change of stroke) {
      for (const [byteIndex, value] of change[side]) {
        unpackPixel(value, change.target.data, byteIndex);
      }
      change.target.editable.needsUpdate = true;
    }
  }
}

export const createUnitPainterSession = (root: THREE.Object3D) => new UnitPainterSession(root);
