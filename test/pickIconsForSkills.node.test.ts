import { describe, expect, it, vi } from "vitest";

/** The native zstd binding is an Electron prebuild and does not load here; nothing under test uses it. */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

import { pickIconsForSkills } from "../src/skillsData/cache";
import { iconAssetUrl, type AssetBytes } from "../src/assetUrls";

const skillIcon = (img: string) => `ui\\campaign ui\\skills\\${img}`;
const abilityIcon = (img: string) => `ui\\battle ui\\ability_icons\\${img}`;
const effectIcon = (icon: string) => `ui\\campaign ui\\effect_bundles\\${icon}`;
const tooltipIcon = "ui\\campaign ui\\effect_bundles\\tooltip.png";

const GENERATION = 7;

const skill = (img: string, effectIcons: string[] = []): Skill =>
  ({
    img,
    effects: effectIcons.map((icon) => ({ icon }) as Effect),
  }) as Skill;

const bytes = (): AssetBytes => ({ buffer: Buffer.from([1]), mimeType: "image/png" });

const icons: Record<string, AssetBytes> = {
  [skillIcon("used.png")]: bytes(),
  [abilityIcon("ability_only.png")]: bytes(),
  [effectIcon("used_effect.png")]: bytes(),
  [skillIcon("unused.png")]: bytes(),
  [effectIcon("unused_effect.png")]: bytes(),
  [tooltipIcon]: bytes(),
};

describe("pickIconsForSkills", () => {
  it("addresses the icons the given skills and their effects draw", () => {
    const picked = pickIconsForSkills(icons, GENERATION, [skill("used.png", ["used_effect.png"])]);

    expect(picked).toEqual({
      [skillIcon("used.png")]: iconAssetUrl(GENERATION, skillIcon("used.png")),
      [effectIcon("used_effect.png")]: iconAssetUrl(GENERATION, effectIcon("used_effect.png")),
    });
  });

  it("leaves out every other icon in the game", () => {
    const picked = pickIconsForSkills(icons, GENERATION, [skill("used.png")]);

    expect(picked[skillIcon("unused.png")]).toBeUndefined();
    expect(picked[effectIcon("unused_effect.png")]).toBeUndefined();
  });

  it("finds a skill wearing an ability icon, which lives in the other folder", () => {
    const picked = pickIconsForSkills(icons, GENERATION, [skill("ability_only.png")]);

    expect(picked).toEqual({
      [abilityIcon("ability_only.png")]: iconAssetUrl(GENERATION, abilityIcon("ability_only.png")),
    });
  });

  it("keeps the extra paths asked for, which is how tooltip icons come along", () => {
    const picked = pickIconsForSkills(icons, GENERATION, [], [tooltipIcon]);

    expect(picked).toEqual({ [tooltipIcon]: iconAssetUrl(GENERATION, tooltipIcon) });
  });

  it("skips paths the game has no icon for rather than handing out a URL that cannot resolve", () => {
    const picked = pickIconsForSkills(
      icons,
      GENERATION,
      [skill("missing.png", ["missing_effect.png"])],
      ["also\\missing.png"],
    );

    expect(picked).toEqual({});
  });
});
