import { describe, expect, it, vi } from "vitest";
import { deepCloneImagePathsByTable } from "../../src/flowDeepClone";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

describe("deep clone art sources", () => {
  it("names the packs to index rather than relying on the whole vanilla set", () => {
    const sources = deepCloneImagePathsByTable.main_units_tables;
    expect(sources).toHaveLength(1);
    expect(sources[0].folder).toBe("ui\\units\\minspec_portholes\\");
    // Verified against a real install: of ~260 vanilla packs, only ui.pack holds this folder.
    expect(sources[0].vanillaPacks).toEqual(["ui.pack"]);
  });

  it("declares a trailing separator on every folder so names concatenate cleanly", () => {
    for (const sources of Object.values(deepCloneImagePathsByTable)) {
      for (const source of sources) {
        expect(source.folder.endsWith("\\")).toBe(true);
        expect(source.vanillaPacks.length).toBeGreaterThan(0);
      }
    }
  });
});
