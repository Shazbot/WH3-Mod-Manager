import { describe, expect, it } from "vitest";

import { getConflictingStartposMods } from "../src/utility/startposConflicts";

const createMod = (name: string, dependencyPacks: string[] = []): Mod =>
  ({
    name,
    path: `/mods/${name}`,
    hasStartpos: true,
    dependencyPacks,
  }) as Mod;

describe("startpos conflicts", () => {
  it("does not conflict when either pack directly depends on the other", () => {
    const baseMod = createMod("base.pack");
    const dependentMod = createMod("dependent.pack", ["BASE.PACK"]);

    expect(getConflictingStartposMods([baseMod, dependentMod])).toEqual([]);
  });

  it("follows transitive dependencies through enabled packs", () => {
    const baseMod = createMod("base.pack");
    const intermediateMod = createMod("intermediate.pack", ["base.pack"]);
    intermediateMod.hasStartpos = false;
    const dependentMod = createMod("dependent.pack", ["some/path/intermediate.pack"]);

    expect(getConflictingStartposMods([baseMod, intermediateMod, dependentMod])).toEqual([]);
  });

  it("still reports independently ordered startpos packs", () => {
    const baseMod = createMod("base.pack");
    const firstDependent = createMod("first.pack", ["base.pack"]);
    const secondDependent = createMod("second.pack", ["base.pack"]);

    expect(getConflictingStartposMods([baseMod, firstDependent, secondDependent])).toEqual([
      firstDependent,
      secondDependent,
    ]);
  });
});
