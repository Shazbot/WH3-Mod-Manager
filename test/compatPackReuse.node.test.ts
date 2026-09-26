import { describe, expect, it } from "vitest";

import {
  canReusePackIndexForCompat,
  canReuseParsedPackForCompat,
  isCompatTextFileName,
  mergeCompatTextIntoPack,
  packNeedsCompatTextRefresh,
} from "../src/modCompat/compatPackReuse";
import type { Pack, PackedFile } from "../src/packFileTypes";

const packedFile = (name: string, text?: string): PackedFile =>
  ({ name, text, file_size: 1, start_pos: 0 }) as PackedFile;
const pack = (packedFiles: PackedFile[], readTables: Pack["readTables"] = "all"): Pack =>
  ({
    name: "mod.pack",
    path: "/mods/mod.pack",
    packedFiles,
    readTables,
    size: 10,
    lastChangedLocal: 20,
    packHeader: {},
  }) as Pack;

describe("compat pack reuse", () => {
  it("reuses parsed rows only when the complete pack still matches disk", () => {
    expect(canReuseParsedPackForCompat(pack([]), { size: 10, mtimeMs: 20 })).toBe(true);
    expect(canReuseParsedPackForCompat(pack([], []), { size: 10, mtimeMs: 20 })).toBe(false);
    expect(canReuseParsedPackForCompat(pack([]), { size: 11, mtimeMs: 20 })).toBe(false);
    expect(canReusePackIndexForCompat(pack([], []), { size: 10, mtimeMs: 20 })).toBe(true);
  });

  it("recognizes every source format analyzed by the compatibility checker", () => {
    expect(isCompatTextFileName("script\\a.lua")).toBe(true);
    expect(isCompatTextFileName("variantmeshes\\a.variantmeshdefinition")).toBe(true);
    expect(isCompatTextFileName("models\\a.wsmodel")).toBe(true);
    expect(isCompatTextFileName("materials\\a.xml.material")).toBe(true);
    expect(isCompatTextFileName("models\\a.xml")).toBe(true);
    expect(isCompatTextFileName("db\\a_tables\\data__")).toBe(false);
  });

  it("refreshes transient text without replacing retained parsed table data", () => {
    const parsedRows = [{ type: "StringU8", fields: [{ type: "String", val: "key" }] }];
    const target = pack([
      { ...packedFile("script\\a.lua"), schemaFields: parsedRows },
      packedFile("db\\a_tables\\data__"),
    ] as PackedFile[]);
    const source = pack([packedFile("script\\a.lua", "core:add_listener()")], []);

    expect(packNeedsCompatTextRefresh(target)).toBe(true);
    expect(mergeCompatTextIntoPack(target, source)).toBe(1);
    expect(target.packedFiles[0].text).toBe("core:add_listener()");
    expect(target.packedFiles[0].schemaFields).toBe(parsedRows);
    expect(packNeedsCompatTextRefresh(target)).toBe(false);
  });
});
