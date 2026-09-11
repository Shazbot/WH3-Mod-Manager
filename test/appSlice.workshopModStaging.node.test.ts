import { beforeEach, describe, expect, it } from "vitest";

import appReducer, {
  setFromConfig,
  setWorkshopModStagingMode,
  toggleCleanUpWorkshopModStagingAfterGameExit,
} from "../src/appSlice";
import initialState from "../src/initialAppState";
import { selectConfigSavePayload, resetConfigSavePayloadCache } from "../src/config/configSavePayload";
import { migrateAppConfig } from "../src/config/migrateAppConfig";

describe("automatic Workshop mod staging settings", () => {
  beforeEach(resetConfigSavePayloadCache);

  it("defaults to disabled with cleanup off and persists both settings", () => {
    expect(initialState.workshopModStagingMode).toBe("disabled");
    expect(initialState.cleanUpWorkshopModStagingAfterGameExit).toBe(false);

    const enabledState = appReducer(initialState, setWorkshopModStagingMode("copy"));
    const cleanupState = appReducer(enabledState, toggleCleanUpWorkshopModStagingAfterGameExit());
    const payload = selectConfigSavePayload(cleanupState);
    expect(payload.config.workshopModStagingMode).toBe("copy");
    expect(payload.config.cleanUpWorkshopModStagingAfterGameExit).toBe(true);
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
        workshopModStagingMode: "symlink",
        cleanUpWorkshopModStagingAfterGameExit: true,
      }),
    );
    expect(restored.workshopModStagingMode).toBe("symlink");
    expect(restored.cleanUpWorkshopModStagingAfterGameExit).toBe(true);

    const legacy = { ...initialState } as Partial<AppState>;
    delete legacy.workshopModStagingMode;
    delete legacy.cleanUpWorkshopModStagingAfterGameExit;
    const fromLegacy = appReducer(initialState, setFromConfig(legacy as AppState));
    expect(fromLegacy.workshopModStagingMode).toBe("disabled");
    expect(fromLegacy.cleanUpWorkshopModStagingAfterGameExit).toBe(false);

    expect(migrateAppConfig({}).workshopModStagingMode).toBe("disabled");
    expect(migrateAppConfig({ workshopModStagingMode: "unexpected" }).workshopModStagingMode).toBe("disabled");
    expect(migrateAppConfig({ cleanUpWorkshopModStagingAfterGameExit: 1 }).cleanUpWorkshopModStagingAfterGameExit).toBe(
      false,
    );
  });
});
