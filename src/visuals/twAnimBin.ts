import type { AnimationSelectionProfile } from "./animationSelection";

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

/** WH3 animation slot ids from the current battle bins, including the separate rider families. */
const STANDING_SLOTS: Record<AnimationSelectionProfile, { stand: number; idleFirst: number; idleLast: number }> = {
  ground: { stand: 1, idleFirst: 32, idleLast: 41 },
  flying: { stand: 87, idleFirst: 88, idleLast: 92 },
  rider: { stand: 1706, idleFirst: 1964, idleLast: 1973 },
  riderFlying: { stand: 1756, idleFirst: 1757, idleLast: 1761 },
};

type BinEntry = { slot: number; clips: { path: string; metadataPath: string }[] };

/** Parses a WH3 (v4) or 3K-style (v2) animation bin into its slot entries; undefined when the layout is unexpected. */
const parseBinEntries = (data: Uint8Array): BinEntry[] | undefined => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const need = (bytes: number) => {
    if (offset + bytes > data.length) throw new Error("Truncated animation bin");
  };
  const u32 = () => (need(4), (offset += 4), view.getUint32(offset - 4, true));
  const skip = (bytes: number) => (need(bytes), (offset += bytes));
  const str = () => {
    need(2);
    const length = view.getUint16(offset, true);
    offset += 2;
    need(length);
    let text = "";
    for (let index = 0; index < length; index++) text += String.fromCharCode(data[offset + index]);
    offset += length;
    return text;
  };
  try {
    const version = u32();
    if (version === 4) {
      skip(4); // sub-version
      for (let index = 0; index < 5; index++) str(); // name, mount bin, rider bin, skeleton, locomotion graph
    } else if (version === 2) {
      for (let index = 0; index < 4; index++) str(); // name, mount bin, rider bin, skeleton
    } else return undefined;
    skip(2); // flags
    const entryCount = u32();
    const entries: BinEntry[] = [];
    for (let entry = 0; entry < entryCount; entry++) {
      const slot = u32();
      skip(4 + 4 + 4 + 1); // blend in, selection weight, weapon bools, unknown bool
      const variantCount = u32();
      const clips: BinEntry["clips"] = [];
      for (let variant = 0; variant < variantCount; variant++) {
        const path = str();
        const metadataPath = str();
        str(); // sound meta
        clips.push({ path, metadataPath });
      }
      entries.push({ slot, clips });
    }
    return entries;
  } catch {
    return undefined;
  }
};

/**
 * The game's own standing idle for a bin, chosen by slot like the asset host's default resolver:
 * The profile's first idle slot, else its standing slot. Clip names are never inspected.
 */
export const pickBinStandingEntry = (
  data: Uint8Array,
  profile: AnimationSelectionProfile = "ground",
): { clip: string; metadataPath?: string } | undefined => {
  const entries = parseBinEntries(data);
  if (!entries) return undefined;
  const firstClip = (slots: (slot: number) => boolean) =>
    entries
      .filter((entry) => slots(entry.slot) && entry.clips.some((clip) => clip.path.trim()))
      .sort((first, second) => first.slot - second.slot)[0]
      ?.clips.find((clip) => clip.path.trim());
  const pickProfile = (family: AnimationSelectionProfile) => {
    const { stand, idleFirst, idleLast } = STANDING_SLOTS[family];
    return firstClip((slot) => slot >= idleFirst && slot <= idleLast) ?? firstClip((slot) => slot === stand);
  };
  const picked =
    pickProfile(profile) ?? (profile === "riderFlying" ? pickProfile("rider") : undefined) ?? pickProfile("ground");
  if (!picked) return undefined;
  return {
    clip: picked.path.replace(/\//g, "\\").toLowerCase(),
    // The entry's metadata carries weapon docking (e.g. rifle in hand), so it travels with the clip.
    metadataPath: picked.metadataPath.trim() || undefined,
  };
};

export const pickBinStandingClip = (data: Uint8Array, profile: AnimationSelectionProfile = "ground") =>
  pickBinStandingEntry(data, profile)?.clip;
