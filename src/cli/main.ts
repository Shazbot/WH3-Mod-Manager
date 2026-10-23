import * as fs from "node:fs/promises";
import { inspect } from "node:util";
import { parseArgs } from "node:util";
import { executeAutomationRequest, defaultAutomationContext, getExitCodeForAutomationError } from "../automation/registry";
import { AutomationError, automationErrorFromUnknown } from "../automation/errors";

const rootHelp = `Usage:
  whmm pack info <packPath>
  whmm pack list <packPath> [--path-prefix <path>] [--glob <pattern>]
  whmm pack read <packPath> <filePath> [--output <file>]
  whmm pack search <packPath> <query> [--max-results <number>]
  whmm pack create <outputPath> [--input <jsonFile>]
  whmm pack write <packPath> --output <outputPath> --input <jsonFile>
  whmm pack validate <packPath> [--full-payloads]
  whmm pack clone <packPath> --output <outputPath>
  whmm pack diff <beforePath> <afterPath> [--details]
  whmm pack subset <sourcePackPath> --include <glob> --output <outputPath> [--input <jsonFile>]
  whmm pack table read <packPath> <tablePath>
  whmm pack table query <packPath> <tablePath> --input <jsonFile>
  whmm pack table patch <packPath> <tablePath> --output <outputPath> --input <jsonFile>
  whmm asset resolve --input <jsonFile>
  whmm asset references --input <jsonFile>

Flags:
  --format text|json   Select readable or machine-readable output (default text)
  --input <file>       JSON operation fields for create, write, query, patch, subset, and asset tools
  --output <path>      Output pack or extracted file path
  --report <path>      Write the full result as a JSON report
  --include <glob>     Add a packed path glob to a subset selection (repeatable)
  --closure <mode>     Subset closure: none, direct, or transitive
  --mode <mode>        Subset mode: external or selfContained
  --strict             Reject incomplete requested closure
  --include-vanilla    Copy vanilla dependencies in selfContained mode
  --details            Include bounded semantic file-diff details
  --semantic-offset    Semantic detail offset (default 0)
  --semantic-limit     Semantic detail page size (default 100)
  --overwrite          Atomically replace an existing output file
  --offset <number>    Result offset (default 0)
  --limit <number>     Result page size (default 100)
  --help               Show help at any command level`;

const options = {
  format: { type: "string" as const, default: "text" },
  input: { type: "string" as const },
  output: { type: "string" as const },
  report: { type: "string" as const },
  overwrite: { type: "boolean" as const },
  offset: { type: "string" as const },
  limit: { type: "string" as const },
  "path-prefix": { type: "string" as const },
  glob: { type: "string" as const },
  "file-glob": { type: "string" as const },
  query: { type: "string" as const },
  "case-sensitive": { type: "boolean" as const },
  regex: { type: "boolean" as const },
  "no-content": { type: "boolean" as const },
  "max-results": { type: "string" as const },
  "full-payloads": { type: "boolean" as const },
  "verify-sha256": { type: "boolean" as const },
  details: { type: "boolean" as const },
  "semantic-offset": { type: "string" as const },
  "semantic-limit": { type: "string" as const },
  include: { type: "string" as const, multiple: true },
  closure: { type: "string" as const },
  mode: { type: "string" as const },
  strict: { type: "boolean" as const },
  "no-strict": { type: "boolean" as const },
  "include-vanilla": { type: "boolean" as const },
  "extract-to": { type: "string" as const },
  "pack-type": { type: "string" as const },
  help: { type: "boolean" as const },
};

const parseCliArgs = (args: readonly string[]) => parseArgs({ args, options, allowPositionals: true, strict: true });
type CliValues = ReturnType<typeof parseCliArgs>["values"];

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

const readInput = async (
  filePath: string | undefined,
  context: ReturnType<typeof defaultAutomationContext>,
): Promise<Record<string, unknown>> => {
  if (!filePath) return {};
  const input = await context.policy.readFile(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.bytes.toString("utf8"));
  } catch (error) {
    throw new AutomationError("INVALID_ARGUMENT", `Could not parse JSON input file: ${filePath}`, error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AutomationError("INVALID_ARGUMENT", "JSON input must contain an object");
  }
  return parsed as Record<string, unknown>;
};

const numericOption = (value: string | undefined, flagName: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new AutomationError("INVALID_ARGUMENT", `--${flagName} must be a non-negative integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new AutomationError("INVALID_ARGUMENT", `--${flagName} exceeds the safe integer range`);
  return number;
};

const ensurePositionals = (command: readonly string[], min: number, max = min): void => {
  if (command.length < min || command.length > max) {
    throw new AutomationError("INVALID_ARGUMENT", `Unexpected positional arguments: ${command.join(" ")}`);
  }
};

const buildRequest = async (
  command: readonly string[],
  values: CliValues,
  context: ReturnType<typeof defaultAutomationContext>,
): Promise<unknown> => {
  const extra = await readInput(values.input, context);
  const common: Record<string, unknown> = { ...extra };
  if (values.report !== undefined) common.reportPath = values.report;
  if (values.overwrite !== undefined) common.overwrite = values.overwrite;
  const offset = numericOption(values.offset, "offset");
  const limit = numericOption(values.limit, "limit");
  if (offset !== undefined) common.offset = offset;
  if (limit !== undefined) common.limit = limit;

  const [group, action, first, second, third] = command;
  if (group === "pack") {
    if (action === "info") {
      ensurePositionals(command, 3);
      return { ...common, operation: "pack_info", packPath: first };
    }
    if (action === "list") {
      ensurePositionals(command, 3);
      if (values["path-prefix"] !== undefined) common.pathPrefix = values["path-prefix"];
      if (values.glob !== undefined) common.glob = values.glob;
      return { ...common, operation: "pack_list_files", packPath: first };
    }
    if (action === "read") {
      ensurePositionals(command, 4);
      const extractTo = values["extract-to"] ?? values.output;
      return {
        ...common,
        operation: "pack_read_file",
        packPath: first,
        filePath: second,
        ...(extractTo === undefined ? {} : { extractTo }),
      };
    }
    if (action === "search") {
      ensurePositionals(command, 3, 4);
      if (values.query !== undefined && second !== undefined) throw new AutomationError("INVALID_ARGUMENT", "Provide the search query either as a positional argument or --query");
      const maxResults = numericOption(values["max-results"], "max-results");
      const query = values.query ?? second ?? extra.query;
      return {
        ...common,
        operation: "pack_search",
        packPath: first,
        ...(query === undefined ? {} : { query }),
        ...(values["file-glob"] === undefined ? {} : { fileGlob: values["file-glob"] }),
        ...(values["case-sensitive"] === undefined ? {} : { caseSensitive: values["case-sensitive"] }),
        ...(values.regex === undefined ? {} : { regex: values.regex }),
        ...(values["no-content"] ? { content: false } : {}),
        ...(maxResults === undefined ? {} : { maxResults }),
      };
    }
    if (action === "create") {
      ensurePositionals(command, values.output || extra.outputPath ? 2 : 3);
      const outputPath = values.output ?? extra.outputPath ?? first;
      return {
        ...common,
        operation: "pack_create",
        outputPath,
        ...(values["pack-type"] === undefined ? {} : { packType: values["pack-type"] }),
      };
    }
    if (action === "write") {
      ensurePositionals(command, 3);
      return { ...common, operation: "pack_write_files", packPath: first, ...(values.output === undefined && extra.outputPath === undefined ? {} : { outputPath: values.output ?? extra.outputPath }) };
    }
    if (action === "validate") {
      ensurePositionals(command, 3);
      return { ...common, operation: "pack_validate", packPath: first, ...(values["full-payloads"] ? { fullPayloads: true } : {}) };
    }
    if (action === "clone") {
      ensurePositionals(command, 3);
      return { ...common, operation: "pack_clone", packPath: first, ...(values.output === undefined && extra.outputPath === undefined ? {} : { outputPath: values.output ?? extra.outputPath }), ...(values["verify-sha256"] ? { verifySha256: true } : {}) };
    }
    if (action === "diff") {
      ensurePositionals(command, 4);
      if (values.details) common.details = true;
      if (values["path-prefix"] !== undefined) common.pathPrefix = values["path-prefix"];
      if (values.glob !== undefined) common.glob = values.glob;
      const semanticOffset = numericOption(values["semantic-offset"], "semantic-offset");
      const semanticLimit = numericOption(values["semantic-limit"], "semantic-limit");
      if (semanticOffset !== undefined) common.semanticOffset = semanticOffset;
      if (semanticLimit !== undefined) common.semanticLimit = semanticLimit;
      return { ...common, operation: "pack_diff", beforePath: first, afterPath: second };
    }
    if (action === "subset") {
      ensurePositionals(command, 3);
      if (values.strict && values["no-strict"]) throw new AutomationError("INVALID_ARGUMENT", "Use only one of --strict or --no-strict");
      const includes = values.include === undefined ? [] : Array.isArray(values.include) ? values.include : [values.include];
      const globs = [...(Array.isArray(extra.globs) ? extra.globs.filter((item): item is string => typeof item === "string") : []), ...includes];
      return {
        ...common,
        operation: "pack_subset",
        sourcePackPaths: Array.isArray(extra.sourcePackPaths) ? extra.sourcePackPaths : [first],
        ...(values.output === undefined && extra.outputPath === undefined ? {} : { outputPath: values.output ?? extra.outputPath }),
        ...(globs.length ? { globs } : {}),
        ...(values.closure === undefined ? {} : { closure: values.closure }),
        ...(values.mode === undefined ? {} : { mode: values.mode }),
        ...(values.strict ? { strict: true } : values["no-strict"] ? { strict: false } : {}),
        ...(values["include-vanilla"] ? { includeVanilla: true } : {}),
      };
    }
    if (action === "table") {
      const [, , tableAction, packPath, tablePath] = command;
      if (!["read", "query", "patch"].includes(tableAction)) throw new AutomationError("INVALID_ARGUMENT", `Unknown table command: ${tableAction ?? "(empty)"}`);
      ensurePositionals(command, 5);
      const operation = tableAction === "read" ? "pack_read_table" : tableAction === "query" ? "pack_query_table" : "pack_patch_table";
      return { ...common, operation, packPath, tablePath, ...(values.output === undefined && extra.outputPath === undefined ? {} : { outputPath: values.output ?? extra.outputPath }) };
    }
  }
  if (group === "asset") {
    ensurePositionals(command, 2);
    if (!values.input) throw new AutomationError("INVALID_ARGUMENT", `asset ${action} requires --input <jsonFile>`);
    if (action === "resolve") return { ...extra, ...common, operation: "asset_resolve_references" };
    if (action === "references" || action === "find-references") return { ...extra, ...common, operation: "asset_find_references" };
  }
  if (group === "table") {
    ensurePositionals(command, 4);
    if (!["read", "query", "patch"].includes(action)) throw new AutomationError("INVALID_ARGUMENT", `Unknown table command: ${action ?? "(empty)"}`);
    const operation = action === "read" ? "pack_read_table" : action === "query" ? "pack_query_table" : "pack_patch_table";
    return { ...common, operation, packPath: first, tablePath: second, ...(values.output === undefined && extra.outputPath === undefined ? {} : { outputPath: values.output ?? extra.outputPath }) };
  }
  throw new AutomationError("INVALID_ARGUMENT", `Unknown command: ${command.join(" ") || "(empty)"}`);
};

const printHelp = (io: CliIo, command: readonly string[]): void => {
  io.stdout(`${rootHelp}${command.length ? `\n\nCommand: ${command.join(" ")}` : ""}\n`);
};

export const main = async (argv = process.argv.slice(2), io: CliIo = defaultIo): Promise<number> => {
  const context = defaultAutomationContext();
  let format: string | undefined;
  try {
    const parsed = parseCliArgs([...argv]);
    const command = parsed.positionals;
    format = parsed.values.format;
    if (parsed.values.help || command.length === 0 || command.includes("help")) {
      printHelp(io, command);
      return 0;
    }
    if (format !== "json" && format !== "text") throw new AutomationError("INVALID_ARGUMENT", `Unsupported output format: ${format}`);
    const request = await buildRequest(command, parsed.values, context);
    if (parsed.values.input) {
      const inputPath = await context.policy.assertReadPath(parsed.values.input);
      if (request && typeof request === "object") {
        const candidate = request as Record<string, unknown>;
        const outputs = [candidate.outputPath, candidate.extractTo, candidate.reportPath, candidate.manifestPath].filter((value): value is string => typeof value === "string");
        for (const outputPath of outputs) await context.policy.assertOutputDistinctFromSources(outputPath, [inputPath]);
      }
    }
    const response = await executeAutomationRequest(request, context);
    if (!response.ok) {
      io.stdout(`${JSON.stringify(response)}\n`);
      io.stderr(`${response.error.code}: ${response.error.message}\n`);
      return getExitCodeForAutomationError(response.error.code);
    }
    for (const item of response.diagnostics) {
      io.stderr(`[${item.severity}] ${item.code}: ${item.message}${item.path ? ` (${item.path})` : ""}\n`);
    }
    if (format === "json") io.stdout(`${JSON.stringify(response)}\n`);
    else io.stdout(`${inspect(response.data, { colors: io === defaultIo && process.stdout.isTTY, depth: null, compact: false })}\n`);
    if (request && typeof request === "object" && (request as Record<string, unknown>).operation === "pack_validate" && (response.data as { valid?: boolean }).valid === false) return 5;
    return 0;
  } catch (error) {
    const normalized = automationErrorFromUnknown(error);
    const failure = {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    };
    io.stdout(`${JSON.stringify(failure)}\n`);
    io.stderr(`${normalized.code}: ${normalized.message}\n`);
    return getExitCodeForAutomationError(normalized.code);
  }
};

if (require.main === module) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
