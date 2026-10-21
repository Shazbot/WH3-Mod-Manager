/**
 * Extracts the `.anim` clip paths an animation bin (`animations\database\battle\bin\<table>.bin`)
 * references. Bin strings are uint16 length-prefixed ASCII, so a scan for such strings ending in
 * `.anim` is enough to learn which clips a table can play.
 */
export const extractBinAnimClipPaths = (data: Uint8Array): string[] => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const clips = new Set<string>();
  for (let offset = 0; offset + 2 < data.length; offset++) {
    const length = view.getUint16(offset, true);
    if (length < 6 || length > 400 || offset + 2 + length > data.length) continue;
    let text = "";
    let printable = true;
    for (let index = 0; index < length; index++) {
      const code = data[offset + 2 + index];
      if (code < 0x20 || code > 0x7e) {
        printable = false;
        break;
      }
      text += String.fromCharCode(code);
    }
    if (!printable || !/\.anim$/i.test(text)) continue;
    clips.add(text.replace(/\//g, "\\").toLowerCase());
    offset += 1 + length;
  }
  return [...clips];
};

const EXCLUDED_CLIP = /camera|(^|[\\/_])cam[\\/_]|death|matched|dock|fall/i;
const PREFERRED_CLIP_PATTERNS = [/crew_stand_idle/i, /stand_idle/i, /[\\/_]stand[\\/_]/i];

/** Picks the standing idle of a table's clips, or undefined when none qualifies. */
export const pickStandingClip = (clips: readonly string[]): string | undefined => {
  const candidates = clips.filter((clip) => !EXCLUDED_CLIP.test(clip));
  for (const pattern of PREFERRED_CLIP_PATTERNS) {
    const match = candidates.find((clip) => pattern.test(clip));
    if (match) return match;
  }
  return undefined;
};
