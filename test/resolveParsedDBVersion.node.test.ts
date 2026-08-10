import { describe, expect, it } from "vitest";

import { getDBVersion, resolveParsedDBVersion } from "../src/utility/packFileHelpers";
import type { DBVersion, PackedFile } from "../src/packFileTypes";

const version = (versionNumber: number): DBVersion => ({ version: versionNumber, fields: [] });

describe("resolveParsedDBVersion", () => {
  it("takes the version the packed file declares", () => {
    expect(resolveParsedDBVersion(3, [version(0), version(3), version(5)])?.version).toBe(3);
  });

  it("falls back to version 0 when the packed file declares none", () => {
    expect(resolveParsedDBVersion(undefined, [version(0), version(5)])?.version).toBe(0);
  });

  it("will not fall back to version 0 for a file that declares a later version", () => {
    // The fallback and the older-than check interact: version 0 is found, then rejected for being
    // older than what the file says it is. The parser skips such a table, so this must too.
    expect(resolveParsedDBVersion(2, [version(0), version(5)])).toBeUndefined();
    expect(resolveParsedDBVersion(0, [version(0), version(5)])?.version).toBe(0);
  });

  it("gives up when nothing matches and there is no version 0", () => {
    // The difference from getDBVersion, and the reason this exists: the parser skips the table here,
    // so anything rebuilding its rows has to agree that there are none.
    expect(resolveParsedDBVersion(2, [version(4), version(5)])).toBeUndefined();
    expect(resolveParsedDBVersion(undefined, [version(4)])).toBeUndefined();
  });

  it("refuses a schema older than the packed file", () => {
    // A layout from before the file was written cannot describe it.
    expect(resolveParsedDBVersion(7, [version(0)])).toBeUndefined();
  });

  it("gives up when the table has no schema at all", () => {
    expect(resolveParsedDBVersion(1, undefined)).toBeUndefined();
    expect(resolveParsedDBVersion(1, [])).toBeUndefined();
  });

  it("differs from getDBVersion exactly where getDBVersion guesses", () => {
    const dbVersions = { units_tables: [version(4), version(5)] };
    const packedFile = { name: "db\\units_tables\\data__", version: 2 } as PackedFile;

    // Neither 2 nor 0 is in the schema. getDBVersion ends its chain with dbversions[0] and hands back
    // version 4 - a layout these bytes were never read with. The parser skipped the table instead.
    expect(getDBVersion(packedFile, dbVersions)?.version).toBe(4);
    expect(resolveParsedDBVersion(2, dbVersions.units_tables)).toBeUndefined();

    // Where a fallback does exist, the two agree - which is why swapping the parser over is safe.
    const withZero = { units_tables: [version(0), version(4)] };
    expect(getDBVersion({ ...packedFile, version: 0 } as PackedFile, withZero)?.version).toBe(
      resolveParsedDBVersion(0, withZero.units_tables)?.version,
    );
  });
});
