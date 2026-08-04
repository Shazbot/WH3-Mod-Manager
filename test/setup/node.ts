import { afterEach, vi } from "vitest";

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock("../../src/ipcMainListeners", () => ({
  getDefaultTableVersions: vi.fn(() => ({})),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
