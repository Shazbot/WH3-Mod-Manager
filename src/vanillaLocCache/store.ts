import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";

import { publishCacheFiles } from "../vanillaCacheFiles";
import { getCanonicalFileIdentity } from "../vanillaCacheIdentity";
import { VanillaLocSourceReadCanceled } from "./exactSource";
import { buildVanillaLocCacheBytes, type VanillaLocCacheEntry } from "./build";
import { createFileSource, openVanillaLocCache, type VanillaLocCacheReader } from "./read";

/**
 * Owns the vanilla localisation cache file: deciding whether it still applies, building it when it
 * does not, and handing out a reader.
 *
 * Everything filesystem-shaped lives here so the format, builder and reader stay pure and testable,
 * matching how `vanillaDbCache` is split.
 *
 * The cache holds only the game's own locs. Mod locs stay on the live path: they are small, they
 * change whenever the mod list does, and layering them over the cache at lookup time is what keeps
 * this cache's identity dependent on the game files alone.
 */

/**
 * One file per pack set, not per game and not per identity.
 *
 * Consumers do not agree on which vanilla packs they read locs from - the skills and technology
 * filters differ from each other and from the Unit Viewer's - so keying the file on the game alone
 * would have them overwrite each other's and rebuild on every switch.
 *
 * The name is keyed on the pack paths only, and the stamp beside it holds the full identity. So a
 * game patch rewrites the same file rather than leaving the old one behind, and no pruning pass is
 * needed - which is just as well, since nothing here can tell another consumer's file from a stale
 * one by name.
 */
const cacheFileName = (game: string, packSetKey: string) => `vanilla-loc-cache-${game}-${packSetKey.slice(0, 16)}.bin`;

const getPackSetKey = (game: string, packPaths: readonly string[]) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify([game, packPaths.map((packPath) => nodePath.resolve(packPath))]))
    .digest("hex");

/** One reader per identity, so repeated builds in a session share the resident key block. */
const readerByIdentity = new Map<string, VanillaLocCacheReader>();
/** In flight builds, so several callers arriving at once do not each parse the loc packs. */
const buildsInFlight = new Map<string, Promise<VanillaLocCacheReader | undefined>>();
/** Identities whose build or open failed, so a broken cache is not retried every request. */
const abandoned = new Set<string>();

/**
 * Identity of the game's localisation packs.
 *
 * Canonical paths, size, nanosecond timestamps, device, and file id detect replacement and updates
 * without hashing packs that run to tens of megabytes. Paths also make adding or removing a language
 * pack count.
 *
 * Order is part of the identity and deliberately not sorted away: the builder folds packs last-wins,
 * so the same packs in a different order are a different cache. Sorting here would let a file built
 * when English overrode the player's language keep being served after that order was corrected.
 */
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

const cacheFilePath = (userDataPath: string, game: string, packSetKey: string) =>
  nodePath.join(userDataPath, cacheFileName(game, packSetKey));

/** Written beside the cache so a stale file is detected without opening it. */
const stampPath = (userDataPath: string, game: string, packSetKey: string) =>
  `${cacheFilePath(userDataPath, game, packSetKey)}.id`;

const openIfCurrent = (
  userDataPath: string,
  game: string,
  packSetKey: string,
  identity: string,
  sourceFormat?: string,
  decoderRevision?: string,
  orderFingerprint?: string,
): VanillaLocCacheReader | undefined => {
  let filePath: string;
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath(userDataPath, game, packSetKey), "utf8")) as {
      identity?: unknown;
      contentSha256?: unknown;
      sourceFormat?: unknown;
      decoderRevision?: unknown;
      orderFingerprint?: unknown;
    };
    if (
      stamp.identity !== identity ||
      stamp.sourceFormat !== sourceFormat ||
      stamp.decoderRevision !== decoderRevision ||
      stamp.orderFingerprint !== orderFingerprint ||
      typeof stamp.contentSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(stamp.contentSha256)
    ) {
      return undefined;
    }
    filePath = cacheFilePath(userDataPath, game, packSetKey);
    const contentSha256 = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (contentSha256 !== stamp.contentSha256) return undefined;
  } catch {
    return undefined;
  }
  try {
    return openVanillaLocCache(createFileSource(filePath));
  } catch {
    return undefined;
  }
};

export interface VanillaLocCacheRequest {
  userDataPath: string;
  game: string;
  /** The game's localisation packs, in load order. */
  packPaths: readonly string[];
  /** Reads every loc entry out of those packs. Only called when the cache has to be built. */
  readEntries: () => Promise<Iterable<VanillaLocCacheEntry>> | Iterable<VanillaLocCacheEntry>;
  /** Checked after input reads and staging, immediately before publication. */
  shouldCancel?: () => boolean;
  /** Source proof persisted in the stamp so headless consumers can reject legacy-built caches. */
  sourceFormat?: string;
  decoderRevision?: string;
  /** Fingerprint of ordered canonical pack paths and LOC filenames, including empty files. */
  orderFingerprint?: string;
}

/** A canceled build must not be memoized as broken or written as a partial cache. */
export class VanillaLocCacheBuildCanceled extends Error {
  constructor() {
    super("Vanilla localisation cache build canceled");
    this.name = "VanillaLocCacheBuildCanceled";
  }
}

/**
 * A reader for the game's locs, building the cache first if it is missing or stale.
 *
 * Undefined when the cache cannot be produced or opened, which callers treat as "use the live path".
 * A failure is remembered for the session: the alternative is paying a failed multi-second build on
 * every request forever.
 */
export const openOrBuildVanillaLocCache = async (
  request: VanillaLocCacheRequest,
): Promise<VanillaLocCacheReader | undefined> => {
  const identity = getVanillaLocCacheIdentity(request.game, request.packPaths);
  const readerKey = JSON.stringify([
    identity,
    request.sourceFormat ?? null,
    request.decoderRevision ?? null,
    request.orderFingerprint ?? null,
  ]);
  const existing = readerByIdentity.get(readerKey);
  if (existing) return existing;
  if (abandoned.has(readerKey)) return undefined;

  const inFlight = buildsInFlight.get(readerKey);
  if (inFlight) return inFlight;

  const packSetKey = getPackSetKey(request.game, request.packPaths);

  const build = (async (): Promise<VanillaLocCacheReader | undefined> => {
    const current = openIfCurrent(
      request.userDataPath,
      request.game,
      packSetKey,
      identity,
      request.sourceFormat,
      request.decoderRevision,
      request.orderFingerprint,
    );
    if (current) return current;

    try {
      if (request.shouldCancel?.()) return undefined;
      const entries = await request.readEntries();
      if (request.shouldCancel?.() || getVanillaLocCacheIdentity(request.game, request.packPaths) !== identity) {
        return undefined;
      }
      const bytes = buildVanillaLocCacheBytes(entries);
      const filePath = cacheFilePath(request.userDataPath, request.game, packSetKey);
      const stamp = stampPath(request.userDataPath, request.game, packSetKey);
      const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const serializedStamp = JSON.stringify({
        identity,
        contentSha256,
        sourceFormat: request.sourceFormat,
        decoderRevision: request.decoderRevision,
        orderFingerprint: request.orderFingerprint,
      });
      const published = await publishCacheFiles({
        cachePath: filePath,
        cacheBytes: bytes,
        stampPath: stamp,
        stampBytes: Buffer.from(serializedStamp, "utf8"),
        shouldPublish: () =>
          !request.shouldCancel?.() && getVanillaLocCacheIdentity(request.game, request.packPaths) === identity,
      });
      if (!published) return undefined;

      const reader = openVanillaLocCache(createFileSource(filePath));
      if (!reader) {
        // The builder and reader disagree about the format; building it again cannot help.
        console.log("vanilla loc cache: rejected the file it had just written");
        abandoned.add(readerKey);
      }
      return reader;
    } catch (error) {
      if (error instanceof VanillaLocCacheBuildCanceled || error instanceof VanillaLocSourceReadCanceled) return undefined;
      console.log("vanilla loc cache: could not build", error);
      abandoned.add(readerKey);
      return undefined;
    }
  })();

  buildsInFlight.set(readerKey, build);
  try {
    const reader = await build;
    if (reader) readerByIdentity.set(readerKey, reader);
    return reader;
  } finally {
    buildsInFlight.delete(readerKey);
  }
};

/** Releases every open reader. For tests and for shutdown. */
export const closeVanillaLocCaches = () => {
  for (const reader of readerByIdentity.values()) reader.close();
  readerByIdentity.clear();
  abandoned.clear();
};
