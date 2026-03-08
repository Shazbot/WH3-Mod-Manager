export const getTechnologyNodeScopeValues = (node: Pick<TechnologyNodeData, "factionKey" | "campaignKey">) =>
  [
    node.factionKey ? `faction:${node.factionKey}` : "",
    node.campaignKey ? `campaign:${node.campaignKey}` : "",
  ].filter(Boolean);

export const hasBaseNodesOnlyNodes = (
  nodes: Pick<TechnologyNodeData, "nodeKey" | "factionKey" | "campaignKey">[],
  visibleNodeKeys?: Set<string>,
) =>
  nodes.some((node) => (!visibleNodeKeys || visibleNodeKeys.has(node.nodeKey)) && getTechnologyNodeScopeValues(node).length < 1);

type ResolveTechTreeScopeSelectionInput = {
  selectedScopeKey: string;
  availableScopeKeys: string[];
  hasBaseNodesOnly: boolean;
};

export const resolveTechTreeScopeSelection = ({
  selectedScopeKey,
  availableScopeKeys,
  hasBaseNodesOnly,
}: ResolveTechTreeScopeSelectionInput) => {
  if (selectedScopeKey && availableScopeKeys.includes(selectedScopeKey)) return selectedScopeKey;
  if (selectedScopeKey && !availableScopeKeys.includes(selectedScopeKey)) {
    return hasBaseNodesOnly ? "" : availableScopeKeys[0] || "";
  }
  if (!selectedScopeKey && !hasBaseNodesOnly) {
    return availableScopeKeys[0] || "";
  }
  return selectedScopeKey;
};
