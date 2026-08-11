import { beforeEach, describe, expect, it } from "vitest";

import {
  resetConfigSavePayloadCache,
  selectConfigSavePayload,
} from "../../src/config/configSavePayload";
import initialState from "../../src/initialAppState";

const createMod = (name: string, overrides: Partial<Mod> = {}): Mod => ({
  name,
  humanName: "",
  path: `/mods/${name}`,
  imgPath: "",
  workshopId: "",
  isEnabled: true,
  modDirectory: "/mods",
  isInData: false,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
  ...overrides,
});

describe("selectConfigSavePayload", () => {
  beforeEach(resetConfigSavePayloadCache);

  it("retains cached metadata for unavailable preset mods and fills blank live metadata", () => {
    const liveMod = createMod("live.pack", { categories: [] });
    const appState = {
      ...initialState,
      currentPreset: { name: "", version: 2, mods: [liveMod] },
      allMods: [liveMod],
      presets: [
        { name: "Saved", version: 2, mods: [{ name: "missing.pack" }] },
      ],
      dataFromConfig: {
        modUserData: {
          "live.pack": {
            categories: ["old category"],
            humanName: "Cached Live Title",
            author: "Cached Author",
            reqModIdToName: [["42", "Dependency"]],
          },
          "missing.pack": {
            humanName: "Missing Mod Title",
            author: "Missing Author",
            reqModIdToName: [["99", "Missing Dependency"]],
          },
          "unreferenced.pack": { humanName: "Drop Me" },
        },
      },
    } as AppState;

    const payload = selectConfigSavePayload(appState);

    expect(payload.config.modUserData["live.pack"]).toEqual({
      humanName: "Cached Live Title",
      author: "Cached Author",
      reqModIdToName: [["42", "Dependency"]],
    });
    expect(payload.config.modUserData["missing.pack"]).toEqual({
      humanName: "Missing Mod Title",
      author: "Missing Author",
      reqModIdToName: [["99", "Missing Dependency"]],
    });
    expect(payload.config.modUserData["unreferenced.pack"]).toBeUndefined();
  });

  it("keeps the latest metadata after a referenced mod disappears during the session", () => {
    const liveMod = createMod("live.pack", { humanName: "Fresh Title", author: "Fresh Author" });
    const populatedState = {
      ...initialState,
      currentPreset: { name: "", version: 2, mods: [liveMod] },
      allMods: [liveMod],
      presets: [{ name: "Saved", version: 2, mods: [{ name: "live.pack" }] }],
    } as AppState;
    selectConfigSavePayload(populatedState);

    const missingState = {
      ...populatedState,
      currentPreset: { name: "", version: 2, mods: [] },
      allMods: [],
    } as AppState;
    const payload = selectConfigSavePayload(missingState);

    expect(payload.config.modUserData["live.pack"]).toEqual({
      humanName: "Fresh Title",
      author: "Fresh Author",
    });
  });
});
