import { describe, expect, it } from "vitest";

import { CONFIG_VERSION, migrateAppConfig } from "../../src/config/migrateAppConfig";

const createLegacyMod = (name: string, isEnabled: boolean, extra: Partial<Mod> = {}) =>
  ({
    name,
    humanName: `Human ${name}`,
    path: `/mods/${name}`,
    imgPath: `/mods/${name}.png`,
    workshopId: `id-${name}`,
    isEnabled,
    modDirectory: "/mods",
    isInData: false,
    loadOrder: undefined,
    author: "Author",
    isDeleted: false,
    isMovie: false,
    size: 4096,
    isSymbolicLink: false,
    tags: ["tag"],
    ...extra,
  }) as Mod;

const createLegacyConfig = () => ({
  currentGame: "wh3",
  isFeaturesForModdersEnabled: true,
  gameToCurrentPreset: {
    wh3: {
      name: "",
      version: 2,
      mods: [
        createLegacyMod("alpha.pack", true, { loadOrder: 0, categories: ["ui"] }),
        createLegacyMod("beta.pack", false),
        createLegacyMod("gamma.pack", true, { loadOrder: 1 }),
      ],
    },
  },
  gameToPresets: {
    wh3: [
      {
        name: "My Preset",
        version: 2,
        mods: [createLegacyMod("alpha.pack", true, { loadOrder: 0 }), createLegacyMod("beta.pack", false)],
      },
      {
        name: "On App Start",
        version: 2,
        mods: [createLegacyMod("alpha.pack", true), createLegacyMod("beta.pack", false)],
      },
    ],
  },
  alwaysEnabledMods: [createLegacyMod("alpha.pack", true), createLegacyMod("alpha.pack", true)],
  hiddenMods: [createLegacyMod("beta.pack", false)],
});

describe("migrateAppConfig", () => {
  it("turns full Mod records into name/enabled/loadOrder entries", () => {
    const config = migrateAppConfig(createLegacyConfig());

    expect(config.configVersion).toBe(CONFIG_VERSION);
    // a saved user preset keeps only the mods it enables
    expect(config.games.wh3.presets[0]).toEqual({
      name: "My Preset",
      version: 2,
      mods: [{ name: "alpha.pack", loadOrder: 0 }],
    });
    // the current preset is a snapshot, so disabled mods and their position survive
    expect(config.games.wh3.currentPreset.mods).toEqual([
      { name: "alpha.pack", loadOrder: 0 },
      { name: "beta.pack", isEnabled: false },
      { name: "gamma.pack", loadOrder: 1 },
    ]);
  });

  it("keeps disabled mods in the auto-generated snapshot presets", () => {
    const config = migrateAppConfig(createLegacyConfig());

    const onAppStart = config.games.wh3.presets.find((preset) => preset.name === "On App Start");
    expect(onAppStart?.mods).toEqual([{ name: "alpha.pack" }, { name: "beta.pack", isEnabled: false }]);
  });

  it("lifts per-mod data out of the presets into one map per game", () => {
    const config = migrateAppConfig(createLegacyConfig());

    expect(config.games.wh3.modUserData["alpha.pack"]).toEqual({
      categories: ["ui"],
      humanName: "Human alpha.pack",
      author: "Author",
    });
    // things a disk scan recomputes are not stored at all
    expect(JSON.stringify(config)).not.toContain("/mods/alpha.pack.png");
  });

  it("reduces always-enabled and hidden mods to deduped name lists", () => {
    const config = migrateAppConfig(createLegacyConfig());

    expect(config.alwaysEnabledModNames).toEqual(["alpha.pack"]);
    expect(config.hiddenModNames).toEqual(["beta.pack"]);
  });

  it("recovers the real order of a preset saved before array order meant anything", () => {
    const config = migrateAppConfig({
      currentGame: "wh3",
      gameToPresets: {
        wh3: [
          {
            name: "Legacy",
            // no version: array order is meaningless, the load order pins are authoritative
            mods: [
              createLegacyMod("gamma.pack", true, { loadOrder: 2 }),
              createLegacyMod("alpha.pack", true, { loadOrder: 0 }),
              createLegacyMod("beta.pack", true, { loadOrder: 1 }),
            ],
          },
        ],
      },
    });

    const preset = config.games.wh3.presets[0];
    expect(preset.version).toBe(2);
    expect(preset.mods.map((entry) => entry.name)).toEqual(["alpha.pack", "beta.pack", "gamma.pack"]);
  });

  it("folds the pre-multi-game wh3-only fields into the per-game containers", () => {
    const config = migrateAppConfig({
      currentGame: "wh3",
      currentPreset: { name: "", version: 2, mods: [createLegacyMod("alpha.pack", true)] },
      presets: [{ name: "Old", version: 2, mods: [createLegacyMod("alpha.pack", true)] }],
      appFolderPaths: { gamePath: "C:/wh3", contentFolder: "C:/content", dataFolder: "C:/wh3/data" },
    });

    expect(config.games.wh3.currentPreset.mods).toEqual([{ name: "alpha.pack" }]);
    expect(config.games.wh3.presets.map((preset) => preset.name)).toEqual(["Old"]);
    expect(config.gameFolderPaths.wh3.gamePath).toBe("C:/wh3");
    expect(config.gameFolderPaths.wh3.contentFolder).toBe("C:/content");
  });

  it("fills in every supported game and the option defaults", () => {
    const config = migrateAppConfig({});

    expect(config.currentGame).toBe("wh3");
    expect(config.games.rome2).toEqual({
      currentPreset: { name: "", mods: [], version: 2 },
      presets: [],
      modUserData: {},
    });
    expect(config.gameFolderPaths.rome2.modSourceOrder).toEqual(["data", "workshop"]);
    expect(config.alwaysEnabledModNames).toEqual([]);
  });

  it("is idempotent and leaves an already-migrated config alone", () => {
    const once = migrateAppConfig(createLegacyConfig());
    const twice = migrateAppConfig(once);

    expect(twice).toEqual(once);
  });

  it("rejects a config that isn't an object", () => {
    expect(() => migrateAppConfig(null)).toThrow();
    expect(() => migrateAppConfig("nonsense")).toThrow();
  });
});
