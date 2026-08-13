import { beforeEach, describe, expect, it } from "vitest";

import appData from "../../src/appData";
import { applyConfigSavePayloadToAppData } from "../../src/config/applyConfigSavePayload";
import { resetConfigSavePayloadCache, selectConfigSavePayload } from "../../src/config/configSavePayload";
import initialState from "../../src/initialAppState";

const createMod = (name: string, isEnabled = true): Mod =>
  ({
    name,
    humanName: "",
    path: `/mods/${name}`,
    imgPath: "",
    workshopId: "",
    isEnabled,
    modDirectory: "/mods",
    isInData: false,
    author: "",
    isDeleted: false,
    isMovie: false,
    size: 1,
    isSymbolicLink: false,
    tags: [],
    reqModIdToName: [],
  }) as Mod;

const createState = (mods: Mod[]) =>
  ({
    ...initialState,
    currentPreset: { name: "", version: 2, mods },
    allMods: mods,
  }) as AppState;

describe("applyConfigSavePayloadToAppData", () => {
  beforeEach(() => {
    resetConfigSavePayloadCache();
    appData.allMods = [];
    appData.enabledMods = [];
  });

  it("takes the mod lists when the payload carries them", () => {
    const mods = [createMod("alpha.pack"), createMod("beta.pack", false)];

    applyConfigSavePayloadToAppData(selectConfigSavePayload(createState(mods)));

    expect(appData.allMods.map((mod) => mod.name)).toEqual(["alpha.pack", "beta.pack"]);
    expect(appData.enabledMods.map((mod) => mod.name)).toEqual(["alpha.pack"]);
  });

  it("counts always-enabled mods as enabled", () => {
    const mods = [createMod("alpha.pack", false)];
    const state = { ...createState(mods), alwaysEnabledModNames: ["alpha.pack"] } as AppState;

    applyConfigSavePayloadToAppData(selectConfigSavePayload(state));

    expect(appData.enabledMods.map((mod) => mod.name)).toEqual(["alpha.pack"]);
  });

  it("keeps the mod lists when a later payload omits them", () => {
    const mods = [createMod("alpha.pack")];
    const state = createState(mods);

    applyConfigSavePayloadToAppData(selectConfigSavePayload(state));
    const unchangedPayload = selectConfigSavePayload(state);
    expect(unchangedPayload.mods).toBeUndefined();

    applyConfigSavePayloadToAppData(unchangedPayload);

    expect(appData.allMods.map((mod) => mod.name)).toEqual(["alpha.pack"]);
  });

  it("does not lose a mod change that a game-change payload consumed", () => {
    // selectConfigSavePayload only attaches the mod lists when they changed since the last payload
    // it built. requestGameChange builds one too, so if it doesn't apply it the update is gone: the
    // next saveConfig sees an unchanged hash and sends nothing.
    applyConfigSavePayloadToAppData(selectConfigSavePayload(createState([createMod("alpha.pack")])));

    const afterInstall = createState([createMod("alpha.pack"), createMod("beta.pack")]);
    const gameChangePayload = selectConfigSavePayload(afterInstall);
    expect(gameChangePayload.mods).toBeDefined();
    applyConfigSavePayloadToAppData(gameChangePayload);

    const nextSavePayload = selectConfigSavePayload(afterInstall);
    expect(nextSavePayload.mods).toBeUndefined();
    applyConfigSavePayloadToAppData(nextSavePayload);

    expect(appData.allMods.map((mod) => mod.name)).toEqual(["alpha.pack", "beta.pack"]);
  });
});
