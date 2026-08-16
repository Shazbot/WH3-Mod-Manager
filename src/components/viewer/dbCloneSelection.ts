/**
 * Selecting a nested direct reference also selects the direct rows needed to reach it. Indirect
 * references are optional clone targets, though, so merely being an ancestor must not check them.
 */
export const getDBCloneAutoSelectedParentNames = (
  parentNodeNames: string[],
  nodeNameToData: Record<string, IViewerTreeNodeWithData>,
) => parentNodeNames.filter((nodeName) => !nodeNameToData[nodeName]?.isIndirectRef);

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
