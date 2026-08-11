export interface FlowPackCatalogEntry {
  path: string;
  name: string;
  humanName?: string;
  isEnabled: boolean;
  hasFlows: boolean;
}

export const normalizePackedFlowName = (flowName: string): string | undefined => {
  let normalized = flowName.trim().replaceAll("/", "\\");
  normalized = normalized.replace(/^whmmflows\\/i, "");
  if (!normalized || normalized.startsWith("\\") || normalized.includes("..")) return undefined;
  if (!normalized.toLowerCase().endsWith(".json")) normalized += ".json";
  return `whmmflows\\${normalized}`;
};

export const findExistingPackedFlowName = (fileNames: Iterable<string>, requestedName: string) => {
  const normalizedRequestedName = requestedName.toLowerCase();
  for (const fileName of fileNames) {
    if (fileName.toLowerCase() === normalizedRequestedName) return fileName;
  }
  return undefined;
};

export const orderFlowPackCatalog = (entries: FlowPackCatalogEntry[]): FlowPackCatalogEntry[] => {
  const collator = new Intl.Collator("en");
  return [...entries].toSorted((first, second) => {
    const firstPriority = first.isEnabled && first.hasFlows ? 0 : 1;
    const secondPriority = second.isEnabled && second.hasFlows ? 0 : 1;
    if (firstPriority !== secondPriority) return firstPriority - secondPriority;
    const firstLabel = first.humanName?.trim() || first.name;
    const secondLabel = second.humanName?.trim() || second.name;
    return collator.compare(firstLabel, secondLabel);
  });
};
