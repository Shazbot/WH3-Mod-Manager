import { describe, expect, it } from "vitest";

import { sortByNameAndLoadOrder } from "../src/modSortingHelpers";
import { getUsedModImport, parseUsedMods } from "../src/usedMods";

const sortImport = (names: string[]) => {
  const imported = getUsedModImport(names, names);
  return sortByNameAndLoadOrder(
    imported.map(({ name, loadOrder }) => ({ name, loadOrder }) as Mod),
  );
};

const getPermutations = (names: string[]): string[][] =>
  names.length < 2
    ? [names]
    : names.flatMap((name, index) =>
        getPermutations(names.filter((_, otherIndex) => otherIndex !== index)).map((rest) => [name, ...rest]),
      );

describe("parseUsedMods", () => {
  it("reads mod statements in file order and ignores working directories", () => {
    const text = [
      'add_working_directory "C:\\workshop";',
      'mod "zeta.pack";',
      '  MOD "alpha.pack";\r',
      'mod "zeta.pack";',
    ].join("\n");

    expect(parseUsedMods(text)).toEqual(["zeta.pack", "alpha.pack"]);
  });
});

describe("getUsedModImport", () => {
  it("does not add load orders when file order is automatic", () => {
    expect(getUsedModImport(["alpha.pack", "beta.pack", "gamma.pack"], [
      "alpha.pack",
      "beta.pack",
      "gamma.pack",
    ])).toEqual([
      { name: "alpha.pack", loadOrder: undefined },
      { name: "beta.pack", loadOrder: undefined },
      { name: "gamma.pack", loadOrder: undefined },
    ]);
  });

  it("pins only the mods outside the largest automatic subsequence", () => {
    const desiredOrder = ["beta.pack", "alpha.pack", "delta.pack", "gamma.pack"];
    const imported = getUsedModImport(desiredOrder, desiredOrder);

    expect(imported.filter((mod) => mod.loadOrder !== undefined)).toEqual([
      { name: "beta.pack", loadOrder: 0 },
    ]);
    expect(sortImport(desiredOrder).map((mod) => mod.name)).toEqual(desiredOrder);
  });

  it("keeps pj_console first while pinning only that mod", () => {
    const desiredOrder = ["pj_console.pack", "@xou_high_elves.pack", "pj_loadfile.pack"];
    const imported = getUsedModImport(desiredOrder, desiredOrder);

    expect(imported).toEqual([
      { name: "pj_console.pack", loadOrder: 0 },
      { name: "@xou_high_elves.pack", loadOrder: undefined },
      { name: "pj_loadfile.pack", loadOrder: undefined },
    ]);
    expect(sortImport(desiredOrder).map((mod) => mod.name)).toEqual(desiredOrder);
  });

  it("ignores unavailable and duplicate entries before assigning positions", () => {
    expect(
      getUsedModImport(
        ["missing.pack", "beta.pack", "beta.pack", "alpha.pack"],
        ["alpha.pack", "beta.pack"],
      ),
    ).toEqual([
      { name: "beta.pack", loadOrder: 0 },
      { name: "alpha.pack", loadOrder: undefined },
    ]);
  });

  it("reconstructs every order while using the minimum possible number of pins", () => {
    const names = ["alpha.pack", "beta.pack", "gamma.pack", "omega.pack"];

    for (const desiredOrder of getPermutations(names)) {
      const imported = getUsedModImport(desiredOrder, names);
      const pinnedCount = imported.filter((mod) => mod.loadOrder !== undefined).length;
      expect(sortImport(desiredOrder).map((mod) => mod.name)).toEqual(desiredOrder);

      for (let mask = 0; mask < 1 << names.length; mask++) {
        const candidatePinnedCount = names.filter((_, index) => mask & (1 << index)).length;
        if (candidatePinnedCount >= pinnedCount) continue;
        const candidate = desiredOrder.map((name, index) => ({
          name,
          loadOrder: mask & (1 << index) ? index : undefined,
        }));
        expect(sortByNameAndLoadOrder(candidate as Mod[]).map((mod) => mod.name)).not.toEqual(
          desiredOrder,
        );
      }
    }
  });
});
