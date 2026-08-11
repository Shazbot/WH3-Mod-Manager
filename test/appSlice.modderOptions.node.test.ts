import { describe, expect, it } from "vitest";

import appReducer, {
  setIsFeaturesForModdersEnabled,
  toggleIsCompatCheckingVanillaPacks,
  toggleIsFeaturesForModdersEnabled,
} from "../src/appSlice";
import initialState from "../src/initialAppState";

const stateWithModderCompatEnabled = () => ({
  ...initialState,
  isFeaturesForModdersEnabled: true,
  isCompatCheckingVanillaPacks: true,
});

describe("modder-only compatibility options", () => {
  it("disables vanilla compatibility checks when modder features are toggled off", () => {
    const state = appReducer(stateWithModderCompatEnabled(), toggleIsFeaturesForModdersEnabled());

    expect(state.isFeaturesForModdersEnabled).toBe(false);
    expect(state.isCompatCheckingVanillaPacks).toBe(false);
  });

  it("disables vanilla compatibility checks when modder features are set off", () => {
    const state = appReducer(stateWithModderCompatEnabled(), setIsFeaturesForModdersEnabled(false));

    expect(state.isFeaturesForModdersEnabled).toBe(false);
    expect(state.isCompatCheckingVanillaPacks).toBe(false);
  });

  it("cannot enable vanilla compatibility checks while modder features are off", () => {
    const state = appReducer(
      {
        ...initialState,
        isFeaturesForModdersEnabled: false,
        isCompatCheckingVanillaPacks: false,
      },
      toggleIsCompatCheckingVanillaPacks(),
    );

    expect(state.isCompatCheckingVanillaPacks).toBe(false);
  });
});
