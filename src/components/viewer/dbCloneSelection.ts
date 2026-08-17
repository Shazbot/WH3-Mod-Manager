/**
 * Selecting a nested direct reference also selects the direct rows needed to reach it. Indirect
 * references are optional clone targets, though, so merely being an ancestor must not check them.
 */
export const getDBCloneAutoSelectedParentNames = (
  parentNodeNames: string[],
  nodeNameToData: Record<string, IViewerTreeNodeWithData>,
) => parentNodeNames.filter((nodeName) => !nodeNameToData[nodeName]?.isIndirectRef);

/** Tables to include by default when cloning a building culture variant from the Buildings tab. */
export const BUILDINGS_CULTURE_VARIANT_PRESELECT_TABLES = [
  "building_levels_tables",
  "building_chains_tables",
  "building_chain_availability_sets_tables",
  "building_chain_set_items_tables",
  "building_set_to_building_junctions_tables",
  "building_instances_tables",
  "building_effects_junction_tables",
  "building_units_allowed_tables",
  "building_upgrades_junction_tables",
  "building_level_armed_citizenry_junctions_tables",
  "cai_construction_system_synergies_tables",
  "cai_construction_system_building_values_tables",
  "building_superchains_tables",
  "effect_bonus_value_building_chain_junctions_tables",
  "cai_construction_system_unblocking_buildings_tables",
] as const;

/**
 * Selects the root plus the first node found for each requested table, using breadth-first order.
 * A table may occur many times in the reference tree; only its first row is selected.
 */
export const getDBCloneInitialSelectedNodeNames = (
  tree: IViewerTreeNodeWithData,
  tableNames: readonly string[],
): string[] => {
  const root = tree.children[0] as IViewerTreeNodeWithData | undefined;
  if (!root) return [];

  const requestedTables = new Set(tableNames);
  const selectedTables = new Set<string>();
  if (root.tableName) selectedTables.add(root.tableName);
  const selectedNames = [root.name];
  const pending = [root];

  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    if (requestedTables.has(node.tableName) && !selectedTables.has(node.tableName)) {
      selectedTables.add(node.tableName);
      selectedNames.push(node.name);
    }

    pending.push(...(node.children as IViewerTreeNodeWithData[]));
  }

  return selectedNames;
};

/**
 * Hides an indirect node when its table is already represented by a direct node in that node's
 * ancestor chain. Children are promoted so filtering one redundant step does not hide other useful
 * references below it.
 */
export const filterDBCloneRedundantIndirectReferences = (tree: IViewerTreeNodeWithData): IViewerTreeNodeWithData => {
  const visit = (
    node: IViewerTreeNodeWithData,
    directAncestorTables: ReadonlySet<string>,
  ): IViewerTreeNodeWithData[] => {
    const isDirectTableNode = !node.isIndirectRef && node.tableName != "";
    const shouldHide = !!node.isIndirectRef && directAncestorTables.has(node.tableName);
    const nextDirectAncestorTables = isDirectTableNode
      ? new Set([...directAncestorTables, node.tableName])
      : directAncestorTables;
    const children = (node.children as IViewerTreeNodeWithData[]).flatMap((child) =>
      visit(child, nextDirectAncestorTables),
    );

    if (shouldHide) return children;
    return [{ ...node, children }];
  };

  return visit(tree, new Set())[0] ?? { ...tree, children: [] };
};
