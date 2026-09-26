import type { AmendedSchemaField } from "../packFileTypes";

export const getDBCloneNodeKey = (node: Pick<IViewerTreeNodeWithData, "tableName" | "columnName" | "value">): string =>
  JSON.stringify([node.tableName, node.columnName, node.value]);

export const getDBCloneSourceRowKey = (
  tableName: string,
  row: Array<Pick<AmendedSchemaField, "name" | "resolvedKeyValue">>,
  identityColumns: Iterable<string>,
): string => {
  const columns = [...new Set(identityColumns)]
    .filter((columnName) => row.some((cell) => cell.name == columnName))
    .toSorted();
  const identity =
    columns.length > 0
      ? columns.map((columnName) => [columnName, row.find((cell) => cell.name == columnName)?.resolvedKeyValue ?? ""])
      : row.map((cell) => [cell.name, cell.resolvedKeyValue]);
  return JSON.stringify([tableName, identity]);
};

/** A checked tree node selects its own source row, not every sibling that references the same parent. */
export const isDBCloneSourceRowSelected = (
  tableName: string,
  row: Array<Pick<AmendedSchemaField, "name" | "resolvedKeyValue">>,
  selectedNodes: Array<Pick<IViewerTreeNodeWithData, "tableName" | "columnName" | "value">>,
): boolean =>
  selectedNodes.some(
    (node) =>
      node.tableName == tableName &&
      row.some((cell) => cell.name == node.columnName && cell.resolvedKeyValue == node.value),
  );

/**
 * Only direct nodes define new keys. Indirect nodes identify rows to copy; their reference to a
 * direct parent is rewritten through that parent's entry in this map.
 */
export const buildDBCloneDirectRenameMap = (
  nodes: Array<Pick<IViewerTreeNodeWithData, "name" | "tableName" | "columnName" | "value" | "isIndirectRef">>,
  renameValues: Record<string, string>,
  defaultRenameValues: Record<string, string>,
): Map<string, string> => {
  const valuesByCellKey = new Map<string, string>();
  for (const node of nodes) {
    if (node.isIndirectRef) continue;
    const newValue = renameValues[node.name] != null ? renameValues[node.name] : defaultRenameValues[node.name];
    if (newValue != null) valuesByCellKey.set(getDBCloneNodeKey(node), newValue);
  }
  return valuesByCellKey;
};

export interface AddUniqueDBCloneNodeResult {
  node: IViewerTreeNodeWithData;
  added: boolean;
}

/**
 * Adds a row to the spanning tree used by the legacy DB clone UI.
 *
 * A reference graph is not really a tree: the same row can be reached through several paths. The
 * UI still needs a tree, so the first path owns the node and every later path resolves to that same
 * canonical node. A forward path also upgrades a row first found as an indirect dependency, since
 * forward rows receive a new key while indirect rows only have their references rewritten.
 */
export const addUniqueDBCloneNode = (
  parent: IViewerTreeNodeWithData,
  candidate: IViewerTreeNodeWithData,
  nodesByKey: Map<string, IViewerTreeNodeWithData>,
): AddUniqueDBCloneNodeResult => {
  const key = getDBCloneNodeKey(candidate);
  const existing = nodesByKey.get(key);
  if (existing) {
    if (existing.isIndirectRef && !candidate.isIndirectRef) existing.isIndirectRef = false;
    return { node: existing, added: false };
  }

  nodesByKey.set(key, candidate);
  parent.children.push(candidate);
  return { node: candidate, added: true };
};

export const getUniqueDBCloneNodes = (root: IViewerTreeNodeWithData): IViewerTreeNodeWithData[] => {
  const nodes: IViewerTreeNodeWithData[] = [];
  const seen = new Set<string>();
  const pending = [root];

  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex++) {
    const current = pending[pendingIndex];

    const key = getDBCloneNodeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(current);
    pending.push(...(current.children as IViewerTreeNodeWithData[]));
  }

  return nodes;
};
