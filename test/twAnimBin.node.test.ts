import { describe, expect, it } from "vitest";
import {
  extractBinAnimClipPaths,
  pickBinStandingClip,
  pickBinStandingEntry,
  pickStandingClip,
} from "../src/visuals/twAnimBin";

const lengthPrefixed = (text: string) => {
  const bytes = [text.length & 0xff, text.length >> 8, ...Buffer.from(text, "ascii")];
  return bytes;
};

const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];
const entry = (slot: number, clip: string, metadata = "") => [
  ...u32(slot),
  ...new Array(13).fill(0),
  ...u32(1),
  ...lengthPrefixed(clip),
  ...lengthPrefixed(metadata),
  ...lengthPrefixed(""),
];
const bin = (...entries: number[][]) =>
  new Uint8Array([
    ...u32(4),
    ...u32(3),
    ...["name", "", "", "humanoid03", ""].flatMap(lengthPrefixed),
    0,
    0,
    ...u32(entries.length),
    ...entries.flat(),
  ]);

describe("animation bin clips", () => {
  it("finds length-prefixed anim paths and ignores other strings", () => {
    const data = new Uint8Array([
      1,
      2,
      3,
      ...lengthPrefixed("animations/battle/humanoid01/rifle/stand/HU1_rifle_crew_stand_idle_01.anim"),
      ...lengthPrefixed("some_table_name"),
      9,
      ...lengthPrefixed("animations/battle/humanoid01/rifle/stand/hu1_rifle_crew_stand_idle_01.anim"),
      ...lengthPrefixed("animations/battle/humanoid01/rifle/death/hu1_rifle_death_01.anim"),
    ]);
    const clips = extractBinAnimClipPaths(data);
    expect(clips).toEqual([
      "animations\\battle\\humanoid01\\rifle\\stand\\hu1_rifle_crew_stand_idle_01.anim",
      "animations\\battle\\humanoid01\\rifle\\death\\hu1_rifle_death_01.anim",
    ]);
  });

  it("prefers crew idles, then stand idles, and skips excluded clips", () => {
    expect(
      pickStandingClip([
        "a\\death\\stand_idle_dead.anim",
        "a\\stand\\hu1_stand_idle_01.anim",
        "a\\hu1_crew_stand_idle.anim",
      ]),
    ).toBe("a\\hu1_crew_stand_idle.anim");
    expect(pickStandingClip(["a\\stand\\hu1_stand_idle_01.anim", "a\\walk.anim"])).toBe(
      "a\\stand\\hu1_stand_idle_01.anim",
    );
    expect(pickStandingClip(["a\\walk.anim"])).toBeUndefined();
  });

  it("picks the standing idle by bin slot, not by clip name", () => {
    // STAND_IDLE_2 beats STAND, even though STAND's clip name looks more like an idle.
    expect(
      pickBinStandingClip(bin(entry(1, "a/axe/stand/hu3_axe_stand_idle_01.anim"), entry(33, "a/pub/beer_02.anim"))),
    ).toBe("a\\pub\\beer_02.anim");
    expect(pickBinStandingClip(bin(entry(1, "a/stand.anim"), entry(5, "a/walk.anim")))).toBe("a\\stand.anim");
    expect(pickBinStandingClip(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("selects the war bear rider idle instead of the on-foot standing entry and retains its metadata", () => {
    const data = bin(
      entry(1, "ice_witch/on_foot_stand.anim", "on_foot.meta"),
      entry(1706, "ice_witch/mounted_stand.anim"),
      entry(1965, "ice_witch/second_idle.anim"),
      entry(1964, "ice_witch/first_idle.anim", "mounted.meta"),
    );
    expect(pickBinStandingEntry(data, "rider")).toEqual({
      clip: "ice_witch\\first_idle.anim",
      metadataPath: "mounted.meta",
    });
    expect(pickBinStandingClip(data)).toBe("ice_witch\\on_foot_stand.anim");
    expect(pickBinStandingClip(bin(entry(1, "foot.anim"), entry(1706, "mounted.anim")), "rider")).toBe("mounted.anim");
  });

  it.each([
    ["flying", 87, 88],
    ["riderFlying", 1756, 1757],
  ] as const)("selects the %s family ahead of ground slots", (profile, stand, idle) => {
    expect(
      pickBinStandingClip(
        bin(entry(32, "ground_idle.anim"), entry(stand, "stand.anim"), entry(idle, "idle.anim")),
        profile,
      ),
    ).toBe("idle.anim");
    expect(pickBinStandingClip(bin(entry(32, "ground_idle.anim"), entry(stand, "stand.anim")), profile)).toBe(
      "stand.anim",
    );
  });

  it("falls back when a table lacks the requested movement family", () => {
    expect(pickBinStandingClip(bin(entry(1, "crew_stand.anim")), "rider")).toBe("crew_stand.anim");
    expect(pickBinStandingClip(bin(entry(1, "foot.anim"), entry(1706, "rider.anim")), "riderFlying")).toBe(
      "rider.anim",
    );
  });
});
