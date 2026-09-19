import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { ZSTDDecoder } from "three/examples/jsm/libs/zstddec.module.js";
import { parseWh3RawKtx2Header, type Wh3RawKtx2Header } from "./wh3RawKtx2";

let zstdDecoderPromise: Promise<ZSTDDecoder> | undefined;

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
  load(
    url: string,
    onLoad: (texture: THREE.CompressedTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
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

        void this.createWh3RawTexture(buffer, header)
          .then((texture) => {
            // GLTFLoader is typed against KTX2Loader<CompressedTexture>, but it
            // accepts any Texture at runtime. This is deliberately a DataTexture
            // so GLTFLoader can apply the glTF sampler and generate mipmaps.
            onLoad(texture as unknown as THREE.CompressedTexture);
          })
          .catch((error) => onError?.(error));
      },
      onProgress,
      onError,
    );
  }

  private async createWh3RawTexture(buffer: ArrayBuffer, header: Wh3RawKtx2Header) {
    const decoder = await getZstdDecoder();
    const compressed = new Uint8Array(buffer, header.levelOffset, header.levelLength);
    const rgba = decoder.decode(compressed, header.uncompressedLength);

    if (rgba.byteLength !== header.uncompressedLength) {
      throw new Error(
        `WH3 raw KTX2 Zstd size mismatch: decoded ${rgba.byteLength}, expected ${header.uncompressedLength}.`,
      );
    }

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
    return texture;
  }
}
