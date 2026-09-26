import { describe, expect, it } from "vitest";

import {
  isWindowsDeveloperModeEnabled,
  WINDOWS_DEVELOPER_MODE_REGISTRY_VALUE,
} from "../src/utility/windowsDeveloperMode";

describe("Windows Developer Mode detection", () => {
  it("is always available for symbolic links on non-Windows platforms", async () => {
    expect(await isWindowsDeveloperModeEnabled("linux", async () => [])).toBe(true);
  });

  it("detects the documented registry value", async () => {
    expect(
      await isWindowsDeveloperModeEnabled("win32", async () => [
        { name: WINDOWS_DEVELOPER_MODE_REGISTRY_VALUE, value: "1" },
      ]),
    ).toBe(true);
    expect(
      await isWindowsDeveloperModeEnabled("win32", async () => [
        { name: WINDOWS_DEVELOPER_MODE_REGISTRY_VALUE, value: "0" },
      ]),
    ).toBe(false);
  });

  it("fails closed when the registry cannot be read", async () => {
    expect(await isWindowsDeveloperModeEnabled("win32", async () => Promise.reject(new Error("registry")))).toBe(false);
  });
});
