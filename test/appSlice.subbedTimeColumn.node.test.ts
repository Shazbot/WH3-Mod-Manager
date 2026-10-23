import { describe, expect, it } from "vitest";

import appReducer, { setFromConfig, toggleIsSubbedTimeEnabled } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { selectConfigSavePayload, resetConfigSavePayloadCache } from "../src/config/configSavePayload";

describe("Last Subscribed column option", () => {
  it("is off by default", () => {
    expect(initialState.isSubbedTimeEnabled).toBe(false);
  });

  it("toggles", () => {
    const on = appReducer(initialState, toggleIsSubbedTimeEnabled());
    expect(on.isSubbedTimeEnabled).toBe(true);
    expect(appReducer(on, toggleIsSubbedTimeEnabled()).isSubbedTimeEnabled).toBe(false);
  });

  it("is restored from the config, and stays off when the config predates it", () => {
    const restored = appReducer(initialState, setFromConfig({ ...initialState, isSubbedTimeEnabled: true }));
    expect(restored.isSubbedTimeEnabled).toBe(true);

    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.isSubbedTimeEnabled;
    expect(appReducer(initialState, setFromConfig(legacyConfig as AppState)).isSubbedTimeEnabled).toBe(false);
  });

  it("is written to the config, so it survives a restart", () => {
    resetConfigSavePayloadCache();
    const payload = selectConfigSavePayload({ ...initialState, isSubbedTimeEnabled: true });
    expect(payload.config.isSubbedTimeEnabled).toBe(true);
  });
});
