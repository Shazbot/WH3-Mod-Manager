import { describe, expect, it } from "vitest";
import { findUnitViewerAssetFiles, getUnitViewerAssetCandidates } from "../src/unitViewer/assets";
import { collator } from "../src/utility/packFileSorting";

const files = (...names: string[]) => names.map((name) => ({ name })).sort((a, b) => collator.compare(a.name, b.name));

describe("Unit Viewer batch asset matching", () => {
  it("prefers the requested extension, then PNG, WebP and JPG fallbacks", () => {
    expect(getUnitViewerAssetCandidates("ui\\icon.webp")).toEqual(["ui\\icon.webp", "ui\\icon.png", "ui\\icon.jpg"]);
    const index = files("ui\\icon.png", "ui\\icon.webp", "ui\\fallback.jpg", "ui\\fallback.webp");
    expect(findUnitViewerAssetFiles(index, ["ui\\icon.webp", "ui\\fallback.png", "ui\\missing.png"])).toEqual(
      new Map([
        ["ui\\icon.webp", "ui\\icon.webp"],
        ["ui\\fallback.png", "ui\\fallback.webp"],
      ]),
    );
    expect(findUnitViewerAssetFiles(files("ui\\icon.jpg"), ["ui\\icon.png"]).get("ui\\icon.png")).toBe("ui\\icon.jpg");
  });

  it("matches mixed-case paths and separators, preserving the first normalized fallback", () => {
    const index = files("UI/Icon.PNG", "Ui\\Icon.PnG");
    expect(findUnitViewerAssetFiles(index, ["ui\\icon.png"]).get("ui\\icon.png")).toBe(index[0].name);
  });

  it("preserves binary-search preference over a normalized fallback", () => {
    const index = files("UI/Icon.PNG", "ui\\icon.png");
    expect(findUnitViewerAssetFiles(index, ["ui\\icon.png"]).get("ui\\icon.png")).toBe("ui\\icon.png");
  });

  it("allows a higher-priority mod's fallback extension to override a vanilla PNG", () => {
    const packs = [
      { name: "mod", index: files("UI/Icon.WebP") },
      { name: "vanilla", index: files("ui\\icon.png", "ui\\vanilla.png") },
    ];
    const outstanding = new Set(["ui\\icon.png", "ui\\vanilla.png", "ui\\missing.png"]);
    const providers = new Map<string, string>();
    for (const pack of packs) {
      for (const [path] of findUnitViewerAssetFiles(pack.index, outstanding)) {
        providers.set(path, pack.name);
        outstanding.delete(path);
      }
    }
    expect(providers).toEqual(
      new Map([
        ["ui\\icon.png", "mod"],
        ["ui\\vanilla.png", "vanilla"],
      ]),
    );
    expect([...outstanding]).toEqual(["ui\\missing.png"]);
  });

  it("does not retain misses or stale filenames across batches", () => {
    const index = files("UI/Old.PNG");
    expect(findUnitViewerAssetFiles(index, ["ui\\new.png"]).size).toBe(0);
    index[0].name = "UI/New.PNG";
    expect(findUnitViewerAssetFiles(index, ["ui\\new.png", "ui\\old.png"])).toEqual(
      new Map([["ui\\new.png", "UI/New.PNG"]]),
    );
  });

  it("does not scan the pack when the first candidate matches or no paths were requested", () => {
    let reads = 0;
    const index = [
      {
        get name() {
          reads++;
          return "ui\\icon.png";
        },
      },
    ];
    expect(findUnitViewerAssetFiles(index, []).size).toBe(0);
    expect(reads).toBe(0);
    expect(findUnitViewerAssetFiles(index, ["ui\\icon.png"]).get("ui\\icon.png")).toBe("ui\\icon.png");
    expect(reads).toBe(2);
  });

  it("bounds full-index work when many requested assets are missing", () => {
    let reads = 0;
    const index = files(...Array.from({ length: 2000 }, (_, i) => `ui\\file_${i}.png`)).map(({ name }) => ({
      get name() {
        reads++;
        return name;
      },
    }));
    const requests = Array.from({ length: 20 }, (_, i) => `ui\\missing_${i}.png`);
    expect(findUnitViewerAssetFiles(index, requests).size).toBe(0);
    expect(reads).toBeLessThan(index.length * 2);
  });
});
