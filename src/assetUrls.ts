/**
 * How an image inside the game's packs is addressed.
 *
 * Split from the protocol handler itself so the renderer can build these URLs without importing
 * anything from electron's main process.
 */
export const ASSET_SCHEME = "whmm";

/** An image out of a pack: the bytes as read, and what to serve them as. */
export interface AssetBytes {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Fixed, lowercase hosts: a standard scheme lowercases and normalises the host, so nothing that
 * carries meaning may live there. Everything variable goes in the path, URI encoded.
 */
export const ICON_HOST = "icon";
export const UNIT_ASSET_HOST = "unit-asset";

/**
 * Pack paths are compared case insensitively everywhere else, and a URL round trip is not
 * guaranteed to preserve case, so both ends normalise the same way.
 */
export const normalizeAssetPath = (assetPath: string) => assetPath.replace(/\//g, "\\").toLowerCase();

/**
 * An icon a feature has already read out of its packs.
 *
 * The generation is a cache buster, not part of the identity: the handler resolves by path alone, so
 * a view holding a URL from an earlier generation gets the current bytes. Without it, enabling a mod
 * that replaces an icon would leave Chromium serving what it cached under the same URL.
 */
export const iconAssetUrl = (generation: number, iconPath: string) =>
  `${ASSET_SCHEME}://${ICON_HOST}/${generation}/${encodeURIComponent(normalizeAssetPath(iconPath))}`;

/**
 * A unit viewer image, resolved out of the packs its session was opened with.
 *
 * The session id doubles as the cache buster: a new catalog is a new session, and the images it
 * serves are the ones that mod list resolves to.
 */
export const unitAssetUrl = (sessionId: string, assetPath: string) =>
  `${ASSET_SCHEME}://${UNIT_ASSET_HOST}/${encodeURIComponent(sessionId)}/${encodeURIComponent(
    normalizeAssetPath(assetPath),
  )}`;
