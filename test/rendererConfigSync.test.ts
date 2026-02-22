/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildConfigSaveSignature,
  buildReadModsSignature,
  getReadModsSelection,
} = require("../src/rendererConfigSync.ts");

const createMod = (overrides = {}) => ({
  humanName: "Test Mod",
  name: "test_mod",
  path: "/mods/test_mod.pack",
  imgPath: "",
  workshopId: "123",
  isEnabled: true,
  modDirectory: "",
  isInData: false,
  loadOrder: 0,
  author: "author",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  categories: ["category-a"],
  tags: [],
  ...overrides,
});

const createAppState = (overrides = {}) => {
  const enabledMod = createMod({ name: "enabled_mod", path: "/mods/enabled_mod.pack", workshopId: "111" });
  const disabledMod = createMod({
    name: "disabled_mod",
    path: "/mods/disabled_mod.pack",
    workshopId: "222",
    isEnabled: false,
    loadOrder: 1,
  });
  const currentPreset = {
    name: "Current",
    version: 1,
    mods: [enabledMod, disabledMod],
  };

  return {
    alwaysEnabledMods: [],
    hiddenMods: [],
    wasOnboardingEverRun: true,
    isAuthorEnabled: true,
    areThumbnailsEnabled: true,
    isMakeUnitsGeneralsEnabled: false,
    isSkipIntroMoviesEnabled: false,
    isAutoStartCustomBattleEnabled: false,
    isChangingGameProcessPriority: false,
    isFeaturesForModdersEnabled: false,
    isScriptLoggingEnabled: false,
    isClosedOnPlay: false,
    isCompatCheckingVanillaPacks: false,
    categories: ["category-a"],
    categoryColors: { "category-a": "#ffffff" },
    modRowsSortingType: "ordered",
    currentLanguage: "en",
    currentGame: "wh3",
    appFolderPaths: {
      gamePath: "/games/wh3",
      contentFolder: "/games/wh3/content",
      dataFolder: "/games/wh3/data",
    },
    packDataOverwrites: {},
    userFlowOptions: {},
    currentPreset,
    presets: [currentPreset],
    filter: "",
    toasts: [],
    allMods: [],
    customizableMods: {},
    ...overrides,
  };
};

test("buildConfigSaveSignature ignores renderer-only fields", () => {
  const baseState = createAppState();
  const changedOnlyRuntimeFields = createAppState({
    filter: "query",
    toasts: [{ type: "info", messages: ["a"], startTime: 1 }],
    allMods: [createMod({ name: "new_runtime_mod", path: "/mods/new_runtime_mod.pack" })],
  });

  assert.equal(buildConfigSaveSignature(baseState as AppState), buildConfigSaveSignature(changedOnlyRuntimeFields as AppState));
});

test("buildConfigSaveSignature changes for persisted preset mutations", () => {
  const baseState = createAppState();
  const changedPresetState = createAppState({
    currentPreset: {
      name: "Current",
      version: 1,
      mods: [
        createMod({ name: "enabled_mod", path: "/mods/enabled_mod.pack", workshopId: "111", isEnabled: false }),
        createMod({
          name: "disabled_mod",
          path: "/mods/disabled_mod.pack",
          workshopId: "222",
          isEnabled: false,
          loadOrder: 5,
        }),
      ],
    },
  });

  assert.notEqual(buildConfigSaveSignature(baseState as AppState), buildConfigSaveSignature(changedPresetState as AppState));
});

test("buildConfigSaveSignature changes when app folder paths change", () => {
  const baseState = createAppState();
  const changedPaths = createAppState({
    appFolderPaths: {
      gamePath: "/new-games/wh3",
      contentFolder: "/new-games/wh3/content",
      dataFolder: "/new-games/wh3/data",
    },
  });

  assert.notEqual(buildConfigSaveSignature(baseState as AppState), buildConfigSaveSignature(changedPaths as AppState));
});

test("getReadModsSelection returns enabled mods only", () => {
  const appState = createAppState();
  const enabledMods = getReadModsSelection(appState as AppState);

  assert.equal(enabledMods.length, 1);
  assert.equal(enabledMods[0]?.name, "enabled_mod");
});

test("buildReadModsSignature is empty when all mods are enabled", () => {
  const allEnabled = createAppState({
    currentPreset: {
      name: "Current",
      version: 1,
      mods: [
        createMod({ name: "enabled_mod_a", path: "/mods/enabled_mod_a.pack", workshopId: "111", isEnabled: true }),
        createMod({ name: "enabled_mod_b", path: "/mods/enabled_mod_b.pack", workshopId: "222", isEnabled: true }),
      ],
    },
  });

  assert.equal(buildReadModsSignature(allEnabled as AppState, "customizable-hash"), "");
});

test("buildReadModsSignature changes with enabled-selection fingerprint inputs", () => {
  const baseState = createAppState();
  const baseSignature = buildReadModsSignature(baseState as AppState, "customizable-hash-a");
  const sameSignature = buildReadModsSignature(baseState as AppState, "customizable-hash-a");
  const changedCustomizableHash = buildReadModsSignature(baseState as AppState, "customizable-hash-b");
  const changedLoadOrderState = createAppState({
    currentPreset: {
      name: "Current",
      version: 1,
      mods: [
        createMod({ name: "enabled_mod", path: "/mods/enabled_mod.pack", workshopId: "111", loadOrder: 8 }),
        createMod({
          name: "disabled_mod",
          path: "/mods/disabled_mod.pack",
          workshopId: "222",
          isEnabled: false,
          loadOrder: 1,
        }),
      ],
    },
  });
  const changedLoadOrder = buildReadModsSignature(changedLoadOrderState as AppState, "customizable-hash-a");

  assert.equal(baseSignature, sameSignature);
  assert.notEqual(baseSignature, changedCustomizableHash);
  assert.notEqual(baseSignature, changedLoadOrder);
});
