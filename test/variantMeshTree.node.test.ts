import { describe, expect, it } from "vitest";

import { buildVariantMeshCatalog, type VariantMeshCatalog } from "../src/visuals/variantMesh";
import {
  buildVariantMeshTree,
  getSelectionChainForChoice,
  isBindingHidden,
  showTreeItem,
  soloTreeItem,
} from "../src/visuals/variantMeshTree";

const catalog: VariantMeshCatalog = {
  assetPath: "root.variantmeshdefinition",
  combinationCount: 4,
  combinationCountCapped: false,
  diagnostics: [],
  slots: [
    {
      slotPath: "root/slot[0]",
      name: "helmet",
      label: "Helmet",
      choices: [
        { index: 0, key: "root/slot[0]/choice[0]", label: "Plain", kind: "inline" },
        { index: 1, key: "root/slot[0]/choice[1]", label: "Crested", kind: "inline" },
      ],
      defaultChoiceIndex: 0,
    },
    {
      slotPath: "root/slot[0]/choice[1]/slot[0]",
      name: "crest",
      label: "Crest",
      choices: [{ index: 0, key: "root/slot[0]/choice[1]/slot[0]/choice[0]", label: "Red", kind: "inline" }],
      defaultChoiceIndex: 0,
      parent: { slotPath: "root/slot[0]", choiceIndex: 1 },
    },
    {
      slotPath: "root/slot[1]",
      name: "weapon",
      label: "Weapon",
      choices: [
        {
          index: 0,
          key: "root/slot[1]/choice[0]",
          label: "weapon_1",
          kind: "reference",
          targetPath: "weapon_1.variantmeshdefinition",
        },
      ],
      defaultChoiceIndex: 0,
    },
  ],
};

describe("variant mesh tree", () => {
  it("nests child slots under their parent choice", () => {
    const tree = buildVariantMeshTree(catalog);
    expect(tree.map((slot) => slot.id)).toEqual(["root/slot[0]", "root/slot[1]"]);
    expect(tree[0].choices[0].children).toEqual([]);
    expect(tree[0].choices[1].children.map((slot) => slot.id)).toEqual(["root/slot[0]/choice[1]/slot[0]"]);
    expect(tree[1].choices[0].isReference).toBe(true);
    expect(tree[0].choices[0].isReference).toBe(false);
  });

  it("leaves out slots with no choices", () => {
    const tree = buildVariantMeshTree({
      ...catalog,
      slots: [
        ...catalog.slots,
        { slotPath: "root/slot[2]", name: "empty", label: "Empty", choices: [], defaultChoiceIndex: 0 },
        {
          slotPath: "root/slot[0]/choice[0]/slot[0]",
          name: "empty_child",
          label: "Empty child",
          choices: [],
          defaultChoiceIndex: 0,
          parent: { slotPath: "root/slot[0]", choiceIndex: 0 },
        },
      ],
    });
    expect(tree.map((slot) => slot.id)).toEqual(["root/slot[0]", "root/slot[1]"]);
    expect(tree[0].choices[0].children).toEqual([]);
  });

  it("builds from a real catalog with a referenced definition", async () => {
    const definitions: Record<string, string> = {
      "root.variantmeshdefinition": `<VARIANT_MESH><SLOT name="weapon"><VARIANT_MESH_REFERENCE definition="w.variantmeshdefinition" /></SLOT></VARIANT_MESH>`,
      "w.variantmeshdefinition": `<VARIANT_MESH><SLOT name="blade"><VARIANT_MESH model="a.rigid_model_v2" /><VARIANT_MESH model="b.rigid_model_v2" /></SLOT></VARIANT_MESH>`,
    };
    const built = await buildVariantMeshCatalog("root.variantmeshdefinition", async (path) => definitions[path.toLowerCase()]);
    const tree = buildVariantMeshTree(built);
    expect(tree).toHaveLength(1);
    expect(tree[0].choices[0].isReference).toBe(true);
    expect(tree[0].choices[0].children[0].choices).toHaveLength(2);
  });

  it("matches hidden bindings by exact id or path prefix only", () => {
    const hidden = ["root/slot[0]/choice[1]"];
    expect(isBindingHidden("root/slot[0]/choice[1]", hidden)).toBe(true);
    expect(isBindingHidden("root/slot[0]/choice[1]/slot[0]/choice[0]", hidden)).toBe(true);
    expect(isBindingHidden("root/slot[0]/choice[10]", hidden)).toBe(false);
    expect(isBindingHidden("root/slot[0]/choice[0]", hidden)).toBe(false);
    expect(isBindingHidden("root/slot[0]/choice[1]", [])).toBe(false);
  });

  it("solos an item with its ancestors and descendants, and restores on repeat", () => {
    const tree = buildVariantMeshTree(catalog);
    const id = "root/slot[0]/choice[1]";
    const solo = soloTreeItem(tree, id);
    expect(solo.sort()).toEqual(
      ["root/slot[0]/choice[0]", "root/slot[1]", "root/slot[1]/choice[0]"].sort(),
    );
    expect(soloTreeItem(tree, id, solo)).toEqual([]);
  });

  it("unhides hidden ancestors when showing a child, keeping its siblings hidden", () => {
    const tree = buildVariantMeshTree(catalog);
    const hidden = ["root/slot[0]", "root/slot[0]/choice[0]", "root/slot[0]/choice[1]", "root/slot[1]"];
    expect(showTreeItem(tree, "root/slot[0]/choice[1]", hidden).sort()).toEqual(
      ["root/slot[0]/choice[0]", "root/slot[1]"].sort(),
    );
    // Hidden only through its parent: the parent's other children become hidden instead.
    expect(showTreeItem(tree, "root/slot[0]/choice[1]/slot[0]", ["root/slot[0]"]).sort()).toEqual(
      ["root/slot[0]/choice[0]"].sort(),
    );
    expect(showTreeItem(tree, "root/slot[1]", hidden)).toEqual([
      "root/slot[0]",
      "root/slot[0]/choice[0]",
      "root/slot[0]/choice[1]",
    ]);
  });

  it("returns the choice plus ancestor selections", () => {
    expect(getSelectionChainForChoice(catalog, "root/slot[0]/choice[1]/slot[0]/choice[0]")).toEqual([
      { slotPath: "root/slot[0]", choiceIndex: 1 },
      { slotPath: "root/slot[0]/choice[1]/slot[0]", choiceIndex: 0 },
    ]);
    expect(getSelectionChainForChoice(catalog, "nope")).toEqual([]);
  });
});
