export const normalizeDBCloneModdersPrefix = (prefix: string) => prefix.trim().replace(/_+$/, "");

/** Applies the configured prefix once, with one separator, to DB Clone's global replacement key. */
export const getDBCloneGlobalKey = (value: string, moddersPrefix: string, appendModdersPrefix: boolean) => {
  const key = value.trim();
  const prefix = normalizeDBCloneModdersPrefix(moddersPrefix);
  if (!key || !appendModdersPrefix || !prefix) return key;
  if (key === prefix || key.startsWith(`${prefix}_`)) return key;
  return `${prefix}_${key}`;
};

export const applyDBCloneGlobalKey = (
  existingValues: Record<string, string>,
  selectedNodeNames: string[],
  nodesByName: Record<string, { isIndirectRef?: boolean } | undefined>,
  globalKey: string,
) => {
  const values = { ...existingValues };
  for (const nodeName of selectedNodeNames) {
    const node = nodesByName[nodeName];
    if (node && !node.isIndirectRef) values[nodeName] = globalKey;
  }
  return values;
};
