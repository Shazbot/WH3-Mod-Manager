import * as THREE from "three";
import { decodeBlockCompressedRgba, type DdsBlockFamily } from "../esfMap/ddsDecode";
import { inspectDdsLayout } from "../utility/ddsLayout";

/**
 * Pure helpers for the preview's DDS texture path: header/mip parsing, GPU format mapping, colour-space
 * and normal-encoding rules, and the CPU decode the unit painter needs. No renderer state lives here.
 */

/** How the host's passthrough .dds encodes meaning (GLB image extra `wh3TextureEncoding`). */
export type Wh3TextureEncoding = "normal-dxt5nm" | "material-map-wh3" | "direct";

export interface Wh3DdsMip {
  width: number;
  height: number;
  /** Raw block data for this level; a view into the source file, not a copy. */
  data: Uint8Array;
}

export interface Wh3ParsedDds {
  family: DdsBlockFamily;
  width: number;
  height: number;
  /** DXGI format from a DX10 header, or null for legacy FourCC files. */
  dxgiFormat: number | null;
  /** All mip levels present in the file, level 0 first. */
  mips: Wh3DdsMip[];
}

export interface Wh3DdsGpuSupport {
  s3tc: boolean;
  s3tcSrgb: boolean;
  rgtc: boolean;
  bptc: boolean;
}

const SUPPORTED_FAMILIES = new Set<string>(["BC1", "BC2", "BC3", "BC4", "BC5", "BC7"]);

/**
 * Parses a 2D block-compressed DDS into its mip levels. Throws for anything the preview cannot upload
 * (cubemaps, volumes, arrays, uncompressed, BC6H, signed BC4/5, premultiplied DXT2/4) and for files whose
 * base level is truncated. Truncated lower mips only shorten the chain.
 */
export const parseWh3Dds = (source: ArrayBuffer | ArrayBufferView): Wh3ParsedDds => {
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const layout = inspectDdsLayout(bytes);
  const family = layout.format.split("_")[0];
  if (!layout.layoutSupported || layout.blockBytes === null || !SUPPORTED_FAMILIES.has(family))
    throw new Error(`Unsupported DDS format for preview: ${layout.format}`);
  if (layout.format.includes("PREMULTIPLIED") || layout.format.endsWith("SNORM"))
    throw new Error(`Unsupported DDS format for preview: ${layout.format}`);
  if (layout.resourceDimension !== "2D" || layout.isCubemap || layout.surfaceCount !== 1 || layout.arraySize !== 1)
    throw new Error("Only single 2D DDS textures are supported for preview.");
  if (!layout.mips[0]?.present) throw new Error("Truncated DDS: the base mip level is incomplete.");

  const mips: Wh3DdsMip[] = [];
  for (const mip of layout.mips) {
    if (!mip.present) break;
    mips.push({
      width: mip.width,
      height: mip.height,
      data: new Uint8Array(bytes.buffer, bytes.byteOffset + mip.offset, mip.byteLength),
    });
  }
  return {
    family: family as DdsBlockFamily,
    width: layout.width,
    height: layout.height,
    dxgiFormat: layout.dxgiFormat,
    mips,
  };
};

/** Compressed-texture formats to hand to three.js. BC1 keeps its 1-bit alpha (RGBA variant). */
export const getThreeCompressedFormat = (family: DdsBlockFamily): THREE.CompressedPixelFormat => {
  switch (family) {
    case "BC1":
      return THREE.RGBA_S3TC_DXT1_Format;
    case "BC2":
      return THREE.RGBA_S3TC_DXT3_Format;
    case "BC3":
      return THREE.RGBA_S3TC_DXT5_Format;
    case "BC4":
      return THREE.RED_RGTC1_Format;
    case "BC5":
      return THREE.RED_GREEN_RGTC2_Format;
    case "BC7":
      return THREE.RGBA_BPTC_Format;
  }
};

/**
 * Colour space follows the glTF channel, never the DXGI sRGB tag: WH3 material maps carry the sRGB tag
 * while holding linear data, and normals/masks are legacy DXT5.
 */
export const isSrgbTextureChannel = (channel: unknown) =>
  channel === "BaseColor" || channel === "Emissive" || channel === "SpecularColor";

export const getTextureColorSpace = (channel: unknown) =>
  isSrgbTextureChannel(channel) ? THREE.SRGBColorSpace : THREE.NoColorSpace;

/** Whether the GPU can take this family in the given colour space as-is. */
export const canUploadCompressedFamily = (family: DdsBlockFamily, srgb: boolean, support: Wh3DdsGpuSupport) => {
  switch (family) {
    case "BC1":
    case "BC2":
    case "BC3":
      return srgb ? support.s3tcSrgb : support.s3tc;
    case "BC4":
    case "BC5":
      // RGTC has no sRGB variant; sRGB-meaning RGTC data is decoded on the CPU instead.
      return !srgb && support.rgtc;
    case "BC7":
      return support.bptc;
  }
};

export const readWh3DdsGpuSupport = (renderer: THREE.WebGLRenderer): Wh3DdsGpuSupport => ({
  s3tc: renderer.extensions.has("WEBGL_compressed_texture_s3tc"),
  s3tcSrgb: renderer.extensions.has("WEBGL_compressed_texture_s3tc_srgb"),
  rgtc: renderer.extensions.has("EXT_texture_compression_rgtc"),
  bptc: renderer.extensions.has("EXT_texture_compression_bptc"),
});

/** Request `ddsTextures` from the host only when the BC1-3 formats (linear and sRGB) are uploadable. */
export const canRequestDdsTextures = (support: Wh3DdsGpuSupport) => support.s3tc && support.s3tcSrgb;

export const parseWh3TextureEncoding = (value: unknown): Wh3TextureEncoding | undefined =>
  value === "normal-dxt5nm" || value === "material-map-wh3" || value === "direct" ? value : undefined;

/**
 * Converts WH3's packed normal (X = R*A, Y = G, Z rebuilt) to a conventional opaque RGB normal in place.
 * Mirrors the host's ConvertPackedNormalToStandardInPlace. Works for BC5 (A reads 255 from the decoder)
 * and plain RGB normals with A = 255 as well.
 */
export const convertPackedNormalToStandardRgba = (rgba: Uint8Array) => {
  const encode = (component: number) => {
    if (!Number.isFinite(component)) return 0;
    return Math.min(255, Math.max(0, Math.round((Math.min(1, Math.max(-1, component)) + 1) * 0.5 * 255)));
  };
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    const x01 = (rgba[index] / 255) * (rgba[index + 3] / 255);
    const y01 = rgba[index + 1] / 255;
    const normalX = Math.min(1, Math.max(-1, 2 * x01 - 1));
    const normalY = Math.min(1, Math.max(-1, 2 * y01 - 1));
    const normalZ = Math.sqrt(Math.max(0, 1 - normalX * normalX - normalY * normalY));
    rgba[index] = encode(normalX);
    rgba[index + 1] = encode(normalY);
    rgba[index + 2] = encode(normalZ);
    rgba[index + 3] = 255;
  }
  return rgba;
};

/** CPU-decodes the base mip to a fresh, owned RGBA8 array (top row first, like the KTX2 path). */
export const decodeWh3DdsBaseMipRgba = (family: DdsBlockFamily, mip: Wh3DdsMip) => {
  const image = decodeBlockCompressedRgba(family, mip.data, mip.width, mip.height);
  return { width: image.width, height: image.height, data: new Uint8Array(image.pixels) };
};

/** Maps a three.js compressed format back to the DDS family (used to decode loaded CompressedTextures). */
export const getDdsFamilyForThreeFormat = (format: number): DdsBlockFamily | undefined => {
  switch (format) {
    case THREE.RGBA_S3TC_DXT1_Format:
    case THREE.RGB_S3TC_DXT1_Format:
      return "BC1";
    case THREE.RGBA_S3TC_DXT3_Format:
      return "BC2";
    case THREE.RGBA_S3TC_DXT5_Format:
      return "BC3";
    case THREE.RED_RGTC1_Format:
      return "BC4";
    case THREE.RED_GREEN_RGTC2_Format:
      return "BC5";
    case THREE.RGBA_BPTC_Format:
      return "BC7";
    default:
      return undefined;
  }
};
