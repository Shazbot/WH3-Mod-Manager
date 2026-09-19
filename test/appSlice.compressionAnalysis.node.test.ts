import { beforeEach, describe, expect, it } from "vitest";

import appData from "../src/appData";
import appReducer, {
  setFromConfig,
  setIsRigidModelV2CompressionEnabled,
  toggleCompressModsOnUpload,
} from "../src/appSlice";
import { applyConfigSavePayloadToAppData } from "../src/config/applyConfigSavePayload";
import { selectConfigSavePayload, resetConfigSavePayloadCache } from "../src/config/configSavePayload";
import { migrateAppConfig } from "../src/config/migrateAppConfig";
import initialState from "../src/initialAppState";

describe("rigid-model compression option", () => {
  beforeEach(() => {
    resetConfigSavePayloadCache();
    appData.isRigidModelV2CompressionEnabled = true;
    appData.compressModsOnUpload = true;
  });

  it("defaults on and can be changed in app state", () => {
    expect(initialState.isRigidModelV2CompressionEnabled).toBe(true);
    const disabled = appReducer(initialState, setIsRigidModelV2CompressionEnabled(false));
    expect(disabled.isRigidModelV2CompressionEnabled).toBe(false);
  });

  it("restores the saved value and keeps the default for older configs", () => {
    const restored = appReducer(
      initialState,
      setFromConfig({ ...initialState, isRigidModelV2CompressionEnabled: false }),
    );
    expect(restored.isRigidModelV2CompressionEnabled).toBe(false);

    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.isRigidModelV2CompressionEnabled;
    expect(appReducer(initialState, setFromConfig(legacyConfig as AppState)).isRigidModelV2CompressionEnabled).toBe(
      true,
    );

    expect(migrateAppConfig({}).isRigidModelV2CompressionEnabled).toBe(true);
    expect(migrateAppConfig({ isRigidModelV2CompressionEnabled: false }).isRigidModelV2CompressionEnabled).toBe(false);
  });

  it("is included in the renderer payload and mirrored by main", () => {
    const payload = selectConfigSavePayload({
      ...initialState,
      isRigidModelV2CompressionEnabled: false,
    });
    expect(payload.config.isRigidModelV2CompressionEnabled).toBe(false);

    applyConfigSavePayloadToAppData(payload);
    expect(appData.isRigidModelV2CompressionEnabled).toBe(false);
  });

  it("persists the automatic upload compression preference", () => {
    expect(initialState.compressModsOnUpload).toBe(true);
    expect(appReducer(initialState, toggleCompressModsOnUpload()).compressModsOnUpload).toBe(false);

    const restored = appReducer(initialState, setFromConfig({ ...initialState, compressModsOnUpload: true }));
    expect(restored.compressModsOnUpload).toBe(true);

    const legacyConfig = { ...initialState } as Partial<AppState>;
    delete legacyConfig.compressModsOnUpload;
    expect(appReducer(initialState, setFromConfig(legacyConfig as AppState)).compressModsOnUpload).toBe(true);

    expect(migrateAppConfig({}).compressModsOnUpload).toBe(true);
    expect(migrateAppConfig({ compressModsOnUpload: true }).compressModsOnUpload).toBe(true);

    const payload = selectConfigSavePayload({ ...initialState, compressModsOnUpload: true });
    expect(payload.config.compressModsOnUpload).toBe(true);
    applyConfigSavePayloadToAppData(payload);
    expect(appData.compressModsOnUpload).toBe(true);
  });
});
