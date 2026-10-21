import { describe, expect, it } from "vitest";
import { extractBinAnimClipPaths, pickStandingClip } from "../src/visuals/twAnimBin";

const lengthPrefixed = (text: string) => {
  const bytes = [text.length & 0xff, text.length >> 8, ...Buffer.from(text, "ascii")];
  return bytes;
};

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
});
