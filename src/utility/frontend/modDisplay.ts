import { modThumbnailUrl } from "../../assetUrls";
import { decodeModText } from "../htmlEntities";

export { decodeHtml } from "../htmlEntities";

/** Steam hands us doubly encoded authors, so one decode pass isn't always enough. */
export const getDecodedModAuthor = (mod: Mod) => decodeModText(mod.author);

// Required lazily so this module still loads where the webpack asset loader isn't set up (tests).
let defaultModThumbnailSrc: string | undefined;
const getDefaultModThumbnailSrc = (): string => {
  if (!defaultModThumbnailSrc) defaultModThumbnailSrc = require("../../assets/modThumbnail.png");
  return defaultModThumbnailSrc ?? "";
};

/**
 * How a thumbnail is addressed depends on what the renderer was loaded from.
 *
 * Packaged, the page comes off `file://`, so an `<img>` can point straight at the path on disk and
 * Chromium reads it on its own IO thread. In dev the page is served over http, where that same path
 * is neither a valid URL nor a subresource the page is allowed to fetch, so it goes through the
 * asset protocol instead. That costs a round trip through the main process per image, which is why
 * the packaged build does not use it.
 */
export const getModThumbnailSrc = (mod: Mod, isDev: boolean) => {
  if (!mod.imgPath) return getDefaultModThumbnailSrc();
  return isDev ? modThumbnailUrl(mod.imgPath) : mod.imgPath;
};
