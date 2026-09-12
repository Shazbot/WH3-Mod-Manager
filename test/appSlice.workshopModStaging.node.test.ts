import { beforeEach, describe, expect, it } from "vitest";

import appReducer, {
  setFromConfig,
  setWorkshopModStagingMode,
  toggleCompressWorkshopModsOnStart,
  toggleCleanUpWorkshopModStagingAfterGameExit,
} from "../src/appSlice";
import initialState from "../src/initialAppState";
import { selectConfigSavePayload, resetConfigSavePayloadCache } from "../src/config/configSavePayload";
import { migrateAppConfig } from "../src/config/migrateAppConfig";

describe("automatic Workshop mod staging settings", () => {
  beforeEach(resetConfigSavePayloadCache);

  it("defaults to disabled with cleanup off and persists both settings", () => {
    expect(initialState.workshopModStagingMode).toBe("disabled");
    expect(initialState.compressWorkshopModsOnStart).toBe(false);
    expect(initialState.cleanUpWorkshopModStagingAfterGameExit).toBe(false);

    const enabledState = appReducer(initialState, setWorkshopModStagingMode("copy"));
    const cleanupState = appReducer(enabledState, toggleCleanUpWorkshopModStagingAfterGameExit());
    const payload = selectConfigSavePayload(cleanupState);
    expect(payload.config.workshopModStagingMode).toBe("copy");
    expect(payload.config.compressWorkshopModsOnStart).toBe(false);
    expect(payload.config.cleanUpWorkshopModStagingAfterGameExit).toBe(true);
  });

  it("allows compression only for WH3 copy staging", () => {
    const copyState = appReducer(initialState, setWorkshopModStagingMode("copy"));
    const compressedState = appReducer(copyState, toggleCompressWorkshopModsOnStart());
    expect(compressedState.compressWorkshopModsOnStart).toBe(true);
    expect(selectConfigSavePayload(compressedState).config.compressWorkshopModsOnStart).toBe(true);

    const symlinkState = appReducer(compressedState, setWorkshopModStagingMode("symlink"));
    expect(symlinkState.compressWorkshopModsOnStart).toBe(false);
    expect(appReducer(symlinkState, toggleCompressWorkshopModsOnStart()).compressWorkshopModsOnStart).toBe(false);

    const nonWh3State = appReducer(
      { ...copyState, currentGame: "wh2" } as AppState,
      toggleCompressWorkshopModsOnStart(),
    );
    expect(nonWh3State.compressWorkshopModsOnStart).toBe(false);
  });

  it("keeps copy and symlink modes mutually exclusive", () => {
    const copyState = appReducer(initialState, setWorkshopModStagingMode("copy"));
    expect(copyState.workshopModStagingMode).toBe("copy");

    const symlinkState = appReducer(copyState, setWorkshopModStagingMode("symlink"));
    expect(symlinkState.workshopModStagingMode).toBe("symlink");
    expect(appReducer(symlinkState, setWorkshopModStagingMode("disabled")).workshopModStagingMode).toBe("disabled");
  });

  it("restores valid config values and safely defaults missing or invalid values", () => {
    const restored = appReducer(
      initialState,
      setFromConfig({
        ...initialState,
        workshopModStagingMode: "copy",
        compressWorkshopModsOnStart: true,
        cleanUpWorkshopModStagingAfterGameExit: true,
      }),
    );
    expect(restored.workshopModStagingMode).toBe("copy");
    expect(restored.compressWorkshopModsOnStart).toBe(true);
    expect(restored.cleanUpWorkshopModStagingAfterGameExit).toBe(true);

    const legacy = { ...initialState } as Partial<AppState>;
    delete legacy.workshopModStagingMode;
    delete legacy.compressWorkshopModsOnStart;
    delete legacy.cleanUpWorkshopModStagingAfterGameExit;
    const fromLegacy = appReducer(initialState, setFromConfig(legacy as AppState));
    expect(fromLegacy.workshopModStagingMode).toBe("disabled");
    expect(fromLegacy.compressWorkshopModsOnStart).toBe(false);
    expect(fromLegacy.cleanUpWorkshopModStagingAfterGameExit).toBe(false);

    expect(migrateAppConfig({}).workshopModStagingMode).toBe("disabled");
    expect(migrateAppConfig({ compressWorkshopModsOnStart: true }).compressWorkshopModsOnStart).toBe(false);
    expect(
      migrateAppConfig({ workshopModStagingMode: "copy", compressWorkshopModsOnStart: true })
        .compressWorkshopModsOnStart,
    ).toBe(true);
    expect(
      migrateAppConfig({ workshopModStagingMode: "symlink", compressWorkshopModsOnStart: true })
        .compressWorkshopModsOnStart,
    ).toBe(false);
    expect(migrateAppConfig({ workshopModStagingMode: "unexpected" }).workshopModStagingMode).toBe("disabled");
    expect(migrateAppConfig({ cleanUpWorkshopModStagingAfterGameExit: 1 }).cleanUpWorkshopModStagingAfterGameExit).toBe(
      false,
    );
  });
});
