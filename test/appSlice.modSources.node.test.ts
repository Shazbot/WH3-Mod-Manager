import { describe, expect, it } from "vitest";

import appReducer, { setAppFolderPaths, setMods } from "../src/appSlice";
import initialState from "../src/initialAppState";

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

    state = appReducer(
      state,
      setAppFolderPaths({ ...folderPaths, modSourceOrder: ["data", "custom-1", "workshop"] }),
    );

    expect(state.currentPreset.mods[0].path).toBe(dataMod.path);
    expect(state.currentPreset.mods[0].isEnabled).toBe(true);
    expect(state.allMods).toHaveLength(2);
  });
});
