/** Read only the registered RMV2 layouts needed by the headless asset tools. */

export type Rmv2ErrorCode = "MALFORMED" | "UNSUPPORTED";

export class Rmv2CodecError extends Error {
  readonly code: Rmv2ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: Rmv2ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "Rmv2CodecError";
    this.code = code;
    this.details = details;
  }
}

export interface Rmv2Span {
  offset: number;
  length: number;
  bytes: Buffer;
}

export interface Rmv2Texture {
  typeId: number | null;
  typeName: string | null;
  path: string;
  /** Diffuse, Specular, and Gloss are legacy slots by convention. */
  legacy: boolean;
  source: "weightedTexture" | "terrainTexturePath";
}

export interface Rmv2Parameter<T> {
  id: number;
  name?: string;
  value: T;
}

export interface Rmv2UvRange {
  channel: number;
  min: [number, number];
  max: [number, number];
}

export interface Rmv2Part {
  lodIndex: number;
  partIndex: number;
  name: string | null;
  materialTypeId: number;
  materialTypeName: string;
  complete: boolean;
  unsupportedReason?: string;
  renderFlags: number;
  meshSectionSize: number;
  vertexOffset: number;
  indexOffset: number;
  vertexFormatId: number | null;
  vertexFormatName: string | null;
  vertexCount: number;
  indexCount: number;
  triangleCount: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  textures?: Rmv2Texture[];
  stringParams?: Rmv2Parameter<string>[];
  floatParams?: Rmv2Parameter<number>[];
  intParams?: Rmv2Parameter<number>[];
  vec4Params?: Rmv2Parameter<[number, number, number, number]>[];
  alphaMode?: {
    rawValue: number | null;
    value: "opaque" | "transparent" | null;
    supported: boolean;
    reason?: "missing" | "duplicate" | "unsupportedValue";
  };
  uvRanges?: Rmv2UvRange[];
  raw: {
    commonHeader: Rmv2Span;
    material: Rmv2Span;
    vertices: Rmv2Span;
    indices: Rmv2Span;
    sectionPadding: Rmv2Span;
  };
}

export interface Rmv2Lod {
  lodIndex: number;
  meshCount: number;
  totalVertexBytes: number;
  totalIndexBytes: number;
  firstMeshOffset: number;
  distance: number;
  authoredLodIndex?: number;
  qualityLevel?: number;
  raw: Rmv2Span;
  parts: Rmv2Part[];
}

export interface Rmv2File {
  version: 6 | 7 | 8;
  skeletonName: string;
  lods: Rmv2Lod[];
  /** Padding and unparsed bytes between LOD mesh ranges. */
  interstitial: Rmv2Span[];
  trailing: Rmv2Span;
  validationComplete: boolean;
  raw: { header: Rmv2Span; lodHeaders: Rmv2Span };
}

export interface ParseRmv2Options {
  /** Avoid decoding UV coordinates, geometry values, indices, and material parameters. */
  textureSlotsOnly?: boolean;
}

const FILE_HEADER_SIZE = 140;
const COMMON_HEADER_SIZE = 80;
const MAX_LOD_COUNT = 256;
const MAX_PART_COUNT = 100_000;
const MATERIAL_NAMES: Readonly<Record<number, string>> = {
  22: "bow_wave",
  26: "non_renderable",
  29: "texture_combo_vertex_wind",
  30: "texture_combo",
  31: "decal_waterfall",
  32: "standard_simple",
  34: "campaign_trees",
  38: "point_light",
  45: "static_point_light",
  46: "debug_geometry",
  49: "custom_terrain",
  58: "weighted_cloth",
  60: "cloth",
  61: "collision",
  62: "collision_shape",
  63: "tiled_dirtmap",
  64: "ship_ambientmap",
  65: "weighted",
  67: "projected_decal",
  68: "default_type",
  69: "grass",
  70: "weighted_skin",
  71: "decal",
  72: "decal_dirtmap",
  73: "dirtmap",
  74: "tree",
  75: "tree_leaf",
  77: "weighted_decal",
  78: "weighted_decal_dirtmap",
  79: "weighted_dirtmap",
  80: "weighted_skin_decal",
  81: "weighted_skin_decal_dirtmap",
  82: "weighted_skin_dirtmap",
  83: "water",
  84: "unlit",
  85: "weighted_unlit",
  86: "terrain_blend",
  87: "projected_decal_v2",
  88: "ignore",
  89: "tree_billboard_material",
  91: "water_displace_volume",
  93: "rope",
  94: "campaign_vegetation",
  95: "projected_decal_v3",
  96: "weighted_texture_blend",
  97: "projected_decal_v4",
  98: "global_terrain",
  99: "decal_overlay",
  100: "alpha_blend",
  101: "TerrainTiles",
};
const WEIGHTED_MATERIAL_NAMES = new Set([
  "weighted_cloth",
  "weighted",
  "weighted_skin",
  "weighted_decal",
  "weighted_decal_dirtmap",
  "weighted_dirtmap",
  "weighted_skin_decal",
  "weighted_skin_decal_dirtmap",
  "weighted_skin_dirtmap",
  "weighted_unlit",
  "weighted_texture_blend",
  "default_type",
  "decal",
  "dirtmap",
  "decal_dirtmap",
]);
const TEXTURE_NAMES: Readonly<Record<number, string>> = {
  0: "Diffuse",
  1: "Normal",
  3: "Mask",
  5: "Ambient_occlusion",
  7: "Tiling_dirt_uv2",
  10: "Skin_mask",
  11: "Specular",
  12: "Gloss",
  13: "Decal_dirtmap",
  14: "Decal_dirtmask",
  15: "Decal_mask",
  17: "Diffuse_damage",
  27: "BaseColour",
  29: "MaterialMap",
};
const UV_SCALE_NAMES: Readonly<Record<number, string>> = { 0: "UvScaleX", 1: "UvScaleY" };
const INT_PARAM_NAMES: Readonly<Record<number, string>> = { 0: "Alpha", 1: "Decal", 2: "Dirt" };
const VEC4_PARAM_NAMES: Readonly<Record<number, string>> = { 0: "TextureDecalTransform" };

const malformed = (message: string, details: Record<string, unknown> = {}): never => {
  throw new Rmv2CodecError("MALFORMED", message, details);
};
const unsupported = (message: string, details: Record<string, unknown> = {}): never => {
  throw new Rmv2CodecError("UNSUPPORTED", message, details);
};

const ensureRange = (bytes: Buffer, offset: number, length: number, label: string): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length ||
    length > bytes.length - offset
  ) {
    malformed(`${label} is outside the RMV2 payload`, { offset, length, payloadLength: bytes.length });
  }
};

const span = (bytes: Buffer, offset: number, length: number, label: string): Rmv2Span => {
  ensureRange(bytes, offset, length, label);
  return { offset, length, bytes: bytes.subarray(offset, offset + length) };
};

const readFixedString = (bytes: Buffer, offset: number, length: number, label: string): string => {
  ensureRange(bytes, offset, length, label);
  const field = bytes.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul < 0 ? field.length : nul).toString("utf8");
};

const finite = (value: number, label: string, offset: number): number => {
  if (!Number.isFinite(value)) malformed(`${label} contains a non-finite number`, { offset, value });
  return value;
};

const asSafeLength = (value: number, label: string, offset: number): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) malformed(`${label} is invalid`, { offset, value });
  return number;
};

const halfToFloat = (bits: number): number => {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * (fraction === 0 ? 0 : 2 ** -14 * (fraction / 1024));
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
};

const readHalf = (bytes: Buffer, offset: number, label: string): number =>
  finite(halfToFloat(bytes.readUInt16LE(offset)), label, offset);
const readFloat = (bytes: Buffer, offset: number, label: string): number =>
  finite(bytes.readFloatLE(offset), label, offset);

const textureSlot = (typeId: number, path: string): Rmv2Texture => ({
  typeId,
  typeName: TEXTURE_NAMES[typeId] ?? null,
  path,
  legacy: typeId === 0 || typeId === 11 || typeId === 12,
  source: "weightedTexture",
});

interface MaterialRead {
  vertexFormatId: number;
  name: string;
  textures: Rmv2Texture[];
  materialEnd: number;
  stringParams?: Rmv2Parameter<string>[];
  floatParams?: Rmv2Parameter<number>[];
  intParams?: Rmv2Parameter<number>[];
  vec4Params?: Rmv2Parameter<[number, number, number, number]>[];
  alphaMode?: Rmv2Part["alphaMode"];
}

const readMaterial = (
  bytes: Buffer,
  materialOffset: number,
  materialLimit: number,
  materialTypeId: number,
  textureSlotsOnly: boolean,
): MaterialRead => {
  const materialTypeName = MATERIAL_NAMES[materialTypeId] ?? null;
  const local: Buffer = bytes;
  const requireMaterialBytes = (offset: number, length: number, label: string) => {
    if (offset < materialOffset || offset + length > materialLimit || !Number.isSafeInteger(offset + length)) {
      malformed(`${label} exceeds the material span`, { offset, length, materialOffset, materialLimit });
    }
    ensureRange(local, offset, length, label);
  };
  if (materialTypeName === "custom_terrain") {
    const size = 256;
    requireMaterialBytes(materialOffset, size, "custom terrain material");
    return {
      vertexFormatId: 6,
      name: "TerrainTile",
      textures: [
        {
          typeId: null,
          typeName: "TerrainTexturePath",
          path: readFixedString(local, materialOffset, size, "terrain texture path"),
          legacy: false,
          source: "terrainTexturePath",
        },
      ],
      materialEnd: materialOffset + size,
    };
  }
  if (materialTypeName === "TerrainTiles") {
    const size = 88;
    requireMaterialBytes(materialOffset, size, "terrain tile material");
    return {
      vertexFormatId: 5,
      name: readFixedString(local, materialOffset, 64, "terrain tile name"),
      textures: [],
      materialEnd: materialOffset + size,
    };
  }
  if (!materialTypeName || !WEIGHTED_MATERIAL_NAMES.has(materialTypeName)) {
    unsupported(`Unsupported RMV2 material layout ${materialTypeId} (${materialTypeName ?? "unknown"})`, {
      materialTypeId,
      materialTypeName,
    });
  }

  const fixedSize = 860;
  requireMaterialBytes(materialOffset, fixedSize, "weighted material header");
  const vertexFormatId = local.readUInt16LE(materialOffset);
  const name = readFixedString(local, materialOffset + 2, 32, "material part name");
  const counts = {
    attachments: local.readUInt32LE(materialOffset + 712),
    textures: local.readUInt32LE(materialOffset + 716),
    strings: local.readUInt32LE(materialOffset + 720),
    floats: local.readUInt32LE(materialOffset + 724),
    ints: local.readUInt32LE(materialOffset + 728),
    vec4s: local.readUInt32LE(materialOffset + 732),
  };
  const maxRecords = (label: string, count: number, minimumSize: number) => {
    if (count > Math.floor((materialLimit - materialOffset - fixedSize) / minimumSize) + 1) {
      malformed(`${label} count cannot fit in the material span`, { count, materialOffset, materialLimit });
    }
    if (count > 1_000_000) malformed(`${label} count exceeds the safe limit`, { count });
  };
  maxRecords("Attachment", counts.attachments, 84);
  maxRecords("Texture", counts.textures, 260);
  maxRecords("String parameter", counts.strings, 6);
  maxRecords("Float parameter", counts.floats, 8);
  maxRecords("Int parameter", counts.ints, 8);
  maxRecords("Vec4 parameter", counts.vec4s, 20);

  let cursor = materialOffset + fixedSize;
  const readRecordSpan = (count: number, size: number, label: string) => {
    const length = count * size;
    if (!Number.isSafeInteger(length)) malformed(`${label} span is too large`, { count, size });
    requireMaterialBytes(cursor, length, label);
    const start = cursor;
    cursor += length;
    return start;
  };
  const attachmentStart = readRecordSpan(counts.attachments, 84, "attachment points");
  for (let item = 0; item < counts.attachments; item++) {
    const base = attachmentStart + item * 84 + 32;
    for (let field = 0; field < 12; field++) readFloat(local, base + field * 4, "attachment transform");
    local.readInt32LE(base + 48);
  }

  const textureStart = readRecordSpan(counts.textures, 260, "texture records");
  const textures: Rmv2Texture[] = [];
  for (let item = 0; item < counts.textures; item++) {
    const base = textureStart + item * 260;
    const typeId = local.readInt32LE(base);
    const path = readFixedString(local, base + 4, 256, "texture path");
    textures.push(textureSlot(typeId, path));
  }

  const stringParams: Rmv2Parameter<string>[] = [];
  for (let item = 0; item < counts.strings; item++) {
    requireMaterialBytes(cursor, 6, "string parameter header");
    const id = local.readInt32LE(cursor);
    const length = local.readInt16LE(cursor + 4);
    if (length < 0) malformed("String parameter has a negative byte length", { offset: cursor + 4, length });
    requireMaterialBytes(cursor + 6, length, "string parameter value");
    if (!textureSlotsOnly) {
      let value: string;
      try {
        value = new TextDecoder("utf-8", { fatal: true }).decode(local.subarray(cursor + 6, cursor + 6 + length));
      } catch {
        malformed("String parameter is not valid UTF-8", { id, offset: cursor + 6, length });
      }
      stringParams.push({ id, value: value! });
    }
    cursor += 6 + length;
  }

  const floatParams: Rmv2Parameter<number>[] = [];
  for (let item = 0; item < counts.floats; item++) {
    requireMaterialBytes(cursor, 8, "float parameter");
    const id = local.readInt32LE(cursor);
    const value = textureSlotsOnly ? 0 : readFloat(local, cursor + 4, "float parameter");
    if (!textureSlotsOnly) floatParams.push({ id, name: UV_SCALE_NAMES[id], value });
    cursor += 8;
  }

  const intParams: Rmv2Parameter<number>[] = [];
  const alphaValues: number[] = [];
  for (let item = 0; item < counts.ints; item++) {
    requireMaterialBytes(cursor, 8, "integer parameter");
    const id = local.readInt32LE(cursor);
    const value = local.readInt32LE(cursor + 4);
    if (id === 0) alphaValues.push(value);
    if (!textureSlotsOnly) intParams.push({ id, name: INT_PARAM_NAMES[id], value });
    cursor += 8;
  }

  const vec4Params: Rmv2Parameter<[number, number, number, number]>[] = [];
  for (let item = 0; item < counts.vec4s; item++) {
    requireMaterialBytes(cursor, 20, "vec4 parameter");
    const id = local.readInt32LE(cursor);
    const value: [number, number, number, number] = [
      textureSlotsOnly ? 0 : readFloat(local, cursor + 4, "vec4 parameter"),
      textureSlotsOnly ? 0 : readFloat(local, cursor + 8, "vec4 parameter"),
      textureSlotsOnly ? 0 : readFloat(local, cursor + 12, "vec4 parameter"),
      textureSlotsOnly ? 0 : readFloat(local, cursor + 16, "vec4 parameter"),
    ];
    if (!textureSlotsOnly) vec4Params.push({ id, name: VEC4_PARAM_NAMES[id], value });
    cursor += 20;
  }

  const pivotOffset = materialOffset + 548;
  const matrixOffset = materialOffset + 560;
  for (let field = 0; field < 3; field++) readFloat(local, pivotOffset + field * 4, "material pivot");
  for (let field = 0; field < 36; field++) readFloat(local, matrixOffset + field * 4, "material transform");

  const alphaMode =
    alphaValues.length === 0
      ? { rawValue: null, value: "opaque" as const, supported: true, reason: "missing" as const }
      : alphaValues.length > 1
        ? { rawValue: null, value: null, supported: false, reason: "duplicate" as const }
        : alphaValues[0] === 0
          ? { rawValue: 0, value: "opaque" as const, supported: true }
          : alphaValues[0] === 1
            ? { rawValue: 1, value: "transparent" as const, supported: true }
            : { rawValue: alphaValues[0], value: null, supported: false, reason: "unsupportedValue" as const };

  return {
    vertexFormatId,
    name,
    textures,
    materialEnd: cursor,
    ...(textureSlotsOnly ? {} : { stringParams, floatParams, intParams, vec4Params, alphaMode }),
  };
};

interface VertexLayout {
  name: string;
  size: (version: number) => number;
  position: "half4" | "float4" | "float3";
  positionOffset: number;
  uvOffsets: readonly number[];
}

const VERTEX_LAYOUTS: Readonly<Record<number, VertexLayout>> = {
  0: { name: "Static", size: () => 32, position: "half4", positionOffset: 0, uvOffsets: [8, 12] },
  1: { name: "Collision_Format", size: () => 24, position: "float3", positionOffset: 0, uvOffsets: [] },
  3: {
    name: "Weighted",
    size: (version) => (version === 8 ? 32 : 28),
    position: "half4",
    positionOffset: 0,
    uvOffsets: [16],
  },
  4: {
    name: "Cinematic",
    size: (version) => (version === 8 ? 36 : 32),
    position: "half4",
    positionOffset: 0,
    uvOffsets: [20],
  },
  5: { name: "Position16_bit", size: () => 16, position: "float4", positionOffset: 0, uvOffsets: [] },
  6: { name: "CustomTerrain", size: () => 36, position: "float4", positionOffset: 0, uvOffsets: [32] },
  13: { name: "CustomTerrain2", size: () => 48, position: "float4", positionOffset: 0, uvOffsets: [32] },
};

export type Rmv2MaterialLayout = "weighted" | "customTerrain" | "terrainTiles";

export const getRmv2MaterialLayout = (materialTypeId: number): Rmv2MaterialLayout | undefined => {
  const name = MATERIAL_NAMES[materialTypeId];
  if (name && WEIGHTED_MATERIAL_NAMES.has(name)) return "weighted";
  if (name === "custom_terrain") return "customTerrain";
  if (name === "TerrainTiles") return "terrainTiles";
  return undefined;
};

export const resolveRmv2MaterialType = (
  value: string | number,
): { typeId: number; typeName: string; layout?: Rmv2MaterialLayout } | undefined => {
  let typeId: number | undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff) typeId = value;
  else if (typeof value === "string") {
    const lower = value.toLowerCase();
    typeId =
      Object.entries(MATERIAL_NAMES).find(([, name]) => name.toLowerCase() === lower)?.[0] === undefined
        ? undefined
        : Number(Object.entries(MATERIAL_NAMES).find(([, name]) => name.toLowerCase() === lower)![0]);
  }
  if (typeId === undefined) return undefined;
  const typeName = MATERIAL_NAMES[typeId];
  if (!typeName) return { typeId, typeName: "unknown" };
  return { typeId, typeName, layout: getRmv2MaterialLayout(typeId) };
};

export const resolveRmv2TextureType = (
  value: string | number,
): { typeId: number | null; typeName: string } | undefined => {
  if (typeof value === "number" && Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) {
    return { typeId: value, typeName: TEXTURE_NAMES[value] ?? "unknown" };
  }
  if (typeof value !== "string") return undefined;
  if (value.toLowerCase() === "terraintexturepath") return { typeId: null, typeName: "TerrainTexturePath" };
  const match = Object.entries(TEXTURE_NAMES).find(([, name]) => name.toLowerCase() === value.toLowerCase());
  return match ? { typeId: Number(match[0]), typeName: match[1] } : undefined;
};

export interface Rmv2GeometryChangeCounts {
  vertexChangedCount: number;
  positionChangedCount: number;
  uvChangedCount: number;
  indexChangedCount: number;
  layoutComparable: boolean;
}

export const compareRmv2PartGeometry = (
  beforeVersion: number,
  before: Rmv2Part,
  afterVersion: number,
  after: Rmv2Part,
): Rmv2GeometryChangeCounts => {
  const beforeLayout = before.vertexFormatId === null ? undefined : VERTEX_LAYOUTS[before.vertexFormatId];
  const afterLayout = after.vertexFormatId === null ? undefined : VERTEX_LAYOUTS[after.vertexFormatId];
  const beforeStride = beforeLayout?.size(beforeVersion);
  const afterStride = afterLayout?.size(afterVersion);
  const comparable = Boolean(
    beforeLayout &&
    afterLayout &&
    before.vertexFormatId === after.vertexFormatId &&
    beforeStride === afterStride &&
    beforeLayout.position === afterLayout.position &&
    JSON.stringify(beforeLayout.uvOffsets) === JSON.stringify(afterLayout.uvOffsets),
  );
  const vertexCount = Math.max(before.vertexCount, after.vertexCount);
  let vertexChangedCount = 0;
  let positionChangedCount = 0;
  let uvChangedCount = 0;
  if (comparable && beforeLayout && afterLayout && beforeStride !== undefined && afterStride !== undefined) {
    const beforePositions = (index: number) => {
      const base = index * beforeStride! + beforeLayout.positionOffset;
      const count = beforeLayout.position === "float3" ? 3 : 4;
      return Array.from({ length: count }, (_, component) =>
        beforeLayout.position === "half4"
          ? readHalf(before.raw.vertices.bytes, base + component * 2, "vertex position")
          : readFloat(before.raw.vertices.bytes, base + component * 4, "vertex position"),
      );
    };
    const afterPositions = (index: number) => {
      const base = index * afterStride! + afterLayout.positionOffset;
      const count = afterLayout.position === "float3" ? 3 : 4;
      return Array.from({ length: count }, (_, component) =>
        afterLayout.position === "half4"
          ? readHalf(after.raw.vertices.bytes, base + component * 2, "vertex position")
          : readFloat(after.raw.vertices.bytes, base + component * 4, "vertex position"),
      );
    };
    for (let index = 0; index < vertexCount; index++) {
      const beforePresent = index < before.vertexCount;
      const afterPresent = index < after.vertexCount;
      if (!beforePresent || !afterPresent) {
        vertexChangedCount += 1;
        positionChangedCount += 1;
        uvChangedCount += Math.max(beforeLayout.uvOffsets.length, afterLayout.uvOffsets.length);
        continue;
      }
      const beforeVertex = before.raw.vertices.bytes.subarray(index * beforeStride, (index + 1) * beforeStride);
      const afterVertex = after.raw.vertices.bytes.subarray(index * afterStride, (index + 1) * afterStride);
      if (!beforeVertex.equals(afterVertex)) vertexChangedCount += 1;
      if (JSON.stringify(beforePositions(index)) !== JSON.stringify(afterPositions(index))) positionChangedCount += 1;
      for (let channel = 0; channel < beforeLayout.uvOffsets.length; channel++) {
        const beforeOffset = index * beforeStride + beforeLayout.uvOffsets[channel];
        const afterOffset = index * afterStride + afterLayout.uvOffsets[channel];
        if (
          !before.raw.vertices.bytes
            .subarray(beforeOffset, beforeOffset + 4)
            .equals(after.raw.vertices.bytes.subarray(afterOffset, afterOffset + 4))
        )
          uvChangedCount += 1;
      }
    }
  } else {
    vertexChangedCount = vertexCount;
    positionChangedCount = vertexCount;
    uvChangedCount = Math.max(beforeLayout?.uvOffsets.length ?? 0, afterLayout?.uvOffsets.length ?? 0) * vertexCount;
  }
  const beforeIndexCount = before.indexCount;
  const afterIndexCount = after.indexCount;
  const indexCount = Math.max(beforeIndexCount, afterIndexCount);
  let indexChangedCount = 0;
  for (let index = 0; index < indexCount; index++) {
    if (
      index >= beforeIndexCount ||
      index >= afterIndexCount ||
      before.raw.indices.bytes.readUInt16LE(index * 2) !== after.raw.indices.bytes.readUInt16LE(index * 2)
    )
      indexChangedCount += 1;
  }
  return { vertexChangedCount, positionChangedCount, uvChangedCount, indexChangedCount, layoutComparable: comparable };
};

const scanGeometry = (
  bytes: Buffer,
  vertexSpan: Rmv2Span,
  layout: VertexLayout,
  stride: number,
  count: number,
): Rmv2UvRange[] => {
  const channelRanges = layout.uvOffsets.map((offset, channel) => ({
    channel,
    min: [Infinity, Infinity] as [number, number],
    max: [-Infinity, -Infinity] as [number, number],
  }));
  for (let vertexIndex = 0; vertexIndex < count; vertexIndex++) {
    const base = vertexSpan.offset + vertexIndex * stride;
    if (layout.position === "float3") {
      for (let component = 0; component < 3; component++) readFloat(bytes, base + 12 + component * 4, "vertex normal");
    } else if (layout.position === "float4" && (layout.name === "CustomTerrain" || layout.name === "CustomTerrain2")) {
      for (let component = 0; component < 4; component++) readFloat(bytes, base + 16 + component * 4, "vertex normal");
    }
    if (layout.position === "half4") {
      for (let component = 0; component < 4; component++)
        readHalf(bytes, base + layout.positionOffset + component * 2, "vertex position");
    } else {
      const components = layout.position === "float3" ? 3 : 4;
      for (let component = 0; component < components; component++)
        readFloat(bytes, base + layout.positionOffset + component * 4, "vertex position");
    }
    for (let channelIndex = 0; channelIndex < channelRanges.length; channelIndex++) {
      const channel = channelRanges[channelIndex];
      const offset = base + layout.uvOffsets[channelIndex];
      const u = readHalf(bytes, offset, "vertex UV");
      const v = readHalf(bytes, offset + 2, "vertex UV");
      channel.min[0] = Math.min(channel.min[0], u);
      channel.min[1] = Math.min(channel.min[1], v);
      channel.max[0] = Math.max(channel.max[0], u);
      channel.max[1] = Math.max(channel.max[1], v);
    }
  }
  return channelRanges
    .filter((range) => count > 0)
    .map((range) => ({
      channel: range.channel,
      min: range.min,
      max: range.max,
    }));
};

const parsePart = (
  bytes: Buffer,
  partOffset: number,
  lodIndex: number,
  partIndex: number,
  version: 6 | 7 | 8,
  textureSlotsOnly: boolean,
): Rmv2Part => {
  const common = span(bytes, partOffset, COMMON_HEADER_SIZE, "common part header");
  const materialTypeId = common.bytes.readUInt16LE(0);
  const renderFlags = common.bytes.readUInt16LE(2);
  const sectionSize = asSafeLength(common.bytes.readUInt32LE(4), "mesh section size", partOffset + 4);
  const vertexOffset = asSafeLength(common.bytes.readUInt32LE(8), "vertex offset", partOffset + 8);
  const vertexCount = asSafeLength(common.bytes.readUInt32LE(12), "vertex count", partOffset + 12);
  const indexOffset = asSafeLength(common.bytes.readUInt32LE(16), "index offset", partOffset + 16);
  const indexCount = asSafeLength(common.bytes.readUInt32LE(20), "index count", partOffset + 20);
  if (sectionSize < COMMON_HEADER_SIZE)
    malformed("Mesh section is shorter than its common header", { partOffset, sectionSize });
  ensureRange(bytes, partOffset, sectionSize, "mesh section");
  const sectionEnd = partOffset + sectionSize;

  const min: [number, number, number] = [
    readFloat(common.bytes, 24, "bounding box"),
    readFloat(common.bytes, 28, "bounding box"),
    readFloat(common.bytes, 32, "bounding box"),
  ];
  const max: [number, number, number] = [
    readFloat(common.bytes, 36, "bounding box"),
    readFloat(common.bytes, 40, "bounding box"),
    readFloat(common.bytes, 44, "bounding box"),
  ];
  const materialStart = partOffset + COMMON_HEADER_SIZE;
  const materialEndLimit = partOffset + vertexOffset;
  if (vertexOffset < COMMON_HEADER_SIZE || materialEndLimit > sectionEnd)
    malformed("Vertex offset is outside the mesh section", { partOffset, vertexOffset, sectionSize });
  let material: MaterialRead | undefined;
  let unsupportedReason: string | undefined;
  try {
    material = readMaterial(bytes, materialStart, materialEndLimit, materialTypeId, textureSlotsOnly);
  } catch (error) {
    if (error instanceof Rmv2CodecError && error.code === "UNSUPPORTED") unsupportedReason = error.message;
    else throw error;
  }
  if (material && material.materialEnd > materialEndLimit)
    malformed("Material records overlap the vertex buffer", {
      materialEnd: material.materialEnd,
      vertexStart: materialEndLimit,
    });

  const layout = material ? VERTEX_LAYOUTS[material.vertexFormatId] : undefined;
  if (material && !layout) unsupportedReason = `Unsupported RMV2 vertex format ${material.vertexFormatId}`;
  const stride = layout?.size(version);
  const knownVertexBytes = stride === undefined ? undefined : vertexCount * stride;
  if (knownVertexBytes !== undefined && !Number.isSafeInteger(knownVertexBytes))
    malformed("Vertex buffer size is too large", { vertexCount, stride });
  if (indexOffset < vertexOffset || indexOffset > sectionSize)
    malformed("Index offset is outside the mesh section", { partOffset, vertexOffset, indexOffset, sectionSize });
  if (knownVertexBytes !== undefined && vertexOffset + knownVertexBytes !== indexOffset)
    malformed("Vertex and index offsets do not match the registered vertex stride", {
      partOffset,
      vertexOffset,
      vertexCount,
      stride,
      indexOffset,
    });
  if (indexCount % 3 !== 0)
    malformed("Index count is not a complete triangle list", { lodIndex, partIndex, indexCount });
  const indexBytes = indexCount * 2;
  if (!Number.isSafeInteger(indexBytes) || indexOffset + indexBytes > sectionSize)
    malformed("Index buffer is outside the mesh section", { partOffset, indexOffset, indexCount, sectionSize });

  const vertices = span(bytes, materialEndLimit, indexOffset - vertexOffset, "vertex buffer");
  const indices = span(bytes, partOffset + indexOffset, indexBytes, "index buffer");
  let uvRanges: Rmv2UvRange[] | undefined;
  if (!textureSlotsOnly) {
    if (layout && stride !== undefined) uvRanges = scanGeometry(bytes, vertices, layout, stride, vertexCount);
    for (let index = 0; index < indexCount; index++) {
      const value = indices.bytes.readUInt16LE(index * 2);
      if (value >= vertexCount)
        malformed("Index buffer references a vertex outside the part", {
          lodIndex,
          partIndex,
          index,
          value,
          vertexCount,
        });
    }
  }
  return {
    lodIndex,
    partIndex,
    name: material?.name ?? null,
    materialTypeId,
    materialTypeName: MATERIAL_NAMES[materialTypeId] ?? "unknown",
    complete: unsupportedReason === undefined,
    ...(unsupportedReason ? { unsupportedReason } : {}),
    renderFlags,
    meshSectionSize: sectionSize,
    vertexOffset,
    indexOffset,
    vertexFormatId: material?.vertexFormatId ?? null,
    vertexFormatName: layout?.name ?? null,
    vertexCount,
    indexCount,
    triangleCount: indexCount / 3,
    boundingBox: { min, max },
    ...(material?.textures ? { textures: material.textures } : {}),
    ...(material?.stringParams ? { stringParams: material.stringParams } : {}),
    ...(material?.floatParams ? { floatParams: material.floatParams } : {}),
    ...(material?.intParams ? { intParams: material.intParams } : {}),
    ...(material?.vec4Params ? { vec4Params: material.vec4Params } : {}),
    ...(material?.alphaMode ? { alphaMode: material.alphaMode } : {}),
    ...(uvRanges ? { uvRanges } : {}),
    raw: {
      commonHeader: common,
      material: span(bytes, materialStart, vertexOffset - COMMON_HEADER_SIZE, "material span"),
      vertices,
      indices,
      sectionPadding: span(
        bytes,
        partOffset + indexOffset + indexBytes,
        sectionSize - indexOffset - indexBytes,
        "mesh section padding",
      ),
    },
  };
};

export const parseRmv2 = (bytes: Buffer, options: ParseRmv2Options = {}): Rmv2File => {
  if (bytes.length < 4 || bytes.toString("ascii", 0, Math.min(bytes.length, 4)) !== "RMV2") {
    malformed("Invalid RMV2 file signature", { signature: bytes.toString("ascii", 0, Math.min(bytes.length, 4)) });
  }
  ensureRange(bytes, 0, FILE_HEADER_SIZE, "RMV2 file header");
  const versionValue = bytes.readUInt32LE(4);
  if (versionValue !== 6 && versionValue !== 7 && versionValue !== 8)
    unsupported(`Unsupported RMV2 version ${versionValue}`, { version: versionValue });
  const version = versionValue as 6 | 7 | 8;
  const lodCount = asSafeLength(bytes.readUInt32LE(8), "LOD count", 8);
  if (lodCount > MAX_LOD_COUNT) malformed("LOD count exceeds the safe limit", { lodCount, maximum: MAX_LOD_COUNT });
  const lodHeaderSize = version === 6 ? 20 : 28;
  const lodHeaderBytes = lodCount * lodHeaderSize;
  if (!Number.isSafeInteger(lodHeaderBytes)) malformed("LOD header span is too large", { lodCount, lodHeaderSize });
  ensureRange(bytes, FILE_HEADER_SIZE, lodHeaderBytes, "LOD headers");
  const headersEnd = FILE_HEADER_SIZE + lodHeaderBytes;
  const lods: Rmv2Lod[] = [];
  let totalParts = 0;
  for (let lodIndex = 0; lodIndex < lodCount; lodIndex++) {
    const offset = FILE_HEADER_SIZE + lodIndex * lodHeaderSize;
    const raw = span(bytes, offset, lodHeaderSize, "LOD header");
    const meshCount = asSafeLength(raw.bytes.readUInt32LE(0), "LOD mesh count", offset);
    const totalVertexBytes = asSafeLength(raw.bytes.readUInt32LE(4), "LOD vertex bytes", offset + 4);
    const totalIndexBytes = asSafeLength(raw.bytes.readUInt32LE(8), "LOD index bytes", offset + 8);
    const firstMeshOffset = asSafeLength(raw.bytes.readUInt32LE(12), "LOD first mesh offset", offset + 12);
    const distance = finite(raw.bytes.readFloatLE(16), "LOD distance", offset + 16);
    const authoredLodIndex = version === 6 ? undefined : raw.bytes.readUInt32LE(20);
    const qualityLevel = version === 6 ? undefined : raw.bytes.readUInt8(24);
    totalParts += meshCount;
    if (totalParts > MAX_PART_COUNT)
      malformed("RMV2 mesh count exceeds the safe limit", { totalParts, maximum: MAX_PART_COUNT });
    lods.push({
      lodIndex,
      meshCount,
      totalVertexBytes,
      totalIndexBytes,
      firstMeshOffset,
      distance,
      ...(authoredLodIndex === undefined ? {} : { authoredLodIndex }),
      ...(qualityLevel === undefined ? {} : { qualityLevel }),
      raw,
      parts: [],
    });
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const lod of lods) {
    if (lod.meshCount === 0) {
      if (lod.totalVertexBytes !== 0 || lod.totalIndexBytes !== 0)
        malformed("Empty LOD has nonzero geometry byte totals", {
          lodIndex: lod.lodIndex,
          totalVertexBytes: lod.totalVertexBytes,
          totalIndexBytes: lod.totalIndexBytes,
        });
      continue;
    }
    if (lod.firstMeshOffset < headersEnd)
      malformed("LOD mesh data overlaps the RMV2 headers", {
        lodIndex: lod.lodIndex,
        firstMeshOffset: lod.firstMeshOffset,
        headersEnd,
      });
    ensureRange(bytes, lod.firstMeshOffset, COMMON_HEADER_SIZE, "first mesh header");
    let cursor = lod.firstMeshOffset;
    let vertexBytes = 0;
    let indexBytes = 0;
    for (let partIndex = 0; partIndex < lod.meshCount; partIndex++) {
      const part = parsePart(bytes, cursor, lod.lodIndex, partIndex, version, Boolean(options.textureSlotsOnly));
      lod.parts.push(part);
      const sectionLength = part.raw.commonHeader.bytes.readUInt32LE(4);
      cursor += sectionLength;
      vertexBytes += part.raw.vertices.length;
      indexBytes += part.raw.indices.length;
      if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(vertexBytes) || !Number.isSafeInteger(indexBytes))
        malformed("LOD mesh range overflows the supported integer range", { lodIndex: lod.lodIndex });
    }
    if (vertexBytes !== lod.totalVertexBytes)
      malformed("LOD vertex byte total does not match its mesh records", {
        lodIndex: lod.lodIndex,
        header: lod.totalVertexBytes,
        actual: vertexBytes,
      });
    if (indexBytes !== lod.totalIndexBytes)
      malformed("LOD index byte total does not match its mesh records", {
        lodIndex: lod.lodIndex,
        header: lod.totalIndexBytes,
        actual: indexBytes,
      });
    ranges.push({ start: lod.firstMeshOffset, end: cursor });
  }

  ranges.sort((a, b) => a.start - b.start);
  const interstitial: Rmv2Span[] = [];
  let previousEnd = headersEnd;
  for (const range of ranges) {
    if (range.start < previousEnd) malformed("LOD mesh ranges overlap", { range, previousEnd });
    if (range.start > previousEnd)
      interstitial.push(span(bytes, previousEnd, range.start - previousEnd, "interstitial bytes"));
    previousEnd = range.end;
  }
  const skeletonName = readFixedString(bytes, 12, 128, "skeleton name");
  const validationComplete = lods.every((lod) => lod.parts.every((part) => part.complete));
  return {
    version,
    skeletonName,
    lods,
    interstitial,
    trailing: span(bytes, previousEnd, bytes.length - previousEnd, "trailing bytes"),
    validationComplete,
    raw: {
      header: span(bytes, 0, FILE_HEADER_SIZE, "file header"),
      lodHeaders: span(bytes, FILE_HEADER_SIZE, lodHeaderBytes, "LOD headers"),
    },
  };
};
