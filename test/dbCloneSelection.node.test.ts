import { describe, expect, it } from "vitest";

import {
  BUILDINGS_CULTURE_VARIANT_PRESELECT_ALL_TABLES,
  BUILDINGS_CULTURE_VARIANT_PRESELECT_TABLES,
  filterDBCloneRedundantIndirectReferences,
  getDBCloneAutoSelectedParentNames,
  getDBCloneExpandedNodeNamesForSelection,
  getDBCloneInitialSelectedNodeNames,
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
  it("selects one row per requested table in breadth-first order", () => {
    const tree = treeNode("tree", "", [
      treeNode("culture variant", "building_culture_variants_tables", [
        treeNode("first level", "building_levels_tables", [
          treeNode("first chain", "building_chains_tables", [treeNode("second level", "building_levels_tables")]),
        ]),
        treeNode("first instance", "building_instances_tables"),
      ]),
    ]);

    expect(
      getDBCloneInitialSelectedNodeNames(tree, [
        "building_chains_tables",
        "building_levels_tables",
        "building_instances_tables",
      ]),
    ).toEqual(["culture variant", "first level", "first instance", "first chain"]);
  });

  it("selects every requested row for tables allowed to repeat", () => {
    const tree = treeNode("tree", "", [
      treeNode("culture variant", "building_culture_variants_tables", [
        treeNode("first level", "building_levels_tables", [
          treeNode("synergy under level", "cai_construction_system_synergies_tables"),
        ]),
        treeNode("first synergy", "cai_construction_system_synergies_tables"),
      ]),
    ]);

    expect(
      getDBCloneInitialSelectedNodeNames(
        tree,
        ["building_levels_tables", "cai_construction_system_synergies_tables"],
        BUILDINGS_CULTURE_VARIANT_PRESELECT_ALL_TABLES,
      ),
    ).toEqual(["culture variant", "first level", "first synergy", "synergy under level"]);
  });

  it("returns the ancestor path needed to reveal a selected node", () => {
    const tree = treeNode("tree", "", [
      treeNode("culture variant", "building_culture_variants_tables", [
        treeNode("first level", "building_levels_tables", [treeNode("first chain", "building_chains_tables")]),
      ]),
    ]);

    expect(getDBCloneExpandedNodeNamesForSelection(tree, ["first chain"])).toEqual([
      "culture variant",
      "first level",
      "first chain",
    ]);
  });

  it("keeps the building culture variant defaults in the requested order", () => {
    expect(BUILDINGS_CULTURE_VARIANT_PRESELECT_TABLES).toEqual([
      "building_levels_tables",
      "building_chains_tables",
      "building_chain_availability_sets_tables",
      "building_chain_set_items_tables",
      "building_set_to_building_junctions_tables",
      "building_instances_tables",
      "building_effects_junction_tables",
      "building_units_allowed_tables",
      "building_upgrades_junction_tables",
      "building_level_armed_citizenry_junctions_tables",
      "cai_construction_system_synergies_tables",
      "cai_construction_system_building_values_tables",
      "building_superchains_tables",
      "effect_bonus_value_building_chain_junctions_tables",
      "cai_construction_system_unblocking_buildings_tables",
    ]);
    expect(BUILDINGS_CULTURE_VARIANT_PRESELECT_ALL_TABLES).toEqual(["cai_construction_system_synergies_tables"]);
  });

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
