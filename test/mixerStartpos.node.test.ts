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

describe("readFactionKeys", () => {
  it("reads key text from StringU8 cells stored as [length, text]", async () => {
    const { readFactionKeys } = await import("../src/mixerStartpos");
    const { DBNameToDBVersions } = await import("../src/schema");
    const appData = (await import("../src/appData")).default;
    const previousGame = appData.currentGame;
    const original = DBNameToDBVersions.wh3.factions_tables;
    appData.currentGame = "wh3";
    DBNameToDBVersions.wh3.factions_tables = [
      {
        version: 7,
        fields: [
          { name: "key", field_type: "StringU8" },
          { name: "is_rebel", field_type: "Boolean" },
        ],
      },
    ] as never;
    try {
      const row = (key: string) => [
        { type: "StringU8", fields: [{ type: "Int16", val: key.length }, { type: "String", val: key }] },
        { type: "Boolean", fields: [{ type: "UInt8", val: 0 }] },
      ];
      const pack = {
        packedFiles: [
          { name: "db\\factions_tables\\!b_mixer", version: 7, schemaFields: [...row("mixer_a"), ...row("mixer_b")] },
        ],
      };
      expect([...readFactionKeys(pack as never)].sort()).toEqual(["mixer_a", "mixer_b"]);
    } finally {
      appData.currentGame = previousGame;
      if (original) DBNameToDBVersions.wh3.factions_tables = original;
      else delete DBNameToDBVersions.wh3.factions_tables;
    }
  });
});
