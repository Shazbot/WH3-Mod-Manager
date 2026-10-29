/** DDS layout rules: https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds-pguide */
export interface DdsMipLayout {
  level: number;
  width: number;
  height: number;
  depth: number;
  offset: number;
  byteLength: number;
  rowPitch: number;
  present: boolean;
}

export interface DdsLayout {
  width: number;
  height: number;
  depth: number;
  mipCount: number;
  declaredMipCount: number;
  fourCc: string | null;
  dxgiFormat: number | null;
  format: string;
  resourceDimension: string;
  arraySize: number;
  surfaceCount: number;
  isCubemap: boolean;
  dataOffset: number;
  blockBytes: number | null;
  bitsPerPixel: number | null;
  layoutSupported: boolean;
  previewSupported: boolean;
  previewUnsupportedReason: string | null;
  chainBytes: number | null;
  expectedBytes: number | null;
  actualBytes: number;
  complete: boolean | null;
  trailingBytes: number | null;
  mips: DdsMipLayout[];
}

export const DDS_MAX_PIXELS = 16_777_216;

const dxgiBc: Record<number, [string, number, boolean]> = {};
for (const [base, family, bytes, preview] of [
  [70, "BC1", 8, true],
  [73, "BC2", 16, true],
  [76, "BC3", 16, true],
  [79, "BC4", 8, false],
  [82, "BC5", 16, false],
  [94, "BC6H", 16, false],
  [97, "BC7", 16, true],
] as const) {
  const suffixes =
    family === "BC6H"
      ? ["TYPELESS", "UF16", "SF16"]
      : family === "BC4" || family === "BC5"
        ? ["TYPELESS", "UNORM", "SNORM"]
        : ["TYPELESS", "UNORM", "UNORM_SRGB"];
  suffixes.forEach((suffix, index) => {
    dxgiBc[base + index] = [`${family}_${suffix}`, bytes, preview];
  });
}
const legacyBc: Record<string, [string, number, boolean]> = {
  DXT1: ["BC1_UNORM", 8, true],
  DXT2: ["BC2_UNORM_PREMULTIPLIED", 16, false],
  DXT3: ["BC2_UNORM", 16, true],
  DXT4: ["BC3_UNORM_PREMULTIPLIED", 16, false],
  DXT5: ["BC3_UNORM", 16, true],
  ATI1: ["BC4_UNORM", 8, false],
  BC4U: ["BC4_UNORM", 8, false],
  BC4S: ["BC4_SNORM", 8, false],
  ATI2: ["BC5_UNORM", 16, false],
  BC5U: ["BC5_UNORM", 16, false],
  BC5S: ["BC5_SNORM", 16, false],
};

/** Mip offsets are for surface zero; each other array/cube surface starts one chainBytes later. */
const readLayoutU32 = (buffer: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > buffer.length) throw new RangeError(`DDS header read out of range at ${offset}`);
  return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0;
};

const readLayoutAscii = (buffer: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...buffer.subarray(start, end));

/** Accepts a Node Buffer or a plain Uint8Array, so the renderer can use it without Node's Buffer. */
export const inspectDdsLayout = (buffer: Uint8Array, logicalLength = buffer.length): DdsLayout => {
  if (!Number.isSafeInteger(logicalLength) || logicalLength < buffer.length)
    throw new Error(`Invalid DDS logical length: ${logicalLength}`);
  if (buffer.length < 128 || readLayoutAscii(buffer, 0, 4) !== "DDS ")
    throw new Error("Invalid DDS file: missing or truncated header");
  if (readLayoutU32(buffer, 4) !== 124 || readLayoutU32(buffer, 76) !== 32)
    throw new Error("Invalid DDS header or pixel-format size");
  const width = readLayoutU32(buffer, 16),
    height = readLayoutU32(buffer, 12);
  if (!width || !height) throw new Error(`Invalid DDS dimensions ${width}x${height}`);
  const pixelFlags = readLayoutU32(buffer, 80);
  const fourCc = pixelFlags & 4 ? readLayoutAscii(buffer, 84, 88) : null;
  let dataOffset = 128,
    dxgiFormat: number | null = null,
    arraySize = 1;
  const caps2 = readLayoutU32(buffer, 112);
  let isCubemap = Boolean(caps2 & 0x200);
  let resourceDimension = caps2 & 0x200000 ? "3D" : "2D";
  let depth = resourceDimension === "3D" ? readLayoutU32(buffer, 24) : 1;
  let surfaceCount = 1;
  let format = fourCc ? `FOURCC_${fourCc}` : `RGB_${readLayoutU32(buffer, 88)}BIT`;
  let blockBytes: number | null = null,
    bitsPerPixel: number | null = null,
    previewSupported = false;
  if (fourCc === "DX10") {
    if (buffer.length < 148) throw new Error("Truncated DDS DX10 header");
    dataOffset = 148;
    dxgiFormat = readLayoutU32(buffer, 128);
    const dimension = readLayoutU32(buffer, 132);
    if (![2, 3, 4].includes(dimension)) throw new Error(`Invalid DDS resource dimension ${dimension}`);
    resourceDimension = dimension === 2 ? "1D" : dimension === 3 ? "2D" : "3D";
    isCubemap = Boolean(readLayoutU32(buffer, 136) & 4);
    arraySize = readLayoutU32(buffer, 140);
    if (
      !arraySize ||
      (dimension === 4 && arraySize !== 1) ||
      (isCubemap && dimension !== 3) ||
      (dimension === 2 && height !== 1)
    )
      throw new Error("Invalid DDS DX10 array/dimension combination");
    depth = dimension === 4 ? readLayoutU32(buffer, 24) : 1;
    surfaceCount = arraySize * (isCubemap ? 6 : 1);
    const bc = dxgiBc[dxgiFormat];
    if (bc) [format, blockBytes, previewSupported] = bc;
    else {
      const rgb: Record<number, [string, number]> = {
        28: ["R8G8B8A8_UNORM", 32],
        29: ["R8G8B8A8_UNORM_SRGB", 32],
        49: ["R8G8_UNORM", 16],
        61: ["R8_UNORM", 8],
        87: ["B8G8R8A8_UNORM", 32],
        88: ["B8G8R8X8_UNORM", 32],
        91: ["B8G8R8A8_UNORM_SRGB", 32],
        93: ["B8G8R8X8_UNORM_SRGB", 32],
      };
      if (rgb[dxgiFormat]) [format, bitsPerPixel] = rgb[dxgiFormat];
      else format = `DXGI_${dxgiFormat}`;
    }
  } else if (fourCc) {
    const bc = legacyBc[fourCc];
    if (bc) [format, blockBytes, previewSupported] = bc;
  } else if (pixelFlags & 0x40 && [8, 16, 24, 32].includes(readLayoutU32(buffer, 88))) {
    bitsPerPixel = readLayoutU32(buffer, 88);
  }
  if (isCubemap && fourCc !== "DX10") {
    surfaceCount = [0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000].filter((flag) => caps2 & flag).length;
    if (!surfaceCount || resourceDimension === "3D") throw new Error("Invalid DDS cubemap faces/dimensions");
  }
  if (!depth) throw new Error("Invalid DDS volume depth");
  const declaredMipCount = readLayoutU32(buffer, 28);
  const mipCount = declaredMipCount || 1;
  if (mipCount > Math.floor(Math.log2(Math.max(width, height, depth))) + 1)
    throw new Error("DDS mip count exceeds the dimensions' full mip chain");
  let layoutSupported = blockBytes !== null || bitsPerPixel !== null;
  // Legacy writers can use padded rows. Do not invent offsets for that unsupported layout.
  if (
    bitsPerPixel !== null &&
    readLayoutU32(buffer, 8) & 8 &&
    readLayoutU32(buffer, 20) !== Math.ceil((width * bitsPerPixel) / 8)
  )
    layoutSupported = false;
  const mips: DdsMipLayout[] = [];
  let offset = dataOffset;
  if (layoutSupported) {
    for (let level = 0; level < mipCount; level++) {
      const w = Math.max(1, Math.floor(width / 2 ** level)),
        h = Math.max(1, Math.floor(height / 2 ** level)),
        d = Math.max(1, Math.floor(depth / 2 ** level));
      const rowPitch = blockBytes ? Math.max(1, Math.ceil(w / 4)) * blockBytes : Math.ceil((w * bitsPerPixel!) / 8);
      const byteLength = rowPitch * (blockBytes ? Math.max(1, Math.ceil(h / 4)) : h) * d;
      if (!Number.isSafeInteger(offset + byteLength)) throw new Error("DDS payload size exceeds safe integer bounds");
      mips.push({
        level,
        width: w,
        height: h,
        depth: d,
        offset,
        byteLength,
        rowPitch,
        present: offset + byteLength <= logicalLength,
      });
      offset += byteLength;
    }
  }
  const chainBytes = layoutSupported ? offset - dataOffset : null;
  const expectedBytes = chainBytes === null ? null : dataOffset + chainBytes * surfaceCount;
  if (expectedBytes !== null && !Number.isSafeInteger(expectedBytes))
    throw new Error("DDS surface payload size exceeds safe integer bounds");
  let previewUnsupportedReason: string | null = previewSupported ? null : `PNG decoding is not supported for ${format}`;
  if (resourceDimension === "3D") {
    previewSupported = false;
    previewUnsupportedReason = "PNG preview of volume textures is unsupported";
  }
  if (!layoutSupported) {
    previewSupported = false;
    previewUnsupportedReason = "Mip layout is unsupported (unknown format or padded RGB rows)";
  }
  return {
    width,
    height,
    depth,
    mipCount,
    declaredMipCount,
    fourCc,
    dxgiFormat,
    format,
    resourceDimension,
    arraySize,
    surfaceCount,
    isCubemap,
    dataOffset,
    blockBytes,
    bitsPerPixel,
    layoutSupported,
    previewSupported,
    previewUnsupportedReason,
    chainBytes,
    expectedBytes,
    actualBytes: logicalLength,
    complete: expectedBytes === null ? null : expectedBytes <= logicalLength,
    trailingBytes: expectedBytes === null || expectedBytes > logicalLength ? null : logicalLength - expectedBytes,
    mips,
  };
};
