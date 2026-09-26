/** The pack information used by the viewer's installed-mod pickers. */
export interface ViewerPackCatalogEntry {
  path: string;
  name: string;
  humanName?: string;
  isEnabled: boolean;
  isInData: boolean;
  /** Lower values are the sources chosen first when same-named mods are resolved. */
  priority?: number;
}

export interface ViewerPackCatalogGroup {
  name: string;
  packs: ViewerPackCatalogEntry[];
}

const collator = new Intl.Collator("en");

const packNameKey = (name: string) => name.toLowerCase();

export const getViewerPackLabel = (pack: Pick<ViewerPackCatalogEntry, "name" | "humanName">): string => {
  const humanName = pack.humanName?.trim();
  return humanName && humanName.toLowerCase() !== pack.name.toLowerCase() ? `${humanName} (${pack.name})` : pack.name;
};

/**
 * Groups a catalog into the enabled/disabled sections used by the Open Pack picker.
 *
 * Same-named packs are kept together and sorted by the priority supplied by the main process. The
 * fallback keeps older catalog responses useful and matches the default source order: data before
 * the other mod sources.
 */
export const groupViewerPackCatalog = (
  packs: readonly ViewerPackCatalogEntry[],
  isEnabled: boolean,
): ViewerPackCatalogGroup[] => {
  const groupsByName = new Map<string, ViewerPackCatalogEntry[]>();

  for (const pack of packs) {
    if (pack.isEnabled !== isEnabled) continue;
    const key = packNameKey(pack.name);
    const group = groupsByName.get(key);
    if (group) group.push(pack);
    else groupsByName.set(key, [pack]);
  }

  return [...groupsByName.values()]
    .map((group) => ({
      name: group[0]?.name ?? "",
      packs: group.toSorted((first, second) => {
        const firstPriority = first.priority ?? (first.isInData ? 0 : 1);
        const secondPriority = second.priority ?? (second.isInData ? 0 : 1);
        if (firstPriority !== secondPriority) return firstPriority - secondPriority;

        return (
          collator.compare(getViewerPackLabel(first), getViewerPackLabel(second)) ||
          collator.compare(first.path, second.path)
        );
      }),
    }))
    .toSorted(
      (first, second) =>
        collator.compare(getViewerPackLabel(first.packs[0]), getViewerPackLabel(second.packs[0])) ||
        collator.compare(first.name, second.name),
    );
};
