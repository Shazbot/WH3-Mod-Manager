import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { ZSTDDecoder } from "three/examples/jsm/libs/zstddec.module.js";
import { parseWh3RawKtx2Header, type Wh3RawKtx2Header } from "./wh3RawKtx2";

let zstdDecoderPromise: Promise<ZSTDDecoder> | undefined;

export type Wh3Ktx2Timing = {
  rawTextureCount: number;
  compressedBytes: number;
  decodedBytes: number;
  rawTextureWallMs: number;
  zstdDecodeMs: number;
  textureCreateMs: number;
  textureUploadMs: number;
};

const emptyTiming = (): Omit<Wh3Ktx2Timing, "rawTextureWallMs"> => ({
  rawTextureCount: 0,
  compressedBytes: 0,
  decodedBytes: 0,
  zstdDecodeMs: 0,
  textureCreateMs: 0,
  textureUploadMs: 0,
});

const getZstdDecoder = () => {
  if (!zstdDecoderPromise) {
    const decoder = new ZSTDDecoder();
    zstdDecoderPromise = decoder.init().then(() => decoder);
  }
  return zstdDecoderPromise;
};

/**
 * KTX2Loader compatibility adapter for WH3AssetHost's low-latency preview
 * texture format.
 *
 * Basis/UASTC KTX2 files still use Three's normal KTX2Loader. The host's
 * private raw RGBA8 + Zstd KTX2 flavor is decoded directly into a DataTexture,
 * avoiding Three r186's generic raw-KTX2 texture construction path.
 */
export class Wh3Ktx2Loader extends KTX2Loader {
  private timingGeneration = 0;
  private timing = emptyTiming();
  private rawWallStartMs: number | undefined;
  private rawWallEndMs: number | undefined;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    super();
  }

  resetTiming() {
    this.timingGeneration += 1;
    this.timing = emptyTiming();
    this.rawWallStartMs = undefined;
    this.rawWallEndMs = undefined;
  }

  getTiming(): Wh3Ktx2Timing {
    return {
      ...this.timing,
      rawTextureWallMs:
        this.rawWallStartMs == null || this.rawWallEndMs == null ? 0 : this.rawWallEndMs - this.rawWallStartMs,
    };
  }

  /**
   * Preloads a texture only after GLTFLoader has finished applying the glTF
   * sampler state. Uploading from load() is too early: wrapping/filtering are
   * assigned in GLTFLoader's promise continuation after our onLoad callback.
   */
  preloadTexture(texture: THREE.Texture) {
    const isRawPreviewTexture = texture instanceof THREE.DataTexture;
    const uploadStartedAt = performance.now();
    this.renderer.initTexture(texture);
    const uploadMs = performance.now() - uploadStartedAt;

    if (isRawPreviewTexture) {
      this.timing.textureUploadMs += uploadMs;
      const completedAt = performance.now();
      this.rawWallEndMs =
        this.rawWallEndMs == null ? completedAt : Math.max(this.rawWallEndMs, completedAt);
    }
  }

  load(
    url: string,
    onLoad: (texture: THREE.CompressedTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const timingGeneration = this.timingGeneration;
    const loadStartedAt = performance.now();
    const loader = new THREE.FileLoader<ArrayBuffer>(this.manager);
    loader.setPath(this.path);
    loader.setCrossOrigin(this.crossOrigin);
    loader.setWithCredentials(this.withCredentials);
    loader.setRequestHeader(this.requestHeader);
    loader.setResponseType("arraybuffer");

    loader.load(
      url,
      (buffer) => {
        let header: Wh3RawKtx2Header | undefined;
        try {
          header = parseWh3RawKtx2Header(buffer);
        } catch (error) {
          onError?.(error);
          return;
        }

        if (!header) {
          super.parse(buffer, onLoad, onError);
          return;
        }

        if (timingGeneration === this.timingGeneration) {
          this.timing.rawTextureCount += 1;
          this.timing.compressedBytes += header.levelLength;
          this.rawWallStartMs =
            this.rawWallStartMs == null ? loadStartedAt : Math.min(this.rawWallStartMs, loadStartedAt);
        }

        void this.createWh3RawTexture(buffer, header, timingGeneration)
          .then((texture) => {
            // GLTFLoader is typed against KTX2Loader<CompressedTexture>, but it
            // accepts any Texture at runtime. This is deliberately a DataTexture.
            //
            // Do not upload the texture here. GLTFLoader applies the glTF sampler
            // (including RepeatWrapping) in its promise continuation after this
            // callback returns. Eager upload here would leave the GPU texture with
            // DataTexture's default ClampToEdgeWrapping and smear meshes whose UVs
            // intentionally extend outside 0..1.
            onLoad(texture as unknown as THREE.CompressedTexture);
          })
          .catch((error) => onError?.(error));
      },
      onProgress,
      onError,
    );
  }

  private async createWh3RawTexture(
    buffer: ArrayBuffer,
    header: Wh3RawKtx2Header,
    timingGeneration: number,
  ) {
    const decoder = await getZstdDecoder();
    const compressed = new Uint8Array(buffer, header.levelOffset, header.levelLength);

    const decodeStartedAt = performance.now();
    const rgba = decoder.decode(compressed, header.uncompressedLength);
    const decodeMs = performance.now() - decodeStartedAt;

    if (rgba.byteLength !== header.uncompressedLength) {
      throw new Error(
        `WH3 raw KTX2 Zstd size mismatch: decoded ${rgba.byteLength}, expected ${header.uncompressedLength}.`,
      );
    }

    const textureStartedAt = performance.now();
    const texture = new THREE.DataTexture(
      rgba,
      header.width,
      header.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.colorSpace = header.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const textureCreateMs = performance.now() - textureStartedAt;

    if (timingGeneration === this.timingGeneration) {
      this.timing.decodedBytes += rgba.byteLength;
      this.timing.zstdDecodeMs += decodeMs;
      this.timing.textureCreateMs += textureCreateMs;
    }

    return texture;
  }
}
