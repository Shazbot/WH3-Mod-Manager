import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import { createHash } from "node:crypto";
import * as nodePath from "path";
import { ASSET_SCHEME, MAP_CACHE_HOST, mapCacheImageUrl, type AssetBytes } from "../assetUrls";
import type { EsfMapImage, EsfMapPayload } from "./types";

/** Bump whenever the derived map payload or the map extraction rules change. */
const ESF_MAP_CACHE_VERSION = 14;
const ESF_MAP_CACHE_FILE = "esf-map-data-cache.bin";
const ESF_MAP_IMAGE_CACHE_DIR = "esf-map-images";
const ESF_MAP_IMAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SHA256_PNG_FILE = /^([a-f0-9]{64})\.png$/;

export type EsfMapCachedImageName = "background" | "background-text";

const imageCacheRoot = (userDataPath: string) => nodePath.join(userDataPath, ESF_MAP_IMAGE_CACHE_DIR);
const imageCachePath = (userDataPath: string, contentHash: string) =>
  nodePath.join(imageCacheRoot(userDataPath), contentHash + ".png");

type EsfMapDiskPayload = {
  version: number;
  signature: string;
  data: EsfMapPayload;
};

let cachedPayload: EsfMapDiskPayload | undefined;
/** Serializes cache writes with image cleanup so maintenance cannot remove a later save's images. */
let cacheSaveQueue = Promise.resolve();

const cachedImageHash = (image: EsfMapImage | null, imageName: EsfMapCachedImageName): string | undefined => {
  if (!image) return undefined;
  const prefix = `${ASSET_SCHEME}://${MAP_CACHE_HOST}/`;
  const suffix = `/${imageName}.png`;
  if (!image.src.startsWith(prefix) || !image.src.endsWith(suffix)) return undefined;
  const contentHash = image.src.slice(prefix.length, -suffix.length);
  return SHA256_HEX.test(contentHash) ? contentHash : undefined;
};

const cachedImageHashes = (data: EsfMapPayload): Set<string> => {
  const hashes = new Set<string>();
  const backgroundHash = cachedImageHash(data.backgroundImage, "background");
  const backgroundTextHash = cachedImageHash(data.backgroundTextImage, "background-text");
  if (backgroundHash) hashes.add(backgroundHash);
  if (backgroundTextHash) hashes.add(backgroundTextHash);
  return hashes;
};

const markCachedImagesUsed = async (userDataPath: string, data: EsfMapPayload) => {
  const now = new Date();
  await Promise.all(
    [...cachedImageHashes(data)].map((contentHash) =>
      fs.promises.utimes(imageCachePath(userDataPath, contentHash), now, now).catch(() => undefined),
    ),
  );
};

const externalizeImage = async (
  userDataPath: string,
  imageName: EsfMapCachedImageName,
  image: EsfMapImage | null,
): Promise<EsfMapImage | null> => {
  if (!image || !image.src.startsWith(PNG_DATA_URL_PREFIX)) return image;
  const png = Buffer.from(image.src.slice(PNG_DATA_URL_PREFIX.length), "base64");
  const contentHash = createHash("sha256").update(png).digest("hex");
  await fs.promises.mkdir(imageCacheRoot(userDataPath), { recursive: true });
  try {
    // Content-addressed files are immutable. Avoid rewriting an image that was already cached by a
    // previous map signature or campaign load.
    await fs.promises.writeFile(imageCachePath(userDataPath, contentHash), png, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return { ...image, src: mapCacheImageUrl(contentHash, imageName) };
};

/**
 * Moves large PNG data URLs out of the structured map payload before it is compressed or sent over
 * IPC. Files are addressed by their SHA-256 content hash, so identical map images are reused across
 * unrelated map signatures. The payload object is updated in place so callers immediately benefit.
 */
export const externalizeEsfMapImages = async (userDataPath: string, data: EsfMapPayload): Promise<EsfMapPayload> => {
  const [backgroundImage, backgroundTextImage] = await Promise.all([
    externalizeImage(userDataPath, "background", data.backgroundImage),
    externalizeImage(userDataPath, "background-text", data.backgroundTextImage),
  ]);
  data.backgroundImage = backgroundImage;
  data.backgroundTextImage = backgroundTextImage;
  return data;
};

const cachedImagesExist = async (userDataPath: string, payload: EsfMapDiskPayload): Promise<boolean> => {
  const required: Array<[EsfMapCachedImageName, EsfMapImage]> = [];
  if (payload.data.backgroundImage) required.push(["background", payload.data.backgroundImage]);
  if (payload.data.backgroundTextImage) required.push(["background-text", payload.data.backgroundTextImage]);
  const results = await Promise.all(
    required.map(async ([imageName, image]) => {
      const contentHash = cachedImageHash(image, imageName);
      if (!contentHash) return false;
      try {
        await fs.promises.access(imageCachePath(userDataPath, contentHash), fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
};

export const resolveEsfMapCachedImage = async (
  userDataPath: string,
  contentHash: string,
  imageName: string,
): Promise<AssetBytes | undefined> => {
  if (!SHA256_HEX.test(contentHash)) return undefined;
  if (imageName !== "background" && imageName !== "background-text") return undefined;
  try {
    return {
      buffer: await fs.promises.readFile(imageCachePath(userDataPath, contentHash)),
      mimeType: "image/png",
    };
  } catch {
    return undefined;
  }
};

export const loadEsfMapDiskCache = async (
  userDataPath: string,
  signature: string,
): Promise<EsfMapPayload | undefined> => {
  if (cachedPayload?.signature === signature && cachedPayload.version === ESF_MAP_CACHE_VERSION) {
    return cachedPayload.data;
  }
  try {
    const compressed = await fs.promises.readFile(nodePath.join(userDataPath, ESF_MAP_CACHE_FILE));
    const json = await zstdDecompress(compressed);
    const payload = JSON.parse(json.toString("utf8")) as EsfMapDiskPayload;
    if (payload.version !== ESF_MAP_CACHE_VERSION || payload.signature !== signature) return undefined;
    if (!(await cachedImagesExist(userDataPath, payload))) return undefined;
    await markCachedImagesUsed(userDataPath, payload.data);
    cachedPayload = payload;
    return payload.data;
  } catch {
    return undefined;
  }
};

/**
 * Keeps content-addressed map images around for reuse, but removes ones that have not been used for
 * 90 days. Hashes referenced by the current cache are always retained. Old signature directories
 * from the pre-content-addressed cache are also removed.
 */
export const cleanupEsfMapImageCache = async (
  userDataPath: string,
  currentData: EsfMapPayload,
  now = Date.now(),
): Promise<void> => {
  const root = imageCacheRoot(userDataPath);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  const currentHashes = cachedImageHashes(currentData);
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = nodePath.join(root, entry.name);
      if (entry.isDirectory()) {
        await fs.promises.rm(entryPath, { recursive: true, force: true }).catch(() => undefined);
        return;
      }
      if (!entry.isFile()) return;
      const match = SHA256_PNG_FILE.exec(entry.name);
      if (!match || currentHashes.has(match[1])) return;
      try {
        const stat = await fs.promises.stat(entryPath);
        if (now - stat.mtimeMs < ESF_MAP_IMAGE_RETENTION_MS) return;
        await fs.promises.rm(entryPath, { force: true });
      } catch {
        // Best-effort maintenance must never make the map cache fail.
      }
    }),
  );
};

export const saveEsfMapDiskCache = (
  userDataPath: string,
  signature: string,
  data: EsfMapPayload,
): Promise<void> => {
  const save = cacheSaveQueue.then(async () => {
    try {
      await externalizeEsfMapImages(userDataPath, data);
      await markCachedImagesUsed(userDataPath, data);
      const payload: EsfMapDiskPayload = { version: ESF_MAP_CACHE_VERSION, signature, data };
      const json = Buffer.from(JSON.stringify(payload), "utf8");
      const compressed = await zstdCompress(json, 1);
      await fs.promises.writeFile(nodePath.join(userDataPath, ESF_MAP_CACHE_FILE), compressed);
      cachedPayload = payload;
      await cleanupEsfMapImageCache(userDataPath, data);
    } catch (error) {
      console.error("Failed to save ESF map cache:", error);
    }
  });
  cacheSaveQueue = save;
  return save;
};

export const clearEsfMapMemoryCache = () => {
  cachedPayload = undefined;
};
