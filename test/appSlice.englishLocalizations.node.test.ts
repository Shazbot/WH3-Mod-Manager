import { describe, expect, it } from "vitest";

import appReducer, { setFromConfig, toggleIsUsingEnglishLocalizations } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { applyConfigSavePayloadToAppData } from "../src/config/applyConfigSavePayload";
import appData from "../src/appData";

describe("english localizations option", () => {
  it("is off by default, so the player's language is used", () => {
    expect(initialState.isUsingEnglishLocalizations).toBe(false);
  });

  it("toggles", () => {
    const on = appReducer(initialState, toggleIsUsingEnglishLocalizations());
    expect(on.isUsingEnglishLocalizations).toBe(true);
    expect(appReducer(on, toggleIsUsingEnglishLocalizations()).isUsingEnglishLocalizations).toBe(false);
  });

  it("is restored from the config, and stays off when the config predates it", () => {
    const restored = appReducer(
      initialState,
      setFromConfig({ ...initialState, isUsingEnglishLocalizations: true }),
    );
    expect(restored.isUsingEnglishLocalizations).toBe(true);

    // A config written before this option existed has no field; it must not read as enabled.
    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.isUsingEnglishLocalizations;
    const fromLegacy = appReducer(initialState, setFromConfig(legacyConfig as AppState));
    expect(fromLegacy.isUsingEnglishLocalizations).toBe(false);
  });

  it("reaches the main process, which is where the loc packs are chosen", () => {
    applyConfigSavePayloadToAppData({
      config: { ...initialState, isUsingEnglishLocalizations: true } as never,
      currentGame: "wh3",
    });
    expect(appData.isUsingEnglishLocalizations).toBe(true);

    applyConfigSavePayloadToAppData({
      config: { ...initialState, isUsingEnglishLocalizations: false } as never,
      currentGame: "wh3",
    });
    expect(appData.isUsingEnglishLocalizations).toBe(false);
  });
});
