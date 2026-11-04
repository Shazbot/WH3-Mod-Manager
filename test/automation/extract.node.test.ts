import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { main } from "../../src/cli/main";
import { serializeDbTable, writeRawPack } from "../../src/packCore";
import { LocVersion, type DBField, type DBVersion, type Field } from "../../src/packFileTypes";

const directories: string[] = [];
afterEach(() => {
  for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-extract-test-"));
  directories.push(root);
  return root;
};
const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};
const field = (name: string, field_type: DBField["field_type"], is_key = false): DBField => ({
  name,
  field_type,
  is_key,
  default_value: "",
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});
const schema: DBVersion = {
  version: 0,
  fields: [field("amount", "F32"), field("key", "StringU8", true), field("count", "I64")],
};
const string = (value: string): Field[] => [
  { type: "Int16", val: Buffer.byteLength(value) },
  { type: "String", val: value },
];
const db = () =>
  serializeDbTable(
    schema,
    [[[{ type: "F32", val: 1.25 }], string("a"), [{ type: "I64", val: "9223372036854775807" }]]],
    { version: 0 },
  );
const loc = () =>
  Buffer.concat([
    Buffer.from([255, 254, 76, 79, 67, 0, 1, 0, 0, 0]),
    serializeDbTable(LocVersion, [
      [[{ type: "String", val: "hello" }], [{ type: "String", val: "world" }], [{ type: "UInt8", val: 0 }]],
    ]).subarray(1),
  ]);
const context = () => createAutomationContext({ schemaProvider: async () => ({ sample_tables: [schema] }) });
const run = (packPaths: string[], outputPath: string, extra: Record<string, unknown> = {}, ctx = context()) =>
  executeAutomationRequest({ operation: "pack_extract", packPaths, outputPath, ...extra }, ctx);
const pack = (root: string, name: string, files: Record<string, Buffer | string>) =>
  writeRawPack(
    path.join(root, name),
    Object.entries(files).map(([name, buffer]) => ({
      name,
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    })),
    metadata,
  );

describe("folder extraction", () => {
  it("exports key-first RPFM tables and LOC, retaining unknown tables and raw assets", async () => {
    const root = workspace();
    const source = path.join(root, "source.pack");
    const output = path.join(root, "out");
    await pack(root, "source.pack", {
      "db/sample_tables/data__": db(),
      "db/unknown_tables/data__": "opaque",
      "text/db/example.loc": loc(),
      "ui/icon.dds": Buffer.from([0, 255, 1]),
      "script/a.lua": "return 1\r\n",
      "scripts/no.lua": "no",
    });
    const response = await run([source], output, {
      folders: ["DB/", "text", "ui", "script", "script/"],
      keysFirst: true,
    });
    expect(response).toMatchObject({
      ok: true,
      data: { extractedFiles: 5, tsvFiles: 2, rawFiles: 3, unsupportedTables: 1 },
    });
    expect(fs.readFileSync(path.join(output, "db/sample_tables/data__.tsv"), "utf8")).toBe(
      "key\tamount\tcount\n#sample_tables;0;db/sample_tables/data__\t\t\na\t1.2500\t9223372036854775807\n",
    );
    expect(fs.readFileSync(path.join(output, "text/db/example.loc.tsv"), "utf8")).toBe(
      "key\ttext\ttooltip\n#Loc;1;text/db/example.loc\t\t\nhello\tworld\tfalse\n",
    );
    expect(fs.readFileSync(path.join(output, "db/unknown_tables/data__"), "utf8")).toBe("opaque");
    expect(fs.readFileSync(path.join(output, "ui/icon.dds"))).toEqual(Buffer.from([0, 255, 1]));
    expect(fs.existsSync(path.join(output, "scripts"))).toBe(false);
  });

  it("uses last-pack precedence, supports raw tables, and retains extra output files", async () => {
    const root = workspace();
    const output = path.join(root, "out");
    await pack(root, "a.pack", { "script/a.lua": "first", "db/sample_tables/data__": db() });
    await pack(root, "b.pack", { "SCRIPT/a.lua": "last" });
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, "extra.txt"), "retain");
    const response = await run([path.join(root, "a.pack"), path.join(root, "b.pack")], output, { tableFormat: "raw" });
    expect(response).toMatchObject({ ok: true, data: { extractedFiles: 2, shadowedFiles: 1, tsvFiles: 0 } });
    expect(fs.readFileSync(path.join(output, "SCRIPT/a.lua"), "utf8")).toBe("last");
    expect(fs.readFileSync(path.join(output, "db/sample_tables/data__"))).toEqual(db());
    expect(fs.readFileSync(path.join(output, "extra.txt"), "utf8")).toBe("retain");
    expect(await run([path.join(root, "a.pack")], output, { tableFormat: "raw" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await run([path.join(root, "a.pack")], output, { tableFormat: "raw", overwrite: true })).toMatchObject({
      ok: true,
    });
  });

  it("selects vanilla localization by language and lets explicit packs override it", async () => {
    const root = workspace();
    for (const [name, value] of [
      ["data", "base"],
      ["local_en", "English"],
      ["local_fr", "French"],
      ["mod", "mod"],
    ])
      await pack(root, `${name}.pack`, { "text/message.txt": value });
    fs.writeFileSync(path.join(root, "manifest.txt"), "data.pack\t1\t1\nlocal_en.pack\t1\t1\nlocal_fr.pack\t1\t1\n");
    for (const [language, expected] of [
      ["en", "English"],
      ["fr", "French"],
    ]) {
      const output = path.join(root, language);
      expect(await run([], output, { withVanilla: true, gameDataPath: root, language })).toMatchObject({ ok: true });
      expect(fs.readFileSync(path.join(output, "text/message.txt"), "utf8")).toBe(expected);
    }
    const output = path.join(root, "mod-out");
    expect(await run([path.join(root, "mod.pack")], output, { withVanilla: true, gameDataPath: root })).toMatchObject({
      ok: true,
    });
    expect(fs.readFileSync(path.join(output, "text/message.txt"), "utf8")).toBe("mod");
    expect(
      await run([], path.join(root, "missing"), { withVanilla: true, gameDataPath: root, language: "ge" }),
    ).toMatchObject({ ok: false });
    fs.writeFileSync(path.join(root, "manifest.txt"), "../escape.pack\n");
    expect(await run([], path.join(root, "bad"), { gameDataPath: root })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it("includes explicit loose vanilla files with snapshot, manifest, and source-alias protection", async () => {
    const root = workspace();
    const output = path.join(root, "out");
    await pack(root, "data.pack", { "text/build_info": "packed", "script/a": "a" });
    await pack(root, "mod.pack", { "text/build_info": "mod" });
    fs.mkdirSync(path.join(root, "text"));
    fs.writeFileSync(path.join(root, "text/build_info"), "loose");
    fs.writeFileSync(path.join(root, "manifest.txt"), "data.pack\ntext/build_info\t5\t0\n");
    expect(
      await run([], output, { gameDataPath: root, folders: ["script"], looseFiles: ["text/build_info"] }),
    ).toMatchObject({ ok: true, data: { extractedFiles: 2 } });
    expect(fs.readFileSync(path.join(output, "text/build_info"), "utf8")).toBe("loose");
    const override = path.join(root, "override");
    expect(
      await run([path.join(root, "mod.pack")], override, { gameDataPath: root, looseFiles: ["text/build_info"] }),
    ).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(override, "text/build_info"), "utf8")).toBe("mod");
    expect(
      await run([], path.join(root, "missing"), { gameDataPath: root, looseFiles: ["text/missing"] }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await run([], root, { gameDataPath: root, looseFiles: ["text/build_info"], overwrite: true })).toMatchObject(
      { ok: false, error: { code: "CONFLICT" } },
    );
    const source = path.join(root, "text/build_info");
    const ctx = createAutomationContext({
      progress: (progress) => {
        if (progress.stage === "extract" && progress.completed === 1) fs.appendFileSync(source, "changed");
      },
    });
    expect(
      await run([], path.join(root, "changed"), { gameDataPath: root, looseFiles: ["text/build_info"] }, ctx),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("falls back for unknown versions but fails on malformed supported tables", async () => {
    const root = workspace();
    const output = path.join(root, "out");
    const unknown = serializeDbTable(schema, [], { version: 42 });
    await pack(root, "unknown.pack", { "db/sample_tables/data__": unknown });
    expect(await run([path.join(root, "unknown.pack")], output)).toMatchObject({
      ok: true,
      data: { unsupportedTables: 1 },
    });
    expect(fs.readFileSync(path.join(output, "db/sample_tables/data__"))).toEqual(unknown);
    await pack(root, "bad.pack", { "db/sample_tables/data__": db().subarray(0, -2) });
    expect(await run([path.join(root, "bad.pack")], path.join(root, "bad"))).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });

  it.each(["suffix", "parent", "report"])("preflights %s collisions before publishing", async (kind) => {
    const root = workspace();
    const output = path.join(root, "out");
    await pack(
      root,
      "source.pack",
      kind === "suffix"
        ? {
            "db/sample_tables/data__": db(),
            "db/sample_tables/data__.tsv": serializeDbTable(schema, [], { version: 42 }),
          }
        : { "script/a": "file", "script/a/b": "child" },
    );
    const extra = kind === "report" ? { reportPath: path.join(output, "script/a") } : {};
    expect(await run([path.join(root, "source.pack")], output, extra)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(fs.existsSync(output)).toBe(false);
  });

  it("enforces allowed roots, rejects symlink escapes, and protects source hard links", async () => {
    const root = workspace();
    const output = path.join(root, "out");
    const outside = path.join(root, "outside");
    fs.mkdirSync(output);
    fs.mkdirSync(outside);
    await pack(root, "source.pack", { "script/a": "value" });
    const source = path.join(root, "source.pack");
    const ctx = createAutomationContext({ readRoots: [root], writeRoots: [output] });
    expect(await run([source], outside, {}, ctx)).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
    fs.symlinkSync(outside, path.join(output, "script"), "junction");
    expect(await run([source], output, {}, ctx)).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
    fs.unlinkSync(path.join(output, "script"));
    fs.mkdirSync(path.join(output, "script"));
    fs.linkSync(source, path.join(output, "script/a"));
    const before = fs.readFileSync(source);
    expect(await run([source], output, { overwrite: true })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fs.readFileSync(source)).toEqual(before);
  });

  it("rejects unsafe internal paths, invalid raw/key options, and source aliases", async () => {
    const root = workspace();
    const source = path.join(root, "source.pack");
    await pack(root, "source.pack", { "../escape": "bad" });
    expect(await run([source], path.join(root, "out"))).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(await run([source], path.join(root, "out"), { tableFormat: "raw", keysFirst: true })).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    await pack(root, "source.pack", { "source.pack": "bad" });
    expect(await run([source], root, { overwrite: true })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("decompresses raw assets and reports invalid compressed payloads as validation failures", async () => {
    const root = workspace();
    const source = path.join(root, "source.pack");
    const output = path.join(root, "out");
    const payload = Buffer.from("compressed content".repeat(20));
    const size = Buffer.alloc(4);
    size.writeUInt32LE(payload.length);
    await writeRawPack(
      source,
      [{ name: "script/a", is_compressed: true, buffer: Buffer.concat([size, deflateRawSync(payload)]) }],
      metadata,
    );
    expect(await run([source], output)).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(output, "script/a"))).toEqual(payload);
    await writeRawPack(source, [{ name: "script/a", is_compressed: true, buffer: Buffer.alloc(12, 255) }], metadata);
    expect(await run([source], path.join(root, "bad"))).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", details: { filePath: "script/a" } },
    });
  });

  it("detects source changes during extraction", async () => {
    const root = workspace();
    const source = path.join(root, "source.pack");
    await pack(root, "source.pack", { "script/a": "a", "script/b": "b" });
    const ctx = createAutomationContext({
      progress: (progress) => {
        if (progress.stage === "extract" && progress.completed === 1) fs.appendFileSync(source, "changed");
      },
    });
    expect(await run([source], path.join(root, "out"), {}, ctx)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });

  it("honors cancellation without leaving temporary files", async () => {
    const root = workspace();
    const source = path.join(root, "source.pack");
    const output = path.join(root, "out");
    await pack(root, "source.pack", { "script/a": "a", "script/b": "b" });
    const controller = new AbortController();
    const ctx = createAutomationContext({
      signal: controller.signal,
      progress: (progress) => {
        if (progress.stage === "extract" && progress.completed === 1) controller.abort();
      },
    });
    expect(await run([source], output, {}, ctx)).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(fs.readdirSync(path.join(output, "script"))).toHaveLength(1);
  });

  it("adapts CLI folder lists, multiple packs, vanilla selection, and table options", async () => {
    const root = workspace();
    const output = path.join(root, "out");
    await pack(root, "source.pack", { "script/a.lua": "a", "ui/b.dds": "b", "db/raw_tables/data__": "raw" });
    await pack(root, "mod.pack", { "script/a.lua": "override" });
    const stdout: string[] = [];
    const exit = await main(
      [
        "pack",
        "extract",
        path.join(root, "source.pack"),
        path.join(root, "mod.pack"),
        "--folder",
        "script",
        "--folder",
        "ui",
        "--table-format",
        "raw",
        "--output",
        output,
        "--format",
        "json",
        "--no-cache",
      ],
      { stdout: (text) => stdout.push(text), stderr: () => undefined },
    );
    expect(exit).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ ok: true, data: { extractedFiles: 2, tableFormat: "raw" } });
    expect(fs.readFileSync(path.join(output, "script/a.lua"), "utf8")).toBe("override");
    fs.writeFileSync(path.join(root, "manifest.txt"), "source.pack\nloose.txt\t5\t0\n");
    fs.writeFileSync(path.join(root, "loose.txt"), "loose");
    expect(
      await main(
        [
          "pack",
          "extract",
          "--with-vanilla",
          "--game-data",
          root,
          "--language",
          "en",
          "--folder",
          "script",
          "--loose-file",
          "loose.txt",
          "--keys-first",
          "--output",
          path.join(root, "vanilla"),
          "--no-cache",
        ],
        { stdout: () => undefined, stderr: () => undefined },
      ),
    ).toBe(0);
    expect(fs.readFileSync(path.join(root, "vanilla/loose.txt"), "utf8")).toBe("loose");
  });
});
