import * as THREE from "three";
import type { GLTFLoader, GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { hashWh3RawKtx2 } from "./Wh3Ktx2Loader";
import {
  canRequestDdsTextures,
  canUploadCompressedFamily,
  decodeWh3DdsBaseMipRgba,
  getTextureColorSpace,
  getThreeCompressedFormat,
  isSrgbTextureChannel,
  parseWh3Dds,
  readWh3DdsGpuSupport,
  type Wh3DdsGpuSupport,
} from "./wh3DdsTexture";

export const MSFT_TEXTURE_DDS = "MSFT_texture_dds";

export type Wh3DdsTiming = {
  ddsTextureCount: number;
  ddsBytes: number;
  ddsTextureWallMs: number;
  ddsUploadMs: number;
  cpuDecodedCount: number;
};

const emptyTiming = (): Omit<Wh3DdsTiming, "ddsTextureWallMs"> => ({
  ddsTextureCount: 0,
  ddsBytes: 0,
  ddsUploadMs: 0,
  cpuDecodedCount: 0,
});

/** userData keys copied from the GLB image extras onto each texture (GLTFLoader also does this later). */
const META_KEYS = ["wh3SourceVirtualPath", "wh3GeneratedFileName", "wh3Channel", "wh3TextureEncoding"] as const;

type ImageMeta = Record<string, unknown>;

/**
 * Loads WH3AssetHost's passthrough .dds textures as block-compressed three.js textures with their full mip
 * chain. Families the GPU cannot take (BC4/5/7 without RGTC/BPTC, or sRGB RGTC) are decoded on the CPU to an
 * RGBA8 DataTexture. Used through the MSFT_texture_dds GLTFLoader plugin, which supplies the image extras
 * (channel decides the colour space; the DDS DXGI sRGB tag is not trusted).
 */
export class Wh3DdsLoader extends THREE.Loader<THREE.Texture> {
  private timing = emptyTiming();
  private wallStartMs: number | undefined;
  private wallEndMs: number | undefined;
  private timingGeneration = 0;

  constructor(
    private readonly support: Wh3DdsGpuSupport,
    manager?: THREE.LoadingManager,
  ) {
    super(manager);
  }

  static fromRenderer(renderer: THREE.WebGLRenderer, manager?: THREE.LoadingManager) {
    return new Wh3DdsLoader(readWh3DdsGpuSupport(renderer), manager);
  }

  /** True when the preview can ask the host for passthrough DDS textures. */
  get canRequestDdsTextures() {
    return canRequestDdsTextures(this.support);
  }

  resetTiming() {
    this.timingGeneration += 1;
    this.timing = emptyTiming();
    this.wallStartMs = undefined;
    this.wallEndMs = undefined;
  }

  getTiming(): Wh3DdsTiming {
    return {
      ...this.timing,
      ddsTextureWallMs: this.wallStartMs == null || this.wallEndMs == null ? 0 : this.wallEndMs - this.wallStartMs,
    };
  }

  /** Uploads DDS-derived textures after GLTFLoader applied the sampler; returns false for other textures. */
  preloadTexture(renderer: THREE.WebGLRenderer, texture: THREE.Texture) {
    if (texture.userData.wh3DdsFormat === undefined) return false;
    const startedAt = performance.now();
    renderer.initTexture(texture);
    const completedAt = performance.now();
    this.timing.ddsUploadMs += completedAt - startedAt;
    this.wallEndMs = this.wallEndMs == null ? completedAt : Math.max(this.wallEndMs, completedAt);
    return true;
  }

  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    this.loadWithMeta(url, {}, onLoad, onProgress, onError);
  }

  /** A loader view bound to one glTF image's extras, as expected by GLTFParser.loadTextureImage. */
  forImage(meta: ImageMeta | undefined): Pick<Wh3DdsLoader, "load"> {
    return {
      load: (url, onLoad, onProgress, onError) => this.loadWithMeta(url, meta ?? {}, onLoad, onProgress, onError),
    };
  }

  loadWithMeta(
    url: string,
    meta: ImageMeta,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    const generation = this.timingGeneration;
    const startedAt = performance.now();
    const loader = new THREE.FileLoader(this.manager);
    loader.setPath(this.path);
    loader.setCrossOrigin(this.crossOrigin);
    loader.setWithCredentials(this.withCredentials);
    loader.setRequestHeader(this.requestHeader);
    loader.setResponseType("arraybuffer");
    loader.load(
      url,
      (data) => {
        try {
          const buffer = data as ArrayBuffer;
          const texture = this.createTexture(buffer, url, meta);
          if (generation === this.timingGeneration) {
            this.timing.ddsTextureCount += 1;
            this.timing.ddsBytes += buffer.byteLength;
            if (texture instanceof THREE.DataTexture) this.timing.cpuDecodedCount += 1;
            this.wallStartMs = this.wallStartMs == null ? startedAt : Math.min(this.wallStartMs, startedAt);
          }
          // Like the KTX2 path, never upload here: GLTFLoader applies the sampler after this callback.
          onLoad(texture);
        } catch (error) {
          onError?.(error);
        }
      },
      onProgress,
      onError,
    );
  }

  private createTexture(buffer: ArrayBuffer, url: string, meta: ImageMeta): THREE.Texture {
    const parsed = parseWh3Dds(buffer);
    const channel = meta.wh3Channel;
    const srgb = isSrgbTextureChannel(channel);
    let texture: THREE.Texture;
    if (canUploadCompressedFamily(parsed.family, srgb, this.support)) {
      texture = new THREE.CompressedTexture(
        parsed.mips.map((mip) => ({ data: mip.data, width: mip.width, height: mip.height })),
        parsed.width,
        parsed.height,
        getThreeCompressedFormat(parsed.family),
        THREE.UnsignedByteType,
      );
      texture.generateMipmaps = false;
      texture.minFilter = parsed.mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    } else {
      const image = decodeWh3DdsBaseMipRgba(parsed.family, parsed.mips[0]);
      texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.unpackAlignment = 1;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
    }
    texture.magFilter = THREE.LinearFilter;
    texture.flipY = false;
    texture.colorSpace = getTextureColorSpace(channel);
    for (const key of META_KEYS) if (meta[key] !== undefined) texture.userData[key] = meta[key];
    texture.userData.wh3DdsFormat = parsed.family;
    texture.userData.wh3DdsCacheKey = hashWh3RawKtx2(buffer);
    texture.userData.wh3PreviewTextureUrl = url;
    texture.needsUpdate = true;
    return texture;
  }
}

/** GLTFLoader plugin: resolves `MSFT_texture_dds` textures through Wh3DdsLoader; other textures untouched. */
class Wh3DdsGltfPlugin implements GLTFLoaderPlugin {
  readonly name = MSFT_TEXTURE_DDS;

  constructor(
    private readonly parser: GLTFParser,
    private readonly ddsLoader: Wh3DdsLoader,
  ) {}

  loadTexture(textureIndex: number): Promise<THREE.Texture> | null {
    const json = this.parser.json as {
      textures?: Array<{ extensions?: Record<string, { source?: number } | undefined> }>;
      images?: Array<{ uri?: string; extras?: ImageMeta }>;
    };
    const extension = json.textures?.[textureIndex]?.extensions?.[MSFT_TEXTURE_DDS];
    if (!extension || typeof extension.source !== "number") return null;
    const sourceDef = json.images?.[extension.source];
    if (!sourceDef?.uri) return null;
    const loader = this.ddsLoader.forImage(sourceDef.extras);
    return this.parser
      .loadTextureImage(textureIndex, extension.source, loader as unknown as THREE.Loader)
      .then((texture: THREE.Texture | null) => {
        // A sampler asking for mipmaps on a single-level compressed texture would sample black.
        if (texture instanceof THREE.CompressedTexture && texture.mipmaps && texture.mipmaps.length <= 1) {
          if (texture.minFilter !== THREE.NearestFilter) texture.minFilter = THREE.LinearFilter;
        }
        return texture as THREE.Texture;
      });
  }
}

export const registerWh3DdsPlugin = (gltfLoader: GLTFLoader, ddsLoader: Wh3DdsLoader) => {
  gltfLoader.register((parser) => new Wh3DdsGltfPlugin(parser, ddsLoader));
  return gltfLoader;
};
