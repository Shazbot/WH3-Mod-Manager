import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => value,
}));

import appData from "../src/appData";
import { readPack, writePack } from "../src/packFileSerializer";
import {
  buildUnitPainterPackFiles,
  ensureUnitPainterPackExtension,
  getUnitPainterDefaultPackName,
  getUnitPainterNamespaceName,
  buildUnitPainterProjectPackFiles,
  decodeUnitPainterProjectTexture,
  parseUnitPainterProjectManifest,
  UNIT_PAINTER_PROJECT_MANIFEST_PATH,
} from "../src/visuals/unitPainterPack";

const tempDirectories: string[] = [];

const makeTempDirectory = async () => {
  const directory = await fs.mkdtemp(nodePath.join(os.tmpdir(), "whmm-unit-painter-pack-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("unit painter pack staging", () => {
  it("uses a friendly default pack name and .pack extension", () => {
    expect(
      getUnitPainterDefaultPackName(
        "variantmeshes\\variantmeshdefinitions\\wh_variantmodels\\hu3\\dwf\\dwf_belegar.variantmeshdefinition",
      ),
    ).toBe("dwf_belegar_painted.pack");
    expect(ensureUnitPainterPackExtension("C:\\mods\\red_belegar")).toBe("C:\\mods\\red_belegar.pack");
    expect(ensureUnitPainterPackExtension("C:\\mods\\red_belegar.PACK")).toBe("C:\\mods\\red_belegar.PACK");
    expect(getUnitPainterNamespaceName("C:\\mods\\Red Belegar.pack", "ignored.variantmeshdefinition")).toBe(
      "red_belegar",
    );
  });

  it("packs generated game assets and requires the original VMD override path", async () => {
    const root = await makeTempDirectory();
    const vmdPath =
      "variantmeshes\\variantmeshdefinitions\\wh_variantmodels\\hu3\\dwf\\dwf_belegar.variantmeshdefinition";
    const wsModelPath = "variantmeshes\\whmm_unit_painter\\red_belegar\\models\\001_torso.wsmodel";
    const materialPath = "variantmeshes\\whmm_unit_painter\\red_belegar\\materials\\torso.xml.material";
    const texturePath = "variantmeshes\\whmm_unit_painter\\red_belegar\\textures\\torso_painted.dds";
    const manifestPath = "whmm_unit_painter_manifest_red_belegar.json";

    for (const [virtualPath, bytes] of [
      [vmdPath, Buffer.from("<VARIANT_MESH />")],
      [wsModelPath, Buffer.from("<model />")],
      [materialPath, Buffer.from("<material />")],
      [texturePath, Buffer.from([0x44, 0x44, 0x53, 0x20])],
      [manifestPath, Buffer.from("{}")],
    ] as const) {
      const fullPath = nodePath.join(root, ...virtualPath.split("\\"));
      await fs.mkdir(nodePath.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, bytes);
    }

    const packedFiles = await buildUnitPainterPackFiles(
      root,
      [vmdPath, wsModelPath, materialPath, texturePath, manifestPath],
      vmdPath,
    );

    expect(packedFiles.map((file) => file.name)).toEqual([vmdPath, wsModelPath, materialPath, texturePath]);
    expect(packedFiles.some((file) => file.name === manifestPath)).toBe(false);
    expect(packedFiles.find((file) => file.name === vmdPath)?.buffer?.toString()).toBe("<VARIANT_MESH />");
  });

  it("writes a WH3 pack containing the source VMD override and generated assets", async () => {
    const root = await makeTempDirectory();
    const generated = nodePath.join(root, "generated");
    const packPath = nodePath.join(root, "belegar_painted.pack");
    const vmdPath =
      "variantmeshes\\variantmeshdefinitions\\wh_variantmodels\\hu3\\dwf\\dwf_belegar.variantmeshdefinition";
    const wsModelPath = "variantmeshes\\whmm_unit_painter\\belegar_painted\\models\\001_torso.wsmodel";
    const texturePath = "variantmeshes\\whmm_unit_painter\\belegar_painted\\textures\\torso_painted.dds";

    for (const [virtualPath, bytes] of [
      [vmdPath, Buffer.from("<VARIANT_MESH />")],
      [wsModelPath, Buffer.from("<model />")],
      [texturePath, Buffer.from([0x44, 0x44, 0x53, 0x20])],
    ] as const) {
      const fullPath = nodePath.join(generated, ...virtualPath.split("\\"));
      await fs.mkdir(nodePath.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, bytes);
    }

    const packFiles = await buildUnitPainterPackFiles(
      generated,
      [vmdPath, wsModelPath, texturePath],
      vmdPath,
    );

    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    try {
      await writePack(packFiles, packPath);
      const saved = await readPack(packPath, { skipParsingTables: true, skipSorting: true });
      expect(saved.packedFiles.map((file) => file.name).toSorted()).toEqual(
        [vmdPath, wsModelPath, texturePath].toSorted(),
      );
      expect(saved.packedFiles.some((file) => file.name === vmdPath)).toBe(true);
    } finally {
      appData.currentGame = previousGame;
    }
  });

  it("rejects a generated export that does not override the source VMD", async () => {
    const root = await makeTempDirectory();
    const oldGeneratedPath =
      "variantmeshes\\variantmeshdefinitions\\whmm_unit_painter\\belegar_painted.variantmeshdefinition";
    const fullPath = nodePath.join(root, ...oldGeneratedPath.split("\\"));
    await fs.mkdir(nodePath.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, "<VARIANT_MESH />");

    await expect(
      buildUnitPainterPackFiles(
        root,
        [oldGeneratedPath],
        "variantmeshes\\variantmeshdefinitions\\wh_variantmodels\\hu3\\dwf\\dwf_belegar.variantmeshdefinition",
      ),
    ).rejects.toThrow(/source VariantMeshDefinition override/i);
  });

  it("rejects generated paths that escape staging", async () => {
    const root = await makeTempDirectory();
    await expect(
      buildUnitPainterPackFiles(
        root,
        ["..\\outside.dds"],
        "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
      ),
    ).rejects.toThrow(/unsafe generated file path/i);
  });

  it("stores versioned editable layer metadata and compressed layer snapshots in the pack", async () => {
    const root = await makeTempDirectory();
    const packPath = nodePath.join(root, "editable.pack");
    const sourceVmd = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
    const rgba = new Uint8Array(4 * 4 * 4);
    rgba[0] = 123;
    rgba[3] = 255;

    const projectFiles = await buildUnitPainterProjectPackFiles(
      sourceVmd,
      [{ slotPath: "body", choiceIndex: 2 }],
      {
        activeLayerId: "layer-2",
        usedColorHistory: ["#AABBCC", "#112233", "#aabbcc"],
        selectedColor: "#445566",
        layers: [
          { id: "layer-1", name: "Cloth", visible: true, opacity: 0.5, textures: [] },
          {
            id: "layer-2",
            name: "Trim",
            visible: false,
            opacity: 1,
            textures: [{
              sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
              width: 4,
              height: 4,
              rgbaBytes: rgba,
            }],
          },
        ],
      },
    );
    const manifestFile = projectFiles.find((file) => file.name === UNIT_PAINTER_PROJECT_MANIFEST_PATH);
    expect(manifestFile?.buffer).toBeDefined();
    const manifest = parseUnitPainterProjectManifest(manifestFile!.buffer!);
    expect(manifest.formatVersion).toBe(2);
    if (manifest.formatVersion !== 2) throw new Error("Expected painter project format v2.");
    expect(manifest.sourceVariantMeshDefinition).toBe(sourceVmd);
    expect(manifest.variantSelections).toEqual([{ slotPath: "body", choiceIndex: 2 }]);
    expect(manifest.activeLayerId).toBe("layer-2");
    expect(manifest.usedColorHistory).toEqual(["#aabbcc", "#112233"]);
    expect(manifest.selectedColor).toBe("#445566");
    expect(manifest.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      textures: layer.textures.length,
    }))).toEqual([
      { id: "layer-1", name: "Cloth", visible: true, opacity: 0.5, textures: 0 },
      { id: "layer-2", name: "Trim", visible: false, opacity: 1, textures: 1 },
    ]);

    const storedTexture = manifest.layers[1].textures[0];
    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    try {
      await writePack(projectFiles, packPath);
      const saved = await readPack(packPath, {
        skipParsingTables: true,
        filesToRead: [UNIT_PAINTER_PROJECT_MANIFEST_PATH, storedTexture.filePath],
      });
      const savedManifest = saved.packedFiles.find((file) => file.name === UNIT_PAINTER_PROJECT_MANIFEST_PATH)?.buffer;
      const savedRgba = saved.packedFiles.find((file) => file.name === storedTexture.filePath)?.buffer;
      expect(parseUnitPainterProjectManifest(savedManifest!)).toEqual(manifest);
      const decoded = await decodeUnitPainterProjectTexture(savedRgba!, rgba.length);
      expect(decoded[0]).toBe(123);
      expect(decoded[3]).toBe(255);
      expect(decoded.length).toBe(rgba.length);
    } finally {
      appData.currentGame = previousGame;
    }
  });

  it("supports a reset-to-original v2 project with empty paint layers", async () => {
    const files = await buildUnitPainterProjectPackFiles(
      "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
      [],
      {
        activeLayerId: "layer-1",
        layers: [{ id: "layer-1", name: "Paint 1", visible: true, opacity: 1, textures: [] }],
      },
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(UNIT_PAINTER_PROJECT_MANIFEST_PATH);
    const manifest = parseUnitPainterProjectManifest(files[0].buffer!);
    expect(manifest.formatVersion).toBe(2);
    if (manifest.formatVersion !== 2) throw new Error("Expected painter project format v2.");
    expect(manifest.layers).toHaveLength(1);
    expect(manifest.layers[0].textures).toEqual([]);
  });

  it("keeps older v2 painter manifests valid when color metadata is absent", () => {
    const manifest = parseUnitPainterProjectManifest(
      Buffer.from(JSON.stringify({
        formatVersion: 2,
        sourceVariantMeshDefinition: "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
        variantSelections: [],
        activeLayerId: "layer-1",
        layers: [
          { id: "layer-1", name: "Paint 1", visible: true, opacity: 1, textures: [] },
        ],
      })),
    );
    expect(manifest.formatVersion).toBe(2);
    if (manifest.formatVersion !== 2) throw new Error("Expected painter project format v2.");
    expect(manifest.usedColorHistory).toBeUndefined();
    expect(manifest.selectedColor).toBeUndefined();
  });

  it("rejects malformed optional painter color metadata", () => {
    expect(() =>
      parseUnitPainterProjectManifest(
        Buffer.from(JSON.stringify({
          formatVersion: 2,
          sourceVariantMeshDefinition: "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
          variantSelections: [],
          activeLayerId: "layer-1",
          usedColorHistory: ["#123456", "not-a-color"],
          selectedColor: "#abcdef",
          layers: [
            { id: "layer-1", name: "Paint 1", visible: true, opacity: 1, textures: [] },
          ],
        })),
      ),
    ).toThrow(/used color/i);
  });

  it("continues to parse v1 painter manifests for backward compatibility", () => {
    const manifest = parseUnitPainterProjectManifest(
      Buffer.from(JSON.stringify({
        formatVersion: 1,
        sourceVariantMeshDefinition: "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
        variantSelections: [{ slotPath: "body", choiceIndex: 1 }],
        paintedTextures: [{
          sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
          width: 4,
          height: 4,
          filePath: "whmm_unit_painter\\textures\\001.rgba.zst",
          encoding: "zstd",
        }],
      })),
    );
    expect(manifest.formatVersion).toBe(1);
    if (manifest.formatVersion !== 1) throw new Error("Expected painter project format v1.");
    expect(manifest.paintedTextures).toHaveLength(1);
  });

});
