import type { GameFolderPaths } from "./appData";

export const DATA_MOD_SOURCE_ID = "data";
export const WORKSHOP_MOD_SOURCE_ID = "workshop";

export const getModSourceId = (mod: Mod): string => {
  if (mod.sourceId) return mod.sourceId;
  return mod.isInData ? DATA_MOD_SOURCE_ID : WORKSHOP_MOD_SOURCE_ID;
};

export const getModSourceKind = (mod: Mod): ModSourceKind => {
  if (mod.sourceKind) return mod.sourceKind;
  return mod.isInData ? "data" : "workshop";
};

export const isWorkshopMod = (mod: Mod): boolean => getModSourceKind(mod) === "workshop";

export const normalizeModSourceOrder = (
  folderPaths: Pick<GameFolderPaths, "customModFolders" | "modSourceOrder">,
  canReorderBuiltInSources: boolean,
): string[] => {
  const customSourceIds = (folderPaths.customModFolders || []).map((folder) => folder.id);
  const validSourceIds = new Set([DATA_MOD_SOURCE_ID, WORKSHOP_MOD_SOURCE_ID, ...customSourceIds]);
  const sourceOrder: string[] = [];

  for (const sourceId of folderPaths.modSourceOrder || []) {
    if (validSourceIds.has(sourceId) && !sourceOrder.includes(sourceId)) sourceOrder.push(sourceId);
  }

  if (!sourceOrder.includes(DATA_MOD_SOURCE_ID)) sourceOrder.unshift(DATA_MOD_SOURCE_ID);
  if (!sourceOrder.includes(WORKSHOP_MOD_SOURCE_ID)) sourceOrder.push(WORKSHOP_MOD_SOURCE_ID);
  let nextCustomInsertIndex = sourceOrder.indexOf(DATA_MOD_SOURCE_ID) + 1;
  for (const sourceId of customSourceIds) {
    if (!sourceOrder.includes(sourceId)) {
      sourceOrder.splice(nextCustomInsertIndex, 0, sourceId);
      nextCustomInsertIndex += 1;
    }
  }

  if (!canReorderBuiltInSources) {
    const dataIndex = sourceOrder.indexOf(DATA_MOD_SOURCE_ID);
    const workshopIndex = sourceOrder.indexOf(WORKSHOP_MOD_SOURCE_ID);
    if (workshopIndex < dataIndex) {
      sourceOrder[workshopIndex] = DATA_MOD_SOURCE_ID;
      sourceOrder[dataIndex] = WORKSHOP_MOD_SOURCE_ID;
    }
  }

  return sourceOrder;
};

export const resolveModsBySourcePriority = (
  mods: Mod[],
  folderPaths: Pick<GameFolderPaths, "customModFolders" | "modSourceOrder">,
  canReorderBuiltInSources: boolean,
): Mod[] => {
  const sourceOrder = normalizeModSourceOrder(folderPaths, canReorderBuiltInSources);
  const sourcePriority = new Map(sourceOrder.map((sourceId, index) => [sourceId, index]));
  const sortedMods = mods
    .filter((mod) => getModSourceKind(mod) !== "custom" || sourcePriority.has(getModSourceId(mod)))
    .toSorted((first, second) => {
      const firstPriority = sourcePriority.get(getModSourceId(first)) ?? Number.MAX_SAFE_INTEGER;
      const secondPriority = sourcePriority.get(getModSourceId(second)) ?? Number.MAX_SAFE_INTEGER;
      if (firstPriority !== secondPriority) return firstPriority - secondPriority;

      if (getModSourceId(first) === DATA_MOD_SOURCE_ID && first.isInModding !== second.isInModding) {
        return first.isInModding ? -1 : 1;
      }

      return first.path.localeCompare(second.path);
    });
  const seenNames = new Set<string>();

  return sortedMods.filter((mod) => {
    if (seenNames.has(mod.name)) return false;
    seenNames.add(mod.name);
    return true;
  });
};

export const insertCustomSourceAfterData = (sourceOrder: string[], sourceId: string): string[] => {
  const nextOrder = sourceOrder.filter((iterSourceId) => iterSourceId !== sourceId);
  const dataIndex = nextOrder.indexOf(DATA_MOD_SOURCE_ID);
  nextOrder.splice(dataIndex >= 0 ? dataIndex + 1 : 0, 0, sourceId);
  return nextOrder;
};

export const insertCustomSourceFirst = (sourceOrder: string[], sourceId: string): string[] => [
  sourceId,
  ...sourceOrder.filter((iterSourceId) => iterSourceId !== sourceId),
];
