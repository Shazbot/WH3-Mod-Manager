/**
 * Minimal Total War `.anim` reader: bone names, parents and the bind/first-frame local transform.
 * "Tech" animations carry a model's skeleton plus extra attachment-point bones (`ap_*`) that the
 * model's own skeleton lacks. Format reference: assedfork-host `AnimationFile.cs` (versions 4-8).
 */
export interface TwAnimBone {
  name: string;
  parent: number;
  translation: [number, number, number];
  rotation: [number, number, number, number];
}

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

/** Shared tech skeletons can have a different appearance's filename. Only accept an unambiguous sibling. */
export const findTechAnimationFallback = (
  requestedPath: string,
  availablePaths: Iterable<string>,
): string | undefined => {
  const normalize = (path: string) => path.replaceAll("/", "\\").toLowerCase();
  const requested = normalize(requestedPath);
  const folder = requested.slice(0, requested.lastIndexOf("\\") + 1);
  if (!folder.endsWith("\\tech\\") || !requested.endsWith(".anim")) return undefined;
  const candidates = new Set<string>();
  for (const path of availablePaths) {
    const normalized = normalize(path);
    if (normalized.startsWith(folder) && /^[^\\]+\.anim$/.test(normalized.slice(folder.length))) {
      candidates.add(normalized);
    }
  }
  return candidates.size === 1 ? candidates.values().next().value : undefined;
};

class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  i32() {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }
  i16() {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }
  i8() {
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }
  f32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  string() {
    const length = this.i16();
    const text = new TextDecoder("utf-8").decode(this.data.subarray(this.offset, this.offset + length));
    this.offset += length;
    return text;
  }
}

const SHORT_SCALE = 1 / 32767;

const readFloatVec3 = (reader: Reader): Vec3 => [reader.f32(), reader.f32(), reader.f32()];
const readShortQuat = (reader: Reader): Vec4 => [
  reader.i16() * SHORT_SCALE,
  reader.i16() * SHORT_SCALE,
  reader.i16() * SHORT_SCALE,
  reader.i16() * SHORT_SCALE,
];

const normalizeQuat = (q: Vec4): Vec4 => {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  return length > 1e-6 ? [q[0] / length, q[1] / length, q[2] / length, q[3] / length] : [0, 0, 0, 1];
};

type Frame = { translations: Vec3[]; rotations: Vec4[] };

/** v8 frames list only the bones whose bit rate matches, in bone order. */
const readFrameV8 = (
  reader: Reader,
  translationRates: number[],
  rotationRates: number[],
  isDynamic: boolean,
  translationRanges: Array<{ min: Vec3; max: Vec3 }>,
  rotationRanges: Array<{ min: Vec4; max: Vec4 }>,
): Frame => {
  const frame: Frame = { translations: [], rotations: [] };
  translationRates.forEach((rate, bone) => {
    const bits = isDynamic ? rate : -rate;
    if (bits === 12) frame.translations.push(readFloatVec3(reader));
    else if (bits === 3) {
      const range = translationRanges[bone];
      const raw: Vec3 = [reader.i8() / 127, reader.i8() / 127, reader.i8() / 127];
      frame.translations.push([
        range.max[0] + raw[0] * range.min[0],
        range.max[1] + raw[1] * range.min[1],
        range.max[2] + raw[2] * range.min[2],
      ]);
    } else if (bits !== 0 && bits !== -12 && bits !== -3) throw new Error("Unknown translation bit rate");
  });
  rotationRates.forEach((rate, bone) => {
    const bits = isDynamic ? rate : -rate;
    if (bits === 8) frame.rotations.push(readShortQuat(reader));
    else if (bits === 4) {
      const range = rotationRanges[bone];
      const raw: Vec4 = [reader.i8() / 127, reader.i8() / 127, reader.i8() / 127, reader.i8() / 127];
      frame.rotations.push([
        range.max[0] + raw[0] * range.min[0],
        range.max[1] + raw[1] * range.min[1],
        range.max[2] + raw[2] * range.min[2],
        range.max[3] + raw[3] * range.min[3],
      ]);
    } else if (bits !== 0 && bits !== -8 && bits !== -4) throw new Error("Unknown rotation bit rate");
  });
  return frame;
};

/** Mapping value: -1 none, >= 10000 static index, otherwise dynamic index. */
const pick = (
  mapping: number,
  staticValues: readonly unknown[] | undefined,
  dynamicValues: readonly unknown[] | undefined,
) => (mapping >= 10000 ? staticValues?.[mapping - 10000] : mapping >= 0 ? dynamicValues?.[mapping] : undefined);

export const parseTwAnimSkeleton = (input: Uint8Array): TwAnimBone[] => {
  const reader = new Reader(input);
  const version = reader.u32();
  if (version < 4 || version > 8) throw new Error(`Unsupported animation version ${version}`);
  reader.u32();
  reader.f32();
  reader.string();
  if (version > 6) {
    const flagCount = reader.u32();
    for (let index = 0; index < flagCount; index++) reader.string();
  }
  reader.f32();
  const boneCount = reader.u32();
  const bones: Array<{ name: string; parent: number }> = [];
  for (let index = 0; index < boneCount; index++) {
    const name = reader.string();
    bones.push({ name, parent: reader.i32() });
  }

  let translationMap: number[] = [];
  let rotationMap: number[] = [];
  let staticFrame: Frame | undefined;
  let dynamicFrame: Frame | undefined;

  if (version === 8) {
    reader.u32();
    const partCount = reader.u32();
    if (partCount === 0) throw new Error("Animation has no parts");
    const translationRates: number[] = [];
    const rotationRates: number[] = [];
    for (let index = 0; index < boneCount; index++) translationRates.push(reader.i8());
    for (let index = 0; index < boneCount; index++) rotationRates.push(reader.i8());
    const translationRangeCount = reader.u32();
    const rotationRangeCount = reader.u32();
    const translationRanges: Array<{ min: Vec3; max: Vec3 }> = [];
    const rotationRanges: Array<{ min: Vec4; max: Vec4 }> = [];
    for (let index = 0; index < translationRangeCount; index++) {
      translationRanges.push({ min: readFloatVec3(reader), max: readFloatVec3(reader) });
    }
    for (let index = 0; index < rotationRangeCount; index++) {
      rotationRanges.push({
        min: [reader.f32(), reader.f32(), reader.f32(), reader.f32()],
        max: [reader.f32(), reader.f32(), reader.f32(), reader.f32()],
      });
    }
    const constTranslations = reader.u32();
    const constRotations = reader.u32();
    if (constTranslations !== 0 || constRotations !== 0) {
      staticFrame = readFrameV8(reader, translationRates, rotationRates, false, translationRanges, rotationRanges);
    }
    const trackTranslations = reader.u32();
    const trackRotations = reader.u32();
    const frameCount = reader.u32();
    if ((trackTranslations !== 0 || trackRotations !== 0) && frameCount > 0) {
      dynamicFrame = readFrameV8(reader, translationRates, rotationRates, true, translationRanges, rotationRanges);
    }
    let staticT = 0;
    let dynamicT = 0;
    translationMap = translationRates.map((rate) => (rate < 0 ? 10000 + staticT++ : rate > 0 ? dynamicT++ : -1));
    let staticR = 0;
    let dynamicR = 0;
    rotationMap = rotationRates.map((rate) => (rate < 0 ? 10000 + staticR++ : rate > 0 ? dynamicR++ : -1));
  } else {
    for (let index = 0; index < boneCount; index++) translationMap.push(reader.i32());
    for (let index = 0; index < boneCount; index++) rotationMap.push(reader.i32());
    const readFrame = (positions: number, rotations: number): Frame => {
      const frame: Frame = { translations: [], rotations: [] };
      for (let index = 0; index < positions; index++) frame.translations.push(readFloatVec3(reader));
      for (let index = 0; index < rotations; index++) frame.rotations.push(readShortQuat(reader));
      return frame;
    };
    if (version === 7) {
      const positions = reader.u32();
      const rotations = reader.u32();
      if (positions !== 0 || rotations !== 0) staticFrame = readFrame(positions, rotations);
    }
    const positions = reader.i32();
    const rotations = reader.i32();
    const frameCount = reader.i32();
    if ((positions !== 0 || rotations !== 0) && frameCount > 0) dynamicFrame = readFrame(positions, rotations);
  }

  return bones.map((bone, index) => ({
    name: bone.name,
    parent: bone.parent,
    translation: (pick(translationMap[index], staticFrame?.translations, dynamicFrame?.translations) as
      Vec3 | undefined) ?? [0, 0, 0],
    rotation: normalizeQuat(
      (pick(rotationMap[index], staticFrame?.rotations, dynamicFrame?.rotations) as Vec4 | undefined) ?? [0, 0, 0, 1],
    ),
  }));
};
