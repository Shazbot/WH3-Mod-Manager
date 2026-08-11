import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({ default: false }));

import appData from "../src/appData";
import {
  appendToFileToFileRegistry,
  emptyPackFileToFileReferences,
  findMissingFileReferences,
} from "../src/modCompat/fileToFileReferences";
import {
  findPackFileCollisions,
  findPackFileCollisionsBetweenPacksOptimized,
} from "../src/modCompat/packFileCollisions";
import {
  findPackTableCollisions,
  findPackTableCollisionsBetweenPacks,
} from "../src/modCompat/packTableCollisions";
import type { Pack, PackFileCollision, PackTableCollision, PackedFile } from "../src/packFileTypes";
import { DBNameToDBVersions } from "../src/schema";

const tableSchema = {
  version: 0,
  fields: [
    {
      name: "key",
      field_type: "StringU8",
      is_key: true,
      default_value: "",
      is_filename: false,
      is_reference: [],
      description: "",
      ca_order: 0,
      is_bitwise: 0,
      enum_values: {},
    },
  ],
};
const file = (name: string, fileSize = 1): PackedFile =>
  ({ name, file_size: fileSize, start_pos: 0 }) as PackedFile;
const tableFile = (name: string, ...keys: string[]): PackedFile =>
  ({
    ...file(name),
    version: 0,
    tableSchema,
    schemaFields: keys.map((key) => ({
      type: "StringU8",
      isKey: true,
      fields: [{ type: "String", val: key }],
    })),
  }) as PackedFile;
const pack = (name: string, packedFiles: PackedFile[]): Pack =>
  ({ name, path: `/mods/${name}`, packedFiles, readTables: "all" }) as Pack;
const canonical = <T extends object>(values: T[]) =>
  values
    .map((value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .sort();

afterEach(() => emptyPackFileToFileReferences());

describe("indexed compatibility algorithms", () => {
  it("matches pairwise file collision results while reporting progress once per pack", () => {
    const packs = [
      pack("a.pack", [file("a"), file("shared", 4)]),
      pack("b.pack", [file("b"), file("shared", 4)]),
      pack("c.pack", [file("c"), file("shared", 8)]),
    ];
    const pairwise: PackFileCollision[] = [];
    for (let first = 0; first < packs.length; first++) {
      for (let second = first + 1; second < packs.length; second++) {
        findPackFileCollisionsBetweenPacksOptimized(packs[first], packs[second], pairwise);
      }
    }
    const progress = vi.fn();

    const indexed = findPackFileCollisions(packs, progress);

    expect(canonical(indexed)).toEqual(canonical(pairwise));
    expect(progress).toHaveBeenCalledTimes(packs.length);
  });

  it("matches pairwise live-table key collisions and ignores spare table copies", () => {
    const originalGame = appData.currentGame;
    const originalVersions = DBNameToDBVersions.wh3.main_units_tables;
    appData.currentGame = "wh3";
    DBNameToDBVersions.wh3.main_units_tables = [tableSchema] as never;
    try {
      const packs = [
        pack("a.pack", [tableFile("db\\main_units_tables\\a", "one", "shared")]),
        pack("b.pack", [tableFile("db\\main_units_tables\\b", "shared")]),
        pack("c.pack", [
          tableFile("db\\main_units_tables\\c", "shared"),
          tableFile("unusedtables\\main_units_tables\\spare", "one"),
        ]),
      ];
      const pairwise: PackTableCollision[] = [];
      for (let first = 0; first < packs.length; first++) {
        for (let second = first + 1; second < packs.length; second++) {
          findPackTableCollisionsBetweenPacks(packs[first], packs[second], pairwise);
        }
      }

      const indexed = findPackTableCollisions(packs);

      expect(canonical(indexed)).toEqual(canonical(pairwise));
      expect(indexed.every((collision) => !collision.fileName.startsWith("unusedtables"))).toBe(true);
    } finally {
      appData.currentGame = originalGame;
      if (originalVersions) DBNameToDBVersions.wh3.main_units_tables = originalVersions;
      else delete DBNameToDBVersions.wh3.main_units_tables;
    }
  });

  it("resolves referenced files through one global, case-insensitive filename index", () => {
    const sourceFile = file("models\\source.xml");
    const sourcePack = pack("source.pack", [sourceFile]);
    const providerPack = pack("provider.pack", [file("SHARED\\Asset.PNG")]);
    appendToFileToFileRegistry(sourcePack, sourceFile, [
      "shared/asset.png",
      "missing/asset.png",
    ]);

    const missing = findMissingFileReferences([sourcePack, providerPack]);

    expect(missing["source.pack"][sourceFile.name].map((reference) => reference.reference)).toEqual([
      "missing\\asset.png",
    ]);
  });
});
