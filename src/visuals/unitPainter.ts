import * as THREE from "three";

export type UnitPainterBrushMode = "recolor" | "paint";

export type UnitPainterBrushSettings = {
  radiusPx: number;
  strength: number;
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

const MAX_HISTORY_STROKES = 30;
const MIN_BRUSH_RADIUS_TEXELS = 1;
const MAX_BRUSH_TEXTURE_FRACTION = 0.15;

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
    texture.format,
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
  const maxRadius = Math.max(target.width, target.height) * MAX_BRUSH_TEXTURE_FRACTION;
  return Math.max(MIN_BRUSH_RADIUS_TEXELS, Math.min(radius, maxRadius));
};

const blendPixel = (
  data: Uint8Array,
  byteIndex: number,
  settings: UnitPainterBrushSettings,
  alpha: number,
) => {
  const sourceR = data[byteIndex];
  const sourceG = data[byteIndex + 1];
  const sourceB = data[byteIndex + 2];

  let targetR = settings.color.r;
  let targetG = settings.color.g;
  let targetB = settings.color.b;
  if (settings.mode === "recolor") {
    const value = Math.max(sourceR, sourceG, sourceB) / 255;
    targetR *= value;
    targetG *= value;
    targetB *= value;
  }

  const blend = Math.max(0, Math.min(1, alpha * settings.strength));
  data[byteIndex] = Math.round(sourceR + (targetR - sourceR) * blend);
  data[byteIndex + 1] = Math.round(sourceG + (targetG - sourceG) * blend);
  data[byteIndex + 2] = Math.round(sourceB + (targetB - sourceB) * blend);
};

export class UnitPainterSession {
  private readonly targetsByEditableTexture = new Map<THREE.Texture, PaintableTexture>();
  private readonly restores: MaterialRestore[] = [];
  private readonly history: Stroke[] = [];
  private readonly redoHistory: Stroke[] = [];
  private currentStroke = new Map<PaintableTexture, Map<number, number>>();
  private isStrokeOpen = false;

  constructor(root: THREE.Object3D) {
    const targetsByOriginal = new Map<THREE.DataTexture, PaintableTexture>();

    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const rawMaterial of materials) {
        const material = asPaintableMaterial(rawMaterial);
        if (!material || !(material.map instanceof THREE.DataTexture)) continue;
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
    this.isStrokeOpen = true;
  }

  paintIntersection(
    intersection: THREE.Intersection<THREE.Object3D>,
    settings: UnitPainterBrushSettings,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ) {
    if (!this.isStrokeOpen || !intersection.uv) return false;
    const material = getIntersectionMaterial(intersection);
    const target = material?.map ? this.targetsByEditableTexture.get(material.map) : undefined;
    if (!target) return false;

    const uv = intersection.uv.clone();
    target.editable.transformUv(uv);
    const radius = estimateBrushRadiusTexels(
      intersection,
      target,
      Math.max(1, settings.radiusPx),
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

    let changed = false;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x + 0.5 - centerX) / radius;
        const dy = (y + 0.5 - centerY) / radius;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 1) continue;

        const pixelX = wrapCoordinate(x, target.width, target.editable.wrapS);
        const pixelY = wrapCoordinate(y, target.height, target.editable.wrapT);
        const byteIndex = (pixelY * target.width + pixelX) * 4;
        const oldValue = packPixel(target.data, byteIndex);
        if (!before.has(byteIndex)) before.set(byteIndex, oldValue);

        const falloff = distance <= 0.78 ? 1 : Math.max(0, (1 - distance) / 0.22);
        blendPixel(target.data, byteIndex, settings, falloff);
        if (packPixel(target.data, byteIndex) !== oldValue) changed = true;
      }
    }

    if (changed) target.editable.needsUpdate = true;
    return changed;
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
