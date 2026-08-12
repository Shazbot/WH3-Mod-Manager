import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";

import { buildVanillaLocCacheBytes } from "./build";
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

const cacheFileName = (game: string) => `vanilla-loc-cache-${game}.bin`;

/** One reader per identity, so repeated builds in a session share the resident key block. */
const readerByIdentity = new Map<string, VanillaLocCacheReader>();
/** In flight builds, so several callers arriving at once do not each parse the loc packs. */
const buildsInFlight = new Map<string, Promise<VanillaLocCacheReader | undefined>>();
/** Identities whose build or open failed, so a broken cache is not retried every request. */
const abandoned = new Set<string>();

/**
 * Identity of the game's localisation packs.
 *
 * Size and mtime of each pack is what a game patch moves, and it is far cheaper than hashing packs
 * that run to tens of megabytes. Paths are included so adding or removing a language pack counts.
 */
export const getVanillaLocCacheIdentity = (game: string, packPaths: readonly string[]): string => {
  const parts = packPaths
    .map((packPath) => {
      try {
        const stat = fs.statSync(packPath);
        return `${nodePath.resolve(packPath)}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return `${nodePath.resolve(packPath)}:missing`;
      }
    })
    .sort();
  return crypto.createHash("sha1").update(JSON.stringify([game, parts])).digest("hex");
};

const identityFilePath = (userDataPath: string, game: string) =>
  nodePath.join(userDataPath, cacheFileName(game));

/** Written beside the cache so a stale file is detected without opening it. */
const identityStampPath = (userDataPath: string, game: string) =>
  `${identityFilePath(userDataPath, game)}.id`;

const openIfCurrent = (
  userDataPath: string,
  game: string,
  identity: string,
): VanillaLocCacheReader | undefined => {
  try {
    if (fs.readFileSync(identityStampPath(userDataPath, game), "utf8") !== identity) return undefined;
  } catch {
    return undefined;
  }
  try {
    return openVanillaLocCache(createFileSource(identityFilePath(userDataPath, game)));
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
  readEntries: () => Promise<Iterable<readonly [string, string]>> | Iterable<readonly [string, string]>;
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
  const existing = readerByIdentity.get(identity);
  if (existing) return existing;
  if (abandoned.has(identity)) return undefined;

  const inFlight = buildsInFlight.get(identity);
  if (inFlight) return inFlight;

  const build = (async (): Promise<VanillaLocCacheReader | undefined> => {
    const current = openIfCurrent(request.userDataPath, request.game, identity);
    if (current) return current;

    try {
      const bytes = buildVanillaLocCacheBytes(await request.readEntries());
      const filePath = identityFilePath(request.userDataPath, request.game);
      // The stamp is removed first and written last, so a crash mid-write leaves a file that no
      // longer claims to match anything rather than one that lies about its contents.
      try {
        fs.rmSync(identityStampPath(request.userDataPath, request.game), { force: true });
      } catch {
        // Nothing to remove.
      }
      fs.writeFileSync(filePath, bytes);
      fs.writeFileSync(identityStampPath(request.userDataPath, request.game), identity, "utf8");

      const reader = openVanillaLocCache(createFileSource(filePath));
      if (!reader) {
        // The builder and reader disagree about the format; building it again cannot help.
        console.log("vanilla loc cache: rejected the file it had just written");
        abandoned.add(identity);
      }
      return reader;
    } catch (error) {
      console.log("vanilla loc cache: could not build", error);
      abandoned.add(identity);
      return undefined;
    }
  })();

  buildsInFlight.set(identity, build);
  try {
    const reader = await build;
    if (reader) readerByIdentity.set(identity, reader);
    return reader;
  } finally {
    buildsInFlight.delete(identity);
  }
};

/** Releases every open reader. For tests and for shutdown. */
export const closeVanillaLocCaches = () => {
  for (const reader of readerByIdentity.values()) reader.close();
  readerByIdentity.clear();
  abandoned.clear();
};
