import { describe, expect, it } from "vitest";
import { buildRemovalSet } from "../src/mixerStartpos";
import { hasEnabledMixer } from "../src/mixerStartpos/mixerPack";

describe("buildRemovalSet", () => {
  it("keeps keys used by another mod or vanilla and returns the rest sorted", () => {
    expect(buildRemovalSet(["b", "a", "c", "d", "a"], ["c"], ["d"])).toEqual(["a", "b"]);
  });
  it("is empty when everything is used", () => {
    expect(buildRemovalSet(["a"], ["a"], [])).toEqual([]);
  });
});

describe("hasEnabledMixer", () => {
  it("matches the Mixer pack name case-insensitively", () => {
    expect(hasEnabledMixer([{ name: "x.pack" }, { name: "!B_Mixer.pack" }])).toBe(true);
    expect(hasEnabledMixer([{ name: "x.pack" }])).toBe(false);
  });
});
