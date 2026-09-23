import { describe, expect, it, vi } from "vitest";

import {
  collectVisualDependencyClosure,
  getSupportedVisualReferences,
  getVisualMaterialFactionTextures,
  type ResolvedVisualDependency,
} from "../src/visuals/dependencies";

describe("Visuals isolated dependency extraction", () => {
  it("reads base-colour and faction-mask slots from xml.material", () => {
    expect(getVisualMaterialFactionTextures(`
      <material><textures>
        <texture><slot version="2">t_xml_base_colour</slot><source>VariantMeshes\\unit\\unit_base_colour.dds</source></texture>
        <texture><slot version="2">t_xml_mask</slot><source>VariantMeshes\\unit\\unit_mask.dds</source></texture>
      </textures></material>
    `)).toEqual({
      baseColourPath: "VariantMeshes\\unit\\unit_base_colour.dds",
      maskPath: "VariantMeshes\\unit\\unit_mask.dds",
    });
  });

  it("finds supported references in VMD, WSModel and material XML while ignoring unsupported assets", () => {
    const text = `
      <VARIANT_MESH model="models\\unit.wsmodel">
        <SLOT>
          <VARIANT_MESH_REFERENCE definition="shared.variantmeshdefinition" />
        </SLOT>
        <geometry>models\\unit.rigid_model_v2</geometry>
        <material>materials\\unit.xml.material</material>
        <source>textures\\unit.dds</source>
        <animation>animations\\unit.anim</animation>
      </VARIANT_MESH>
    `;

    expect(new Set(getSupportedVisualReferences(text))).toEqual(
      new Set([
        "models\\unit.wsmodel",
        "shared.variantmeshdefinition",
        "models\\unit.rigid_model_v2",
        "materials\\unit.xml.material",
        "textures\\unit.dds",
      ]),
    );
  });

  it("walks references recursively and deduplicates cycles", async () => {
    const rootPath = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
    const sharedPath = "variantmeshes\\variantmeshdefinitions\\shared.variantmeshdefinition";
    const assets = new Map<string, ResolvedVisualDependency>([
      [
        rootPath.toLowerCase(),
        {
          resolvedPath: rootPath,
          text: `
            <VARIANT_MESH model="models\\unit.wsmodel">
              <SLOT>
                <VARIANT_MESH_REFERENCE definition="shared.variantmeshdefinition" />
              </SLOT>
            </VARIANT_MESH>
          `,
        },
      ],
      [
        "models\\unit.wsmodel",
        {
          resolvedPath: "models\\unit.wsmodel",
          text: `
            <model>
              <geometry>models\\unit.rigid_model_v2</geometry>
              <material>materials\\unit.xml.material</material>
            </model>
          `,
        },
      ],
      [
        sharedPath.toLowerCase(),
        {
          resolvedPath: sharedPath,
          text: `<VARIANT_MESH model="models\\unit.wsmodel" />`,
        },
      ],
      [
        "models\\unit.rigid_model_v2",
        { resolvedPath: "models\\unit.rigid_model_v2" },
      ],
      [
        "materials\\unit.xml.material",
        {
          resolvedPath: "materials\\unit.xml.material",
          text: `
            <material>
              <source>textures\\unit_base_colour.dds</source>
              <source>commontextures\\default_black.dds</source>
              <shader>shaders\\weighted.fx</shader>
            </material>
          `,
        },
      ],
      [
        "textures\\unit_base_colour.dds",
        { resolvedPath: "textures\\unit_base_colour.dds" },
      ],
      [
        "commontextures\\default_black.dds",
        { resolvedPath: "commontextures\\default_black.dds" },
      ],
    ]);

    const readAsset = vi.fn(async (requestedPath: string) => {
      const key =
        requestedPath.toLowerCase() === "shared.variantmeshdefinition"
          ? sharedPath.toLowerCase()
          : requestedPath.toLowerCase();
      return assets.get(key);
    });

    const result = await collectVisualDependencyClosure(rootPath, readAsset);

    expect(result.missing).toEqual([]);
    expect(new Set(result.paths)).toEqual(
      new Set([
        rootPath,
        sharedPath,
        "models\\unit.wsmodel",
        "models\\unit.rigid_model_v2",
        "materials\\unit.xml.material",
        "textures\\unit_base_colour.dds",
        "commontextures\\default_black.dds",
      ]),
    );
    expect(result.paths.filter((path) => path === "models\\unit.wsmodel")).toHaveLength(1);
  });

  it("reports supported references that cannot be resolved", async () => {
    const rootPath = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
    const result = await collectVisualDependencyClosure(rootPath, async (requestedPath) => {
      if (requestedPath === rootPath) {
        return {
          resolvedPath: rootPath,
          text: `<VARIANT_MESH model="models\\missing.wsmodel" />`,
        };
      }
      return undefined;
    });

    expect(result.paths).toEqual([rootPath]);
    expect(result.missing).toEqual(["models\\missing.wsmodel"]);
  });
});
