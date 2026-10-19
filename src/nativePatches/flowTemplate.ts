import * as crypto from "crypto";
import { parseJsonWithoutDuplicateKeys } from "./json";
import {
  MAX_MANIFEST_BYTES,
  MAX_TOTAL_PAYLOAD_BYTES,
  NativePatchManifest,
  parseAndValidateNativePatchManifest,
} from "./manifest";

export const NATIVE_PATCH_FLOW_TEMPLATE_FORMAT = "wh3-native-patch-template";
export const NATIVE_PATCH_FLOW_CONTRIBUTION_FORMAT = "wh3-native-patch-contribution";
export const NATIVE_PATCH_FLOW_FORMAT_VERSION = 1;
export const MAX_NATIVE_PATCH_FLOW_TEMPLATE_BYTES = MAX_MANIFEST_BYTES;
export const MAX_NATIVE_PATCH_FLOW_INPUT_ROWS = 100_000;
export const MAX_NATIVE_PATCH_FLOW_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_NATIVE_PATCH_FLOW_CONTRIBUTION_BYTES = 160 * 1024 * 1024;

export type NativePatchFlowScalarInput = { id: string; parameter: string };
export type NativePatchFlowTableInput = {
  id: string;
  table_name: string;
  parameter: string;
  max_rows: number;
  group_by: string;
  value_column: string;
  provider_merge: "identical_by_group";
};
export type NativePatchFlowTemplate = {
  format: typeof NATIVE_PATCH_FLOW_TEMPLATE_FORMAT;
  format_version: 1;
  template: { id: string; version: string; name: string };
  native_patch: NativePatchManifest;
  inputs: { scalars: NativePatchFlowScalarInput[]; tables: NativePatchFlowTableInput[] };
  fingerprint: string;
  rawBytes: Buffer;
};
export type NativePatchFlowProvenance = {
  sourcePack: string;
  flowFile: string;
  nodeId: string;
};
export type NativePatchFlowContribution = {
  format: typeof NATIVE_PATCH_FLOW_CONTRIBUTION_FORMAT;
  format_version: 1;
  template: { id: string; version: string; fingerprint: string };
  template_base64: string;
  payloads: Array<{ path: string; sha256: string; size: number; base64: string }>;
  inputs: { scalars: Record<string, unknown>; tables: Record<string, Array<Record<string, unknown>>> };
  provenance: NativePatchFlowProvenance;
};
/** A terminal flow's contribution, retained only for the current launch. */
export type NativePatchFlowRuntimeContribution = {
  sourcePackPath: string;
  sourceModName: string;
  fileName: string;
  bytes: Buffer;
};

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[], where: string) => {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new Error(`${where}: missing required field '${key}'`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${where}: unknown field '${key}'`);
};
const expectString = (value: unknown, where: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: expected a nonempty string`);
  return value;
};
const expectId = (value: unknown, where: string): string => {
  const result = expectString(value, where);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result)) throw new Error(`${where}: invalid identifier '${result}'`);
  return result;
};
const expectObject = (value: unknown, where: string): Record<string, any> => {
  if (!isObject(value)) throw new Error(`${where}: expected an object`);
  return value;
};
const expectArray = (value: unknown, where: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  return value;
};
const expectInteger = (value: unknown, where: string, min: number, max: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${where}: expected an integer between ${min} and ${max}`);
  }
  return value as number;
};
const sha256 = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const decodeBase64 = (value: unknown, where: string, maxBytes: number): Buffer => {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(maxBytes / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value)
  ) {
    throw new Error(`${where}: expected canonical Base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value)
    throw new Error(`${where}: invalid or oversized Base64`);
  return bytes;
};
const safeRelativePath = (value: unknown, where: string): string => {
  const result = expectString(value, where).replace(/\\/g, "/");
  if (
    result.startsWith("/") ||
    /^[A-Za-z]:/.test(result) ||
    result.split("/").some((part) => !part || part === "." || part === "..") ||
    result.includes("\0")
  ) {
    throw new Error(`${where}: expected a normalized relative pack path`);
  }
  return result;
};

const validateScalarValue = (parameter: Record<string, any>, value: unknown, where: string): unknown => {
  switch (parameter.type) {
    case "bool":
      if (typeof value !== "boolean") throw new Error(`${where}: expected a boolean`);
      break;
    case "u32":
    case "i32":
    case "f32":
      if (typeof value !== "number" || !Number.isFinite(value) || value < parameter.min || value > parameter.max) {
        throw new Error(`${where}: expected a number within [${parameter.min}, ${parameter.max}]`);
      }
      if (parameter.type !== "f32" && !Number.isInteger(value)) throw new Error(`${where}: expected an integer`);
      if (parameter.type === "f32" && !Number.isFinite(Math.fround(value)))
        throw new Error(`${where}: value is outside float32 range`);
      break;
    case "ascii_key_list": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^[A-Za-z0-9_]+$/.test(item))) {
        throw new Error(`${where}: expected ASCII identifier strings`);
      }
      const values = [...new Set(value as string[])];
      if (
        values.length > parameter.capacity ||
        values.some((item) => Buffer.byteLength(item, "ascii") > parameter.max_key_bytes)
      ) {
        throw new Error(`${where}: list exceeds the declared capacity or key width`);
      }
      return values;
    }
    default:
      throw new Error(`${where}: parameter type '${parameter.type}' cannot be bound as a scalar`);
  }
  return value;
};

const validateTableRows = (
  parameter: Record<string, any>,
  declaration: NativePatchFlowTableInput,
  rows: unknown,
  where: string,
): Array<Record<string, unknown>> => {
  const list = expectArray(rows, where);
  if (list.length > declaration.max_rows || list.length > parameter.capacity) {
    throw new Error(`${where}: row count exceeds its declared capacity`);
  }
  const columns = parameter.columns as Array<{ name: string; type: string; max_bytes?: number }>;
  const normalized = list.map((raw, index) => {
    const row = expectObject(raw, `${where}[${index}]`);
    exactKeys(
      row,
      columns.map((column) => column.name),
      [],
      `${where}[${index}]`,
    );
    const result: Record<string, unknown> = {};
    for (const column of columns) {
      const value = row[column.name];
      if (column.type === "ascii") {
        if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
          throw new Error(`${where}[${index}].${column.name}: expected a nonempty ASCII key`);
        }
        if (Buffer.byteLength(value, "ascii") > column.max_bytes!)
          throw new Error(`${where}[${index}].${column.name}: value exceeds max_bytes`);
      } else if (column.type === "bool") {
        if (typeof value !== "boolean") throw new Error(`${where}[${index}].${column.name}: expected a boolean`);
      } else if (column.type === "u32") {
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff)
          throw new Error(`${where}[${index}].${column.name}: expected u32`);
      } else if (column.type === "i32") {
        if (!Number.isInteger(value) || (value as number) < -0x80000000 || (value as number) > 0x7fffffff)
          throw new Error(`${where}[${index}].${column.name}: expected i32`);
      } else if (column.type === "f32") {
        if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
          throw new Error(`${where}[${index}].${column.name}: expected finite f32`);
      }
      result[column.name] = value;
    }
    return result;
  });
  const pairs = new Map<string, Record<string, unknown>>();
  for (const row of normalized) {
    const key = `${String(row[declaration.group_by])}\0${String(row[declaration.value_column])}`;
    pairs.set(key, row);
  }
  return [...pairs.values()].sort((first, second) => {
    const left = canonical(first);
    const right = canonical(second);
    return left < right ? -1 : left > right ? 1 : 0;
  });
};

export const parseNativePatchFlowTemplate = (rawBytes: Buffer): NativePatchFlowTemplate => {
  if (rawBytes.length > MAX_NATIVE_PATCH_FLOW_TEMPLATE_BYTES)
    throw new Error("native patch flow template exceeds the size limit");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error("native patch flow template is not valid UTF-8");
  }
  const root = expectObject(parseJsonWithoutDuplicateKeys(source), "template");
  exactKeys(root, ["format", "format_version", "template", "native_patch", "inputs"], [], "template");
  if (root.format !== NATIVE_PATCH_FLOW_TEMPLATE_FORMAT || root.format_version !== 1)
    throw new Error("unsupported native patch flow template format/version");
  const identity = expectObject(root.template, "template.template");
  exactKeys(identity, ["id", "version", "name"], [], "template.template");
  const templateIdentity = {
    id: expectId(identity.id, "template.template.id"),
    version: expectString(identity.version, "template.template.version"),
    name: expectString(identity.name, "template.template.name"),
  };
  const nativeBytes = Buffer.from(JSON.stringify(root.native_patch), "utf8");
  if (nativeBytes.length > MAX_MANIFEST_BYTES) throw new Error("native_patch manifest exceeds the size limit");
  const nativePatch = parseAndValidateNativePatchManifest(nativeBytes);
  if (nativePatch.package.id !== templateIdentity.id || nativePatch.package.version !== templateIdentity.version) {
    throw new Error("template identity must match native_patch.package id and version");
  }
  const inputs = expectObject(root.inputs, "template.inputs");
  exactKeys(inputs, ["scalars", "tables"], [], "template.inputs");
  const scalarInputs = expectArray(inputs.scalars, "template.inputs.scalars").map((raw, index) => {
    const where = `template.inputs.scalars[${index}]`;
    const item = expectObject(raw, where);
    exactKeys(item, ["id", "parameter"], [], where);
    return { id: expectId(item.id, `${where}.id`), parameter: expectId(item.parameter, `${where}.parameter`) };
  });
  const tableInputs = expectArray(inputs.tables, "template.inputs.tables").map((raw, index) => {
    const where = `template.inputs.tables[${index}]`;
    const item = expectObject(raw, where);
    exactKeys(
      item,
      ["id", "table_name", "parameter", "max_rows", "group_by", "value_column", "provider_merge"],
      [],
      where,
    );
    if (item.provider_merge !== "identical_by_group")
      throw new Error(`${where}.provider_merge: unsupported merge policy`);
    return {
      id: expectId(item.id, `${where}.id`),
      table_name: expectString(item.table_name, `${where}.table_name`),
      parameter: expectId(item.parameter, `${where}.parameter`),
      max_rows: expectInteger(item.max_rows, `${where}.max_rows`, 1, MAX_NATIVE_PATCH_FLOW_INPUT_ROWS),
      group_by: expectString(item.group_by, `${where}.group_by`),
      value_column: expectString(item.value_column, `${where}.value_column`),
      provider_merge: "identical_by_group" as const,
    };
  });
  const inputIds = [...scalarInputs, ...tableInputs].map((item) => item.id);
  if (new Set(inputIds).size !== inputIds.length)
    throw new Error("template.inputs: duplicate input IDs are not allowed");
  const parameters = new Map(
    (nativePatch.parameters as Array<Record<string, any>>).map((parameter) => [parameter.id, parameter]),
  );
  const declaredParameters = [
    ...scalarInputs.map((item) => item.parameter),
    ...tableInputs.map((item) => item.parameter),
  ];
  if (new Set(declaredParameters).size !== declaredParameters.length)
    throw new Error("template.inputs: a native parameter cannot be bound more than once");
  for (const item of scalarInputs) {
    const parameter = parameters.get(item.parameter);
    if (!parameter || parameter.type === "table")
      throw new Error(
        `template.inputs.scalars '${item.id}' references a missing or non-scalar parameter '${item.parameter}'`,
      );
  }
  for (const item of tableInputs) {
    const parameter = parameters.get(item.parameter);
    if (!parameter || parameter.type !== "table")
      throw new Error(`template.inputs.tables '${item.id}' references a missing table parameter '${item.parameter}'`);
    const columns = parameter.columns as Array<{ name: string }>;
    // Version 1 intentionally models grouped key/value tables. Later versions can add other merge shapes.
    if (
      columns.length !== 2 ||
      !columns.some((column) => column.name === item.group_by) ||
      !columns.some((column) => column.name === item.value_column) ||
      item.group_by === item.value_column
    ) {
      throw new Error(`template.inputs.tables '${item.id}' must group the two declared table columns`);
    }
    if (item.max_rows > parameter.capacity)
      throw new Error(`template.inputs.tables '${item.id}' max_rows exceeds the native parameter capacity`);
  }
  const canonicalTemplate = {
    format: root.format,
    format_version: root.format_version,
    template: templateIdentity,
    native_patch: nativePatch,
    inputs: { scalars: scalarInputs, tables: tableInputs },
  };
  const fingerprint = sha256(canonical(canonicalTemplate));
  return { ...canonicalTemplate, fingerprint, rawBytes: Buffer.from(rawBytes) };
};

export const normalizeNativePatchFlowInputs = (
  template: NativePatchFlowTemplate,
  rawScalars: unknown,
  rawTables: unknown,
): { scalars: Record<string, unknown>; tables: Record<string, Array<Record<string, unknown>>> } => {
  const scalarValues = expectObject(rawScalars ?? {}, "inputs.scalars");
  const tableValues = expectObject(rawTables ?? {}, "inputs.tables");
  const scalarIds = new Set(template.inputs.scalars.map((item) => item.id));
  const tableIds = new Set(template.inputs.tables.map((item) => item.id));
  for (const id of Object.keys(scalarValues)) if (!scalarIds.has(id)) throw new Error(`unknown scalar input '${id}'`);
  for (const id of Object.keys(tableValues)) if (!tableIds.has(id)) throw new Error(`unknown table input '${id}'`);
  let aggregateRows = 0;
  let estimatedBytes = Buffer.byteLength(canonical(scalarValues), "utf8");
  for (const input of template.inputs.tables) {
    const rows = tableValues[input.id] ?? [];
    if (!Array.isArray(rows)) throw new Error(`inputs.tables.${input.id}: expected an array`);
    aggregateRows += rows.length;
    if (rows.length > input.max_rows || aggregateRows > MAX_NATIVE_PATCH_FLOW_INPUT_ROWS) {
      throw new Error(`inputs.tables.${input.id}: aggregate row count exceeds the declared bound`);
    }
    for (const rawRow of rows) {
      const row = expectObject(rawRow, `inputs.tables.${input.id}`);
      for (const value of Object.values(row)) {
        estimatedBytes += typeof value === "string" ? Buffer.byteLength(value, "utf8") : 8;
        if (estimatedBytes > MAX_NATIVE_PATCH_FLOW_INPUT_BYTES)
          throw new Error("aggregate native patch flow inputs exceed the 64 MiB limit");
      }
    }
  }
  const parameters = new Map(
    (template.native_patch.parameters as Array<Record<string, any>>).map((parameter) => [parameter.id, parameter]),
  );
  const scalars: Record<string, unknown> = {};
  for (const input of template.inputs.scalars) {
    const parameter = parameters.get(input.parameter)!;
    const value = Object.prototype.hasOwnProperty.call(scalarValues, input.id)
      ? scalarValues[input.id]
      : parameter.default;
    scalars[input.id] = validateScalarValue(parameter, value, `inputs.scalars.${input.id}`);
  }
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  let rowCount = 0;
  for (const input of template.inputs.tables) {
    const rows = validateTableRows(
      parameters.get(input.parameter)!,
      input,
      tableValues[input.id] ?? [],
      `inputs.tables.${input.id}`,
    );
    rowCount += rows.length;
    if (rowCount > MAX_NATIVE_PATCH_FLOW_INPUT_ROWS)
      throw new Error("aggregate table input row count exceeds the limit");
    tables[input.id] = rows;
  }
  const byteCount = Buffer.byteLength(canonical({ scalars, tables }), "utf8");
  if (byteCount > MAX_NATIVE_PATCH_FLOW_INPUT_BYTES)
    throw new Error("aggregate native patch flow inputs exceed the 64 MiB limit");
  return { scalars, tables };
};

export const createNativePatchFlowContribution = (input: {
  template: NativePatchFlowTemplate;
  inputs: { scalars: Record<string, unknown>; tables: Record<string, Array<Record<string, unknown>>> };
  provenance: NativePatchFlowProvenance;
  payloads: Array<{ path: string; sha256: string; bytes: Buffer }>;
}): NativePatchFlowContribution => {
  let totalPayloadBytes = 0;
  const payloads = input.payloads.map((payload) => {
    const path = safeRelativePath(payload.path, "payload.path");
    const actualHash = sha256(payload.bytes);
    if (actualHash !== payload.sha256.toLowerCase()) throw new Error(`template payload hash mismatch: ${path}`);
    totalPayloadBytes += payload.bytes.length;
    if (totalPayloadBytes > MAX_TOTAL_PAYLOAD_BYTES || totalPayloadBytes > MAX_NATIVE_PATCH_FLOW_INPUT_BYTES) {
      throw new Error("native patch flow template payloads exceed the aggregate size limit");
    }
    return { path, sha256: actualHash, size: payload.bytes.length, base64: payload.bytes.toString("base64") };
  });
  if (new Set(payloads.map((payload) => payload.path.toLowerCase())).size !== payloads.length) {
    throw new Error("template payload paths must be unique after normalization");
  }
  const contribution: NativePatchFlowContribution = {
    format: NATIVE_PATCH_FLOW_CONTRIBUTION_FORMAT,
    format_version: 1,
    template: {
      id: input.template.template.id,
      version: input.template.template.version,
      fingerprint: input.template.fingerprint,
    },
    template_base64: input.template.rawBytes.toString("base64"),
    payloads,
    inputs: input.inputs,
    provenance: {
      sourcePack: expectString(input.provenance.sourcePack, "provenance.sourcePack"),
      flowFile: expectString(input.provenance.flowFile, "provenance.flowFile"),
      nodeId: expectString(input.provenance.nodeId, "provenance.nodeId"),
    },
  };
  if (Buffer.byteLength(JSON.stringify(contribution), "utf8") > MAX_NATIVE_PATCH_FLOW_CONTRIBUTION_BYTES) {
    throw new Error("encoded native patch flow contribution exceeds the 160 MiB limit");
  }
  return contribution;
};

export const parseNativePatchFlowContribution = (
  bytes: Buffer,
): {
  contribution: NativePatchFlowContribution;
  template: NativePatchFlowTemplate;
  payloadByPath: Map<string, Buffer>;
  normalizedInputs: NativePatchFlowContribution["inputs"];
} => {
  if (bytes.length > MAX_NATIVE_PATCH_FLOW_CONTRIBUTION_BYTES) {
    throw new Error("native patch flow contribution exceeds the 160 MiB limit");
  }
  let root: Record<string, any>;
  try {
    root = expectObject(
      parseJsonWithoutDuplicateKeys(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      "contribution",
    );
  } catch (error) {
    throw new Error(
      `invalid native patch flow contribution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  exactKeys(
    root,
    ["format", "format_version", "template", "template_base64", "payloads", "inputs", "provenance"],
    [],
    "contribution",
  );
  if (root.format !== NATIVE_PATCH_FLOW_CONTRIBUTION_FORMAT || root.format_version !== 1)
    throw new Error("unsupported native patch flow contribution format/version");
  const identity = expectObject(root.template, "contribution.template");
  exactKeys(identity, ["id", "version", "fingerprint"], [], "contribution.template");
  const templateBytes = decodeBase64(
    root.template_base64,
    "contribution.template_base64",
    MAX_NATIVE_PATCH_FLOW_TEMPLATE_BYTES,
  );
  const template = parseNativePatchFlowTemplate(templateBytes);
  if (
    identity.id !== template.template.id ||
    identity.version !== template.template.version ||
    identity.fingerprint !== template.fingerprint
  ) {
    throw new Error("contribution template identity or fingerprint does not match its embedded template");
  }
  const provenance = expectObject(root.provenance, "contribution.provenance");
  exactKeys(provenance, ["sourcePack", "flowFile", "nodeId"], [], "contribution.provenance");
  const payloadByPath = new Map<string, Buffer>();
  let payloadBytes = 0;
  for (const [index, raw] of expectArray(root.payloads, "contribution.payloads").entries()) {
    const where = `contribution.payloads[${index}]`;
    const item = expectObject(raw, where);
    exactKeys(item, ["path", "sha256", "size", "base64"], [], where);
    const path = safeRelativePath(item.path, `${where}.path`);
    const expectedHash = expectString(item.sha256, `${where}.sha256`).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`${where}.sha256: invalid SHA-256`);
    const size = expectInteger(item.size, `${where}.size`, 0, MAX_TOTAL_PAYLOAD_BYTES);
    const payload = decodeBase64(item.base64, `${where}.base64`, MAX_NATIVE_PATCH_FLOW_INPUT_BYTES);
    if (payload.length !== size || sha256(payload) !== expectedHash)
      throw new Error(`${where}: payload size or hash mismatch`);
    payloadBytes += payload.length;
    if (payloadBytes > MAX_TOTAL_PAYLOAD_BYTES || payloadBytes > MAX_NATIVE_PATCH_FLOW_INPUT_BYTES)
      throw new Error("contribution payloads exceed the aggregate size limit");
    const key = path.toLowerCase();
    if (payloadByPath.has(key)) throw new Error(`duplicate contribution payload path '${path}'`);
    payloadByPath.set(key, payload);
  }
  const expectedPaths = new Map<string, string>();
  for (const block of template.native_patch.blocks as Array<Record<string, any>>) {
    if ("file" in block.source) {
      const path = safeRelativePath(block.source.file, `native_patch.blocks.${block.id}.source.file`);
      const key = path.toLowerCase();
      const existing = expectedPaths.get(key);
      if (existing && existing !== block.source.sha256.toLowerCase())
        throw new Error(`template reuses payload path '${path}' with conflicting hashes`);
      expectedPaths.set(key, block.source.sha256.toLowerCase());
    }
  }
  if (expectedPaths.size !== payloadByPath.size)
    throw new Error("contribution payload set does not match the template's file blocks");
  for (const [path, expectedHash] of expectedPaths) {
    const payload = payloadByPath.get(path);
    if (!payload || sha256(payload) !== expectedHash)
      throw new Error(`contribution is missing or has an invalid template payload '${path}'`);
  }
  const rawInputs = expectObject(root.inputs, "contribution.inputs");
  exactKeys(rawInputs, ["scalars", "tables"], [], "contribution.inputs");
  const normalizedInputs = normalizeNativePatchFlowInputs(template, rawInputs.scalars, rawInputs.tables);
  const contribution: NativePatchFlowContribution = {
    format: NATIVE_PATCH_FLOW_CONTRIBUTION_FORMAT,
    format_version: 1,
    template: { id: template.template.id, version: template.template.version, fingerprint: template.fingerprint },
    template_base64: templateBytes.toString("base64"),
    payloads: [...payloadByPath.entries()].map(([path, payload]) => ({
      path,
      sha256: sha256(payload),
      size: payload.length,
      base64: payload.toString("base64"),
    })),
    inputs: normalizedInputs,
    provenance: {
      sourcePack: expectString(provenance.sourcePack, "contribution.provenance.sourcePack"),
      flowFile: expectString(provenance.flowFile, "contribution.provenance.flowFile"),
      nodeId: expectString(provenance.nodeId, "contribution.provenance.nodeId"),
    },
  };
  return { contribution, template, payloadByPath, normalizedInputs };
};

export const nativePatchFlowCanonicalValue = canonical;
export const nativePatchFlowSha256 = sha256;
