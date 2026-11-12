import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import RequiredMods from "../src/components/RequiredMods";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";

const mixer = {
  name: "mixer.pack",
  humanName: "MIXER - Mixu's Unlocker",
  workshopId: "mixer-id",
  path: "/workshop/mixer-id/mixer.pack",
  isEnabled: false,
} as Mod;
const campaign = {
  name: "old_world.pack",
  humanName: "The Old World Campaign",
  path: "/workshop/old_world.pack",
  isEnabled: true,
} as Mod;

function renderRequiredMods(presetMods: Mod[], allMods: Mod[]) {
  const subscribeToMods = vi.fn();
  window.api = { ...window.api, subscribeToMods } as NonNullable<Window["api"]>;
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: {
        ...initialState,
        allMods,
        currentPreset: { ...initialState.currentPreset, mods: [campaign, ...presetMods] },
      },
    },
  });
  render(
    <Provider store={store}>
      <localizationContext.Provider value={enTranslation}>
        <RequiredMods
          isOpen
          setIsOpen={() => undefined}
          modDependencies={[[campaign, [[mixer.workshopId, mixer.humanName]]]]}
        />
      </localizationContext.Provider>
    </Provider>,
  );
  return { store, subscribeToMods };
}

describe("RequiredMods", () => {
  it.each(["workshop", "data"])("enables the %s copy of an installed dependency", (source) => {
    const presetMixer =
      source === "data" ? { ...mixer, workshopId: "", path: "/data/mixer.pack", isInData: true } : mixer;
    const { store, subscribeToMods } = renderRequiredMods([presetMixer], [presetMixer, mixer]);

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    expect(store.getState().app.currentPreset.mods.find((mod) => mod.path === presetMixer.path)?.isEnabled).toBe(true);
    expect(store.getState().app.currentPreset.mods.find((mod) => mod.path === campaign.path)?.isEnabled).toBe(true);
    expect(subscribeToMods).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(store.getState().app.currentPreset.mods.find((mod) => mod.path === presetMixer.path)?.isEnabled).toBe(true);
  });

  it("subscribes when the dependency is not installed", () => {
    const { subscribeToMods } = renderRequiredMods([], []);
    fireEvent.click(screen.getByRole("button", { name: "Subscribe And Enable" }));
    expect(subscribeToMods).toHaveBeenCalledWith([mixer.workshopId]);
  });
});
