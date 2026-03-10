import Creatable from "react-select/creatable";
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgGridReact, type CustomCellRendererProps, type CustomHeaderProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellClickedEvent,
  type CellContextMenuEvent,
  type ColDef,
  type ColumnResizedEvent,
  type RowSelectionOptions,
} from "ag-grid-community";
import { FloatingOverlay } from "@floating-ui/react";
import debounce from "just-debounce-it";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tooltip } from "flowbite-react";
import { ActionMeta, SingleValue } from "react-select";

import { useAppDispatch, useAppSelector } from "../hooks";
import { addCategory, removeCategory, selectCategory, setAreModsEnabled, toggleMod } from "../appSlice";
import { useLocalizations } from "../localizationContext";
import { getModsSortedByHumanNameAndName } from "../modSortingHelpers";
import selectStyle from "../styles/selectStyle";
import EditCategoriesModal from "./EditCategoriesModal";
import ModDropdownOptions from "./ModDropdownOptions";

type CategorySelectType = {
  value: string;
  label: string;
};

type ContextMenuSelection = { kind: "none" } | { kind: "many" } | { kind: "one"; mod: Mod };

type CategoryGroup = {
  category: string;
  isEnabled: boolean;
  mods: Mod[];
  filteredMods: Mod[];
  isSynthetic?: boolean;
};

type CategoryGridRow = {
  id: string;
  kind: "category";
  category: string;
  isEnabled: boolean;
  allModPaths: string[];
  visibleChildRowIds: string[];
  isSynthetic?: boolean;
};

type ModGridRow = {
  id: string;
  kind: "mod";
  category: string;
  isEnabled: boolean;
  path: string;
  humanName: string;
  name: string;
  categories: string[];
};

type CategoriesGridRow = CategoryGridRow | ModGridRow;
type EnabledSortMode = "none" | "enabledFirst" | "enabledLast";

const COLOR_CLASS_MAP: Record<string, { bg: string; text: string; hover: string; button: string }> = {
  blue: {
    bg: "bg-blue-100 dark:bg-blue-900",
    text: "text-blue-800 dark:text-blue-300",
    hover: "hover:bg-blue-200 dark:hover:bg-blue-800",
    button: "text-blue-400 hover:text-blue-900 dark:hover:text-blue-300",
  },
  emerald: {
    bg: "bg-emerald-100 dark:bg-emerald-900",
    text: "text-emerald-800 dark:text-emerald-300",
    hover: "hover:bg-emerald-200 dark:hover:bg-emerald-800",
    button: "text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300",
  },
  red: {
    bg: "bg-red-100 dark:bg-red-900",
    text: "text-red-800 dark:text-red-300",
    hover: "hover:bg-red-200 dark:hover:bg-red-800",
    button: "text-red-400 hover:text-red-900 dark:hover:text-red-300",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-900",
    text: "text-amber-800 dark:text-amber-300",
    hover: "hover:bg-amber-200 dark:hover:bg-amber-800",
    button: "text-amber-400 hover:text-amber-900 dark:hover:text-amber-300",
  },
  purple: {
    bg: "bg-purple-100 dark:bg-purple-900",
    text: "text-purple-800 dark:text-purple-300",
    hover: "hover:bg-purple-200 dark:hover:bg-purple-800",
    button: "text-purple-400 hover:text-purple-900 dark:hover:text-purple-300",
  },
  rose: {
    bg: "bg-rose-100 dark:bg-rose-900",
    text: "text-rose-800 dark:text-rose-300",
    hover: "hover:bg-rose-200 dark:hover:bg-rose-800",
    button: "text-rose-400 hover:text-rose-900 dark:hover:text-rose-300",
  },
  teal: {
    bg: "bg-teal-100 dark:bg-teal-900",
    text: "text-teal-800 dark:text-teal-300",
    hover: "hover:bg-teal-200 dark:hover:bg-teal-800",
    button: "text-teal-400 hover:text-teal-900 dark:hover:text-teal-300",
  },
  orange: {
    bg: "bg-orange-100 dark:bg-orange-900",
    text: "text-orange-800 dark:text-orange-300",
    hover: "hover:bg-orange-200 dark:hover:bg-orange-800",
    button: "text-orange-400 hover:text-orange-900 dark:hover:text-orange-300",
  },
  slate: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-800 dark:text-slate-300",
    hover: "hover:bg-slate-200 dark:hover:bg-slate-700",
    button: "text-slate-400 hover:text-slate-900 dark:hover:text-slate-300",
  },
  white: {
    bg: "bg-white dark:bg-white",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-gray-50 dark:hover:bg-gray-100",
    button: "text-gray-500 hover:text-gray-900 dark:hover:text-gray-900",
  },
  black: {
    bg: "bg-gray-900 dark:bg-gray-900",
    text: "text-white dark:text-white",
    hover: "hover:bg-gray-800 dark:hover:bg-gray-800",
    button: "text-gray-300 hover:text-white dark:hover:text-white",
  },
  lime: {
    bg: "bg-lime-200 dark:bg-lime-200",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-lime-300 dark:hover:bg-lime-300",
    button: "text-gray-600 hover:text-gray-900 dark:hover:text-gray-900",
  },
  sky: {
    bg: "bg-sky-200 dark:bg-sky-200",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-sky-300 dark:hover:bg-sky-300",
    button: "text-gray-600 hover:text-gray-900 dark:hover:text-gray-900",
  },
  fuchsia: {
    bg: "bg-fuchsia-200 dark:bg-fuchsia-200",
    text: "text-gray-900 dark:text-gray-900",
    hover: "hover:bg-fuchsia-300 dark:hover:bg-fuchsia-300",
    button: "text-gray-600 hover:text-gray-900 dark:hover:text-gray-900",
  },
};

const AG_GRID_MODULES_KEY = "__whmmAgGridModulesRegistered";
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny[AG_GRID_MODULES_KEY]) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  globalAny[AG_GRID_MODULES_KEY] = true;
}

const isCategoryRow = (row: CategoriesGridRow | undefined | null): row is CategoryGridRow =>
  row?.kind === "category";

const normalizeModLabel = (mod: Mod) =>
  mod.humanName !== "" ? mod.humanName : mod.name.replace(".pack", "");

const buildCategoryRowId = (category: string) => `category:${category}`;
const buildModRowId = (category: string, path: string) => `mod:${category}:${path}`;
const getNextEnabledSortMode = (mode: EnabledSortMode): EnabledSortMode => {
  if (mode === "none") return "enabledFirst";
  if (mode === "enabledFirst") return "enabledLast";
  return "none";
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const computeContextMenuPosition = (params: {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}) => {
  const padding = params.padding ?? 8;

  let x = params.anchorX;
  if (x + params.menuWidth > params.viewportWidth - padding) x = params.anchorX - params.menuWidth;
  x = clamp(x, padding, params.viewportWidth - params.menuWidth - padding);

  let y = params.anchorY;
  if (y + params.menuHeight > params.viewportHeight - padding) y = params.anchorY - params.menuHeight;
  y = clamp(y, padding, params.viewportHeight - params.menuHeight - padding);

  return { x, y };
};

const Badge = memo(
  ({
    text,
    color,
    onRemove,
    removeLabel,
  }: {
    text: string;
    color?: string;
    onRemove: () => void;
    removeLabel: string;
  }) => {
    const colorClasses = COLOR_CLASS_MAP[color || "blue"] || COLOR_CLASS_MAP.blue;

    return (
      <span
        className={`inline-flex items-center px-2 py-1 mr-2 text-sm font-medium rounded ${colorClasses.bg} ${colorClasses.text}`}
      >
        {text}
        <button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          type="button"
          className={`inline-flex items-center p-0.5 ml-2 text-sm bg-transparent rounded-sm ${colorClasses.button} ${colorClasses.hover}`}
          data-dismiss-target="#badge-dismiss-default"
          aria-label={`${removeLabel} ${text}`}
        >
          <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            ></path>
          </svg>
        </button>
      </span>
    );
  },
);

const EnabledHeader = memo(
  ({
    displayName,
    sortMode,
    onCycleSort,
  }: CustomHeaderProps<CategoriesGridRow> & {
    sortMode: EnabledSortMode;
    onCycleSort: () => void;
  }) => {
    const sortHint =
      sortMode === "enabledFirst"
        ? "Enabled mods are shown first in each category. Click to switch to enabled-last sorting."
        : sortMode === "enabledLast"
          ? "Enabled mods are shown last in each category. Click to clear enabled sorting."
          : "No enabled sorting. Click to show enabled mods first in each category.";
    const suffix = sortMode === "enabledFirst" ? " ↓" : sortMode === "enabledLast" ? " ↑" : "";

    return (
      <button
        type="button"
        title={sortHint}
        aria-label={`${displayName}${suffix}`}
        className="flex h-full w-full items-center justify-center font-semibold text-gray-100 px-1"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCycleSort();
        }}
      >
        <span aria-hidden="true" className="whitespace-nowrap">
          {displayName}
          {suffix}
        </span>
      </button>
    );
  },
);

const Categories = memo(() => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const gridRef = useRef<AgGridReact<CategoriesGridRow>>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const modifierStateRef = useRef({ isShiftDown: false, isControlDown: false });

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [contextMenuSelection, setContextMenuSelection] = useState<ContextMenuSelection>({ kind: "none" });
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
  const [isEditCategoriesModalOpen, setIsEditCategoriesModalOpen] = useState(false);
  const [enabledSortMode, setEnabledSortMode] = useState<EnabledSortMode>("none");
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const [categoryFilterInput, setCategoryFilterInput] = useState("");
  const [nameFilterInput, setNameFilterInput] = useState("");
  const [categoriesFilterInput, setCategoriesFilterInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [categoriesFilter, setCategoriesFilter] = useState("");

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const categories = useAppSelector((state) => state.app.categories);
  const categoryColors = useAppSelector((state) => state.app.categoryColors || {});
  const categoriesWithUncategorized = useMemo(
    () => (categories.includes("Uncategorized") ? categories : categories.concat(["Uncategorized"])),
    [categories],
  );

  const setNewCategoryFilter = useMemo(
    () =>
      debounce((value: string) => {
        setCategoryFilter(value);
      }, 200),
    [],
  );
  const setNewNameFilter = useMemo(
    () =>
      debounce((value: string) => {
        setNameFilter(value);
      }, 200),
    [],
  );
  const setNewCategoriesFilter = useMemo(
    () =>
      debounce((value: string) => {
        setCategoriesFilter(value);
      }, 200),
    [],
  );

  useEffect(() => {
    return () => {
      (setNewCategoryFilter as unknown as { cancel?: () => void }).cancel?.();
      (setNewNameFilter as unknown as { cancel?: () => void }).cancel?.();
      (setNewCategoriesFilter as unknown as { cancel?: () => void }).cancel?.();
    };
  }, [setNewCategoriesFilter, setNewCategoryFilter, setNewNameFilter]);

  const modByPath = useMemo(
    () => new Map<string, Mod>((mods as Mod[]).map((mod) => [mod.path, mod])),
    [mods],
  );

  const getSelectedMods = useCallback((): Mod[] => {
    const api = gridRef.current?.api;
    if (!api) return [];

    const selectedMods: Mod[] = [];
    const seenPaths = new Set<string>();

    api.getSelectedNodes().forEach((node) => {
      const row = node.data;
      if (!row || isCategoryRow(row)) return;
      if (seenPaths.has(row.path)) return;

      const mod = modByPath.get(row.path);
      if (!mod) return;

      seenPaths.add(row.path);
      selectedMods.push(mod);
    });

    return selectedMods;
  }, [modByPath]);

  const getSelectedModsPreview = useCallback(
    (maxMods: number): { mods: Mod[]; isTruncated: boolean } => {
      const api = gridRef.current?.api;
      if (!api) return { mods: [], isTruncated: false };

      const selectedMods: Mod[] = [];
      const seenPaths = new Set<string>();

      for (const node of api.getSelectedNodes()) {
        const row = node.data;
        if (!row || isCategoryRow(row)) continue;
        if (seenPaths.has(row.path)) continue;

        const mod = modByPath.get(row.path);
        if (!mod) continue;

        seenPaths.add(row.path);
        selectedMods.push(mod);
        if (selectedMods.length >= maxMods) {
          const totalSelectedModCount = api
            .getSelectedNodes()
            .filter((selectedNode) => selectedNode.data && !isCategoryRow(selectedNode.data)).length;
          return { mods: selectedMods, isTruncated: totalSelectedModCount > maxMods };
        }
      }

      return { mods: selectedMods, isTruncated: false };
    },
    [modByPath],
  );

  const clearSelection = useCallback(() => {
    gridRef.current?.api?.deselectAll();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") modifierStateRef.current.isShiftDown = true;
      if (event.key === "Control" || event.key === "Meta") modifierStateRef.current.isControlDown = true;

      const activeElement = document.activeElement as HTMLElement | null;
      const isTypingInInput =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.isContentEditable;

      if (event.key === " " && !isContextMenuOpen && !isTypingInInput) {
        const selectedMods = getSelectedMods();
        if (selectedMods.length === 0) return;

        const toEnable = selectedMods.some((mod) => !mod.isEnabled);
        dispatch(setAreModsEnabled(selectedMods.map((mod) => ({ mod, isEnabled: toEnable }))));
        event.preventDefault();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") modifierStateRef.current.isShiftDown = false;
      if (event.key === "Control" || event.key === "Meta") modifierStateRef.current.isControlDown = false;
    };

    const onWindowBlur = () => {
      modifierStateRef.current.isShiftDown = false;
      modifierStateRef.current.isControlDown = false;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [dispatch, getSelectedMods, isContextMenuOpen]);

  const groupedCategories = useMemo<CategoryGroup[]>(() => {
    const rowsByCategory = new Map<
      string,
      { category: string; mods: Mod[]; total: number; enabled: number }
    >();

    for (const mod of getModsSortedByHumanNameAndName(mods) as Mod[]) {
      let modCategories = mod.categories ?? ["Uncategorized"];
      if (modCategories.length === 0) modCategories = ["Uncategorized"];

      for (const category of modCategories) {
        let categoryInfo = rowsByCategory.get(category);
        if (!categoryInfo) {
          categoryInfo = { category, mods: [], total: 0, enabled: 0 };
          rowsByCategory.set(category, categoryInfo);
        }

        categoryInfo.mods.push(mod);
        categoryInfo.total += 1;
        if (mod.isEnabled) categoryInfo.enabled += 1;
      }
    }

    return Array.from(rowsByCategory.values())
      .map((categoryInfo) => ({
        category: categoryInfo.category,
        isEnabled: categoryInfo.total > 0 && categoryInfo.enabled === categoryInfo.total,
        mods: categoryInfo.mods,
        filteredMods: categoryInfo.mods,
      }))
      .sort((firstCategory, secondCategory) => {
        if (firstCategory.category === "Uncategorized") return -1;
        if (secondCategory.category === "Uncategorized") return 1;
        return firstCategory.category.localeCompare(secondCategory.category);
      });
  }, [mods]);

  const filteredGroups = useMemo<CategoryGroup[]>(() => {
    let data = groupedCategories.map((group) => ({ ...group, filteredMods: [...group.mods] }));

    if (nameFilter.trim() !== "") {
      const filterNames = nameFilter
        .trim()
        .toLowerCase()
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");

      for (const categoryGroup of data) {
        categoryGroup.filteredMods = categoryGroup.filteredMods.filter((mod) =>
          filterNames.some((filterName) => normalizeModLabel(mod).toLowerCase().includes(filterName)),
        );
      }

      data = data.filter((categoryGroup) => categoryGroup.filteredMods.length > 0);
    }

    if (categoryFilter.trim() !== "") {
      const filterCategories = categoryFilter
        .trim()
        .toLowerCase()
        .split(",")
        .map((category) => category.trim())
        .filter((category) => category !== "");

      data = data.filter((categoryGroup) =>
        filterCategories.some((filterCategory) =>
          categoryGroup.category.toLowerCase().includes(filterCategory),
        ),
      );
    }

    if (categoriesFilter.trim() !== "") {
      const filterCategories = categoriesFilter
        .trim()
        .toLowerCase()
        .split(",")
        .map((category) => category.trim())
        .filter((category) => category !== "");

      for (const categoryGroup of data) {
        categoryGroup.filteredMods = categoryGroup.filteredMods.filter((mod) =>
          filterCategories.some((filterCategory) =>
            (mod.categories ?? []).some((category) => category.toLowerCase().includes(filterCategory)),
          ),
        );
      }

      data = data.filter((categoryGroup) => categoryGroup.filteredMods.length > 0);
    }

    if (data.length === 0) {
      return [
        {
          category: localized.noMatches,
          isEnabled: false,
          mods: [],
          filteredMods: [],
          isSynthetic: true,
        } as CategoryGroup,
      ];
    }

    if (enabledSortMode !== "none") {
      for (const categoryGroup of data) {
        categoryGroup.filteredMods = [...categoryGroup.filteredMods].sort((firstMod, secondMod) => {
          if (firstMod.isEnabled === secondMod.isEnabled) return 0;
          if (enabledSortMode === "enabledFirst") return firstMod.isEnabled ? -1 : 1;
          return firstMod.isEnabled ? 1 : -1;
        });
      }
    }

    return data;
  }, [categoriesFilter, categoryFilter, enabledSortMode, groupedCategories, localized.noMatches, nameFilter]);

  const displayedRows = useMemo(() => {
    const rows: CategoriesGridRow[] = [];

    for (const group of filteredGroups) {
      const isCollapsed = hiddenCategories.includes(group.category);
      const visibleChildRowIds = isCollapsed
        ? []
        : group.filteredMods.map((mod) => buildModRowId(group.category, mod.path));

      rows.push({
        id: buildCategoryRowId(group.category),
        kind: "category",
        category: group.category,
        isEnabled: group.isEnabled,
        allModPaths: group.mods.map((mod) => mod.path),
        visibleChildRowIds,
        isSynthetic: group.isSynthetic,
      });

      if (isCollapsed || group.isSynthetic) continue;

      for (const mod of group.filteredMods) {
        rows.push({
          id: buildModRowId(group.category, mod.path),
          kind: "mod",
          category: group.category,
          isEnabled: mod.isEnabled,
          path: mod.path,
          humanName: normalizeModLabel(mod),
          name: mod.name,
          categories: mod.categories ?? [],
        });
      }
    }

    return rows;
  }, [filteredGroups, hiddenCategories]);

  const onOverlayClick = useCallback(() => {
    clearSelection();
    setIsContextMenuOpen(false);
    setContextMenuSelection({ kind: "none" });
    contextMenuAnchorRef.current = null;
  }, [clearSelection]);

  useLayoutEffect(() => {
    if (!isContextMenuOpen) return;
    const menuEl = contextMenuRef.current;
    const anchor = contextMenuAnchorRef.current;
    if (!menuEl || !anchor) return;

    const rect = menuEl.getBoundingClientRect();
    const nextPos = computeContextMenuPosition({
      anchorX: anchor.x,
      anchorY: anchor.y,
      menuWidth: rect.width,
      menuHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      padding: 8,
    });

    menuEl.style.left = `${nextPos.x}px`;
    menuEl.style.top = `${nextPos.y}px`;
    menuEl.style.visibility = "visible";
  }, [contextMenuSelection, isContextMenuOpen]);

  useEffect(() => {
    if (!isContextMenuOpen) return;

    const onResize = () => {
      const menuEl = contextMenuRef.current;
      const anchor = contextMenuAnchorRef.current;
      if (!menuEl || !anchor) return;

      const rect = menuEl.getBoundingClientRect();
      const nextPos = computeContextMenuPosition({
        anchorX: anchor.x,
        anchorY: anchor.y,
        menuWidth: rect.width,
        menuHeight: rect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        padding: 8,
      });

      menuEl.style.left = `${nextPos.x}px`;
      menuEl.style.top = `${nextPos.y}px`;
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isContextMenuOpen]);

  const toggleCategoryVisibility = useCallback((category: string) => {
    setHiddenCategories((currentHiddenCategories) =>
      currentHiddenCategories.includes(category)
        ? currentHiddenCategories.filter((iterCategory) => iterCategory !== category)
        : [...currentHiddenCategories, category],
    );
  }, []);

  const selectRowsById = useCallback((rowIds: string[], keepExistingSelection: boolean) => {
    const api = gridRef.current?.api;
    if (!api) return;

    if (!keepExistingSelection) api.deselectAll();

    for (const rowId of rowIds) {
      api.getRowNode(rowId)?.setSelected(true);
    }
  }, []);

  const selectCategoryGroup = useCallback(
    (row: CategoryGridRow, keepExistingSelection: boolean) => {
      selectRowsById([row.id, ...row.visibleChildRowIds], keepExistingSelection);
    },
    [selectRowsById],
  );

  const openContextMenu = useCallback(
    (event: MouseEvent) => {
      const menuEl = contextMenuRef.current;
      if (menuEl) {
        menuEl.style.visibility = "hidden";
        menuEl.style.left = `${event.clientX}px`;
        menuEl.style.top = `${event.clientY}px`;
      }

      contextMenuAnchorRef.current = { x: event.clientX, y: event.clientY };

      const preview = getSelectedModsPreview(2);
      const selection =
        preview.mods.length === 0
          ? ({ kind: "none" } as const)
          : preview.mods.length === 1 && !preview.isTruncated
            ? ({ kind: "one", mod: preview.mods[0] } as const)
            : ({ kind: "many" } as const);

      setContextMenuSelection(selection);
      setIsContextMenuOpen(true);
    },
    [getSelectedModsPreview],
  );

  const handleToggleEnabled = useCallback(
    (row: CategoriesGridRow) => {
      if (isCategoryRow(row)) {
        const modsForEnable = row.allModPaths
          .map((path) => modByPath.get(path))
          .filter((mod): mod is Mod => !!mod);
        if (modsForEnable.length === 0) return;

        const isEnabled = !row.isEnabled;
        dispatch(setAreModsEnabled(modsForEnable.map((mod) => ({ mod, isEnabled }))));
        return;
      }

      const selectedMod = modByPath.get(row.path);
      if (!selectedMod) return;
      dispatch(toggleMod(selectedMod));
    },
    [dispatch, modByPath],
  );

  const onSelectCategoryChange = useCallback(
    (newValue: SingleValue<CategorySelectType>, actionMeta: ActionMeta<CategorySelectType>) => {
      if (!newValue || actionMeta.action !== "select-option") return;

      let selectOperation = "addition" as SelectOperation;
      if (modifierStateRef.current.isControlDown && modifierStateRef.current.isShiftDown) {
        selectOperation = "unary";
      } else if (modifierStateRef.current.isControlDown) {
        selectOperation = "subtraction";
      }

      dispatch(selectCategory({ mods: getSelectedMods(), category: newValue.value, selectOperation }));
      setIsContextMenuOpen(false);
    },
    [dispatch, getSelectedMods],
  );

  const onCreateNewCategory = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      if (trimmedName === "") return;

      dispatch(addCategory({ category: trimmedName, mods: getSelectedMods() }));
      clearSelection();
      setIsContextMenuOpen(false);
    },
    [clearSelection, dispatch, getSelectedMods],
  );

  const options = useMemo(
    () =>
      categories.map((category) => ({
        value: category,
        label: category,
      })),
    [categories],
  );

  const defaultColDef = useMemo<ColDef<CategoriesGridRow>>(
    () => ({
      editable: false,
      sortable: false,
      resizable: true,
      suppressHeaderMenuButton: true,
      suppressMovable: true,
    }),
    [],
  );

  const rowSelection = useMemo<RowSelectionOptions<CategoriesGridRow>>(
    () => ({
      mode: "multiRow",
      enableClickSelection: true,
      checkboxes: false,
      headerCheckbox: false,
    }),
    [],
  );

  const resolveColumnSizing = useCallback(
    (
      colId: string,
      defaults: Pick<ColDef<CategoriesGridRow>, "width" | "minWidth" | "maxWidth" | "flex">,
    ) => {
      const resizedWidth = columnWidths[colId];
      if (resizedWidth == null) return defaults;

      return {
        width: resizedWidth,
        minWidth: defaults.minWidth,
        maxWidth: defaults.maxWidth,
        flex: undefined,
      } as const;
    },
    [columnWidths],
  );

  const columnDefs = useMemo<Array<ColDef<CategoriesGridRow>>>(() => {
    const categorySizing = resolveColumnSizing("category", {
      width: undefined,
      minWidth: 180,
      maxWidth: undefined,
      flex: 1,
    });
    const enabledSizing = resolveColumnSizing("isEnabled", {
      width: 90,
      minWidth: 90,
      maxWidth: undefined,
      flex: undefined,
    });
    const nameSizing = resolveColumnSizing("humanName", {
      width: undefined,
      minWidth: 260,
      maxWidth: undefined,
      flex: 1.8,
    });
    const categoriesSizing = resolveColumnSizing("categories", {
      width: undefined,
      minWidth: 320,
      maxWidth: undefined,
      flex: 2.2,
    });

    return [
      {
        headerName: localized.category,
        colId: "category",
        ...categorySizing,
        cellRenderer: (params: CustomCellRendererProps<CategoriesGridRow>) => {
          const row = params.data;
          if (!row) return null;

          if (isCategoryRow(row)) {
            const isCollapsed = hiddenCategories.includes(row.category);
            return (
              <div className="flex h-full items-center gap-2">
                {!row.isSynthetic ? (
                  <button
                    type="button"
                    aria-label={`${isCollapsed ? localized.expandAll : localized.collapseAll} ${row.category}`}
                    className="w-5 text-left text-gray-200"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleCategoryVisibility(row.category);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    {isCollapsed ? ">" : "v"}
                  </button>
                ) : (
                  <span className="w-5" />
                )}
                <span className="font-semibold">{row.category}</span>
              </div>
            );
          }

          return <div className="pl-7 text-gray-500">&nbsp;</div>;
        },
      },
      {
        headerName: localized.enabled,
        colId: "isEnabled",
        ...enabledSizing,
        headerComponent: EnabledHeader,
        headerComponentParams: {
          sortMode: enabledSortMode,
          onCycleSort: () => setEnabledSortMode((currentMode) => getNextEnabledSortMode(currentMode)),
        },
        cellRenderer: (params: CustomCellRendererProps<CategoriesGridRow>) => {
          const row = params.data;
          if (!row) return null;

          const ariaLabel = isCategoryRow(row)
            ? `Toggle category ${row.category}`
            : `Toggle mod ${row.humanName}`;
          const isDisabled = isCategoryRow(row) && row.allModPaths.length === 0;

          return (
            <div className="flex h-full items-center justify-center">
              <input
                type="checkbox"
                checked={row.isEnabled}
                disabled={isDisabled}
                aria-label={ariaLabel}
                onChange={() => handleToggleEnabled(row)}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </div>
          );
        },
      },
      {
        headerName: localized.name,
        colId: "humanName",
        ...nameSizing,
        valueGetter: (params) => (params.data && !isCategoryRow(params.data) ? params.data.humanName : ""),
        cellClass: (params) => (params.data && isCategoryRow(params.data) ? "font-semibold" : undefined),
      },
      {
        headerName: localized.categories,
        colId: "categories",
        ...categoriesSizing,
        cellRenderer: (params: CustomCellRendererProps<CategoriesGridRow>) => {
          const row = params.data;
          if (!row || isCategoryRow(row) || row.categories.length === 0) return null;

          const mod = modByPath.get(row.path);
          if (!mod) return null;

          return (
            <div className="flex h-full items-center flex-wrap py-1">
              {row.categories.map((category) => (
                <Badge
                  key={`${row.id}:${category}`}
                  text={category}
                  color={categoryColors[category]}
                  removeLabel={localized.removeBadge}
                  onRemove={() => dispatch(removeCategory({ mods: [mod], category }))}
                />
              ))}
            </div>
          );
        },
      },
    ];
  }, [
    categoryColors,
    dispatch,
    enabledSortMode,
    handleToggleEnabled,
    hiddenCategories,
    localized.categories,
    localized.category,
    localized.collapseAll,
    localized.enabled,
    localized.expandAll,
    localized.name,
    localized.removeBadge,
    modByPath,
    resolveColumnSizing,
    toggleCategoryVisibility,
  ]);

  const onColumnResized = useCallback((event: ColumnResizedEvent<CategoriesGridRow>) => {
    if (!event.finished) return;
    if (event.source !== "uiColumnResized") return;

    const resizedColumns = (event.columns ?? (event.column ? [event.column] : [])).filter(Boolean);
    if (resizedColumns.length === 0) return;

    setColumnWidths((currentWidths) => {
      let hasChanges = false;
      const nextWidths = { ...currentWidths };

      for (const column of resizedColumns) {
        const colId = column.getColId();
        const actualWidth = column.getActualWidth();
        if (nextWidths[colId] === actualWidth) continue;
        nextWidths[colId] = actualWidth;
        hasChanges = true;
      }

      return hasChanges ? nextWidths : currentWidths;
    });
  }, []);

  const collapseOrExpandAllCategories = useCallback(() => {
    setHiddenCategories((currentHiddenCategories) =>
      currentHiddenCategories.length === 0 ? [...categoriesWithUncategorized] : [],
    );
  }, [categoriesWithUncategorized]);

  const onCellClicked = useCallback(
    (event: CellClickedEvent<CategoriesGridRow>) => {
      const row = event.data;
      if (!row || !isCategoryRow(row)) return;
      if (event.column.getColId() === "isEnabled") return;

      const mouseEvent = event.event as MouseEvent | undefined;
      const keepExistingSelection = !!(mouseEvent?.ctrlKey || mouseEvent?.metaKey);
      selectCategoryGroup(row, keepExistingSelection);
    },
    [selectCategoryGroup],
  );

  const onCellContextMenu = useCallback(
    (event: CellContextMenuEvent<CategoriesGridRow>) => {
      event.event?.preventDefault();
      event.event?.stopPropagation();

      const mouseEvent = event.event as MouseEvent | undefined;
      const row = event.data;
      if (!mouseEvent || !row) return;

      if (isCategoryRow(row)) {
        const keepSelection = event.node?.isSelected() ?? false;
        selectCategoryGroup(row, keepSelection);
      } else if (event.node && !event.node.isSelected()) {
        gridRef.current?.api?.deselectAll();
        event.node.setSelected(true);
      }

      openContextMenu(mouseEvent);
    },
    [openContextMenu, selectCategoryGroup],
  );

  return (
    <>
      <FloatingOverlay
        onClick={onOverlayClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onOverlayClick();
        }}
        className={`${isContextMenuOpen ? "" : "hidden"} z-[250] dark`}
        id="modDropdownOverlay"
      >
        <div
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          id="categoriesContextMenu"
          className={
            `${isContextMenuOpen ? "" : "hidden"}` +
            " fixed w-52 bg-white rounded divide-y divide-gray-100 shadow dark:bg-gray-700 z-[300]"
          }
          ref={contextMenuRef}
        >
          <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
            <li className="pb-3 mb-1 flex justify-center flex-wrap">
              <Tooltip
                content={
                  <>
                    <p>{localized.addCategoryHelp1}</p>
                    <p>{localized.addCategoryHelp2}</p>
                  </>
                }
              >
                <div className="mt-1 mb-2">{localized.addCategory}</div>
              </Tooltip>
              <Creatable
                className="w-10/12"
                options={options}
                styles={selectStyle}
                onChange={onSelectCategoryChange}
                onCreateOption={onCreateNewCategory}
              />
            </li>
          </ul>
          {contextMenuSelection.kind === "many" && (
            <div>
              <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
                <li>
                  <a
                    onClick={() => {
                      const selectedMods = getSelectedMods();
                      dispatch(setAreModsEnabled(selectedMods.map((mod) => ({ mod, isEnabled: true }))));
                      setIsContextMenuOpen(false);
                    }}
                    href="#"
                    className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                  >
                    {localized.enableAll}
                  </a>
                </li>
                <li>
                  <a
                    onClick={() => {
                      const selectedMods = getSelectedMods();
                      dispatch(setAreModsEnabled(selectedMods.map((mod) => ({ mod, isEnabled: false }))));
                      setIsContextMenuOpen(false);
                    }}
                    href="#"
                    className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                  >
                    {localized.disableAll}
                  </a>
                </li>
              </ul>
            </div>
          )}
          {contextMenuSelection.kind === "one" && contextMenuSelection.mod && (
            <ModDropdownOptions mod={contextMenuSelection.mod} mods={mods} visibleMods={mods} />
          )}
        </div>
      </FloatingOverlay>

      <div className="-mt-6 mr-10">
        <div className="mt-5 flex">
          <span className="relative ml-4">
            <input
              id="categoryFilterInput"
              type="text"
              value={categoryFilterInput}
              placeholder={localized.categoryFilter}
              onChange={(event) => {
                setCategoryFilterInput(event.target.value);
                setNewCategoryFilter(event.target.value);
              }}
              className="bg-gray-50 w-48 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            />

            <span className="absolute right-2 top-2 text-gray-400">
              <button
                onClick={() => {
                  setCategoryFilterInput("");
                  setCategoryFilter("");
                }}
                type="button"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </span>
          </span>

          <span className="relative ml-8">
            <input
              id="nameFilterInput"
              type="text"
              value={nameFilterInput}
              placeholder={localized.nameFilter}
              onChange={(event) => {
                setNameFilterInput(event.target.value);
                setNewNameFilter(event.target.value);
              }}
              className="bg-gray-50 w-72 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            />

            <span className="absolute right-2 top-2 text-gray-400">
              <button
                onClick={() => {
                  setNameFilterInput("");
                  setNameFilter("");
                }}
                type="button"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </span>
          </span>

          <span className="relative ml-10">
            <input
              id="categoriesFilterInput"
              type="text"
              value={categoriesFilterInput}
              placeholder={localized.categoriesFilter}
              onChange={(event) => {
                setCategoriesFilterInput(event.target.value);
                setNewCategoriesFilter(event.target.value);
              }}
              className="bg-gray-50 w-80 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            />

            <span className="absolute right-2 top-2 text-gray-400">
              <button
                onClick={() => {
                  setCategoriesFilterInput("");
                  setCategoriesFilter("");
                }}
                type="button"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </span>
          </span>

          <div className="text-center ml-auto flex gap-2">
            <button
              onClick={() => setIsEditCategoriesModalOpen(true)}
              className="w-36 text-white bg-green-700 hover:bg-green-800 focus:ring-4 focus:ring-green-300 font-medium rounded-lg text-sm px-5 py-2.5 mb-2 dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
              type="button"
            >
              {localized.editCategories}
            </button>
            <button
              onClick={collapseOrExpandAllCategories}
              className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mb-2 dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
              type="button"
            >
              {hiddenCategories.length === 0 ? localized.collapseAll : localized.expandAll}
            </button>
          </div>
        </div>
      </div>

      <div
        id="categoriesTableContainer"
        className="overflow-hidden mr-10"
        onMouseDownCapture={(event) => {
          if (event.button === 1) event.stopPropagation();
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="ag-theme-material-dark" style={{ height: "87vh", width: "100%" }}>
          <AgGridReact<CategoriesGridRow>
            ref={gridRef}
            theme="legacy"
            rowData={displayedRows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            rowSelection={rowSelection}
            rowHeight={36}
            headerHeight={36}
            animateRows={false}
            suppressRowHoverHighlight={true}
            suppressContextMenu={true}
            preventDefaultOnContextMenu={true}
            getRowId={(params) => params.data.id}
            resetRowDataOnUpdate={true}
            onCellClicked={onCellClicked}
            onCellContextMenu={onCellContextMenu}
            onColumnResized={onColumnResized}
            getRowStyle={(params) =>
              params.data && isCategoryRow(params.data)
                ? { backgroundColor: "oklch(38.1% 0.176 304.987 / .5)" }
                : undefined
            }
          />
        </div>
      </div>

      <EditCategoriesModal
        isOpen={isEditCategoriesModalOpen}
        onClose={() => setIsEditCategoriesModalOpen(false)}
      />
    </>
  );
});

export default Categories;
