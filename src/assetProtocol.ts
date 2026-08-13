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
import { ASSET_SCHEME, ICON_HOST, UNIT_ASSET_HOST, normalizeAssetPath, type AssetBytes } from "./assetUrls";

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

const respondWith = (asset: AssetBytes) => {
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
      // The URL identifies the bytes: icon URLs carry a generation and unit asset URLs a session id,
      // both of which change when the underlying packs do.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

/**
 * Nothing here reaches the filesystem: a request resolves to bytes already in memory, or to a file
 * inside a pack this session has registered, or to nothing. A path in the URL cannot escape into
 * anything the app was not already serving.
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
      return notFound();
    } catch (error) {
      console.error("Failed to serve asset:", request.url, error);
      return new Response(undefined, { status: 500 });
    }
  });
};
