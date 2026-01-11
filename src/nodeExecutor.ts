import * as fs from "fs";
import * as path from "path";
import {
  chunkSchemaIntoRows,
  getFieldSize,
  getPacksTableData,
  readPack,
  writePack,
} from "./packFileSerializer";
import appData from "./appData";
import {
  AmendedSchemaField,
  NewPackedFile,
  SCHEMA_FIELD_TYPE,
  DBVersion,
  DBField,
  Pack,
  PackedFile,
} from "./packFileTypes";
import { format } from "date-fns";
import { gameToPackWithDBTablesName } from "./supportedGames";
import { shell } from "electron";
import { cyrb53 } from "./utility/cyrb53";
import { getDefaultTableVersions } from "./ipcMainListeners";

// Global tracking for counter transformations to ensure uniqueness across the entire flow
// Map structure: sourceColumnId -> Set of used numbers
const globalCounterTracking = new Map<string, Set<number>>();

// Reset counter tracking at the start of each flow execution
export const resetCounterTracking = () => {
  globalCounterTracking.clear();
  console.log("Counter tracking reset for new flow execution");
};

export const executeNodeAction = async (request: NodeExecutionRequest): Promise<NodeExecutionResult> => {
  const { nodeId, nodeType, textValue, inputData } = request;

  try {
    switch (nodeType) {
      case "packedfiles":
        return await executePackFilesNode(nodeId, textValue);

      case "packfilesdropdown":
        return await executePackFilesDropdownNode(nodeId, textValue);

      case "allenabledmods":
        return await executeAllEnabledModsNode(nodeId, textValue);

      case "tableselection":
        return await executeTableSelectionNode(nodeId, textValue, inputData);

      case "tableselectiondropdown":
        return await executeTableSelectionDropdownNode(nodeId, textValue, inputData);

      case "columnselection":
        return await executeColumnSelectionNode(nodeId, textValue, inputData);

      case "columnselectiondropdown":
        return await executeColumnSelectionDropdownNode(nodeId, textValue, inputData);

      case "groupbycolumns":
        return await executeGroupByColumnsNode(nodeId, textValue, inputData);

      case "filter":
        return await executeFilterNode(nodeId, textValue, inputData);

      case "multifilter":
        return await executeMultiFilterNode(nodeId, textValue, inputData);

      case "referencelookup":
        return await executeReferenceLookupNode(nodeId, textValue, inputData);

      case "reversereferencelookup":
        return await executeReverseReferenceLookupNode(nodeId, textValue, inputData);

      case "numericadjustment":
        return await executeNumericAdjustmentNode(nodeId, textValue, inputData);

      case "mathmax":
        return await executeMathMaxNode(nodeId, textValue, inputData);

      case "mathceil":
        return await executeMathCeilNode(nodeId, inputData);

      case "mergechanges":
        return await executeMergeChangesNode(nodeId, inputData);

      case "savechanges":
        return await executeSaveChangesNode(nodeId, textValue, inputData);

      case "textsurround":
        return await executeTextSurroundNode(nodeId, textValue, inputData);

      case "appendtext":
        return await executeAppendTextNode(nodeId, textValue, inputData);

      case "textjoin":
        return await executeTextJoinNode(nodeId, textValue, inputData);

      case "groupedcolumnstotext":
        return await executeGroupedColumnsToTextNode(nodeId, textValue, inputData);

      case "indextable":
        return await executeIndexTableNode(nodeId, textValue, inputData);

      case "lookup":
        return await executeLookupNode(nodeId, textValue, inputData);

      case "flattennested":
        return await executeFlattenNestedNode(nodeId, inputData);

      case "extracttable":
        return await executeExtractTableNode(nodeId, textValue, inputData);

      case "aggregatenested":
        return await executeAggregateNestedNode(nodeId, textValue, inputData);

      case "groupby":
        return await executeGroupByNode(nodeId, textValue, inputData);

      case "deduplicate":
        return await executeDeduplicateNode(nodeId, textValue, inputData);

      case "generaterows":
        return await executeGenerateRowsNode(nodeId, textValue, inputData);

      case "addnewcolumn":
        return await executeAddNewColumnNode(nodeId, textValue, inputData);

      case "dumptotsv":
        return await executeDumpToTSVNode(nodeId, textValue, inputData);

      case "getcountercolumn":
        return await executeGetCounterColumnNode(nodeId, textValue, inputData);

      case "customschema":
        return await executeCustomSchemaNode(nodeId, textValue, inputData);

      case "readtsvfrompack":
        return await executeReadTSVFromPackNode(nodeId, textValue, inputData);

      case "customrowsinput":
        return await executeCustomRowsInputNode(nodeId, textValue, inputData);

      default:
        return {
          success: false,
          error: `Unsupported node type: ${nodeType}`,
        };
    }
  } catch (error) {
    console.error(`Error executing ${nodeType} node ${nodeId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown execution error",
    };
  }
};

async function executePackFilesNode(nodeId: string, textValue: string): Promise<NodeExecutionResult> {
  console.log(`PackFiles Node ${nodeId}: Processing "${textValue}"`);

  // Parse file paths from text input
  const filePaths = textValue
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => (line.endsWith(".pack") ? line : `${line}.pack`));
  const packFiles = [] as PackFilesNodeFile[];

  for (const filePath of filePaths) {
    let foundMod = appData.enabledMods.find((mod) => mod.name == filePath);
    if (!foundMod) {
      foundMod = appData.allMods.find((mod) => mod.name == filePath);
    }

    try {
      // Check if file exists
      if (foundMod) {
        packFiles.push({
          name: path.basename(foundMod.path),
          path: foundMod.path,
          loaded: true,
        });
      } else {
        console.warn(`PackFiles Node ${nodeId}: File not found: ${filePath}`);
        packFiles.push({
          name: filePath,
          path: filePath,
          loaded: false,
          error: "File not found",
        });
      }
    } catch (error) {
      console.error(`PackFiles Node ${nodeId}: Error processing file ${filePath}:`, error);
      packFiles.push({
        name: path.basename(filePath),
        path: filePath,
        loaded: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    success: true,
    data: {
      type: "PackFiles",
      files: packFiles,
      count: packFiles.length,
      loadedCount: packFiles.filter((f) => f.loaded).length,
    } as PackFilesNodeData,
  };
}

async function executePackFilesDropdownNode(nodeId: string, textValue: string): Promise<NodeExecutionResult> {
  // Parse configuration (or use textValue directly for backwards compatibility)
  let selectedPack = "";

  try {
    const config = JSON.parse(textValue);
    selectedPack = config.selectedPack || "";
  } catch (e) {
    // If parsing fails, treat textValue as just the pack name
    selectedPack = textValue;
  }

  console.log(`PackFiles Dropdown Node ${nodeId}: Processing selected pack "${selectedPack}"`);

  const packFiles = [] as PackFilesNodeFile[];

  if (!selectedPack || selectedPack.trim() === "") {
    return {
      success: false,
      error: "No pack selected. Please select a pack from the dropdown.",
    };
  }

  try {
    // Check if selected pack is the base game pack
    const baseGamePackName = gameToPackWithDBTablesName[appData.currentGame];
    const isBaseGamePack = selectedPack === baseGamePackName;

    if (isBaseGamePack) {
      // Add base game pack directly
      const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (baseGameFolder) {
        const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
        if (fs.existsSync(baseGamePackPath)) {
          packFiles.push({
            name: baseGamePackName,
            path: baseGamePackPath,
            loaded: true,
          });
          console.log(`PackFiles Dropdown Node ${nodeId}: Added base game pack from ${baseGamePackPath}`);
        } else {
          console.warn(`PackFiles Dropdown Node ${nodeId}: Base game pack not found at ${baseGamePackPath}`);
          return {
            success: false,
            error: `Base game pack not found at ${baseGamePackPath}`,
          };
        }
      }
    } else {
      // Find the selected mod by name
      let foundMod = appData.enabledMods.find((mod) => mod.name === selectedPack);
      if (!foundMod) {
        foundMod = appData.allMods.find((mod) => mod.name === selectedPack);
      }

      if (foundMod) {
        packFiles.push({
          name: path.basename(foundMod.path),
          path: foundMod.path,
          loaded: true,
        });
      } else {
        console.warn(`PackFiles Dropdown Node ${nodeId}: Pack not found: ${selectedPack}`);
        return {
          success: false,
          error: `Pack not found: ${selectedPack}`,
        };
      }

      // Always include the base game pack when a mod is selected
      if (baseGamePackName) {
        const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
        if (baseGameFolder) {
          const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
          if (fs.existsSync(baseGamePackPath)) {
            packFiles.push({
              name: baseGamePackName,
              path: baseGamePackPath,
              loaded: true,
            });
            console.log(`PackFiles Dropdown Node ${nodeId}: Added base game pack from ${baseGamePackPath}`);
          } else {
            console.warn(
              `PackFiles Dropdown Node ${nodeId}: Base game pack not found at ${baseGamePackPath}`
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(`PackFiles Dropdown Node ${nodeId}: Error processing pack ${selectedPack}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return {
    success: true,
    data: {
      type: "PackFiles",
      files: packFiles,
      count: packFiles.length,
      loadedCount: packFiles.filter((f) => f.loaded).length,
    } as PackFilesNodeData,
  };
}

async function executeAllEnabledModsNode(nodeId: string, textValue: string): Promise<NodeExecutionResult> {
  console.log(`AllEnabledMods Node ${nodeId}: Processing all enabled mods`);

  const packFiles = [] as PackFilesNodeFile[];

  try {
    // Parse the textValue to get includeBaseGame flag
    let includeBaseGame = true;
    try {
      const config = JSON.parse(textValue);
      includeBaseGame = config.includeBaseGame !== false;
    } catch (e) {
      // If parsing fails, default to true
      includeBaseGame = true;
    }

    // Get all enabled mods from appData
    const enabledMods = appData.enabledMods;

    // Add all enabled mods to packFiles
    for (const mod of enabledMods) {
      packFiles.push({
        name: path.basename(mod.path),
        path: mod.path,
        loaded: true,
      });
    }

    // If includeBaseGame is true, add the base game pack from data folder
    if (includeBaseGame) {
      const baseGamePackName = gameToPackWithDBTablesName[appData.currentGame];
      if (baseGamePackName) {
        const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
        if (baseGameFolder) {
          const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
          if (fs.existsSync(baseGamePackPath)) {
            packFiles.push({
              name: baseGamePackName,
              path: baseGamePackPath,
              loaded: true,
            });
            console.log(`AllEnabledMods Node ${nodeId}: Added base game pack from ${baseGamePackPath}`);
          } else {
            console.warn(`AllEnabledMods Node ${nodeId}: Base game pack not found at ${baseGamePackPath}`);
          }
        }
      }
    }

    if (packFiles.length === 0) {
      console.warn(`AllEnabledMods Node ${nodeId}: No mods found (includeBaseGame: ${includeBaseGame})`);
    }

    console.log(
      `AllEnabledMods Node ${nodeId}: Found ${packFiles.length} packs (includeBaseGame: ${includeBaseGame})`
    );

    return {
      success: true,
      data: {
        type: "PackFiles",
        files: packFiles,
        count: packFiles.length,
        loadedCount: packFiles.length,
      } as PackFilesNodeData,
    };
  } catch (error) {
    console.error(`AllEnabledMods Node ${nodeId}: Error processing enabled mods:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function executeTableSelectionNode(
  nodeId: string,
  textValue: string,
  inputData: PackFilesNodeData
): Promise<NodeExecutionResult> {
  console.log(`TableSelection Node ${nodeId}: Processing "${textValue}" with input:`, inputData);

  if (!inputData || inputData.type !== "PackFiles") {
    return { success: false, error: "Invalid input: Expected PackFiles data" };
  }

  const tableNames = textValue
    .split("\n")
    .filter((line) => line.trim())
    .map((name) => name.trim())
    .map((name) => (name.startsWith("db\\") ? name : `db\\${name}`));
  const selectedTables = [] as DBTablesNodeTable[];

  for (const file of inputData.files) {
    if (!file.loaded) {
      console.warn(`Skipping unloaded file: ${file.path}`);
      continue;
    }

    try {
      // Read pack file to get table information
      const pack = await readPack(file.path, { tablesToRead: tableNames });
      getPacksTableData([pack], tableNames);

      for (const tableName of tableNames) {
        // Find tables that match the criteria
        const matchingTables = pack.packedFiles.filter((pf) => pf.name.includes(tableName));

        for (const table of matchingTables) {
          selectedTables.push({
            name: tableName,
            fileName: table.name,
            sourceFile: file,
            table,
          });
        }
      }
    } catch (error) {
      console.error(`Error reading pack file ${file.path}:`, error);
    }
  }

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: selectedTables,
      sourceFiles: inputData.files,
      tableCount: selectedTables.length,
    } as DBTablesNodeData,
  };
}

async function executeTableSelectionDropdownNode(
  nodeId: string,
  selectedTable: string,
  inputData: PackFilesNodeData
): Promise<NodeExecutionResult> {
  console.log(
    `TableSelection Dropdown Node ${nodeId}: Processing selected table "${selectedTable}" with input:`,
    inputData
  );

  if (!inputData || inputData.type !== "PackFiles") {
    return { success: false, error: "Invalid input: Expected PackFiles data" };
  }

  if (!selectedTable || selectedTable.trim() === "") {
    return {
      success: false,
      error: "No table selected. Please select a table from the dropdown.",
    };
  }

  // Convert the selected table name to the db\ format if needed
  const tableName = selectedTable.startsWith("db\\") ? selectedTable : `db\\${selectedTable}`;
  const selectedTables = [] as DBTablesNodeTable[];

  for (const file of inputData.files) {
    if (!file.loaded) {
      console.warn(`Skipping unloaded file: ${file.path}`);
      continue;
    }

    try {
      // Read pack file to get table information
      const pack = await readPack(file.path, { tablesToRead: [tableName] });
      getPacksTableData([pack], [tableName]);

      // Find tables that match the criteria
      const matchingTables = pack.packedFiles.filter((pf) => pf.name.includes(tableName));

      for (const table of matchingTables) {
        // Limit to 300 rows for easier testing
        let limitedTable = table;
        // if (table.tableSchema && table.schemaFields) {
        //   const rows = chunkSchemaIntoRows(table.schemaFields, table.tableSchema) as AmendedSchemaField[][];

        //   if (rows.length > 300) {
        //     console.log(
        //       `TableSelection Dropdown Node ${nodeId}: Limiting ${tableName} from ${rows.length} rows to 300 rows`
        //     );
        //     const limitedRows = rows.slice(0, 300);
        //     const limitedSchemaFields = limitedRows.flat();

        //     limitedTable = {
        //       ...table,
        //       schemaFields: limitedSchemaFields,
        //     };
        //   }
        // }

        selectedTables.push({
          name: tableName,
          fileName: table.name,
          sourceFile: file,
          table: limitedTable,
        });
      }
    } catch (error) {
      console.error(`Error reading pack file ${file.path}:`, error);
    }
  }

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: selectedTables,
      sourceFiles: inputData.files,
      tableCount: selectedTables.length,
    } as DBTablesNodeData,
  };
}

async function executeColumnSelectionNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`ColumnSelection Node ${nodeId}: Processing "${textValue}" with input:`, inputData);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  const selectedColumns = textValue
    .split("\n")
    .filter((line) => line.trim())
    .map((col) => col.trim());
  const columnData = [] as DBColumnSelectionTableValues[];

  for (const tableData of inputData.tables) {
    if (
      tableData.table.tableSchema &&
      tableData.table.schemaFields &&
      tableData.table.schemaFields.length != 0
    ) {
      const rows = chunkSchemaIntoRows(
        tableData.table.schemaFields,
        tableData.table.tableSchema
      ) as AmendedSchemaField[][];
      const cellData = [] as { col: string; data: string }[];
      for (const row of rows) {
        for (const cell of row) {
          if (selectedColumns.includes(cell.name)) {
            cellData.push({ col: cell.name, data: cell.resolvedKeyValue });
          }
        }
      }
      columnData.push({
        tableName: tableData.name,
        fileName: tableData.fileName,
        sourcePack: tableData.sourceFile,
        sourceTable: tableData.table,
        selectedColumns: selectedColumns,
        data: cellData,
      } as DBColumnSelectionTableValues);
    }
  }

  return {
    success: true,
    data: {
      type: "ColumnSelection",
      columns: columnData,
      sourceTables: inputData.tables,
      selectedColumnCount: columnData.reduce((sum, table) => sum + table.selectedColumns.length, 0),
    } as DBColumnSelectionNodeData,
  };
}

async function executeGroupByColumnsNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`GroupByColumns Node ${nodeId}: Processing with textValue:`, textValue);
  console.log(`GroupByColumns Node ${nodeId}: Input data:`, inputData);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse the column selections from textValue
  let column1: string;
  let column2: string;
  let onlyForMultiple: boolean = false;
  try {
    const parsed = JSON.parse(textValue);
    console.log(`GroupByColumns Node ${nodeId}: Parsed columns:`, parsed);
    column1 = parsed.column1;
    column2 = parsed.column2;
    onlyForMultiple = parsed.onlyForMultiple || false;
  } catch (error) {
    return {
      success: false,
      error: "Invalid column configuration. Expected JSON with column1 and column2 fields.",
    };
  }

  if (!column1 || column1.trim() === "" || !column2 || column2.trim() === "") {
    return {
      success: false,
      error: `Both column1 and column2 must be selected. Received: column1="${column1}", column2="${column2}"`,
    };
  }

  // Process each table
  const groupedData = new Map<string, string[]>();

  for (const tableData of inputData.tables) {
    if (
      !tableData.table.tableSchema ||
      !tableData.table.schemaFields ||
      tableData.table.schemaFields.length === 0
    ) {
      console.log(`Missing table data, skipping ${tableData.name}!`);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    // Find the column indices
    const column1Index = tableData.table.tableSchema.fields.findIndex((f) => f.name === column1);
    const column2Index = tableData.table.tableSchema.fields.findIndex((f) => f.name === column2);

    if (column1Index === -1 || column2Index === -1) {
      console.warn(
        `Columns ${column1} or ${column2} not found in table ${tableData.name}. Skipping this table.`
      );
      continue;
    }

    // Group the data
    for (const row of rows) {
      if (row.length > column1Index && row.length > column2Index) {
        const key = row[column1Index].resolvedKeyValue;
        const value = row[column2Index].resolvedKeyValue;

        if (!groupedData.has(key)) {
          groupedData.set(key, []);
        }
        groupedData.get(key)!.push(value);
      }
    }
  }

  // Filter out one-to-one mappings if onlyForMultiple is enabled
  if (onlyForMultiple) {
    console.log(`GroupByColumns Node ${nodeId}: Filtering to only include multiple values per key`);
    const filteredData = new Map<string, string[]>();
    for (const [key, values] of groupedData.entries()) {
      if (values.length > 1) {
        filteredData.set(key, values);
      }
    }
    console.log(
      `GroupByColumns Node ${nodeId}: Filtered from ${groupedData.size} to ${filteredData.size} groups`
    );
    groupedData.clear();
    for (const [key, values] of filteredData.entries()) {
      groupedData.set(key, values);
    }
  }

  // Convert map to output formats
  // Text format: Array of keys (column1 values)
  const keysArray = Array.from(groupedData.keys());

  // Text Lines format: Array of arrays containing values for each key
  const valuesArray = Array.from(groupedData.values());

  return {
    success: true,
    data: {
      type: "GroupedText",
      text: keysArray,
      textLines: valuesArray,
      groupCount: groupedData.size,
    },
  };
}

async function executeFilterNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Filter Node ${nodeId}: Processing filters with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  console.log("filter text values:", textValue);

  // Parse filters from textValue
  let filters: Array<{ column: string; value: string; not: boolean; operator: "AND" | "OR" }> = [];
  try {
    const parsed = JSON.parse(textValue);
    filters = parsed.filters || [];
  } catch (error) {
    console.error(`Filter Node ${nodeId}: Error parsing filters:`, error);
    return { success: false, error: "Invalid filter configuration" };
  }

  if (filters.length === 0 || !filters[0].column || !filters[0].value) {
    // No filters configured, return all data unchanged
    console.log(`Filter Node ${nodeId}: No filters configured, passing through all data`);
    return {
      success: true,
      data: inputData,
    };
  }

  console.log(
    `Filter Node ${nodeId}: Applying ${filters.length} filters to ${inputData.tables.length} table(s)`
  );

  // Create a filtered version of the input data
  const filteredData: DBTablesNodeData = {
    ...inputData,
    tables: [],
  };

  // Process each table
  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      // Skip tables without schema
      filteredData.tables.push(tableData);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    console.log(`Filter Node ${nodeId}: Processing table "${tableData.name}" with ${rows.length} rows`);

    // Filter rows based on the filter configuration
    const filteredRows = rows.filter((row) => {
      // Evaluate each filter
      const filterResults: boolean[] = [];

      for (const filter of filters) {
        if (!filter.column) {
          filterResults.push(true);
          continue;
        }

        // Find the cell with matching column name
        const cell = row.find((c) => c.name === filter.column);
        if (!cell) {
          filterResults.push(true); // Column not found, skip filter
          continue;
        }

        const cellValue = cell.resolvedKeyValue || "";
        const filterValue = filter.value;

        // Perform the comparison (case-insensitive contains)
        let matches = String(cellValue).toLowerCase() == filterValue.toLowerCase();

        // Apply NOT if specified
        if (filter.not) {
          matches = !matches;
        }

        filterResults.push(matches);
      }

      // Combine filter results based on operators
      if (filterResults.length === 0) return true;

      let result = filterResults[0];
      for (let i = 1; i < filterResults.length; i++) {
        const operator = filters[i - 1].operator;
        if (operator === "AND") {
          result = result && filterResults[i];
        } else {
          result = result || filterResults[i];
        }
      }

      return result;
    });

    console.log(
      `Filter Node ${nodeId}: ${filteredRows.length} rows passed filters out of ${rows.length} in table "${tableData.name}"`
    );

    // Flatten filtered rows back into schemaFields array
    const filteredSchemaFields: AmendedSchemaField[] = [];
    for (const row of filteredRows) {
      filteredSchemaFields.push(...row);
    }

    // Create a new table with filtered data
    const filteredTableData = {
      ...tableData,
      table: {
        ...tableData.table,
        schemaFields: filteredSchemaFields,
      },
    };

    filteredData.tables.push(filteredTableData);
  }

  filteredData.tableCount = filteredData.tables.length;

  // Also create the inverse data (non-matching rows) for the "else" handle
  const elseData: DBTablesNodeData = {
    ...inputData,
    tables: [],
  };

  // Process each table to get non-matching rows
  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      // Skip tables without schema
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    // Filter rows that DON'T match (inverse of the match filter)
    const elseRows = rows.filter((row) => {
      // Evaluate each filter
      const filterResults: boolean[] = [];

      for (const filter of filters) {
        if (!filter.column) {
          filterResults.push(true);
          continue;
        }

        // Find the cell with matching column name
        const cell = row.find((c) => c.name === filter.column);
        if (!cell) {
          filterResults.push(true); // Column not found, skip filter
          continue;
        }

        const cellValue = cell.resolvedKeyValue || "";
        const filterValue = filter.value;

        // Perform the comparison (case-insensitive contains)
        let matches = String(cellValue).toLowerCase() == filterValue.toLowerCase();

        // Apply NOT if specified
        if (filter.not) {
          matches = !matches;
        }

        filterResults.push(matches);
      }

      // Combine filter results based on operators
      if (filterResults.length === 0) return false; // No match = goes to else

      let result = filterResults[0];
      for (let i = 1; i < filterResults.length; i++) {
        const operator = filters[i - 1].operator;
        if (operator === "AND") {
          result = result && filterResults[i];
        } else {
          result = result || filterResults[i];
        }
      }

      // Return the INVERSE for else output
      return !result;
    });

    if (elseRows.length > 0) {
      // Flatten else rows back into schemaFields array
      const elseSchemaFields: AmendedSchemaField[] = [];
      for (const row of elseRows) {
        elseSchemaFields.push(...row);
      }

      // Create a new table with else data
      const elseTableData = {
        ...tableData,
        table: {
          ...tableData.table,
          schemaFields: elseSchemaFields,
        },
      };

      elseData.tables.push(elseTableData);
    }
  }

  elseData.tableCount = elseData.tables.length;

  console.log(
    `Filter Node ${nodeId}: Match output has ${filteredData.tableCount} tables, Else output has ${elseData.tableCount} tables`
  );

  // Return both outputs - the executor will select the correct one based on the connection handle
  return {
    success: true,
    data: filteredData,
    elseData: elseData, // Add the else output
  };
}

async function executeMultiFilterNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Multi-Filter Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse configuration from textValue
  let selectedColumn = "";
  let splitValues: Array<{ id: string; value: string; enabled: boolean }> = [];

  try {
    const parsed = JSON.parse(textValue);
    selectedColumn = parsed.selectedColumn || "";
    splitValues = parsed.splitValues || [];
  } catch (error) {
    console.error(`Multi-Filter Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid multi-filter configuration" };
  }

  if (!selectedColumn) {
    console.log(`Multi-Filter Node ${nodeId}: No column selected, returning empty outputs`);
    return {
      success: true,
      data: {},
    };
  }

  // Filter to only enabled split values
  const enabledSplitValues = splitValues.filter((s) => s.enabled && s.value.trim() !== "");

  if (enabledSplitValues.length === 0) {
    console.log(`Multi-Filter Node ${nodeId}: No enabled split values, returning empty outputs`);
    return {
      success: true,
      data: {},
    };
  }

  console.log(
    `Multi-Filter Node ${nodeId}: Splitting by column "${selectedColumn}" into ${enabledSplitValues.length} outputs:`,
    enabledSplitValues.map((s) => s.value)
  );

  // Create output data for each split value
  const multiOutputs: Record<string, DBTablesNodeData> = {};

  for (const splitValue of enabledSplitValues) {
    // Sanitize handle ID to match UI (avoid special characters)
    const outputKey = `output-${splitValue.value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    multiOutputs[outputKey] = {
      type: "TableSelection",
      tables: [],
      sourceFiles: inputData.sourceFiles || [],
      tableCount: 0,
    };
  }

  // Process each table
  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      // Skip tables without schema
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    console.log(`Multi-Filter Node ${nodeId}: Processing table "${tableData.name}" with ${rows.length} rows`);

    // Group rows by the column value
    const rowsByValue = new Map<string, AmendedSchemaField[][]>();

    for (const row of rows) {
      const cell = row.find((c) => c.name === selectedColumn);
      if (cell) {
        const cellValue = String(cell.resolvedKeyValue || "");

        // Check if this value matches any of our split values
        for (const splitValue of enabledSplitValues) {
          if (cellValue === splitValue.value) {
            if (!rowsByValue.has(splitValue.value)) {
              rowsByValue.set(splitValue.value, []);
            }
            rowsByValue.get(splitValue.value)!.push(row);
            break; // Only add to first matching split value
          }
        }
      }
    }

    // Create output tables for each split value
    for (const splitValue of enabledSplitValues) {
      // Sanitize handle ID to match UI (avoid special characters)
      const outputKey = `output-${splitValue.value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      const matchingRows = rowsByValue.get(splitValue.value) || [];

      if (matchingRows.length > 0) {
        // Flatten rows back into schemaFields array
        const schemaFields: AmendedSchemaField[] = [];
        for (const row of matchingRows) {
          schemaFields.push(...row);
        }

        // Create a new table with filtered data
        const filteredTableData = {
          ...tableData,
          table: {
            ...tableData.table,
            schemaFields: schemaFields,
          },
        };

        multiOutputs[outputKey].tables.push(filteredTableData);
      }

      console.log(
        `Multi-Filter Node ${nodeId}: Output "${outputKey}" has ${matchingRows.length} rows from table "${tableData.name}"`
      );
    }
  }

  // Update table counts for each output
  for (const outputKey of Object.keys(multiOutputs)) {
    multiOutputs[outputKey].tableCount = multiOutputs[outputKey].tables.length;
  }

  console.log(
    `Multi-Filter Node ${nodeId}: Created ${Object.keys(multiOutputs).length} outputs:`,
    Object.keys(multiOutputs).map((key) => `${key} (${multiOutputs[key].tableCount} tables)`)
  );

  // Return multi-output format (same as generaterows - outputs in data field)
  return {
    success: true,
    data: multiOutputs,
  };
}

async function executeReferenceLookupNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Reference Lookup Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse selected reference table from textValue
  let selectedReferenceTable = "";
  try {
    const parsed = JSON.parse(textValue);
    selectedReferenceTable = parsed.selectedReferenceTable || "";
  } catch (error) {
    console.error(`Reference Lookup Node ${nodeId}: Error parsing textValue:`, error);
    return { success: false, error: "Invalid node configuration" };
  }

  if (!selectedReferenceTable || selectedReferenceTable.trim() === "") {
    console.log(`Reference Lookup Node ${nodeId}: No reference table selected, returning empty result`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.sourceFiles || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  console.log(
    `Reference Lookup Node ${nodeId}: Looking up references to table "${selectedReferenceTable}" from ${inputData.tables.length} input table(s)`
  );

  // Collect all reference values from the input tables
  const referenceValues = new Set<string>();

  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      console.warn(`Reference Lookup Node ${nodeId}: Skipping table "${tableData.name}" - no schema`);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    // Find columns that reference the selected table
    // is_reference is an array where [0] is the referenced table name
    const referenceColumns = tableData.table.tableSchema.fields.filter(
      (field) =>
        field.is_reference &&
        field.is_reference.length > 0 &&
        field.is_reference[0] === selectedReferenceTable
    );

    console.log(
      `Reference Lookup Node ${nodeId}: Found ${referenceColumns.length} reference column(s) in table "${tableData.name}"`
    );

    // Extract reference values from those columns
    for (const refColumn of referenceColumns) {
      const columnName = refColumn.name;

      for (const row of rows) {
        const cell = row.find((c) => c.name === columnName);
        if (cell && cell.resolvedKeyValue) {
          const value = String(cell.resolvedKeyValue).trim();
          if (value) {
            referenceValues.add(value);
          }
        }
      }
    }
  }

  console.log(`Reference Lookup Node ${nodeId}: Collected ${referenceValues.size} unique reference value(s)`);

  if (referenceValues.size === 0) {
    console.log(`Reference Lookup Node ${nodeId}: No reference values found, returning empty result`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.sourceFiles || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  // Search for tables matching the reference table name in all source files
  const referencedTables = [] as DBTablesNodeTable[];

  // Pack files use the full table name including "_tables" suffix
  const tableNameToSearch = selectedReferenceTable.startsWith("db\\")
    ? selectedReferenceTable
    : `db\\${selectedReferenceTable}`;

  for (const sourceFile of inputData.sourceFiles || []) {
    if (!sourceFile.loaded) {
      console.warn(`Reference Lookup Node ${nodeId}: Skipping unloaded file: ${sourceFile.path}`);
      continue;
    }

    try {
      // Read the pack file to get the referenced table
      const pack = await readPack(sourceFile.path, { tablesToRead: [tableNameToSearch] });
      getPacksTableData([pack], [tableNameToSearch]);

      // Find tables that match the reference table name exactly
      // Match db\land_units or db\land_units\!variant but NOT db\land_units_to_something
      console.log(
        `Reference Lookup Node ${nodeId}: Pack ${sourceFile.name} has ${pack.packedFiles.length} packed files`
      );

      // Show sample file names to debug
      const dbFiles = pack.packedFiles.filter((pf) => pf.name.toLowerCase().includes("db\\"));
      if (dbFiles.length > 0) {
        console.log(
          `Reference Lookup Node ${nodeId}: Sample DB files (${dbFiles.length} total):`,
          dbFiles.slice(0, 5).map((pf) => pf.name)
        );
      }

      const matchingTables = pack.packedFiles.filter((pf) => {
        const tablePath = pf.name.toLowerCase();
        const searchPath = tableNameToSearch.toLowerCase();

        // Check if path matches exactly or starts with searchPath followed by backslash
        const matches = tablePath === searchPath || tablePath.startsWith(searchPath + "\\");

        if (matches) {
          console.log(`Reference Lookup Node ${nodeId}: Matched table: ${pf.name}`);
        }

        return matches;
      });

      for (const table of matchingTables) {
        referencedTables.push({
          name: tableNameToSearch,
          fileName: table.name,
          sourceFile: sourceFile,
          table,
        });
      }
    } catch (error) {
      console.error(`Reference Lookup Node ${nodeId}: Error reading pack file ${sourceFile.path}:`, error);
    }
  }

  console.log(
    `Reference Lookup Node ${nodeId}: Found ${referencedTables.length} table(s) matching "${selectedReferenceTable}"`
  );

  // Filter the referenced tables to only include rows with matching key values
  const filteredReferencedTables: DBTablesNodeData = {
    type: "TableSelection",
    tables: [],
    sourceFiles: inputData.sourceFiles || [],
    tableCount: 0,
  };

  for (const tableData of referencedTables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      // No schema, include the whole table
      filteredReferencedTables.tables.push(tableData);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    // Find the key column (usually the first column or a column with is_key=true)
    const keyField =
      tableData.table.tableSchema.fields.find((field) => field.is_key) ||
      tableData.table.tableSchema.fields[0];

    if (!keyField) {
      console.warn(
        `Reference Lookup Node ${nodeId}: No key field found in table "${tableData.name}", skipping`
      );
      continue;
    }

    const keyColumnName = keyField.name;
    console.log(
      `Reference Lookup Node ${nodeId}: Using key column "${keyColumnName}" in table "${tableData.name}"`
    );

    // Filter rows where the key column value is in our reference values set
    const filteredRows = rows.filter((row) => {
      const keyCell = row.find((c) => c.name === keyColumnName);
      if (!keyCell) return false;

      const keyValue = String(keyCell.resolvedKeyValue || "").trim();
      return referenceValues.has(keyValue);
    });

    console.log(
      `Reference Lookup Node ${nodeId}: ${filteredRows.length} row(s) matched out of ${rows.length} in table "${tableData.name}"`
    );

    if (filteredRows.length > 0) {
      // Flatten filtered rows back into schemaFields array
      const filteredSchemaFields: AmendedSchemaField[] = [];
      for (const row of filteredRows) {
        filteredSchemaFields.push(...row);
      }

      // Create a new table with filtered data
      const filteredTableData = {
        ...tableData,
        table: {
          ...tableData.table,
          schemaFields: filteredSchemaFields,
        },
      };

      filteredReferencedTables.tables.push(filteredTableData);
    }
  }

  filteredReferencedTables.tableCount = filteredReferencedTables.tables.length;

  console.log(
    `Reference Lookup Node ${nodeId}: Returning ${filteredReferencedTables.tableCount} filtered table(s)`
  );

  return {
    success: true,
    data: filteredReferencedTables,
  };
}

async function executeReverseReferenceLookupNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Reverse Reference Lookup Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse selected reverse table from textValue
  let selectedReverseTable = "";
  try {
    const parsed = JSON.parse(textValue);
    selectedReverseTable = parsed.selectedReverseTable || "";
  } catch (error) {
    console.error(`Reverse Reference Lookup Node ${nodeId}: Error parsing textValue:`, error);
    return { success: false, error: "Invalid node configuration" };
  }

  // Get the input table name to find reverse references
  let inputTableName = "";
  if (inputData.tables.length > 0) {
    inputTableName = inputData.tables[0].name.replace(/^db\\/, "").replace(/\\.*$/, "");
  }

  // If no reverse table is selected, try to auto-select if there's only one option
  if ((!selectedReverseTable || selectedReverseTable.trim() === "") && inputTableName) {
    console.log(
      `Reverse Reference Lookup Node ${nodeId}: No reverse table selected, checking for auto-selection for input table "${inputTableName}"`
    );

    // Find all tables that have fields referencing the input table
    const reverseTableOptions = new Set<string>();

    for (const sourceFile of inputData.sourceFiles || []) {
      if (!sourceFile.loaded) continue;

      try {
        // Read the pack without parsing tables to get the list of table names
        const pack = await readPack(sourceFile.path, { skipParsingTables: true });

        // Get all unique db table names (base names without variants)
        const dbTableNames = new Set<string>();
        for (const packedFile of pack.packedFiles) {
          if (packedFile.name.startsWith("db\\")) {
            const baseTableName = packedFile.name.replace(/^db\\/, "").replace(/\\.*$/, "");
            dbTableNames.add(baseTableName);
          }
        }

        console.log(
          `Reverse Reference Lookup Node ${nodeId}: Found ${dbTableNames.size} potential table(s) in ${sourceFile.name}`
        );

        // Now read each table's schema to check if it references the input table
        for (const tableName of dbTableNames) {
          try {
            const tableNameToRead = `db\\${tableName}`;
            const packWithTable = await readPack(sourceFile.path, { tablesToRead: [tableNameToRead] });
            getPacksTableData([packWithTable], [tableNameToRead]);

            // Check the packed files for schema information
            for (const packedFile of packWithTable.packedFiles) {
              if (packedFile.name.startsWith(tableNameToRead) && packedFile.tableSchema) {
                // Check if this table has any fields that reference the input table
                const hasReferenceToInput = packedFile.tableSchema.fields.some(
                  (field) =>
                    field.is_reference &&
                    field.is_reference.length > 0 &&
                    field.is_reference[0] === inputTableName
                );

                if (hasReferenceToInput) {
                  reverseTableOptions.add(tableName);
                  console.log(
                    `Reverse Reference Lookup Node ${nodeId}: Table "${tableName}" has references to "${inputTableName}"`
                  );
                  break; // Found reference in this table, no need to check other variants
                }
              }
            }
          } catch (error) {
            // Silently skip tables that fail to read (they might not exist in this pack)
          }
        }
      } catch (error) {
        console.error(
          `Reverse Reference Lookup Node ${nodeId}: Error reading pack ${sourceFile.path} for auto-selection:`,
          error
        );
      }
    }

    console.log(
      `Reverse Reference Lookup Node ${nodeId}: Found ${reverseTableOptions.size} table(s) that reference "${inputTableName}":`,
      Array.from(reverseTableOptions)
    );

    if (reverseTableOptions.size === 1) {
      selectedReverseTable = Array.from(reverseTableOptions)[0];
      console.log(
        `Reverse Reference Lookup Node ${nodeId}: Auto-selected only available reverse table: "${selectedReverseTable}"`
      );
    } else if (reverseTableOptions.size === 0) {
      console.log(
        `Reverse Reference Lookup Node ${nodeId}: No tables reference "${inputTableName}", returning empty result`
      );
      return {
        success: true,
        data: {
          type: "TableSelection",
          tables: [],
          sourceFiles: inputData.sourceFiles || [],
          tableCount: 0,
        } as DBTablesNodeData,
      };
    }
  }

  if (!selectedReverseTable || selectedReverseTable.trim() === "") {
    console.log(`Reverse Reference Lookup Node ${nodeId}: No reverse table selected, returning empty result`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.sourceFiles || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  console.log(
    `Reverse Reference Lookup Node ${nodeId}: Finding rows in "${selectedReverseTable}" that reference ${inputData.tables.length} input table(s)`
  );

  // Collect all key values from the input tables
  const inputKeyValues = new Set<string>();

  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      console.warn(`Reverse Reference Lookup Node ${nodeId}: Skipping table "${tableData.name}" - no schema`);
      continue;
    }

    // Get the table name (without db\ prefix and variants)
    if (!inputTableName) {
      inputTableName = tableData.name.replace(/^db\\/, "").replace(/\\.*$/, "");
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    // Find key columns (columns marked as is_key)
    const keyColumns = tableData.table.tableSchema.fields.filter((field) => field.is_key);

    // Extract key values from those columns
    for (const keyColumn of keyColumns) {
      const columnName = keyColumn.name;

      for (const row of rows) {
        const cell = row.find((c) => c.name === columnName);
        if (cell && cell.resolvedKeyValue) {
          const value = String(cell.resolvedKeyValue).trim();
          if (value) {
            inputKeyValues.add(value);
          }
        }
      }
    }
  }

  console.log(
    `Reverse Reference Lookup Node ${nodeId}: Collected ${inputKeyValues.size} unique key value(s) from input`
  );

  if (inputKeyValues.size === 0) {
    console.log(
      `Reverse Reference Lookup Node ${nodeId}: No key values found in input, returning empty result`
    );
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.sourceFiles || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  // Search for the reverse table in all source files
  const reverseTables = [] as DBTablesNodeTable[];

  const tableNameToSearch = selectedReverseTable.startsWith("db\\")
    ? selectedReverseTable
    : `db\\${selectedReverseTable}`;

  for (const sourceFile of inputData.sourceFiles || []) {
    if (!sourceFile.loaded) {
      console.warn(`Reverse Reference Lookup Node ${nodeId}: Skipping unloaded file: ${sourceFile.path}`);
      continue;
    }

    try {
      const pack = await readPack(sourceFile.path, { tablesToRead: [tableNameToSearch] });
      getPacksTableData([pack], [tableNameToSearch]);

      for (const packedFile of pack.packedFiles) {
        if (
          packedFile.name.startsWith(tableNameToSearch) &&
          packedFile.schemaFields &&
          packedFile.tableSchema
        ) {
          reverseTables.push({
            table: packedFile,
            name: packedFile.name,
            fileName: packedFile.name,
            sourceFile: pack,
          });
        }
      }
    } catch (error) {
      console.error(`Reverse Reference Lookup Node ${nodeId}: Error reading pack ${sourceFile.path}:`, error);
    }
  }

  console.log(
    `Reverse Reference Lookup Node ${nodeId}: Found ${reverseTables.length} table(s) from pack files`
  );

  const filteredReverseTables: DBTablesNodeData = {
    type: "TableSelection",
    tables: [],
    sourceFiles: inputData.sourceFiles || [],
    tableCount: 0,
  };

  // Filter rows in reverse tables that reference the input tables
  for (const tableData of reverseTables) {
    if (!tableData.table.schemaFields) {
      console.log(`tableData.table.schemaFields is undefined for table "${tableData.name}", skipping`);
      continue;
    }

    if (!tableData.table.tableSchema) {
      console.log(`tableData.table.tableSchema is undefined for table "${tableData.name}", skipping`);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    // Find columns that reference the input table
    const referenceColumns = tableData.table.tableSchema.fields.filter(
      (field) =>
        field.is_reference && field.is_reference.length > 0 && field.is_reference[0] === inputTableName
    );

    if (referenceColumns.length === 0) {
      console.log(
        `Reverse Reference Lookup Node ${nodeId}: No reference columns found in "${tableData.name}" pointing to "${inputTableName}"`
      );
      continue;
    }

    console.log(
      `Reverse Reference Lookup Node ${nodeId}: Found ${referenceColumns.length} reference column(s) in "${tableData.name}"`
    );

    // Filter rows where reference column values match input key values
    const filteredRows = rows.filter((row) => {
      for (const refColumn of referenceColumns) {
        const cell = row.find((c) => c.name === refColumn.name);
        if (cell && cell.resolvedKeyValue) {
          const refValue = String(cell.resolvedKeyValue).trim();
          if (inputKeyValues.has(refValue)) {
            return true;
          }
        }
      }
      return false;
    });

    console.log(
      `Reverse Reference Lookup Node ${nodeId}: ${filteredRows.length} row(s) matched out of ${rows.length} in table "${tableData.name}"`
    );

    if (filteredRows.length > 0) {
      const filteredSchemaFields: AmendedSchemaField[] = [];
      for (const row of filteredRows) {
        filteredSchemaFields.push(...row);
      }

      const filteredTableData = {
        ...tableData,
        table: {
          ...tableData.table,
          schemaFields: filteredSchemaFields,
        },
      };

      filteredReverseTables.tables.push(filteredTableData);
    }
  }

  filteredReverseTables.tableCount = filteredReverseTables.tables.length;

  console.log(
    `Reverse Reference Lookup Node ${nodeId}: Returning ${filteredReverseTables.tableCount} filtered table(s)`
  );

  return {
    success: true,
    data: filteredReverseTables,
  };
}

// Formula evaluation function
function evaluateFormula(formula: string, x: number): number {
  // console.log(`Evaluating formula: "${formula}" with x=${x}`);

  // Sanitize the formula - only allow safe mathematical operations
  const sanitized = formula
    .replace(/\s+/g, "") // Remove whitespace
    .replace(/\^/g, "**") // Convert ^ to ** for exponentiation
    .replace(/[^x0-9+\-*/().\s]/g, ""); // Remove any unsafe characters

  // Replace 'x' with the actual value
  const expression = sanitized.replace(/x/g, x.toString());

  // Validate that the expression only contains safe characters
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error("Invalid formula: contains unsafe characters");
  }

  try {
    // Use Function constructor for safe evaluation (better than eval)
    const result = new Function("return " + expression)();

    if (typeof result !== "number" || isNaN(result) || !isFinite(result)) {
      throw new Error("Formula evaluation resulted in invalid number");
    }

    return result;
  } catch (error) {
    throw new Error(`Formula evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

async function executeColumnSelectionDropdownNode(
  nodeId: string,
  selectedColumn: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(
    `ColumnSelection Dropdown Node ${nodeId}: Processing selected column "${selectedColumn}" with num input tables:`,
    inputData.tables.length,
    `table names:`,
    inputData.tables.map((t) => t.name)
  );

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  if (!selectedColumn || selectedColumn.trim() === "") {
    return {
      success: false,
      error: "No column selected. Please select a column from the dropdown.",
    };
  }

  const selectedColumns = [selectedColumn.trim()];
  const columnData = [] as DBColumnSelectionTableValues[];

  for (const tableData of inputData.tables) {
    if (
      tableData.table.tableSchema &&
      tableData.table.schemaFields &&
      tableData.table.schemaFields.length != 0
    ) {
      const rows = chunkSchemaIntoRows(
        tableData.table.schemaFields,
        tableData.table.tableSchema
      ) as AmendedSchemaField[][];
      const cellData = [] as { col: string; data: string }[];
      for (const row of rows) {
        for (const cell of row) {
          if (selectedColumns.includes(cell.name)) {
            cellData.push({ col: cell.name, data: cell.resolvedKeyValue });
          }
        }
      }
      columnData.push({
        tableName: tableData.name,
        fileName: tableData.fileName,
        sourcePack: tableData.sourceFile,
        sourceTable: tableData.table,
        selectedColumns: selectedColumns,
        data: cellData,
      } as DBColumnSelectionTableValues);
    }
  }

  return {
    success: true,
    data: {
      type: "ColumnSelection",
      columns: columnData,
      sourceTables: inputData.tables,
      selectedColumnCount: columnData.reduce((sum, table) => sum + table.selectedColumns.length, 0),
    } as DBColumnSelectionNodeData,
  };
}

async function executeNumericAdjustmentNode(
  nodeId: string,
  textValue: string,
  inputData: DBColumnSelectionNodeData
): Promise<NodeExecutionResult> {
  console.log(`NumericAdjustment Node ${nodeId}: Processing formula "${textValue}" with input:`, {
    columnCount: inputData?.columns?.length,
    selectedColumnCount: inputData?.selectedColumnCount,
  });

  if (!inputData || inputData.type !== "ColumnSelection") {
    return { success: false, error: "Invalid input: Expected ColumnSelection data" };
  }

  const formula = textValue.trim();

  if (!formula) {
    return {
      success: false,
      error: "No formula provided. Enter a mathematical expression using x as the input variable.",
    };
  }

  // Validate that the formula contains 'x' variable
  if (!formula.includes("x")) {
    return {
      success: false,
      error: "Formula must contain variable x representing the input value.",
    };
  }

  // Test the formula with a sample value to check for syntax errors
  try {
    evaluateFormula(formula, 1);
  } catch (error) {
    return {
      success: false,
      error: `Invalid formula: ${error instanceof Error ? error.message : "Syntax error"}`,
    };
  }

  // Apply formula to numeric columns
  const adjustedInputData = structuredClone(inputData);

  for (const column of adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) {
      console.log("MISSING SCHEMA!");
      continue;
    }
    console.log("selected columns:", column.selectedColumns);

    const rows = chunkSchemaIntoRows(
      column.sourceTable.schemaFields,
      column.sourceTable.tableSchema
    ) as AmendedSchemaField[][];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        // newTable[i][j] = cell;
        if (column.selectedColumns.includes(cell.name)) {
          const numVal = parseFloat(cell.resolvedKeyValue.replace(/[^\d.-]/g, ""));
          if (isNaN(numVal)) {
            console.log("Not a number!");
            continue; // Keep non-numeric values as-is
          }

          try {
            const result = evaluateFormula(formula, numVal);
            rows[i][j].resolvedKeyValue = result.toString();
            rows[i][j].fields[0].val = result;
            // console.log("New numeric value of", numVal, "is", result.toString());
          } catch (error) {
            console.warn(`Failed to apply formula to value ${numVal}:`, error);
          }
        }
      }
    }

    column.sourceTable.schemaFields = rows.flat();
  }

  return {
    success: true,
    data: {
      type: "ChangedColumnSelection",
      adjustedInputData: adjustedInputData,
      appliedFormula: formula,
      originalData: inputData,
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeMathMaxNode(
  nodeId: string,
  textValue: string,
  inputData: DBNumericAdjustmentNodeData
): Promise<NodeExecutionResult> {
  console.log(`MathMax Node ${nodeId}: Processing with value "${textValue}" and input:`, {
    "num adjustedInputData columns": inputData?.adjustedInputData.columns?.length,
    "num originalData columns": inputData?.originalData.columns?.length,
  });

  if (!inputData || inputData.type !== "ChangedColumnSelection") {
    return { success: false, error: "Invalid input: Expected ChangedColumnSelection data" };
  }

  const maxValue = parseFloat(textValue.trim());

  if (isNaN(maxValue)) {
    return {
      success: false,
      error: "Invalid value. Please enter a valid number.",
    };
  }

  // Apply Math.max to numeric columns
  const adjustedInputData = structuredClone(inputData.adjustedInputData);

  for (const column of adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) {
      console.log("MISSING SCHEMA!");
      continue;
    }

    const rows = chunkSchemaIntoRows(
      column.sourceTable.schemaFields,
      column.sourceTable.tableSchema
    ) as AmendedSchemaField[][];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (column.selectedColumns.includes(cell.name)) {
          const numVal = parseFloat(cell.resolvedKeyValue.replace(/[^\d.-]/g, ""));
          if (isNaN(numVal)) {
            console.log("Not a number!");
            continue; // Keep non-numeric values as-is
          }

          const result = Math.max(numVal, maxValue);
          rows[i][j].resolvedKeyValue = result.toString();
          rows[i][j].fields[0].val = result;
        }
      }
    }

    column.sourceTable.schemaFields = rows.flat();
  }

  return {
    success: true,
    data: {
      type: "ChangedColumnSelection",
      adjustedInputData: adjustedInputData,
      appliedFormula: `Math.max(x, ${maxValue})`,
      originalData: inputData.originalData,
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeMathCeilNode(
  nodeId: string,
  inputData: DBNumericAdjustmentNodeData
): Promise<NodeExecutionResult> {
  console.log(`MathCeil Node ${nodeId}: Processing with input:`, {
    "num adjustedInputData columns": inputData?.adjustedInputData.columns?.length,
    "num originalData columns": inputData?.originalData.columns?.length,
  });

  if (!inputData || inputData.type !== "ChangedColumnSelection") {
    return { success: false, error: "Invalid input: Expected ChangedColumnSelection data" };
  }

  // Apply Math.ceil to numeric columns
  const adjustedInputData = structuredClone(inputData.adjustedInputData);

  for (const column of adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) {
      console.log("MISSING SCHEMA!");
      continue;
    }

    const rows = chunkSchemaIntoRows(
      column.sourceTable.schemaFields,
      column.sourceTable.tableSchema
    ) as AmendedSchemaField[][];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (column.selectedColumns.includes(cell.name)) {
          const numVal = parseFloat(cell.resolvedKeyValue.replace(/[^\d.-]/g, ""));
          if (isNaN(numVal)) {
            console.log("Not a number!");
            continue; // Keep non-numeric values as-is
          }

          const result = Math.ceil(numVal);
          rows[i][j].resolvedKeyValue = result.toString();
          rows[i][j].fields[0].val = result;
        }
      }
    }

    column.sourceTable.schemaFields = rows.flat();
  }

  return {
    success: true,
    data: {
      type: "ChangedColumnSelection",
      adjustedInputData: adjustedInputData,
      appliedFormula: `Math.ceil(x)`,
      originalData: inputData.originalData,
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeMergeChangesNode(
  nodeId: string,
  inputData: DBNumericAdjustmentNodeData | DBNumericAdjustmentNodeData[]
): Promise<NodeExecutionResult> {
  console.log(`MergeChanges Node ${nodeId}: Merging multiple ChangedColumnSelection inputs`);

  // Convert single input to array for uniform handling
  const inputs = Array.isArray(inputData) ? inputData : [inputData];

  // Validate all inputs are ChangedColumnSelection
  for (let i = 0; i < inputs.length; i++) {
    if (!inputs[i] || inputs[i].type !== "ChangedColumnSelection") {
      return {
        success: false,
        error: `Invalid input at index ${i}: Expected ChangedColumnSelection data`,
      };
    }
  }

  if (inputs.length === 0) {
    return {
      success: false,
      error: "No inputs to merge. Connect at least one ChangedColumnSelection node.",
    };
  }

  // Start with a deep clone of the first input as the base
  const mergedData = structuredClone(inputs[0].adjustedInputData);

  // Merge all subsequent inputs
  for (let i = 1; i < inputs.length; i++) {
    const currentInput = inputs[i].adjustedInputData;

    // For each table in the current input, merge with the corresponding table in mergedData
    for (const currentColumn of currentInput.columns) {
      // Find if this table already exists in mergedData
      const existingColumn = mergedData.columns.find(
        (col) =>
          col.tableName === currentColumn.tableName &&
          col.fileName === currentColumn.fileName &&
          col.sourcePack.path === currentColumn.sourcePack.path
      );

      if (existingColumn) {
        // Merge the changes from currentColumn into existingColumn
        // Update the schemaFields to reflect the changes from the current input
        if (
          currentColumn.sourceTable.schemaFields &&
          existingColumn.sourceTable.schemaFields &&
          currentColumn.sourceTable.tableSchema &&
          existingColumn.sourceTable.tableSchema
        ) {
          // Merge schemaFields row by row
          const currentRows = chunkSchemaIntoRows(
            currentColumn.sourceTable.schemaFields,
            currentColumn.sourceTable.tableSchema
          ) as AmendedSchemaField[][];

          const existingRows = chunkSchemaIntoRows(
            existingColumn.sourceTable.schemaFields,
            existingColumn.sourceTable.tableSchema
          ) as AmendedSchemaField[][];

          // Update cells in existingRows with values from currentRows if they were changed
          for (let rowIdx = 0; rowIdx < currentRows.length && rowIdx < existingRows.length; rowIdx++) {
            for (let cellIdx = 0; cellIdx < currentRows[rowIdx].length; cellIdx++) {
              const currentCell = currentRows[rowIdx][cellIdx];
              const existingCell = existingRows[rowIdx][cellIdx];

              // If this column was selected in the current input, update the existing data
              if (currentColumn.selectedColumns.includes(currentCell.name)) {
                existingCell.resolvedKeyValue = currentCell.resolvedKeyValue;
                existingCell.fields[0].val = currentCell.fields[0].val;
              }
            }
          }

          // Flatten back to schemaFields
          existingColumn.sourceTable.schemaFields = existingRows.flat();
        }

        // Merge selectedColumns
        for (const col of currentColumn.selectedColumns) {
          if (!existingColumn.selectedColumns.includes(col)) {
            existingColumn.selectedColumns.push(col);
          }
        }

        // Merge data array
        for (const newData of currentColumn.data) {
          const existingData = existingColumn.data.find((d) => d.col === newData.col);
          if (existingData) {
            existingData.data = newData.data;
          } else {
            existingColumn.data.push(newData);
          }
        }
      } else {
        // This table doesn't exist in mergedData yet, add it
        mergedData.columns.push(structuredClone(currentColumn));
      }
    }
  }

  console.log(`MergeChanges Node ${nodeId}: Successfully merged ${inputs.length} input(s)`);

  return {
    success: true,
    data: {
      type: "ChangedColumnSelection",
      adjustedInputData: mergedData,
      appliedFormula: `Merged ${inputs.length} inputs`,
      originalData: inputs[0].originalData, // Use the first input's original data
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeSaveTextNode(
  nodeId: string,
  textContent: string,
  packName: string,
  packedFileName: string
): Promise<NodeExecutionResult> {
  console.log(
    `SaveText Node ${nodeId}: Saving text file with packName="${packName}", packedFileName="${packedFileName}"`
  );

  try {
    const nodePath = await import("path");
    const { format } = await import("date-fns");

    // Generate default names if not provided
    const timestamp = format(new Date(), "ddMMyy_HHmmss");
    const packFileBaseName = packName || `textflow_${timestamp}`;
    const textFileName = packedFileName || `output_${timestamp}.txt`;

    // Create buffer from text content
    const buffer = Buffer.from(textContent, "utf8");

    // Create NewPackedFile object
    const newFile: NewPackedFile = {
      name: textFileName,
      buffer: buffer,
      file_size: buffer.length,
    };

    // Determine pack path - save to /whmm_flows/ folder
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string;
    const whmmFlowsFolder = nodePath.join(gamePath, "whmm_flows");

    // Create whmm_flows directory if it doesn't exist
    const fs = await import("fs");
    if (!fs.existsSync(whmmFlowsFolder)) {
      fs.mkdirSync(whmmFlowsFolder, { recursive: true });
    }

    const newPackPath = nodePath.join(whmmFlowsFolder, `${packFileBaseName}.pack`);

    // Write the pack file
    await writePack([newFile], newPackPath);

    console.log(`SaveText Node ${nodeId}: Successfully saved text file to ${newPackPath}`);

    return {
      success: true,
      data: {
        type: "SaveResult",
        savedTo: newPackPath,
        format: "text",
        fileName: textFileName,
        message: `Successfully saved text file to ${packFileBaseName}.pack`,
      },
    };
  } catch (error) {
    console.error(`SaveText Node ${nodeId}: Error saving text file:`, error);
    return {
      success: false,
      error: `Failed to save text file: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function executeSaveChangesNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`SaveChanges Node ${nodeId}: Processing save configuration "${textValue}" with tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t: any) => t.name),
  });

  // Parse configuration from textValue
  let packName = "";
  let packedFileName = "";
  let additionalConfig = "";
  let flowExecutionId = "";

  try {
    const config = JSON.parse(textValue);
    packName = config.packName || "";
    packedFileName = config.packedFileName || "";
    additionalConfig = config.additionalConfig || "";
    flowExecutionId = config.flowExecutionId || "";
  } catch {
    // If not JSON, treat textValue as additionalConfig
    additionalConfig = textValue.trim();
  }

  console.log(`Save Changes Node ${nodeId}: Received inputData type:`, inputData?.type);
  console.log(`Save Changes Node ${nodeId}: inputData exists:`, !!inputData);

  // Handle Text input - save as text file
  if (inputData && inputData.type === "Text") {
    return await executeSaveTextNode(nodeId, inputData.text || "", packName, packedFileName);
  }

  // Handle TableSelection input - save table data
  if (inputData && inputData.type === "TableSelection") {
    const toSave = [] as NewPackedFile[];

    for (const table of inputData.tables || []) {
      if (!table.table.schemaFields || !table.table.tableSchema) continue;

      let packFileSize = 0;
      const rows = chunkSchemaIntoRows(
        table.table.schemaFields,
        table.table.tableSchema
      ) as AmendedSchemaField[][];

      console.log(`Save Changes Node ${nodeId}: Calculating pack file size for ${table.name}`);
      console.log(
        `Save Changes Node ${nodeId}: Table has ${table.table.tableSchema.fields.length} schema fields`
      );
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        for (let j = 0; j < row.length; j++) {
          const cell = row[j];
          const field = table.table.tableSchema.fields[j];
          if (!field) {
            console.error(
              `Save Changes Node ${nodeId}: No schema field at index ${j}, cell name: ${cell.name}`
            );
            return {
              success: false,
              error: `Schema mismatch: No field definition at index ${j} for ${cell.name}`,
            };
          }
          const fieldSize = getFieldSize(cell.resolvedKeyValue, field.field_type);
          // console.log(
          //   `  Field ${field.name} (${field.field_type}): resolvedKeyValue="${cell.resolvedKeyValue}" -> ${fieldSize} bytes`
          // );
          packFileSize += fieldSize;
        }
      }

      // Add version header size (8 bytes) if version is defined (including version 0)
      // This matches the serializer's check: if (packFile.version != null)
      if (table.table.version != null) packFileSize += 8;
      packFileSize += 5;
      console.log(`Save Changes Node ${nodeId}: Total calculated size: ${packFileSize} bytes`);

      toSave.push({
        name: "", // Will be set after we determine pack name
        schemaFields: table.table.schemaFields,
        file_size: packFileSize,
        version: table.table.version,
        tableSchema: table.table.tableSchema,
        tableName: table.name, // Store table name for later use
      } as any);
    }

    const nodePath = await import("path");
    const fs = await import("fs");

    let packFileBaseName: string;
    if (packName) {
      packFileBaseName = packName;
    } else if (flowExecutionId) {
      packFileBaseName = `node_graph_output_${flowExecutionId}`;
    } else {
      const timestamp = format(new Date(), "yyyy-MM-dd_HH-mm-ss");
      packFileBaseName = `node_graph_output_${timestamp}`;
    }

    // Now set the proper db file paths: db\tablename\packname_randomsuffix
    for (const file of toSave) {
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const tableName = (file as any).tableName || "unknown_table";
      const fileName = `${packFileBaseName}_${randomSuffix}`;
      file.name = `db\\${tableName}\\${fileName}`;
      delete (file as any).tableName; // Remove temporary property
    }

    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string;
    // If flowExecutionId is set, we're executing a flow at game start, so save to whmm_flows
    // Otherwise, save to data for manual execution
    const outputDir = flowExecutionId
      ? nodePath.join(gamePath, "whmm_flows")
      : nodePath.join(gamePath, "data");
    const packFilePath = nodePath.join(outputDir, `${packFileBaseName}.pack`);

    console.log(
      `Save Changes Node ${nodeId}: Saving to ${flowExecutionId ? "whmm_flows" : "data"} directory`
    );
    console.log(`Save Changes Node ${nodeId}: Output path: ${packFilePath}`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      await writePack(toSave, packFilePath);
      return {
        success: true,
        data: {
          type: "SaveResult",
          savedTo: packFilePath,
          format: "pack",
          message: `Successfully saved ${toSave.length} table(s) to ${packFilePath}`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save pack file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // Handle ChangedColumnSelection input - save database changes
  if (!inputData || inputData.type !== "ChangedColumnSelection") {
    return {
      success: false,
      error: "Invalid input: Expected ChangedColumnSelection, TableSelection, or Text data",
    };
  }

  const saveConfig = additionalConfig;

  // if (!saveConfig) {
  //   return {
  //     success: false,
  //     error: "No save configuration provided. Enter save settings like file path, format, etc.",
  //   };
  // }

  const toSave = [] as NewPackedFile[];
  for (const column of inputData.adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) continue;

    let packFileSize = 0;
    const rows = chunkSchemaIntoRows(
      column.sourceTable.schemaFields,
      column.sourceTable.tableSchema
    ) as AmendedSchemaField[][];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        const field = column.sourceTable.tableSchema.fields[j];
        packFileSize += getFieldSize(cell.resolvedKeyValue, field.field_type);
      }
    }

    if (column.sourceTable.version) packFileSize += 8; // size of version data
    packFileSize += 5;

    let dbFileName = column.fileName as string;
    const lastBackslashIndex = dbFileName.lastIndexOf("\\");
    // Generate random suffix (6 alphanumeric characters)
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    if (lastBackslashIndex > -1) {
      dbFileName =
        dbFileName.substring(0, lastBackslashIndex + 1) +
        "!" +
        dbFileName.substring(lastBackslashIndex + 1) +
        "_" +
        randomSuffix;
    } else {
      dbFileName = "!" + dbFileName + "_" + randomSuffix;
    }

    console.log("NEW dbFileName:", dbFileName);

    toSave.push({
      name: dbFileName,
      schemaFields: column.sourceTable.schemaFields,
      file_size: packFileSize,
      version: column.sourceTable.version,
      tableSchema: column.sourceTable.tableSchema,
    });
  }

  const nodePath = await import("path");
  const fs = await import("fs");

  // Use flowExecutionId for consistent pack name across all save changes nodes in the same flow
  // If no flowExecutionId, fall back to timestamp. If packName is provided, use that.
  let packFileBaseName: string;
  if (packName) {
    packFileBaseName = packName;
  } else if (flowExecutionId) {
    // flowExecutionId is in format like "2025-12-14_23-19-58"
    // Convert to shorter format: "141225_231958"
    const parts = flowExecutionId.split("_");
    if (parts.length === 2) {
      const datePart = parts[0].split("-").reverse().join("").slice(2); // "141225"
      const timePart = parts[1].replace(/-/g, ""); // "231958"
      packFileBaseName = `dbflow_${datePart}_${timePart}`;
    } else {
      packFileBaseName = `dbflow_${flowExecutionId.replace(/[-:]/g, "")}`;
    }
  } else {
    const timestamp = format(new Date(), "ddMMyy_HHmmss");
    packFileBaseName = `dbflow_${timestamp}`;
  }

  const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string;
  const whmmFlowsFolder = nodePath.join(gamePath, "whmm_flows");

  // Create whmm_flows directory if it doesn't exist
  if (!fs.existsSync(whmmFlowsFolder)) {
    fs.mkdirSync(whmmFlowsFolder, { recursive: true });
  }

  const newPackPath = nodePath.join(whmmFlowsFolder, `${packFileBaseName}.pack`);

  // If pack file already exists (from another save changes node in this flow), merge the tables
  let filesToSave = toSave;
  if (fs.existsSync(newPackPath)) {
    console.log(`SaveChanges Node ${nodeId}: Pack file already exists, merging tables`);
    try {
      const existingPack = await readPack(newPackPath);

      // Parse the DB tables to populate schemaFields
      const dbTableNames = existingPack.packedFiles
        .filter((pf) => pf.name.toLowerCase().startsWith("db\\"))
        .map((pf) => {
          // Extract table name like "db\main_units_tables" from "db\main_units_tables\!data__"
          const parts = pf.name.split("\\");
          if (parts.length >= 2) {
            return `${parts[0]}\\${parts[1]}`;
          }
          return pf.name;
        });
      const uniqueTableNames = [...new Set(dbTableNames)];

      if (uniqueTableNames.length > 0) {
        console.log(
          `SaveChanges Node ${nodeId}: Parsing ${uniqueTableNames.length} table(s) from existing pack`
        );
        getPacksTableData([existingPack], uniqueTableNames);
      }

      const existingFiles = existingPack.packedFiles;

      // Merge: keep existing files and add/replace with new ones
      const fileMap = new Map<string, NewPackedFile>();

      // Add existing files
      for (const existingFile of existingFiles) {
        if (existingFile.schemaFields && existingFile.tableSchema) {
          console.log(`SaveChanges Node ${nodeId}: Adding existing file to map: ${existingFile.name}`);
          fileMap.set(existingFile.name, {
            name: existingFile.name,
            schemaFields: existingFile.schemaFields,
            file_size: existingFile.file_size,
            version: existingFile.version,
            tableSchema: existingFile.tableSchema,
          });
        }
      }

      // Add/replace with new files
      for (const newFile of toSave) {
        const action = fileMap.has(newFile.name) ? "Replacing" : "Adding";
        console.log(`SaveChanges Node ${nodeId}: ${action} file in map: ${newFile.name}`);
        fileMap.set(newFile.name, newFile);
      }

      filesToSave = Array.from(fileMap.values());
      console.log(
        `SaveChanges Node ${nodeId}: Merged ${existingFiles.length} existing files with ${toSave.length} new files, total ${filesToSave.length} files`
      );
    } catch (error) {
      console.error(`SaveChanges Node ${nodeId}: Error reading existing pack, will overwrite:`, error);
    }
  }

  await writePack(filesToSave, newPackPath);

  try {
    // Parse save configuration (could be JSON, simple path, or custom format)
    let filePath = saveConfig;
    let format = "tsv"; // default format

    // Try to parse as JSON for more complex configurations
    try {
      const config = JSON.parse(saveConfig);
      filePath = config.path || config.filePath || "output.tsv";
      format = config.format || "tsv";
    } catch {
      // If not JSON, treat as simple file path
      if (saveConfig.includes(".")) {
        const ext = saveConfig.split(".").pop()?.toLowerCase();
        if (ext === "csv" || ext === "tsv" || ext === "json") {
          format = ext;
        }
      }
    }

    // Simulate saving the changes (in real implementation, you'd write to actual files)
    // const savedData = {
    //   filePath: filePath,
    //   format: format,
    //   timestamp: new Date().toISOString(),
    //   tablesProcessed: inputData.adjustedColumns?.length || 0,
    //   totalRecords: inputData.processedValues || 0,
    //   appliedFormula: inputData.appliedFormula,
    //   // In real implementation, you'd write the actual adjusted data here
    //   preview: inputData.adjustedColumns?.slice(0, 2).map((table: any) => ({
    //     tableName: table.tableName,
    //     fileName: table.fileName,
    //     adjustedColumns: table.data?.slice(0, 3).map((col: any) => ({
    //       column: col.column,
    //       sampleAdjustedValues: col.adjustedSampleValues?.slice(0, 3),
    //     })),
    //   })),
    // };

    console.log(`SaveChanges Node ${nodeId}: Simulated save to ${filePath} in ${format} format`);

    return {
      success: true,
      data: {
        type: "SaveResult",
        savedTo: newPackPath,
        format: format,
        // summary: savedData,
        message: `Successfully saved to ${newPackPath}`,
        // message: `Successfully saved ${savedData.tablesProcessed} tables with ${savedData.totalRecords} processed records to ${filePath}`,
      } as DBSaveChangesNodeData,
    };
  } catch (error) {
    console.error(`SaveChanges Node ${nodeId}: Error during save operation:`, error);
    return {
      success: false,
      error: `Save operation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function executeTextSurroundNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`TextSurround Node ${nodeId}: Processing with config "${textValue}" and input:`, inputData);

  if (!inputData) {
    return { success: false, error: "Invalid input: No input data provided" };
  }

  // Parse configuration
  let surroundText = textValue;
  let groupedTextSelection: "Text" | "Text Lines" = "Text";

  try {
    const config = JSON.parse(textValue);
    surroundText = config.surroundText || "";
    groupedTextSelection = config.groupedTextSelection || "Text";
  } catch {
    // If not JSON, treat as simple surround text
    surroundText = textValue;
  }

  // Parse the surround configuration (could be prefix/suffix separated by | or just a prefix)
  const parts = surroundText.split("|");
  let prefix = parts[0] || "";
  let suffix = parts[1] || parts[0] || "";

  // Process escape sequences
  prefix = prefix.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
  suffix = suffix.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");

  let outputText: any;
  let outputTextLines: any;
  let outputType = inputData.type || "Text";

  // Handle GroupedText input - preserve structure
  if (inputData.type === "GroupedText") {
    // GroupedText has both text (array of keys) and textLines (array of arrays of values)
    // We modify only the selected one and keep the other unchanged

    // Default: keep both unchanged
    outputText = inputData.text;
    outputTextLines = inputData.textLines;

    // Only modify the selected field
    if (groupedTextSelection === "Text") {
      // Modify text array (keys) only
      if (inputData.text && Array.isArray(inputData.text)) {
        outputText = inputData.text.map((key: string) => `${prefix}${key}${suffix}`);
      }
    } else {
      // Modify textLines array (values) only
      if (inputData.textLines && Array.isArray(inputData.textLines)) {
        // TextLines is array of arrays - surround each value within each array
        outputTextLines = inputData.textLines.map((valueArray: string[]) =>
          valueArray.map((value: string) => `${prefix}${value}${suffix}`)
        );
      }
    }

    // Output is still GroupedText
    outputType = "GroupedText";
  } else if (typeof inputData === "string") {
    // Simple text input
    outputText = `${prefix}${inputData}${suffix}`;
  } else if (Array.isArray(inputData)) {
    // Text Lines input
    outputTextLines = inputData.map((line: string) => `${prefix}${line}${suffix}`);
  }

  return {
    success: true,
    data: {
      type: outputType,
      text: outputText,
      textLines: outputTextLines,
      groupCount: inputData.groupCount,
    },
  };
}

async function executeAppendTextNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`AppendText Node ${nodeId}: Processing with config "${textValue}" and input:`, inputData);

  if (!inputData) {
    return { success: false, error: "Invalid input: No input data provided" };
  }

  // Parse configuration
  let beforeText = "";
  let afterText = "";
  let groupedTextSelection: "Text" | "Text Lines" = "Text";

  try {
    const config = JSON.parse(textValue);
    beforeText = config.beforeText || "";
    afterText = config.afterText || "";
    groupedTextSelection = config.groupedTextSelection || "Text";
  } catch {
    // If not JSON, treat as empty configuration
    beforeText = "";
    afterText = "";
  }

  // Process escape sequences
  beforeText = beforeText.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
  afterText = afterText.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");

  let outputText: any;
  let outputTextLines: any;
  let outputType = inputData.type || "Text";

  // Handle GroupedText input - preserve structure
  if (inputData.type === "GroupedText") {
    // Default: keep both unchanged
    outputText = inputData.text;
    outputTextLines = inputData.textLines;

    // Only modify the selected field
    if (groupedTextSelection === "Text") {
      // Modify text array (keys) only
      if (inputData.text && Array.isArray(inputData.text)) {
        outputText = inputData.text.map((key: string) => `${beforeText}${key}${afterText}`);
      }
    } else {
      // Modify textLines array (values) only
      if (inputData.textLines && Array.isArray(inputData.textLines)) {
        // TextLines is array of arrays - append to each value within each array
        outputTextLines = inputData.textLines.map((valueArray: string[]) =>
          valueArray.map((value: string) => `${beforeText}${value}${afterText}`)
        );
      }
    }

    // Output is still GroupedText
    outputType = "GroupedText";
  } else if (typeof inputData === "string") {
    // Simple text input
    outputText = `${beforeText}${inputData}${afterText}`;
  } else if (Array.isArray(inputData)) {
    // Text Lines input (array of strings)
    outputText = inputData.map((line: string) => `${beforeText}${line}${afterText}`);
    outputType = "Text Lines";
  } else if (inputData.type === "Text") {
    // Structured Text input
    outputText = `${beforeText}${inputData.text}${afterText}`;
  } else if (inputData.type === "Text Lines" && Array.isArray(inputData.textLines)) {
    // Structured Text Lines input
    outputText = inputData.textLines.map((line: string) => `${beforeText}${line}${afterText}`);
    outputType = "Text Lines";
  } else {
    return { success: false, error: `Unsupported input type: ${inputData.type || typeof inputData}` };
  }

  // Return result based on type
  if (outputType === "GroupedText") {
    return {
      success: true,
      data: {
        type: "GroupedText",
        text: outputText,
        textLines: outputTextLines,
      },
    };
  } else if (outputType === "Text Lines") {
    return {
      success: true,
      data: {
        type: "Text Lines",
        textLines: outputText,
      },
    };
  } else {
    return {
      success: true,
      data: {
        type: "Text",
        text: outputText,
      },
    };
  }
}

async function executeTextJoinNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`TextJoin Node ${nodeId}: Processing with separator "${textValue}" and input:`, inputData);

  if (!inputData) {
    return { success: false, error: "Invalid input: No input data provided" };
  }

  let separator = textValue || "\n";

  // Process escape sequences
  separator = separator.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");

  let linesToJoin: string[] = [];

  // Handle GroupedText input
  if (inputData.type === "GroupedText") {
    // text is array of keys, textLines is array of arrays of values
    if (inputData.text && Array.isArray(inputData.text)) {
      // Use array of keys
      linesToJoin = inputData.text;
    } else if (inputData.textLines && Array.isArray(inputData.textLines)) {
      // Flatten array of arrays of values
      linesToJoin = inputData.textLines.flat();
    } else {
      return { success: false, error: "GroupedText input does not contain text or textLines" };
    }
  } else if (Array.isArray(inputData)) {
    // Direct Text Lines input
    linesToJoin = inputData;
  } else {
    return {
      success: false,
      error: "Invalid input: Expected Text Lines or GroupedText",
    };
  }

  const joinedText = linesToJoin.join(separator);

  return {
    success: true,
    data: {
      type: "Text",
      text: joinedText,
    },
  };
}

async function executeGroupedColumnsToTextNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(
    `GroupedColumnsToText Node ${nodeId}: Processing with config "${textValue}" and input:`,
    inputData
  );

  if (!inputData) {
    return { success: false, error: "Invalid input: No input data provided" };
  }

  if (inputData.type !== "GroupedText") {
    return { success: false, error: "Invalid input: Expected GroupedText" };
  }

  // Parse the configuration from textValue (pattern and joinSeparator are stored separately in node data)
  // For now, textValue might contain JSON with both pattern and joinSeparator
  let pattern = "{0}: {1}";
  let joinSeparator = "\n";

  try {
    const config = JSON.parse(textValue);
    pattern = config.pattern || pattern;
    joinSeparator = config.joinSeparator || joinSeparator;
  } catch {
    // If not JSON, treat textValue as pattern
    pattern = textValue || pattern;
  }

  // Process the escape sequences in joinSeparator
  joinSeparator = joinSeparator.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");

  const keysArray: string[] = inputData.text || [];
  const valuesArray: string[][] = inputData.textLines || [];

  if (keysArray.length !== valuesArray.length) {
    return {
      success: false,
      error: `Mismatched keys and values arrays: ${keysArray.length} keys, ${valuesArray.length} value arrays`,
    };
  }

  // Format each key-values pair using the pattern
  const formattedLines: string[] = [];
  for (let i = 0; i < keysArray.length; i++) {
    const key = keysArray[i];
    const values = valuesArray[i];

    // Join the values array with comma-space by default
    const valuesString = values.join(", ");

    // Replace {0} with key and {1} with values string
    const formattedLine = pattern.replace(/\{0\}/g, key).replace(/\{1\}/g, valuesString);
    formattedLines.push(formattedLine);
  }

  // Join all lines with the separator
  const finalText = formattedLines.join(joinSeparator);

  return {
    success: true,
    data: {
      type: "Text",
      text: finalText,
    },
  };
}

async function executeIndexTableNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Index Table Node ${nodeId}: Processing ${inputData?.tables?.length || 0} table(s)`);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse index columns from textValue
  let indexColumns: string[] = [];
  try {
    const parsed = JSON.parse(textValue);
    indexColumns = parsed.indexColumns || [];
  } catch (error) {
    console.error(`Index Table Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid index configuration" };
  }

  if (indexColumns.length === 0) {
    return { success: false, error: "No index columns specified" };
  }

  console.log(`Index Table Node ${nodeId}: Indexing by columns: ${indexColumns.join(", ")}`);

  // Combine rows from all tables
  if (inputData.tables.length === 0) {
    return { success: false, error: "No tables in input data" };
  }

  const allRows: AmendedSchemaField[][] = [];
  let sourceTable = inputData.tables[0]; // Keep first for metadata

  for (const table of inputData.tables) {
    if (!table.table.schemaFields || !table.table.tableSchema) {
      console.warn(`Index Table Node ${nodeId}: Skipping table without schema data`);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      table.table.schemaFields,
      table.table.tableSchema
    ) as AmendedSchemaField[][];

    allRows.push(...rows);
  }

  const rows = allRows;
  console.log(
    `Index Table Node ${nodeId}: Indexing ${rows.length} rows from ${inputData.tables.length} pack file(s)`
  );

  // Build the index map
  const indexMap = new Map<string, any[]>();

  for (const row of rows) {
    // Extract values for the index columns
    const keyParts: string[] = [];
    let allColumnsFound = true;

    for (const columnName of indexColumns) {
      const cell = row.find((c) => c.name === columnName);
      if (!cell) {
        console.warn(`Index Table Node ${nodeId}: Column "${columnName}" not found in row, skipping row`);
        allColumnsFound = false;
        break;
      }
      const value = cell.resolvedKeyValue || "";
      keyParts.push(String(value));
    }

    if (!allColumnsFound) {
      continue;
    }

    // Create composite key by joining with pipe delimiter
    const indexKey = keyParts.join("|");

    // Add row to index (support multiple rows with same key)
    if (!indexMap.has(indexKey)) {
      indexMap.set(indexKey, []);
    }
    indexMap.get(indexKey)!.push(row);
  }

  console.log(
    `Index Table Node ${nodeId}: Created index with ${indexMap.size} unique keys for table "${sourceTable.name}"`
  );

  return {
    success: true,
    data: {
      type: "IndexedTable",
      indexColumns,
      indexMap,
      sourceTable,
      tableName: sourceTable.name,
    },
  };
}

async function executeLookupNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`Lookup Node ${nodeId}: Processing with input tables:`, {
    sourceTableCount: inputData?.source?.tables?.length,
    indexedTableName: inputData?.indexed?.tableName,
  });

  // Parse configuration
  let lookupColumn: string = "";
  let joinType: "inner" | "left" | "nested" | "cross" = "inner";
  let indexColumns: string[] = [];
  let indexJoinColumn: string = "";
  try {
    const parsed = JSON.parse(textValue);
    lookupColumn = parsed.lookupColumn || "";
    joinType = parsed.joinType || "inner";
    indexColumns = parsed.indexColumns || [];
    indexJoinColumn = parsed.indexJoinColumn || "";
  } catch (error) {
    console.error(`Lookup Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid lookup configuration" };
  }

  // For cross join, we don't need lookup columns
  if (joinType !== "cross" && !lookupColumn) {
    return { success: false, error: "No lookup column specified" };
  }

  // Input should be an array: [sourceData, indexedData]
  if (!Array.isArray(inputData) || inputData.length !== 2) {
    return { success: false, error: "Invalid input: Expected array with 2 inputs [source, index]" };
  }

  const [sourceData, rightInputData] = inputData;

  // Validate source data
  if (!sourceData || sourceData.type !== "TableSelection") {
    return { success: false, error: "Invalid source input: Expected TableSelection data" };
  }

  // Handle both IndexedTable and TableSelection for the second input
  let indexedData: any;

  if (rightInputData.type === "IndexedTable") {
    // Already indexed, use as-is
    indexedData = rightInputData;
  } else if (rightInputData.type === "TableSelection") {
    // Need to index it first - use indexJoinColumn if specified, otherwise indexColumns, otherwise lookupColumn
    const columnsToIndex = indexJoinColumn
      ? [indexJoinColumn]
      : indexColumns.length > 0
      ? indexColumns
      : [lookupColumn];

    console.log(`Lookup Node ${nodeId}: Auto-indexing second input by [${columnsToIndex.join(", ")}]`);

    // Build index from the TableSelection data
    const indexMap = new Map<string, AmendedSchemaField[][]>();
    let rightTable = rightInputData.tables[0];

    // Combine rows from all tables
    const allRightRows: AmendedSchemaField[][] = [];
    for (const table of rightInputData.tables) {
      if (!table.table.schemaFields || !table.table.tableSchema) {
        console.warn(`Lookup Node ${nodeId}: Skipping table without schema data`);
        continue;
      }

      const rows = chunkSchemaIntoRows(
        table.table.schemaFields,
        table.table.tableSchema
      ) as AmendedSchemaField[][];

      allRightRows.push(...rows);
      if (!rightTable) rightTable = table;
    }

    console.log(
      `Lookup Node ${nodeId}: Indexing ${allRightRows.length} rows from ${rightInputData.tables.length} pack files`
    );

    // Build index
    for (const row of allRightRows) {
      const keyParts: string[] = [];
      for (const colName of columnsToIndex) {
        const cell = row.find((c: AmendedSchemaField) => c.name === colName);
        if (!cell) {
          console.warn(`Lookup Node ${nodeId}: Index column "${colName}" not found in row`);
          continue;
        }
        keyParts.push(String(cell.resolvedKeyValue || ""));
      }

      const key = keyParts.join("||");
      if (!indexMap.has(key)) {
        indexMap.set(key, []);
      }
      indexMap.get(key)!.push(row);
    }

    console.log(`Lookup Node ${nodeId}: Created index with ${indexMap.size} unique key(s)`);

    indexedData = {
      type: "IndexedTable",
      indexMap,
      sourceTable: rightTable,
      tableName: rightTable.name,
    };
  } else {
    return { success: false, error: "Invalid index input: Expected IndexedTable or TableSelection data" };
  }

  console.log(`Lookup Node ${nodeId}: Performing ${joinType} join on column "${lookupColumn}"`);

  // Get all source tables and combine rows from all of them
  if (sourceData.tables.length === 0) {
    return { success: false, error: "No tables in source data" };
  }

  // Combine rows from all tables
  const allSourceRows: AmendedSchemaField[][] = [];
  let sourceTable = sourceData.tables[0]; // Keep first for metadata

  for (const table of sourceData.tables) {
    if (!table.table.schemaFields || !table.table.tableSchema) {
      console.warn(`Lookup Node ${nodeId}: Skipping table without schema data`);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      table.table.schemaFields,
      table.table.tableSchema
    ) as AmendedSchemaField[][];

    allSourceRows.push(...rows);
  }

  const sourceRows = allSourceRows;
  console.log(
    `Lookup Node ${nodeId}: Processing ${sourceRows.length} source rows from ${sourceData.tables.length} pack files`
  );

  // Get table names for auto-prefixing
  const sourceTableName = sourceTable.name.replace(/^db\\/, "").replace(/\\.*$/, "");
  const lookupTableName = indexedData.tableName.replace(/^db\\/, "").replace(/\\.*$/, "");

  // Perform join based on join type
  if (joinType === "cross") {
    // Cross join: Cartesian product of all source rows with all right table rows
    console.log(`Lookup Node ${nodeId}: Performing cross join (Cartesian product)`);

    // Extract all rows from the indexed data
    const allRightRows: AmendedSchemaField[][] = [];
    for (const rows of indexedData.indexMap.values()) {
      allRightRows.push(...rows);
    }

    console.log(
      `Lookup Node ${nodeId}: Cross joining ${sourceRows.length} source rows with ${allRightRows.length} right rows`
    );

    const crossJoinedRows: AmendedSchemaField[][] = [];

    // Create Cartesian product
    for (const sourceRow of sourceRows) {
      for (const rightRow of allRightRows) {
        const prefixedSourceRow = sourceRow.map((cell) => ({
          ...cell,
          name: `${sourceTableName}_${cell.name}`,
        }));
        const prefixedRightRow = rightRow.map((cell: AmendedSchemaField) => ({
          ...cell,
          name: `${lookupTableName}_${cell.name}`,
        }));
        crossJoinedRows.push([...prefixedSourceRow, ...prefixedRightRow]);
      }
    }

    console.log(`Lookup Node ${nodeId}: Created ${crossJoinedRows.length} cross-joined rows`);

    // Build schema from the first joined row
    const schemaFields: DBField[] = [];
    if (crossJoinedRows.length > 0) {
      for (const cell of crossJoinedRows[0]) {
        schemaFields.push({
          name: cell.name,
          field_type: cell.type as SCHEMA_FIELD_TYPE,
          is_key: cell.isKey || false,
          default_value: "",
          is_filename: false,
          is_reference: [],
          description: `Joined column from cross join`,
          ca_order: -1,
          is_bitwise: 0,
          enum_values: {},
        });
      }
    }

    const schemaVersion = sourceTable.table.tableSchema?.version ?? 1;
    const tableVersion = sourceTable.table.version;

    const crossJoinedTable: DBTablesNodeTable = {
      name: `${sourceTableName}_cross_${lookupTableName}`,
      fileName: `${sourceTableName}_cross_${lookupTableName}`,
      sourceFile: sourceTable.sourceFile,
      table: {
        ...sourceTable.table,
        name: `db\\${sourceTableName}_cross_${lookupTableName}`,
        schemaFields: crossJoinedRows.flat(),
        tableSchema: {
          version: schemaVersion,
          fields: schemaFields,
        },
      },
    };

    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [crossJoinedTable],
        sourceFiles: sourceData.sourceFiles,
        tableCount: 1,
      },
    };
  } else if (joinType === "nested") {
    // Nested join: preserve source rows, add lookup matches as nested array
    const nestedRows: NestedRow[] = [];

    for (const sourceRow of sourceRows) {
      const lookupCell = sourceRow.find((c) => c.name === lookupColumn);
      if (!lookupCell) {
        console.warn(`Lookup Node ${nodeId}: Column "${lookupColumn}" not found in source row, skipping`);
        continue;
      }

      const lookupKey = String(lookupCell.resolvedKeyValue || "");
      const lookupMatches = indexedData.indexMap.get(lookupKey) || [];

      nestedRows.push({
        sourceRow,
        lookupMatches,
      });
    }

    console.log(`Lookup Node ${nodeId}: Created ${nestedRows.length} nested rows`);

    return {
      success: true,
      data: {
        type: "NestedTableSelection",
        rows: nestedRows,
        sourceTable,
        lookupTable: indexedData.sourceTable,
      },
    };
  } else {
    // Inner or Left join: flatten results
    const joinedTables: DBTablesNodeTable[] = [];

    // Create a new table with joined rows
    const joinedRows: AmendedSchemaField[][] = [];

    for (const sourceRow of sourceRows) {
      const lookupCell = sourceRow.find((c) => c.name === lookupColumn);
      if (!lookupCell) {
        console.warn(`Lookup Node ${nodeId}: Column "${lookupColumn}" not found in source row, skipping`);
        continue;
      }

      const lookupKey = String(lookupCell.resolvedKeyValue || "");
      const lookupMatches = indexedData.indexMap.get(lookupKey) || [];

      if (lookupMatches.length === 0) {
        // No match found
        if (joinType === "left") {
          // Left join: keep source row with nulls for lookup columns
          const prefixedSourceRow = sourceRow.map((cell) => ({
            ...cell,
            name: `${sourceTableName}_${cell.name}`,
          }));
          joinedRows.push(prefixedSourceRow);
        }
        // Inner join: skip row
      } else {
        // Match found: create joined rows
        for (const lookupRow of lookupMatches) {
          const prefixedSourceRow = sourceRow.map((cell) => ({
            ...cell,
            name: `${sourceTableName}_${cell.name}`,
          }));
          const prefixedLookupRow = lookupRow.map((cell: AmendedSchemaField) => ({
            ...cell,
            name: `${lookupTableName}_${cell.name}`,
          }));
          joinedRows.push([...prefixedSourceRow, ...prefixedLookupRow]);
        }
      }
    }

    console.log(`Lookup Node ${nodeId}: Created ${joinedRows.length} joined rows`);

    // We need to create a new packed file with the joined data
    // Build proper DBField schema from joined row structure
    const schemaFields: DBField[] = [];
    if (joinedRows.length > 0) {
      for (const cell of joinedRows[0]) {
        schemaFields.push({
          name: cell.name,
          field_type: cell.type as SCHEMA_FIELD_TYPE,
          is_key: cell.isKey || false,
          default_value: "",
          is_filename: false,
          is_reference: [],
          description: `Joined column from ${joinType} join`,
          ca_order: -1,
          is_bitwise: 0,
          enum_values: {},
        });
      }
    }

    const schemaVersion = sourceTable.table.tableSchema?.version ?? 1;
    const tableVersion = sourceTable.table.version;

    console.log(
      `Lookup Node ${nodeId}: Source table version=${sourceTable.table.version}, schema version=${sourceTable.table.tableSchema?.version}`
    );
    console.log(
      `Lookup Node ${nodeId}: Creating joined table with schema version=${schemaVersion}, table version=${tableVersion}`
    );

    const joinedTable: DBTablesNodeTable = {
      name: `${sourceTableName}_joined_${lookupTableName}`,
      fileName: `${sourceTableName}_joined_${lookupTableName}`,
      sourceFile: sourceTable.sourceFile,
      table: {
        ...sourceTable.table,
        name: `db\\${sourceTableName}_joined_${lookupTableName}`,
        schemaFields: joinedRows.flat(),
        tableSchema: {
          version: schemaVersion,
          fields: schemaFields,
        },
      },
    };

    joinedTables.push(joinedTable);

    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: joinedTables,
        sourceFiles: sourceData.sourceFiles,
        tableCount: joinedTables.length,
      },
    };
  }
}

async function executeFlattenNestedNode(
  nodeId: string,
  inputData: NestedTableSelection
): Promise<NodeExecutionResult> {
  console.log(`Flatten Nested Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "NestedTableSelection") {
    return { success: false, error: "Invalid input: Expected NestedTableSelection data" };
  }

  console.log(`Flatten Nested Node ${nodeId}: Flattening ${inputData.rows.length} nested rows`);

  // Get table names for prefixing
  const sourceTableName = inputData.sourceTable.name.replace(/^db\\/, "").replace(/\\.*$/, "");
  const lookupTableName = inputData.lookupTable.name.replace(/^db\\/, "").replace(/\\.*$/, "");

  // Expand nested rows into flat rows
  const flatRows: AmendedSchemaField[][] = [];

  for (const nestedRow of inputData.rows) {
    if (nestedRow.lookupMatches.length === 0) {
      // No lookup matches: just keep source row with prefixes
      const prefixedSourceRow = nestedRow.sourceRow.map((cell: AmendedSchemaField) => ({
        ...cell,
        name: `${sourceTableName}_${cell.name}`,
      }));
      flatRows.push(prefixedSourceRow);
    } else {
      // Expand each lookup match into a separate row
      for (const lookupRow of nestedRow.lookupMatches) {
        const prefixedSourceRow = nestedRow.sourceRow.map((cell: AmendedSchemaField) => ({
          ...cell,
          name: `${sourceTableName}_${cell.name}`,
        }));
        const prefixedLookupRow = lookupRow.map((cell: AmendedSchemaField) => ({
          ...cell,
          name: `${lookupTableName}_${cell.name}`,
        }));
        flatRows.push([...prefixedSourceRow, ...prefixedLookupRow]);
      }
    }
  }

  console.log(`Flatten Nested Node ${nodeId}: Created ${flatRows.length} flat rows`);

  // Create a table with the flattened data
  const flatTable: DBTablesNodeTable = {
    name: `${sourceTableName}_flattened_${lookupTableName}`,
    fileName: `${sourceTableName}_flattened_${lookupTableName}`,
    sourceFile: inputData.sourceTable.sourceFile,
    table: {
      ...inputData.sourceTable.table,
      name: `db\\${sourceTableName}_flattened_${lookupTableName}`,
      schemaFields: flatRows.flat(),
      tableSchema: {
        ...inputData.sourceTable.table.tableSchema!,
        fields:
          flatRows.length > 0
            ? flatRows[0].map((cell) => ({
                name: cell.name,
                field_type: cell.type as SCHEMA_FIELD_TYPE,
                is_key: cell.isKey || false,
                default_value: "",
                is_filename: false,
                is_reference: [],
                description: "",
                ca_order: 0,
                is_bitwise: 0,
                enum_values: {},
              }))
            : [],
      },
    },
  };

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: [flatTable],
      sourceFiles: inputData.sourceTable.sourceFile ? [inputData.sourceTable.sourceFile as any] : [],
      tableCount: 1,
    },
  };
}

async function executeExtractTableNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Extract Table Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse table prefix from textValue
  let tablePrefix: string = "";
  try {
    const parsed = JSON.parse(textValue);
    tablePrefix = parsed.tablePrefix || "";
  } catch (error) {
    console.error(`Extract Table Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid extract configuration" };
  }

  if (!tablePrefix) {
    return { success: false, error: "No table prefix specified" };
  }

  console.log(`Extract Table Node ${nodeId}: Extracting columns with prefix "${tablePrefix}"`);

  // Process first table
  if (inputData.tables.length === 0) {
    return { success: false, error: "No tables in input data" };
  }

  const sourceTable = inputData.tables[0];

  if (!sourceTable.table.schemaFields || !sourceTable.table.tableSchema) {
    return { success: false, error: "Table has no schema data" };
  }

  const rows = chunkSchemaIntoRows(
    sourceTable.table.schemaFields,
    sourceTable.table.tableSchema
  ) as AmendedSchemaField[][];

  console.log(`Extract Table Node ${nodeId}: Processing ${rows.length} rows`);

  // Extract and rename columns
  const extractedRows: AmendedSchemaField[][] = [];

  for (const row of rows) {
    const extractedRow: AmendedSchemaField[] = [];

    for (const cell of row) {
      if (cell.name.startsWith(tablePrefix)) {
        // Remove prefix from column name
        const newName = cell.name.substring(tablePrefix.length);
        extractedRow.push({
          ...cell,
          name: newName,
        });
      }
    }

    if (extractedRow.length > 0) {
      extractedRows.push(extractedRow);
    }
  }

  console.log(`Extract Table Node ${nodeId}: Extracted ${extractedRows.length} rows`);

  // Create a table with the extracted data
  const extractedTableName = tablePrefix.replace(/_$/, ""); // Remove trailing underscore
  const extractedTable: DBTablesNodeTable = {
    name: extractedTableName,
    fileName: extractedTableName,
    sourceFile: sourceTable.sourceFile,
    table: {
      ...sourceTable.table,
      name: `db\\${extractedTableName}`,
      schemaFields: extractedRows.flat(),
      tableSchema: {
        ...sourceTable.table.tableSchema!,
        fields:
          extractedRows.length > 0
            ? extractedRows[0].map((cell) => ({
                name: cell.name,
                field_type: cell.type as SCHEMA_FIELD_TYPE,
                is_key: cell.isKey || false,
                default_value: "",
                is_filename: false,
                is_reference: [],
                description: "",
                ca_order: 0,
                is_bitwise: 0,
                enum_values: {},
              }))
            : [],
      },
    },
  };

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: [extractedTable],
      sourceFiles: inputData.sourceFiles,
      tableCount: 1,
    },
  };
}

async function executeAggregateNestedNode(
  nodeId: string,
  textValue: string,
  inputData: NestedTableSelection
): Promise<NodeExecutionResult> {
  console.log(`Aggregate Nested Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "NestedTableSelection") {
    return { success: false, error: "Invalid input: Expected NestedTableSelection data" };
  }

  // Parse configuration
  let aggregateColumn: string = "";
  let aggregateType: "min" | "max" | "sum" | "avg" | "count" = "min";
  let filterColumn: string = "";
  let filterOperator:
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "lessThan"
    | "greaterThanOrEqual"
    | "lessThanOrEqual" = "equals";
  let filterValue: string = "";
  try {
    const parsed = JSON.parse(textValue);
    aggregateColumn = parsed.aggregateColumn || "";
    aggregateType = parsed.aggregateType || "min";
    filterColumn = parsed.filterColumn || "";
    filterOperator = parsed.filterOperator || "equals";
    filterValue = parsed.filterValue || "";
  } catch (error) {
    console.error(`Aggregate Nested Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid aggregate configuration" };
  }

  if (!aggregateColumn && (aggregateType === "min" || aggregateType === "max")) {
    return { success: false, error: "No aggregate column specified" };
  }

  console.log(
    `Aggregate Nested Node ${nodeId}: Performing ${aggregateType.toUpperCase()} on column "${aggregateColumn}"${
      filterColumn ? ` with filter ${filterColumn} ${filterOperator} ${filterValue}` : ""
    }`
  );

  // Helper function to apply filter
  const applyFilter = (row: AmendedSchemaField[]): boolean => {
    if (!filterColumn) return true;

    const cell = row.find((c: AmendedSchemaField) => c.name === filterColumn);
    if (!cell) return false;

    const cellValue = String(cell.resolvedKeyValue || "");

    // Try to parse as number for numeric comparisons
    const numericCellValue = parseFloat(cellValue);
    const numericFilterValue = parseFloat(filterValue);
    const isNumeric = !isNaN(numericCellValue) && !isNaN(numericFilterValue);

    switch (filterOperator) {
      case "equals":
        return isNumeric ? numericCellValue === numericFilterValue : cellValue === filterValue;
      case "notEquals":
        return isNumeric ? numericCellValue !== numericFilterValue : cellValue !== filterValue;
      case "greaterThan":
        return isNumeric && numericCellValue > numericFilterValue;
      case "lessThan":
        return isNumeric && numericCellValue < numericFilterValue;
      case "greaterThanOrEqual":
        return isNumeric && numericCellValue >= numericFilterValue;
      case "lessThanOrEqual":
        return isNumeric && numericCellValue <= numericFilterValue;
      default:
        return true;
    }
  };

  // Process each nested row
  const aggregatedRows: NestedRow[] = [];

  for (const nestedRow of inputData.rows) {
    // Apply filter to lookup matches
    const filteredMatches = nestedRow.lookupMatches.filter(applyFilter);

    if (filteredMatches.length === 0) {
      // No matches after filtering: drop this row
      console.log(`Aggregate Nested Node ${nodeId}: Dropping row - no matches after filtering`);
      continue;
    }

    if (aggregateType === "min" || aggregateType === "max") {
      // Find row with min/max value
      let selectedRow: AmendedSchemaField[] | null = null;
      let selectedValue: number | null = null;

      for (const lookupRow of filteredMatches) {
        const cell = lookupRow.find((c: AmendedSchemaField) => c.name === aggregateColumn);
        if (!cell) {
          console.warn(
            `Aggregate Nested Node ${nodeId}: Column "${aggregateColumn}" not found in lookup row`
          );
          continue;
        }

        const value = parseFloat(String(cell.resolvedKeyValue || "0"));
        if (isNaN(value)) {
          console.warn(
            `Aggregate Nested Node ${nodeId}: Non-numeric value in column "${aggregateColumn}": ${cell.resolvedKeyValue}`
          );
          continue;
        }

        if (selectedRow === null) {
          selectedRow = lookupRow;
          selectedValue = value;
        } else {
          if (
            (aggregateType === "min" && value < selectedValue!) ||
            (aggregateType === "max" && value > selectedValue!)
          ) {
            selectedRow = lookupRow;
            selectedValue = value;
          }
        }
      }

      // Keep only the selected row
      aggregatedRows.push({
        sourceRow: nestedRow.sourceRow,
        lookupMatches: selectedRow ? [selectedRow] : [],
      });
    } else {
      // Calculate aggregate (sum/avg/count)
      let aggregateValue: number = 0;

      if (aggregateType === "count") {
        aggregateValue = filteredMatches.length;
      } else {
        let sum = 0;
        let count = 0;

        for (const lookupRow of filteredMatches) {
          const cell = lookupRow.find((c: AmendedSchemaField) => c.name === aggregateColumn);
          if (!cell) continue;

          const value = parseFloat(String(cell.resolvedKeyValue || "0"));
          if (isNaN(value)) continue;

          sum += value;
          count++;
        }

        if (aggregateType === "sum") {
          aggregateValue = sum;
        } else if (aggregateType === "avg") {
          aggregateValue = count > 0 ? sum / count : 0;
        }
      }

      // Add aggregate value as new column in source row
      const columnName = `${aggregateColumn}_${aggregateType}`;
      const newSourceRow = [...nestedRow.sourceRow];
      newSourceRow.push({
        name: columnName,
        resolvedKeyValue: String(aggregateValue),
        type: typeof aggregateValue === "number" ? "I32" : "StringU8",
        fields: [{ type: "I32", val: aggregateValue }],
        isKey: false,
      } as AmendedSchemaField);

      // Clear lookup matches since we've aggregated them
      aggregatedRows.push({
        sourceRow: newSourceRow,
        lookupMatches: [],
      });
    }
  }

  console.log(`Aggregate Nested Node ${nodeId}: INPUT had ${inputData.rows.length} parent rows`);
  console.log(`Aggregate Nested Node ${nodeId}: OUTPUT has ${aggregatedRows.length} parent rows`);

  return {
    success: true,
    data: {
      type: "NestedTableSelection",
      rows: aggregatedRows,
      sourceTable: inputData.sourceTable,
      lookupTable: inputData.lookupTable,
    },
  };
}

async function executeGroupByNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Group By Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse configuration from textValue
  let groupByColumns: string[] = [];
  let aggregations: Array<{
    sourceColumn: string;
    operation: "max" | "min" | "sum" | "avg" | "count" | "first" | "last";
    outputName: string;
    defaultValue?: string;
  }> = [];

  try {
    const parsed = JSON.parse(textValue);
    groupByColumns = parsed.groupByColumns || [];
    aggregations = parsed.aggregations || [];
  } catch (error) {
    console.error(`Group By Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid group by configuration" };
  }

  if (groupByColumns.length === 0) {
    return { success: false, error: "No group by columns specified" };
  }

  if (aggregations.length === 0) {
    return { success: false, error: "No aggregations specified" };
  }

  console.log(
    `Group By Node ${nodeId}: Grouping by [${groupByColumns.join(", ")}] with ${
      aggregations.length
    } aggregation(s)`
  );

  // Process each table
  const groupedTables: DBTablesNodeTable[] = [];

  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      // Skip tables without schema
      groupedTables.push(tableData);
      continue;
    }

    // Chunk into rows
    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    console.log(`Group By Node ${nodeId}: Processing table "${tableData.name}" with ${rows.length} rows`);

    // Group rows by specified columns
    const groups = new Map<string, AmendedSchemaField[][]>();

    for (const row of rows) {
      // Create group key from group by columns
      const keyParts: string[] = [];
      for (const colName of groupByColumns) {
        const cell = row.find((c: AmendedSchemaField) => c.name === colName);
        if (!cell) {
          console.warn(
            `Group By Node ${nodeId}: Group by column "${colName}" not found in row, skipping row`
          );
          continue;
        }
        keyParts.push(String(cell.resolvedKeyValue || ""));
      }

      const groupKey = keyParts.join("||"); // Use || as separator
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(row);
    }

    console.log(`Group By Node ${nodeId}: Grouped ${rows.length} rows into ${groups.size} groups`);

    // For each group, compute aggregations
    const groupedRows: AmendedSchemaField[][] = [];

    for (const [groupKey, groupRows] of groups) {
      if (groupRows.length === 0) continue;

      // Start with the group key columns from the first row
      const outputRow: AmendedSchemaField[] = [];

      for (const colName of groupByColumns) {
        const cell = groupRows[0].find((c: AmendedSchemaField) => c.name === colName);
        if (cell) {
          outputRow.push({ ...cell });
        }
      }

      // Compute each aggregation
      for (const agg of aggregations) {
        let aggregateValue: any;

        if (agg.operation === "count") {
          aggregateValue = groupRows.length;
        } else if (agg.operation === "first") {
          const cell = groupRows[0].find((c: AmendedSchemaField) => c.name === agg.sourceColumn);
          aggregateValue = cell ? cell.resolvedKeyValue : "";
        } else if (agg.operation === "last") {
          const cell = groupRows[groupRows.length - 1].find(
            (c: AmendedSchemaField) => c.name === agg.sourceColumn
          );
          aggregateValue = cell ? cell.resolvedKeyValue : "";
        } else {
          // max, min, sum, avg - need numeric values
          let values: number[] = [];

          for (const row of groupRows) {
            const cell = row.find((c: AmendedSchemaField) => c.name === agg.sourceColumn);
            if (!cell) continue;

            const value = parseFloat(String(cell.resolvedKeyValue || "0"));
            if (!isNaN(value)) {
              values.push(value);
            }
          }

          if (values.length === 0) {
            // Use default value if provided, otherwise use 0
            if (agg.defaultValue !== undefined && agg.defaultValue !== "") {
              const parsedDefault = parseFloat(agg.defaultValue);
              aggregateValue = isNaN(parsedDefault) ? agg.defaultValue : parsedDefault;
            } else {
              aggregateValue = 0;
            }
          } else {
            switch (agg.operation) {
              case "max":
                aggregateValue = Math.max(...values);
                break;
              case "min":
                aggregateValue = Math.min(...values);
                break;
              case "sum":
                aggregateValue = values.reduce((sum, val) => sum + val, 0);
                break;
              case "avg":
                aggregateValue = values.reduce((sum, val) => sum + val, 0) / values.length;
                break;
              default:
                aggregateValue = 0;
            }
          }
        }

        // Add aggregated value as new column
        outputRow.push({
          name: agg.outputName,
          resolvedKeyValue: aggregateValue,
          type: typeof aggregateValue === "number" ? "I32" : "StringU8",
          fields: [
            typeof aggregateValue === "number"
              ? { type: "I32", val: aggregateValue }
              : { type: "StringU8", val: String(aggregateValue) },
          ],
          isKey: false,
        } as AmendedSchemaField);
      }

      groupedRows.push(outputRow);
    }

    console.log(
      `Group By Node ${nodeId}: Output ${groupedRows.length} grouped rows from ${rows.length} input rows`
    );

    // Flatten grouped rows back into schemaFields array
    const groupedSchemaFields: AmendedSchemaField[] = [];
    for (const row of groupedRows) {
      groupedSchemaFields.push(...row);
    }

    // Build new table schema that matches the output structure
    const newSchemaFields: DBField[] = [];

    // Add group by columns to schema
    for (const colName of groupByColumns) {
      // Try to find the field in the original schema
      const originalField = tableData.table.tableSchema?.fields.find(
        (field: DBField) => field.name === colName
      );

      if (originalField) {
        console.log(`Group By: Found original field for ${colName}, type=${originalField.field_type}`);
        newSchemaFields.push({ ...originalField });
      } else {
        // If not found, look in the actual schemaFields to infer the type
        console.log(`Group By: Original field not found for ${colName}, inferring from data`);
        const sampleField = groupedRows[0]?.find((f: AmendedSchemaField) => f.name === colName);
        if (sampleField) {
          console.log(
            `Group By: Found sample field: name=${sampleField.name}, type=${sampleField.type}, isKey=${sampleField.isKey}`
          );
          newSchemaFields.push({
            name: colName,
            field_type: sampleField.type as SCHEMA_FIELD_TYPE,
            is_key: sampleField.isKey || false,
            default_value: "",
            is_filename: false,
            is_reference: [],
            description: `Group by column: ${colName}`,
            ca_order: -1,
            is_bitwise: 0,
            enum_values: {},
          });
        } else {
          console.error(`Group By: ERROR - Could not find sample field for ${colName}`);
        }
      }
    }

    // Add aggregation columns to schema
    for (const agg of aggregations) {
      newSchemaFields.push({
        name: agg.outputName,
        field_type: ["max", "min", "sum", "avg", "count"].includes(agg.operation) ? "I32" : "StringU8",
        is_key: false,
        default_value: "",
        is_filename: false,
        is_reference: [],
        description: `Aggregated column from ${agg.operation}(${agg.sourceColumn})`,
        ca_order: -1,
        is_bitwise: 0,
        enum_values: {},
      });
    }

    // Create new DBVersion with updated fields
    const schemaVersion = tableData.table.tableSchema?.version ?? 1;
    const newTableSchema: DBVersion = {
      version: schemaVersion,
      fields: newSchemaFields,
    };

    console.log(
      `Group By Node ${nodeId}: Created schema with ${newSchemaFields.length} fields (schema version=${schemaVersion}):`
    );
    newSchemaFields.forEach((f, idx) => {
      console.log(`  [${idx}] ${f.name} (${f.field_type}) key=${f.is_key}`);
    });

    // Create a new table with grouped data and updated schema
    const groupedTableData = {
      ...tableData,
      table: {
        ...tableData.table,
        schemaFields: groupedSchemaFields,
        tableSchema: newTableSchema,
      },
    };

    groupedTables.push(groupedTableData);
  }

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: groupedTables,
      sourceFiles: inputData.sourceFiles,
      tableCount: groupedTables.length,
    },
  };
}

async function executeDeduplicateNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Deduplicate Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse configuration from textValue
  let dedupeByColumns: string[] = [];

  try {
    const parsed = JSON.parse(textValue);
    dedupeByColumns = parsed.dedupeByColumns || [];
  } catch (error) {
    console.error(`Group By Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid group by configuration" };
  }

  console.log(`Deduplicate Node ${nodeId}: dedupeByColumns: [${dedupeByColumns.join(", ")}]`);

  if (dedupeByColumns.length === 0) {
    return { success: false, error: "No dedupe by columns specified" };
  }

  const dedupedTables = [] as DBTablesNodeTable[];
  const inputTableToDupes = new Map<number, Set<number>>();
  const alreadyPresentRowHashes = new Set<number>();

  // Process each table
  for (let tableIndex = 0; tableIndex < inputData.tables.length; tableIndex++) {
    const tableData = inputData.tables[tableIndex];
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    console.log(`Deduplicate Node ${nodeId}: Processing table "${tableData.name}" with ${rows.length} rows`);

    const dupes = new Set<number>();
    for (let i = 0; i < rows.length; i++) {
      if (dupes.has(i)) continue;

      const row = rows[i];

      let cellConcat = "";
      for (const dedupeColumn of dedupeByColumns) {
        const cell = row.find((c) => c.name === dedupeColumn);

        if (!cell) {
          continue;
        }

        cellConcat += cell.resolvedKeyValue;
      }

      const rowHash = cyrb53(cellConcat);

      if (!alreadyPresentRowHashes.has(rowHash)) {
        alreadyPresentRowHashes.add(rowHash);
      } else {
        dupes.add(i);
      }
    }

    if (dupes.size > 0) {
      inputTableToDupes.set(tableIndex, dupes);

      console.log(`${inputData.tables[tableIndex].name} has ${dupes.size} dupes`);
    }
  }

  for (let tableIndex = 0; tableIndex < inputData.tables.length; tableIndex++) {
    const tableData = inputData.tables[tableIndex];
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      dedupedTables.push(tableData);
      continue;
    }

    const dupes = inputTableToDupes.get(tableIndex);
    if (!dupes) {
      dedupedTables.push(tableData);
      continue;
    }

    const rows = chunkSchemaIntoRows(
      tableData.table.schemaFields,
      tableData.table.tableSchema
    ) as AmendedSchemaField[][];

    console.log(`Deduplicate Node ${nodeId}: Processing table "${tableData.name}" with ${rows.length} rows`);

    const dedupedRows = [] as AmendedSchemaField[][];

    for (let i = 0; i < rows.length; i++) {
      if (!dupes.has(i)) dedupedRows.push(rows[i]);
    }

    dedupedTables.push({
      name: tableData.name,
      fileName: tableData.fileName,
      sourceFile: tableData.sourceFile,
      table: {
        ...tableData.table,
        tableSchema: tableData.table.tableSchema,
        schemaFields: dedupedRows.flat(),
        version: tableData.table.version,
      },
    });
  }

  console.log(`Deduplicate Node ${nodeId}: Match output has ${dedupedTables.length} tables`);

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: dedupedTables,
      sourceFiles: inputData.sourceFiles,
      tableCount: dedupedTables.length,
    } as DBTablesNodeData,
  };
}

async function executeGenerateRowsNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Generate Rows Node ${nodeId}: Starting execution`);

  // 1. Parse configuration from textValue
  let config: {
    transformations: Array<{
      sourceColumn: string;
      transformationType:
        | "none"
        | "prefix"
        | "suffix"
        | "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "concatenate"
        | "formula"
        | "counter"
        | "filterequal"
        | "filternotequal";
      prefix?: string;
      suffix?: string;
      numericValue?: number;
      startNumber?: number;
      separator?: string;
      formula?: string;
      filterValue?: string;
      outputColumnName: string;
      targetTableHandleId: string; // Which output table this transformation is for
    }>;
    outputTables: Array<{
      handleId: string;
      name: string;
      existingTableName: string;
      columnMapping: string[];
      staticValues?: Record<string, string>;
    }>;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
  };

  try {
    console.log(`Generate Rows Node ${nodeId}: textValue to parse:`, textValue);
    config = JSON.parse(textValue);
    console.log(
      `Generate Rows Node ${nodeId}: Parsed - transformations length:`,
      (config.transformations || []).length
    );
    console.log(
      `Generate Rows Node ${nodeId}: Parsed - outputTables length:`,
      (config.outputTables || []).length
    );
  } catch (error) {
    console.log(`Generate Rows Node ${nodeId}: JSON parse error:`, error);
    return {
      success: false,
      error: `Invalid configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }

  if (!config.transformations || !config.outputTables) {
    console.log(`Generate Rows Node ${nodeId}: Missing transformations or outputTables!`);
    return {
      success: false,
      error: "Missing transformations or outputTables in configuration",
    };
  }

  console.log(`Generate Rows Node ${nodeId}: Configuration parsed (excluding DBNameToDBVersions):`, {
    transformations: config.transformations,
    outputTables: config.outputTables,
    hasDBNameToDBVersions: !!config.DBNameToDBVersions,
  });

  // 2. Extract input rows from ALL input tables
  if (!inputData.tables || inputData.tables.length === 0) {
    return {
      success: false,
      error: "No input tables found",
    };
  }

  // Collect rows from all input tables (handles multiple tables with same name from different mods)
  const rows: AmendedSchemaField[][] = [];
  const sourceTable = inputData.tables[0]; // Keep first table for metadata (fileName, sourceFile, etc.)

  for (const table of inputData.tables) {
    if (!table.table.tableSchema) {
      console.warn(`Generate Rows Node ${nodeId}: Skipping table ${table.name} - no schema information`);
      continue;
    }

    const tableRows = table.table.schemaFields
      ? (chunkSchemaIntoRows(table.table.schemaFields, table.table.tableSchema) as AmendedSchemaField[][])
      : [];

    rows.push(...tableRows);
  }

  console.log(
    `Generate Rows Node ${nodeId}: Collected ${rows.length} rows from ${inputData.tables.length} input tables`
  );

  // If no rows, return empty output for each configured output table
  // This allows the flow to continue on other branches
  if (rows.length === 0) {
    console.log(`Generate Rows Node ${nodeId}: No input rows - returning empty output tables`);

    // Create empty TableSelection data
    const emptyTableSelection: DBTablesNodeData = {
      type: "TableSelection",
      tables: [],
      sourceFiles: inputData.sourceFiles || [],
      tableCount: 0,
    };

    // Always return as a map by handle ID for proper extraction by node graph executor
    const emptyOutputs: Record<string, DBTablesNodeData> = {};
    for (const outputTable of config.outputTables) {
      emptyOutputs[outputTable.handleId] = emptyTableSelection;
    }

    return {
      success: true,
      data: emptyOutputs,
    };
  }

  console.log(`Generate Rows Node ${nodeId}: Processing ${rows.length} input rows`);

  // 3. Prepare counter transformations
  // For each counter transformation, we need to:
  // - Get the sourceColumn to track used values
  // - Initialize counter state for this transformation
  const counterStates = new Map<
    string,
    {
      currentNumber: number;
      usedNumbers: Set<number>;
      sourceColumn: string;
    }
  >();

  for (const transformation of config.transformations) {
    if (transformation.transformationType === "counter") {
      const startNumber = transformation.startNumber || 10000;
      const sourceColumn = transformation.sourceColumn;

      // Collect all existing values from the input column
      const existingValues = new Set<number>();
      for (const row of rows) {
        const sourceCell = row.find((c: AmendedSchemaField) => c.name === sourceColumn);
        if (sourceCell) {
          const numValue = parseFloat(String(sourceCell.resolvedKeyValue));
          if (!isNaN(numValue)) {
            existingValues.add(Math.floor(numValue));
          }
        }
      }

      // Get or initialize global tracking for this source column
      if (!globalCounterTracking.has(sourceColumn)) {
        globalCounterTracking.set(sourceColumn, new Set());
      }
      const globalUsedNumbers = globalCounterTracking.get(sourceColumn)!;

      // Merge existing values with global tracking
      for (const val of existingValues) {
        globalUsedNumbers.add(val);
      }

      // Initialize counter state for this transformation
      const key = `${transformation.targetTableHandleId}:${transformation.outputColumnName}`;
      counterStates.set(key, {
        currentNumber: startNumber,
        usedNumbers: new Set([...existingValues, ...globalUsedNumbers]),
        sourceColumn: sourceColumn,
      });

      console.log(
        `Generate Rows Node ${nodeId}: Initialized counter for "${key}" starting at ${startNumber} with ${existingValues.size} existing values`
      );
    }
  }

  // 4. Apply transformations to each row
  // Note: We'll process transformations per output table to handle targetTableHandleId
  // For now, build a map of all transformations to support legacy mode (no targetTableHandleId)
  const globalTransformedData = new Map<string, any[]>(); // outputColumnName -> array of values

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    // const rowColumnNames = row.map((c: AmendedSchemaField) => c.name);
    // console.log(`Generate Rows Node ${nodeId}: Row ${rowIdx} has columns:`, rowColumnNames);

    // Check if this row should be filtered out (skip if filter conditions match)
    let skipRow = false;
    for (const transformation of config.transformations) {
      if (
        transformation.transformationType === "filterequal" ||
        transformation.transformationType === "filternotequal"
      ) {
        const sourceCell = row.find((c: AmendedSchemaField) => c.name === transformation.sourceColumn);
        if (sourceCell) {
          const cellValue = String(sourceCell.resolvedKeyValue || "");
          const filterValue = transformation.filterValue || "";

          if (transformation.transformationType === "filterequal" && cellValue === filterValue) {
            // Skip this row if value equals filter value
            skipRow = true;
            break;
          } else if (transformation.transformationType === "filternotequal" && cellValue !== filterValue) {
            // Skip this row if value does not equal filter value
            skipRow = true;
            break;
          }
        }
      }
    }

    // Skip to next row if this row should be filtered out
    if (skipRow) {
      continue;
    }

    // Track transformed values for this row to enable transformation chaining
    const rowTransformedValues = new Map<string, any>();

    // Process all transformations (will filter per table later)
    for (const transformation of config.transformations) {
      // console.log(
      //   `Generate Rows Node ${nodeId}: Looking for column "${transformation.sourceColumn}" in row ${rowIdx}`
      // );

      // First check if source column is a transformed value from a previous transformation
      let sourceCell: AmendedSchemaField | undefined;
      let outputValue: any;

      if (rowTransformedValues.has(transformation.sourceColumn)) {
        // Source is from a previous transformation in this chain
        outputValue = rowTransformedValues.get(transformation.sourceColumn);
        // Create a fake sourceCell for compatibility
        sourceCell = {
          name: transformation.sourceColumn,
          fields: [{ type: "String", val: String(outputValue) }],
          type: "StringU8" as SCHEMA_FIELD_TYPE,
          resolvedKeyValue: String(outputValue),
        };
      } else {
        // Source is from original row data
        sourceCell = row.find((c: AmendedSchemaField) => c.name === transformation.sourceColumn);
      }

      if (!sourceCell) {
        if (transformation.transformationType !== "counter") {
          console.warn(
            `Generate Rows Node ${nodeId}: Source column "${transformation.sourceColumn}" not found in row ${rowIdx}. Using default value.`
          );
        }

        // Use default values based on transformation type
        switch (transformation.transformationType) {
          case "add":
          case "subtract":
          case "multiply":
          case "divide":
            // For numeric transformations, use -1 so that "add 1" results in 0
            outputValue =
              transformation.transformationType === "add" && transformation.numericValue === 1 ? -1 : 0;
            break;
          case "counter":
            // Counter doesn't need a source value, it generates its own
            outputValue = 0; // Will be overwritten in the transformation logic
            break;
          case "filterequal":
          case "filternotequal":
            // Filter transformations are handled separately, skip
            continue;
          case "prefix":
          case "suffix":
          case "concatenate":
          case "none":
          default:
            // For string transformations, use empty string
            outputValue = "";
            break;
        }
      } else {
        // console.log(
        //   `Generate Rows Node ${nodeId}: Found column "${transformation.sourceColumn}" with value:`,
        //   sourceCell.resolvedKeyValue
        // );
        outputValue = sourceCell.resolvedKeyValue;
      }

      // Apply transformation
      switch (transformation.transformationType) {
        case "none":
          // Pass through unchanged
          break;

        case "prefix":
          outputValue = (transformation.prefix || "") + String(outputValue);
          break;

        case "suffix":
          outputValue = String(outputValue) + (transformation.suffix || "");
          break;

        case "add": {
          const numValue = parseFloat(String(outputValue));
          const addValue = transformation.numericValue || 0;
          outputValue = isNaN(numValue) ? 0 : numValue + addValue;
          break;
        }

        case "subtract": {
          const numValue = parseFloat(String(outputValue));
          const subtractValue = transformation.numericValue || 0;
          outputValue = isNaN(numValue) ? 0 : numValue - subtractValue;
          break;
        }

        case "multiply": {
          const numValue = parseFloat(String(outputValue));
          const multiplyValue = transformation.numericValue || 1;
          outputValue = isNaN(numValue) ? 0 : numValue * multiplyValue;
          break;
        }

        case "divide": {
          const numValue = parseFloat(String(outputValue));
          const divideValue = transformation.numericValue || 1;
          outputValue = isNaN(numValue) || divideValue === 0 ? 0 : numValue / divideValue;
          break;
        }

        case "concatenate":
          // Combine multiple source columns (for now, just use the one source)
          // TODO: Support multiple source columns when UI is ready
          outputValue = String(outputValue);
          break;

        case "formula":
          // Simple formula evaluation (for now, just pass through)
          // TODO: Implement formula parsing when needed
          console.warn(`Generate Rows Node ${nodeId}: Formula transformation not yet implemented`);
          break;

        case "counter": {
          // Generate a unique sequential number
          const key = `${transformation.targetTableHandleId}:${transformation.outputColumnName}`;
          const counterState = counterStates.get(key);

          if (!counterState) {
            console.error(`Generate Rows Node ${nodeId}: Counter state not found for "${key}"`);
            outputValue = 0;
            break;
          }

          // Find the next available number
          let candidateNumber = counterState.currentNumber;
          while (counterState.usedNumbers.has(candidateNumber)) {
            candidateNumber++;
          }

          // Mark this number as used
          counterState.usedNumbers.add(candidateNumber);
          globalCounterTracking.get(counterState.sourceColumn)!.add(candidateNumber);

          // Update current number for next iteration
          counterState.currentNumber = candidateNumber + 1;

          outputValue = candidateNumber;
          break;
        }

        case "filterequal":
        case "filternotequal":
          // Filter transformations are handled before row processing
          // They don't produce output values, so skip storing them
          continue;

        default:
          console.warn(
            `Generate Rows Node ${nodeId}: Unknown transformation type "${transformation.transformationType}"`
          );
      }

      // Store with a key that includes targetTableHandleId for filtering
      const key = `${transformation.targetTableHandleId}:${transformation.outputColumnName}`;

      if (!globalTransformedData.has(key)) {
        globalTransformedData.set(key, []);
      }
      globalTransformedData.get(key)!.push(outputValue);

      // Store in row-level map for transformation chaining
      // This allows subsequent transformations to use this output as their source
      if (transformation.outputColumnName) {
        rowTransformedValues.set(transformation.outputColumnName, outputValue);
      }
    }
  }

  console.log(`Generate Rows Node ${nodeId}: Transformations applied`, {
    columnCount: globalTransformedData.size,
    keys: Array.from(globalTransformedData.keys()),
  });

  // 4. Create output tables
  const outputs: Record<string, DBTablesNodeData> = {};

  for (const outputConfig of config.outputTables) {
    console.log(`Generate Rows Node ${nodeId}: Creating output table "${outputConfig.name}"`);

    // Look up existing table schema from DBNameToDBVersions
    const versions = config.DBNameToDBVersions?.[outputConfig.existingTableName];
    if (!versions || versions.length === 0) {
      return {
        success: false,
        error: `Table schema "${outputConfig.existingTableName}" not found`,
      };
    }

    const defaultTableVersions = await getDefaultTableVersions();
    const defaultTableVersionNumber =
      defaultTableVersions && defaultTableVersions[outputConfig.existingTableName];

    let schema = versions[0];
    if (defaultTableVersionNumber) {
      const version = versions.find((version) => version.version == defaultTableVersionNumber);
      if (version) schema = version;
    }

    console.log(`Generate Rows Node ${nodeId}: Using schema for "${outputConfig.existingTableName}"`, {
      fieldCount: schema.fields.length,
      fields: schema.fields.map((f: any) => f.name),
    });

    // Build rows for this output
    const outputRows: AmendedSchemaField[] = [];

    // Build a map of transformed data for this specific table
    const tableTransformedData = new Map<string, any[]>();
    for (const [key, values] of globalTransformedData.entries()) {
      const [tableId, colName] = key.split(":");
      if (tableId === outputConfig.handleId) {
        tableTransformedData.set(colName, values);
      }
    }

    // Get number of rows from any transformation for this table
    const numRows = tableTransformedData.values().next().value?.length || 0;

    // Get all columns from schema
    const allSchemaColumns = schema.fields.map((f: any) => f.name);

    for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
      // Process all columns in the schema IN ORDER (must include all fields for proper pack file structure)
      for (const columnName of allSchemaColumns) {
        let value: any;

        // Check if column is from transformed data (priority: table-specific transformations)
        if (tableTransformedData.has(columnName)) {
          value = tableTransformedData.get(columnName)?.[rowIdx];
        }
        // Otherwise use static value if provided
        else if (outputConfig.staticValues && outputConfig.staticValues[columnName] !== undefined) {
          value = outputConfig.staticValues[columnName];
        }
        // For optional fields, use empty string; for required fields, use type-appropriate default
        else {
          const fieldDef = schema.fields.find((f: any) => f.name === columnName);
          if (fieldDef?.field_type.startsWith("Optional")) {
            value = "";
          } else {
            // Use type-appropriate default for required fields
            switch (fieldDef?.field_type) {
              case "I32":
              case "I64":
              case "I16":
              case "F32":
              case "F64":
                value = 0;
                break;
              case "Boolean":
                value = 0;
                break;
              default:
                value = "";
            }
          }
        }

        const fieldDef = schema.fields.find((f: any) => f.name === columnName);

        if (!fieldDef) {
          return {
            success: false,
            error: `Column "${columnName}" not found in schema "${outputConfig.existingTableName}"`,
          };
        }

        // Convert value to appropriate type before serialization
        let convertedValue: any = value;
        switch (fieldDef.field_type) {
          case "I32":
          case "F32":
          case "I64":
          case "F64":
          case "I16":
            convertedValue = Number(value) || 0;
            break;
          case "Boolean":
            // Convert to number (0 or 1) for pack file serialization
            convertedValue = value === "true" || value === true || value === 1 ? 1 : 0;
            break;
          // String types keep their string values
          case "StringU8":
          case "StringU16":
          case "OptionalStringU8":
          case "ColourRGB":
          default:
            convertedValue = String(value);
            break;
        }

        // Use typeToBuffer to create proper pack file format with length prefixes
        const { typeToBuffer } = await import("./packFileSerializer");
        const fieldBuffer = await typeToBuffer(fieldDef.field_type, convertedValue);

        const schemaField: AmendedSchemaField = {
          name: columnName,
          resolvedKeyValue: String(value),
          type: fieldDef.field_type,
          fields: [{ type: "Buffer", val: fieldBuffer }],
          isKey: fieldDef.is_key || false,
        };

        outputRows.push(schemaField);
      }
    }

    console.log(`Generate Rows Node ${nodeId}: Created ${numRows} rows for output "${outputConfig.name}"`);

    // Create TableSelection for this output
    const outputTable: DBTablesNodeTable = {
      name: outputConfig.existingTableName,
      fileName: sourceTable.fileName,
      sourceFile: sourceTable.sourceFile,
      table: {
        ...sourceTable.table,
        tableSchema: schema,
        schemaFields: outputRows,
        version: schema.version,
      },
    };

    console.log(`Generate Rows Node ${nodeId}: Output table version set to ${schema.version}`);

    outputs[outputConfig.handleId] = {
      type: "TableSelection",
      tables: [outputTable],
      sourceFiles: inputData.sourceFiles || [],
      tableCount: 1,
    };
  }

  console.log(`Generate Rows Node ${nodeId}: Generated ${Object.keys(outputs).length} output tables`);

  // 5. Return multi-output result
  return {
    success: true,
    data: outputs,
  };
}

async function executeAddNewColumnNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Add New Column Node ${nodeId}: Starting execution`);

  // 1. Parse configuration from textValue
  let config: {
    transformations: Array<{
      sourceColumn: string;
      transformationType:
        | "none"
        | "prefix"
        | "suffix"
        | "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "rename_whole"
        | "rename_substring"
        | "replace_substring_whole"
        | "regex_replace"
        | "filterequal"
        | "filternotequal";
      prefix?: string;
      suffix?: string;
      numericValue?: number;
      filterValue?: string;
      matchValue?: string;
      replaceValue?: string;
      findSubstring?: string;
      regexPattern?: string;
      regexReplacement?: string;
      outputColumnName: string;
    }>;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
  };

  try {
    config = JSON.parse(textValue);
    console.log(
      `Add New Column Node ${nodeId}: Parsed ${(config.transformations || []).length} transformations`
    );
  } catch (error) {
    return {
      success: false,
      error: `Invalid configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }

  if (!config.transformations) {
    return {
      success: false,
      error: "Missing transformations in configuration",
    };
  }

  // 2. Extract input rows from ALL input tables
  if (!inputData.tables || inputData.tables.length === 0) {
    return {
      success: false,
      error: "No input tables found",
    };
  }

  // Collect rows from all input tables
  const rows: AmendedSchemaField[][] = [];
  const sourceTable = inputData.tables[0]; // Keep first table for metadata

  for (const table of inputData.tables) {
    if (!table.table.tableSchema) {
      console.warn(`Add New Column Node ${nodeId}: Skipping table ${table.name} - no schema information`);
      continue;
    }

    const tableRows = table.table.schemaFields
      ? (chunkSchemaIntoRows(table.table.schemaFields, table.table.tableSchema) as AmendedSchemaField[][])
      : [];

    rows.push(...tableRows);
  }

  console.log(
    `Add New Column Node ${nodeId}: Collected ${rows.length} rows from ${inputData.tables.length} input tables`
  );

  if (rows.length === 0) {
    // Return empty output
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.sourceFiles || [],
        tableCount: 0,
      },
    };
  }

  // Helper function to escape regex special characters
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Helper to check if transformation is a filter
  function isFilterTransformation(trans: (typeof config.transformations)[0]): boolean {
    return trans.transformationType === "filterequal" || trans.transformationType === "filternotequal";
  }

  // 3. Process each row and apply transformations
  const transformedData = new Map<string, any[]>(); // outputColumnName -> array of values for each row
  const filteredRowIndices = new Set<number>(); // Track which rows to exclude

  for (const trans of config.transformations) {
    transformedData.set(trans.outputColumnName, []);
  }

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const rowTransformedValues = new Map<string, any>(); // Per-row transformation outputs for chaining

    // Process transformations in order (to support chaining)
    for (const transformation of config.transformations) {
      let outputValue: any;

      // Get source value - either from original row or previous transformation (chaining)
      if (rowTransformedValues.has(transformation.sourceColumn)) {
        outputValue = rowTransformedValues.get(transformation.sourceColumn);
      } else {
        const sourceCell = row.find((c) => c.name === transformation.sourceColumn);
        outputValue = sourceCell?.resolvedKeyValue ?? "";
      }

      // Apply transformation
      switch (transformation.transformationType) {
        case "none":
          // Pass through
          break;

        case "prefix":
          outputValue = `${transformation.prefix || ""}${outputValue}`;
          break;

        case "suffix":
          outputValue = `${outputValue}${transformation.suffix || ""}`;
          break;

        case "add":
          outputValue = parseFloat(String(outputValue)) + (transformation.numericValue || 0);
          break;

        case "subtract":
          outputValue = parseFloat(String(outputValue)) - (transformation.numericValue || 0);
          break;

        case "multiply":
          outputValue = parseFloat(String(outputValue)) * (transformation.numericValue || 1);
          break;

        case "divide":
          const divisor = transformation.numericValue || 1;
          outputValue = divisor !== 0 ? parseFloat(String(outputValue)) / divisor : 0;
          break;

        case "rename_whole":
          const strValue = String(outputValue);
          const matchValue = transformation.matchValue || "";
          if (strValue === matchValue) {
            outputValue = transformation.replaceValue || "";
          }
          // Otherwise keep original value
          break;

        case "rename_substring":
          const findStr = transformation.findSubstring || "";
          const replaceStr = transformation.replaceValue || "";
          if (findStr) {
            outputValue = String(outputValue).replace(new RegExp(escapeRegex(findStr), "g"), replaceStr);
          }
          break;

        case "replace_substring_whole":
          const searchSubstr = transformation.findSubstring || "";
          const wholeReplacement = transformation.replaceValue || "";
          if (searchSubstr && String(outputValue).includes(searchSubstr)) {
            outputValue = wholeReplacement;
          }
          // Otherwise keep original value
          break;

        case "regex_replace":
          try {
            const pattern = transformation.regexPattern || "";
            const replacement = transformation.regexReplacement || "";
            if (pattern) {
              const regex = new RegExp(pattern, "g");
              outputValue = String(outputValue).replace(regex, replacement);
            }
          } catch (error) {
            console.warn(
              `Add New Column Node ${nodeId}: Invalid regex pattern "${transformation.regexPattern}":`,
              error
            );
            // Keep original value on error
          }
          break;

        case "filterequal":
          if (String(outputValue) === (transformation.filterValue || "")) {
            filteredRowIndices.add(rowIdx);
          }
          break;

        case "filternotequal":
          if (String(outputValue) !== (transformation.filterValue || "")) {
            filteredRowIndices.add(rowIdx);
          }
          break;
      }

      // Store transformed value for this row (for chaining and output)
      rowTransformedValues.set(transformation.outputColumnName, outputValue);
    }

    // Store all transformed values for this row
    for (const transformation of config.transformations) {
      const value = rowTransformedValues.get(transformation.outputColumnName);
      transformedData.get(transformation.outputColumnName)!.push(value);
    }
  }

  console.log(`Add New Column Node ${nodeId}: Filtered out ${filteredRowIndices.size} rows`);

  // 4. Build output table with original columns + new columns
  const outputRows: AmendedSchemaField[] = [];
  let outputRowIdx = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    // Skip filtered rows
    if (filteredRowIndices.has(rowIdx)) {
      continue;
    }

    const row = rows[rowIdx];

    // Copy all original columns
    for (const cell of row) {
      outputRows.push(cell);
    }

    // Append new transformed columns (excluding filter transformations)
    for (const transformation of config.transformations) {
      if (isFilterTransformation(transformation)) continue;

      const value = transformedData.get(transformation.outputColumnName)?.[rowIdx];

      // Create schema field for the new column
      const { typeToBuffer } = await import("./packFileSerializer");
      const fieldBuffer = await typeToBuffer("StringU8", String(value ?? ""));

      const schemaField: AmendedSchemaField = {
        name: transformation.outputColumnName,
        resolvedKeyValue: String(value ?? ""),
        type: "StringU8",
        fields: [{ type: "Buffer", val: fieldBuffer }],
        isKey: false,
      };

      outputRows.push(schemaField);
    }

    outputRowIdx++;
  }

  console.log(`Add New Column Node ${nodeId}: Created ${outputRowIdx} output rows with added columns`);

  // 5. Create extended schema (original fields + new fields)
  const inputSchema = sourceTable.table.tableSchema!;
  const extendedSchema: DBVersion = {
    ...inputSchema,
    fields: [
      ...inputSchema.fields,
      ...config.transformations
        .filter((t) => !isFilterTransformation(t))
        .map((t) => ({
          name: t.outputColumnName,
          field_type: "StringU8" as SCHEMA_FIELD_TYPE,
          is_key: false,
          default_value: "",
          is_filename: false,
          is_reference: [],
          description: `Generated column from ${t.transformationType}(${t.sourceColumn})`,
          ca_order: -1,
          is_bitwise: 0,
          enum_values: {},
        })),
    ],
  };

  // 6. Create output table
  const outputTable: DBTablesNodeTable = {
    name: sourceTable.name,
    fileName: sourceTable.fileName,
    sourceFile: sourceTable.sourceFile,
    table: {
      ...sourceTable.table,
      tableSchema: extendedSchema,
      schemaFields: outputRows,
      version: extendedSchema.version,
    },
  };

  // 7. Return single TableSelection output
  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: [outputTable],
      sourceFiles: inputData.sourceFiles || [],
      tableCount: 1,
    },
  };
}

async function executeDumpToTSVNode(
  nodeId: string,
  textValue: string,
  inputData: DumpToTSVNodeData
): Promise<NodeExecutionResult> {
  console.log(
    `Dump to TSV Node ${nodeId}: Processing with input:`,
    { ...inputData, tables: [] },
    ", num tables:",
    inputData.tables.length
  );

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Handle empty input - return success without writing file
  if (!inputData.tables || inputData.tables.length === 0) {
    console.log(`Dump to TSV Node ${nodeId}: No tables to dump - skipping file write`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.sourceFiles || [],
        tableCount: 0,
      },
    };
  }

  // Parse filename and openInWindows from textValue (it's stored as JSON with filename key)
  let openInWindows = false;
  let filename = "";
  try {
    const parsed = JSON.parse(textValue || "{}");
    filename = parsed.filename || "";
    openInWindows = parsed.openInWindows ?? false;
  } catch (error) {
    // If parsing fails, use textValue directly
    filename = textValue || "";
  }

  // Generate filename if not provided
  if (!filename) {
    filename = `table_dump_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.tsv`;
  }

  // Ensure .tsv extension
  if (!filename.endsWith(".tsv")) {
    filename += ".tsv";
  }

  const fs = require("fs");
  const nodePath = require("path");

  try {
    // Get game path from appData
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string;

    // Build TSV content
    const tsvLines: string[] = [];

    for (const tableData of inputData.tables) {
      if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
        console.warn(`Dump to TSV Node ${nodeId}: Skipping table without schema data`);
        continue;
      }

      // Chunk into rows
      const rows = chunkSchemaIntoRows(
        tableData.table.schemaFields,
        tableData.table.tableSchema
      ) as AmendedSchemaField[][];

      console.log(`Dump to TSV Node ${nodeId}: Processing table with ${rows.length} rows`);

      // Get column names from first row
      if (rows.length > 0 && tsvLines.length === 0) {
        const columnNames = rows[0].map((cell: AmendedSchemaField) => cell.name);
        tsvLines.push(columnNames.join("\t"));
      }

      // Add data rows
      for (const row of rows) {
        const values = row.map((cell: AmendedSchemaField) => {
          const value = cell.resolvedKeyValue;
          // Escape tabs and newlines in values
          return String(value || "")
            .replace(/\t/g, " ")
            .replace(/\n/g, " ");
        });
        tsvLines.push(values.join("\t"));
      }
    }

    // If no lines were generated, return success without writing empty file
    if (tsvLines.length === 0) {
      console.log(`Dump to TSV Node ${nodeId}: No rows to dump - skipping file write`);
      return {
        success: true,
        data: {
          type: "TableSelection",
          tables: inputData.tables,
          sourceFiles: inputData.sourceFiles || [],
          tableCount: inputData.tableCount || inputData.tables.length,
        },
      };
    }

    // Write to file in game folder (not data folder)
    const outputPath = nodePath.join(gamePath, filename);
    fs.writeFileSync(outputPath, tsvLines.join("\n"), "utf-8");

    if (openInWindows) {
      const shellOutput = await shell.openPath(outputPath);
      console.log("shell output:", shellOutput);
    }

    console.log(`Dump to TSV Node ${nodeId}: Wrote ${tsvLines.length} lines to ${outputPath}`);

    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: inputData.tables,
        sourceFiles: inputData.sourceFiles || [],
        tableCount: inputData.tableCount || inputData.tables.length,
      },
    };
  } catch (error) {
    console.error(`Dump to TSV Node ${nodeId}: Error writing TSV file:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error writing TSV file",
    };
  }
}

async function executeGetCounterColumnNode(
  nodeId: string,
  textValue: string,
  inputData: PackFilesNodeData
): Promise<NodeExecutionResult> {
  console.log(`GetCounterColumn Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "PackFiles") {
    return { success: false, error: "Invalid input: Expected PackFiles data" };
  }

  // Parse configuration from textValue
  let selectedTable = "";
  let selectedColumn = "";
  let newColumnName = "";

  try {
    const config = JSON.parse(textValue || "{}");
    selectedTable = config.selectedTable || "";
    selectedColumn = config.selectedColumn || "";
    newColumnName = config.newColumnName || "";
  } catch (error) {
    console.error(`GetCounterColumn Node ${nodeId}: Error parsing configuration:`, error);
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }

  // Use defaults for missing configuration to allow flow to continue
  if (!selectedTable) {
    console.log(`GetCounterColumn Node ${nodeId}: No table selected - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.files || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  if (!selectedColumn) {
    console.log(`GetCounterColumn Node ${nodeId}: No column selected - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.files || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  // Use default column name if not specified
  if (!newColumnName) {
    newColumnName = `counter_${selectedColumn}`;
    console.log(`GetCounterColumn Node ${nodeId}: No column name specified, using default: ${newColumnName}`);
  }

  console.log(`GetCounterColumn Node ${nodeId}: Collecting values from ${selectedTable}.${selectedColumn}`);

  // Convert table name to db\ format if needed
  const tableName = selectedTable.startsWith("db\\") ? selectedTable : `db\\${selectedTable}`;

  const collectedValues: AmendedSchemaField[] = [];
  const sourcePacks: Pack[] = [];

  // Process each pack file
  for (const packFile of inputData.files) {
    if (!packFile.loaded) {
      console.warn(`GetCounterColumn Node ${nodeId}: Skipping unloaded file: ${packFile.name}`);
      continue;
    }

    try {
      // Read the pack file
      const pack = await readPack(packFile.path, { tablesToRead: [tableName] });
      getPacksTableData([pack], [tableName]);

      // Find tables that match the criteria
      const matchingTables = pack.packedFiles.filter((pf) => pf.name.includes(tableName));

      for (const table of matchingTables) {
        if (!table.schemaFields || !table.tableSchema) {
          console.warn(`GetCounterColumn Node ${nodeId}: Table without schema: ${table.name}`);
          continue;
        }

        // Chunk into rows
        const rows = chunkSchemaIntoRows(table.schemaFields, table.tableSchema) as AmendedSchemaField[][];

        console.log(`GetCounterColumn Node ${nodeId}: Found ${rows.length} rows in ${packFile.name}`);

        // Extract the selected column values from each row
        for (const row of rows) {
          const cell = row.find((c) => c.name === selectedColumn);
          if (cell) {
            // Create a new cell with the new column name
            collectedValues.push({
              ...cell,
              name: newColumnName,
            });
          }
        }
      }

      if (matchingTables.length > 0) {
        sourcePacks.push(pack);
      }
    } catch (error) {
      console.error(`GetCounterColumn Node ${nodeId}: Error processing ${packFile.name}:`, error);
    }
  }

  // If no values collected, return empty result to allow flow to continue
  if (collectedValues.length === 0) {
    console.log(`GetCounterColumn Node ${nodeId}: No values found - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: inputData.files || [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  console.log(`GetCounterColumn Node ${nodeId}: Collected ${collectedValues.length} values`);

  // Create the output table schema
  const firstCell = collectedValues[0];
  const outputTableSchema: DBVersion = {
    version: 1,
    fields: [
      {
        name: newColumnName,
        field_type: (firstCell.type as SCHEMA_FIELD_TYPE) || "StringU8",
        is_key: false,
        default_value: "",
        is_filename: false,
        is_reference: [],
        description: `Counter from ${selectedTable}.${selectedColumn}`,
        ca_order: 0,
        is_bitwise: 0,
        enum_values: {},
      },
    ],
  };

  // Create a synthetic PackedFile with the collected values
  const syntheticTable: PackedFile = {
    name: `db\\_counter_${selectedTable}`,
    schemaFields: collectedValues,
    tableSchema: outputTableSchema,
    file_size: 0,
    start_pos: 0,
  };

  const resultTables: DBTablesNodeTable[] = [
    {
      name: `_counter_${selectedTable}`,
      fileName: `db\\_counter_${selectedTable}`,
      sourceFile: sourcePacks[0],
      table: syntheticTable,
    },
  ];

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: resultTables,
      sourceFiles: inputData.files,
      tableCount: 1,
    } as DBTablesNodeData,
  };
}

async function executeCustomSchemaNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`CustomSchema Node ${nodeId}: Processing schema definition`);

  // Parse configuration from textValue
  let schemaColumns: Array<CustomSchemaColumn> = [];

  try {
    const config = JSON.parse(textValue || "{}");
    schemaColumns = config.schemaColumns || [];
  } catch (error) {
    console.error(`CustomSchema Node ${nodeId}: Error parsing configuration:`, error);
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }

  if (schemaColumns.length === 0) {
    console.log(`CustomSchema Node ${nodeId}: No columns defined - returning empty schema`);
  }

  console.log(`CustomSchema Node ${nodeId}: Schema defined with ${schemaColumns.length} columns`);

  return {
    success: true,
    data: {
      type: "CustomSchema",
      schemaColumns: schemaColumns,
    },
  };
}

async function executeReadTSVFromPackNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`ReadTSVFromPack Node ${nodeId}: Processing with input:`, inputData);

  // Handle both array input (new format with two inputs) and single input (backward compatibility)
  let schemaData: any;
  let packsData: any = null;

  if (Array.isArray(inputData)) {
    // New format: [schemaData, packsData]
    [schemaData, packsData] = inputData;
  } else {
    // Old format: single schemaData input
    schemaData = inputData;
  }

  if (!schemaData || schemaData.type !== "CustomSchema") {
    return { success: false, error: "Invalid input: Expected CustomSchema data" };
  }

  // Parse configuration from textValue
  let tsvFileName = "";
  const schemaColumns = (schemaData.schemaColumns || []) as CustomSchemaColumn[];

  console.log(`ReadTSVFromPack Node ${nodeId}: textValue received:`, textValue);

  try {
    const config = JSON.parse(textValue || "{}");
    tsvFileName = config.tsvFileName || "";
  } catch (error) {
    console.error(`ReadTSVFromPack Node ${nodeId}: Error parsing configuration:`, error);
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }

  if (!tsvFileName) {
    console.log(`ReadTSVFromPack Node ${nodeId}: No TSV file specified - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  if (schemaColumns.length === 0) {
    console.log(`ReadTSVFromPack Node ${nodeId}: No schema columns - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  // Determine which pack files to search
  let packFilesToSearch: string[] = [];

  if (packsData && packsData.type === "PackFiles") {
    // Use pack files from the connected input
    // Extract paths from the files array
    packFilesToSearch = (packsData.files || []).map((file: any) => file.path).filter((path: string) => path);
    console.log(
      `ReadTSVFromPack Node ${nodeId}: Searching for TSV file "${tsvFileName}" in ${packFilesToSearch.length} connected pack(s)`
    );
  } else {
    // Fall back to all enabled mods (backward compatibility)
    packFilesToSearch = appData.enabledMods.map((mod) => mod.path);
    console.log(
      `ReadTSVFromPack Node ${nodeId}: Searching for TSV file "${tsvFileName}" in ${packFilesToSearch.length} enabled pack(s)`
    );
  }

  tsvFileName = tsvFileName.replace(/\//g, "\\");

  // Search for TSV file in pack files
  let tsvContent: string | null = null;
  let sourcePack: Pack | null = null;

  for (const packFile of packFilesToSearch) {
    try {
      // Read the pack file without parsing tables
      const pack = await readPack(packFile, { skipParsingTables: true, filesToRead: [tsvFileName] });

      // Search for the TSV file in packed files
      const tsvFile = pack.packedFiles.find((pf) =>
        pf.name.toLowerCase().endsWith(tsvFileName.toLowerCase())
      );

      if (tsvFile) {
        console.log(`ReadTSVFromPack Node ${nodeId}: Found TSV file in pack: ${packFile}`);

        // TSV files should be stored as text
        if (tsvFile.text) {
          tsvContent = tsvFile.text;
          sourcePack = pack;
          break;
        } else if (tsvFile.buffer) {
          // If stored as buffer, convert to string
          tsvContent = tsvFile.buffer.toString("utf-8");
          sourcePack = pack;
          break;
        }
      }
    } catch (error) {
      console.warn(`ReadTSVFromPack Node ${nodeId}: Error reading pack ${packFile}:`, error);
      continue;
    }
  }

  if (!tsvContent) {
    console.log(`ReadTSVFromPack Node ${nodeId}: TSV file not found in any enabled packs`);
    return {
      success: false,
      error: `TSV file "${tsvFileName}" not found in any enabled packs`,
    };
  }

  // Parse TSV content
  // Split by newlines and filter out empty lines (including trailing empty lines at end of file)
  const lines = tsvContent.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    console.log(`ReadTSVFromPack Node ${nodeId}: TSV file is empty`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  if (lines.length === 1) {
    console.log(`ReadTSVFromPack Node ${nodeId}: TSV file only contains header, no data rows`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  // First line is header, skip it and parse data rows
  const dataLines = lines.slice(1);

  console.log(
    `ReadTSVFromPack Node ${nodeId}: Parsing ${dataLines.length} data rows with ${schemaColumns.length} columns`
  );

  // Create the output table schema from the schema columns
  const outputTableSchema: DBVersion = {
    version: 1,
    fields: schemaColumns.map((col, index) => ({
      name: col.name,
      field_type: col.type,
      is_key: index === 0, // First column is key by default
      default_value: "",
      is_filename: false,
      is_reference: [],
      description: `Column ${col.name} from TSV`,
      ca_order: index,
      is_bitwise: 0,
      enum_values: {},
    })),
  };

  // Convert TSV rows to AmendedSchemaField arrays
  const schemaFields: AmendedSchemaField[] = [];

  for (const line of dataLines) {
    const values = line.split("\t");
    console.log("ReadTSVFromPack values:", values);
    console.log("ReadTSVFromPack num values:", values.length);

    // Ensure we have enough values for all columns
    for (let i = 0; i < schemaColumns.length; i++) {
      const col = schemaColumns[i];
      const value = values[i] || "";

      schemaFields.push({
        name: col.name,
        fields: [{ type: "String", val: value }],
        type: col.type,
        resolvedKeyValue: value,
      });
    }
  }

  // Create a synthetic PackedFile with the TSV data
  const syntheticTable: PackedFile = {
    name: `db\\_tsv_${tsvFileName.replace(/\.tsv$/i, "")}`,
    schemaFields: schemaFields,
    tableSchema: outputTableSchema,
    file_size: 0,
    start_pos: 0,
  };

  const resultTables: DBTablesNodeTable[] = [
    {
      name: `_tsv_${tsvFileName.replace(/\.tsv$/i, "")}`,
      fileName: `db\\_tsv_${tsvFileName.replace(/\.tsv$/i, "")}`,
      sourceFile: sourcePack || (undefined as any),
      table: syntheticTable,
    },
  ];

  console.log(`ReadTSVFromPack Node ${nodeId}: Successfully parsed ${dataLines.length} rows from TSV file`);

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: resultTables,
      sourceFiles: [],
      tableCount: 1,
    } as DBTablesNodeData,
  };
}

async function executeCustomRowsInputNode(
  nodeId: string,
  textValue: string,
  inputData: any
): Promise<NodeExecutionResult> {
  console.log(`CustomRowsInput Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "CustomSchema") {
    return { success: false, error: "Invalid input: Expected CustomSchema data" };
  }

  // Parse configuration from textValue
  let customRows: Array<Record<string, string>> = [];
  const schemaColumns = (inputData.schemaColumns || []) as CustomSchemaColumn[];

  try {
    const config = JSON.parse(textValue || "{}");
    customRows = config.customRows || [];
  } catch (error) {
    console.error(`CustomRowsInput Node ${nodeId}: Error parsing configuration:`, error);
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }

  if (schemaColumns.length === 0) {
    console.log(`CustomRowsInput Node ${nodeId}: No schema columns - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  if (customRows.length === 0) {
    console.log(`CustomRowsInput Node ${nodeId}: No rows defined - returning empty output`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: [],
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  console.log(
    `CustomRowsInput Node ${nodeId}: Creating table with ${customRows.length} rows and ${schemaColumns.length} columns`
  );

  // Create the output table schema from the schema columns
  const outputTableSchema: DBVersion = {
    version: 1,
    fields: schemaColumns.map((col, index) => ({
      name: col.name,
      field_type: col.type,
      is_key: index === 0, // First column is key by default
      default_value: "",
      is_filename: false,
      is_reference: [],
      description: `Custom column ${col.name}`,
      ca_order: index,
      is_bitwise: 0,
      enum_values: {},
    })),
  };

  // Convert custom rows to AmendedSchemaField arrays
  const schemaFields: AmendedSchemaField[] = [];

  for (const row of customRows) {
    for (const col of schemaColumns) {
      const value = row[col.name] || "";
      schemaFields.push({
        name: col.name,
        resolvedKeyValue: value,
        type: col.type,
        fields: [{ type: "String", val: value }],
      });
    }
  }

  // Create a synthetic PackedFile with the custom rows
  const syntheticTable: PackedFile = {
    name: `db\\_custom_${nodeId}`,
    schemaFields: schemaFields,
    tableSchema: outputTableSchema,
    file_size: 0,
    start_pos: 0,
  };

  const resultTables: DBTablesNodeTable[] = [
    {
      name: `_custom_${nodeId}`,
      fileName: `db\\_custom_${nodeId}`,
      sourceFile: undefined as any,
      table: syntheticTable,
    },
  ];

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: resultTables,
      sourceFiles: [],
      tableCount: 1,
    } as DBTablesNodeData,
  };
}
