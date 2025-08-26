import Creatable from "react-select/creatable";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import "@silevis/reactgrid/styles.css";
import "handsontable/styles/handsontable.min.css";
import "handsontable/styles/ht-theme-main.min.css";
import { HotColumn, HotRendererProps, HotTable } from "@handsontable/react-wrapper";
import { textRenderer, checkboxRenderer } from "handsontable/renderers";
import { registerAllModules } from "handsontable/registry";
import { FloatingOverlay } from "@floating-ui/react";
import selectStyle from "../styles/selectStyle";
import { ActionMeta, SingleValue } from "react-select";
import { useLocalizations } from "../localizationContext";
import { addCategory, removeCategory, selectCategory, setAreModsEnabled, toggleMod } from "../appSlice";
import EditCategoriesModal from "./EditCategoriesModal";
import { CellProperties } from "handsontable/settings";
import Core from "handsontable/core";
import debounce from "just-debounce-it";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import ModDropdownOptions from "./ModDropdownOptions";
import { getModsSortedByHumanNameAndName } from "../modSortingHelpers";
import { Tooltip } from "flowbite-react";
import Handsontable from "handsontable";

type CategorySelectType = {
  value: string;
  label: string;
};

interface CategoryRow {
  category: string;
  isEnabled: boolean;
  path: null;
  humanName: null;
  name: null;
  categories: null;
  __children: ModRow[];
}

interface ModRow {
  isEnabled: boolean;
  path: string;
  humanName: string;
  name: string;
  categories: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isCategoryRow = (row: any): row is CategoryRow => !!row.category;

type CategoriesTable = CategoryRow[];

let selectedInTable = [{ row: -1, column: 0, row2: 0, column2: 0 }] as {
  row: number;
  column: number;
  row2: number;
  column2: number;
}[];

const Badge = memo(({ text, mod }: { text: string; mod: Mod }) => {
  const dispatch = useAppDispatch();
  const categoryColors = useAppSelector((state) => state.app.categoryColors || {});
  const localized = useLocalizations();

  const getColorClasses = (color: string) => {
    const colorMap: Record<string, { bg: string; text: string; hover: string; button: string }> = {
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
    return colorMap[color] || colorMap.blue;
  };

  const color = categoryColors[text] || "blue";
  const colorClasses = getColorClasses(color);

  return (
    <span
      className={`inline-flex items-center px-2 py-1 mr-2 text-sm font-medium rounded ${colorClasses.bg} ${colorClasses.text}`}
    >
      {text}
      <button
        onClick={() => {
          dispatch(removeCategory({ mods: [mod], category: text }));
        }}
        type="button"
        className={`inline-flex items-center p-0.5 ml-2 text-sm bg-transparent rounded-sm ${colorClasses.button} ${colorClasses.hover}`}
        data-dismiss-target="#badge-dismiss-default"
        aria-label="Remove"
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
        <span className="sr-only">{localized.removeBadge}</span>
      </button>
    </span>
  );
});

let isShiftDown = false;
let isControlDown = false;

const Categories = memo(() => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);

  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [categoriesFilter, setCategoriesFilter] = useState<string>("");
  const [isEditCategoriesModalOpen, setIsEditCategoriesModalOpen] = useState(false);

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const categories = useAppSelector((state) => state.app.categories);
  const categoriesWithUncategorized = categories.includes("Uncategorized")
    ? categories
    : categories.concat(["Uncategorized"]);

  const headerNames = useMemo(
    () => [localized.category, localized.enabled, localized.name, localized.categories],
    [localized]
  );

  const setNewCategoryFilter = useMemo(
    () =>
      debounce((value: string) => {
        setCategoryFilter(value);
      }, 200),
    [setCategoryFilter]
  );
  const setNewNameFilter = useMemo(
    () =>
      debounce((value: string) => {
        setNameFilter(value);
      }, 200),
    [setNameFilter]
  );
  const setNewCategoriesFilter = useMemo(
    () =>
      debounce((value: string) => {
        setCategoriesFilter(value);
      }, 200),
    [setCategoriesFilter]
  );

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<HotTable>(null);

  const getCurrentlySelectedMods = useCallback(() => {
    if (!hotRef || !hotRef.current) return [];
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const hot = hotRef.current.hotInstance as Handsontable;
    if (!hot) return [];

    const selectedRows: number[] = [];
    for (const selection of selectedInTable) {
      if (selection.row == -1) continue;
      const rowMin = Math.min(selection.row, selection.row2);
      const rowMax = Math.max(selection.row, selection.row2);

      for (let i = rowMin; i <= rowMax; i++) selectedRows.push(i);
    }

    const selectedMods: Mod[] = [];
    for (const i of selectedRows) {
      const rowData = hot.getSourceDataAtRow(i) as ModRow | CategoryRow;
      if (!rowData) continue;
      if (!isCategoryRow(rowData)) {
        const mod = mods.find((mod) => mod.path == rowData.path);
        if (mod) selectedMods.push(mod);
      }
    }

    return selectedMods;
  }, [hotRef]);

  console.log("currentlySelectedMods:", getCurrentlySelectedMods());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BadgesRowRenderer = (props: HotRendererProps) => {
    // the available renderer-related props are:
    // - `row` (row index)
    // - `col` (column index)
    // - `prop` (column property name)
    // - `TD` (the HTML cell element)

    const selectedRows: number[] = [];
    for (const selection of selectedInTable) {
      if (selection.row == -1) continue;
      const rowMin = Math.min(selection.row, selection.row2);
      const rowMax = Math.max(selection.row, selection.row2);

      for (let i = rowMin; i <= rowMax; i++) selectedRows.push(i);
    }

    // props.TD.style.background = "rgba(255,255, 255,1)";
    const isRowCurrentlySelected = isContextMenuOpen && selectedRows.includes(props.row);
    if (isRowCurrentlySelected) props.TD.style.background = "rgba(0, 94, 255, 0.1)";

    if (!hotRef || !hotRef.current) return <></>;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const hot = hotRef.current.hotInstance as Handsontable;
    if (!hot) return <></>;

    const rowData = hot.getSourceDataAtRow(props.row) as CategoryRow | ModRow;
    if (!rowData) return <></>;

    if (rowData && isCategoryRow(rowData)) {
      props.TD.style.background = "rgb(89, 22, 139)"; // purple-900

      if (isRowCurrentlySelected) props.TD.style.background = "rgb(60, 3, 102)"; // purple-950
    }

    const mod = (mods as Mod[]).find((iterMod) => iterMod.path == rowData.path);
    if (!mod) return <></>;

    if (!props.value) return <></>;
    const categories = props.value as string[];

    return (
      <>
        {categories.map((category) => (
          <Badge key={category} text={category} mod={mod} />
        ))}
      </>
    );
  };

  useEffect(() => {
    console.log("REDRAW");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") isShiftDown = true;
      if (e.key === "Control") isControlDown = true;
      if (e.key === " ") {
        const selectedMods = getSelectedMods();
        if (selectedMods.length > 0) {
          const toEnable = selectedMods.some((mod) => !mod.isEnabled);
          dispatch(setAreModsEnabled(selectedMods.map((mod) => ({ mod, isEnabled: toEnable }))));
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") isShiftDown = false;
      if (e.key === "Control") isControlDown = false;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    if (isContextMenuOpen) {
      setTimeout(() => {
        const contextMenu = document.getElementById("categoriesContextMenu");
        if (contextMenu) {
          const bounds = contextMenu.getBoundingClientRect();
          if (window.innerHeight < bounds.y + bounds.height) {
            contextMenu.style.top = `${bounds.y - bounds.height}px`;
          }
        }
      }, 10);
    }

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  });

  registerAllModules();

  let sourceDataObject = useMemo(() => {
    const sourceDataObject = getModsSortedByHumanNameAndName(mods).reduce((acc, current) => {
      let modCategories = current.categories ?? ["Uncategorized"];
      if (modCategories.length == 0) modCategories = ["Uncategorized"];

      for (const category of modCategories) {
        const existingCategoryRow = acc.find((row) => row.category === category);
        const { isEnabled, humanName, path, name, categories } = current;

        const newModRow = {
          isEnabled,
          humanName: humanName != "" ? humanName : name.replace(".pack", ""),
          path,
          name,
          categories: categories ?? [],
        };

        if (existingCategoryRow) {
          if (!hiddenCategories.includes(category)) {
            existingCategoryRow.__children.push(newModRow);
          }
        } else {
          const children = (!hiddenCategories.includes(category) && [newModRow]) || [];
          acc.push({
            category,
            isEnabled: false,
            humanName: null,
            path: null,
            name: null,
            categories: null,
            __children: children,
          });
        }
      }
      return acc;
    }, [] as CategoriesTable);

    for (const categoryRowObject of sourceDataObject) {
      const category = categoryRowObject.category;
      const modsInCategory =
        (category == "Uncategorized" &&
          mods.filter((mod) => !mod.categories || mod.categories.length == 0)) ||
        mods.filter((mod) => mod.categories?.includes(category));
      categoryRowObject.isEnabled = modsInCategory.every((child) => child.isEnabled);
    }

    return sourceDataObject;
  }, [mods, hiddenCategories, categoriesFilter, nameFilter, categoryFilter]);

  // filter out the name column, supports comma as OR
  if (nameFilter.trim() != "") {
    const filterNames = nameFilter
      .trim()
      .toLowerCase()
      .split(",")
      .map((name) => name.trim())
      .filter((category) => category != "");

    for (const categoryRow of sourceDataObject) {
      categoryRow.__children = categoryRow.__children.filter((row) =>
        filterNames.some((filterName) => row.humanName.toLowerCase().includes(filterName))
      );
    }

    sourceDataObject = sourceDataObject.filter((categoryRow) => categoryRow.__children.length > 0);
  }

  // filter out the category column, supports comma as OR
  if (categoryFilter.trim() != "") {
    const filterCategories = categoryFilter
      .trim()
      .toLowerCase()
      .split(",")
      .map((category) => category.trim())
      .filter((category) => category != "");

    sourceDataObject = sourceDataObject.filter((categoryRow) =>
      filterCategories.some((category) =>
        categoryRow.category.toLowerCase().includes(category.toLowerCase().trim())
      )
    );
  }

  // filter out the categories column, supports comma as OR
  if (categoriesFilter.trim() != "") {
    const filterCategories = categoriesFilter
      .trim()
      .toLowerCase()
      .split(",")
      .map((category) => category.trim())
      .filter((category) => category != "");

    for (const categoryRow of sourceDataObject) {
      categoryRow.__children = categoryRow.__children.filter((row) =>
        filterCategories.some((filterCategory) =>
          (row.categories ?? []).some((category) =>
            category.toLowerCase().includes(filterCategory.toLowerCase().trim())
          )
        )
      );
    }

    sourceDataObject = sourceDataObject.filter((categoryRow) => categoryRow.__children.length > 0);
  }

  // if we filtered out all rows make a new blank row or HotTable will disable its plugins permanently
  if (sourceDataObject.length == 0) {
    sourceDataObject.push({
      category: localized.noMatches,
      isEnabled: false,
      humanName: null,
      path: null,
      name: null,
      categories: null,
      __children: [],
    });
  }

  sourceDataObject.sort((firstCategory, secondCategory) => {
    if (firstCategory.category == "Uncategorized") return -1;
    if (secondCategory.category == "Uncategorized") return 1;
    return firstCategory.category.localeCompare(secondCategory.category);
  });

  const flattenedData: (CategoryRow | ModRow)[] = [];
  for (const categoryRow of sourceDataObject) {
    flattenedData.push(categoryRow, ...categoryRow.__children);
  }

  const onOverlayClick = useCallback(() => {
    selectedInTable = [{ row: -1, column: 0, row2: 0, column2: 0 }];
    console.log("clearing tracked selection");
    setIsContextMenuOpen(false);
  }, []);

  const onContextMenu = useCallback((ev: MouseEvent) => {
    const contextMenu = document.getElementById("categoriesContextMenu");
    if (!contextMenu) return;
    if (!ev || !ev.currentTarget) return;

    contextMenu.style.left = `${ev.x}px`;
    contextMenu.style.top = `${ev.y}px`;
  }, []);

  useEffect(() => {
    document.removeEventListener("contextmenu", onContextMenu);
    document.addEventListener("contextmenu", onContextMenu);

    if (!hotRef || !hotRef.current) return;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const hot = hotRef.current.hotInstance as Handsontable;
    if (!hot) return;

    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [contextMenuRef.current]);

  const getSelectedMods = (): Mod[] => {
    if (!hotRef || !hotRef.current) return [];
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const hot = hotRef.current.hotInstance as Handsontable;
    if (!hot) return [];

    const selectedRows: number[] = [];
    for (const selection of selectedInTable) {
      if (selection.row == -1) continue;
      const rowMin = Math.min(selection.row, selection.row2);
      const rowMax = Math.max(selection.row, selection.row2);

      for (let i = rowMin; i <= rowMax; i++) {
        selectedRows.push(i);
      }
    }

    const selectedMods: Mod[] = [];
    for (const rowNum of selectedRows) {
      const rowData = hot.getSourceDataAtRow(rowNum) as CategoryRow | ModRow;
      if (!rowData) continue;
      if (isCategoryRow(rowData)) continue;
      const path = rowData.path;
      const selectedMod = mods.find((iterMod) => iterMod.path == path);
      if (selectedMod) selectedMods.push(selectedMod);
    }
    return selectedMods;
  };

  const onSelectCategoryChange = (
    newValue: SingleValue<CategorySelectType>,
    actionMeta: ActionMeta<CategorySelectType>
  ) => {
    if (!newValue) return;
    console.log(
      `category select, label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`
    );
    if (actionMeta.action !== "select-option") return;

    console.log("isControlDown", isControlDown);
    let selectOperation = "addition" as SelectOperation;
    if (isControlDown && isShiftDown) selectOperation = "unary" as SelectOperation;
    else if (isControlDown) selectOperation = "subtraction" as SelectOperation;

    dispatch(selectCategory({ mods: getSelectedMods(), category: newValue.value, selectOperation }));
    setIsContextMenuOpen(false);
  };

  const onCreateNewCategory = (name: string) => {
    dispatch(addCategory({ category: name, mods: getSelectedMods() }));
    selectedInTable = [{ row: -1, column: 0, row2: 0, column2: 0 }];
    setIsContextMenuOpen(false);
  };

  const options = categories.map(
    (category) =>
      ({
        value: category,
        label: category,
      } as CategorySelectType)
  );

  function firstRowRenderer(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    _instance: Core,
    td: HTMLTableCellElement,
    row: number,
    col: number,
    prop: string | number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    cellProperties: CellProperties
  ) {
    if (col == 0) {
      td.style.verticalAlign = "left";
    }
    if (col == 1) {
      td.style.verticalAlign = "middle";
    }

    if (col == 1) checkboxRenderer.apply(this, [_instance, td, row, col, prop, value, cellProperties]);
    else textRenderer.apply(this, [_instance, td, row, col, prop, value, cellProperties]);

    const selectedRows: number[] = [];
    for (const selection of selectedInTable) {
      if (selection.row == -1) continue;
      const rowMin = Math.min(selection.row, selection.row2);
      const rowMax = Math.max(selection.row, selection.row2);

      for (let i = rowMin; i <= rowMax; i++) selectedRows.push(i);
    }

    if (isContextMenuOpen && selectedRows.includes(row)) td.style.background = "rgba(0, 94, 255, 0.1)";

    const rowData = flattenedData[row];
    if (rowData && isCategoryRow(rowData)) {
      td.style.background = "oklch(38.1% 0.176 304.987)";
    }
  }

  const collapseOrExpandAllCategories = () => {
    if (hiddenCategories.length == 0) {
      setHiddenCategories([...categoriesWithUncategorized]);
    } else {
      setHiddenCategories([]);
    }
  };

  return (
    <>
      <FloatingOverlay
        onClick={() => onOverlayClick()}
        onContextMenu={() => onOverlayClick()}
        className={`${isContextMenuOpen ? "" : "hidden"} z-[250] dark`}
        id="modDropdownOverlay"
      >
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          id="categoriesContextMenu"
          className={
            `${isContextMenuOpen ? "" : "hidden"}` +
            ` fixed w-52 bg-white rounded divide-y divide-gray-100 shadow dark:bg-gray-700 z-[300]`
          }
          style={{
            left: 111,
            top: 111,
          }}
          ref={contextMenuRef}
        >
          <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
            <li className=" pb-3 mb-1 flex justify-center flex-wrap">
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
                className=" w-10/12"
                options={options}
                styles={selectStyle}
                onChange={onSelectCategoryChange}
                onCreateOption={(name) => onCreateNewCategory(name)}
              ></Creatable>
            </li>
          </ul>
          {getCurrentlySelectedMods().length > 1 && (
            <div>
              <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
                <li>
                  <a
                    onClick={() => {
                      dispatch(
                        setAreModsEnabled(
                          getCurrentlySelectedMods().map((mod) => ({ mod: mod, isEnabled: true }))
                        )
                      );
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
                      dispatch(
                        setAreModsEnabled(
                          getCurrentlySelectedMods().map((mod) => ({ mod: mod, isEnabled: false }))
                        )
                      );
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
          {getCurrentlySelectedMods().length == 1 && (
            <ModDropdownOptions
              mod={getCurrentlySelectedMods()[0]}
              mods={mods}
              visibleMods={mods}
            ></ModDropdownOptions>
          )}
        </div>
      </FloatingOverlay>

      <div className="-mt-6 mr-10">
        <div className="mt-5 flex">
          <span className="relative ml-4">
            <input
              id="categoryFilterInput"
              type="text"
              defaultValue={categoryFilter}
              placeholder={localized.categoryFilter}
              onChange={(e) => {
                setNewCategoryFilter(e.target.value);
              }}
              className="bg-gray-50 w-48 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            ></input>

            <span className="absolute right-2 top-2 text-gray-400">
              <button
                onClick={() => {
                  (document.getElementById("categoryFilterInput") as HTMLInputElement).value = "";
                  setCategoryFilter("");
                }}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </span>
          </span>

          <span className="relative ml-8">
            <input
              id="nameFilterInput"
              type="text"
              defaultValue={nameFilter}
              placeholder={localized.nameFilter}
              onChange={(e) => {
                setNewNameFilter(e.target.value);
              }}
              className="bg-gray-50 w-72 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            ></input>

            <span className="absolute right-2 top-2 text-gray-400">
              <button
                onClick={() => {
                  (document.getElementById("nameFilterInput") as HTMLInputElement).value = "";
                  setNameFilter("");
                }}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </span>
          </span>

          <span className="relative ml-10">
            <input
              id="categoriesFilterInput"
              type="text"
              defaultValue={categoriesFilter}
              placeholder={localized.categoriesFilter}
              onChange={(e) => {
                setNewCategoriesFilter(e.target.value);
              }}
              className="bg-gray-50 w-80 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            ></input>

            <span className="absolute right-2 top-2 text-gray-400">
              <button
                onClick={() => {
                  (document.getElementById("categoriesFilterInput") as HTMLInputElement).value = "";
                  setCategoriesFilter("");
                }}
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
              onClick={() => collapseOrExpandAllCategories()}
              className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mb-2 dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
              type="button"
              aria-controls="drawer-example"
            >
              {hiddenCategories.length == 0 ? localized.collapseAll : localized.expandAll}
            </button>
          </div>
        </div>
      </div>
      <div
        onClick={(ev) => {
          console.log("HT: onClick");
          const targetElement = ev.target as HTMLElement;
          let innerHmtl = "";
          if (
            targetElement.classList.contains("rowHeader") ||
            targetElement.classList.contains("rowHeaderChild")
          ) {
            console.log("HT: classList rowHeader");
            innerHmtl = targetElement.innerHTML;
          } else if (
            targetElement.parentElement?.classList.contains("rowHeader") ||
            targetElement.parentElement?.classList.contains("rowHeaderChild")
          ) {
            console.log("HT: parentElement classList rowHeader");
            innerHmtl = targetElement.parentElement?.innerHTML;
          }

          if (innerHmtl == "") return;
          const rowNum = Number(innerHmtl.split(" ")[0]) - 1;
          console.log("rowNum:", rowNum);
          if (flattenedData.length <= rowNum) return;

          const rowData = flattenedData[rowNum];
          if (!rowData) return;
          if (!isCategoryRow(rowData)) return;

          const category = rowData.category;
          if (category) {
            if (hiddenCategories.includes(category)) {
              setHiddenCategories(hiddenCategories.filter((iterCategory) => iterCategory != category));
            } else {
              setHiddenCategories([...hiddenCategories, category]);
            }
          }
        }}
        onContextMenu={() => {
          if (!hotRef || !hotRef.current) return;
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const hot = hotRef.current.hotInstance as Handsontable;
          if (!hot) return;

          const selectedRows: number[] = [];
          for (const selection of selectedInTable) {
            if (selection.row == -1) continue;
            const rowMin = Math.min(selection.row, selection.row2);
            const rowMax = Math.max(selection.row, selection.row2);

            for (let i = rowMin; i <= rowMax; i++) selectedRows.push(i);
          }

          const selectedMods: Mod[] = [];
          for (const i of selectedRows) {
            const rowData = hot.getSourceDataAtRow(i) as ModRow | CategoryRow;
            if (!rowData) continue;
            if (!isCategoryRow(rowData)) {
              const mod = mods.find((mod) => mod.path == rowData.path);
              if (mod) selectedMods.push(mod);
            }
          }
          console.log("CSM:", getCurrentlySelectedMods());
          console.log("NEW CSM:", selectedMods);
          // setCurrentlySelectedMods(selectedMods);
          setIsContextMenuOpen(true);
        }}
        className="overflow-hidden mr-10 ht-theme-main-dark"
      >
        <MemoHotTable
          viewportColumnRenderingOffset={100}
          viewportRowRenderingOffset={250}
          data={sourceDataObject}
          persistentState={true}
          width="100%"
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          ref={hotRef}
          stretchH="last"
          height={"87vh"}
          nestedRows={true}
          // preventOverflow={"vertical"}
          licenseKey="non-commercial-and-evaluation"
          rowHeaders={(visualRowIndex) => {
            if (visualRowIndex >= flattenedData.length) return `${visualRowIndex + 1}`;

            const data = flattenedData[visualRowIndex];
            if (isCategoryRow(data)) {
              if (hiddenCategories.includes(data.category)) {
                return `<span class="rowHeaderChild">${visualRowIndex + 1} ▼</span>`;
              }
              return `<span class="rowHeaderChild">${visualRowIndex + 1} ▲</span>`;
            }

            return `${visualRowIndex + 1}`;
          }}
          afterChange={(changes) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            changes?.forEach(([row, prop, oldValue, newValue]) => {
              if (!hotRef || !hotRef.current) return;
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              const hot = hotRef.current.hotInstance as Handsontable;
              if (!hot) return;

              if (prop == "isEnabled") {
                const rowData = hot.getSourceDataAtRow(row) as ModRow | CategoryRow;
                if (!rowData) return;
                if (isCategoryRow(rowData)) {
                  const category = rowData.category;
                  const modsForEnable =
                    (category == "Uncategorized" &&
                      mods.filter((mod) => !mod.categories || mod.categories.length == 0)) ||
                    mods.filter((mod) => mod.categories?.includes(category));

                  const modIsEnabledPayloads = modsForEnable.map((mod) => ({ mod, isEnabled: newValue }));
                  dispatch(setAreModsEnabled(modIsEnabledPayloads));
                  return;
                }

                const path = rowData.path;
                const selectedMod = mods.find((iterMod) => iterMod.path === path);
                if (!selectedMod) return;
                if (selectedMod.isEnabled == newValue) return;
                dispatch(toggleMod(selectedMod));
              }
            });
          }}
          afterSelection={(row, column, row2, column2, preventScrolling) => {
            if (column == 1) return;
            // if(row == -1){ }
            // console.log("selected", row, column);
            selectedInTable.push({ row, column, row2, column2 });

            if (!hotRef || !hotRef.current) return;
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const hot = hotRef.current.hotInstance as Handsontable;
            if (!hot) return;

            preventScrolling.value = true;
            if (row == row2 && column == column2 && column == 0) {
              // console.log("THEY'RE SAME");
              const rowData = hot.getDataAtRow(row);
              if (!rowData) return;
              const category = rowData[0];
              const name = rowData[2];
              // console.log("rowData", rowData);
              if (!name && category) {
                let currentRowNum = row + 1;
                for (; ; currentRowNum++) {
                  if (hot.countRows() <= currentRowNum) {
                    selectedInTable.push({ row, column, row2: currentRowNum - 1, column2 });
                    hot.selectRows(row, currentRowNum - 1);
                    break;
                  }
                  const rowData = hot.getDataAtRow(currentRowNum);
                  if (!rowData) return;
                  const currentRowCategory = rowData[0];
                  if (currentRowCategory) {
                    console.log("NEW selectedInTable", { row, column, row2: currentRowNum - 1, column2 });
                    selectedInTable.push({ row, column, row2: currentRowNum - 1, column2 });
                    setTimeout(() => {
                      hot.selectRows(row, currentRowNum - 1);
                    }, 50);
                    break;
                  }
                }
              }
            } else {
              const selected = hot.getSelected();
              if (selected) {
                // console.log("selected:", selected);
                selectedInTable = selected.map((selection) => {
                  const [row, column, row2, column2] = selection;
                  return { row, column, row2, column2 };
                });
              }
            }
          }}
          afterDeselect={() => {
            console.log("deselected");
            // if (!isContextMenuOpen) {
            //   selectedInTable = [{ row: -1, column: 0, row2: 0, column2: 0 }];
            //   console.log("clearing tracked selection");
            // }
            if (!hotRef || !hotRef.current) return;
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const hot = hotRef.current.hotInstance as Handsontable;
            if (!hot) return;
            // hot.render();
          }}
          readOnlyCellClassName="" // prevents use of the default class
          selectionMode="multiple"
          // disableVisualSelection={true}
          // rowHeights={"29px"}
          hiddenColumns={
            {
              // columns: [3],
            }
          }
          colHeaders={(index) => {
            return headerNames[index];
          }}
          tableClassName=""
          cells={function (row, col) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cellProperties: any = {};

            if (col != 3) cellProperties.renderer = firstRowRenderer;
            return cellProperties;
          }}
          // autoRowSize={true}
          // autoRowSize={{ syncLimit: "100%", allowSampleDuplicates: true }}
          // rowHeights="28px"
          // renderAllRows={true}

          // autoColumnSize={true}
        >
          <HotColumn data="category" className="htCenter htMiddle" width={120} readOnly={true}></HotColumn>
          <HotColumn data="isEnabled" width={30} type="checkbox"></HotColumn>
          <HotColumn data="humanName" className="htMiddle" width={300} readOnly={true}></HotColumn>
          <HotColumn data="categories" readOnly={true} renderer={BadgesRowRenderer}></HotColumn>
        </MemoHotTable>
      </div>

      <EditCategoriesModal
        isOpen={isEditCategoriesModalOpen}
        onClose={() => setIsEditCategoriesModalOpen(false)}
      />
    </>
  );
});

export default Categories;

const MemoHotTable = memo(HotTable);
