import { describe, expect, it } from "vitest";

import appReducer, {
  setFromConfig,
  setModListDensity,
  toggleIsDualModListLayoutEnabled,
  toggleIsModListCategoryViewEnabled,
  toggleIsShowingDisabledModsLoadOrder,
} from "../src/appSlice";
import initialState from "../src/initialAppState";
import { selectConfigSavePayload, resetConfigSavePayloadCache } from "../src/config/configSavePayload";

describe("dual mod list layout option", () => {
  it("is off by default, so the All Mods tab keeps its single list", () => {
    expect(initialState.isDualModListLayoutEnabled).toBe(false);
  });

  it("toggles", () => {
    const on = appReducer(initialState, toggleIsDualModListLayoutEnabled());
    expect(on.isDualModListLayoutEnabled).toBe(true);
    expect(appReducer(on, toggleIsDualModListLayoutEnabled()).isDualModListLayoutEnabled).toBe(false);
  });

  it("is restored from the config, and stays off when the config predates it", () => {
    const restored = appReducer(initialState, setFromConfig({ ...initialState, isDualModListLayoutEnabled: true }));
    expect(restored.isDualModListLayoutEnabled).toBe(true);

    // A config written before this option existed has no field; it must not read as enabled.
    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.isDualModListLayoutEnabled;
    const fromLegacy = appReducer(initialState, setFromConfig(legacyConfig as AppState));
    expect(fromLegacy.isDualModListLayoutEnabled).toBe(false);
  });

  it("is written to the config, so it survives a restart", () => {
    resetConfigSavePayloadCache();
    const payload = selectConfigSavePayload({ ...initialState, isDualModListLayoutEnabled: true });
    expect(payload.config.isDualModListLayoutEnabled).toBe(true);
  });
});

describe("disabled mods load order option", () => {
  it("is on by default", () => {
    expect(initialState.isShowingDisabledModsLoadOrder).toBe(true);
  });

  it("toggles", () => {
    const off = appReducer(initialState, toggleIsShowingDisabledModsLoadOrder());
    expect(off.isShowingDisabledModsLoadOrder).toBe(false);
    expect(appReducer(off, toggleIsShowingDisabledModsLoadOrder()).isShowingDisabledModsLoadOrder).toBe(true);
  });

  it("is restored from the config, and a config predating it keeps the on default", () => {
    const restored = appReducer(
      initialState,
      setFromConfig({ ...initialState, isShowingDisabledModsLoadOrder: false }),
    );
    expect(restored.isShowingDisabledModsLoadOrder).toBe(false);

    // Defaulting to on means the "?? state" idiom, not "!!" - the latter reads a missing key as off.
    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.isShowingDisabledModsLoadOrder;
    const fromLegacy = appReducer(initialState, setFromConfig(legacyConfig as AppState));
    expect(fromLegacy.isShowingDisabledModsLoadOrder).toBe(true);
  });

  it("is written to the config, so it survives a restart", () => {
    resetConfigSavePayloadCache();
    const payload = selectConfigSavePayload({ ...initialState, isShowingDisabledModsLoadOrder: false });
    expect(payload.config.isShowingDisabledModsLoadOrder).toBe(false);
  });
});

describe("mod list density option", () => {
  it("starts comfortable", () => {
    expect(initialState.modListDensity).toBe("comfortable");
  });

  it("is set to any of the three densities", () => {
    const roomy = appReducer(initialState, setModListDensity("roomy"));
    expect(roomy.modListDensity).toBe("roomy");
    expect(appReducer(roomy, setModListDensity("comfortable")).modListDensity).toBe("comfortable");
  });

  it("is restored from the config, and falls back to the default when the config predates it", () => {
    const restored = appReducer(initialState, setFromConfig({ ...initialState, modListDensity: "comfortable" }));
    expect(restored.modListDensity).toBe("comfortable");

    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.modListDensity;
    expect(appReducer(initialState, setFromConfig(legacyConfig as AppState)).modListDensity).toBe("comfortable");
  });

  it("is written to the config, so it survives a restart", () => {
    resetConfigSavePayloadCache();
    expect(selectConfigSavePayload({ ...initialState, modListDensity: "roomy" }).config.modListDensity).toBe("roomy");
  });
});

describe("mod list categories view option", () => {
  it("is off by default, so the dual layout opens on one flat list", () => {
    expect(initialState.isModListCategoryViewEnabled).toBe(false);
  });

  it("toggles", () => {
    const on = appReducer(initialState, toggleIsModListCategoryViewEnabled());
    expect(on.isModListCategoryViewEnabled).toBe(true);
    expect(appReducer(on, toggleIsModListCategoryViewEnabled()).isModListCategoryViewEnabled).toBe(false);
  });

  it("is restored from the config, and stays off when the config predates it", () => {
    const restored = appReducer(initialState, setFromConfig({ ...initialState, isModListCategoryViewEnabled: true }));
    expect(restored.isModListCategoryViewEnabled).toBe(true);

    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.isModListCategoryViewEnabled;
    expect(appReducer(initialState, setFromConfig(legacyConfig as AppState)).isModListCategoryViewEnabled).toBe(false);
  });

  it("is written to the config, so it survives a restart", () => {
    resetConfigSavePayloadCache();
    const payload = selectConfigSavePayload({ ...initialState, isModListCategoryViewEnabled: true });
    expect(payload.config.isModListCategoryViewEnabled).toBe(true);
  });
});
