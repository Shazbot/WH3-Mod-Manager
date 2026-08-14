/**
 * Serves images out of the game's packs over a URL instead of handing the renderer the bytes.
 *
 * Every icon and unit card used to travel to the renderer base64 encoded and get rendered as a
 * `data:` URL. That costs three times over: the encoded string is a third larger than the file, it
 * is copied through IPC and held in renderer state for as long as the view lives, and a `data:` URL
 * is its own cache key, so the same icon drawn on forty nodes is forty strings and forty decodes.
 *
 * With a URL the renderer holds forty copies of a sixty character string, Chromium fetches each
 * distinct image once, and its image cache owns the decoded bitmaps and can evict them under
 * pressure - which JS strings in a Redux store can never be.
 */
import { protocol } from "electron";
import * as fs from "fs";
import * as nodePath from "path";
import {
  ASSET_SCHEME,
  ICON_HOST,
  MOD_THUMBNAIL_HOST,
  UNIT_ASSET_HOST,
  normalizeAssetPath,
  type AssetBytes,
} from "./assetUrls";
import { isRegisteredModThumbnailPath } from "./modThumbnailAssets";

export { ASSET_SCHEME, iconAssetUrl, unitAssetUrl, type AssetBytes } from "./assetUrls";

/**
 * Icons a feature has already read out of its packs, keyed by their path inside the pack.
 *
 * Shared by the skills, technology and unit viewers: pack file paths are unique across the game, and
 * a mod overriding an icon overrides it for all of them, so last write wins is the same answer they
 * each arrived at separately before.
 */
const iconAssets = new Map<string, AssetBytes>();

/** Bumped whenever icons are registered, and embedded in the URLs built afterwards. */
let iconGeneration = 0;

export const registerIconAssets = (icons: Record<string, AssetBytes>) => {
  for (const [iconPath, asset] of Object.entries(icons)) iconAssets.set(normalizeAssetPath(iconPath), asset);
  iconGeneration += 1;
  return iconGeneration;
};

/** For tests and for a game switch, where every icon registered belongs to the previous game. */
export const clearIconAssets = () => {
  iconAssets.clear();
  iconGeneration += 1;
};

/**
 * Must run before the app is ready, which is why it is not folded into the handler below.
 *
 * `standard` is what lets a relative-free absolute URL parse at all; `secure` keeps the page it is
 * used from being treated as mixed content; `supportFetchAPI` is there so a view can probe an asset
 * without an `<img>` if it ever needs to.
 */
export const registerAssetSchemeAsPrivileged = () => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
};

export interface AssetProtocolResolvers {
  /** The unit viewer's session-scoped assets, which are resolved out of that session's packs. */
  resolveUnitViewerAsset: (sessionId: string, assetPath: string) => Promise<AssetBytes | undefined>;
}

const notFound = () => new Response(undefined, { status: 404 });

/** The URL identifies the bytes, so what it addresses can never change under it. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * A thumbnail URL is just a path, and the file behind a path can be replaced when a mod updates, so
 * this one cannot be cached forever. A minute keeps scrolling a list on Chromium's decoded copy
 * instead of re-reading the file, while a swapped image still appears without a restart.
 */
const MOD_THUMBNAIL_CACHE_CONTROL = "public, max-age=60";

const MOD_THUMBNAIL_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const respondWith = (asset: AssetBytes, cacheControl = IMMUTABLE_CACHE_CONTROL) => {
  // A view over the buffer rather than a copy of it: the bytes are already in memory, and copying
  // them per request would undo the point of not encoding them in the first place. A buffer read out
  // of a pack can be a view into a pooled allocation, so the offset and length have to come along;
  // the assertion rules out the SharedArrayBuffer case, which a pack read cannot produce and which
  // `Response` will not take.
  const body = new Uint8Array(asset.buffer.buffer as ArrayBuffer, asset.buffer.byteOffset, asset.buffer.byteLength);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": asset.mimeType,
      // Icon URLs carry a generation and unit asset URLs a session id, both of which change when the
      // underlying packs do; a thumbnail has no such buster and passes a shorter lifetime instead.
      "cache-control": cacheControl,
    },
  });
};

/**
 * The one asset read off the filesystem rather than out of a pack, and so the one that has to prove
 * it is allowed: only a path some mod was built with is served, and only if it names an image.
 */
const serveModThumbnail = async (imgPath: string) => {
  if (!imgPath || !isRegisteredModThumbnailPath(imgPath)) return notFound();
  const mimeType = MOD_THUMBNAIL_MIME_TYPES[nodePath.extname(imgPath).toLowerCase()];
  if (!mimeType) return notFound();
  try {
    return respondWith({ buffer: await fs.promises.readFile(imgPath), mimeType }, MOD_THUMBNAIL_CACHE_CONTROL);
  } catch {
    // Registered when the mod was built, gone by the time it was asked for.
    return notFound();
  }
};

/**
 * A request resolves to bytes already in memory, to a file inside a pack this session has
 * registered, to a thumbnail some mod was built with, or to nothing. Only that last case touches the
 * filesystem, and it is checked against `modThumbnailAssets.ts` first, so a path in the URL cannot
 * escape into anything the app was not already serving.
 */
export const registerAssetProtocol = (resolvers: AssetProtocolResolvers) => {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // Leading empty segment from the leading slash; a standard scheme always has one.
      const [, ...segments] = url.pathname.split("/").map((segment) => decodeURIComponent(segment));
      if (url.host === ICON_HOST) {
        // segments: [generation, iconPath]
        const asset = iconAssets.get(normalizeAssetPath(segments[1] || ""));
        return asset ? respondWith(asset) : notFound();
      }
      if (url.host === UNIT_ASSET_HOST) {
        // segments: [sessionId, assetPath]
        const [sessionId, assetPath] = segments;
        if (!sessionId || !assetPath) return notFound();
        const asset = await resolvers.resolveUnitViewerAsset(sessionId, assetPath);
        return asset ? respondWith(asset) : notFound();
      }
      if (url.host === MOD_THUMBNAIL_HOST) {
        // segments: [imgPath]
        return await serveModThumbnail(segments[0] || "");
      }
      return notFound();
    } catch (error) {
      console.error("Failed to serve asset:", request.url, error);
      return new Response(undefined, { status: 500 });
    }
  });
};
