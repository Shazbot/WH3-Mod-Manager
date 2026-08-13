import { describe, expect, it } from "vitest";

import { iconAssetUrl, normalizeAssetPath, unitAssetUrl } from "../src/assetUrls";

describe("asset URLs", () => {
  it("survives the characters a pack path is full of", () => {
    const url = new URL(iconAssetUrl(3, "ui\\campaign ui\\skills\\wh_main_skill.png"));

    expect(url.protocol).toBe("whmm:");
    expect(url.host).toBe("icon");
    // Decoding the last segment has to hand back exactly the path the pack knows it by: backslashes
    // and spaces both have to survive a round trip through a standard scheme's URL parser.
    expect(decodeURIComponent(url.pathname.split("/")[2])).toBe("ui\\campaign ui\\skills\\wh_main_skill.png");
  });

  it("carries the generation, so a rebuilt icon is not served from Chromium's cache", () => {
    expect(iconAssetUrl(1, "ui\\a.png")).not.toBe(iconAssetUrl(2, "ui\\a.png"));
  });

  it("scopes a unit viewer asset to its session", () => {
    const url = new URL(unitAssetUrl("session-1", "ui\\units\\icons\\unit_a.png"));

    expect(url.host).toBe("unit-asset");
    const [, sessionId, assetPath] = url.pathname.split("/").map((segment) => decodeURIComponent(segment));
    expect(sessionId).toBe("session-1");
    expect(assetPath).toBe("ui\\units\\icons\\unit_a.png");
  });

  it("normalises the way pack paths are compared everywhere else", () => {
    expect(normalizeAssetPath("UI/Campaign UI/Skills/A.PNG")).toBe("ui\\campaign ui\\skills\\a.png");
    // Which means two spellings of one path address the same asset.
    expect(iconAssetUrl(1, "UI\\A.png")).toBe(iconAssetUrl(1, "ui/a.png"));
  });
});
