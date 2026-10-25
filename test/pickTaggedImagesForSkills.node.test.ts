import { describe, expect, it } from "vitest";

import { pickTaggedImagesForSkills, pickTaggedImagesForTexts } from "../src/skills";

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

describe("pickTaggedImagesForTexts", () => {
  const images = { icon_a: "ui\\a.png", icon_b: "ui\\b.png" };

  it("ignores undefined texts and unknown tags", () => {
    expect(pickTaggedImagesForTexts([undefined, "[[img:icon_zzz]][[/img]]", "[[img:icon_a]][[/img]]"], images)).toEqual(
      {
        icon_a: "ui\\a.png",
      },
    );
  });

  it("picks a repeated tag once", () => {
    const picked = pickTaggedImagesForTexts(
      ["[[img:icon_b]][[/img]] x [[img:icon_b]][[/img]]", "[[img:icon_b]]"],
      images,
    );
    expect(Object.keys(picked)).toEqual(["icon_b"]);
  });
});
