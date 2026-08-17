import { describe, expect, it } from "vitest";

import appReducer, { setFromConfig, toggleIsDualModListLayoutEnabled } from "../src/appSlice";
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
