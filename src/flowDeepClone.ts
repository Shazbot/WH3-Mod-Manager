import { typeToBuffer } from "./packFileSerializer";
import {
  AmendedSchemaField,
  DBField,
  DBVersion,
  LocFields,
  LocVersion,
  Pack,
  PackedFile,
  FIELD_TYPE,
} from "./packFileTypes";
import type {
  DeepCloneOverride,
  DeepCloneTreeNode,
  DeepCloneVariantAxis,
} from "./nodeGraph/nodes/types";
import { expandRangeAxis, findTemplatesMissingVariant } from "./nodeGraph/deepCloneTree";
import { buildLocKey, getLocKeyColumns } from "./utility/locKeyGeneration";
import {
  evaluateFormula,
  formatFormulaResult,
  isNumericFieldType,
  isPlainNumber,
} from "./utility/formulaEvaluation";

/** Guards against a variant product or a reference closure that would blow up the executor. */
// A range axis makes large variant counts a normal thing to ask for; the limit is here to catch a
// runaway range, not to cap deliberate use.
export const MAX_DEEP_CLONE_VARIANTS = 2000;
export const MAX_DEEP_CLONE_ROWS = 200000;
/** Stops a malformed mask sequence from probing forever. */
export const MAX_DEEP_CLONE_IMAGE_MASKS = 64;

/** A file to copy verbatim under a new name alongside the cloned rows. */
export interface DeepCloneFileCopy {
  sourceName: string;
  targetName: string;
}

/** Reads the named files out of one pack, returning their bytes by name. */
export type PackedFileReader = (
  packPath: string,
  names: string[],
) => Promise<Map<string, Buffer | undefined>>;

/**
 * Turns the engine's file copy list into save-node entries carrying the source bytes.
 *
 * Grouped by source pack so each pack is opened once, the way loadIconsFromPacks does. Entries carry
 * `outputFileName` so the save node writes them at exactly that path rather than under a generated
 * db name — the game finds this art by unit key.
 */
export const buildFileCopyOutputs = async (
  fileCopies: DeepCloneFileCopy[],
  packPathByFileName: Map<string, string>,
  readPackedFiles: PackedFileReader,
  sourceFile: Pack | undefined,
  onWarn: (message: string) => void,
): Promise<DBTablesNodeTable[]> => {
  const copiesByPackPath = new Map<string, DeepCloneFileCopy[]>();
  for (const fileCopy of fileCopies) {
    const sourcePackPath = packPathByFileName.get(fileCopy.sourceName);
    if (!sourcePackPath) {
      onWarn(`No pack holds ${fileCopy.sourceName}`);
      continue;
    }
    const packCopies = copiesByPackPath.get(sourcePackPath) ?? [];
    packCopies.push(fileCopy);
    copiesByPackPath.set(sourcePackPath, packCopies);
  }

  const outputs: DBTablesNodeTable[] = [];
  for (const [sourcePackPath, packCopies] of copiesByPackPath) {
    let bytesByName: Map<string, Buffer | undefined>;
    try {
      bytesByName = await readPackedFiles(
        sourcePackPath,
        packCopies.map((fileCopy) => fileCopy.sourceName),
      );
    } catch (error) {
      onWarn(
        `Could not read art from ${sourcePackPath}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      continue;
    }

    for (const fileCopy of packCopies) {
      const buffer = bytesByName.get(fileCopy.sourceName);
      if (!buffer) {
        onWarn(`No content for ${fileCopy.sourceName}`);
        continue;
      }
      outputs.push({
        name: fileCopy.targetName,
        fileName: fileCopy.targetName,
        sourceFile: sourceFile as Pack,
        table: {
          name: fileCopy.targetName,
          file_size: buffer.length,
          start_pos: 0,
          buffer,
        } as PackedFile,
        outputFileName: fileCopy.targetName,
      });
    }
  }

  return outputs;
};

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
  /**
   * Whether a pack-relative file exists across the search packs. Supplied only when key-addressed art
   * should be copied; without it no file copies are produced.
   */
  hasPackedFile?: (name: string) => boolean;
  /** Every indexed file name under a folder, for the wildcard form of filename_relative_path. */
  listPackedFiles?: (prefix: string) => string[];
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
  /** Key-addressed art to copy under the new keys; the caller supplies the bytes. */
  fileCopies: DeepCloneFileCopy[];
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
    const values =
      axis.kind === "range" ? expandRangeAxis(axis) : (axis.values || []).filter((value) => value);
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

/**
 * Turns an override value into the string to write into the cell.
 *
 * A numeric column accepts an arithmetic expression in `x`, the cell's original value — "x*2",
 * "x+10", "1.5*x". Anything already a plain number, and every non-numeric column, is taken literally,
 * so a string column may safely contain an "x". A formula that fails to evaluate is reported and the
 * literal text is kept rather than silently writing a zero.
 */
const resolveOverrideValue = (
  value: string,
  originalValue: string,
  field: DBField,
  warnings: string[],
): string => {
  if (!isNumericFieldType(field.field_type) || isPlainNumber(value)) return value;

  if (value.includes("{{")) {
    warnings.push(
      `Override for ${field.name} still contains an unresolved flow option placeholder ('${value}'); check the option id`,
    );
    return value;
  }

  try {
    return formatFormulaResult(evaluateFormula(value, Number(originalValue) || 0), field.field_type);
  } catch {
    warnings.push(`Could not evaluate override formula '${value}' for ${field.name}; used it as written`);
    return value;
  }
};

/**
 * Splits the schema's filename_relative_path into its patterns. One field can name several files -
 * a unit card plus its masks, say - separated by semicolons, and the schema writes them with forward
 * slashes while pack paths use backslashes.
 */
export const parseFilenameRelativePaths = (filenameRelativePath: unknown): string[] => {
  if (typeof filenameRelativePath !== "string" || !filenameRelativePath.trim()) return [];
  return filenameRelativePath
    .split(";")
    .map((pattern) => pattern.trim().replace(/\//g, "\\"))
    .filter((pattern) => pattern.length > 0);
};

/**
 * Rewrites a value that embeds the row's key, used for the wildcard patterns where the cell already
 * holds a path rather than a bare name: swapping the key inside it gives the path of the copy.
 */
export const replaceKeyInValue = (value: string, originalKey: string, newKey: string): string =>
  originalKey && value.includes(originalKey) ? value.split(originalKey).join(newKey) : value;

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

  // Failing loudly beats producing keys that silently lack the prefix they were meant to carry: on
  // someone else's machine that means a mod whose keys collide with everyone else's.
  if (plan.useModdersPrefix && !plan.moddersPrefix.trim()) {
    throw new Error(
      'The deep clone node is set to prepend the modders prefix, but no prefix is saved with the flow. Set a modders prefix in the app options and reopen the flow, or untick "Prepend modders prefix".',
    );
  }

  // Reported once up front rather than per pass, which would repeat it for every row and variant.
  if (variants.length > 1) {
    for (const tableName of findTemplatesMissingVariant(rootNode, plan.nameTemplate)) {
      warnings.push(
        `${tableName} has a key template without {variant}, so all ${variants.length} variants would share one key. Add {variant} to the template.`,
      );
    }
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

  /** Art to copy under the new keys, keyed by target so a file is never queued twice. */
  const fileCopiesByTarget = new Map<string, DeepCloneFileCopy>();
  const collectFileCopiesForCell = (
    tableName: string,
    field: DBField,
    patterns: string[],
    cellValue: string,
    renamedKey: { originalKey: string; newKey: string },
  ): string | undefined => {
    const hasPackedFile = deps.hasPackedFile;
    if (!hasPackedFile) return undefined;

    // A concrete pattern names the file after the key, so the copy simply takes the new key.
    let concreteCopyMade = false;
    // A wildcard pattern has the cell holding a path, so the copy's path comes from swapping the key
    // inside that value.
    let wildcardCellValue: string | undefined;

    for (const pattern of patterns) {
      if (pattern.includes("*")) {
        const listPackedFiles = deps.listPackedFiles;
        if (!listPackedFiles) continue;

        const swappedValue = replaceKeyInValue(cellValue, renamedKey.originalKey, renamedKey.newKey);
        if (swappedValue === cellValue) continue;

        const sourcePrefix = pattern.replace("%", cellValue).replace(/\*.*$/, "");
        const targetPrefix = pattern.replace("%", swappedValue).replace(/\*.*$/, "");
        for (const sourceName of listPackedFiles(sourcePrefix)) {
          const targetName = `${targetPrefix}${sourceName.slice(sourcePrefix.length)}`;
          if (targetName === sourceName) continue;
          if (!fileCopiesByTarget.has(targetName)) {
            fileCopiesByTarget.set(targetName, { sourceName, targetName });
          }
          wildcardCellValue = swappedValue;
        }
        continue;
      }

      const sourceName = pattern.split("%").join(cellValue);
      if (!hasPackedFile(sourceName)) continue;
      const targetName = pattern.split("%").join(renamedKey.newKey);
      if (targetName === sourceName) continue;
      if (!fileCopiesByTarget.has(targetName)) {
        fileCopiesByTarget.set(targetName, { sourceName, targetName });
      }
      concreteCopyMade = true;

      // The schema's mask list is not exhaustive - main_units_tables declares _mask1 and _mask2
      // while units in the game data have a _mask3 - so once a numbered mask matches, keep counting
      // until one is missing.
      const maskMatch = pattern.match(/^(.*_mask)(\d+)(\..*)$/);
      if (!maskMatch) continue;
      const [, maskPrefix, maskNumber, maskExtension] = maskMatch;
      for (let maskIndex = Number(maskNumber) + 1; maskIndex <= MAX_DEEP_CLONE_IMAGE_MASKS; maskIndex++) {
        const nextPattern = `${maskPrefix}${maskIndex}${maskExtension}`;
        const nextSource = nextPattern.split("%").join(cellValue);
        if (!hasPackedFile(nextSource)) break;
        const nextTarget = nextPattern.split("%").join(renamedKey.newKey);
        if (nextTarget === nextSource) break;
        if (!fileCopiesByTarget.has(nextTarget)) {
          fileCopiesByTarget.set(nextTarget, { sourceName: nextSource, targetName: nextTarget });
        }
      }
    }

    if (concreteCopyMade) return renamedKey.newKey;
    if (wildcardCellValue !== undefined) return wildcardCellValue;

    log(`No file found for ${tableName}.${field.name} '${cellValue}'; left pointing at the original`);
    return undefined;
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
     * Auto-followed rows keep their own key untouched, so a row is only safe to copy when rewriting
     * the foreign key actually changes its identity. That holds for junction tables, whose key is
     * the composite of all their columns including the reference. It does not hold when the
     * reference is merely an attribute: copying main_units_tables because it points at a renamed
     * land_units_tables key would emit a second row under the original unit key, overriding the real
     * unit instead of cloning it. Those rows are skipped and reported.
     */
    const autoFollowReferences = async (): Promise<void> => {
      const reverseReferences = deps.reverseReferencesByTable ?? {};
      const ignored = deps.tablesToIgnore ?? [];

      /**
       * The columns that give a row of this table an identity: the ones other tables reference, plus
       * the schema's is_key columns. Composite-key junction tables list every column here, which is
       * exactly what makes rewriting one of them enough to keep the copy distinct.
       */
      const getIdentityColumns = (tableName: string, schema: DBVersion): string[] => {
        const identityColumns = new Set(deps.referencedColumnsByTable[tableName] ?? []);
        for (const field of schema.fields) {
          if (field.is_key) identityColumns.add(field.name);
        }
        return [...identityColumns];
      };

      for (const renamed of renamedKeys) {
        const referencingPairs = reverseReferences[renamed.table]?.[renamed.column] ?? [];

        for (const [refTable, refColumn] of referencingPairs) {
          if (ignored.includes(refTable)) continue;

          const refTableFiles = await loadTable(refTable);
          for (const refTableFile of refTableFiles) {
            const refSchema = refTableFile.packedFile.tableSchema;
            if (!refSchema) continue;

            const identityColumns = getIdentityColumns(refTable, refSchema);
            // A synthetic numeric id is regenerated during materialization, so it makes the copy
            // distinct just as rewriting the reference would.
            const numericIdField = deps.numericIdFieldByTable[refTable];
            // No identity of its own, or something that changes is part of it: the copy cannot
            // collide with the original, so every matching row can be taken.
            const referenceIsPartOfIdentity =
              identityColumns.length === 0 ||
              identityColumns.includes(refColumn) ||
              (numericIdField !== undefined && identityColumns.includes(numericIdField));

            for (const refRow of deps.getRows(refTableFile.packedFile)) {
              if (getCellValue(refRow, refColumn) !== renamed.originalValue) continue;

              // Otherwise the copy only stays distinct if its own identity is being renamed too,
              // which happens when the row is already part of the clone.
              if (!referenceIsPartOfIdentity) {
                const identityIsRenamed = identityColumns.some((columnName) => {
                  const value = getCellValue(refRow, columnName);
                  return value !== undefined && renames.has(getRenameKey(refTable, columnName, value));
                });
                if (!identityIsRenamed) {
                  const warning = `Skipped ${refTable} rows that reference ${renamed.table}.${renamed.column} through ${refColumn}: copying them would reuse their existing ${identityColumns.join("/")} and override the original rows. Add ${refTable} to the clone plan if it should be cloned.`;
                  if (!warnings.includes(warning)) warnings.push(warning);
                  continue;
                }
              }

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

      // Only a row that gets a key of its own should get its own copies of the files that key names.
      let renamedKeyOnRow: { originalKey: string; newKey: string } | undefined;

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
          const ownKeyRename = renames.get(getRenameKey(entry.tableName, cell.name, cell.resolvedKeyValue));
          if (ownKeyRename !== undefined) {
            renamedKeyOnRow = { originalKey: cell.resolvedKeyValue, newKey: ownKeyRename };
            newValue = ownKeyRename;
          }
        }

        if (newValue !== undefined) {
          cell.fields = [{ type: "Buffer" as FIELD_TYPE, val: await typeToBuffer(field.field_type, newValue) }];
          cell.resolvedKeyValue = newValue;
        }
      }

      // Files the schema addresses through this row's key: copy them under the new key and point the
      // cell at the copy. Done after the key rewrite so the new key is known.
      if (renamedKeyOnRow) {
        for (let cellIndex = 0; cellIndex < cloned.length; cellIndex++) {
          const field = entry.tableSchema.fields[cellIndex];
          const sourceCell = entry.sourceRow[cellIndex];
          if (!field || !sourceCell) continue;

          const patterns = parseFilenameRelativePaths(field.filename_relative_path);
          if (patterns.length === 0 || !sourceCell.resolvedKeyValue) continue;

          const newCellValue = collectFileCopiesForCell(
            entry.tableName,
            field,
            patterns,
            sourceCell.resolvedKeyValue,
            renamedKeyOnRow,
          );
          if (newCellValue === undefined) continue;

          cloned[cellIndex].fields = [
            { type: "Buffer" as FIELD_TYPE, val: await typeToBuffer(field.field_type, newCellValue) },
          ];
          cloned[cellIndex].resolvedKeyValue = newCellValue;
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
        const originalValue = getCellValue(entry.sourceRow, override.column) ?? "";
        const value = resolveOverrideValue(
          applyNameTemplate(override.value, {
            original: rootOriginal,
            selfOriginal: originalValue,
            variant: variant.suffix,
          }),
          originalValue,
          field,
          warnings,
        );
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

  const fileCopies = [...fileCopiesByTarget.values()];
  if (fileCopies.length > 0) {
    log(`Deep clone: ${fileCopies.length} file(s) to copy alongside the cloned rows`);
  }

  return { tables, fileCopies, clonedRowCount, collisions, warnings };
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
