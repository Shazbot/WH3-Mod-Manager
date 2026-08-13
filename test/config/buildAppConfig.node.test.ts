import { beforeEach, describe, expect, it } from "vitest";

import appData from "../../src/appData";
import { buildAppConfig, cacheAcceptedGameConfig } from "../../src/config/buildAppConfig";
import { emptyGameConfig } from "../../src/config/migrateAppConfig";
import { supportedGames } from "../../src/supportedGames";

const createPayload = (currentGame: SupportedGames, presetName: string): ConfigSavePayload =>
  ({
    currentGame,
    config: {
      configVersion: 3,
      currentPreset: { name: "", mods: [{ name: "alpha.pack" }], version: 2 },
      presets: [{ name: presetName, mods: [{ name: "alpha.pack" }], version: 2 }],
      modUserData: { "alpha.pack": { humanName: "Alpha" } },
      alwaysEnabledModNames: [],
      hiddenModNames: [],
      currentGame,
    },
  }) as unknown as ConfigSavePayload;

describe("buildAppConfig", () => {
  beforeEach(() => {
    appData.currentGame = "wh3";
    appData.gameToConfig = Object.fromEntries(supportedGames.map((game) => [game, emptyGameConfig()])) as Record<
      SupportedGames,
      GameConfig
    >;
  });

  it("writes the renderer's presets into the selected game's slot", () => {
    const payload = createPayload("wh3", "wh3 preset");
    const config = buildAppConfig(payload);

    expect(appData.gameToConfig.wh3.presets).toEqual([]);
    cacheAcceptedGameConfig(payload, config);

    expect(config.games.wh3.presets.map((preset) => preset.name)).toEqual(["wh3 preset"]);
    expect(config.games.wh3.modUserData["alpha.pack"]).toEqual({ humanName: "Alpha" });
    expect(appData.gameToConfig.wh3).toEqual(config.games.wh3);
  });

  it("keeps the main-process game cache current for a later switch back", () => {
    const payload = createPayload("wh3", "latest preset");
    payload.config.currentPreset.mods = [{ name: "alpha.pack", isEnabled: false, loadOrder: 4 }];
    payload.config.modUserData["alpha.pack"] = { categories: ["latest"] };

    const config = buildAppConfig(payload);
    cacheAcceptedGameConfig(payload, config);

    expect(appData.gameToConfig.wh3.currentPreset.mods).toEqual([
      { name: "alpha.pack", isEnabled: false, loadOrder: 4 },
    ]);
    expect(appData.gameToConfig.wh3.modUserData["alpha.pack"]).toEqual({
      categories: ["latest"],
    });
  });

  it("leaves other games untouched", () => {
    appData.gameToConfig.rome2 = {
      ...emptyGameConfig(),
      presets: [{ name: "rome2 preset", mods: [{ name: "rome.pack" }], version: 2 }],
    };

    const config = buildAppConfig(createPayload("wh3", "wh3 preset"));

    expect(config.games.rome2.presets.map((preset) => preset.name)).toEqual(["rome2 preset"]);
  });

  it("ignores presets from a renderer that is still on the previous game", () => {
    // the renderer can lag a game switch by a debounce or two; writing its presets into the new
    // game's slot is what used to copy whole preset lists between games
    appData.currentGame = "rome2";

    const config = buildAppConfig(createPayload("wh3", "wh3 preset"));

    expect(config.games.rome2.presets).toEqual([]);
    expect(config.games.wh3.presets).toEqual([]);
    expect(appData.gameToConfig.wh3.presets).toEqual([]);
  });

  it("produces identical JSON for an unchanged payload, so the write dedupe holds", () => {
    const first = JSON.stringify(buildAppConfig(createPayload("wh3", "wh3 preset")));
    const second = JSON.stringify(buildAppConfig(createPayload("wh3", "wh3 preset")));

    expect(first).toBe(second);
  });
});
