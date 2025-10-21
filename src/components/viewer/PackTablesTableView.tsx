import React, { useEffect, useRef, memo, Suspense, useState, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import "@silevis/reactgrid/styles.css";
import { getDBPackedFilePath, getPackNameFromPath } from "../../utility/packFileHelpers";
import { AmendedSchemaField, DBVersion, SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { setDeepCloneTarget } from "@/src/appSlice";
import { dataFromBackend } from "./packDataStore";
import debounce from "just-debounce-it";
import { homedir } from "node:os";
import Handsontable from "handsontable";

// Lazy load Handsontable components
const LazyHotTable = React.lazy(async () => {
  // CSS imports handled via webpack configuration - remove direct imports

  const [{ HotTable }, { registerAllModules }] = await Promise.all([
    import("@handsontable/react-wrapper"),
    import("handsontable/registry"),
  ]);

  // Register modules once loaded
  registerAllModules();

  return { default: HotTable };
});

// Loading component for table
const TableLoadingSpinner = () => (
  <div className="flex items-center justify-center h-96 bg-gray-800">
    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
    <span className="ml-4 text-gray-300">Loading table...</span>
  </div>
);

const colHeaders = (
  index: number,
  currentDBTableSelection: DBTableSelection,
  currentSchema: DBVersion,
  columnHeaders: string[]
) => {
  const keyColumnNames = dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];
  const field = currentSchema.fields[index];

  if (keyColumnNames.indexOf(field.name) > -1) {
    return `🔑 ${columnHeaders[index]}`;
  }

  return columnHeaders[index];
};

// Handsontable wrapper component
const HandsontableWrapper = memo(
  ({
    data,
    columns,
    columnHeaders,
    hotRef,
    onContextMenuCallback,
    currentDBTableSelection,
    currentSchema,
  }: {
    data: any[][];
    columns: any[];
    columnHeaders: string[];
    hotRef: React.RefObject<any>;
    onContextMenuCallback: (row: number, col: number) => void;
    currentDBTableSelection: DBTableSelection;
    currentSchema: DBVersion;
  }) => {
    const startArgs = useAppSelector((state) => state.app.startArgs);
    return (
      <Suspense fallback={<TableLoadingSpinner />}>
        <LazyHotTable
          ref={hotRef}
          filters={true}
          // autoColumnSize={{ useHeaders: false }}
          data={data}
          rowHeaders={true}
          colHeaders={(i) => {
            return colHeaders(i, currentDBTableSelection, currentSchema, columnHeaders);
          }}
          columns={columns}
          manualColumnResize={true}
          columnSorting={true}
          manualColumnFreeze={true}
          stretchH="all"
          contextMenu={{
            items: {
              row_above: {},
              row_below: {},
              about: {
                name() {
                  if (!hotRef || !hotRef.current) return "<b>Deep clone</b>";
                  const hot = hotRef.current.hotInstance as Handsontable;
                  if (!hot) return "<b>Deep clone</b>";

                  const lastSelected = hot.getSelected();
                  if (!lastSelected) return "<b>Deep clone</b>";
                  if (lastSelected.length != 1) return "<b>Deep clone</b>";
                  const [startRow, startCol, endRow, endCol] = lastSelected[0];

                  if (startRow != endRow || startCol != endCol) return "<b>Deep clone</b>";

                  const keyColumnNames =
                    dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];

                  if (keyColumnNames.length == 0) return "<b>Deep clone</b>";

                  // case we directly click a key column cell
                  for (let i = 0; i < currentSchema.fields.length; i++) {
                    const field = currentSchema.fields[i];
                    console.log("checking", field.name, "index is", i, "startCol is", startCol);
                    if (i == startCol && keyColumnNames.indexOf(field.name) > -1) {
                      console.log("clicked ref column", field.name);
                      const cellValue = hot.getDataAtCell(startRow, startCol);
                      return `<b>Deep clone ${cellValue}</b>`;
                    }
                  }

                  // case we click on a non-key column cell find the cell with the key column in that row
                  for (let i = 0; i < currentSchema.fields.length; i++) {
                    const field = currentSchema.fields[i];
                    console.log("checking", field.name, "index is", i, "startCol is", startCol);
                    if (keyColumnNames.indexOf(field.name) > -1) {
                      const cellValue = hot.getDataAtCell(startRow, i);
                      return `<b>Deep clone ${cellValue}</b>`;
                    }
                  }

                  return "<b>Deep clone</b>";
                },
                hidden() {
                  if (!hotRef || !hotRef.current) return;
                  const hot = hotRef.current.hotInstance as Handsontable;
                  if (!hot) return true;

                  const lastSelected = hot.getSelected();
                  if (!lastSelected) return true;
                  if (lastSelected.length != 1) return true;
                  const [startRow, startCol, endRow, endCol] = lastSelected[0];

                  if (startRow != endRow || startCol != endCol) return true;

                  // console.log("dataFromBackend.referencedColums:", dataFromBackend.referencedColums);
                  console.log(
                    "column refs:",
                    currentDBTableSelection.dbName,
                    dataFromBackend.referencedColums[currentDBTableSelection.dbName]
                  );
                  const keyColumnNames =
                    dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];

                  if (keyColumnNames.length == 0) return true;

                  return false;
                },
                callback(key, selection, clickEvent) {
                  if (!hotRef || !hotRef.current) return;
                  const hot = hotRef.current.hotInstance as Handsontable;
                  if (!hot) return true;

                  const lastSelected = hot.getSelected();
                  if (!lastSelected) return;
                  if (lastSelected.length != 1) return;
                  const [startRow, startCol, endRow, endCol] = lastSelected[0];
                  if (startRow != endRow || startCol != endCol) return;

                  const keyColumnNames =
                    dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];

                  if (keyColumnNames.length == 0) return false;

                  // case we directly click a key column cell
                  for (let i = 0; i < currentSchema.fields.length; i++) {
                    const field = currentSchema.fields[i];
                    console.log("checking", field.name, "index is", i, "startCol is", startCol);
                    if (i == startCol && keyColumnNames.indexOf(field.name) > -1) {
                      console.log("clicked ref column", field.name);
                      onContextMenuCallback(hot.toPhysicalRow(startRow), hot.toPhysicalColumn(startCol));
                      return;
                    }
                  }

                  // case we click on a non-key column cell find the cell with the key column in that row
                  for (let i = 0; i < currentSchema.fields.length; i++) {
                    const field = currentSchema.fields[i];
                    console.log("checking", field.name, "index is", i, "startCol is", startCol);
                    if (keyColumnNames.indexOf(field.name) > -1) {
                      onContextMenuCallback(hot.toPhysicalRow(startRow), hot.toPhysicalColumn(i));
                      return;
                    }
                  }
                },
              },
            },
          }}
          viewportColumnRenderingOffset={20}
          viewportRowRenderingOffset={100}
          dropdownMenu={[
            "filter_by_condition",
            "filter_by_condition2",
            "filter_operators",
            "filter_by_value",
            "filter_action_bar",
          ]}
          width="100%"
          height="85vh"
          // colHeaders={columnHeaders}
          licenseKey="non-commercial-and-evaluation"
        />
      </Suspense>
    );
  }
);

const PackTablesTableView = memo(() => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);
  const [handsontableLoaded, setHandsontableLoaded] = useState(false);
  const startArgs = useAppSelector((state) => state.app.startArgs);

  const [keyFilter, setKeyFIlter] = useState<string>("");
  const [tableFilter, setTableFilter] = useState<string>("");

  const hotRef = useRef<any>(null);

  const setTableFilterDebounced = useMemo(
    () =>
      debounce((value: string) => {
        setTableFilter(value);
      }, 250),
    [setTableFilter]
  );

  useEffect(() => {
    if (!startArgs.includes("-testDBClone")) return;

    const autoDispatchTimer = setTimeout(() => {
      dispatch(setDeepCloneTarget({ row: 3, col: 14 }));
    }, 2000);

    return () => {
      clearTimeout(autoDispatchTimer);
    };
  }, []);

  // Handsontable modules are registered lazily when component loads

  console.log("currentDBTableSelection:", currentDBTableSelection);
  if (!currentDBTableSelection) {
    return <></>;
  }

  const packName = getPackNameFromPath(currentDBTableSelection.packPath);
  const packPath = currentDBTableSelection.packPath;
  console.log("packPath for table view is ", packName);

  // console.log("BASENAME", packName);
  if (!packsData) {
    return <></>;
  }

  const packData = packsData[packPath];
  // console.log("packData packedFiles:", packData.packedFiles);
  if (!packData) {
    return <></>;
  }

  const packedFilePath = getDBPackedFilePath(currentDBTableSelection);
  console.log("packedFilePath:", packedFilePath);

  if (!packData.packedFiles) {
    console.log("No packed files!");
    return <></>;
  }
  let packFile = packData.packedFiles[packedFilePath];
  if (!packFile) {
    // check case where we have just the pack file name as instead of full path (e.g. 'data.pack')
    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      if (iterPackedFilePath.startsWith(`${packedFilePath}`)) {
        packFile = iterPackedFile;
      }
    }

    if (!packFile) {
      console.log("no packFile found:", packedFilePath);
      return <></>;
    }
  }
  const currentSchema = packFile.tableSchema;

  // console.log("PACKFILE IS ", packFile);
  // console.log("CURRENT SCHEMA IS ", currentSchema);

  if (!currentSchema) {
    console.log("NO current schema");
    return <></>;
  }

  const chunkedTable =
    (packFile.schemaFields &&
      packFile.schemaFields.reduce<AmendedSchemaField[][]>((resultArray, item, index) => {
        const chunkIndex = Math.floor(index / currentSchema.fields.length);

        if (!resultArray[chunkIndex]) {
          resultArray[chunkIndex] = []; // start a new chunk
        }

        resultArray[chunkIndex].push(item as AmendedSchemaField);

        return resultArray;
      }, [])) ||
    [];

  const keyColumnNamesUnderscore = dataFromBackend.referencedColums[currentDBTableSelection.dbName] || [];
  const keyColumnNames = currentSchema.fields
    .filter((field) => keyColumnNamesUnderscore.includes(field.name))
    .map((field) => field.name.replaceAll("_", " "));

  const columnHeaders = currentSchema.fields.map((field) => field.name.replaceAll("_", " "));

  const fieldTypeToCellType = (fieldType: SCHEMA_FIELD_TYPE) => {
    switch (fieldType) {
      case "I64":
      case "F32":
      case "I32":
      case "I16":
      case "F64":
        return "numeric";
      case "Boolean":
        return "checkbox";
      default:
        return "text";
    }
  };
  const columns = currentSchema.fields.map((field) => ({ type: fieldTypeToCellType(field.field_type) }));

  const columnFilterOptions = columnHeaders.toSorted((firstHeader, secondHeader) => {
    if (keyColumnNames.includes(firstHeader) && keyColumnNames.includes(secondHeader)) return 0;
    if (keyColumnNames.includes(firstHeader)) return -1;
    if (keyColumnNames.includes(secondHeader)) return 1;

    return columnHeaders.indexOf(firstHeader) - columnHeaders.indexOf(secondHeader);
  });

  const keyFilterOrDefault = keyFilter != "" ? keyFilter : columnFilterOptions[0];
  const indexOfFilteredColumn = columnHeaders.indexOf(keyFilterOrDefault);

  console.log("keyFilter:", keyFilter);
  console.log("indexOfFilteredColumn:", indexOfFilteredColumn);
  console.log("tableFilter:", tableFilter);

  if (keyFilter != "" && !columnFilterOptions.includes(keyFilter)) {
    setKeyFIlter(columnFilterOptions[0]);
  }

  const filteredData =
    indexOfFilteredColumn != -1 && tableFilter != ""
      ? chunkedTable.filter((row) => {
          return row[indexOfFilteredColumn].resolvedKeyValue
            .toLowerCase()
            .includes(tableFilter.toLowerCase());
        })
      : chunkedTable;

  const data = filteredData.map((row) =>
    row.map((cell) => {
      if (cell.type == "Boolean") {
        return cell.resolvedKeyValue != "0";
      }
      if (cell.type == "OptionalStringU8" && cell.resolvedKeyValue == "0") {
        return "";
      }
      return cell.resolvedKeyValue;
    })
  );

  const handleContextMenuCallback = (row: number, col: number) => {
    console.log("handleContextMenuCallback:", row, col);
    const filteredRowIndex = filteredData[row];
    const unfilteredRowIndex = chunkedTable.findIndex((row) => row == filteredRowIndex);
    dispatch(setDeepCloneTarget({ row: unfilteredRowIndex, col }));
  };

  // const columns = getColumns();

  // const columns = currentSchema.fields.map((field) => ({ data: field.name }));

  // const hotColumns = columns.map((column) => <HotColumn title={column} />);

  // console.log("COLUMNS:", columns);

  return (
    <div>
      <div className="ht-theme-main-dark">
        <HandsontableWrapper
          data={data}
          columns={columns}
          columnHeaders={columnHeaders}
          hotRef={hotRef}
          onContextMenuCallback={handleContextMenuCallback}
          currentDBTableSelection={currentDBTableSelection}
          currentSchema={currentSchema}
        />
      </div>
      <div className="mt-3 flex gap-6">
        <select
          value={keyFilter != "" ? keyFilter : columnFilterOptions[0]}
          onChange={(e) => setKeyFIlter(e.target.value)}
          className="px-2 py-1 text-sm border border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {columnFilterOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          defaultValue={tableFilter}
          placeholder={"filter by selected column"}
          onChange={(e) => setTableFilterDebounced(e.target.value)}
          className="bg-gray-50 w-48 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  );
});

export default PackTablesTableView;
