/**
 * Decoding for the HTML entities Steam leaves in mod titles and authors.
 *
 * It lives here rather than next to the renderer's display helpers because the sorting helpers need it
 * too, and those run under node in the tests and in the main process.
 */

/** What a title realistically carries. The browser knows every entity there is; this is the short list. */
const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const maxCodePoint = 0x10ffff;

const fromCodePoint = (codePoint: number, entity: string) => {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > maxCodePoint) return entity;
  return String.fromCodePoint(codePoint);
};

/**
 * The fallback for where there is no DOM. It covers numeric entities and the handful of named ones a
 * mod title is likely to hold, and leaves anything else as it found it rather than mangling it.
 */
const decodeWithoutDom = (encoded: string) =>
  encoded.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity: string, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X"))
      return fromCodePoint(Number.parseInt(body.slice(2), 16), entity);
    if (body.startsWith("#")) return fromCodePoint(Number.parseInt(body.slice(1), 10), entity);
    return namedEntities[body.toLowerCase()] ?? entity;
  });

let domParser: DOMParser | undefined;

export const decodeHtml = (encoded: string) => {
  // Parsing is the expensive part and these run per row and per keystroke while filtering, so skip
  // the parse for the vast majority of names that hold no entity at all.
  if (!encoded.includes("&")) return encoded;

  if (typeof DOMParser === "undefined") return decodeWithoutDom(encoded);

  domParser = domParser ?? new DOMParser();
  return domParser.parseFromString(encoded, "text/html").documentElement.textContent ?? "";
};

/** Steam hands us doubly encoded text, so one decode pass isn't always enough. */
export const decodeModText = (encoded: string | undefined) => decodeHtml(decodeHtml(encoded ?? ""));
