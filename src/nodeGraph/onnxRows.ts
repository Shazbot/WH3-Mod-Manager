import * as crypto from "crypto";
import { parseEditedCellValue } from "../utility/dbRowCells";
import type { AmendedSchemaField, DBField, SCHEMA_FIELD_TYPE } from "../packFileTypes";
import {
  combineOnnxPrediction,
  formatOnnxPrediction,
  OnnxJoinStep,
  OnnxModelDefinition,
  OnnxOutputBinding,
} from "./onnxFlow";

interface OnnxRowRef {
  tableData: DBTablesNodeTable;
  row: AmendedSchemaField[];
  rowIndex: number;
}

interface OnnxCloneRef {
  tableName: string;
  sourceKey: string;
  row: AmendedSchemaField[];
  tableData: DBTablesNodeTable;
}

export interface ApplyOnnxPredictionsRequest {
  inputData: DBTablesNodeData;
  rootTableName: string;
  models: OnnxModelDefinition[];
  bindings: Record<string, OnnxOutputBinding>;
  predictions: Record<string, number[]>;
  linkedTableData: DBTablesNodeTable[];
  /** Includes shadowed providers too, so generated row keys cannot collide anywhere in the load set. */
  collisionTableData: DBTablesNodeTable[];
  strength: number;
  cloneIdentity: string;
}

const normalizeTableName = (name: string) =>
  name
    .replace(/^db[\\/]/i, "")
    .replace(/[\\/].*$/, "")
    .toLowerCase();
const getCell = (row: readonly AmendedSchemaField[], column: string) => row.find((cell) => cell.name === column);
const getKeyColumn = (tableData: DBTablesNodeTable) =>
  tableData.table.tableSchema?.fields.find((field) => field.is_key);
const getRowKey = (tableData: DBTablesNodeTable, row: readonly AmendedSchemaField[]) => {
  const field = getKeyColumn(tableData);
  return field ? getCell(row, field.name)?.resolvedKeyValue : undefined;
};

const cloneRow = (row: AmendedSchemaField[]) => structuredClone(row) as AmendedSchemaField[];

const makeIndexKey = (tableName: string, column: string, value: string) =>
  `${normalizeTableName(tableName)}\0${column}\0${value}`;

const makeRowIndexes = (tables: DBTablesNodeTable[]) => {
  const rowsByReference = new Map<string, OnnxRowRef | null>();
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const tableData = tables[tableIndex];
    const rows = tableData.table.schemaFields && tableData.table.tableSchema ? chunkRows(tableData) : [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      for (const cell of row) {
        if (!cell.resolvedKeyValue) continue;
        const indexKey = makeIndexKey(tableData.name, cell.name, cell.resolvedKeyValue);
        const existing = rowsByReference.get(indexKey);
        if (existing && getRowKey(existing.tableData, existing.row) !== getRowKey(tableData, row)) {
          rowsByReference.set(indexKey, null);
        } else if (existing === undefined) {
          rowsByReference.set(indexKey, { tableData, row, rowIndex });
        }
      }
    }
  }
  return rowsByReference;
};

const chunkRows = (tableData: DBTablesNodeTable): AmendedSchemaField[][] => {
  const schema = tableData.table.tableSchema;
  if (!schema || !tableData.table.schemaFields) return [];
  const width = schema.fields.length;
  if (width < 1) return [];
  const rows: AmendedSchemaField[][] = [];
  for (let offset = 0; offset + width <= tableData.table.schemaFields.length; offset += width) {
    rows.push(tableData.table.schemaFields.slice(offset, offset + width) as AmendedSchemaField[]);
  }
  return rows;
};

const resolvePathChain = (
  path: OnnxJoinStep[],
  rootRow: AmendedSchemaField[],
  rootTable: DBTablesNodeTable,
  rowsByReference: Map<string, OnnxRowRef | null>,
): OnnxRowRef[] | undefined => {
  const chain: OnnxRowRef[] = [{ tableData: rootTable, row: rootRow, rowIndex: -1 }];
  let currentRow: AmendedSchemaField[] = rootRow;
  let currentTableName = rootTable.name;
  for (const step of path) {
    if (normalizeTableName(currentTableName) !== normalizeTableName(step.tableName)) return undefined;
    const reference = getCell(currentRow, step.column)?.resolvedKeyValue;
    if (!reference) return undefined;
    const next = rowsByReference.get(makeIndexKey(step.targetTable, step.targetColumn, reference));
    if (!next) return undefined;
    chain.push(next);
    currentRow = next.row;
    currentTableName = next.tableData.name;
  }
  return chain;
};

export const createOnnxPathResolver = (
  inputData: DBTablesNodeData,
  linkedTableData: DBTablesNodeTable[],
): ((
  path: OnnxJoinStep[],
  rootRow: ReadonlyArray<{ name: string; resolvedKeyValue: string }>,
) => ReadonlyArray<{ name: string; resolvedKeyValue: string }> | undefined) => {
  const rowsByReference = makeRowIndexes([...inputData.tables, ...linkedTableData]);
  return (path, rootRow) => {
    let currentRow = rootRow as AmendedSchemaField[];
    for (const step of path) {
      const reference = getCell(currentRow, step.column)?.resolvedKeyValue;
      if (!reference) return undefined;
      const next = rowsByReference.get(makeIndexKey(step.targetTable, step.targetColumn, reference));
      if (!next) return undefined;
      currentRow = next.row;
    }
    return currentRow;
  };
};

const getIntegerBounds = (type: string): { min: bigint; max: bigint } | undefined => {
  switch (type) {
    case "I16":
      return { min: -32768n, max: 32767n };
    case "I32":
      return { min: -2147483648n, max: 2147483647n };
    case "I64":
      return { min: -(2n ** 63n), max: 2n ** 63n - 1n };
    case "Boolean":
      return { min: 0n, max: 1n };
    default:
      return undefined;
  }
};

const utf8Prefix = (value: string, maxBytes: number): string => {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character, "utf8") > maxBytes) break;
    result += character;
  }
  return result;
};

const createCloneKey = (
  tableName: string,
  originalKey: string,
  rootKey: string,
  pathSignature: string,
  field: DBField,
  keysByTable: Map<string, Set<string>>,
  nextNumericKeyByTable: Map<string, bigint>,
  cloneIdentity: string,
): string => {
  const tableKey = normalizeTableName(tableName);
  const usedKeys = keysByTable.get(tableKey) ?? new Set<string>();
  keysByTable.set(tableKey, usedKeys);
  const bounds = getIntegerBounds(field.field_type);
  if (bounds) {
    let candidate = nextNumericKeyByTable.get(tableKey);
    if (candidate === undefined) {
      let maximum = 0n;
      for (const value of usedKeys) {
        if (!/^-?\d+$/.test(value)) continue;
        const parsed = BigInt(value);
        if (parsed > maximum) maximum = parsed;
      }
      candidate = maximum + 1n;
    }
    while (usedKeys.has(candidate.toString()) && candidate <= bounds.max) candidate += 1n;
    if (candidate < bounds.min || candidate > bounds.max) {
      throw new Error(`No collision-free ${field.field_type} key remains in ${tableName}`);
    }
    nextNumericKeyByTable.set(tableKey, candidate + 1n);
    usedKeys.add(candidate.toString());
    return candidate.toString();
  }
  if (field.field_type !== "StringU8" && field.field_type !== "StringU16" && field.field_type !== "OptionalStringU8") {
    throw new Error(`Cannot generate a linked-row key for ${field.field_type} in ${tableName}`);
  }

  const maxBytes = field.field_type === "StringU16" ? 65535 : 255;
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([cloneIdentity, tableKey, originalKey, rootKey, pathSignature]))
    .digest("hex");
  for (let attempt = 0; attempt < 1000; attempt++) {
    const attemptSuffix = attempt === 0 ? "" : `_${attempt}`;
    const suffix = `_whmm_${digest.slice(0, 10)}${attemptSuffix}`;
    const candidate = `${utf8Prefix(originalKey, maxBytes - Buffer.byteLength(suffix, "utf8"))}${suffix}`;
    if (!usedKeys.has(candidate)) {
      usedKeys.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not generate a unique string key in ${tableName}`);
};

const setCellValue = (row: AmendedSchemaField[], schemaFields: DBField[], column: string, value: string): void => {
  const field = schemaFields.find((candidate) => candidate.name === column);
  const cellIndex = row.findIndex((candidate) => candidate.name === column);
  if (!field || cellIndex < 0) throw new Error(`Missing column '${column}' while writing ONNX output`);
  const parsed = parseEditedCellValue(field.field_type, value);
  if (!parsed) throw new Error(`Could not encode '${value}' as ${field.field_type} in '${column}'`);
  row[cellIndex] = {
    ...row[cellIndex],
    resolvedKeyValue: parsed.resolvedKeyValue,
    fields: parsed.fields,
  } as AmendedSchemaField;
};

const validateStoredNumber = (value: number, fieldType: string): void => {
  if (!Number.isFinite(value)) throw new Error("ONNX output is not finite");
  const bounds = getIntegerBounds(fieldType);
  if (bounds) {
    if (fieldType === "I64" && !Number.isSafeInteger(value)) {
      throw new Error(`I64 output ${value} is outside the exact integer range supported by JavaScript`);
    }
    const rounded = BigInt(Math.round(value));
    if (rounded < bounds.min || rounded > bounds.max) {
      throw new Error(`${fieldType} output ${rounded.toString()} is out of range`);
    }
  } else if (fieldType === "F32" && !Number.isFinite(Math.fround(value))) {
    throw new Error(`F32 output ${value} is out of range`);
  } else if (fieldType !== "F32" && fieldType !== "F64") {
    throw new Error(`Cannot write ONNX prediction to ${fieldType}`);
  }
};

/** Applies a complete prediction snapshot without mutating any row received from an upstream flow node. */
export const applyOnnxPredictions = (request: ApplyOnnxPredictionsRequest): DBTablesNodeData => {
  if (request.inputData.tables.length === 0) {
    return { ...request.inputData, type: "TableSelection", tableCount: 0 };
  }
  const rootName = normalizeTableName(request.rootTableName);
  const rootTables = request.inputData.tables.filter((table) => normalizeTableName(table.name) === rootName);
  if (rootTables.length === 0) throw new Error(`Input contains no rows for root table '${request.rootTableName}'`);

  const rowsByReference = makeRowIndexes([...request.inputData.tables, ...request.linkedTableData]);
  const rootRows: Array<{ tableData: DBTablesNodeTable; rowIndex: number; row: AmendedSchemaField[] }> = [];
  const rootOutputRows = new Map<DBTablesNodeTable, AmendedSchemaField[][]>();
  const outputRootTables = new Map<DBTablesNodeTable, DBTablesNodeTable>();
  for (const tableData of request.inputData.tables) {
    if (normalizeTableName(tableData.name) !== rootName) continue;
    const rows = chunkRows(tableData);
    rootOutputRows.set(tableData, rows.map(cloneRow));
    outputRootTables.set(tableData, {
      ...tableData,
      table: { ...tableData.table, schemaFields: rows.map(cloneRow).flat() },
    });
    rows.forEach((row, rowIndex) => rootRows.push({ tableData, rowIndex, row }));
  }
  if (rootRows.length === 0) throw new Error(`Input root table '${request.rootTableName}' has no schema rows`);

  const collisionTables = [...request.collisionTableData, ...request.inputData.tables];
  const keysByTable = new Map<string, Set<string>>();
  for (const tableData of collisionTables) {
    const keyField = getKeyColumn(tableData);
    if (!keyField) continue;
    const key = normalizeTableName(tableData.name);
    const values = keysByTable.get(key) ?? new Set<string>();
    for (const row of chunkRows(tableData)) {
      const value = getCell(row, keyField.name)?.resolvedKeyValue;
      if (value !== undefined) values.add(value);
    }
    keysByTable.set(key, values);
  }

  const cloneRowsByRoot = new Map<number, Map<string, OnnxCloneRef>>();
  const linkedOutputs = new Map<DBTablesNodeTable, AmendedSchemaField[][]>();
  const nextNumericKeyByTable = new Map<string, bigint>();
  const destinations = new Set<string>();

  for (const model of request.models) {
    const binding = request.bindings[model.key];
    if (!binding?.enabled) continue;
    const destination = `${normalizeTableName(binding.tableName)}\0${binding.column}\0${JSON.stringify(binding.path)}`;
    if (destinations.has(destination))
      throw new Error(`More than one enabled ONNX output targets ${binding.tableName}.${binding.column}`);
    destinations.add(destination);
    const modelPredictions = request.predictions[model.key];
    if (!modelPredictions || modelPredictions.length !== rootRows.length) {
      throw new Error(`Model '${model.key}' did not produce one prediction per root row`);
    }
    for (let rootIndex = 0; rootIndex < rootRows.length; rootIndex++) {
      const rootRef = rootRows[rootIndex];
      const pathChain = resolvePathChain(binding.path, rootRef.row, rootRef.tableData, rowsByReference);
      if (!pathChain) continue;
      const sourceTarget = pathChain[pathChain.length - 1];
      const targetSchema = sourceTarget.tableData.table.tableSchema?.fields;
      if (!targetSchema) throw new Error(`Missing target schema for ${binding.tableName}`);
      const targetField = targetSchema.find((field) => field.name === binding.column);
      if (!targetField) throw new Error(`Column '${binding.column}' does not exist in ${binding.tableName}`);
      const originalCell = getCell(sourceTarget.row, binding.column);
      if (!originalCell) throw new Error(`Target row lacks '${binding.column}' in ${binding.tableName}`);
      const outputStrength = binding.strength === undefined ? request.strength : Number(binding.strength);
      if (!Number.isFinite(outputStrength)) throw new Error(`Output '${model.key}' has a non-finite delta strength`);
      const combined = combineOnnxPrediction(
        originalCell.resolvedKeyValue,
        binding.roundPrediction ? Math.round(modelPredictions[rootIndex]) : modelPredictions[rootIndex],
        binding.mode,
        outputStrength,
      );
      validateStoredNumber(combined, targetField.field_type);
      const formatted = formatOnnxPrediction(combined, targetField.field_type);
      if (formatted === originalCell.resolvedKeyValue) continue;

      let outputTarget = sourceTarget.row;
      if (binding.path.length === 0) {
        const copiedRows = rootOutputRows.get(rootRef.tableData);
        if (!copiedRows) throw new Error("Root output rows were not created");
        outputTarget = copiedRows[rootRef.rowIndex];
      } else {
        let parentOutputRow: AmendedSchemaField[] = rootOutputRows.get(rootRef.tableData)![rootRef.rowIndex];
        const rootKey = getRowKey(rootRef.tableData, rootRef.row) ?? String(rootRef.rowIndex);
        let rootClones = cloneRowsByRoot.get(rootIndex);
        if (!rootClones) {
          rootClones = new Map();
          cloneRowsByRoot.set(rootIndex, rootClones);
        }
        for (let stepIndex = 0; stepIndex < binding.path.length; stepIndex++) {
          const step = binding.path[stepIndex];
          const childRef = pathChain[stepIndex + 1];
          const childKeyField = getKeyColumn(childRef.tableData);
          const sourceKey = getCell(childRef.row, step.targetColumn)?.resolvedKeyValue;
          if (!childKeyField || childKeyField.name !== step.targetColumn || sourceKey === undefined) {
            throw new Error(
              `Cannot safely clone ${step.targetTable}: reference target '${step.targetColumn}' is not its sole key`,
            );
          }
          const cloneIdentity = `${normalizeTableName(childRef.tableData.name)}\0${sourceKey}`;
          let childClone = rootClones.get(cloneIdentity);
          if (!childClone) {
            if ((childRef.tableData.table.tableSchema?.fields.filter((field) => field.is_key).length ?? 0) !== 1) {
              throw new Error(`Cannot safely clone ${step.targetTable}: composite or missing primary key`);
            }
            const signature =
              binding.path
                .slice(0, stepIndex + 1)
                .map((edge) => `${edge.tableName}.${edge.column}`)
                .join(">") + `|${normalizeTableName(childRef.tableData.name)}`;
            const newKey = createCloneKey(
              childRef.tableData.name,
              sourceKey,
              rootKey,
              signature,
              childKeyField,
              keysByTable,
              nextNumericKeyByTable,
              request.cloneIdentity,
            );
            const clonedRow = cloneRow(childRef.row);
            setCellValue(clonedRow, childRef.tableData.table.tableSchema!.fields, childKeyField.name, newKey);
            childClone = { tableName: step.targetTable, sourceKey, row: clonedRow, tableData: childRef.tableData };
            rootClones.set(cloneIdentity, childClone);
            const outputRows = linkedOutputs.get(childRef.tableData) ?? [];
            outputRows.push(clonedRow);
            linkedOutputs.set(childRef.tableData, outputRows);
          }

          const parentSchema = pathChain[stepIndex].tableData.table.tableSchema?.fields ?? [];
          setCellValue(
            parentOutputRow,
            parentSchema,
            step.column,
            getCell(childClone.row, step.targetColumn)!.resolvedKeyValue,
          );
          parentOutputRow = childClone.row;
          if (stepIndex === binding.path.length - 1) outputTarget = childClone.row;
        }
      }
      setCellValue(outputTarget, targetSchema, binding.column, formatted);
    }
  }

  for (const [sourceTable, outputTable] of outputRootTables) {
    outputTable.table.schemaFields = (rootOutputRows.get(sourceTable) ?? []).flat();
  }
  const outputTables = request.inputData.tables.map((tableData) => outputRootTables.get(tableData) ?? tableData);
  for (const [sourceTable, rows] of linkedOutputs) {
    outputTables.push({
      ...sourceTable,
      table: { ...sourceTable.table, schemaFields: rows.flat() },
    });
  }
  return {
    type: "TableSelection",
    tables: outputTables,
    sourceFiles: request.inputData.sourceFiles || [],
    tableCount: outputTables.length,
  };
};
