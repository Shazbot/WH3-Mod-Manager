import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AutoSizer, List, type ListRowProps } from "react-virtualized";
import { IoChevronDown, IoChevronForward, IoSearch } from "react-icons/io5";
import { useLocalizations } from "../../localizationContext";
import {
  ALL_ANCILLARY_MODS,
  VANILLA_ANCILLARY_MODS,
  createAncillaryFilter,
  matchesModFilter,
} from "../../ancillariesData/filter";
import type { AncillariesCatalog, AncillarySummary } from "../../ancillariesData/types";

export type AncillariesBrowserProps = {
  catalog: AncillariesCatalog | undefined;
  selectedKey?: string;
  onSelect: (key: string) => void;
  onContextMenu?: (ancillary: AncillarySummary, event: React.MouseEvent) => void;
  /** Enabled mods, for the "filter by mod" dropdown's labels. */
  mods: Array<{ path: string; label: string }>;
  isLoading?: boolean;
  error?: string;
};

/** A flattened tree row; the virtualized list renders one of these per line. */
type BrowserRow =
  | { kind: "category"; key: string; name: string; iconUrl?: string; count: number }
  | { kind: "subcategory"; key: string; name: string; count: number }
  | { kind: "ancillary"; key: string; ancillary: AncillarySummary; nested: boolean };

/** Collapse key for a subcategory, kept distinct from a category of the same name. */
const subcategoryRowKey = (category: string, subcategory: string) => `${category} ${subcategory}`;

const ROW_HEIGHT = 30;

const AncillariesBrowser = memo(
  ({ catalog, selectedKey, onSelect, onContextMenu, mods, isLoading, error }: AncillariesBrowserProps) => {
    const [filter, setFilter] = useState("");
    const [modFilter, setModFilter] = useState(ALL_ANCILLARY_MODS);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const localized = useLocalizations();
    /** Ancillaries whose `subcategory` cell is empty still need a bucket to sit in. */
    const noSubcategoryLabel = localized.ancillariesNoSubcategory || "(no subcategory)";

    // Categories start collapsed, and a category the catalog no longer has must not keep its entry.
    useEffect(() => {
      if (!catalog) return;
      setCollapsed((current) =>
        Object.fromEntries(catalog.categories.map((category) => [category.key, current[category.key] ?? true])),
      );
    }, [catalog]);

    const modOptions = useMemo(
      () => mods.filter((mod) => catalog?.ancillaries.some((ancillary) => ancillary.originPackPath === mod.path)),
      [catalog, mods],
    );

    // A mod that gets disabled leaves the dropdown pointed at something that no longer exists.
    useEffect(() => {
      if (
        modFilter === ALL_ANCILLARY_MODS ||
        modFilter === VANILLA_ANCILLARY_MODS ||
        modOptions.some((mod) => mod.path === modFilter)
      )
        return;
      setModFilter(ALL_ANCILLARY_MODS);
    }, [modFilter, modOptions]);

    const ancillaryFilter = useMemo(() => createAncillaryFilter(filter), [filter]);

    const rows = useMemo<BrowserRow[]>(() => {
      if (!catalog) return [];
      const matching = catalog.ancillaries.filter(
        (ancillary) => matchesModFilter(ancillary, modFilter) && ancillaryFilter.matches(ancillary),
      );

      const subcategoryNames = new Map(catalog.subcategories.map((row) => [row.key, row.localizedName]));
      const byCategory = new Map<string, AncillarySummary[]>();
      for (const ancillary of matching) {
        const bucket = byCategory.get(ancillary.category) ?? [];
        bucket.push(ancillary);
        byCategory.set(ancillary.category, bucket);
      }

      // Categories the catalog knows first, in sort order; then any category only the rows mention,
      // so a mod's new category is still reachable rather than silently dropped.
      const knownKeys = new Set(catalog.categories.map((category) => category.key));
      const orderedCategories = [
        ...catalog.categories,
        ...[...byCategory.keys()]
          .filter((key) => !knownKeys.has(key))
          .sort()
          .map((key) => ({ key, localizedName: key, sortOrder: Number.MAX_SAFE_INTEGER, iconUrl: undefined })),
      ];

      const result: BrowserRow[] = [];
      for (const category of orderedCategories) {
        const inCategory = byCategory.get(category.key);
        if (!inCategory?.length) continue;
        result.push({
          kind: "category",
          key: category.key,
          name: category.localizedName,
          iconUrl: category.iconUrl,
          count: inCategory.length,
        });
        // A filter that narrowed the list expands everything: hiding the matches behind a collapsed
        // category would make the box look broken.
        if (collapsed[category.key] !== false && ancillaryFilter.isEmpty) continue;

        const bySubcategory = new Map<string, AncillarySummary[]>();
        for (const ancillary of inCategory) {
          const bucket = bySubcategory.get(ancillary.subcategory) ?? [];
          bucket.push(ancillary);
          bySubcategory.set(ancillary.subcategory, bucket);
        }
        const orderedSubcategories = [...bySubcategory.keys()].sort((a, b) => {
          if (a === b) return 0;
          // The empty bucket sorts first; it is the common case for most categories.
          if (a === "") return -1;
          if (b === "") return 1;
          return (subcategoryNames.get(a) ?? a).localeCompare(subcategoryNames.get(b) ?? b);
        });

        // A lone subcategory says nothing the category header does not: list its ancillaries directly.
        if (orderedSubcategories.length === 1) {
          for (const ancillary of bySubcategory.get(orderedSubcategories[0])!) {
            result.push({ kind: "ancillary", key: ancillary.key, ancillary, nested: false });
          }
          continue;
        }

        for (const subcategory of orderedSubcategories) {
          const inSubcategory = bySubcategory.get(subcategory)!;
          const rowKey = subcategoryRowKey(category.key, subcategory);
          result.push({
            kind: "subcategory",
            key: rowKey,
            name: subcategory === "" ? noSubcategoryLabel : (subcategoryNames.get(subcategory) ?? subcategory),
            count: inSubcategory.length,
          });
          if (collapsed[rowKey] === true && ancillaryFilter.isEmpty) continue;
          for (const ancillary of inSubcategory) {
            result.push({ kind: "ancillary", key: ancillary.key, ancillary, nested: true });
          }
        }
      }
      return result;
    }, [ancillaryFilter, catalog, collapsed, modFilter, noSubcategoryLabel]);

    const toggleCollapsed = useCallback((key: string, defaultCollapsed: boolean) => {
      setCollapsed((current) => ({ ...current, [key]: !(current[key] ?? defaultCollapsed) }));
    }, []);

    const renderRow = useCallback(
      ({ index, key, style }: ListRowProps) => {
        const row = rows[index];
        if (!row) return null;

        if (row.kind === "category") {
          const isCollapsed = collapsed[row.key] !== false;
          return (
            <div key={key} style={style}>
              <button
                type="button"
                onClick={() => toggleCollapsed(row.key, true)}
                className="flex h-full w-full items-center gap-2 border-b border-gray-800 bg-gray-800/70 px-2 text-left text-sm font-semibold text-amber-100 hover:bg-gray-700/70"
              >
                {isCollapsed ? <IoChevronForward size={13} /> : <IoChevronDown size={13} />}
                {row.iconUrl && <img src={row.iconUrl} alt="" className="h-4 w-4 shrink-0 object-contain" />}
                <span className="truncate">{row.name}</span>
                <span className="ml-auto shrink-0 text-xs font-normal text-gray-400">{row.count}</span>
              </button>
            </div>
          );
        }

        if (row.kind === "subcategory") {
          const isCollapsed = collapsed[row.key] === true;
          return (
            <div key={key} style={style}>
              <button
                type="button"
                onClick={() => toggleCollapsed(row.key, false)}
                className="flex h-full w-full items-center gap-2 px-2 pl-5 text-left text-xs uppercase tracking-wide text-gray-400 hover:text-gray-200"
              >
                {isCollapsed ? <IoChevronForward size={11} /> : <IoChevronDown size={11} />}
                <span className="truncate">{row.name}</span>
                <span className="ml-auto shrink-0 normal-case tracking-normal">{row.count}</span>
              </button>
            </div>
          );
        }

        const { ancillary } = row;
        const isSelected = ancillary.key === selectedKey;
        return (
          <div key={key} style={style}>
            <button
              type="button"
              title={ancillary.key}
              onClick={() => onSelect(ancillary.key)}
              onContextMenu={(event) => onContextMenu?.(ancillary, event)}
              className={`flex h-full w-full items-center gap-2 px-2 ${row.nested ? "pl-9" : "pl-5"} text-left text-sm ${
                isSelected ? "bg-amber-800/70 text-white" : "text-gray-200 hover:bg-gray-700/60"
              }`}
            >
              {ancillary.iconUrl ? (
                <img src={ancillary.iconUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-sm border border-gray-600/70" />
              )}
              <span className="truncate">{ancillary.localizedName}</span>
              {ancillary.originPackPath && (
                <span className="ml-auto shrink-0 rounded bg-cyan-900/70 px-1 text-[10px] text-cyan-200">
                  {localized.ancillariesModBadge || "mod"}
                </span>
              )}
            </button>
          </div>
        );
      },
      [collapsed, localized, onContextMenu, onSelect, rows, selectedKey, toggleCollapsed],
    );

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-gray-700 p-2">
          <label className="mb-2 flex items-center gap-2 text-xs text-gray-400">
            <span className="shrink-0">{localized.ancillariesFilterByMod || "Filter by mod"}</span>
            <select
              aria-label={localized.ancillariesFilterByMod || "Filter by mod"}
              value={modFilter}
              onChange={(event) => setModFilter(event.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-white"
            >
              <option value={ALL_ANCILLARY_MODS}>{localized.ancillariesModFilterAll || "All"}</option>
              <option value={VANILLA_ANCILLARY_MODS}>{localized.ancillariesModFilterVanilla || "Vanilla"}</option>
              {modOptions.map((mod) => (
                <option key={mod.path} value={mod.path}>
                  {mod.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`flex items-center gap-2 rounded border bg-gray-900 px-2 ${
              ancillaryFilter.isValidRegex ? "border-gray-700" : "border-amber-600"
            }`}
          >
            <IoSearch className="text-gray-500" />
            <input
              aria-label={localized.ancillariesFilterLabel || "Filter ancillaries"}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={localized.ancillariesFilterPlaceholder || "Filter (regex)"}
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </label>
          {!ancillaryFilter.isValidRegex && (
            <div className="pt-1 text-[11px] text-amber-500">
              {localized.ancillariesIncompleteRegex || "Incomplete regex - matching as plain text."}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="p-4 text-sm text-gray-400">
              {localized.ancillariesLoading || "Loading ancillaries and enabled mods…"}
            </div>
          ) : error && !catalog ? (
            <div className="p-4 text-sm text-red-300">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">
              {localized.ancillariesNoMatches || "No ancillaries match this filter."}
            </div>
          ) : (
            <AutoSizer>
              {({ height, width }) => (
                <List
                  width={width}
                  height={height}
                  rowCount={rows.length}
                  rowHeight={ROW_HEIGHT}
                  rowRenderer={renderRow}
                  overscanRowCount={12}
                />
              )}
            </AutoSizer>
          )}
        </div>
      </div>
    );
  },
);

export default AncillariesBrowser;
