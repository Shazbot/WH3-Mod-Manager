import type { DBField, DBVersion } from "../packFileTypes";

export type OnnxFeatureType = "float32" | "string";

/** The largest schema version is not necessarily the version used by the current game. */
export const selectOnnxSchemaVersions = (
  schema: Record<string, DBVersion[]>,
  defaultVersions: Record<string, number> = {},
): Record<string, DBVersion[]> =>
  Object.fromEntries(
    Object.entries(schema).map(([name, versions]) => {
      const bareName = name.replace(/^db[\\/]/i, "");
      const selected = versions.find((v) => v.version === defaultVersions[bareName]);
      return [name, selected ? [selected] : versions];
    }),
  );

export interface OnnxPreprocessorInput {
  name: string;
  type: OnnxFeatureType;
}

export interface OnnxJoinStep {
  tableName: string;
  column: string;
  targetTable: string;
  targetColumn: string;
}

export interface OnnxBindingOption {
  id: string;
  tableName: string;
  column: string;
  path: OnnxJoinStep[];
  label: string;
  fieldType?: string;
}

export type OnnxInputBinding =
  | { kind: "column"; tableName: string; column: string; path: OnnxJoinStep[]; missingAsNaN?: boolean }
  | { kind: "column-present"; tableName: string; column: string; path: OnnxJoinStep[] }
  | { kind: "constant"; value: string | number }
  | { kind: "reference-present"; tableName: string; path: OnnxJoinStep[] }
  | { kind: "unresolved"; reason?: string };

export interface OnnxModelDefinition {
  key: string;
  file?: string;
  constant?: number;
  defaultTableName: string;
  defaultColumn: string;
}

export type OnnxOutputMode = "delta" | "add" | "replace";

export interface OnnxOutputBinding {
  enabled: boolean;
  tableName: string;
  column: string;
  path: OnnxJoinStep[];
  mode: OnnxOutputMode;
  /** Optional per-output delta multiplier, overridden by the linked flow option when present. */
  strength?: number;
  strengthOptionId?: string;
  roundPrediction?: boolean;
}

export interface OnnxBundleMetadata {
  inputs: OnnxPreprocessorInput[];
  categoricalMissing: string;
  preprocessorOutput: string;
  models: OnnxModelDefinition[];
  errors: string[];
  warnings: string[];
}

export interface OnnxStandaloneInputMetadata {
  name: string;
  type: "float32" | "string";
  width: number;
}

export interface OnnxStandaloneMetadata {
  inputs: OnnxStandaloneInputMetadata[];
  outputs: Array<{ name: string; type: string; shape: Array<number | string> }>;
  errors: string[];
}

export interface OnnxBundlePaths {
  modelsDirectory: string;
  modelsManifestPath: string;
  preprocessorManifestPath: string;
  preprocessorModelPath: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeOnnxPackPath = (value: string): string => value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

export const isSafeOnnxPackPath = (value: string): boolean => {
  const raw = value.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[a-z]:/i.test(raw) || raw.includes("\0")) return false;
  const normalized = normalizeOnnxPackPath(raw);
  return (
    normalized.length > 0 && normalized.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
};

export const joinOnnxPackPath = (directory: string, file: string): string => {
  if ((directory.trim() && !isSafeOnnxPackPath(directory)) || !isSafeOnnxPackPath(file)) {
    throw new Error(`Unsafe ONNX packed-file path: ${[directory, file].filter(Boolean).join("/")}`);
  }
  const result = [normalizeOnnxPackPath(directory), normalizeOnnxPackPath(file)].filter(Boolean).join("/");
  if (!isSafeOnnxPackPath(result)) throw new Error(`Unsafe ONNX packed-file path: ${result}`);
  return result.replace(/\//g, "\\");
};

export const validateOnnxBundlePaths = (paths: OnnxBundlePaths): void => {
  for (const [label, value] of Object.entries(paths)) {
    if (label === "modelsDirectory" && value.trim() === "") continue;
    if (!isSafeOnnxPackPath(value)) throw new Error(`${label} must be a relative packed-file path`);
  }
};

const parseTableAndColumn = (name: string): { tableAlias: string; column: string } | undefined => {
  const separator = name.indexOf("__");
  if (separator < 1 || separator + 2 >= name.length) return undefined;
  return { tableAlias: name.slice(0, separator), column: name.slice(separator + 2) };
};

export const parseOnnxModelTarget = (key: string): { tableName: string; column: string; isDelta: boolean } => {
  const normalized = key.startsWith("delta_") ? key.slice("delta_".length) : key;
  const parts = parseTableAndColumn(normalized);
  if (!parts) throw new Error(`Model key '${key}' must use the table__column form`);
  const tableAlias = parts.tableAlias.replace(/_tables$/i, "");
  if (!tableAlias) throw new Error(`Model key '${key}' has an invalid table name`);
  return {
    tableName: `${tableAlias}_tables`,
    column: parts.column,
    isDelta: key.startsWith("delta_"),
  };
};

export const parseOnnxBundleMetadata = (modelsText: string, preprocessorText: string): OnnxBundleMetadata => {
  let modelsRaw: unknown;
  let preprocessorRaw: unknown;
  try {
    modelsRaw = JSON.parse(modelsText);
  } catch (error) {
    throw new Error(`Invalid models manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    preprocessorRaw = JSON.parse(preprocessorText);
  } catch (error) {
    throw new Error(`Invalid preprocessor manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(modelsRaw) || !isRecord(preprocessorRaw)) throw new Error("ONNX manifests must contain JSON objects");

  const rawInputs = preprocessorRaw.inputs;
  if (!Array.isArray(rawInputs)) throw new Error("preprocessor.inputs must be an array");
  const seenInputs = new Set<string>();
  const inputs = rawInputs.map((item, index) => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) {
      throw new Error(`preprocessor.inputs[${index}] must have a non-empty name`);
    }
    if (item.type !== "float32" && item.type !== "string") {
      throw new Error(`preprocessor.inputs[${index}].type must be float32 or string`);
    }
    if (seenInputs.has(item.name)) throw new Error(`Duplicate preprocessor input '${item.name}'`);
    seenInputs.add(item.name);
    return { name: item.name, type: item.type } as OnnxPreprocessorInput;
  });
  if (inputs.length === 0) throw new Error("preprocessor.inputs must not be empty");
  if (typeof preprocessorRaw.categorical_missing !== "string") {
    throw new Error("preprocessor.categorical_missing must be a string");
  }
  if (typeof preprocessorRaw.output !== "string" || !preprocessorRaw.output) {
    throw new Error("preprocessor.output must be a non-empty string");
  }

  const warnings: string[] = [];
  const models = Object.entries(modelsRaw).map(([key, value]) => {
    const target = parseOnnxModelTarget(key);
    if (!isRecord(value)) throw new Error(`Model '${key}' must be an object`);
    const hasFile = typeof value.file === "string" && value.file.trim().length > 0;
    const hasConstant = typeof value.constant === "number" && Number.isFinite(value.constant);
    if (hasFile === hasConstant) throw new Error(`Model '${key}' must define exactly one of file or constant`);
    let file: string | undefined;
    if (hasFile) {
      if (!isSafeOnnxPackPath(value.file as string)) throw new Error(`Model '${key}' has an unsafe file path`);
      file = normalizeOnnxPackPath(value.file as string);
    }
    if (hasConstant) {
      warnings.push(`'${key}' uses a constant prediction`);
    }
    return {
      key,
      ...(file ? { file } : { constant: value.constant as number }),
      defaultTableName: target.tableName,
      defaultColumn: target.column,
    };
  });
  if (models.length === 0) throw new Error("models manifest must contain at least one output");

  return {
    inputs,
    categoricalMissing: preprocessorRaw.categorical_missing,
    preprocessorOutput: preprocessorRaw.output,
    models,
    errors: [],
    warnings,
  };
};

const normalizeSchemaTableName = (name: string): string =>
  name
    .replace(/^db[\\/]/i, "")
    .replace(/[\\/].*$/, "")
    .toLowerCase();

interface OnnxSchemaGraph {
  names: Map<string, string>;
  outgoing: Map<string, OnnxJoinStep[]>;
  incoming: Map<string, Set<string>>;
  paths: Map<string, OnnxJoinStep[][]>;
}

// Each inspection selects a fresh schema snapshot. Index it once, rather than scanning every
// table and reference again at every hop of every candidate-column search.
const schemaGraphs = new WeakMap<Record<string, DBVersion[]>, OnnxSchemaGraph>();
const getSchemaGraph = (schema: Record<string, DBVersion[]>): OnnxSchemaGraph => {
  const cached = schemaGraphs.get(schema);
  if (cached) return cached;
  const graph: OnnxSchemaGraph = {
    names: new Map(Object.keys(schema).map((name) => [normalizeSchemaTableName(name), name])),
    outgoing: new Map(),
    incoming: new Map(),
    paths: new Map(),
  };
  for (const [name, versions] of Object.entries(schema)) {
    const edges = new Map<string, OnnxJoinStep>();
    for (const version of versions)
      for (const field of version.fields ?? []) {
        const reference = field.is_reference;
        if (!reference?.[0] || !reference[1]) continue;
        const targetTable = graph.names.get(normalizeSchemaTableName(reference[0]));
        if (!targetTable) continue;
        const step = { tableName: name, column: field.name, targetTable, targetColumn: reference[1] };
        edges.set(`${step.column}\0${step.targetTable}\0${step.targetColumn}`, step);
        const parents = graph.incoming.get(targetTable) ?? new Set<string>();
        parents.add(name);
        graph.incoming.set(targetTable, parents);
      }
    graph.outgoing.set(name, [...edges.values()]);
  }
  schemaGraphs.set(schema, graph);
  return graph;
};

const getSchemaTableNameForAlias = (alias: string, schema: Record<string, DBVersion[]>): string | undefined =>
  getSchemaGraph(schema).names.get(`${alias}_tables`.toLowerCase());

const getTableFields = (tableName: string, schema: Record<string, DBVersion[]>): DBField[] => {
  const key = getSchemaGraph(schema).names.get(normalizeSchemaTableName(tableName));
  return key ? (schema[key]?.[0]?.fields ?? []) : [];
};

const getForwardEdges = (schema: Record<string, DBVersion[]>, tableName: string): OnnxJoinStep[] => {
  const graph = getSchemaGraph(schema);
  const key = graph.names.get(normalizeSchemaTableName(tableName));
  return key ? (graph.outgoing.get(key) ?? []) : [];
};

export const findOnnxForwardPaths = (
  rootTableName: string,
  targetTableName: string,
  schema: Record<string, DBVersion[]>,
  maxDepth = 8,
): OnnxJoinStep[][] => {
  const graph = getSchemaGraph(schema);
  const root = graph.names.get(normalizeSchemaTableName(rootTableName));
  const target = graph.names.get(normalizeSchemaTableName(targetTableName));
  if (!root || !target) return [];
  if (root === target) return [[]];
  const cacheKey = JSON.stringify([root, target, maxDepth]);
  const cached = graph.paths.get(cacheKey);
  if (cached) return cached;

  // A reverse breadth-first pass rules out dead branches before enumerating paths. The
  // previous DFS explored the entire branching schema repeatedly for unreachable tables.
  const distance = new Map<string, number>([[target, 0]]);
  const queue = [target];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const depth = distance.get(current)!;
    if (depth >= maxDepth) continue;
    for (const parent of graph.incoming.get(current) ?? []) {
      if (distance.has(parent)) continue;
      distance.set(parent, depth + 1);
      queue.push(parent);
    }
  }
  if (!distance.has(root)) {
    graph.paths.set(cacheKey, []);
    return [];
  }

  const results: OnnxJoinStep[][] = [];
  const visit = (current: string, path: OnnxJoinStep[], seen: Set<string>) => {
    if (path.length >= maxDepth || results.length > 1) return;
    for (const edge of getForwardEdges(schema, current)) {
      const next = normalizeSchemaTableName(edge.targetTable);
      if (seen.has(next)) continue;
      const remaining = distance.get(edge.targetTable);
      if (remaining === undefined || path.length + 1 + remaining > maxDepth) continue;
      const nextPath = [...path, edge];
      if (next === normalizeSchemaTableName(target)) {
        results.push(nextPath);
        if (results.length > 1) return;
        continue;
      }
      const nextSeen = new Set(seen);
      nextSeen.add(next);
      visit(edge.targetTable, nextPath, nextSeen);
    }
  };
  visit(root, [], new Set([normalizeSchemaTableName(root)]));
  graph.paths.set(cacheKey, results);
  return results;
};

const makeBindingOption = (
  tableName: string,
  column: string,
  path: OnnxJoinStep[],
  fieldType?: string,
): OnnxBindingOption => ({
  id: `${normalizeSchemaTableName(tableName)}|${column}|${path.map((step) => `${step.tableName}.${step.column}`).join(">")}`,
  tableName,
  column,
  path,
  label: `${tableName}.${column}${path.length > 0 ? ` via ${path.map((step) => `${step.tableName}.${step.column}`).join(" → ")}` : ""}`,
  fieldType,
});

const NUMERIC_ONNX_FIELD_TYPES = new Set(["Boolean", "I16", "I32", "I64", "F32", "F64", "ColourRGB"]);
const STRING_ONNX_FIELD_TYPES = new Set(["StringU8", "StringU16", "OptionalStringU8", "OptionalStringU16"]);

/** Lists editable schema columns reachable from the root through zero or more forward references. */
export const getOnnxColumnBindingOptions = (
  rootTableName: string,
  schema: Record<string, DBVersion[]>,
  type: OnnxFeatureType | "numeric-output" | "any" = "float32",
): OnnxBindingOption[] => {
  const options: OnnxBindingOption[] = [];
  for (const tableName of Object.keys(schema)) {
    const paths = findOnnxForwardPaths(rootTableName, tableName, schema);
    if (paths.length === 0) continue;
    for (const field of getTableFields(tableName, schema)) {
      const matches =
        type === "any"
          ? NUMERIC_ONNX_FIELD_TYPES.has(field.field_type) || STRING_ONNX_FIELD_TYPES.has(field.field_type)
          : type === "numeric-output" || type === "float32"
            ? NUMERIC_ONNX_FIELD_TYPES.has(field.field_type)
            : STRING_ONNX_FIELD_TYPES.has(field.field_type);
      if (!matches) continue;
      for (const path of paths) options.push(makeBindingOption(tableName, field.name, path, field.field_type));
    }
  }
  return options.sort((first, second) => first.label.localeCompare(second.label));
};

export interface OnnxInputBindingInference {
  defaultBinding: OnnxInputBinding;
  options: OnnxBindingOption[];
  paths: OnnxJoinStep[][];
}

export const inferOnnxInputBinding = (
  input: OnnxPreprocessorInput,
  rootTableName: string,
  schema: Record<string, DBVersion[]>,
): OnnxInputBindingInference => {
  const target = parseTableAndColumn(input.name);
  if (input.name === "is_ranged" || !target) {
    const options = Object.keys(schema)
      .map((tableName) => ({ tableName, path: findOnnxForwardPaths(rootTableName, tableName, schema) }))
      .filter((candidate) => candidate.path.length > 0 && candidate.path[0].length > 0)
      .map((candidate) => {
        const keyField = getTableFields(candidate.tableName, schema).find((field) => field.is_key);
        return keyField
          ? candidate.path.map((path) => makeBindingOption(candidate.tableName, keyField.name, path))
          : [];
      })
      .flat()
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      defaultBinding: { kind: "unresolved", reason: "Set this input explicitly" },
      options,
      paths: [],
    };
  }

  const tableName = getSchemaTableNameForAlias(target.tableAlias, schema);
  if (!tableName) {
    return {
      defaultBinding: { kind: "unresolved", reason: `No schema table matches '${target.tableAlias}'` },
      options: [],
      paths: [],
    };
  }
  const paths = findOnnxForwardPaths(rootTableName, tableName, schema);
  const hasField = getTableFields(tableName, schema).some((field) => field.name === target.column);
  const options = hasField
    ? paths.map((candidatePath) => makeBindingOption(tableName, target.column, candidatePath))
    : [];
  const defaultBinding: OnnxInputBinding =
    options.length === 1
      ? { kind: "column", tableName, column: target.column, path: paths[0] }
      : {
          kind: "unresolved",
          reason: !hasField
            ? `Column '${target.column}' does not exist in ${tableName}`
            : paths.length > 1
              ? `More than one forward reference path reaches ${tableName}`
              : `No forward reference path reaches ${tableName}`,
        };
  return { defaultBinding, options, paths };
};

export const inferOnnxOutputBinding = (
  model: OnnxModelDefinition,
  rootTableName: string,
  schema: Record<string, DBVersion[]>,
): OnnxOutputBinding => {
  const paths = findOnnxForwardPaths(rootTableName, model.defaultTableName, schema);
  return {
    enabled: true,
    tableName: model.defaultTableName,
    column: model.defaultColumn,
    path: paths.length === 1 ? paths[0] : [],
    mode: model.key.startsWith("delta_") ? "delta" : "replace",
  };
};

export const isUnambiguousOnnxPath = (
  path: OnnxJoinStep[],
  rootTableName: string,
  targetTableName: string,
  schema: Record<string, DBVersion[]>,
): boolean => {
  const paths = findOnnxForwardPaths(rootTableName, targetTableName, schema);
  return paths.length === 1 && JSON.stringify(paths[0]) === JSON.stringify(path);
};

export const isValidOnnxForwardPath = (
  path: OnnxJoinStep[],
  rootTableName: string,
  targetTableName: string,
  schema: Record<string, DBVersion[]>,
): boolean => {
  let current = Object.keys(schema).find(
    (name) => normalizeSchemaTableName(name) === normalizeSchemaTableName(rootTableName),
  );
  const target = Object.keys(schema).find(
    (name) => normalizeSchemaTableName(name) === normalizeSchemaTableName(targetTableName),
  );
  if (!current || !target) return false;
  if (path.length === 0) return normalizeSchemaTableName(current) === normalizeSchemaTableName(target);
  for (const step of path) {
    if (normalizeSchemaTableName(current) !== normalizeSchemaTableName(step.tableName)) return false;
    const valid = getForwardEdges(schema, current).some(
      (edge) =>
        edge.column === step.column &&
        normalizeSchemaTableName(edge.targetTable) === normalizeSchemaTableName(step.targetTable) &&
        edge.targetColumn === step.targetColumn,
    );
    if (!valid) return false;
    current = Object.keys(schema).find(
      (name) => normalizeSchemaTableName(name) === normalizeSchemaTableName(step.targetTable),
    );
    if (!current) return false;
  }
  return normalizeSchemaTableName(current) === normalizeSchemaTableName(target);
};

export interface OnnxSourceRow {
  tableName: string;
  row: ReadonlyArray<{ name: string; resolvedKeyValue: string }>;
}

export const resolveOnnxBindingValue = (
  binding: OnnxInputBinding | undefined,
  rootRow: ReadonlyArray<{ name: string; resolvedKeyValue: string }>,
  inputType: OnnxFeatureType,
  categoricalMissing: string,
  resolvePath: (
    path: OnnxJoinStep[],
    rootRow: ReadonlyArray<{ name: string; resolvedKeyValue: string }>,
  ) => ReadonlyArray<{ name: string; resolvedKeyValue: string }> | undefined,
): string | number => {
  const missing =
    inputType === "string" ? categoricalMissing : binding?.kind === "column" && binding.missingAsNaN ? NaN : 0;
  if (!binding || binding.kind === "unresolved")
    throw new Error(binding?.reason || "An ONNX input binding is unresolved");
  if (binding.kind === "constant") {
    const value = binding.value;
    if (inputType === "string") return String(value);
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Constant '${String(value)}' is not a finite number`);
    return numeric;
  }
  if (binding.kind === "reference-present") return resolvePath(binding.path, rootRow) ? 1 : 0;
  const resolvedRow = binding.path.length === 0 ? rootRow : resolvePath(binding.path, rootRow);
  const value = resolvedRow?.find((cell) => cell.name === binding.column)?.resolvedKeyValue;
  if (binding.kind === "column-present") return value === undefined || value === "" ? 0 : 1;
  if (value === undefined || value === "") return missing;
  if (inputType === "string") return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
};

export const buildOnnxInputTensors = (
  inputs: OnnxPreprocessorInput[],
  bindings: Record<string, OnnxInputBinding>,
  rows: ReadonlyArray<ReadonlyArray<{ name: string; resolvedKeyValue: string }>>,
  categoricalMissing: string,
  resolvePath: (
    path: OnnxJoinStep[],
    rootRow: ReadonlyArray<{ name: string; resolvedKeyValue: string }>,
  ) => ReadonlyArray<{ name: string; resolvedKeyValue: string }> | undefined,
): Record<string, { type: OnnxFeatureType; data: Float32Array | string[]; dims: number[] }> => {
  const feeds: Record<string, { type: OnnxFeatureType; data: Float32Array | string[]; dims: number[] }> = {};
  for (const input of inputs) {
    const values = rows.map((row) =>
      resolveOnnxBindingValue(bindings[input.name], row, input.type, categoricalMissing, resolvePath),
    );
    feeds[input.name] = {
      type: input.type,
      data: input.type === "float32" ? Float32Array.from(values.map(Number)) : values.map(String),
      dims: [rows.length, 1],
    };
  }
  return feeds;
};

export const combineOnnxPrediction = (
  currentValue: string,
  prediction: number,
  mode: OnnxOutputMode,
  strength: number,
): number => {
  if (!Number.isFinite(prediction)) throw new Error(`ONNX prediction is not finite: ${prediction}`);
  if (mode === "replace") return prediction;
  const current = Number(currentValue);
  if (!Number.isFinite(current)) throw new Error(`Target value '${currentValue}' is not numeric`);
  const multiplier = mode === "delta" ? strength : 1;
  const value = current + multiplier * prediction;
  if (!Number.isFinite(value)) throw new Error("ONNX result is not finite");
  return value;
};

export const formatOnnxPrediction = (value: number, fieldType: string): string => {
  if (!Number.isFinite(value)) throw new Error("ONNX output must be finite");
  if (fieldType === "I16" || fieldType === "I32" || fieldType === "I64") return String(Math.round(value));
  if (fieldType === "Boolean") {
    const rounded = Math.round(value);
    if (rounded !== 0 && rounded !== 1) throw new Error(`Boolean output ${value} is outside the range [0, 1]`);
    return String(rounded);
  }
  if (fieldType !== "F32" && fieldType !== "F64") throw new Error(`Cannot write ONNX prediction to ${fieldType}`);
  return String(value);
};

export const getOnnxInputUnresolvedIssues = (
  inputs: OnnxPreprocessorInput[],
  bindings: Record<string, OnnxInputBinding>,
): string[] =>
  inputs.flatMap((input) => {
    const binding = bindings[input.name];
    if (!binding) return [`${input.name}: not assigned`];
    if (binding.kind === "unresolved") return [`${input.name}: ${binding.reason || "unresolved"}`];
    return [];
  });
