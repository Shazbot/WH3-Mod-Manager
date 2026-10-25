import * as crypto from "node:crypto";
import * as nodePath from "node:path";
import { getCanonicalFileIdentity } from "../vanillaCacheIdentity";

export const getVanillaLocCachePackSetKey = (game: string, packPaths: readonly string[]): string =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify([game, packPaths.map((packPath) => nodePath.resolve(packPath))]))
    .digest("hex");

export const getVanillaLocCacheFileName = (game: string, packSetKey: string): string =>
  `vanilla-loc-cache-${game}-${packSetKey.slice(0, 16)}.bin`;

export const getVanillaLocCacheFilePath = (directory: string, game: string, packPaths: readonly string[]): string =>
  nodePath.join(directory, getVanillaLocCacheFileName(game, getVanillaLocCachePackSetKey(game, packPaths)));

/** Stable strong identity shared by the GUI store and headless cache service. */
export const getVanillaLocCacheIdentity = (game: string, packPaths: readonly string[]): string => {
  const parts = packPaths.map((packPath) => {
    const source = getCanonicalFileIdentity(packPath);
    return source
      ? [source.path, source.size, source.mtimeNs, source.ctimeNs, source.dev, source.ino].map(String).join(":")
      : `${nodePath.resolve(packPath)}:missing`;
  });
  return crypto
    .createHash("sha1")
    .update(JSON.stringify([game, parts]))
    .digest("hex");
};
