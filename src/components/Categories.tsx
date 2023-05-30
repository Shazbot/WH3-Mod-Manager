import Creatable from "react-select/creatable";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import "@silevis/reactgrid/styles.css";

import "handsontable/dist/handsontable.full.min.css";

import { HotColumn, HotTable } from "@handsontable/react";
import { textRenderer, checkboxRenderer } from "handsontable/renderers";

import { registerAllModules } from "handsontable/registry";
import { Tooltip } from "flowbite-react";
import { FloatingOverlay } from "@floating-ui/react-dom-interactions";
import selectStyle from "../styles/selectStyle";
import { ActionMeta, SingleValue } from "react-select";
import {
  addCategory,
  removeCategory,
  selectCategory,
  setAreModsEnabled,
  setIsModEnabled,
  toggleMod,
} from "../appSlice";
import { CellProperties } from "handsontable/settings";
import Core from "handsontable/core";
import Handsontable from "handsontable";
import debounce from "just-debounce-it";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isModRow = (row: any): row is ModRow => !row.category;

type CategoriesTable = CategoryRow[];

let selectedInTable = { row: 0, column: 0, row2: 0, column2: 0 } as {
  row: number;
  column: number;
  row2: number;
  column2: number;
};

const headerNames = ["Category", "Enabled", "Name", "Categories"];

let nestedRowHeaders: NodeListOf<Element>;

const Badge = memo(({ text, mod }: { text: string; mod: Mod }) => {
  const dispatch = useAppDispatch();
  return (
    <span className="inline-flex items-center px-2 py-1 mr-2 text-sm font-medium text-blue-800 bg-blue-100 rounded dark:bg-blue-900 dark:text-blue-300">
      {text}
      <button
        onClick={() => {
          dispatch(removeCategory({ mods: [mod], category: text }));
        }}
        type="button"
        className="inline-flex items-center p-0.5 ml-2 text-sm text-blue-400 bg-transparent rounded-sm hover:bg-blue-200 hover:text-blue-900 dark:hover:bg-blue-800 dark:hover:text-blue-300"
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
        <span className="sr-only">Remove badge</span>
      </button>
    </span>
  );
});

const rerenderTable = debounce((hot: Handsontable) => {
  // hot.render();
}, 100);

let isShiftDown = false;
let isControlDown = false;

const Categories = React.memo(() => {
  const dispatch = useAppDispatch();
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);

  const contextMenuRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<HotTable>(null);

  const onClick = useCallback(
    (event: Event) => {
      try {
        // console.log("clicked", event.currentTarget, event.target);
        const element = event.currentTarget as Node;
        const rowNum = ((element as HTMLElement).childNodes[0].childNodes[0] as HTMLElement).innerHTML.split(
          " "
        )[0];
        // console.log("rowNum", rowNum);

        if (!hotRef || !hotRef.current) return;
        const hot = hotRef.current.hotInstance;
        if (!hot) return;

        const rowData = hot.getDataAtRow(Number(rowNum) - 1);
        const category = rowData[0];
        if (category) {
          if (hiddenCategories.includes(category)) {
            setHiddenCategories(hiddenCategories.filter((iterCategory) => iterCategory != category));
          } else {
            setHiddenCategories([...hiddenCategories, category]);
          }
        }
      } catch (e) {
        console.log(e);
      }
    },
    [hiddenCategories, hotRef.current]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") isShiftDown = true;
      if (e.key === "Control") isControlDown = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") isShiftDown = false;
      if (e.key === "Control") isControlDown = false;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    // document.addEventListener("click", onClick);

    nestedRowHeaders?.forEach((rowHeader) => {
      rowHeader.removeEventListener("click", onClick);
    });

    nestedRowHeaders = document.querySelectorAll(".handsontable th.ht_nestingLevels");
    nestedRowHeaders.forEach((rowHeader) => {
      rowHeader.addEventListener("click", onClick);
    });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      // document.removeEventListener("click", onClick);
      nestedRowHeaders.forEach((rowHeader) => {
        rowHeader.removeEventListener("click", onClick);
      });
    };
  }, [hiddenCategories, hotRef.current]);

  registerAllModules();

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const categories = useAppSelector((state) => state.app.categories);

  const sourceDataObject = mods.reduce((acc, current) => {
    for (const category of current.categories ?? ["Uncategorized"]) {
      const existingCategoryRow = acc.find((row) => row.category === category);
      const { isEnabled, humanName, path, name, categories } = current;

      if (existingCategoryRow) {
        if (!hiddenCategories.includes(category)) {
          existingCategoryRow.__children.push({
            isEnabled,
            humanName,
            path,
            name,
            categories: categories ?? [],
          });
        }
      } else {
        const children =
          (!hiddenCategories.includes(category) && [
            { isEnabled, humanName, path, name, categories: categories ?? [] },
          ]) ||
          [];
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
      (category == "Uncategorized" && mods.filter((mod) => !mod.categories || mod.categories.length == 0)) ||
      mods.filter((mod) => mod.categories?.includes(category));
    categoryRowObject.isEnabled = modsInCategory.every((child) => child.isEnabled);
  }

  const onOverlayClick = useCallback(() => {
    if (!document.scrollingElement) return;
    const lastScrollTop = document.scrollingElement.scrollTop;
    setIsContextMenuOpen(false);

    setTimeout(() => {
      if (document.scrollingElement) document.scrollingElement.scrollTop = lastScrollTop;
      if (!hotRef || !hotRef.current) return;
      const hot = hotRef.current.hotInstance;
      if (!hot) return;
      hot.selectCell(
        selectedInTable.row,
        selectedInTable.column,
        selectedInTable.row2,
        selectedInTable.column2
      );

      rerenderTable(hot);
    }, 1);
  }, []);

  const onContextMenu = useCallback((ev: MouseEvent) => {
    const contextMenu = document.getElementById("categoriesContextMenu");
    if (!contextMenu) return;
    if (!ev || !ev.currentTarget) return;

    // console.log("x", ev.x);
    // console.log("y", ev.y);
    // console.log("ox", ev.offsetX);
    // console.log("oy", ev.offsetY);
    contextMenu.style.left = `${ev.x}px`;
    contextMenu.style.top = `${ev.y}px`;
  }, []);

  useEffect(() => {
    document.removeEventListener("contextmenu", onContextMenu);
    document.addEventListener("contextmenu", onContextMenu);

    if (!hotRef || !hotRef.current) return;
    const hot = hotRef.current.hotInstance;
    if (!hot) return;

    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [contextMenuRef.current]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RendererComponent = (props: any) => {
    // the available renderer-related props are:
    // - `row` (row index)
    // - `col` (column index)
    // - `prop` (column property name)
    // - `TD` (the HTML cell element)

    // console.log("RENDERCOMP");

    const rowMin = Math.min(selectedInTable.row, selectedInTable.row2);
    const rowMax = Math.max(selectedInTable.row, selectedInTable.row2);

    // console.log("rowMin", rowMin, "rowMax", rowMin, "row", row);
    props.TD.style.background = "rgba(255,255, 255,1)";
    if (isContextMenuOpen && props.row >= rowMin && props.row <= rowMax)
      props.TD.style.background = "rgba(0, 94, 255, 0.1)";

    // console.log(props.value);
    if (!props.value) return <></>;
    const categories = props.value as string[];

    const hotRef = props.hotRef;
    // console.log(hotRef);
    if (!hotRef || !hotRef.current) return <></>;
    const hot = hotRef.current.hotInstance;
    if (!hot) return <></>;

    const rowData = hot.getSourceDataAtRow(props.row) as ModRow;
    const mod = mods.find((iterMod) => iterMod.path == rowData.path);
    if (!mod) return <></>;

    // - `cellProperties` (the `cellProperties` object for the edited cell)
    // return (props.value && props.value) || <></>;

    return (
      <>
        {categories.map((category) => (
          <Badge key={category} text={category} mod={mod} />
        ))}
      </>
    );
  };

  const getSelectedMods = (): Mod[] => {
    if (!hotRef || !hotRef.current) return [];
    const hot = hotRef.current.hotInstance;
    if (!hot) return [];

    const selectedMods: Mod[] = [];
    for (
      let rowNum = Math.min(selectedInTable.row, selectedInTable.row2);
      rowNum <= Math.max(selectedInTable.row, selectedInTable.row2);
      rowNum++
    ) {
      const path = (hot.getSourceDataAtRow(rowNum) as ModRow).path;
      const selectedMod = mods.find((iterMod) => iterMod.path === path);
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
  };

  const onCreateNewCategory = (name: string) => {
    dispatch(addCategory({ category: name, mods: getSelectedMods() }));
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
    if (col == 1) checkboxRenderer.apply(this, [_instance, td, row, col, prop, value, cellProperties]);
    else textRenderer.apply(this, [_instance, td, row, col, prop, value, cellProperties]);

    const rowMin = Math.min(selectedInTable.row, selectedInTable.row2);
    const rowMax = Math.max(selectedInTable.row, selectedInTable.row2);
    // console.log("rowMin", rowMin, "rowMax", rowMin, "row", row);
    if (isContextMenuOpen && row >= rowMin && row <= rowMax) td.style.background = "rgba(0, 94, 255, 0.1)";
  }

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
            ` fixed w-44 bg-white rounded divide-y divide-gray-100 shadow dark:bg-gray-700 z-[300]`
          }
          style={{
            left: 111,
            top: 111,
          }}
          ref={contextMenuRef}
        >
          <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
            <li className="border-b-2 pb-4 mb-1 flex justify-center flex-wrap">
              <div className="mt-1 mb-2">Add category:</div>
              <Creatable
                className=" w-10/12"
                options={options}
                styles={selectStyle}
                onChange={onSelectCategoryChange}
                onCreateOption={(name) => onCreateNewCategory(name)}
              ></Creatable>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Set Load Order
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={<div className="min-w-[10rem]">Mod will always be enabled, even when hidden.</div>}
                >
                  Keep always enabled
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={
                    <div className="min-w-[10rem]">
                      Mod will be hidden from the list and disabled (except when always enabled).
                    </div>
                  }
                >
                  Hide from list
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Show in explorer
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Open in RPFM
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Open in Viewer
              </a>
            </li>
            <li>
              <a
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                Copy path to clipboard
              </a>
            </li>
          </ul>
        </div>
      </FloatingOverlay>
      <div
        onClick={(ev) => {
          // console.log(ev);
        }}
        onContextMenu={() => {
          setIsContextMenuOpen(true);

          if (!hotRef || !hotRef.current) return;
          const hot = hotRef.current.hotInstance;
          if (!hot) return;
          rerenderTable(hot);
        }}
        className="overflow-hidden"
      >
        <HotTable
          viewportColumnRenderingOffset={100}
          viewportRowRenderingOffset={100}
          data={sourceDataObject}
          persistentState={true}
          width="100%"
          ref={hotRef}
          stretchH="last"
          height={"94vh"}
          nestedRows={true}
          // preventOverflow={"vertical"}
          licenseKey="non-commercial-and-evaluation"
          rowHeaders={(visualRowIndex) => {
            // console.log()
            // console.log(this)
            if (!hotRef || !hotRef.current) return `${visualRowIndex + 1}`;
            const hot = hotRef.current.hotInstance;
            if (!hot) {
              setTimeout(() => {
                if (!hotRef || !hotRef.current) return `${visualRowIndex + 1}`;
                const hot = hotRef.current.hotInstance;
                if (hot) hot.render();
              }, 500);
              return `${visualRowIndex + 1}`;
            }
            // const hot = this as unknown as Handsontable;
            const rowData = hot.getDataAtRow(visualRowIndex);
            const category = rowData[0];
            if (category) {
              if (hiddenCategories.includes(category)) {
                return `${visualRowIndex + 1} <span style="">▼</span>`;
              }
              return `${visualRowIndex + 1} <span style="">▲</span>`;
            }

            return `${visualRowIndex + 1}`;
          }}
          afterChange={(changes, source) => {
            changes?.forEach(([row, prop, oldValue, newValue]) => {
              if (!hotRef || !hotRef.current) return;
              const hot = hotRef.current.hotInstance;
              if (!hot) return;

              if (prop == "isEnabled") {
                const rowData = hot.getSourceDataAtRow(row) as ModRow | CategoryRow;
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
            console.log("selected", row, column);
            selectedInTable = { row, column, row2, column2 };

            if (!hotRef || !hotRef.current) return;
            const hot = hotRef.current.hotInstance;
            if (!hot) return;
            // console.log("SELECTED DATA IS", hot.getSourceData(row, column, row2, column2));
            // console.log("SELECTED DATA IS2", hot.getSourceDataArray(row, column, row2, column2));
            // console.log("SELECTED DATA IS3", hot.getSourceDataAtRow(row));
            preventScrolling.value = true;
            if (row == row2 && column == column2) {
              // console.log("THEY'RE SAME");
              const rowData = hot.getDataAtRow(row);
              const category = rowData[0];
              const name = rowData[2];
              // console.log("rowData", rowData);
              if (!name) {
                let currentRowNum = row + 1;
                for (; ; currentRowNum++) {
                  // console.log("max is", hot.countRows());
                  // console.log("current is", currentRowNum);
                  if (hot.countRows() <= currentRowNum) {
                    selectedInTable = { row, column, row2: currentRowNum - 1, column2 };
                    hot.selectRows(row, currentRowNum - 1);
                    rerenderTable(hot);
                    break;
                  }
                  const rowData = hot.getDataAtRow(currentRowNum);
                  const currentRowCategory = rowData[0];
                  if (currentRowCategory) {
                    console.log("NEW selectedInTable", { row, column, row2: currentRowNum - 1, column2 });
                    selectedInTable = { row, column, row2: currentRowNum - 1, column2 };
                    setTimeout(() => {
                      // rerenderTable(hot);
                      hot.selectRows(row, currentRowNum - 1);
                      rerenderTable(hot);
                    }, 100);
                    break;
                  }
                }
              }
            }
            setTimeout(() => {
              // rerenderTable(hot);
            }, 100);
          }}
          afterDeselect={() => {
            // console.log("deselected");
            if (!isContextMenuOpen) selectedInTable = { row: 0, column: 0, row2: 0, column2: 0 };
            if (!hotRef || !hotRef.current) return;
            const hot = hotRef.current.hotInstance;
            if (!hot) return;
            // hot.render();
          }}
          readOnlyCellClassName="" // prevents use of the default class
          selectionMode="range"
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

            if (col != 3) cellProperties.renderer = firstRowRenderer; // uses lookup map
            return cellProperties;
          }}
          autoRowSize={true}
          rowHeights="28px"
          autoColumnSize={false}
          bindRowsWithHeaders={false}
        >
          <HotColumn data="category" width={120} readOnly={true}></HotColumn>
          <HotColumn data="isEnabled" width={30} type="checkbox"></HotColumn>
          <HotColumn data="name" width={300} readOnly={true}></HotColumn>
          {/* <HotColumn
            height={10}
            data="path"
            className="categories-path-cell"
            width={50}
            readOnly={true}
          ></HotColumn> */}
          <HotColumn data="categories" readOnly={true}>
            {/* add the `hot-renderer` attribute to mark the component as a Handsontable renderer */}
            <RendererComponent hotRef={hotRef} hot-renderer />
          </HotColumn>
        </HotTable>
      </div>
    </>
  );
});

export default Categories;
