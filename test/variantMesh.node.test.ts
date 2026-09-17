import { describe, expect, it } from "vitest";

import {
  buildVariantMeshCatalog,
  getActiveVariantMeshSlots,
  type VariantMeshCatalog,
} from "../src/visuals/variantMesh";

describe("variant mesh appearance catalogs", () => {
  it("keeps independent slots selectable across linked definitions", async () => {
    const definitions: Record<string, string> = {
      "variantmeshes\\variantmeshdefinitions\\engineer.variantmeshdefinition": `
        <VARIANT_MESH>
          <SLOT name="head">
            <VARIANT_MESH model="head_01.rigid_model_v2" />
            <VARIANT_MESH model="head_02.rigid_model_v2" />
            <VARIANT_MESH model="head_03.rigid_model_v2" />
            <VARIANT_MESH model="head_04.rigid_model_v2" />
            <VARIANT_MESH model="head_05.rigid_model_v2" />
          </SLOT>
          <SLOT name="body">
            <VARIANT_MESH model="body_01.rigid_model_v2" />
            <VARIANT_MESH model="body_02.rigid_model_v2" />
            <VARIANT_MESH model="body_03.rigid_model_v2" />
          </SLOT>
          <SLOT name="weapon_1">
            <VARIANT_MESH_REFERENCE definition="weapon_1.variantmeshdefinition" />
          </SLOT>
        </VARIANT_MESH>`,
      "weapon_1.variantmeshdefinition": `
        <VARIANT_MESH>
          <SLOT name="weapon">
            <VARIANT_MESH model="weapon_a.rigid_model_v2" />
            <VARIANT_MESH model="weapon_b.rigid_model_v2" />
          </SLOT>
        </VARIANT_MESH>`,
    };

    const catalog = await buildVariantMeshCatalog(
      "variantmeshes/variantmeshdefinitions/engineer.variantmeshdefinition",
      async (path) => definitions[path.toLowerCase()],
    );

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.combinationCount).toBe(30);
    expect(catalog.slots.map((slot) => slot.name)).toEqual(["head", "body", "weapon_1", "weapon"]);
    expect(catalog.slots.find((slot) => slot.name === "head")?.choices).toHaveLength(5);
    expect(catalog.slots.find((slot) => slot.name === "body")?.choices).toHaveLength(3);
    expect(catalog.slots.find((slot) => slot.name === "weapon")?.choices).toHaveLength(2);
  });

  it("hides nested choices from inactive parent branches", () => {
    const catalog: VariantMeshCatalog = {
      assetPath: "root.variantmeshdefinition",
      combinationCount: 2,
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
          choices: [{ index: 0, key: "crest/choice[0]", label: "Red", kind: "inline" }],
          defaultChoiceIndex: 0,
          parent: { slotPath: "root/slot[0]", choiceIndex: 1 },
        },
      ],
    };

    expect(getActiveVariantMeshSlots(catalog, { "root/slot[0]": 0 })).toHaveLength(1);
    expect(getActiveVariantMeshSlots(catalog, { "root/slot[0]": 1 })).toHaveLength(2);
  });

  it("reports cycles without recursing forever", async () => {
    const catalog = await buildVariantMeshCatalog("root.variantmeshdefinition", async (path) => {
      if (path.toLowerCase() === "root.variantmeshdefinition") {
        return `<VARIANT_MESH><SLOT name="child"><VARIANT_MESH_REFERENCE definition="child.variantmeshdefinition" /></SLOT></VARIANT_MESH>`;
      }
      return `<VARIANT_MESH><SLOT name="back"><VARIANT_MESH_REFERENCE definition="root.variantmeshdefinition" /></SLOT></VARIANT_MESH>`;
    });

    expect(catalog.diagnostics.some((diagnostic) => /cycle/i.test(diagnostic))).toBe(true);
    expect(catalog.slots[0]?.name).toBe("child");
  });
});
