import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { decodeBlockCompressedRgba } from "../src/esfMap/dds";
import { Wh3DdsLoader } from "../src/visuals/Wh3DdsLoader";
import {
  applyWh3TextureEncodingToFragmentShader,
  getWh3TextureEncodingCacheKey,
  installWh3TextureEncodingPatch,
} from "../src/visuals/wh3TextureEncodingShader";
import {
  canRequestDdsTextures,
  canUploadCompressedFamily,
  convertPackedNormalToStandardRgba,
  decodeWh3DdsBaseMipRgba,
  getDdsFamilyForThreeFormat,
  getTextureColorSpace,
  getThreeCompressedFormat,
  parseWh3Dds,
  type Wh3DdsGpuSupport,
} from "../src/visuals/wh3DdsTexture";

const blockBytesFor = { BC1: 8, BC2: 16, BC3: 16, BC4: 8, BC5: 16, BC7: 16 } as const;

const chainBytes = (width: number, height: number, mipCount: number, blockBytes: number) => {
  let total = 0;
  for (let level = 0; level < mipCount; level += 1) {
    const w = Math.max(1, width >> level);
    const h = Math.max(1, height >> level);
    total += Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
  }
  return total;
};

/** Builds a DDS whose payload bytes are a repeating counter so each mip has distinct data. */
const createDds = (options: {
  fourCc?: string;
  dxgi?: number;
  family: keyof typeof blockBytesFor;
  width: number;
  height: number;
  mipCount?: number;
  payloadBytes?: number;
}) => {
  const mipCount = options.mipCount ?? 1;
  const blockBytes = blockBytesFor[options.family];
  const payload = options.payloadBytes ?? chainBytes(options.width, options.height, mipCount, blockBytes);
  const headerBytes = options.dxgi !== undefined ? 148 : 128;
  const dds = Buffer.alloc(headerBytes + payload);
  dds.write("DDS ", 0, "ascii");
  dds.writeUInt32LE(124, 4);
  dds.writeUInt32LE(options.height, 12);
  dds.writeUInt32LE(options.width, 16);
  dds.writeUInt32LE(mipCount, 28);
  dds.writeUInt32LE(32, 76);
  dds.writeUInt32LE(4, 80);
  dds.write(options.dxgi !== undefined ? "DX10" : (options.fourCc ?? "DXT1"), 84, "ascii");
  if (options.dxgi !== undefined) {
    dds.writeUInt32LE(options.dxgi, 128);
    dds.writeUInt32LE(3, 132);
    dds.writeUInt32LE(1, 140);
  }
  for (let index = 0; index < payload; index += 1) dds[headerBytes + index] = index & 0xff;
  return dds;
};

const toArrayBuffer = (buffer: Buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

describe("parseWh3Dds", () => {
  it("parses a DX10 BC1 sRGB file with a full mip chain", () => {
    const parsed = parseWh3Dds(
      toArrayBuffer(createDds({ dxgi: 72, family: "BC1", width: 16, height: 8, mipCount: 5 })),
    );
    expect(parsed.family).toBe("BC1");
    expect(parsed.dxgiFormat).toBe(72);
    expect(parsed.mips.map((mip) => [mip.width, mip.height, mip.data.length])).toEqual([
      [16, 8, 64],
      [8, 4, 16],
      [4, 2, 8],
      [2, 1, 8],
      [1, 1, 8],
    ]);
    // Mip data are views into the source file laid out back to back.
    expect(parsed.mips[0].data[0]).toBe(0);
    expect(parsed.mips[1].data[0]).toBe(64 & 0xff);
  });

  it("parses legacy DXT1, DXT5 and BC5 (ATI2) files", () => {
    expect(parseWh3Dds(toArrayBuffer(createDds({ fourCc: "DXT1", family: "BC1", width: 8, height: 8 }))).family).toBe(
      "BC1",
    );
    const dxt5 = parseWh3Dds(
      toArrayBuffer(createDds({ fourCc: "DXT5", family: "BC3", width: 8, height: 8, mipCount: 4 })),
    );
    expect(dxt5.family).toBe("BC3");
    expect(dxt5.dxgiFormat).toBeNull();
    expect(dxt5.mips).toHaveLength(4);
    const bc5 = parseWh3Dds(toArrayBuffer(createDds({ fourCc: "ATI2", family: "BC5", width: 4, height: 4 })));
    expect(bc5.family).toBe("BC5");
    expect(bc5.mips[0].data).toHaveLength(16);
  });

  it("parses DX10 BC5 and BC7 files", () => {
    expect(
      parseWh3Dds(toArrayBuffer(createDds({ dxgi: 83, family: "BC5", width: 8, height: 8, mipCount: 4 }))).family,
    ).toBe("BC5");
    expect(
      parseWh3Dds(toArrayBuffer(createDds({ dxgi: 98, family: "BC7", width: 8, height: 8, mipCount: 4 }))).family,
    ).toBe("BC7");
  });

  it("accepts typed array views without copying", () => {
    const dds = createDds({ dxgi: 72, family: "BC1", width: 4, height: 4 });
    const parsed = parseWh3Dds(new Uint8Array(dds.buffer, dds.byteOffset, dds.byteLength));
    expect(parsed.mips[0].data.buffer).toBe(dds.buffer);
  });

  it("keeps the present mips when the tail is truncated", () => {
    const full = createDds({ fourCc: "DXT5", family: "BC3", width: 8, height: 8, mipCount: 4 });
    const parsed = parseWh3Dds(toArrayBuffer(full.subarray(0, full.length - 8)));
    expect(parsed.mips.length).toBeLessThan(4);
    expect(parsed.mips.length).toBeGreaterThan(0);
  });

  it("rejects truncated base levels and invalid input", () => {
    const full = createDds({ fourCc: "DXT1", family: "BC1", width: 8, height: 8 });
    expect(() => parseWh3Dds(toArrayBuffer(full.subarray(0, 130)))).toThrow(/Truncated/);
    expect(() => parseWh3Dds(toArrayBuffer(Buffer.from("not a dds file".padEnd(200, "x"))))).toThrow(/Invalid DDS/);
    expect(() => parseWh3Dds(new ArrayBuffer(16))).toThrow();
  });

  it("rejects unsupported formats", () => {
    // BC6H (DXGI 95), premultiplied DXT2, signed BC5 and uncompressed RGBA8.
    expect(() => parseWh3Dds(toArrayBuffer(createDds({ dxgi: 95, family: "BC7", width: 4, height: 4 })))).toThrow(
      /Unsupported/,
    );
    expect(() => parseWh3Dds(toArrayBuffer(createDds({ fourCc: "DXT2", family: "BC2", width: 4, height: 4 })))).toThrow(
      /Unsupported/,
    );
    expect(() => parseWh3Dds(toArrayBuffer(createDds({ fourCc: "BC5S", family: "BC5", width: 4, height: 4 })))).toThrow(
      /Unsupported/,
    );
    expect(() =>
      parseWh3Dds(toArrayBuffer(createDds({ dxgi: 28, family: "BC1", width: 4, height: 4, payloadBytes: 64 }))),
    ).toThrow(/Unsupported/);
  });
});

describe("format mapping and colour space", () => {
  it("maps block families to three.js compressed formats and back", () => {
    expect(getThreeCompressedFormat("BC1")).toBe(THREE.RGBA_S3TC_DXT1_Format);
    expect(getThreeCompressedFormat("BC2")).toBe(THREE.RGBA_S3TC_DXT3_Format);
    expect(getThreeCompressedFormat("BC3")).toBe(THREE.RGBA_S3TC_DXT5_Format);
    expect(getThreeCompressedFormat("BC4")).toBe(THREE.RED_RGTC1_Format);
    expect(getThreeCompressedFormat("BC5")).toBe(THREE.RED_GREEN_RGTC2_Format);
    expect(getThreeCompressedFormat("BC7")).toBe(THREE.RGBA_BPTC_Format);
    for (const family of ["BC1", "BC2", "BC3", "BC4", "BC5", "BC7"] as const) {
      expect(getDdsFamilyForThreeFormat(getThreeCompressedFormat(family))).toBe(family);
    }
  });

  it("chooses colour space by channel, never by the DXGI tag", () => {
    expect(getTextureColorSpace("BaseColor")).toBe(THREE.SRGBColorSpace);
    expect(getTextureColorSpace("Emissive")).toBe(THREE.SRGBColorSpace);
    expect(getTextureColorSpace("SpecularColor")).toBe(THREE.SRGBColorSpace);
    expect(getTextureColorSpace("MaterialMap")).toBe(THREE.NoColorSpace);
    expect(getTextureColorSpace("Normal")).toBe(THREE.NoColorSpace);
    expect(getTextureColorSpace(undefined)).toBe(THREE.NoColorSpace);
  });

  it("gates GPU upload on the extension that carries the format", () => {
    const all: Wh3DdsGpuSupport = { s3tc: true, s3tcSrgb: true, rgtc: true, bptc: true };
    const none: Wh3DdsGpuSupport = { s3tc: false, s3tcSrgb: false, rgtc: false, bptc: false };
    expect(canUploadCompressedFamily("BC1", true, all)).toBe(true);
    expect(canUploadCompressedFamily("BC1", true, { ...all, s3tcSrgb: false })).toBe(false);
    expect(canUploadCompressedFamily("BC3", false, { ...all, s3tc: false })).toBe(false);
    expect(canUploadCompressedFamily("BC5", false, all)).toBe(true);
    expect(canUploadCompressedFamily("BC5", false, { ...all, rgtc: false })).toBe(false);
    expect(canUploadCompressedFamily("BC4", true, all)).toBe(false);
    expect(canUploadCompressedFamily("BC7", false, { ...all, bptc: false })).toBe(false);
    expect(canUploadCompressedFamily("BC1", false, none)).toBe(false);
    expect(canRequestDdsTextures(all)).toBe(true);
    expect(canRequestDdsTextures({ ...all, s3tcSrgb: false })).toBe(false);
  });
});

describe("convertPackedNormalToStandardRgba", () => {
  it("rebuilds X = R*A, Y = G and Z, with an opaque result", () => {
    // Flat normal: X = 0.5 (R*A), Y = 0.5 -> normal (0, 0, 1).
    const flat = convertPackedNormalToStandardRgba(new Uint8Array([128, 128, 0, 255]));
    expect(Array.from(flat)).toEqual([128, 128, 255, 255]);
    // DXT5nm style: R is 255 and X lives in A.
    const packed = convertPackedNormalToStandardRgba(new Uint8Array([255, 255, 0, 0]));
    expect(packed[0]).toBe(0); // X = -1
    expect(packed[1]).toBe(255); // Y = +1
    expect(packed[2]).toBe(128); // Z = 0
    expect(packed[3]).toBe(255);
  });

  it("matches the host formula on a sampled grid", () => {
    const input = new Uint8Array(4 * 16);
    for (let index = 0; index < 16; index += 1) {
      input.set([index * 17, 255 - index * 11, 7, 255 - index * 3], index * 4);
    }
    const expected = new Uint8Array(input);
    for (let index = 0; index < 16; index += 1) {
      const x = Math.min(1, Math.max(-1, 2 * ((input[index * 4] / 255) * (input[index * 4 + 3] / 255)) - 1));
      const y = Math.min(1, Math.max(-1, 2 * (input[index * 4 + 1] / 255) - 1));
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const enc = (c: number) => Math.round((c + 1) * 0.5 * 255);
      expected.set([enc(x), enc(y), enc(z), 255], index * 4);
    }
    expect(Array.from(convertPackedNormalToStandardRgba(input))).toEqual(Array.from(expected));
  });
});

describe("BC4/BC5 CPU decode", () => {
  it("decodes a solid BC4 block and clips partial blocks", () => {
    const block = new Uint8Array([200, 100, 0, 0, 0, 0, 0, 0]); // all indices 0 -> value0
    const image = decodeBlockCompressedRgba("BC4", block, 3, 2);
    expect(image.width).toBe(3);
    expect(image.pixels).toHaveLength(3 * 2 * 4);
    for (let pixel = 0; pixel < 6; pixel += 1) {
      expect(Array.from(image.pixels.subarray(pixel * 4, pixel * 4 + 4))).toEqual([200, 0, 0, 255]);
    }
  });

  it("uses the 6-value palette plus 0/255 when value0 <= value1", () => {
    // 3-bit indices: pixel 0 -> 6 (the fixed 0), pixel 1 -> 7 (the fixed 255), the rest -> 0 (value0 = 50).
    const block = new Uint8Array([50, 100, 6 | (7 << 3), 0, 0, 0, 0, 0]);
    const image = decodeBlockCompressedRgba("BC4", block, 4, 4);
    const value = (pixel: number) => image.pixels[pixel * 4];
    expect([value(0), value(1), value(2), value(15)]).toEqual([0, 255, 50, 50]);
  });

  it("decodes BC5 into R and G with opaque alpha", () => {
    const block = new Uint8Array([10, 0, 0, 0, 0, 0, 0, 0, 90, 0, 0, 0, 0, 0, 0, 0]);
    const image = decodeBlockCompressedRgba("BC5", block, 4, 4);
    expect(Array.from(image.pixels.subarray(0, 4))).toEqual([10, 90, 0, 255]);
    expect(Array.from(image.pixels.subarray(60, 64))).toEqual([10, 90, 0, 255]);
  });

  it("rejects truncated data", () => {
    expect(() => decodeBlockCompressedRgba("BC5", new Uint8Array(8), 4, 4)).toThrow(/Truncated/);
    expect(() => decodeBlockCompressedRgba("BC4", new Uint8Array(8), 0, 4)).toThrow(/Invalid/);
  });

  it("decodes BC1 base mips from a parsed DDS", () => {
    const dds = createDds({ fourCc: "DXT1", family: "BC1", width: 8, height: 8, mipCount: 2 });
    const parsed = parseWh3Dds(toArrayBuffer(dds));
    const image = decodeWh3DdsBaseMipRgba(parsed.family, parsed.mips[0]);
    expect(image.width).toBe(8);
    expect(image.data).toHaveLength(8 * 8 * 4);
  });
});

describe("Wh3DdsLoader texture creation", () => {
  const all: Wh3DdsGpuSupport = { s3tc: true, s3tcSrgb: true, rgtc: true, bptc: true };
  const create = (loader: Wh3DdsLoader, dds: Buffer, meta: Record<string, unknown>) =>
    (
      loader as unknown as { createTexture: (b: ArrayBuffer, url: string, m: Record<string, unknown>) => THREE.Texture }
    ).createTexture(toArrayBuffer(dds), "whmm://model-preview/x/a.dds", meta);

  it("builds a mipmapped CompressedTexture with channel-driven colour space and metadata", () => {
    const loader = new Wh3DdsLoader(all);
    const texture = create(loader, createDds({ dxgi: 72, family: "BC1", width: 16, height: 16, mipCount: 5 }), {
      wh3Channel: "BaseColor",
      wh3SourceVirtualPath: "textures\\body_diffuse.dds",
      wh3TextureEncoding: "direct",
    });
    expect(texture).toBeInstanceOf(THREE.CompressedTexture);
    const compressed = texture as THREE.CompressedTexture;
    expect(compressed.format).toBe(THREE.RGBA_S3TC_DXT1_Format);
    expect(compressed.mipmaps).toHaveLength(5);
    expect(compressed.generateMipmaps).toBe(false);
    expect(compressed.flipY).toBe(false);
    expect(compressed.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(compressed.magFilter).toBe(THREE.LinearFilter);
    expect(compressed.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.userData.wh3SourceVirtualPath).toBe("textures\\body_diffuse.dds");
    expect(texture.userData.wh3TextureEncoding).toBe("direct");
    expect(texture.userData.wh3DdsFormat).toBe("BC1");
    expect(typeof texture.userData.wh3DdsCacheKey).toBe("string");
  });

  it("keeps material maps linear even when the DXGI tag says sRGB, and single-level uses Linear", () => {
    const loader = new Wh3DdsLoader(all);
    const texture = create(loader, createDds({ dxgi: 72, family: "BC1", width: 8, height: 8 }), {
      wh3Channel: "MaterialMap",
      wh3TextureEncoding: "material-map-wh3",
    });
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
  });

  it("decodes BC5 on the CPU when RGTC is missing and counts it", () => {
    const loader = new Wh3DdsLoader({ ...all, rgtc: false });
    const texture = create(loader, createDds({ fourCc: "ATI2", family: "BC5", width: 8, height: 8 }), {
      wh3Channel: "Normal",
    });
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect((texture as THREE.DataTexture).image.width).toBe(8);
    expect(texture.userData.wh3DdsFormat).toBe("BC5");
  });

  it("rejects unsupported files so the caller can surface the error", () => {
    const loader = new Wh3DdsLoader(all);
    expect(() => create(loader, Buffer.alloc(200), {})).toThrow();
  });
});

describe("wh3 texture encoding shader patch", () => {
  const fragment = "a\n#include <normal_fragment_maps>\nb\n#include <metalnessmap_fragment>\nc";

  it("rewrites only the requested includes", () => {
    expect(applyWh3TextureEncodingToFragmentShader(fragment, { normalDxt5nm: false, materialMapWh3: false })).toBe(
      fragment,
    );
    const normalOnly = applyWh3TextureEncodingToFragmentShader(fragment, { normalDxt5nm: true, materialMapWh3: false });
    expect(normalOnly).toContain("wh3NormalTexel.r * wh3NormalTexel.a");
    expect(normalOnly).toContain("#include <normal_fragment_maps>"); // kept inside the #else branch
    expect(normalOnly).toContain("#include <metalnessmap_fragment>");
    const both = applyWh3TextureEncodingToFragmentShader(fragment, { normalDxt5nm: true, materialMapWh3: true });
    expect(both).not.toContain("#include <metalnessmap_fragment>");
    expect(both).toContain("metalnessFactor *= texelMetalness.r;");
  });

  const encodedTexture = (encoding: string) => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    texture.userData.wh3TextureEncoding = encoding;
    return texture;
  };
  const compile = (material: THREE.MeshStandardMaterial) => {
    const shader = { fragmentShader: fragment } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, undefined as never);
    return { shader, key: material.customProgramCacheKey() };
  };

  it("follows the textures currently assigned and changes the program cache key", () => {
    const material = new THREE.MeshStandardMaterial();
    const normal = encodedTexture("normal-dxt5nm");
    material.normalMap = normal;
    material.metalnessMap = encodedTexture("material-map-wh3");
    expect(installWh3TextureEncodingPatch(material)).toBe(true);
    expect(installWh3TextureEncodingPatch(material)).toBe(false);

    const withBoth = compile(material);
    expect(withBoth.shader.fragmentShader).toContain("wh3NormalTexel");
    expect(withBoth.shader.fragmentShader).toContain("texelMetalness.r");
    expect(withBoth.key).toContain(getWh3TextureEncodingCacheKey({ normalDxt5nm: true, materialMapWh3: true }));

    // Painter swaps in a standard-form texture without an encoding: the normal patch drops out.
    material.normalMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const swapped = compile(material);
    expect(swapped.shader.fragmentShader).not.toContain("wh3NormalTexel");
    expect(swapped.shader.fragmentShader).toContain("texelMetalness.r");
    expect(swapped.key).not.toBe(withBoth.key);

    material.normalMap = normal;
    expect(compile(material).key).toBe(withBoth.key);
  });

  it("composes with a later onBeforeCompile and customProgramCacheKey in either order", () => {
    const material = new THREE.MeshStandardMaterial();
    material.normalMap = encodedTexture("normal-dxt5nm");
    installWh3TextureEncodingPatch(material);

    // Same wrapping pattern as the faction colour preview: capture previous, then assign.
    const previousHook = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previousHook.call(material, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace("b\n", "b\nFACTION\n");
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}|faction`;
    const wrapped = compile(material);
    expect(wrapped.shader.fragmentShader).toContain("wh3NormalTexel");
    expect(wrapped.shader.fragmentShader).toContain("FACTION");
    expect(wrapped.key).toContain("|faction");
    expect(wrapped.key).toContain("wh3enc:n-");

    // Restoring the captured hooks (faction toggled off) keeps the encoding patch.
    material.onBeforeCompile = previousHook;
    material.customProgramCacheKey = previousKey;
    const restored = compile(material);
    expect(restored.shader.fragmentShader).toContain("wh3NormalTexel");
    expect(restored.shader.fragmentShader).not.toContain("FACTION");
    expect(restored.key).not.toContain("faction");
  });

  it("ignores materials without encoded textures", () => {
    const material = new THREE.MeshStandardMaterial();
    material.normalMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    expect(installWh3TextureEncodingPatch(material)).toBe(false);
  });
});
