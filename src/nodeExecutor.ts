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

      case "numericadjustment":
        return await executeNumericAdjustmentNode(nodeId, textValue, inputData);

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

    console.log(`AllEnabledMods Node ${nodeId}: Found ${packFiles.length} packs (includeBaseGame: ${includeBaseGame})`);

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
  try {
    const parsed = JSON.parse(textValue);
    console.log(`GroupByColumns Node ${nodeId}: Parsed columns:`, parsed);
    column1 = parsed.column1;
    column2 = parsed.column2;
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
        let matches = String(cellValue).toLowerCase().includes(filterValue.toLowerCase());

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

  return {
    success: true,
    data: filteredData,
  };
}

// Formula evaluation function
function evaluateFormula(formula: string, x: number): number {
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
            console.log("New numeric value of", numVal, "is", result.toString());
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
    const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string;
    const whmmFlowsFolder = nodePath.join(dataFolder, "whmm_flows");

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

  try {
    const config = JSON.parse(textValue);
    packName = config.packName || "";
    packedFileName = config.packedFileName || "";
    additionalConfig = config.additionalConfig || "";
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
    if (lastBackslashIndex > -1) {
      dbFileName =
        dbFileName.substring(0, lastBackslashIndex + 1) + "!" + dbFileName.substring(lastBackslashIndex + 1);
    } else {
      dbFileName = "!" + dbFileName;
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

  const timestamp = format(new Date(), "ddMMyy_HHmmss");
  const packFileBaseName = packName || `dbflow_${timestamp}`;
  const dataFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder as string;
  const whmmFlowsFolder = nodePath.join(dataFolder, "whmm_flows");

  // Create whmm_flows directory if it doesn't exist
  if (!fs.existsSync(whmmFlowsFolder)) {
    fs.mkdirSync(whmmFlowsFolder, { recursive: true });
  }

  const newPackPath = nodePath.join(whmmFlowsFolder, `${packFileBaseName}.pack`);
  await writePack(toSave, newPackPath);

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
