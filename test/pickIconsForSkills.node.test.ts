import { describe, expect, it, vi } from "vitest";

/** The native zstd binding is an Electron prebuild and does not load here; nothing under test uses it. */
vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

import { pickIconsForSkills } from "../src/skillsData/cache";

const skillIcon = (img: string) => `ui\\campaign ui\\skills\\${img}`;
const abilityIcon = (img: string) => `ui\\battle ui\\ability_icons\\${img}`;
const effectIcon = (icon: string) => `ui\\campaign ui\\effect_bundles\\${icon}`;

const skill = (img: string, effectIcons: string[] = []): Skill =>
  ({
    img,
    effects: effectIcons.map((icon) => ({ icon }) as Effect),
  }) as Skill;

const icons = {
  [skillIcon("used.png")]: "used-icon",
  [abilityIcon("ability_only.png")]: "ability-icon",
  [effectIcon("used_effect.png")]: "effect-icon",
  [skillIcon("unused.png")]: "unused-icon",
  [effectIcon("unused_effect.png")]: "unused-effect-icon",
  "ui\\campaign ui\\effect_bundles\\tooltip.png": "tooltip-icon",
};

describe("pickIconsForSkills", () => {
  it("keeps the icons the given skills and their effects draw", () => {
    const picked = pickIconsForSkills(icons, [skill("used.png", ["used_effect.png"])]);

    expect(picked).toEqual({
      [skillIcon("used.png")]: "used-icon",
      [effectIcon("used_effect.png")]: "effect-icon",
    });
  });

  it("leaves out every other icon in the game", () => {
    const picked = pickIconsForSkills(icons, [skill("used.png")]);

    expect(picked[skillIcon("unused.png")]).toBeUndefined();
    expect(picked[effectIcon("unused_effect.png")]).toBeUndefined();
  });

  it("finds a skill wearing an ability icon, which lives in the other folder", () => {
    const picked = pickIconsForSkills(icons, [skill("ability_only.png")]);

    expect(picked).toEqual({ [abilityIcon("ability_only.png")]: "ability-icon" });
  });

  it("keeps the extra paths asked for, which is how tooltip icons come along", () => {
    const picked = pickIconsForSkills(icons, [], ["ui\\campaign ui\\effect_bundles\\tooltip.png"]);

    expect(picked).toEqual({ "ui\\campaign ui\\effect_bundles\\tooltip.png": "tooltip-icon" });
  });

  it("skips paths the game has no icon for rather than carrying an empty entry", () => {
    const picked = pickIconsForSkills(icons, [skill("missing.png", ["missing_effect.png"])], ["also\\missing.png"]);

    expect(picked).toEqual({});
  });
});
