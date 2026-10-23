import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { AutomationError } from "../../src/automation/errors";
import { FilesystemPolicy } from "../../src/automation/filesystem";
import { parseDbTable, readPackIndex, readRawPayload, serializeDbTable, writeRawPack } from "../../src/packCore";
import type { DBVersion, Field } from "../../src/packFileTypes";

const projectRoot = path.resolve(__dirname, "../..");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-automation-"));
const tableName = "sample_tables";
const tablePath = "DB\\SAMPLE_TABLES\\DATA";
const schema: DBVersion = {
  version: 3,
  fields: [
    { name: "key", field_type: "StringU8", is_key: true, default_value: "", is_filename: false, is_reference: [], description: "", ca_order: 0, is_bitwise: 0, enum_values: {} },
    { name: "enabled", field_type: "Boolean", is_key: false, default_value: "false", is_filename: false, is_reference: [], description: "", ca_order: 1, is_bitwise: 0, enum_values: {} },
    { name: "balance", field_type: "I64", is_key: false, default_value: "0", is_filename: false, is_reference: [], description: "", ca_order: 2, is_bitwise: 0, enum_values: {} },
    { name: "label", field_type: "StringU8", is_key: false, default_value: "", is_filename: false, is_reference: [], description: "", ca_order: 3, is_bitwise: 0, enum_values: {} },
  ],
};
const schemaProvider = async (): Promise<Record<string, DBVersion[]>> => ({ [tableName]: [schema] });
const context = createAutomationContext({ schemaProvider });
const defaultMetadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
};

const stringFields = (value: string): Field[] => [
  { type: "Int16", val: Buffer.byteLength(value, "utf8") },
  { type: "String", val: value },
];

const tablePayload = (): Buffer => {
  const guid = Buffer.from("unit-test-guid", "utf16le");
  const guidLength = Buffer.alloc(2);
  guidLength.writeUInt16LE(guid.length / 2);
  const version = Buffer.alloc(4);
  version.writeInt32LE(schema.version);
  const preamble = Buffer.concat([
    Buffer.from([0xfd, 0xfe, 0xfc, 0xff]),
    guidLength,
    guid,
    Buffer.from([0xfc, 0xfd, 0xfe, 0xff]),
    version,
    Buffer.from([1]),
  ]);
  const rows = [
    [stringFields("alpha"), [{ type: "UInt8", val: 1 }], [{ type: "I64", val: "9223372036854775807" }], stringFields("café 🐈")],
    [stringFields("beta"), [{ type: "UInt8", val: 0 }], [{ type: "I64", val: "9" }], stringFields("second")],
  ];
  return Buffer.concat([serializeDbTable(schema, rows, { preamble }), Buffer.from([0xde, 0xad])]);
};

const expectSuccess = <T>(response: Awaited<ReturnType<typeof executeAutomationRequest>>): T => {
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.data as T;
};

describe("headless pack automation", () => {
  const sourcePack = path.join(tempRoot, "source.pack");
  const patchedPack = path.join(tempRoot, "patched.pack");
  const storedCompressedPayload = Buffer.from([0xfa, 0xce, 0xb0, 0x0c, 0x01]);

  beforeAll(async () => {
    await writeRawPack(sourcePack, [
      { name: tablePath, buffer: tablePayload() },
      { name: "asset\\opaque.bin", buffer: storedCompressedPayload, is_compressed: true },
    ], defaultMetadata);
  });

  it("queries typed values with exact I64, Boolean, Unicode, and schema column metadata", async () => {
    const data = expectSuccess<{ rows: Record<string, unknown>[]; columns: { name: string; type: string; isKey: boolean }[] }>(
      await executeAutomationRequest({
        operation: "pack_query_table",
        packPath: sourcePack,
        tablePath,
        filters: [{ field: "balance", op: "gt", value: "9007199254740992" }],
        sort: [{ field: "balance", direction: "desc" }],
        columns: ["key", "enabled", "balance", "label"],
      }, context),
    );
    expect(data.rows).toEqual([{ key: "alpha", enabled: true, balance: "9223372036854775807", label: "café 🐈" }]);
    expect(data.columns).toEqual([
      { name: "key", type: "StringU8", isKey: true },
      { name: "enabled", type: "Boolean", isKey: false },
      { name: "balance", type: "I64", isKey: false },
      { name: "label", type: "StringU8", isKey: false },
    ]);
  });

  it("patches one cell, reads it back, and preserves the preamble, untouched cells, trailer, and compressed entry bytes", async () => {
    const original = readPackIndex(sourcePack, { game: "wh3" });
    const originalTableEntry = original.entries.find((entry) => entry.name.toLowerCase() === tablePath.toLowerCase())!;
    const originalTable = parseDbTable(readRawPayload(original, originalTableEntry), schema);

    expectSuccess(await executeAutomationRequest({
      operation: "pack_patch_table",
      packPath: sourcePack,
      outputPath: patchedPack,
      tablePath,
      patches: [{ op: "update", where: [{ field: "key", op: "eq", value: "alpha" }], set: { label: "更新済み 🐈" } }],
    }, context));

    const readback = expectSuccess<{ rows: Record<string, unknown>[] }>(await executeAutomationRequest({
      operation: "pack_read_table", packPath: patchedPack, tablePath,
    }, context));
    expect(readback.rows[0]).toEqual({ key: "alpha", enabled: true, balance: "9223372036854775807", label: "更新済み 🐈" });

    const updated = readPackIndex(patchedPack, { game: "wh3" });
    const updatedTableEntry = updated.entries.find((entry) => entry.name.toLowerCase() === tablePath.toLowerCase())!;
    const updatedTable = parseDbTable(readRawPayload(updated, updatedTableEntry), schema);
    expect(updatedTable.preamble.bytes).toEqual(originalTable.preamble.bytes);
    expect(updatedTable.trailingBytes).toEqual(originalTable.trailingBytes);
    for (const fieldIndex of [0, 1, 2]) expect(updatedTable.rows[0].cells[fieldIndex].bytes).toEqual(originalTable.rows[0].cells[fieldIndex].bytes);
    expect(updatedTable.rows[1].cells.map((cell) => cell.bytes)).toEqual(originalTable.rows[1].cells.map((cell) => cell.bytes));
    const originalOpaque = original.entries.find((entry) => entry.name === "asset\\opaque.bin")!;
    const updatedOpaque = updated.entries.find((entry) => entry.name === "asset\\opaque.bin")!;
    expect(updatedOpaque.is_compressed).toBe(true);
    expect(readRawPayload(updated, updatedOpaque)).toEqual(storedCompressedPayload);
    expect(updated.trailingBytes).toEqual(original.trailingBytes);
  });

  it("rejects ambiguous selectors and duplicate resulting keys without publishing output", async () => {
    const ambiguousPath = path.join(tempRoot, "ambiguous.pack");
    const ambiguous = await executeAutomationRequest({
      operation: "pack_patch_table",
      packPath: sourcePack,
      outputPath: ambiguousPath,
      tablePath,
      patches: [{ op: "delete", where: [] }],
    }, context);
    expect(ambiguous).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(existsSync(ambiguousPath)).toBe(false);

    const duplicatePath = path.join(tempRoot, "duplicate-key.pack");
    const duplicate = await executeAutomationRequest({
      operation: "pack_patch_table",
      packPath: sourcePack,
      outputPath: duplicatePath,
      tablePath,
      patches: [{ op: "update", where: [{ field: "key", op: "eq", value: "alpha" }], set: { key: "beta" } }],
    }, context);
    expect(duplicate).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(existsSync(duplicatePath)).toBe(false);
  });

  it("creates an empty mod pack and rejects source/output aliases", async () => {
    const emptyPath = path.join(tempRoot, "empty.pack");
    expectSuccess(await executeAutomationRequest({ operation: "pack_create", outputPath: emptyPath, files: [] }, context));
    expect(readPackIndex(emptyPath, { game: "wh3" }).entries).toEqual([]);

    const sourceBefore = readFileSync(sourcePack);
    const alias = await executeAutomationRequest({
      operation: "pack_clone", packPath: sourcePack, outputPath: sourcePack, overwrite: true,
    }, context);
    expect(alias).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(readFileSync(sourcePack)).toEqual(sourceBefore);
  });

  it("keeps existing output on validation failure and blocks symlink escapes from scoped roots", async () => {
    const output = path.join(tempRoot, "existing.bin");
    writeFileSync(output, "old");
    await expect(context.policy.withAtomicOutput({
      outputPath: output,
      overwrite: true,
      produce: async (temporaryPath) => writeFileSync(temporaryPath, "new"),
      validate: async () => { throw new AutomationError("VALIDATION", "reject output"); },
    })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(readFileSync(output, "utf8")).toBe("old");
    expect(readdirSync(tempRoot).some((name) => name.endsWith(".tmp"))).toBe(false);

    if (process.platform !== "win32") {
      const allowed = path.join(tempRoot, "allowed");
      const outside = path.join(tempRoot, "outside");
      mkdirSync(allowed, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(path.join(outside, "secret.txt"), "secret");
      symlinkSync(outside, path.join(allowed, "linked"), "dir");
      const scoped = new FilesystemPolicy({ readRoots: [allowed], writeRoots: [allowed] });
      await expect(scoped.assertReadPath(path.join(allowed, "linked", "secret.txt"))).rejects.toMatchObject({ code: "IO_ACCESS" });
      await expect(scoped.assertWritePath(path.join(allowed, "linked", "new.txt"))).rejects.toMatchObject({ code: "IO_ACCESS" });
    }
  });
});

describe("built CLI smoke test", () => {
  it("runs the actual bundled CLI without loading Electron", () => {
    const cliPath = path.join(projectRoot, "dist/cli/main.js");
    if (!existsSync(cliPath)) return;
    const help = spawnSync(process.execPath, [cliPath, "--help"], { cwd: projectRoot, encoding: "utf8" });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("Usage:");

    const probe = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(cliPath)}); if (Object.keys(require.cache).some((p) => /[\\\\/]electron([\\\\/]|$)/i.test(p))) process.exit(7);`], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(probe.status, probe.stderr).toBe(0);
  });
});
