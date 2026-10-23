import { describe, expect, it } from "vitest";

import { pickTaggedImagesForSkills } from "../src/skills";

describe("pickTaggedImagesForSkills", () => {
  it("picks the images that a tree's descriptions and effects draw", () => {
    const skills = [
      {
        localizedDescription: "Lead from the front [[img:icon_general]][[/img]]",
        effects: [{ localizedKey: "[[img:icon_hero]][[/img]] Hero" } as Effect, {} as Effect],
      },
      { effects: [{ localizedKey: "[[img:icon_unknown]][[/img]]" } as Effect] },
    ] as Skill[];

    expect(
      pickTaggedImagesForSkills(skills, {
        icon_general: "ui\\general.png",
        icon_hero: "ui\\hero.png",
        icon_treasury: "ui\\treasury.png",
      }),
    ).toEqual({ icon_general: "ui\\general.png", icon_hero: "ui\\hero.png" });
  });
});
