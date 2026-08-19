import { describe, expect, it } from "vitest";

import {
  getNameSortingCycle,
  getNameSortingField,
  getNextNameSortingType,
  getNextTimeSortingType,
  getTimeSortingCycle,
  getTimeSortingField,
  SortingType,
} from "../src/utility/modRowSorting";

describe("the fields the compact name column stacks", () => {
  it("offers the data mods sort only where there are data mods", () => {
    expect(getNameSortingCycle(true)).toEqual([
      SortingType.HumanName,
      SortingType.PackName,
      SortingType.Author,
      SortingType.IsDataPack,
    ]);
    expect(getNameSortingCycle(false)).toEqual([SortingType.HumanName, SortingType.PackName, SortingType.Author]);
  });

  it("reads a reversed sort as the field it reverses", () => {
    expect(getNameSortingField(SortingType.HumanNameReverse)).toBe(SortingType.HumanName);
    expect(getNameSortingField(SortingType.PackNameReverse)).toBe(SortingType.PackName);
    expect(getNameSortingField(SortingType.AuthorReverse)).toBe(SortingType.Author);
    expect(getNameSortingField(SortingType.IsDataPackReverse)).toBe(SortingType.IsDataPack);
  });

  it("has no field for a sort that belongs to another column", () => {
    expect(getNameSortingField(SortingType.Ordered)).toBeUndefined();
    expect(getNameSortingField(SortingType.LastUpdated)).toBeUndefined();
    expect(getNameSortingField(SortingType.IsCustomizable)).toBeUndefined();
  });
});

describe("stepping the compact name column", () => {
  const stepThrough = (from: SortingType, steps: number, hasDataMods: boolean) => {
    const visited: SortingType[] = [];
    let sortingType = from;
    for (let step = 0; step < steps; step += 1) {
      sortingType = getNextNameSortingType(sortingType, hasDataMods);
      visited.push(sortingType);
    }
    return visited;
  };

  it("walks the whole cycle and comes back round", () => {
    expect(stepThrough(SortingType.HumanName, 4, true)).toEqual([
      SortingType.PackName,
      SortingType.Author,
      SortingType.IsDataPack,
      SortingType.HumanName,
    ]);
  });

  it("goes from the author straight back to the title where there are no data mods", () => {
    expect(stepThrough(SortingType.Author, 1, false)).toEqual([SortingType.HumanName]);
  });

  it("starts the cycle over from a sort another column set", () => {
    expect(getNextNameSortingType(SortingType.Ordered, true)).toBe(SortingType.HumanName);
    expect(getNextNameSortingType(SortingType.LastUpdatedReverse, false)).toBe(SortingType.HumanName);
  });

  it("starts over from a data mods sort left behind by a list that had data mods", () => {
    // The mods can change under a sort; the step it was on has to lead somewhere either way.
    expect(getNextNameSortingType(SortingType.IsDataPack, false)).toBe(SortingType.HumanName);
    expect(getNextNameSortingType(SortingType.IsDataPack, true)).toBe(SortingType.HumanName);
  });

  it("steps from a reversed field to the next one, ascending", () => {
    expect(getNextNameSortingType(SortingType.HumanNameReverse, true)).toBe(SortingType.PackName);
    expect(getNextNameSortingType(SortingType.AuthorReverse, true)).toBe(SortingType.IsDataPack);
  });
});

describe("the two dates the time column sorts by", () => {
  it("reads a reversed sort as the date it reverses, and nothing for another column's", () => {
    expect(getTimeSortingCycle()).toEqual([SortingType.LastUpdated, SortingType.SubbedTime]);
    expect(getTimeSortingField(SortingType.LastUpdatedReverse)).toBe(SortingType.LastUpdated);
    expect(getTimeSortingField(SortingType.SubbedTimeReverse)).toBe(SortingType.SubbedTime);
    expect(getTimeSortingField(SortingType.HumanName)).toBeUndefined();
  });

  it("swaps between the two, whichever way round and whichever direction", () => {
    expect(getNextTimeSortingType(SortingType.LastUpdated)).toBe(SortingType.SubbedTime);
    expect(getNextTimeSortingType(SortingType.LastUpdatedReverse)).toBe(SortingType.SubbedTime);
    expect(getNextTimeSortingType(SortingType.SubbedTime)).toBe(SortingType.LastUpdated);
    expect(getNextTimeSortingType(SortingType.SubbedTimeReverse)).toBe(SortingType.LastUpdated);
  });

  it("lands on the subscribed date from another column's sort, which a left click cannot reach", () => {
    expect(getNextTimeSortingType(SortingType.Ordered)).toBe(SortingType.SubbedTime);
    expect(getNextTimeSortingType(SortingType.Author)).toBe(SortingType.SubbedTime);
  });
});
