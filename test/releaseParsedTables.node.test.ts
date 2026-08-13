import { describe, expect, it } from "vitest";

import { findUnparsedTablePrefixes, releaseParsedTables } from "../src/utility/packFileHelpers";
import type { Pack, PackedFile, SchemaField } from "../src/packFileTypes";

const rows = (): SchemaField[] => [{ type: "StringU8", fields: [{ type: "String", val: "a" }] } as SchemaField];

const packedFile = (name: string, parsed: boolean): PackedFile =>
  ({ name, file_size: 0, start_pos: 0, schemaFields: parsed ? rows() : undefined }) as PackedFile;

const pack = (readTables: string[] | "all", packedFiles: PackedFile[]): Pack =>
  ({ name: "db.pack", path: "C:\\data\\db.pack", packedFiles, readTables }) as Pack;

const skills = "db\\character_skills_tables\\";
const units = "db\\land_units_tables\\";

describe("releaseParsedTables", () => {
  it("drops the rows of the tables it was given and leaves the others parsed", () => {
    const released = packedFile(`${skills}data__`, true);
    const kept = packedFile(`${units}data__`, true);

    releaseParsedTables([pack([skills, units], [released, kept])], [skills]);

    expect(released.schemaFields).toBeUndefined();
    expect(kept.schemaFields).toBeDefined();
  });

  it("stops the pack claiming to have parsed what it just dropped", () => {
    const target = pack([skills, units], [packedFile(`${skills}data__`, true)]);

    releaseParsedTables([target], [skills]);

    expect(target.readTables).toEqual([units]);
  });

  it("forgets a claim recorded as a whole packed file path, not just as the table prefix", () => {
    const target = pack([`${skills}data__`], [packedFile(`${skills}data__`, true)]);

    releaseParsedTables([target], [skills]);

    expect(target.readTables).toEqual([]);
  });

  it("forgets a claim broader than the prefix asked for, since it no longer holds in full", () => {
    const target = pack(["db\\"], [packedFile(`${skills}data__`, true)]);

    releaseParsedTables([target], [skills]);

    expect(target.readTables).toEqual([]);
  });

  // Nothing here can narrow "all" truthfully, so a pack making that claim keeps its rows rather than
  // be left claiming to hold rows that are gone.
  it("leaves a pack that claims every table alone", () => {
    const untouched = packedFile(`${skills}data__`, true);
    const target = pack("all", [untouched]);

    releaseParsedTables([target], [skills]);

    expect(untouched.schemaFields).toBeDefined();
    expect(target.readTables).toBe("all");
  });

  it("does nothing when asked for no tables", () => {
    const untouched = packedFile(`${skills}data__`, true);
    const target = pack([skills], [untouched]);

    releaseParsedTables([target], []);

    expect(untouched.schemaFields).toBeDefined();
    expect(target.readTables).toEqual([skills]);
  });
});

describe("findUnparsedTablePrefixes", () => {
  it("reports a prefix the pack carries files for but has no rows for", () => {
    const target = pack([], [packedFile(`${skills}data__`, false), packedFile(`${units}data__`, true)]);

    expect(findUnparsedTablePrefixes([target], [skills, units])).toEqual([skills]);
  });

  it("catches exactly what releaseParsedTables just dropped", () => {
    const target = pack([skills], [packedFile(`${skills}data__`, true)]);

    releaseParsedTables([target], [skills]);

    expect(findUnparsedTablePrefixes([target], [skills])).toEqual([skills]);
  });

  // A prefix no vanilla pack ships is not a failed read, and demanding rows for it would fail every
  // build on tables that only exist under another name for this game.
  it("says nothing about a prefix no pack carries files for", () => {
    const target = pack([], [packedFile(`${units}data__`, true)]);

    expect(findUnparsedTablePrefixes([target], [skills])).toEqual([]);
  });

  it("counts a prefix as read when any of the packs parsed it", () => {
    const indexOnly = pack([], [packedFile(`${skills}data__`, false)]);
    const parsed = pack([skills], [packedFile(`${skills}data__`, true)]);

    expect(findUnparsedTablePrefixes([indexOnly, parsed], [skills])).toEqual([]);
  });
});
