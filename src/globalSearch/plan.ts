import * as nodePath from "node:path";

import {
  GLOBAL_SEARCH_RESULT_KINDS,
  type GlobalSearchRequest,
  type GlobalSearchResultKind,
  type GlobalSearchSource,
} from "./types";

export interface GlobalSearchCatalogPack {
  path: string;
  name?: string;
  humanName?: string;
  isEnabled?: boolean;
  isDeleted?: boolean;
  hasUnsavedChanges?: boolean;
}

export interface GlobalSearchCatalog {
  /** Packs with a tab in the viewer. */
  openPacks?: readonly GlobalSearchCatalogPack[];
  /** The live enabled list. */
  enabledMods?: readonly GlobalSearchCatalogPack[];
  /** The complete disk catalog. */
  allMods?: readonly GlobalSearchCatalogPack[];
  /** Convenient fallback for tests and callers that have one combined catalog. */
  packs?: readonly GlobalSearchCatalogPack[];
}

export interface GlobalSearchTarget {
  kind: "vanilla" | "pack";
  path?: string;
  label: string;
  kinds: GlobalSearchResultKind[];
  hasUnsavedChanges?: boolean;
}

const pathKey = (path: string): string => nodePath.resolve(path).toLowerCase();

const labelForPack = (pack: GlobalSearchCatalogPack): string =>
  pack.humanName?.trim() || pack.name?.trim() || pack.path.split(/[\\/]/).pop() || pack.path;

const findCatalogPack = (path: string, catalog: GlobalSearchCatalog): GlobalSearchCatalogPack | undefined => {
  const key = pathKey(path);
  return [
    ...(catalog.openPacks ?? []),
    ...(catalog.enabledMods ?? []),
    ...(catalog.allMods ?? []),
    ...(catalog.packs ?? []),
  ].find((pack) => pathKey(pack.path) === key);
};

const kindsForRequest = (request: GlobalSearchRequest): GlobalSearchResultKind[] =>
  GLOBAL_SEARCH_RESULT_KINDS.filter((kind) => request.kinds[kind]);

const sourcePacks = (source: GlobalSearchSource, catalog: GlobalSearchCatalog): GlobalSearchCatalogPack[] => {
  if (source.kind === "pack") {
    const catalogPack = findCatalogPack(source.path, catalog);
    return [catalogPack ? { ...catalogPack, path: source.path } : { path: source.path }];
  }
  if (source.kind === "openPacks") return [...(catalog.openPacks ?? catalog.packs ?? [])];
  if (source.kind === "enabledMods") {
    return [...(catalog.enabledMods ?? (catalog.packs ?? []).filter((pack) => pack.isEnabled))];
  }
  if (source.kind === "allMods") {
    return [...(catalog.allMods ?? catalog.packs ?? []).filter((pack) => !pack.isDeleted)];
  }
  return [];
};

/** Resolves UI sources into stable, ordered and deduplicated search targets. */
export const resolveSearchTargets = (
  request: GlobalSearchRequest,
  catalog: GlobalSearchCatalog = {},
): GlobalSearchTarget[] => {
  const kinds = kindsForRequest(request);
  const targets: GlobalSearchTarget[] = [];
  const byPath = new Map<string, GlobalSearchTarget>();
  let vanillaTarget: GlobalSearchTarget | undefined;

  for (const source of request.sources) {
    if (source.kind === "vanilla") {
      if (!vanillaTarget) {
        vanillaTarget = { kind: "vanilla", label: "Vanilla", kinds: [...kinds] };
        targets.push(vanillaTarget);
      }
      continue;
    }

    for (const pack of sourcePacks(source, catalog)) {
      if (!pack.path || pack.isDeleted) continue;
      const key = pathKey(pack.path);
      let target = byPath.get(key);
      if (!target) {
        target = {
          kind: "pack",
          path: pack.path,
          label: labelForPack(pack),
          kinds: [...kinds],
          hasUnsavedChanges: pack.hasUnsavedChanges,
        };
        byPath.set(key, target);
        targets.push(target);
      } else if (pack.hasUnsavedChanges) {
        target.hasUnsavedChanges = true;
      }
    }
  }

  return targets;
};

export const getSearchTargetKey = (target: GlobalSearchTarget): string =>
  target.kind === "vanilla" ? "vanilla" : pathKey(target.path ?? "");
