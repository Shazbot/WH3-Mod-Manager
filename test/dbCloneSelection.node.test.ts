import { describe, expect, it } from "vitest";

import { getDBCloneAutoSelectedParentNames } from "../src/components/viewer/dbCloneSelection";

describe("DB Clone selection", () => {
  it("does not auto-select indirect ancestors", () => {
    const nodes = {
      root: { name: "root", isIndirectRef: false },
      indirect: { name: "indirect", isIndirectRef: true },
      direct: { name: "direct", isIndirectRef: false },
    } as Record<string, IViewerTreeNodeWithData>;

    expect(getDBCloneAutoSelectedParentNames(["direct", "indirect", "root"], nodes)).toEqual(["direct", "root"]);
  });

  it("keeps an indirect node available for explicit selection", () => {
    const selected = ["indirect"];
    const nodes = {
      indirect: { name: "indirect", isIndirectRef: true },
    } as Record<string, IViewerTreeNodeWithData>;

    for (const parentName of getDBCloneAutoSelectedParentNames(["indirect"], nodes)) {
      if (!selected.includes(parentName)) selected.push(parentName);
    }

    expect(selected).toEqual(["indirect"]);
  });
});
