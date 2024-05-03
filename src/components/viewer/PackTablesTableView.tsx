import React, { useEffect, useRef } from "react";
import { useAppSelector } from "../../hooks";
import "@silevis/reactgrid/styles.css";
import { getDBPackedFilePath, getPackNameFromPath } from "../../utility/packFileHelpers";
import { AmendedSchemaField, SCHEMA_FIELD_TYPE } from "../../packFileTypes";

import "handsontable/dist/handsontable.full.min.css";

import { HotTable } from "@handsontable/react";

import { registerAllModules } from "handsontable/registry";

const PackTablesTableView = React.memo(() => {
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);

  // console.log("packsData:");
  // console.log(packData);

  const hotRef = useRef<HotTable>(null);

  useEffect(() => {
    if (!hotRef || !hotRef.current) return;
    const hot = hotRef.current.hotInstance;
    if (!hot) return;
    const plugin = hot.getPlugin("autoColumnSize");

    // console.log("WIDHT IS", plugin.getColumnWidth(4));

    if (plugin.isEnabled()) {
      // code...
    }
  });

  // registerPlugin(AutoColumnSize);
  // registerPlugin(DropdownMenu);
  // registerPlugin(HiddenRows);
  // registerCellType(CheckboxCellType);
  // registerPlugin(Filters);
  registerAllModules();

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
  // console.log("packData:", packData);
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
      if (iterPackedFilePath.endsWith(`\\${packedFilePath}`)) {
        packFile = iterPackedFile;
      }
    }

    if (!packFile) return <></>;
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
    <div>
      <HotTable
        ref={hotRef}
        filters={true}
        autoColumnSize={{ useHeaders: false }}
        // beforeStretchingColumnWidth={(w, c) => {
        //   console.log(w, c);
        //   return 10;
        // }}
        data={data}
        rowHeaders={true}
        columns={columns}
        manualColumnResize={true}
        columnSorting={true}
        manualColumnFreeze={true}
        stretchH="all"
        contextMenu={true}
        viewportColumnRenderingOffset={50}
        // dropdownMenu={["filter_by_condition", "filter_action_bar"]}
        dropdownMenu={[
          "filter_by_condition",
          "filter_by_condition2",
          "filter_operators",
          "filter_by_value",
          "filter_action_bar",
        ]}
        // dropdownMenu={true}
        width="100%"
        height="90vh"
        colHeaders={columnHeaders}
        licenseKey="non-commercial-and-evaluation" // for non-commercial use only
        // columns={columns}
      >
        {/* {...hotColumns} */}
      </HotTable>
    </div>
  );
});

export default PackTablesTableView;
