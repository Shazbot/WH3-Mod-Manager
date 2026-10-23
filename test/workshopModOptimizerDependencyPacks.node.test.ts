import { describe, expect, it } from "vitest";

import { dependencyRelatedMods } from "../src/workshopModOptimizer/dependencyPacks";

const mod = (name: string, extra: object = {}) => ({ name, path: `C:\\mods\\${name}`, ...extra });

describe("dependencyRelatedMods", () => {
  it("includes what the source requires, by pack name and by workshop id", () => {
    const source = mod("a.pack", { dependencyPacks: ["b.pack"], reqModIdToName: [["30", "c"]] });
    const result = dependencyRelatedMods(source, [
      source,
      mod("b.pack"),
      mod("c.pack", { workshopId: "30" }),
      mod("d.pack"),
    ]);
    expect(result.map((item) => item.name)).toEqual(["b.pack", "c.pack"]);
  });

  it("includes what requires the source (B depends on A)", () => {
    const source = mod("a.pack", { workshopId: "10" });
    const result = dependencyRelatedMods(source, [
      mod("x.pack", { dependencyPacks: ["a.pack"] }),
      mod("y.pack", { reqModIdToName: [["10", "a"]] }),
      mod("c.pack", { reqModIdToName: [["11", "other"]], dependencyPacks: ["z.pack"] }),
      source,
    ]);
    expect(result.map((item) => item.name)).toEqual(["x.pack", "y.pack"]);
  });

  it("ignores missing or disabled dependencies, empty ids and the source itself", () => {
    const source = mod("a.pack", { workshopId: "", dependencyPacks: ["a.pack", "gone.pack"], reqModIdToName: [["99", "gone"]] });
    const result = dependencyRelatedMods(source, [source, mod("c.pack", { workshopId: "", reqModIdToName: [["", "x"]] })]);
    expect(result).toEqual([]);
  });

  it("keeps the order of the given mods and compares pack names without case", () => {
    const source = mod("A.pack", { dependencyPacks: ["Z.pack"] });
    const result = dependencyRelatedMods(source, [mod("z.PACK"), mod("m.pack", { dependencyPacks: ["a.PACK"] })]);
    expect(result.map((item) => item.name)).toEqual(["z.PACK", "m.pack"]);
  });
});
