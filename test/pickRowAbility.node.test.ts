import { describe, expect, it } from "vitest";

import { pickRowAbility } from "../src/components/skillsViewer/pickRowAbility";

const ability = (key: string, name: string) => ({ key, name }) as AbilityTooltipData;
const fireball = ability("a1", "Fireball");
const upgraded = ability("a2", "Fireball (Upgraded)");
const frost = ability("a3", "Frost");
const unnamed1 = ability("u1", "");
const unnamed2 = ability("u2", "");

describe("pickRowAbility", () => {
  it("returns a single unnamed ability", () => {
    expect(pickRowAbility("text", [ability("x", "Unseen")], [])?.key).toBe("x");
  });

  it("gives none for several abilities the text does not name", () => {
    expect(pickRowAbility("text", [unnamed1, unnamed2], [])).toBeUndefined();
  });

  it("prefers the upgraded spell over its base", () => {
    expect(pickRowAbility("Casts Fireball (Upgraded)", [fireball, upgraded], [])).toBe(upgraded);
  });

  it("gives none for two unrelated named spells", () => {
    expect(pickRowAbility("Fireball and Frost", [fireball, frost], [])).toBeUndefined();
  });

  it("uses a named hidden-pool spell when the effect has no abilities of its own", () => {
    expect(pickRowAbility("Casts Frost", [], [fireball, frost])).toBe(frost);
  });

  it("never falls back to an unnamed hidden-pool spell", () => {
    expect(pickRowAbility("text", [], [ability("h", "Unseen")])).toBeUndefined();
  });

  it("returns the first of two keys that share a name", () => {
    const lord = ability("lord", "Fireball");
    const hero = ability("hero", "Fireball");
    expect(pickRowAbility("Casts Fireball", [lord, hero], [])).toBe(lord);
  });

  it("counts duplicate keys once", () => {
    expect(pickRowAbility("text", [unnamed1, { ...unnamed1 }], [])?.key).toBe("u1");
    expect(pickRowAbility("Fireball", [fireball, { ...fireball }], [])?.key).toBe("a1");
  });
});
