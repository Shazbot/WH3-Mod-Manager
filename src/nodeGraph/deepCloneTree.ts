import type { DBVersion } from "../packFileTypes";
import type { DeepCloneTreeNode } from "./nodes/types";

/**
 * Junction tables that describe DLC ownership rather than unit data. Following them explodes the
 * closure without ever producing anything a modder wants cloned. Mirrors schema.ts's tablesToIgnore.
 */
export const deepCloneTablesToIgnore = [
  "main_unit_ownership_content_pack_junctions_tables",
  "allied_recruitment_core_units_tables",
  "agent_subtype_ownership_content_pack_junctions_tables",
];

export interface DeepCloneReferenceOption {
  table: string;
  keyColumn: string;
  linkColumn: string;
  direction: "forward" | "reverse";
}

/** table -> column -> [[referencingTable, referencingColumn], ...] */
type ReverseReferenceIndex = Record<string, Record<string, string[][]>>;

let cachedSchemaSource: Record<string, DBVersion[]> | undefined;
let cachedReverseIndex: ReverseReferenceIndex = {};

/**
 * Inverts the schema into "who points at me". Same shape as the main process's
 * gameToDBFieldsReferencedBy, rebuilt here because the node editor only receives DBNameToDBVersions.
 * Memoized on identity of the schema object, which the editor fetches once.
 */
export const getReverseReferenceIndex = (
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
): ReverseReferenceIndex => {
  if (!DBNameToDBVersions) return {};
  if (cachedSchemaSource === DBNameToDBVersions) return cachedReverseIndex;

  const index: ReverseReferenceIndex = {};
  for (const [tableName, versions] of Object.entries(DBNameToDBVersions)) {
    const version = versions?.[0];
    if (!version) continue;

    for (const field of version.fields) {
      if (!field.is_reference || field.is_reference.length < 2) continue;
      const [referencedTable, referencedColumn] = field.is_reference;
      if (!DBNameToDBVersions[referencedTable]) continue;

      index[referencedTable] = index[referencedTable] || {};
      index[referencedTable][referencedColumn] = index[referencedTable][referencedColumn] || [];
      if (
        !index[referencedTable][referencedColumn].some(
          (existing) => existing[0] === tableName && existing[1] === field.name,
        )
      ) {
        index[referencedTable][referencedColumn].push([tableName, field.name]);
      }
    }
  }

  cachedSchemaSource = DBNameToDBVersions;
  cachedReverseIndex = index;
  return index;
};

const getTableVersion = (
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  tableName: string,
): DBVersion | undefined => DBNameToDBVersions?.[tableName]?.[0];

/** The column that identifies a row of this table, or "" for keyless junction tables. */
export const getTableKeyColumn = (
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  tableName: string,
  reverseIndex: ReverseReferenceIndex,
): string => {
  const referencedColumns = Object.keys(reverseIndex[tableName] || {});
  if (referencedColumns.length === 1) return referencedColumns[0];

  const version = getTableVersion(DBNameToDBVersions, tableName);
  const keyField = version?.fields.find((field) => field.is_key);
  if (keyField) return keyField.name;

  return referencedColumns[0] || "";
};

/**
 * The tables reachable in one hop from `tableName`: forward through its own is_reference columns,
 * and reverse through columns of other tables that point back at it.
 */
export const getReferenceOptions = (
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  tableName: string,
): DeepCloneReferenceOption[] => {
  const reverseIndex = getReverseReferenceIndex(DBNameToDBVersions);
  const version = getTableVersion(DBNameToDBVersions, tableName);
  if (!version) return [];

  const options: DeepCloneReferenceOption[] = [];
  const seen = new Set<string>();
  const push = (option: DeepCloneReferenceOption) => {
    if (deepCloneTablesToIgnore.includes(option.table)) return;
    const identity = `${option.direction}|${option.table}|${option.linkColumn}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    options.push(option);
  };

  for (const field of version.fields) {
    if (!field.is_reference || field.is_reference.length < 2) continue;
    const [referencedTable, referencedColumn] = field.is_reference;
    if (!DBNameToDBVersions?.[referencedTable]) continue;
    push({
      table: referencedTable,
      keyColumn: referencedColumn,
      linkColumn: field.name,
      direction: "forward",
    });
  }

  for (const [, referencingPairs] of Object.entries(reverseIndex[tableName] || {})) {
    for (const [referencingTable, referencingColumn] of referencingPairs) {
      push({
        table: referencingTable,
        keyColumn: getTableKeyColumn(DBNameToDBVersions, referencingTable, reverseIndex),
        linkColumn: referencingColumn,
        direction: "reverse",
      });
    }
  }

  return options.toSorted(
    (first, second) =>
      first.direction.localeCompare(second.direction) || first.table.localeCompare(second.table),
  );
};

export const createRootTreeNode = (
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  tableName: string,
): DeepCloneTreeNode => ({
  table: tableName,
  keyColumn: getTableKeyColumn(DBNameToDBVersions, tableName, getReverseReferenceIndex(DBNameToDBVersions)),
  linkColumn: "",
  direction: "forward",
  selected: true,
  children: [],
});

/**
 * Fills in a node's children from the schema, preserving the selection and templates of any child
 * already present. Children are only materialized when the user expands a node, because the full
 * reference closure of a table like main_units_tables is enormous.
 */
export const expandTreeNode = (
  DBNameToDBVersions: Record<string, DBVersion[]> | undefined,
  node: DeepCloneTreeNode,
  ancestorTables: string[] = [],
): DeepCloneTreeNode => {
  const existingByIdentity = new Map(
    (node.children || []).map((child) => [`${child.direction}|${child.table}|${child.linkColumn}`, child]),
  );

  const children = getReferenceOptions(DBNameToDBVersions, node.table)
    // Never walk straight back into a table we came from — that is always a round trip.
    .filter((option) => !ancestorTables.includes(option.table))
    .map((option) => {
      const identity = `${option.direction}|${option.table}|${option.linkColumn}`;
      return (
        existingByIdentity.get(identity) ?? {
          table: option.table,
          keyColumn: option.keyColumn,
          linkColumn: option.linkColumn,
          direction: option.direction,
          selected: false,
          children: [],
        }
      );
    });

  return { ...node, children };
};

/**
 * Tables whose key template never substitutes the variant suffix.
 *
 * The suffix only lands where {variant} appears, so with variant axes configured but no {variant} in
 * the template every variant produces the same key — and since each variant still applies its own
 * overrides, the rows differ while sharing that key. The collision check cannot see this: it only
 * compares against keys that already exist in the packs, never variants against each other.
 *
 * Configuring axes and then ignoring them is never deliberate, so this is safe to warn on.
 */
export const findTemplatesMissingVariant = (
  cloneTree: DeepCloneTreeNode | undefined,
  nameTemplate: string,
): string[] => {
  if (!cloneTree) return [];

  const tables: string[] = [];
  const walk = (node: DeepCloneTreeNode) => {
    // Only a node that gets a new key of its own uses a template.
    if (node.keyColumn) {
      const template = node.nameTemplate || nameTemplate || "{original}{variant}";
      if (!template.includes("{variant}") && !tables.includes(node.table)) {
        tables.push(node.table);
      }
    }
    for (const child of node.children || []) {
      if (child.selected) walk(child);
    }
  };
  walk(cloneTree);

  return tables;
};

/** Every table the plan will clone, for populating the override editor's table dropdown. */
export const getSelectedCloneTables = (node: DeepCloneTreeNode | undefined): string[] => {
  if (!node) return [];
  const tables: string[] = [];
  const walk = (current: DeepCloneTreeNode) => {
    if (!tables.includes(current.table)) tables.push(current.table);
    for (const child of current.children || []) {
      if (child.selected) walk(child);
    }
  };
  walk(node);
  return tables;
};
