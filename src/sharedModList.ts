import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import { isWorkshopMod } from "./modSources";

const LOCAL_MOD_PREFIX = "local:";

const parseLoadOrder = (value: string | undefined): number | undefined => {
  if (value == null || value === "") return undefined;
  const loadOrder = Number(value);
  return Number.isFinite(loadOrder) ? loadOrder : undefined;
};

const isNumericWorkshopId = (workshopId: string): boolean => /^\d+$/.test(workshopId.trim());

export const serializeSharedModList = (mods: Mod[], availableMods: Mod[] = mods): string => {
  const workshopIdByModName = new Map(
    availableMods
      .filter((mod) => isWorkshopMod(mod) && isNumericWorkshopId(mod.workshopId))
      .map((mod) => [mod.name.toLocaleLowerCase(), mod.workshopId]),
  );

  return sortByNameAndLoadOrder(mods)
    .filter((mod) => mod.isEnabled)
    .map((mod) => {
      const hasWorkshopId = isNumericWorkshopId(mod.workshopId);
      let identifier: string;
      if (isWorkshopMod(mod) && hasWorkshopId) {
        identifier = mod.workshopId;
      } else {
        const fallbackWorkshopId =
          workshopIdByModName.get(mod.name.toLocaleLowerCase()) ?? (hasWorkshopId ? mod.workshopId : "");
        identifier = `${LOCAL_MOD_PREFIX}${encodeURIComponent(mod.name)}`;
        if (fallbackWorkshopId) identifier += `:${fallbackWorkshopId}`;
      }
      return identifier + (mod.loadOrder != null ? `;${mod.loadOrder}` : "");
    })
    .join("|");
};

export const parseSharedModList = (text: string): ModIdAndLoadOrder[] =>
  text
    .trim()
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [identifier, loadOrderValue] = entry.split(";", 2);
      const loadOrder = parseLoadOrder(loadOrderValue);
      if (!identifier.startsWith(LOCAL_MOD_PREFIX)) {
        return { workshopId: identifier, loadOrder };
      }

      const localIdentifier = identifier.slice(LOCAL_MOD_PREFIX.length);
      const fallbackSeparatorIndex = localIdentifier.lastIndexOf(":");
      const possibleFallbackWorkshopId =
        fallbackSeparatorIndex >= 0 ? localIdentifier.slice(fallbackSeparatorIndex + 1) : "";
      const hasFallbackWorkshopId = isNumericWorkshopId(possibleFallbackWorkshopId);
      const encodedModName = hasFallbackWorkshopId ? localIdentifier.slice(0, fallbackSeparatorIndex) : localIdentifier;
      let modName = encodedModName;
      try {
        modName = decodeURIComponent(encodedModName);
      } catch {
        // Keep malformed names usable rather than rejecting the entire shared list.
      }
      return {
        workshopId: hasFallbackWorkshopId ? possibleFallbackWorkshopId : "",
        modName,
        loadOrder,
      };
    });

export const sharedModMatchesInstalledMod = (sharedMod: ModIdAndLoadOrder, mod: Mod): boolean =>
  (sharedMod.modName != null &&
    mod.name.localeCompare(sharedMod.modName, undefined, { sensitivity: "accent" }) === 0) ||
  (sharedMod.workshopId !== "" && mod.workshopId === sharedMod.workshopId);

export const getMissingSharedWorkshopIds = (sharedMods: ModIdAndLoadOrder[], availableMods: Mod[]): string[] => {
  const installedWorkshopIds = new Set(availableMods.filter(isWorkshopMod).map((mod) => mod.workshopId));
  return [
    ...new Set(
      sharedMods
        .map((mod) => mod.workshopId)
        .filter((workshopId) => workshopId !== "" && !installedWorkshopIds.has(workshopId)),
    ),
  ];
};
