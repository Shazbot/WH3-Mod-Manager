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
const getDefaultModThumbnailSrc = () => {
  if (!defaultModThumbnailSrc) defaultModThumbnailSrc = require("../../assets/modThumbnail.png");
  return defaultModThumbnailSrc;
};

/** In dev the packed asset paths aren't reachable, so everything falls back to the placeholder. */
export const getModThumbnailSrc = (mod: Mod, isDev: boolean) =>
  isDev || !mod.imgPath ? getDefaultModThumbnailSrc() : mod.imgPath;
