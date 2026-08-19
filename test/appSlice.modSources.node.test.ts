import { describe, expect, it } from "vitest";

import appReducer, { setAppFolderPaths, setModLoadOrderRelativeTo, setMods } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { sortByNameAndLoadOrder } from "../src/modSortingHelpers";

const createMod = (path: string, sourceId: string, sourceKind: ModSourceKind, isInData: boolean): Mod => ({
  humanName: "Example",
  name: "example.pack",
  path,
  imgPath: "",
  workshopId: "123",
  isEnabled: false,
  modDirectory: path.replace(/[/\\][^/\\]+$/, ""),
  isInData,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: ["mod"],
  sourceId,
  sourceKind,
});

describe("app mod source reconciliation", () => {
  it("switches duplicate winners without losing enabled state", () => {
    const folderPaths = {
      gamePath: "/game",
      dataFolder: "/game/data",
      contentFolder: "/workshop",
      customModFolders: [{ id: "custom-1", path: "/custom" }],
      modSourceOrder: ["custom-1", "data", "workshop"],
    };
    const dataMod = createMod("/game/data/example.pack", "data", "data", true);
    const customMod = createMod("/custom/example.pack", "custom-1", "custom", false);
    customMod.isEnabled = true;
    let state = appReducer({ ...initialState, appFolderPaths: folderPaths }, setMods([dataMod, customMod]));
    expect(state.currentPreset.mods[0].path).toBe(customMod.path);

    state = appReducer(state, setAppFolderPaths({ ...folderPaths, modSourceOrder: ["data", "custom-1", "workshop"] }));

    expect(state.currentPreset.mods[0].path).toBe(dataMod.path);
    expect(state.currentPreset.mods[0].isEnabled).toBe(true);
    expect(state.allMods).toHaveLength(2);
  });

  it("keeps a Workshop subscription time on the visible Data copy", () => {
    const folderPaths = {
      gamePath: "/game",
      dataFolder: "/game/data",
      contentFolder: "/workshop",
      customModFolders: [],
      modSourceOrder: ["data", "workshop"],
    };
    const dataMod = createMod("/game/data/example.pack", "data", "data", true);
    const workshopMod = createMod("/workshop/123/example.pack", "workshop", "workshop", false);
    workshopMod.subbedTime = 1_700_000_000_000;

    const state = appReducer({ ...initialState, appFolderPaths: folderPaths }, setMods([dataMod, workshopMod]));

    expect(state.currentPreset.mods[0].path).toBe(dataMod.path);
    expect(state.currentPreset.mods[0].subbedTime).toBe(workshopMod.subbedTime);
  });

  it("does not restore stale startup load order when folder settings are reconciled", () => {
    const folderPaths = {
      gamePath: "/game",
      dataFolder: "/game/data",
      contentFolder: "/workshop",
      customModFolders: [],
      modSourceOrder: ["data", "workshop"],
    };
    const alpha = createMod("/game/data/alpha.pack", "data", "data", true);
    alpha.name = "alpha.pack";
    alpha.isEnabled = true;
    const beta = createMod("/game/data/beta.pack", "data", "data", true);
    beta.name = "beta.pack";
    beta.isEnabled = true;

    let state = appReducer({ ...initialState, appFolderPaths: folderPaths }, setMods([alpha, beta]));
    state = appReducer(
      state,
      setModLoadOrderRelativeTo({
        modNameToChange: beta.name,
        modNameRelativeTo: alpha.name,
        visualModList: [...state.currentPreset.mods],
        setAfterMod: false,
      }),
    );
    state = appReducer(state, setAppFolderPaths({ ...folderPaths }));

    expect(sortByNameAndLoadOrder(state.currentPreset.mods).map((mod) => mod.name)).toEqual([
      "beta.pack",
      "alpha.pack",
    ]);
    expect(state.currentPreset.mods.find((mod) => mod.name === "beta.pack")?.loadOrder).toBe(0);
    expect(state.currentPreset.mods.find((mod) => mod.name === "alpha.pack")?.loadOrder).toBeUndefined();
  });
});
