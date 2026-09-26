/**
 * The thumbnail files the asset protocol is allowed to serve.
 *
 * A mod's thumbnail is the one image the app shows that does not live inside a pack: it sits on disk
 * next to the pack, and only a path identifies it. `assetProtocol.ts` otherwise never touches the
 * filesystem on behalf of a URL, so rather than let a path in a URL name any file on the machine,
 * every thumbnail is recorded here as the mod owning it is built, and the handler serves a request
 * only when it names a path already in this set.
 *
 * Kept apart from the handler because `modFunctions.ts` registers into it and must stay importable
 * without electron - it is exercised directly by the node tests.
 */
const modThumbnailPaths = new Set<string>();

/** Called as each mod is built, so nothing can reach the renderer without its thumbnail on offer. */
export const registerModThumbnailPath = (imgPath: string) => {
  if (imgPath) modThumbnailPaths.add(imgPath);
};

export const isRegisteredModThumbnailPath = (imgPath: string) => modThumbnailPaths.has(imgPath);
