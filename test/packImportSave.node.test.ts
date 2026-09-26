import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => value,
}));

import appData from "../src/appData";
import { readPack, writePack } from "../src/packFileSerializer";
import { buildImportedPackedFile } from "../src/utility/packImportStaging";
import { LocVersion, type DBVersion } from "../src/packFileTypes";
import { DBNameToDBVersions } from "../src/schema";

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const field = (name: string, field_type: DBVersion["fields"][number]["field_type"], is_key = false) => ({
  name,
  field_type,
  default_value: "",
  is_key,
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const schema: DBVersion = {
  version: 3,
  fields: [field("key", "StringU8", true), field("amount", "I32"), field("enabled", "Boolean")],
};

describe("importing an RPFM TSV and saving the pack", () => {
  /**
   * Both save handlers flatten an unsaved file with `file.buffer || Buffer.from(file.text || "")`
   * and drop schemaFields, so a staged table that carries only parsed rows is written out as a
   * zero-byte file. Staging has to serialize the payload up front.
   */
  it("writes the imported table's rows, not an empty file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-import-save-"));
    temporaryFolders.push(root);
    const packPath = path.join(root, "Imported.pack");

    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    const previousSchemas = DBNameToDBVersions.wh3.example_tables;
    DBNameToDBVersions.wh3.example_tables = [schema];
    try {
      const tsv = [
        "key\tamount\tenabled",
        "#example_tables;3;db/example_tables/data__",
        "unit_a\t17\ttrue",
        "unit_b\t4\tfalse",
      ].join("\n");

      // The same helper applyPackImportFromDisk stages with.
      const staged = buildImportedPackedFile(
        { diskPath: "data__.tsv", packFilePath: "db\\example_tables\\data__", isRpfmTsv: true },
        Buffer.from(tsv, "utf8"),
        { example_tables: [schema] },
        () => undefined,
      );

      // What savePackWithUnsavedFiles / savePackAsWithUnsavedFiles then write.
      const buffer = staged.buffer || Buffer.from(staged.text || "");
      expect(buffer.length).toBeGreaterThan(0);
      await writePack([{ name: staged.name, buffer, file_size: buffer.length }], packPath);

      const saved = await readPack(packPath, { tablesToRead: ["db\\example_tables"] });
      const savedTable = saved.packedFiles.find((packedFile) => packedFile.name === "db\\example_tables\\data__");
      expect(savedTable?.file_size).toBeGreaterThan(0);
      expect(savedTable?.version).toBe(3);
      expect(savedTable?.schemaFields?.map((cell) => cell.fields.at(-1)?.val)).toEqual([
        "unit_a",
        17,
        1,
        "unit_b",
        4,
        0,
      ]);
    } finally {
      appData.currentGame = previousGame;
      if (previousSchemas) DBNameToDBVersions.wh3.example_tables = previousSchemas;
      else delete DBNameToDBVersions.wh3.example_tables;
    }
  });

  /**
   * readPack's loc pass and serializePackFileDataToBuffer both match ".loc" case-sensitively, while
   * the import pipeline recognises locs case-insensitively. An uppercase target therefore used to be
   * written with a DB table header and could never be read back.
   */
  it("normalizes an uppercase .LOC target so it is written as a loc", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-import-loc-"));
    temporaryFolders.push(root);
    const packPath = path.join(root, "Loc.pack");

    const previousGame = appData.currentGame;
    appData.currentGame = "wh3";
    try {
      const tsv = ["key\ttext\ttooltip", "#Loc;1;text/db/mymod.LOC", "greeting\tHello\tfalse"].join("\n");
      const staged = buildImportedPackedFile(
        { diskPath: "mymod.LOC.tsv", packFilePath: "text\\db\\mymod.LOC", isRpfmTsv: true },
        Buffer.from(tsv, "utf8"),
        {},
        () => undefined,
      );

      expect(staged.name).toBe("text\\db\\mymod.loc");
      expect(staged.tableSchema).toBe(LocVersion);
      // The LOC preamble: BOM, "LOC", a null, then the loc version.
      expect(staged.buffer?.subarray(0, 6).toString("hex")).toBe("fffe4c4f4300");

      const buffer = staged.buffer || Buffer.from(staged.text || "");
      await writePack([{ name: staged.name, buffer, file_size: buffer.length }], packPath);

      const saved = await readPack(packPath, { readLocs: true });
      const savedLoc = saved.packedFiles.find((packedFile) => packedFile.name === "text\\db\\mymod.loc");
      expect(savedLoc?.schemaFields?.map((cell) => cell.fields.at(-1)?.val)).toEqual(["greeting", "Hello", 0]);
    } finally {
      appData.currentGame = previousGame;
    }
  });

  it("rejects a Loc TSV whose metadata path is not a .loc file", () => {
    const tsv = ["key\ttext\ttooltip", "#Loc;1;text/db/mymod", "greeting\tHello\tfalse"].join("\n");
    expect(() =>
      buildImportedPackedFile(
        { diskPath: "mymod.tsv", packFilePath: "text\\db\\mymod", isRpfmTsv: true },
        Buffer.from(tsv, "utf8"),
        {},
        () => undefined,
      ),
    ).toThrow(/does not name a \.loc file/);
  });
});
