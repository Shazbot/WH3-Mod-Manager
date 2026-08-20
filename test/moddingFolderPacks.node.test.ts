import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => value,
}));

import appData from "../src/appData";
import { readPack, writePack } from "../src/packFileSerializer";
import { createModdingFolderPacks, replaceEnabledModsWithGeneratedPacks } from "../src/moddingFolderPacks";
import type { DBVersion, NewPackedFile } from "../src/packFileTypes";
import { DBNameToDBVersions } from "../src/schema";

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const rawPackFile = (name: string, value: string) => ({
  name,
  buffer: Buffer.from(value),
  file_size: Buffer.byteLength(value),
});

const enabledMod = (packPath: string): Mod => ({
  humanName: "Base mod",
  name: "base.pack",
  path: packPath,
  imgPath: "",
  workshopId: "",
  isEnabled: true,
  modDirectory: path.dirname(packPath),
  isInData: true,
  loadOrder: 0,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 0,
  isSymbolicLink: false,
  tags: ["mod"],
  sourceId: "data",
  sourceKind: "data",
});

const noTableSchemas = async () => ({});

describe("modding folder pack generation", () => {
  it("packs a folder's recursive contents under the folder name", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-modding-packs-"));
    temporaryFolders.push(root);
    const moddingPath = path.join(root, "data", "modding");
    const folderPath = path.join(moddingPath, "LooseMod");
    const outputPath = path.join(root, "whmm_modding");
    await mkdir(path.join(folderPath, "script"), { recursive: true });
    await mkdir(path.join(folderPath, "whmm_backups"));
    await writeFile(path.join(folderPath, "script", "main.lua"), "return 7");
    await writeFile(path.join(folderPath, "whmm_backups", "ignored.lua"), "ignored");

    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    try {
      const [result] = await createModdingFolderPacks(moddingPath, outputPath, [], readPack, writePack, noTableSchemas);

      expect(result.packName).toBe("LooseMod.pack");
      expect(result.packPath).toBe(path.join(outputPath, "LooseMod.pack"));
      const generated = await readPack(result.packPath, {
        filesToRead: ["script\\main.lua", "whmm_backups\\ignored.lua"],
        skipParsingTables: true,
      });
      expect(generated.packedFiles.map((file) => file.name)).toEqual(["script\\main.lua"]);
      expect(generated.packedFiles[0].buffer).toEqual(Buffer.from("return 7"));
      await expect(readFile(result.packPath)).resolves.toBeTruthy();
    } finally {
      appData.currentGame = previousGame;
    }
  });

  it("merges folder files over an enabled same-named pack", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-modding-packs-"));
    temporaryFolders.push(root);
    const sourcePath = path.join(root, "base.pack");
    const moddingPath = path.join(root, "data", "modding");
    const folderPath = path.join(moddingPath, "base");
    const outputPath = path.join(root, "whmm_modding");
    await mkdir(folderPath, { recursive: true });
    await mkdir(path.join(folderPath, "script"), { recursive: true });
    await writeFile(path.join(folderPath, "script", "shared.lua"), "folder version");

    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    try {
      await writePack(
        [rawPackFile("script\\shared.lua", "enabled version"), rawPackFile("script\\keep.lua", "keep me")],
        sourcePath,
      );
      const sourceMod = enabledMod(sourcePath);
      const [result] = await createModdingFolderPacks(
        moddingPath,
        outputPath,
        [sourceMod],
        readPack,
        writePack,
        noTableSchemas,
      );

      expect(result.sourceMod).toBe(sourceMod);
      const generated = await readPack(result.packPath, {
        filesToRead: ["script\\shared.lua", "script\\keep.lua"],
        skipParsingTables: true,
      });
      const filesByName = new Map(generated.packedFiles.map((file) => [file.name, file]));
      expect(filesByName.get("script\\shared.lua")?.buffer).toEqual(Buffer.from("folder version"));
      expect(filesByName.get("script\\keep.lua")?.buffer).toEqual(Buffer.from("keep me"));
    } finally {
      appData.currentGame = previousGame;
    }
  });

  it("replaces an enabled source mod with the generated pack and keeps standalone packs enabled", () => {
    const original = enabledMod("/game/data/modding/base.pack");
    const generated = { ...original, path: "/game/whmm_modding/base.pack", modDirectory: "/game/whmm_modding" };
    const standalone = { ...original, name: "LooseMod.pack", path: "/game/whmm_modding/LooseMod.pack" };

    expect(replaceEnabledModsWithGeneratedPacks([original], [generated, standalone])).toEqual([generated, standalone]);
  });

  it("converts reordered RPFM TSV columns into a schema-ordered packed DB file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-modding-packs-"));
    temporaryFolders.push(root);
    const moddingPath = path.join(root, "data", "modding");
    const folderPath = path.join(moddingPath, "TsvMod");
    const outputPath = path.join(root, "whmm_modding");
    await mkdir(path.join(folderPath, "db", "example_tables"), { recursive: true });
    await writeFile(
      path.join(folderPath, "db", "example_tables", "data__.tsv"),
      ["enabled\tkey\tamount", "#example_tables;3;db/example_tables/data__", "true\tunit_a\t17"].join("\n"),
    );

    const schema: DBVersion = {
      version: 3,
      fields: [
        {
          name: "key",
          field_type: "StringU8",
          default_value: "",
          is_key: true,
          is_filename: false,
          is_reference: [],
          description: "",
          ca_order: 0,
          is_bitwise: 0,
          enum_values: {},
        },
        {
          name: "amount",
          field_type: "I32",
          default_value: "0",
          is_key: false,
          is_filename: false,
          is_reference: [],
          description: "",
          ca_order: 0,
          is_bitwise: 0,
          enum_values: {},
        },
        {
          name: "enabled",
          field_type: "Boolean",
          default_value: "false",
          is_key: false,
          is_filename: false,
          is_reference: [],
          description: "",
          ca_order: 0,
          is_bitwise: 0,
          enum_values: {},
        },
      ],
    };

    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    const previousSchemas = DBNameToDBVersions.wh3.example_tables;
    DBNameToDBVersions.wh3.example_tables = [schema];
    try {
      const writtenFiles: NewPackedFile[] = [];
      const [result] = await createModdingFolderPacks(
        moddingPath,
        outputPath,
        [],
        readPack,
        async (files) => {
          writtenFiles.push(...files);
          await writePack(files, path.join(outputPath, "TsvMod.pack"));
        },
        async () => ({ example_tables: [schema] }),
      );

      expect(result.packName).toBe("TsvMod.pack");
      expect(writtenFiles).toHaveLength(1);
      expect(writtenFiles[0]).toMatchObject({
        name: "db\\example_tables\\data__",
        version: 3,
        tableSchema: schema,
      });
      const schemaFields = writtenFiles[0].schemaFields ?? [];
      expect(schemaFields).toHaveLength(3);
      expect(schemaFields[0].fields[1]?.val).toBe("unit_a");
      expect(schemaFields[1].fields[0]?.val).toBe(17);
      expect(schemaFields[2].fields[0]?.val).toBe(1);

      const generated = await readPack(result.packPath, {
        tablesToRead: ["db\\example_tables"],
      });
      expect(generated.packedFiles[0].version).toBe(3);
      expect(generated.packedFiles[0].schemaFields?.[0].fields[1]?.val).toBe("unit_a");
      expect(generated.packedFiles[0].schemaFields?.[1].fields[0]?.val).toBe(17);
      expect(generated.packedFiles[0].schemaFields?.[2].fields[0]?.val).toBe(1);
    } finally {
      appData.currentGame = previousGame;
      if (previousSchemas) DBNameToDBVersions.wh3.example_tables = previousSchemas;
      else delete DBNameToDBVersions.wh3.example_tables;
    }
  });
});
