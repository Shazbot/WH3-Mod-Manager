import { typeToBuffer } from "./packFileSerializer";
import { AmendedSchemaField, DBVersion, LocFields, LocVersion, PackedFile, FIELD_TYPE } from "./packFileTypes";
import type {
  DeepCloneOverride,
  DeepCloneTreeNode,
  DeepCloneVariantAxis,
} from "./nodeGraph/nodes/types";
import { buildLocKey, getLocKeyColumns } from "./utility/locKeyGeneration";

/** Guards against a variant product or a reference closure that would blow up the executor. */
export const MAX_DEEP_CLONE_VARIANTS = 256;
export const MAX_DEEP_CLONE_ROWS = 200000;

export interface DeepClonePlan {
  cloneTree: DeepCloneTreeNode;
  /** Supports {original}, {selfOriginal} and {variant}. */
  nameTemplate: string;
  useModdersPrefix: boolean;
  moddersPrefix: string;
  variantAxes: DeepCloneVariantAxis[];
  columnOverrides: DeepCloneOverride[];
  generateLoc: boolean;
  /**
   * After the explicit plan has run, pull in every row that referenced a key we renamed and re-point
   * it at the new key. Without it a cloned unit exists but nothing in the game refers to it.
   */
  autoFollowReferences: boolean;
}

export interface DeepCloneDependencies {
  /** Every packed file for a db table across the search packs (input packs plus the base game). */
  loadTable: (tableName: string) => Promise<LoadedTableFile[]>;
  getRows: (packedFile: PackedFile) => AmendedSchemaField[][];
  /** Original English text for a loc key. Only consulted when the plan asks for loc generation. */
  lookupLocText?: (locKey: string) => string | undefined;
  /** gameToReferences for the current game: table -> columns other tables reference. */
  referencedColumnsByTable: Record<string, string[]>;
  /** gameToTablesWithNumericIds for the current game: table -> synthetic id column. */
  numericIdFieldByTable: Record<string, string>;
  /** gameToDBFieldsReferencedBy: table -> column -> [[referencingTable, referencingColumn], ...] */
  reverseReferencesByTable?: Record<string, Record<string, string[][]>>;
  /** Ownership/content-pack junctions that are never worth following. */
  tablesToIgnore?: string[];
  log?: (...args: unknown[]) => void;
}

/** A db table file found in one of the search packs. */
export interface LoadedTableFile {
  /** Bare table name, e.g. "land_units_tables". */
  tableName: string;
  packedFile: PackedFile;
  packName: string;
  packPath: string;
}

export interface DeepCloneOutputTable {
  tableName: string;
  tableSchema: DBVersion;
  version?: number;
  rows: AmendedSchemaField[][];
  /** Set for non-db payloads (the generated loc file), consumed by the save changes node. */
  outputPathPrefix?: string;
  outputPathSuffix?: string;
}

export interface DeepCloneResult {
  tables: DeepCloneOutputTable[];
  clonedRowCount: number;
  /** New keys that already exist in the search packs. Reported, not fatal. */
  collisions: string[];
  warnings: string[];
}

export interface DeepCloneVariant {
  suffix: string;
  overrides: DeepCloneOverride[];
}

/**
 * Cartesian product of the variant axes. Suffixes concatenate in axis order, overrides accumulate.
 * Zero axes (or axes with no values) yield the single empty variant.
 */
export const expandVariants = (axes: DeepCloneVariantAxis[]): DeepCloneVariant[] => {
  let variants: DeepCloneVariant[] = [{ suffix: "", overrides: [] }];

  for (const axis of axes || []) {
    const values = (axis.values || []).filter((value) => value);
    if (values.length === 0) continue;

    const expanded: DeepCloneVariant[] = [];
    for (const variant of variants) {
      for (const value of values) {
        expanded.push({
          suffix: `${variant.suffix}${value.suffix ?? ""}`,
          overrides: [...variant.overrides, ...(value.overrides || [])],
        });
      }
    }
    variants = expanded;
  }

  return variants;
};

export const applyNameTemplate = (
  template: string,
  values: { original: string; selfOriginal: string; variant: string },
): string =>
  (template || "{original}{variant}")
    .replace(/\{original\}/g, values.original)
    .replace(/\{selfOriginal\}/g, values.selfOriginal)
    .replace(/\{variant\}/g, values.variant);

const applyModdersPrefix = (name: string, prefix: string, enabled: boolean): string => {
  if (!enabled || !prefix || name.startsWith(prefix)) return name;
  return `${prefix}${name}`;
};

const getCellValue = (row: AmendedSchemaField[], columnName: string): string | undefined =>
  row.find((cell) => cell.name == columnName)?.resolvedKeyValue;

const getRenameKey = (tableName: string, columnName: string, value: string) =>
  `${tableName}|${columnName}|${value}`;

/**
 * Stable identity for a source row, so the same row is never collected twice in one pass.
 * Uses every cell rather than the key column, so the walk and the auto-follow pass produce the
 * same identity for a table both of them reach.
 */
const getRowIdentity = (row: AmendedSchemaField[]): string =>
  row.map((cell) => cell.resolvedKeyValue).join("\u0001");

interface CollectedRow {
  tableName: string;
  tableSchema: DBVersion;
  version?: number;
  sourceRow: AmendedSchemaField[];
}

/**
 * Clones a set of source rows plus the selected slice of their reference closure, once per variant.
 *
 * Each (source row, variant) pair is walked independently: the walk registers every new key in a
 * rename map, then every collected row is materialized with its foreign keys and its own key
 * rewritten against that map. Unselected tree nodes are never walked, which is what leaves shared
 * references (unit_castes_tables and friends) pointing at the original rows.
 */
export const executeDeepClonePlan = async (
  rootTableFiles: LoadedTableFile[],
  plan: DeepClonePlan,
  deps: DeepCloneDependencies,
): Promise<DeepCloneResult> => {
  const log = deps.log ?? (() => undefined);
  const warnings: string[] = [];
  const collisions: string[] = [];

  const variants = expandVariants(plan.variantAxes);
  if (variants.length > MAX_DEEP_CLONE_VARIANTS) {
    throw new Error(
      `Deep clone would produce ${variants.length} variants, above the limit of ${MAX_DEEP_CLONE_VARIANTS}. Reduce the number of variant axes or values.`,
    );
  }

  const rootNode = plan.cloneTree;
  if (!rootNode || !rootNode.table) {
    throw new Error("No clone plan configured");
  }

  // --- table loading, memoized per table name -------------------------------------------------

  const tableFilesCache = new Map<string, Promise<LoadedTableFile[]>>();
  const loadTable = (tableName: string): Promise<LoadedTableFile[]> => {
    let cached = tableFilesCache.get(tableName);
    if (!cached) {
      cached = deps.loadTable(tableName);
      tableFilesCache.set(tableName, cached);
    }
    return cached;
  };
  // Deliberately not seeded with rootTableFiles: those are usually a filtered subset, and both the
  // collision check and the child lookups need the table as it actually exists in the packs.

  const columnValuesCache = new Map<string, Set<string>>();
  const getExistingColumnValues = async (tableName: string, columnName: string): Promise<Set<string>> => {
    const cacheKey = `${tableName}|${columnName}`;
    const cached = columnValuesCache.get(cacheKey);
    if (cached) return cached;

    const values = new Set<string>();
    for (const tableFile of await loadTable(tableName)) {
      for (const row of deps.getRows(tableFile.packedFile)) {
        const value = getCellValue(row, columnName);
        if (value !== undefined) values.add(value);
      }
    }
    columnValuesCache.set(cacheKey, values);
    return values;
  };

  // --- numeric id regeneration ----------------------------------------------------------------

  const generatedNumericIds = new Map<string, Set<string>>();
  const createUniqueNumericId = async (
    tableName: string,
    fieldName: string,
    fieldType: string,
  ): Promise<string | undefined> => {
    const cacheKey = `${tableName}|${fieldName}`;
    let generated = generatedNumericIds.get(cacheKey);
    if (!generated) {
      generated = new Set<string>();
      generatedNumericIds.set(cacheKey, generated);
    }

    const existing = await getExistingColumnValues(tableName, fieldName);
    let maxValue = 2 ** 15 - 1;
    if (fieldType == "I32" || fieldType == "F32") maxValue = 2 ** 31 - 1;
    else if (fieldType == "I64" || fieldType == "F64") maxValue = Number.MAX_SAFE_INTEGER;

    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = String(Math.floor(Math.random() * maxValue));
      if (existing.has(candidate) || generated.has(candidate)) continue;
      generated.add(candidate);
      return candidate;
    }

    warnings.push(`Could not generate a unique numeric id for ${tableName}.${fieldName}`);
    return undefined;
  };

  // --- the walk -------------------------------------------------------------------------------

  /** Resolves the source rows of a child node given one parent row. */
  const resolveChildRows = async (
    child: DeepCloneTreeNode,
    parentSchema: DBVersion,
    parentRow: AmendedSchemaField[],
  ): Promise<Array<{ tableFile: LoadedTableFile; row: AmendedSchemaField[] }>> => {
    const childFiles = await loadTable(child.table);
    if (childFiles.length === 0) {
      warnings.push(`No rows found for table ${child.table}`);
      return [];
    }

    let matchColumn: string;
    let matchValue: string | undefined;

    if (child.direction === "forward") {
      // linkColumn lives on the parent and references [child.table, child.keyColumn].
      const parentField = parentSchema.fields.find((field) => field.name == child.linkColumn);
      matchColumn = child.keyColumn || parentField?.is_reference?.[1] || "";
      matchValue = getCellValue(parentRow, child.linkColumn);
    } else {
      // linkColumn lives on the child and references [parent.table, parentColumn].
      const childSchema = childFiles[0].packedFile.tableSchema;
      const childField = childSchema?.fields.find((field) => field.name == child.linkColumn);
      const parentColumn = childField?.is_reference?.[1];
      matchColumn = child.linkColumn;
      matchValue = parentColumn ? getCellValue(parentRow, parentColumn) : undefined;
    }

    if (!matchColumn || matchValue === undefined) return [];

    const matches: Array<{ tableFile: LoadedTableFile; row: AmendedSchemaField[] }> = [];
    for (const tableFile of childFiles) {
      for (const row of deps.getRows(tableFile.packedFile)) {
        if (getCellValue(row, matchColumn) === matchValue) matches.push({ tableFile, row });
      }
    }
    return matches;
  };

  const outputTables = new Map<string, DeepCloneOutputTable>();
  /** Cloned rows kept alongside their source, so loc keys can be derived from both. */
  const clonedPairsByTable = new Map<
    string,
    Array<{ cloned: AmendedSchemaField[]; source: AmendedSchemaField[] }>
  >();
  const emittedRowKeys = new Set<string>();
  let clonedRowCount = 0;

  const runPass = async (
    rootTableFile: LoadedTableFile,
    rootRow: AmendedSchemaField[],
    variant: DeepCloneVariant,
  ): Promise<void> => {
    const rootSchema = rootTableFile.packedFile.tableSchema;
    if (!rootSchema) return;

    const rootOriginal = rootNode.keyColumn ? getCellValue(rootRow, rootNode.keyColumn) ?? "" : "";
    const renames = new Map<string, string>();
    /** Renamed keys in walk order, so the auto-follow pass knows what to search for. */
    const renamedKeys: Array<{ table: string; column: string; originalValue: string }> = [];
    const collected: CollectedRow[] = [];
    /**
     * Rows already collected this pass, keyed on the full source row. The whole row is used rather
     * than its key column so that the walk and the auto-follow pass agree: a table reached by both
     * must be collected once, and only the walk's copy gets its key renamed.
     */
    const seenInPass = new Set<string>();

    const walk = async (
      node: DeepCloneTreeNode,
      tableFile: LoadedTableFile,
      row: AmendedSchemaField[],
    ): Promise<void> => {
      const schema = tableFile.packedFile.tableSchema;
      if (!schema) return;

      const identity = `${node.table}|${getRowIdentity(row)}`;
      if (seenInPass.has(identity)) return;
      seenInPass.add(identity);

      if (collected.length >= MAX_DEEP_CLONE_ROWS) {
        throw new Error(
          `Deep clone exceeded ${MAX_DEEP_CLONE_ROWS} rows. Narrow the clone plan or the input rows.`,
        );
      }

      if (node.keyColumn) {
        const selfOriginal = getCellValue(row, node.keyColumn);
        if (selfOriginal !== undefined) {
          const newKey = applyModdersPrefix(
            applyNameTemplate(node.nameTemplate || plan.nameTemplate, {
              original: rootOriginal,
              selfOriginal,
              variant: variant.suffix,
            }),
            plan.moddersPrefix,
            plan.useModdersPrefix,
          );
          renames.set(getRenameKey(node.table, node.keyColumn, selfOriginal), newKey);
          renamedKeys.push({ table: node.table, column: node.keyColumn, originalValue: selfOriginal });

          const existing = await getExistingColumnValues(node.table, node.keyColumn);
          if (existing.has(newKey)) {
            const collision = `${node.table}.${node.keyColumn} already contains '${newKey}'`;
            if (!collisions.includes(collision)) collisions.push(collision);
          }
        }
      }

      collected.push({
        tableName: node.table,
        tableSchema: schema,
        version: tableFile.packedFile.version,
        sourceRow: row,
      });

      for (const child of node.children || []) {
        // An unchecked child is the tree's default state, not a decision to skip the table: the
        // editor materializes every one-hop reference unchecked. Checking one means "clone it and
        // give it a new key"; auto-follow still reaches the rest to repoint their references.
        if (!child.selected) continue;
        for (const match of await resolveChildRows(child, schema, row)) {
          await walk(child, match.tableFile, match.row);
        }
      }
    };

    /**
     * Every row that pointed at a key we just renamed needs a copy pointing at the new key,
     * otherwise the clone is orphaned: the unit exists but no grouping, permission or junction row
     * mentions it. The rows are collected here and the foreign key rewrite during materialization
     * repoints them, because the rename map already holds the mapping.
     *
     * Auto-followed rows keep their own key untouched. In practice these are junction tables whose
     * key is the composite of all their columns, so rewriting the foreign key already makes the row
     * unique; inventing a name for a key the user never asked about would be worse.
     */
    const autoFollowReferences = async (): Promise<void> => {
      const reverseReferences = deps.reverseReferencesByTable ?? {};
      const ignored = deps.tablesToIgnore ?? [];

      for (const renamed of renamedKeys) {
        const referencingPairs = reverseReferences[renamed.table]?.[renamed.column] ?? [];

        for (const [refTable, refColumn] of referencingPairs) {
          if (ignored.includes(refTable)) continue;

          const refTableFiles = await loadTable(refTable);
          for (const refTableFile of refTableFiles) {
            const refSchema = refTableFile.packedFile.tableSchema;
            if (!refSchema) continue;

            for (const refRow of deps.getRows(refTableFile.packedFile)) {
              if (getCellValue(refRow, refColumn) !== renamed.originalValue) continue;

              const identity = `${refTable}|${getRowIdentity(refRow)}`;
              if (seenInPass.has(identity)) continue;
              seenInPass.add(identity);

              if (collected.length >= MAX_DEEP_CLONE_ROWS) {
                throw new Error(
                  `Deep clone exceeded ${MAX_DEEP_CLONE_ROWS} rows while following references. Turn off "Also clone rows that reference the new keys" or narrow the clone plan.`,
                );
              }

              collected.push({
                tableName: refTable,
                tableSchema: refSchema,
                version: refTableFile.packedFile.version,
                sourceRow: refRow,
              });
            }
          }

          // A table with a key of its own that other tables point at would need that key renamed
          // too, which auto-follow deliberately does not do. Say so rather than emit it silently.
          const ownReferencedColumns = (deps.referencedColumnsByTable[refTable] ?? []).filter(
            (columnName) => columnName !== refColumn,
          );
          if (ownReferencedColumns.length > 0) {
            const warning = `Auto-followed rows in ${refTable} keep their original ${ownReferencedColumns.join("/")} value; add it to the clone plan if it needs a new key`;
            if (!warnings.includes(warning)) warnings.push(warning);
          }
        }
      }
    };

    await walk(rootNode, rootTableFile, rootRow);

    // Runs after the walk so every renamed key is known, and before materialization so the collected
    // rows go through the same foreign key rewrite as the rest.
    if (plan.autoFollowReferences) {
      await autoFollowReferences();
    }

    // Materialize once the rename map is complete, so a row cloned early can still pick up a key
    // registered later in the walk.
    for (const entry of collected) {
      const cloned = structuredClone(entry.sourceRow);

      for (let cellIndex = 0; cellIndex < cloned.length; cellIndex++) {
        const cell = cloned[cellIndex];
        const field = entry.tableSchema.fields[cellIndex];
        if (!field) continue;

        let newValue: string | undefined;

        // Outgoing foreign key: does this cell point at a row we renamed?
        if (field.is_reference && field.is_reference.length > 1) {
          newValue = renames.get(
            getRenameKey(field.is_reference[0], field.is_reference[1], cell.resolvedKeyValue),
          );
        }
        // The row's own key.
        if (newValue === undefined) {
          newValue = renames.get(getRenameKey(entry.tableName, cell.name, cell.resolvedKeyValue));
        }

        if (newValue !== undefined) {
          cell.fields = [{ type: "Buffer" as FIELD_TYPE, val: await typeToBuffer(field.field_type, newValue) }];
          cell.resolvedKeyValue = newValue;
        }
      }

      // Column overrides: global first, then the variant's (variant wins).
      for (const override of [...plan.columnOverrides, ...variant.overrides]) {
        if (override.table !== entry.tableName) continue;
        const cellIndex = entry.tableSchema.fields.findIndex((field) => field.name == override.column);
        if (cellIndex < 0 || !cloned[cellIndex]) {
          warnings.push(`Override target ${override.table}.${override.column} not found`);
          continue;
        }
        const field = entry.tableSchema.fields[cellIndex];
        const value = applyNameTemplate(override.value, {
          original: rootOriginal,
          selfOriginal: getCellValue(entry.sourceRow, override.column) ?? "",
          variant: variant.suffix,
        });
        cloned[cellIndex].fields = [
          { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer(field.field_type, value) },
        ];
        cloned[cellIndex].resolvedKeyValue = value;
      }

      // Synthetic numeric ids must not be copied from the source row.
      const numericIdField = deps.numericIdFieldByTable[entry.tableName];
      if (numericIdField) {
        const cellIndex = entry.tableSchema.fields.findIndex((field) => field.name == numericIdField);
        if (cellIndex > -1 && cloned[cellIndex]) {
          const field = entry.tableSchema.fields[cellIndex];
          const newId = await createUniqueNumericId(entry.tableName, numericIdField, field.field_type);
          if (newId !== undefined) {
            cloned[cellIndex].fields = [
              { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer(field.field_type, newId) },
            ];
            cloned[cellIndex].resolvedKeyValue = newId;
          }
        }
      }

      const emittedKey = `${entry.tableName}|${cloned.map((cell) => cell.resolvedKeyValue).join("")}`;
      if (emittedRowKeys.has(emittedKey)) continue;
      emittedRowKeys.add(emittedKey);

      let outputTable = outputTables.get(entry.tableName);
      if (!outputTable) {
        outputTable = {
          tableName: entry.tableName,
          tableSchema: entry.tableSchema,
          version: entry.version,
          rows: [],
        };
        outputTables.set(entry.tableName, outputTable);
      }
      outputTable.rows.push(cloned);
      clonedRowCount++;

      let pairs = clonedPairsByTable.get(entry.tableName);
      if (!pairs) {
        pairs = [];
        clonedPairsByTable.set(entry.tableName, pairs);
      }
      pairs.push({ cloned, source: entry.sourceRow });
    }
  };

  for (const rootTableFile of rootTableFiles) {
    const schema = rootTableFile.packedFile.tableSchema;
    if (!schema) {
      warnings.push(`Input table ${rootTableFile.tableName} has no schema and was skipped`);
      continue;
    }
    for (const rootRow of deps.getRows(rootTableFile.packedFile)) {
      for (const variant of variants) {
        await runPass(rootTableFile, rootRow, variant);
      }
    }
  }

  log(`Deep clone: produced ${clonedRowCount} row(s) across ${outputTables.size} table(s)`);

  const tables = [...outputTables.values()];

  if (plan.generateLoc) {
    const locTable = await buildLocTable(clonedPairsByTable, outputTables, deps);
    if (locTable) tables.push(locTable);
  }

  return { tables, clonedRowCount, collisions, warnings };
};

/**
 * Builds a single loc pseudo-table covering every cloned row of every table that declares
 * localised_fields. The original English text is looked up using the source row's loc key, which we
 * still have because each cloned row is kept paired with the row it came from.
 */
const buildLocTable = async (
  clonedPairsByTable: Map<string, Array<{ cloned: AmendedSchemaField[]; source: AmendedSchemaField[] }>>,
  outputTables: Map<string, DeepCloneOutputTable>,
  deps: DeepCloneDependencies,
): Promise<DeepCloneOutputTable | undefined> => {
  const locRows: AmendedSchemaField[][] = [];
  const seenLocKeys = new Set<string>();

  for (const [tableName, pairs] of clonedPairsByTable) {
    const tableSchema = outputTables.get(tableName)?.tableSchema;
    if (!tableSchema?.localised_fields || tableSchema.localised_fields.length < 1) continue;

    const keyColumns = getLocKeyColumns(tableSchema, deps.referencedColumnsByTable[tableName] || []);
    if (keyColumns.length === 0) continue;

    for (const locField of tableSchema.localised_fields) {
      for (const pair of pairs) {
        const newLocKey = buildLocKey(tableName, locField.name, pair.cloned, keyColumns);
        if (seenLocKeys.has(newLocKey)) continue;
        seenLocKeys.add(newLocKey);

        const originalLocKey = buildLocKey(tableName, locField.name, pair.source, keyColumns);
        const text = deps.lookupLocText?.(originalLocKey) ?? "";

        const cellValues = [newLocKey, text, "0"];
        const cellBuffers = [
          { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer("StringU16", newLocKey) },
          { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer("StringU16", text) },
          { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer("Boolean", "0") },
        ];

        locRows.push(
          LocFields.map((locSchemaField, index) => ({
            name: locSchemaField.name,
            resolvedKeyValue: cellValues[index],
            type: "Buffer" as const,
            fields: [cellBuffers[index]],
            isKey: locSchemaField.is_key,
          })),
        );
      }
    }
  }

  if (locRows.length === 0) return undefined;

  return {
    tableName: "deepclone_loc",
    tableSchema: LocVersion,
    version: 1,
    rows: locRows,
    outputPathPrefix: "text\\db\\",
    outputPathSuffix: ".loc",
  };
};
