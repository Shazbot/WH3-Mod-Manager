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
});
