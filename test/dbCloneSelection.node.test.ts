import { describe, expect, it } from "vitest";

import {
  filterDBCloneRedundantIndirectReferences,
  getDBCloneAutoSelectedParentNames,
} from "../src/components/viewer/dbCloneSelection";

const treeNode = (
  name: string,
  tableName: string,
  children: IViewerTreeNodeWithData[] = [],
  isIndirectRef = false,
): IViewerTreeNodeWithData => ({
  name,
  children,
  tableName,
  columnName: "key",
  value: name,
  isIndirectRef,
});

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

  it("hides an indirect table already present in its direct ancestor chain and promotes its children", () => {
    const promotedChild = treeNode("promoted child", "effects_tables", [], true);
    const repeatedLevels = treeNode("indirect levels", "building_levels_tables", [promotedChild], true);
    const tree = treeNode("tree", "", [
      treeNode("culture variant", "building_culture_variants_tables", [
        treeNode("direct levels", "building_levels_tables", [
          treeNode("direct chain", "building_chains_tables", [
            treeNode("direct instance", "building_instances_tables", [repeatedLevels]),
          ]),
        ]),
      ]),
    ]);

    const filtered = filterDBCloneRedundantIndirectReferences(tree);
    const instance = ((filtered.children[0] as IViewerTreeNodeWithData).children[0] as IViewerTreeNodeWithData)
      .children[0] as IViewerTreeNodeWithData;
    const instanceChild = instance.children[0] as IViewerTreeNodeWithData;

    expect(instanceChild.name).toBe("direct instance");
    expect((instanceChild.children[0] as IViewerTreeNodeWithData).name).toBe("promoted child");
  });

  it("keeps the same indirect table when no direct ancestor uses it", () => {
    const indirectLevels = treeNode("indirect levels", "building_levels_tables", [], true);
    const tree = treeNode("tree", "", [treeNode("direct chain", "building_chains_tables", [indirectLevels])]);

    const filtered = filterDBCloneRedundantIndirectReferences(tree);

    expect(((filtered.children[0] as IViewerTreeNodeWithData).children[0] as IViewerTreeNodeWithData).name).toBe(
      "indirect levels",
    );
  });
});
