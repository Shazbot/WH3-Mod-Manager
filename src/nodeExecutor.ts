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
import { AmendedSchemaField, NewPackedFile } from "./packFileTypes";
import { format } from "date-fns";
import { gameToPackWithDBTablesName } from "./supportedGames";

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

async function executePackFilesDropdownNode(
  nodeId: string,
  selectedPack: string
): Promise<NodeExecutionResult> {
  console.log(`PackFiles Dropdown Node ${nodeId}: Processing selected pack "${selectedPack}"`);

  const packFiles = [] as PackFilesNodeFile[];

  if (!selectedPack || selectedPack.trim() === "") {
    return {
      success: false,
      error: "No pack selected. Please select a pack from the dropdown.",
    };
  }

  try {
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
        selectedTables.push({
          name: tableName,
          fileName: table.name,
          sourceFile: file,
          table,
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
  console.log(`Filter Node ${nodeId}: Processing filters with input:`, inputData);

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

async function executeReferenceLookupNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData
): Promise<NodeExecutionResult> {
  console.log(`Reference Lookup Node ${nodeId}: Processing with input:`, inputData);

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
  console.log(`Reverse Reference Lookup Node ${nodeId}: Processing with input:`, inputData);

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
          if (packedFile.name.startsWith("db\\") && !packedFile.name.includes("_to_")) {
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
          !packedFile.name.includes("_to_") &&
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
    `ColumnSelection Dropdown Node ${nodeId}: Processing selected column "${selectedColumn}" with input:`,
    inputData
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
  console.log(`NumericAdjustment Node ${nodeId}: Processing formula "${textValue}" with input:`, inputData);

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
  console.log(`MathMax Node ${nodeId}: Processing with value "${textValue}" and input:`, inputData);

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
  console.log(`MathCeil Node ${nodeId}: Processing with input:`, inputData);

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
  console.log(
    `SaveChanges Node ${nodeId}: Processing save configuration "${textValue}" with input:`,
    inputData
  );

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

  // Handle Text input - save as text file
  if (inputData && inputData.type === "Text") {
    return await executeSaveTextNode(nodeId, inputData.text || "", packName, packedFileName);
  }

  // Handle ChangedColumnSelection input - save database changes
  if (!inputData || inputData.type !== "ChangedColumnSelection") {
    return { success: false, error: "Invalid input: Expected ChangedColumnSelection or Text data" };
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
  console.log(`Index Table Node ${nodeId}: Processing with input:`, inputData);

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

  // We can only index a single table
  if (inputData.tables.length === 0) {
    return { success: false, error: "No tables in input data" };
  }

  if (inputData.tables.length > 1) {
    console.log(`Index Table Node ${nodeId}: Multiple tables in input, using first table`);
  }

  const sourceTable = inputData.tables[0];

  if (!sourceTable.table.schemaFields || !sourceTable.table.tableSchema) {
    return { success: false, error: "Table has no schema data" };
  }

  const rows = chunkSchemaIntoRows(
    sourceTable.table.schemaFields,
    sourceTable.table.tableSchema
  ) as AmendedSchemaField[][];

  console.log(`Index Table Node ${nodeId}: Indexing ${rows.length} rows`);

  // Build the index map
  const indexMap = new Map<string, any[]>();

  for (const row of rows) {
    // Extract values for the index columns
    const keyParts: string[] = [];
    let allColumnsFound = true;

    for (const columnName of indexColumns) {
      const cell = row.find((c) => c.name === columnName);
      if (!cell) {
        console.warn(
          `Index Table Node ${nodeId}: Column "${columnName}" not found in row, skipping row`
        );
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
  console.log(`Lookup Node ${nodeId}: Processing with input:`, inputData);

  // Parse configuration
  let lookupColumn: string = "";
  let joinType: "inner" | "left" | "nested" = "inner";
  try {
    const parsed = JSON.parse(textValue);
    lookupColumn = parsed.lookupColumn || "";
    joinType = parsed.joinType || "inner";
  } catch (error) {
    console.error(`Lookup Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid lookup configuration" };
  }

  if (!lookupColumn) {
    return { success: false, error: "No lookup column specified" };
  }

  // Input should be an array: [sourceData, indexedData]
  if (!Array.isArray(inputData) || inputData.length !== 2) {
    return { success: false, error: "Invalid input: Expected array with 2 inputs [source, index]" };
  }

  const [sourceData, indexedData] = inputData;

  // Validate source data
  if (!sourceData || sourceData.type !== "TableSelection") {
    return { success: false, error: "Invalid source input: Expected TableSelection data" };
  }

  // Validate indexed data
  if (!indexedData || indexedData.type !== "IndexedTable") {
    return { success: false, error: "Invalid index input: Expected IndexedTable data" };
  }

  console.log(
    `Lookup Node ${nodeId}: Performing ${joinType} join on column "${lookupColumn}"`
  );

  // Get source table (use first table if multiple)
  if (sourceData.tables.length === 0) {
    return { success: false, error: "No tables in source data" };
  }

  const sourceTable = sourceData.tables[0];

  if (!sourceTable.table.schemaFields || !sourceTable.table.tableSchema) {
    return { success: false, error: "Source table has no schema data" };
  }

  const sourceRows = chunkSchemaIntoRows(
    sourceTable.table.schemaFields,
    sourceTable.table.tableSchema
  ) as AmendedSchemaField[][];

  console.log(`Lookup Node ${nodeId}: Processing ${sourceRows.length} source rows`);

  // Get table names for auto-prefixing
  const sourceTableName = sourceTable.name.replace(/^db\\/, "").replace(/\\.*$/, "");
  const lookupTableName = indexedData.tableName.replace(/^db\\/, "").replace(/\\.*$/, "");

  // Perform join based on join type
  if (joinType === "nested") {
    // Nested join: preserve source rows, add lookup matches as nested array
    const nestedRows: NestedRow[] = [];

    for (const sourceRow of sourceRows) {
      const lookupCell = sourceRow.find((c) => c.name === lookupColumn);
      if (!lookupCell) {
        console.warn(
          `Lookup Node ${nodeId}: Column "${lookupColumn}" not found in source row, skipping`
        );
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
        console.warn(
          `Lookup Node ${nodeId}: Column "${lookupColumn}" not found in source row, skipping`
        );
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
    // For now, we'll create a synthetic table structure
    // In a real implementation, you'd want to properly serialize this
    const joinedTable: DBTablesNodeTable = {
      name: `${sourceTableName}_joined_${lookupTableName}`,
      fileName: `${sourceTableName}_joined_${lookupTableName}`,
      sourceFile: sourceTable.sourceFile,
      table: {
        ...sourceTable.table,
        name: `db\\${sourceTableName}_joined_${lookupTableName}`,
        // Store joined rows in schemaFields (will need proper serialization)
        schemaFields: joinedRows.flat(),
        tableSchema: {
          ...sourceTable.table.tableSchema!,
          fields: joinedRows.length > 0 ? joinedRows[0].map((cell) => cell) : [],
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
        fields: flatRows.length > 0 ? flatRows[0].map((cell) => cell) : [],
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
        fields: extractedRows.length > 0 ? extractedRows[0].map((cell) => cell) : [],
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
  try {
    const parsed = JSON.parse(textValue);
    aggregateColumn = parsed.aggregateColumn || "";
    aggregateType = parsed.aggregateType || "min";
  } catch (error) {
    console.error(`Aggregate Nested Node ${nodeId}: Error parsing configuration:`, error);
    return { success: false, error: "Invalid aggregate configuration" };
  }

  if (!aggregateColumn && (aggregateType === "min" || aggregateType === "max")) {
    return { success: false, error: "No aggregate column specified" };
  }

  console.log(
    `Aggregate Nested Node ${nodeId}: Performing ${aggregateType.toUpperCase()} on column "${aggregateColumn}"`
  );

  // Process each nested row
  const aggregatedRows: NestedRow[] = [];

  for (const nestedRow of inputData.rows) {
    if (nestedRow.lookupMatches.length === 0) {
      // No lookup matches: keep as is
      aggregatedRows.push(nestedRow);
      continue;
    }

    if (aggregateType === "min" || aggregateType === "max") {
      // Find row with min/max value
      let selectedRow: AmendedSchemaField[] | null = null;
      let selectedValue: number | null = null;

      for (const lookupRow of nestedRow.lookupMatches) {
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
        aggregateValue = nestedRow.lookupMatches.length;
      } else {
        let sum = 0;
        let count = 0;

        for (const lookupRow of nestedRow.lookupMatches) {
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
        fieldValue: aggregateValue,
        is_key: false,
        is_reference: [],
      } as AmendedSchemaField);

      // Clear lookup matches since we've aggregated them
      aggregatedRows.push({
        sourceRow: newSourceRow,
        lookupMatches: [],
      });
    }
  }

  console.log(`Aggregate Nested Node ${nodeId}: Aggregated to ${aggregatedRows.length} rows`);

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
