/**
 * Selecting a nested direct reference also selects the direct rows needed to reach it. Indirect
 * references are optional clone targets, though, so merely being an ancestor must not check them.
 */
export const getDBCloneAutoSelectedParentNames = (
  parentNodeNames: string[],
  nodeNameToData: Record<string, IViewerTreeNodeWithData>,
) => parentNodeNames.filter((nodeName) => !nodeNameToData[nodeName]?.isIndirectRef);
