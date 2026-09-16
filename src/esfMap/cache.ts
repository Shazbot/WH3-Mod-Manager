import { compress as zstdCompress, decompress as zstdDecompress } from "@mongodb-js/zstd";
import * as fs from "fs";
import * as nodePath from "path";
import { mapCacheImageUrl, type AssetBytes } from "../assetUrls";
import type { EsfMapImage, EsfMapPayload } from "./types";

/** Bump whenever the derived map payload or the map extraction rules change. */
const ESF_MAP_CACHE_VERSION = 13;
const ESF_MAP_CACHE_FILE = "esf-map-data-cache.bin";
const ESF_MAP_IMAGE_CACHE_DIR = "esf-map-images";
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export type EsfMapCachedImageName = "background" | "background-text";

const imageFileName = (imageName: EsfMapCachedImageName) => imageName + ".png";
const imageCacheRoot = (userDataPath: string) => nodePath.join(userDataPath, ESF_MAP_IMAGE_CACHE_DIR);
const imageCacheDirectory = (userDataPath: string, signature: string) =>
  nodePath.join(imageCacheRoot(userDataPath), signature);
const imageCachePath = (userDataPath: string, signature: string, imageName: EsfMapCachedImageName) =>
  nodePath.join(imageCacheDirectory(userDataPath, signature), imageFileName(imageName));

type EsfMapDiskPayload = {
  version: number;
  signature: string;
  data: EsfMapPayload;
};

let cachedPayload: EsfMapDiskPayload | undefined;

const externalizeImage = async (
  userDataPath: string,
  signature: string,
  imageName: EsfMapCachedImageName,
  image: EsfMapImage | null,
): Promise<EsfMapImage | null> => {
  if (!image || !image.src.startsWith(PNG_DATA_URL_PREFIX)) return image;
  const png = Buffer.from(image.src.slice(PNG_DATA_URL_PREFIX.length), "base64");
  const directory = imageCacheDirectory(userDataPath, signature);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(imageCachePath(userDataPath, signature, imageName), png);
  return { ...image, src: mapCacheImageUrl(signature, imageName) };
};

/**
 * Moves large PNG data URLs out of the structured map payload before it is compressed or sent over
 * IPC. The payload object is updated in place so existing callers that keep and return the same map
 * immediately benefit without another copy of the large base64 strings.
 */
export const externalizeEsfMapImages = async (
  userDataPath: string,
  signature: string,
  data: EsfMapPayload,
): Promise<EsfMapPayload> => {
  const [backgroundImage, backgroundTextImage] = await Promise.all([
    externalizeImage(userDataPath, signature, "background", data.backgroundImage),
    externalizeImage(userDataPath, signature, "background-text", data.backgroundTextImage),
  ]);
  data.backgroundImage = backgroundImage;
  data.backgroundTextImage = backgroundTextImage;
  return data;
};

const cachedImagesExist = async (userDataPath: string, payload: EsfMapDiskPayload): Promise<boolean> => {
  const required: EsfMapCachedImageName[] = [];
  if (payload.data.backgroundImage) required.push("background");
  if (payload.data.backgroundTextImage) required.push("background-text");
  const results = await Promise.all(
    required.map(async (imageName) => {
      try {
        await fs.promises.access(imageCachePath(userDataPath, payload.signature, imageName), fs.constants.R_OK);
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
  signature: string,
  imageName: string,
): Promise<AssetBytes | undefined> => {
  if (!/^[a-zA-Z0-9_-]+$/.test(signature)) return undefined;
  if (imageName !== "background" && imageName !== "background-text") return undefined;
  try {
    return {
      buffer: await fs.promises.readFile(imageCachePath(userDataPath, signature, imageName)),
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
    cachedPayload = payload;
    return payload.data;
  } catch {
    return undefined;
  }
};

const removeOldImageDirectories = async (userDataPath: string, signature: string) => {
  const root = imageCacheRoot(userDataPath);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== signature)
      .map((entry) =>
        fs.promises.rm(nodePath.join(root, entry.name), { recursive: true, force: true }).catch(() => undefined),
      ),
  );
};

export const saveEsfMapDiskCache = async (
  userDataPath: string,
  signature: string,
  data: EsfMapPayload,
): Promise<void> => {
  try {
    await externalizeEsfMapImages(userDataPath, signature, data);
    const payload: EsfMapDiskPayload = { version: ESF_MAP_CACHE_VERSION, signature, data };
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = await zstdCompress(json, 1);
    await fs.promises.writeFile(nodePath.join(userDataPath, ESF_MAP_CACHE_FILE), compressed);
    cachedPayload = payload;
    void removeOldImageDirectories(userDataPath, signature);
  } catch (error) {
    console.error("Failed to save ESF map cache:", error);
  }
};

export const clearEsfMapMemoryCache = () => {
  cachedPayload = undefined;
};
