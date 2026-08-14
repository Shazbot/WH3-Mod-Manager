import { modThumbnailUrl } from "../../assetUrls";

const domParser = new DOMParser();

export const decodeHtml = (encoded: string) => {
  // Parsing is the expensive part and these run per row and per keystroke while filtering, so skip
  // the parse for the vast majority of names that hold no entity at all.
  if (!encoded.includes("&")) return encoded;
  const doc = domParser.parseFromString(encoded, "text/html");
  return doc.documentElement.textContent ?? "";
};

/** Steam hands us doubly encoded authors, so one decode pass isn't always enough. */
export const getDecodedModAuthor = (mod: Mod) => decodeHtml(decodeHtml(mod.author ?? ""));

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
