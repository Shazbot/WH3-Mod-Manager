import React, { useEffect, useRef, memo, Suspense, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import "@silevis/reactgrid/styles.css";
import { getDBPackedFilePath, getPackNameFromPath } from "../../utility/packFileHelpers";
import { AmendedSchemaField, DBVersion, SCHEMA_FIELD_TYPE } from "../../packFileTypes";
import { setDeepCloneTarget } from "@/src/appSlice";
import { dataFromBackend } from "./packDataStore";

// Lazy load Handsontable components
const LazyHotTable = React.lazy(async () => {
  // CSS imports handled via webpack configuration - remove direct imports

  const [{ HotTable }, { registerAllModules }, Handsontable] = await Promise.all([
    import("@handsontable/react-wrapper"),
    import("handsontable/registry"),
    import("handsontable"),
  ]);

  // Register modules once loaded
  registerAllModules();

  return { default: HotTable, Handsontable };
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
                  return "<b>Deep clone</b>";
                },
                hidden() {
                  if (!startArgs.includes("-testDBClone")) return true;
                  if (!hotRef || !hotRef.current) return;
                  const hot = hotRef.current.hotInstance;
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
                  // console.log("current schema:", currentSchema);
                  // currentSchema.fields.find(field=>field.name == )
                  for (let i = 0; i < currentSchema.fields.length; i++) {
                    const field = currentSchema.fields[i];
                    console.log("checking", field.name, "index is", i, "startCol is", startCol);
                    if (i == startCol && keyColumnNames.indexOf(field.name) > -1) {
                      console.log("clicked ref column", field.name);
                      return false;
                    }
                  }

                  return true;
                },
                callback(key, selection, clickEvent) {
                  if (!hotRef || !hotRef.current) return;
                  const hot = hotRef.current.hotInstance;
                  if (!hot) return true;

                  const lastSelected = hot.getSelected();
                  if (!lastSelected) return;
                  if (lastSelected.length != 1) return;
                  const [startRow, startCol, endRow, endCol] = lastSelected[0];
                  if (startRow != endRow || startCol != endCol) return;

                  onContextMenuCallback(startRow, startCol);
                },
              },
            },
          }}
          viewportColumnRenderingOffset={10}
          viewportRowRenderingOffset={50}
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

  const hotRef = useRef<any>(null);

  useEffect(() => {
    if (!hotRef || !hotRef.current || !handsontableLoaded) return;
    const hot = hotRef.current.hotInstance;
    if (!hot) return;
    const plugin = hot.getPlugin("autoColumnSize");

    if (plugin?.isEnabled()) {
      // code...
    }
  }, [handsontableLoaded]);

  useEffect(() => {
    const autoDispatchTimer = setTimeout(() => {
      dispatch(setDeepCloneTarget({ row: 3, col: 14 }));
    }, 2000);

    return () => {
      clearTimeout(autoDispatchTimer);
    };
  });

  const handleContextMenuCallback = (row: number, col: number) => {
    dispatch(setDeepCloneTarget({ row, col }));
  };

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

  const data = chunkedTable.map((row) =>
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

  // const columns = getColumns();

  // const columns = currentSchema.fields.map((field) => ({ data: field.name }));
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
  // const hotColumns = columns.map((column) => <HotColumn title={column} />);

  // console.log("COLUMNS:", columns);

  return (
    <div className="ht-theme-main-dark-auto">
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
  );
});

export default PackTablesTableView;
