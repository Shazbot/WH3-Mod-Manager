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
  decodeUnitPainterProjectDecalSource,
  decodeUnitPainterProjectTiles,
  UNIT_PAINTER_PROJECT_TILE_BYTES,
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

  it("stores sparse layer tiles and metadata in the pack", async () => {
    const root = await makeTempDirectory();
    const packPath = nodePath.join(root, "editable.pack");
    const sourceVmd = "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition";
    const tileA = new Uint8Array(UNIT_PAINTER_PROJECT_TILE_BYTES);
    const tileB = new Uint8Array(UNIT_PAINTER_PROJECT_TILE_BYTES);
    tileA[0] = 123;
    tileA[3] = 255;
    tileB[4] = 77;
    tileB[7] = 255;

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
              width: 4096,
              height: 4096,
              tiles: [
                { key: 65, rgbaBytes: tileB },
                { key: 0, rgbaBytes: tileA },
              ],
            }],
          },
        ],
      },
    );

    const manifestFile = projectFiles.find((file) => file.name === UNIT_PAINTER_PROJECT_MANIFEST_PATH);
    expect(manifestFile?.buffer).toBeDefined();
    const manifest = parseUnitPainterProjectManifest(manifestFile!.buffer!);
    expect(manifest.formatVersion).toBe(3);
    expect(manifest.sourceVariantMeshDefinition).toBe(sourceVmd);
    expect(manifest.variantSelections).toEqual([{ slotPath: "body", choiceIndex: 2 }]);
    expect(manifest.activeLayerId).toBe("layer-2");
    expect(manifest.usedColorHistory).toEqual(["#aabbcc", "#112233"]);
    expect(manifest.selectedColor).toBe("#445566");
    expect(manifest.layers[1].textures[0].tileKeys).toEqual([0, 65]);
    expect(manifest.layers[1].textures[0].tileSize).toBe(64);

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
      const savedTiles = saved.packedFiles.find((file) => file.name === storedTexture.filePath)?.buffer;
      expect(parseUnitPainterProjectManifest(savedManifest!)).toEqual(manifest);

      const decoded = await decodeUnitPainterProjectTiles(savedTiles!, 2);
      expect(decoded.length).toBe(UNIT_PAINTER_PROJECT_TILE_BYTES * 2);
      expect(decoded[0]).toBe(123);
      expect(decoded[3]).toBe(255);
      expect(decoded[UNIT_PAINTER_PROJECT_TILE_BYTES + 4]).toBe(77);
      expect(decoded[UNIT_PAINTER_PROJECT_TILE_BYTES + 7]).toBe(255);
    } finally {
      appData.currentGame = previousGame;
    }
  });

  it("stores decal source pixels and normal-map binding in the editable project", async () => {
    const decalBytes = new Uint8Array(4 * 3 * 4);
    for (let index = 0; index < decalBytes.length; index += 4) {
      decalBytes[index] = 220;
      decalBytes[index + 1] = 180;
      decalBytes[index + 2] = 40;
      decalBytes[index + 3] = 255;
    }

    const files = await buildUnitPainterProjectPackFiles(
      "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
      [],
      {
        activeLayerId: "layer-2",
        layers: [
          { id: "layer-1", name: "Paint 1", visible: true, opacity: 1, textures: [] },
          {
            id: "layer-2",
            name: "Eagle",
            visible: true,
            opacity: 0.8,
            kind: "decal",
            textures: [],
            decal: {
              targetSourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
              normalSourceVirtualPath: "variantmeshes\\unit\\body_normal.dds",
              sourceName: "eagle.png",
              sourceWidth: 4,
              sourceHeight: 3,
              sourceRgbaBytes: decalBytes,
              centerU: 0.5,
              centerV: 0.4,
              widthU: 0.2,
              heightV: 0.15,
              rotationDeg: 25,
              tintEnabled: true,
              tint: { r: 180, g: 20, b: 30 },
              affectNormal: true,
              normalStrength: 1.5,
              normalHeightSource: "alpha",
            },
          },
        ],
      },
    );

    const manifestFile = files.find((file) => file.name === UNIT_PAINTER_PROJECT_MANIFEST_PATH);
    const manifest = parseUnitPainterProjectManifest(manifestFile!.buffer!);
    const decal = manifest.layers[1].decal;
    expect(manifest.layers[1].kind).toBe("decal");
    expect(decal?.normalSourceVirtualPath).toBe("variantmeshes\\unit\\body_normal.dds");
    expect(decal?.sourceName).toBe("eagle.png");
    expect(decal?.filePath).toMatch(/decal\.rgba\.zst$/i);

    const payload = files.find((file) => file.name === decal?.filePath)?.buffer;
    expect(payload).toBeDefined();
    const decoded = await decodeUnitPainterProjectDecalSource(payload!, 4, 3);
    expect(new Uint8Array(decoded)).toEqual(decalBytes);
  });

  it("supports a project with empty paint layers", async () => {
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
    expect(manifest.formatVersion).toBe(3);
    expect(manifest.layers).toHaveLength(1);
    expect(manifest.layers[0].textures).toEqual([]);
  });

  it("rejects old painter project formats instead of carrying compatibility code", () => {
    for (const formatVersion of [1, 2]) {
      expect(() =>
        parseUnitPainterProjectManifest(
          Buffer.from(JSON.stringify({
            formatVersion,
            sourceVariantMeshDefinition: "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
            variantSelections: [],
            activeLayerId: "layer-1",
            layers: [
              { id: "layer-1", name: "Paint 1", visible: true, opacity: 1, textures: [] },
            ],
          })),
        ),
      ).toThrow(/expected version 3/i);
    }
  });

  it("rejects malformed tile metadata", () => {
    expect(() =>
      parseUnitPainterProjectManifest(
        Buffer.from(JSON.stringify({
          formatVersion: 3,
          sourceVariantMeshDefinition: "variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition",
          variantSelections: [],
          activeLayerId: "layer-1",
          layers: [{
            id: "layer-1",
            name: "Paint 1",
            visible: true,
            opacity: 1,
            textures: [{
              sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
              width: 4096,
              height: 4096,
              tileSize: 64,
              tileKeys: [0, 0],
              filePath: "whmm_unit_painter\\layers\\01_layer-1\\textures\\001.tiles.zst",
              encoding: "zstd",
            }],
          }],
        })),
      ),
    ).toThrow(/tile/i);
  });

  it("rejects malformed optional painter color metadata", () => {
    expect(() =>
      parseUnitPainterProjectManifest(
        Buffer.from(JSON.stringify({
          formatVersion: 3,
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

});
