import type { AnimationSelectionProfile } from "./animationSelection";

export type VisualsUnitPart = {
  role: "crew" | "rider" | "mount" | "engine";
  label: string;
  variantMeshPath: string;
  animationProfile: AnimationSelectionProfile;
};

export type VisualsUnitPartsInfo = {
  mountName?: string;
  /** Land-unit key of the custom-battle base unit this unit's mount group is built around. */
  mountGroup?: string;
  parts: VisualsUnitPart[];
};

export type VisualsPartOption = {
  label: string;
  variantMeshPath: string;
  animationProfile: AnimationSelectionProfile;
};

export type VisualsMountMemberEntry = {
  unitKey: string;
  faction: string;
  variantMeshPath?: string;
};

export type VisualsMountMember<T extends VisualsMountMemberEntry> = { entry: T; label: string };

export const getVisualsVariantKey = (path: string) =>
  path.replace(/\//g, "\\").replace(/\\+/g, "\\").trim().toLowerCase();

export const getVisualsPartOptions = (
  ownVariantMeshPath: string | undefined,
  info: VisualsUnitPartsInfo | undefined,
): VisualsPartOption[] => {
  const parts = info?.parts ?? [];
  const own = ownVariantMeshPath?.trim() ?? "";
  const seat = parts.find((part) => part.role === "crew" || part.role === "rider");
  const options: VisualsPartOption[] = [];
  const seen = new Set<string>();
  const add = (option: VisualsPartOption) => {
    const path = option.variantMeshPath.trim();
    if (!path) return;
    const key = getVisualsVariantKey(path);
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ ...option, variantMeshPath: path });
  };
  if (own) {
    add({
      label: seat?.label || "Crew",
      variantMeshPath: own,
      animationProfile: seat?.animationProfile ?? "ground",
    });
  }
  for (const part of parts) {
    if (part.role === "mount" || part.role === "engine") {
      add({ label: part.label, variantMeshPath: part.variantMeshPath, animationProfile: part.animationProfile });
    }
  }
  if (seat && (!own || getVisualsVariantKey(seat.variantMeshPath) !== getVisualsVariantKey(own))) {
    add({
      label: own ? "Seat crew" : seat.label,
      variantMeshPath: seat.variantMeshPath,
      animationProfile: seat.animationProfile,
    });
  }
  return options;
};

/** Units of the selected row's mount group that render with the same VMD as the row. */
export const getMountVariantMembers = <T extends VisualsMountMemberEntry>(
  selected: T | undefined,
  entries: readonly T[],
  partsByKey: Record<string, VisualsUnitPartsInfo> | null | undefined,
): VisualsMountMember<T>[] => {
  if (!selected || !partsByKey) return [];
  const group = partsByKey[selected.unitKey]?.mountGroup;
  const vmd = selected.variantMeshPath;
  if (!group || !vmd) return [];
  const vmdKey = getVisualsVariantKey(vmd);
  const byUnit = new Map<string, T>();
  for (const entry of entries) {
    if (!entry.variantMeshPath || getVisualsVariantKey(entry.variantMeshPath) !== vmdKey) continue;
    if (partsByKey[entry.unitKey]?.mountGroup !== group) continue;
    const current = byUnit.get(entry.unitKey);
    if (!current || (current.faction !== selected.faction && entry.faction === selected.faction)) {
      byUnit.set(entry.unitKey, entry);
    }
  }
  if (byUnit.size < 2) return [];
  return [...byUnit.values()]
    .sort((a, b) => {
      if (a.unitKey === group) return b.unitKey === group ? 0 : -1;
      if (b.unitKey === group) return 1;
      return a.unitKey < b.unitKey ? -1 : a.unitKey > b.unitKey ? 1 : 0;
    })
    .map((entry) => {
      const info = partsByKey[entry.unitKey];
      const hasMount = info?.parts.some((part) => part.role === "mount") ?? false;
      return { entry, label: info?.mountName ?? (hasMount ? entry.unitKey : "On foot") };
    });
};

/** What a mount sub-row opens: the mount, else the engine, else the unit's own VMD (an on-foot variant). */
export const getMountVariantOpenPath = (
  ownVariantMeshPath: string | undefined,
  info: VisualsUnitPartsInfo | undefined,
): string | undefined => {
  const parts = info?.parts ?? [];
  const part =
    parts.find((candidate) => candidate.role === "mount") ?? parts.find((candidate) => candidate.role === "engine");
  return part?.variantMeshPath || ownVariantMeshPath;
};
