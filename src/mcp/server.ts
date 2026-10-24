import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  createAutomationContext,
  executeAutomationRequest,
  operationRegistry,
  type AutomationContext,
  type AutomationRequest,
  type OperationName,
} from "../automation/registry";
import { AutomationError, failedResponse, type AutomationResponse } from "../automation/errors";

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MIN_MAX_RESPONSE_BYTES = 1024;
const MAX_MAX_RESPONSE_BYTES = 1024 * 1024;

const descriptions: Record<OperationName, string> = {
  pack_info: "Read WH3 pack header, dependencies, index, and trailer metadata.",
  pack_list_files: "List internal paths in a WH3 pack with bounded pagination and optional path filters.",
  pack_read_file: "Read or explicitly extract one raw or decompressed pack payload.",
  pack_search: "Search packed filenames and supported text payloads with a result limit.",
  pack_read_table: "Read a DB or LOC table with schema metadata and bounded pagination.",
  pack_query_table: "Filter, sort, and project DB or LOC rows using schema-typed values.",
  pack_create: "Create a WH3 mod or movie pack with optional dependencies and files.",
  pack_write_files: "Add, replace, or remove pack files into a validated output pack.",
  pack_patch_table: "Insert, update, or delete DB or LOC rows in a copy-on-write output pack.",
  pack_validate: "Validate strict pack structure and optionally decode all logical payloads.",
  pack_clone: "Clone a pack byte-for-byte, optionally verifying its SHA-256 hash.",
  pack_diff: "Compare two packs by logical file hashes and supported DB, LOC, and XML reference semantics.",
  asset_resolve_references: "Resolve asset and DB row roots into a bounded forward reference graph.",
  asset_find_references: "Scan explicit packs for reverse references to an asset or DB table.",
  pack_subset: "Create a subset pack from selected files or DB rows and a declared dependency closure.",
};

export interface McpServerOptions {
  readRoots: readonly string[];
  writeRoots: readonly string[];
  maxResponseBytes: number;
  shutdownSignal?: AbortSignal;
}

export interface McpCliOptions extends McpServerOptions {
  help: boolean;
}

const parseMcpArgs = (args: readonly string[]): McpCliOptions => {
  const parsed = parseArgs({
    args: [...args],
    options: {
      "read-root": { type: "string", multiple: true },
      "write-root": { type: "string", multiple: true },
      "max-response-bytes": { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.positionals.length > 0)
    throw new AutomationError("INVALID_ARGUMENT", `Unexpected arguments: ${parsed.positionals.join(" ")}`);
  const readRoots = parsed.values["read-root"] ?? [];
  const writeRoots = parsed.values["write-root"] ?? [];
  const maxValue = parsed.values["max-response-bytes"];
  if (maxValue !== undefined && !/^\d+$/.test(maxValue)) {
    throw new AutomationError("INVALID_ARGUMENT", "--max-response-bytes must be an integer");
  }
  const maxResponseBytes = maxValue === undefined ? DEFAULT_MAX_RESPONSE_BYTES : Number(maxValue);
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < MIN_MAX_RESPONSE_BYTES ||
    maxResponseBytes > MAX_MAX_RESPONSE_BYTES
  ) {
    throw new AutomationError(
      "INVALID_ARGUMENT",
      `--max-response-bytes must be between ${MIN_MAX_RESPONSE_BYTES} and ${MAX_MAX_RESPONSE_BYTES}`,
    );
  }
  return { readRoots, writeRoots, maxResponseBytes, help: Boolean(parsed.values.help) };
};

const validateRoots = async (roots: readonly string[], kind: string): Promise<string[]> => {
  const canonical: string[] = [];
  for (const root of roots) {
    const resolved = await fs.realpath(path.resolve(root));
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory())
      throw new AutomationError("IO_ACCESS", `--${kind}-root must name an existing directory: ${root}`);
    canonical.push(resolved);
  }
  return [...new Set(canonical)];
};

const makeInputSchema = (definition: (typeof operationRegistry)[OperationName]): z.ZodObject<z.ZodRawShape> => {
  const { operation: _operation, ...shape } = definition.schema.shape as z.ZodRawShape & { operation: z.ZodType };
  return z.object(shape).strict();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

const renderToolResult = (envelope: AutomationResponse, isError: boolean, text?: string): McpToolResult => ({
  content: [{ type: "text", text: text ?? JSON.stringify(envelope) }],
  structuredContent: envelope as unknown as Record<string, unknown>,
  ...(isError ? { isError: true } : {}),
});

const toolResultSize = (result: McpToolResult): number => Buffer.byteLength(JSON.stringify(result), "utf8");

const compactSummary = (data: unknown): Record<string, unknown> => {
  if (!isRecord(data)) return {};
  const summary: Record<string, unknown> = {};
  for (const key of [
    "path",
    "outputPath",
    "reportPath",
    "manifestPath",
    "targetPath",
    "fileCount",
    "total",
    "count",
    "valid",
    "complete",
    "selfContained",
    "hasChanges",
    "added",
    "removed",
    "changed",
    "identical",
  ]) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") summary[key] = value;
  }
  return summary;
};

const makeResponse = (
  response: AutomationResponse,
  request: AutomationRequest,
  maxResponseBytes: number,
): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
} => {
  const failedValidation =
    request.operation === "pack_validate" && response.ok && isRecord(response.data) && response.data.valid === false;
  const isError = !response.ok || failedValidation;
  const fullResult = renderToolResult(response, isError);
  if (toolResultSize(fullResult) <= maxResponseBytes) {
    return fullResult;
  }

  const requestRecord = request as unknown as Record<string, unknown>;
  const data = response.ok ? response.data : undefined;
  const explicitReport = [requestRecord.reportPath, requestRecord.manifestPath].find(
    (item): item is string => typeof item === "string",
  );
  const returnedReport =
    isRecord(data) && typeof (data.reportPath ?? data.manifestPath) === "string"
      ? String(data.reportPath ?? data.manifestPath)
      : explicitReport;
  const outputPath =
    isRecord(data) && typeof data.outputPath === "string"
      ? data.outputPath
      : isRecord(data) && typeof data.extractedTo === "string"
        ? data.extractedTo
        : undefined;
  const completedWrite =
    response.ok &&
    Boolean(outputPath) &&
    ["pack_create", "pack_write_files", "pack_patch_table", "pack_clone", "pack_subset", "pack_read_file"].includes(
      request.operation,
    );

  if (response.ok && returnedReport) {
    const summary: AutomationResponse = {
      ok: true,
      data: {
        resultOmitted: true,
        reportPath: returnedReport,
        ...(isRecord(data) && typeof data.manifestPath === "string" ? { manifestPath: data.manifestPath } : {}),
        ...(completedWrite ? { completed: true } : {}),
        ...(outputPath ? { outputPath } : {}),
        summary: compactSummary(data),
      },
      diagnostics: response.diagnostics.slice(0, 8),
    };
    const summaryResult = renderToolResult(summary, isError, `Result omitted. Full report: ${returnedReport}`);
    if (toolResultSize(summaryResult) <= maxResponseBytes) {
      return summaryResult;
    }
  }

  const failure: AutomationResponse = {
    ok: false,
    error: {
      code: "VALIDATION",
      message: `Tool result exceeds the ${maxResponseBytes}-byte MCP response limit; reduce the requested result or provide reportPath.`,
      details: {
        resultOmitted: true,
        maxResponseBytes,
        ...(completedWrite ? { completed: true, outputPath } : {}),
      },
    },
  };
  const failureResult = renderToolResult(failure, true, failure.error.message);
  if (toolResultSize(failureResult) <= maxResponseBytes) return failureResult;
  const minimalFailure: AutomationResponse = {
    ok: false,
    error: {
      code: "VALIDATION",
      message: "Tool result exceeded the MCP response limit. Reduce the requested result or provide reportPath.",
      ...(completedWrite && outputPath ? { details: { resultOmitted: true, completed: true, outputPath } } : {}),
    },
  };
  const minimalResult = renderToolResult(minimalFailure, true, minimalFailure.error.message);
  if (toolResultSize(minimalResult) <= maxResponseBytes) return minimalResult;
  const pathOmittedFailure: AutomationResponse = {
    ok: false,
    error: {
      code: "VALIDATION",
      message: "Tool result exceeded the MCP response limit. The requested output path is known to the caller.",
      ...(completedWrite ? { details: { resultOmitted: true, completed: true, pathOmitted: true } } : {}),
    },
  };
  return renderToolResult(pathOmittedFailure, true, pathOmittedFailure.error.message);
};

const cancelledResponse = (): AutomationResponse =>
  failedResponse(new AutomationError("CANCELLED", "Operation was cancelled before it started"));

export const createMcpServer = (options: McpServerOptions): McpServer => {
  const server = new McpServer({ name: "wh3mm-pack-tools", version: "2.31.0" });
  let queue: Promise<void> = Promise.resolve();

  for (const name of Object.keys(operationRegistry) as OperationName[]) {
    const schema = makeInputSchema(operationRegistry[name]);
    server.registerTool(name, { description: descriptions[name], inputSchema: schema }, async (input, extra) => {
      const signal = extra.mcpReq.signal;
      const execute = async () => {
        const requestSignal = options.shutdownSignal ? AbortSignal.any([signal, options.shutdownSignal]) : signal;
        if (requestSignal.aborted) return cancelledResponse();
        const context: AutomationContext = createAutomationContext({
          readRoots: options.readRoots,
          writeRoots: options.writeRoots,
          signal: requestSignal,
        });
        const request = { ...(input as Record<string, unknown>), operation: name } as AutomationRequest;
        return executeAutomationRequest(request, context);
      };
      const current = queue.then(execute, execute);
      queue = current.then(
        () => undefined,
        () => undefined,
      );
      let response: AutomationResponse;
      try {
        response = await current;
      } catch (error) {
        response = failedResponse(error);
      }
      return makeResponse(
        response,
        { ...(input as Record<string, unknown>), operation: name } as AutomationRequest,
        options.maxResponseBytes,
      );
    });
  }
  return server;
};

const helpText = `WH3 Mod Manager headless MCP server

Usage:
  node dist/mcp/server.js --read-root <directory> [--read-root <directory> ...]
    [--write-root <directory> ...] [--max-response-bytes <1024..1048576>]

At least one existing read root is required. Writes are denied unless a write root is supplied.
The server uses JSON-RPC over stdio; keep stdout reserved for protocol messages.
`;

export const startMcpServer = (options: McpServerOptions): StdioServerHandle => {
  const shutdownController = new AbortController();
  const handle = serveStdio(() => createMcpServer({ ...options, shutdownSignal: shutdownController.signal }), {
    onerror: (error) => process.stderr.write(`MCP transport: ${error.message}\n`),
  });
  // Node does not keep a piped stdin alive merely because a data listener is attached.
  // Hold the stdio server open until EOF or a signal, then release this handle promptly.
  const keepAlive = setInterval(() => undefined, 60_000);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    shutdownController.abort();
    void handle.close().catch((error) => process.stderr.write(`MCP shutdown: ${String(error)}\n`));
  };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return handle;
};

export const main = async (argv = process.argv.slice(2)): Promise<number> => {
  try {
    const options = parseMcpArgs(argv);
    if (options.help) {
      process.stdout.write(helpText);
      return 0;
    }
    if (options.readRoots.length === 0)
      throw new AutomationError("INVALID_ARGUMENT", "At least one --read-root is required");
    const readRoots = await validateRoots(options.readRoots, "read");
    const writeRoots = await validateRoots(options.writeRoots, "write");
    startMcpServer({ readRoots, writeRoots, maxResponseBytes: options.maxResponseBytes });
    return 0;
  } catch (error) {
    const response = failedResponse(error);
    if (!response.ok) {
      process.stderr.write(`${response.error.code}: ${response.error.message}\n`);
      return response.error.code === "IO_ACCESS" ? 3 : 2;
    }
    return 1;
  }
};

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
