import { describe, expect, it } from "vitest";

import {
  collapsePackFileCollisions,
  collapsePackTableCollisions,
  collapseScriptListenerCollisions,
  collapseUniqueIdsCollisions,
  higherPriorityDatabaseFile,
  higherPriorityPack,
} from "../src/modCompat/compatViewModels";

describe("compatibility display view models", () => {
  it("collapses the two directional file records into one conflict", () => {
    const conflicts = collapsePackFileCollisions([
      { firstPackName: "high.pack", secondPackName: "low.pack", fileName: "models\\unit.wsmodel", areSameSize: false },
      { firstPackName: "low.pack", secondPackName: "high.pack", fileName: "models\\unit.wsmodel", areSameSize: false },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].fileName).toBe("models\\unit.wsmodel");
  });

  it("collapses mirrored table records while keeping distinct keys separate", () => {
    const base = {
      firstPackName: "a.pack",
      secondPackName: "b.pack",
      fileName: "db\\main_units_tables\\a",
      secondFileName: "db\\main_units_tables\\b",
      key: "key",
      value: "empire_swordsmen",
    };

    expect(
      collapsePackTableCollisions([
        base,
        {
          ...base,
          firstPackName: "b.pack",
          secondPackName: "a.pack",
          fileName: base.secondFileName,
          secondFileName: base.fileName,
        },
        { ...base, value: "spearmen" },
      ]),
    ).toHaveLength(2);
  });

  it("counts a cross-pack duplicate key once when it is stored under both packs", () => {
    const first = {
      tableName: "main_units_tables",
      fieldName: "key",
      firstPackName: "a.pack",
      secondPackName: "b.pack",
      value: { value: "empire_swordsmen", packFileName: "a", packName: "a.pack", tableRow: ["a"] },
      valueTwo: { value: "empire_swordsmen", packFileName: "b", packName: "b.pack", tableRow: ["b"] },
    };
    const mirror = {
      ...first,
      firstPackName: "b.pack",
      secondPackName: "a.pack",
      value: first.valueTwo,
      valueTwo: first.value,
    };

    expect(collapseUniqueIdsCollisions([first, mirror])).toHaveLength(1);
  });

  it("counts a cross-pack duplicate listener once when it is stored under both packs", () => {
    const first = {
      packFileName: "script.lua",
      firstPackName: "a.pack",
      secondPackName: "b.pack",
      value: { value: "OnBattle", packFileName: "script.lua", packName: "a.pack", position: 10 },
      valueTwo: { value: "OnBattle", packFileName: "script.lua", packName: "b.pack", position: 20 },
    };
    const mirror = {
      ...first,
      firstPackName: "b.pack",
      secondPackName: "a.pack",
      value: first.valueTwo,
      valueTwo: first.value,
    };

    expect(collapseScriptListenerCollisions([first, mirror])).toHaveLength(1);
  });

  it("uses visible load order to identify the file winner", () => {
    expect(higherPriorityPack("late.pack", "early.pack", ["early.pack", "late.pack"])).toBe("second");
    expect(higherPriorityPack("early.pack", "late.pack", ["early.pack", "late.pack"])).toBe("first");
  });

  it("uses the internal database filename to identify the table winner", () => {
    expect(
      higherPriorityDatabaseFile({
        fileName: "db\\main_units_tables\\z_balance",
        secondFileName: "db\\main_units_tables\\a_balance",
      }),
    ).toBe("second");
  });
});
