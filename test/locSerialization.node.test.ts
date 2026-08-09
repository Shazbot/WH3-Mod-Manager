import { describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

import { serializePackFileDataToBuffer } from "../src/packFileSerializer";
import { LocVersion } from "../src/packFileTypes";
import type { NewPackedFile, SchemaField } from "../src/packFileTypes";

/**
 * Shapes a loc row the way parseTypeBuffer does when reading one: a StringU16 becomes a single
 * decoded string with its length prefix dropped, and a Boolean becomes a UInt8.
 */
const locRow = (key: string, text: string, tooltip: boolean): SchemaField[] => [
  { type: "StringU16", fields: [{ type: "String", val: key }], isKey: true },
  { type: "StringU16", fields: [{ type: "String", val: text }], isKey: true },
  { type: "Boolean", fields: [{ type: "UInt8", val: tooltip ? 1 : 0 }], isKey: true },
];

const locFile = (rows: SchemaField[][]): NewPackedFile =>
  ({
    name: "text\\db\\my_mod.loc",
    schemaFields: rows.flat(),
    tableSchema: LocVersion,
  }) as unknown as NewPackedFile;

/** Reads back exactly as readLoc does, so this asserts against the real format. */
const parseLocBuffer = (buffer: Buffer) => {
  let pos = 0;
  expect(buffer.subarray(pos, pos + 2).toString("hex")).toBe("fffe");
  pos += 2;
  expect(buffer.subarray(pos, pos + 3).toString("hex")).toBe("4c4f43");
  pos += 3;
  pos += 1; // null byte
  pos += 4; // loc version, always 1
  const entryCount = buffer.readInt32LE(pos);
  pos += 4;

  const readStringU16 = () => {
    const length = buffer.readInt16LE(pos);
    pos += 2;
    const value = buffer.subarray(pos, pos + length * 2).toString("utf16le");
    pos += length * 2;
    return value;
  };

  const rows: Array<{ key: string; text: string; tooltip: number }> = [];
  for (let index = 0; index < entryCount; index++) {
    const key = readStringU16();
    const text = readStringU16();
    const tooltip = buffer.readUInt8(pos);
    pos += 1;
    rows.push({ key, text, tooltip });
  }

  return { rows, bytesConsumed: pos, totalBytes: buffer.length };
};

describe("loc round trip", () => {
  it("writes rows the loc reader can read back", () => {
    const buffer = serializePackFileDataToBuffer(
      locFile([locRow("land_units_onscreen_name_pj_unit", "My Unit", false)]),
    );

    const { rows, bytesConsumed, totalBytes } = parseLocBuffer(buffer);

    expect(rows).toEqual([
      { key: "land_units_onscreen_name_pj_unit", text: "My Unit", tooltip: 0 },
    ]);
    // Nothing left over: a stray byte would desync every following entry.
    expect(bytesConsumed).toBe(totalBytes);
  });

  it("keeps non-ascii text, which utf8 encoding used to mangle", () => {
    const text = "Épée des Ténèbres — 剣";
    const buffer = serializePackFileDataToBuffer(locFile([locRow("k", text, true)]));

    const { rows } = parseLocBuffer(buffer);

    expect(rows[0].text).toBe(text);
    expect(rows[0].tooltip).toBe(1);
  });

  it("keeps several rows in order and reports the right entry count", () => {
    const buffer = serializePackFileDataToBuffer(
      locFile([locRow("a", "first", false), locRow("b", "second", true), locRow("c", "", false)]),
    );

    const { rows, bytesConsumed, totalBytes } = parseLocBuffer(buffer);

    expect(rows.map((row) => row.key)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.text)).toEqual(["first", "second", ""]);
    expect(bytesConsumed).toBe(totalBytes);
  });

  it("writes an empty loc that still reads as a valid file", () => {
    const { rows, bytesConsumed, totalBytes } = parseLocBuffer(serializePackFileDataToBuffer(locFile([])));

    expect(rows).toEqual([]);
    expect(bytesConsumed).toBe(totalBytes);
  });
});
