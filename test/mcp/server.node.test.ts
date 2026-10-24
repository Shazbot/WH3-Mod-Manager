import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FilesystemPolicy } from "../../src/automation/filesystem";
import { AutomationError } from "../../src/automation/errors";
import { makeRowFields } from "../../src/automation/tables";
import { dbPreambleMarkers, serializeDbTable, writeRawPack } from "../../src/packCore";
import { LocVersion, type DBField, type DBVersion, type Field } from "../../src/packFileTypes";

const projectRoot = process.cwd();
const serverEntry = path.join(projectRoot, "dist", "mcp", "server.js");
const cliEntry = path.join(projectRoot, "dist", "cli", "main.js");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "whmm-mcp-"));
const allowedRoot = path.join(tempRoot, "allowed");
const outsideRoot = path.join(tempRoot, "outside");
mkdirSync(allowedRoot);
mkdirSync(outsideRoot);

const metadata = () => ({
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([0xff, 0xff, 0xff, 0x7f]),
  dependencies: [] as string[],
});

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

const stringFields = (value: string): Field[] => [
  { type: "Int16", val: Buffer.byteLength(value, "utf8") },
  { type: "String", val: value },
];

const makeTableFile = (filePath: string): void => {
  const schema: DBVersion = {
    version: 0,
    fields: [field("key", "StringU8", true), field("value", "F32")],
  };
  const version = Buffer.alloc(4);
  version.writeInt32LE(0);
  const preamble = Buffer.concat([dbPreambleMarkers.version, version, Buffer.from([1])]);
  const buffer = serializeDbTable(schema, [[stringFields("probe"), [{ type: "F32", val: 84 }]]], { preamble });
  writeFileSync(filePath, buffer);
};

interface TestClient {
  client: Client;
  transport: StdioClientTransport;
  close(): Promise<void>;
}

const connect = async (
  options: { readRoots?: string[]; writeRoots?: string[]; maxResponseBytes?: number } = {},
): Promise<TestClient> => {
  const readRoots = options.readRoots ?? [allowedRoot];
  const writeRoots = options.writeRoots ?? [allowedRoot];
  const args = [serverEntry];
  for (const root of readRoots) args.push("--read-root", root);
  for (const root of writeRoots) args.push("--write-root", root);
  if (options.maxResponseBytes !== undefined) args.push("--max-response-bytes", String(options.maxResponseBytes));
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: projectRoot, stderr: "pipe" });
  let childStderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    childStderr += chunk.toString("utf8");
  });
  const client = new Client({ name: "whmm-mcp-test", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nMCP stderr: ${childStderr}`);
  }
  return {
    client,
    transport,
    close: async () => {
      await client.close();
      await transport.close();
    },
  };
};

const responseEnvelope = <T>(result: Awaited<ReturnType<Client["callTool"]>>) =>
  result.structuredContent as {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };

const responseBytes = (result: Awaited<ReturnType<Client["callTool"]>>): number =>
  Buffer.byteLength(
    JSON.stringify({
      content: result.content,
      structuredContent: result.structuredContent,
      ...(result.isError ? { isError: true } : {}),
    }),
    "utf8",
  );

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for child process shutdown");
};

afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

describe("WH3 MCP stdio server", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [path.join(projectRoot, "scripts/build-tools.mjs")], { cwd: projectRoot });
  });

  it("registers all shared operations with descriptions and typed input schemas", async () => {
    const session = await connect();
    try {
      const listed = await session.client.listTools();
      expect(listed.tools).toHaveLength(17);
      const info = listed.tools.find((tool) => tool.name === "pack_info");
      expect(info?.description).toContain("pack header");
      expect(info?.inputSchema).toMatchObject({
        type: "object",
        required: ["packPath"],
        properties: { packPath: { type: "string" } },
      });
      expect(listed.tools.find((tool) => tool.name === "pack_subset")?.inputSchema).toMatchObject({
        properties: { sourcePackPaths: { type: "array" }, outputPath: { type: "string" } },
      });
    } finally {
      await session.close();
    }
  });

  it("creates, queries, and writes a pack; MCP and CLI return equivalent pack metadata", async () => {
    const session = await connect();
    try {
      const tableFile = path.join(allowedRoot, "kv-table.bin");
      const tablePath = "db\\_kv_rules_tables\\data___rlqre5";
      makeTableFile(tableFile);
      const packPath = path.join(allowedRoot, "mcp-created.pack");
      const created = await session.client.callTool({
        name: "pack_create",
        arguments: {
          outputPath: packPath,
          files: [
            { path: tablePath, sourcePath: tableFile },
            { path: "texts\\seed.txt", text: "seed" },
          ],
        },
      });
      expect(created.isError).not.toBe(true);
      expect(responseEnvelope<{ fileCount: number }>(created).data?.fileCount).toBe(2);

      const query = await session.client.callTool({
        name: "pack_query_table",
        arguments: {
          packPath,
          tablePath,
          filters: [{ field: "key", op: "eq", value: "probe" }],
        },
      });
      expect(query.isError, JSON.stringify(query.structuredContent)).not.toBe(true);
      expect(responseEnvelope<{ rows: Array<{ key: string; value: number }> }>(query).data?.rows).toEqual([
        { key: "probe", value: 84 },
      ]);

      const outputPath = path.join(allowedRoot, "mcp-written.pack");
      const written = await session.client.callTool({
        name: "pack_write_files",
        arguments: {
          packPath,
          outputPath,
          files: [{ op: "add", path: "texts\\added.txt", text: "added" }],
        },
      });
      expect(written.isError).not.toBe(true);
      expect(responseEnvelope<{ added: number }>(written).data?.added).toBe(1);

      const mcpInfo = await session.client.callTool({ name: "pack_info", arguments: { packPath: outputPath } });
      expect(responseEnvelope<{ fileCount: number }>(mcpInfo).data?.fileCount).toBe(3);
      const cli = spawnSync(process.execPath, [cliEntry, "pack", "info", outputPath, "--format", "json"], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(cli.status).toBe(0);
      expect(JSON.parse(cli.stdout)).toEqual(responseEnvelope(mcpInfo));
    } finally {
      await session.close();
    }
  });

  it("exposes localization/unit lookups and returns equivalent CLI localization results", async () => {
    const packPath = path.join(allowedRoot, "names.pack");
    const buffer = serializeDbTable(
      LocVersion,
      [makeRowFields(LocVersion, { key: "display_name", text: "Épées 皇", tooltip: false })],
      { preamble: Buffer.from([255, 254, 76, 79, 67, 0, 1, 0, 0, 0]) },
    );
    await writeRawPack(packPath, [{ name: "text\\names.loc", buffer }], metadata());
    const session = await connect();
    try {
      const args = { packPaths: [packPath], query: "Épées 皇" };
      const result = await session.client.callTool({ name: "localization_lookup", arguments: args });
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
      expect(responseEnvelope<{ total: number; items: Array<{ locKey: string }> }>(result).data).toMatchObject({
        total: 1,
        items: [{ locKey: "display_name" }],
      });
      const inputPath = path.join(allowedRoot, "lookup-input.json");
      writeFileSync(inputPath, JSON.stringify(args));
      const cli = spawnSync(process.execPath, [cliEntry, "loc", "lookup", "--input", inputPath, "--format", "json"], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(cli.status, cli.stderr).toBe(0);
      expect(JSON.parse(cli.stdout)).toEqual(responseEnvelope(result));
      const units = await session.client.callTool({
        name: "unit_resolve",
        arguments: { packPaths: [packPath], query: "unknown" },
      });
      expect(units.isError, JSON.stringify(units.structuredContent)).not.toBe(true);
      expect(responseEnvelope<{ total: number; complete: boolean }>(units).data).toMatchObject({
        total: 0,
        complete: false,
      });
    } finally {
      await session.close();
    }
  });

  it("enforces read roots, denies writes without write roots, and rejects malformed arguments", async () => {
    const outsidePack = path.join(outsideRoot, "outside.pack");
    await writeRawPack(outsidePack, [{ name: "x.txt", buffer: Buffer.from("x") }], metadata());
    const session = await connect({ writeRoots: [] });
    try {
      const deniedRead = await session.client.callTool({ name: "pack_info", arguments: { packPath: outsidePack } });
      expect(deniedRead.isError).toBe(true);
      expect(responseEnvelope(deniedRead).error?.code).toBe("IO_ACCESS");

      const deniedOutput = path.join(allowedRoot, "write-denied.pack");
      const deniedWrite = await session.client.callTool({
        name: "pack_create",
        arguments: { outputPath: deniedOutput },
      });
      expect(deniedWrite.isError).toBe(true);
      expect(responseEnvelope(deniedWrite).error?.code).toBe("IO_ACCESS");
      expect(existsSync(deniedOutput)).toBe(false);

      const malformed = await session.client.callTool({
        name: "pack_info",
        arguments: { packPath: outsidePack, extra: true },
      });
      expect(malformed.isError).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("bounds the full UTF-8 result including escaped Unicode and returns an explicit report summary", async () => {
    const packPath = path.join(allowedRoot, "large-list.pack");
    const entries = Array.from({ length: 30 }, (_, index) => ({
      name: `quoted\\file\"${index}\\emoji😀\\${"back\\slash".repeat(4)}.txt`,
      buffer: Buffer.from("value"),
    }));
    await writeRawPack(packPath, entries, metadata());
    const session = await connect({ maxResponseBytes: 1024 });
    try {
      const reportPath = path.join(allowedRoot, "large-list-report.json");
      const summarized = await session.client.callTool({
        name: "pack_list_files",
        arguments: { packPath, reportPath },
      });
      expect(summarized.isError).not.toBe(true);
      expect(responseBytes(summarized)).toBeLessThanOrEqual(1024);
      expect(responseEnvelope<{ resultOmitted: boolean; reportPath: string }>(summarized).data).toMatchObject({
        resultOmitted: true,
        reportPath,
      });
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as { items: Array<{ path: string }> };
      expect(report.items).toHaveLength(entries.length);
      expect(report.items[0].path).toContain("emoji😀");

      const boundedError = await session.client.callTool({ name: "pack_list_files", arguments: { packPath } });
      expect(boundedError.isError).toBe(true);
      expect(responseBytes(boundedError)).toBeLessThanOrEqual(1024);
      expect(responseEnvelope(boundedError).error).toMatchObject({
        code: "VALIDATION",
        details: { resultOmitted: true },
      });

      let deepDirectory = allowedRoot;
      for (let index = 0; index < 12; index += 1) {
        deepDirectory = path.join(deepDirectory, `segment-${index}-${"x".repeat(88)}`);
        mkdirSync(deepDirectory);
      }
      const deepOutput = path.join(deepDirectory, "completed.pack");
      expect(Buffer.byteLength(deepOutput, "utf8")).toBeGreaterThan(1024);
      const completedButOmitted = await session.client.callTool({
        name: "pack_create",
        arguments: { outputPath: deepOutput },
      });
      expect(completedButOmitted.isError).toBe(true);
      expect(responseBytes(completedButOmitted)).toBeLessThanOrEqual(1024);
      expect(responseEnvelope(completedButOmitted).error).toMatchObject({
        details: { completed: true, pathOmitted: true },
      });
      expect(existsSync(deepOutput)).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("cancels queued MCP work and atomic writes before publication, then closes cleanly on EOF", async () => {
    const sourcePack = path.join(allowedRoot, "cancel-scan.pack");
    await writeRawPack(
      sourcePack,
      Array.from({ length: 2500 }, (_, index) => ({
        name: `texts\\entry-${index}.txt`,
        buffer: Buffer.from(`payload-${index}`),
      })),
      metadata(),
    );
    const session = await connect();
    const childPid = session.transport.pid;
    const reportPath = path.join(allowedRoot, "cancelled-report.json");
    const outputPath = path.join(allowedRoot, "cancelled-output.pack");
    try {
      const scanning = session.client.callTool({
        name: "pack_search",
        arguments: { packPath: sourcePack, query: "not-present", content: true },
      });
      const controller = new AbortController();
      const queued = session.client.callTool(
        {
          name: "pack_create",
          arguments: { outputPath, reportPath },
        },
        { signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 1);
      await expect(queued).rejects.toThrow();
      await scanning;
      expect(existsSync(outputPath)).toBe(false);
      expect(existsSync(reportPath)).toBe(false);
    } finally {
      await session.close();
    }
    if (childPid) {
      await waitFor(() => {
        try {
          process.kill(childPid, 0);
          return false;
        } catch {
          return true;
        }
      });
    }

    const controller = new AbortController();
    const output = path.join(allowedRoot, "aborted-atomic.pack");
    const policy = new FilesystemPolicy({ writeRoots: [allowedRoot], signal: controller.signal });
    await expect(
      policy.withAtomicOutput({
        outputPath: output,
        produce: async (temporaryPath) => {
          writeFileSync(temporaryPath, "temporary");
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(existsSync(output)).toBe(false);
    expect(readdirSync(allowedRoot).some((name) => name.includes("aborted-atomic.pack") && name.endsWith(".tmp"))).toBe(
      false,
    );
  });
});
