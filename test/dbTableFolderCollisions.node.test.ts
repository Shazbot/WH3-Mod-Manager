import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

import appData from "../src/appData";
import { findPackTableCollisionsBetweenPacks } from "../src/modCompat/packTableCollisions";
import { DBNameToDBVersions } from "../src/schema";
import type { Pack, PackTableCollision, PackedFile } from "../src/packFileTypes";

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

const tableFile = (name: string, key: string): PackedFile =>
  ({
    name,
    file_size: 0,
    start_pos: 0,
    version: 0,
    tableSchema,
    schemaFields: [
      { name: "key", type: "StringU8", isKey: true, fields: [{ type: "String", val: key }], resolvedKeyValue: key },
    ],
  }) as unknown as PackedFile;

const pack = (name: string, packedFiles: PackedFile[]): Pack =>
  ({ name, path: `C:\\game\\data\\${name}`, packedFiles }) as unknown as Pack;

describe("collisions between packs", () => {
  const withSchema = (run: () => void) => {
    const originalGame = appData.currentGame;
    const originalVersions = DBNameToDBVersions.wh3.main_units_tables;
    appData.currentGame = "wh3";
    DBNameToDBVersions.wh3.main_units_tables = [tableSchema] as never;
    try {
      run();
    } finally {
      appData.currentGame = originalGame;
      if (originalVersions) DBNameToDBVersions.wh3.main_units_tables = originalVersions;
      else delete DBNameToDBVersions.wh3.main_units_tables;
    }
  };

  it("reports two live tables that set the same key", () => {
    withSchema(() => {
      const collisions: PackTableCollision[] = [];
      findPackTableCollisionsBetweenPacks(
        pack("a.pack", [tableFile("db\\main_units_tables\\a", "shared_key")]),
        pack("b.pack", [tableFile("db\\main_units_tables\\b", "shared_key")]),
        collisions,
      );

      // Recorded from both sides, which is why this is a pair rather than a single entry.
      expect(collisions).toHaveLength(2);
      expect(collisions.every((collision) => collision.value === "shared_key")).toBe(true);
    });
  });

  it("ignores a spare kept outside db\\, which the game never loads", () => {
    withSchema(() => {
      const collisions: PackTableCollision[] = [];
      findPackTableCollisionsBetweenPacks(
        // Same table, same key, but parked in a folder the game does not read - it cannot conflict
        // with anything until it is copied into db\.
        pack("a.pack", [tableFile("unusedtables\\main_units_tables\\a", "shared_key")]),
        pack("b.pack", [tableFile("db\\main_units_tables\\b", "shared_key")]),
        collisions,
      );

      expect(collisions).toEqual([]);
    });
  });

  it("ignores it in either position", () => {
    withSchema(() => {
      const collisions: PackTableCollision[] = [];
      findPackTableCollisionsBetweenPacks(
        pack("a.pack", [tableFile("db\\main_units_tables\\a", "shared_key")]),
        pack("b.pack", [tableFile("unusedtables\\main_units_tables\\b", "shared_key")]),
        collisions,
      );

      expect(collisions).toEqual([]);
    });
  });
});
