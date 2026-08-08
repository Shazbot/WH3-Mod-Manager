import * as fs from "fs";
import * as path from "path";
import {
  chunkSchemaIntoRows,
  getPacksTableData,
  readPack,
  typeToBuffer,
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
import { getDefaultTableVersions, getLocsTrie } from "./ipcMainListeners";
import Trie from "./utility/trie";
import { evaluateFormula } from "./utility/formulaEvaluation";
import {
  FlowExecutionContext,
  buildFlowOutputPackBaseName,
  buildReadPackCacheKey,
  flowExecutionDebugLog,
} from "./flowExecutionSupport";
import {
  getSchemaForGame,
  getReferencesForGame,
  getDBFieldsReferencedByForGame,
  gameToTablesWithNumericIds,
  tablesToIgnore,
} from "./schema";
import { splitMultilineOptionValue } from "./nodeGraph/types";
import {
  DeepClonePlan,
  LoadedTableFile,
  buildFileCopyOutputs,
  deepCloneVanillaPacksByFolder,
  executeDeepClonePlan,
  parseFilenameRelativePaths,
} from "./flowDeepClone";
import type {
  DeepCloneOverride,
  DeepCloneTreeNode,
  DeepCloneVariantAxis,
  LocTextRule,
} from "./nodeGraph/nodes/types";

// Global tracking for counter transformations to ensure uniqueness across the entire flow
// Map structure: sourceColumnId -> Set of used numbers
const globalCounterTracking = new Map<string, Set<number>>();

// Reset counter tracking at the start of each flow execution
export const resetCounterTracking = () => {
  globalCounterTracking.clear();
  console.log("Counter tracking reset for new flow execution");
};

const hotPathLog = (executionContext: FlowExecutionContext | undefined, ...args: any[]) => {
  if (executionContext) {
    flowExecutionDebugLog(executionContext, ...args);
    return;
  }

  console.log(...args);
};

/**
 * Compares a cell against a filter value, case-insensitively.
 *
 * A value containing newlines is a list and the row matches if the cell equals any entry — that is
 * how a multiline flow option substituted into the value behaves. A single-line value keeps the
 * original exact-match behaviour.
 */
const matchesFilterValue = (cellValue: string, filterValue: string): boolean => {
  const loweredCell = cellValue.toLowerCase();
  if (!filterValue.includes("\n") && !filterValue.includes("\r")) {
    return loweredCell === filterValue.toLowerCase();
  }

  const candidates = splitMultilineOptionValue(filterValue);
  // A list that resolved to nothing matches nothing, rather than silently matching everything.
  if (candidates.length === 0) return false;
  return candidates.some((candidate) => candidate.toLowerCase() === loweredCell);
};

export const CONDITIONAL_BRANCH_TRUE_HANDLE = "output-true";
export const CONDITIONAL_BRANCH_FALSE_HANDLE = "output-false";

const getNodeConfig = <T>(config: unknown, textValue: string): T | undefined => {
  if (config !== undefined) {
    return config as T;
  }
  if (!textValue) {
    return undefined;
  }

  try {
    return JSON.parse(textValue) as T;
  } catch {
    return undefined;
  }
};

const getRowsForPackedFile = (
  packedFile: Pick<PackedFile, "schemaFields" | "tableSchema">,
  executionContext?: FlowExecutionContext,
): AmendedSchemaField[][] => {
  if (!packedFile.schemaFields || !packedFile.tableSchema) {
    return [];
  }

  if (!executionContext) {
    return chunkSchemaIntoRows(packedFile.schemaFields, packedFile.tableSchema) as AmendedSchemaField[][];
  }

  const cachedRows = executionContext.rowsByPackedFile.get(packedFile as PackedFile);
  if (cachedRows) {
    return cachedRows;
  }

  const rows = chunkSchemaIntoRows(packedFile.schemaFields, packedFile.tableSchema) as AmendedSchemaField[][];
  executionContext.rowsByPackedFile.set(packedFile as PackedFile, rows);
  return rows;
};

const getMergeIdentityColumnNames = (
  existingColumn: DBColumnSelectionTableValues,
  currentColumn: DBColumnSelectionTableValues,
): string[] => {
  const tableFields = currentColumn.sourceTable.tableSchema?.fields ?? existingColumn.sourceTable.tableSchema?.fields ?? [];
  const keyColumnNames = tableFields.filter((field) => field.is_key).map((field) => field.name);
  if (keyColumnNames.length > 0) {
    return keyColumnNames;
  }

  const changedColumnNames = new Set([...existingColumn.selectedColumns, ...currentColumn.selectedColumns]);
  return tableFields.filter((field) => !changedColumnNames.has(field.name)).map((field) => field.name);
};

const getRowMergeIdentity = (row: AmendedSchemaField[], identityColumnNames: string[]): string =>
  JSON.stringify(
    identityColumnNames.map((columnName) => {
      const cell = row.find((candidate) => candidate.name === columnName);
      return [columnName, cell?.resolvedKeyValue ?? cell?.fields.map((field) => field.val) ?? null];
    }),
  );

const mergeChangedColumnRows = (
  existingColumn: DBColumnSelectionTableValues,
  currentColumn: DBColumnSelectionTableValues,
  executionContext?: FlowExecutionContext,
) => {
  if (
    !currentColumn.sourceTable.schemaFields ||
    !existingColumn.sourceTable.schemaFields ||
    !currentColumn.sourceTable.tableSchema ||
    !existingColumn.sourceTable.tableSchema
  ) {
    return;
  }

  const currentRows = getRowsForPackedFile(currentColumn.sourceTable, executionContext);
  const existingRows = getRowsForPackedFile(existingColumn.sourceTable, executionContext);
  const currentSelectedSet = new Set(currentColumn.selectedColumns);
  const identityColumnNames = getMergeIdentityColumnNames(existingColumn, currentColumn);

  if (identityColumnNames.length === 0) {
    for (let rowIndex = 0; rowIndex < currentRows.length; rowIndex++) {
      if (!existingRows[rowIndex]) {
        existingRows.push(structuredClone(currentRows[rowIndex]));
        continue;
      }
      for (const currentCell of currentRows[rowIndex]) {
        if (!currentSelectedSet.has(currentCell.name)) continue;
        const existingCellIndex = existingRows[rowIndex].findIndex((cell) => cell.name === currentCell.name);
        if (existingCellIndex !== -1) {
          existingRows[rowIndex][existingCellIndex] = structuredClone(currentCell);
        }
      }
    }
  } else {
    const existingRowsByIdentity = new Map(
      existingRows.map((row) => [getRowMergeIdentity(row, identityColumnNames), row]),
    );
    for (const currentRow of currentRows) {
      const identity = getRowMergeIdentity(currentRow, identityColumnNames);
      const existingRow = existingRowsByIdentity.get(identity);
      if (!existingRow) {
        const addedRow = structuredClone(currentRow);
        existingRows.push(addedRow);
        existingRowsByIdentity.set(identity, addedRow);
        continue;
      }

      for (const currentCell of currentRow) {
        if (!currentSelectedSet.has(currentCell.name)) continue;
        const existingCellIndex = existingRow.findIndex((cell) => cell.name === currentCell.name);
        if (existingCellIndex !== -1) {
          existingRow[existingCellIndex] = structuredClone(currentCell);
        }
      }
    }
  }

  existingColumn.sourceTable.schemaFields = existingRows.flat();
};

const getColumnIndexForPackedFile = (
  packedFile: Pick<PackedFile, "tableSchema">,
  columnName: string,
  executionContext?: FlowExecutionContext,
): number => {
  if (!packedFile.tableSchema) {
    return -1;
  }

  if (!executionContext) {
    return packedFile.tableSchema.fields.findIndex((field) => field.name === columnName);
  }

  let columnIndexes = executionContext.columnIndexesByPackedFile.get(packedFile as PackedFile);
  if (!columnIndexes) {
    columnIndexes = new Map<string, number>();
    packedFile.tableSchema.fields.forEach((field, index) => {
      columnIndexes?.set(field.name, index);
    });
    executionContext.columnIndexesByPackedFile.set(packedFile as PackedFile, columnIndexes);
  }

  return columnIndexes.get(columnName) ?? -1;
};

const readPackCached = async (
  packPath: string,
  packReadingOptions: PackReadingOptions,
  executionContext?: FlowExecutionContext,
): Promise<Pack> => {
  if (!executionContext) {
    return readPack(packPath, packReadingOptions);
  }

  const cacheKey = buildReadPackCacheKey(packPath, packReadingOptions);
  let cachedPackPromise = executionContext.readPackCache.get(cacheKey);
  if (!cachedPackPromise) {
    cachedPackPromise = readPack(packPath, packReadingOptions);
    executionContext.readPackCache.set(cacheKey, cachedPackPromise);
  }

  return cachedPackPromise;
};

const cacheTableFilesForPack = (
  pack: Pack,
  tableNames: string[],
  executionContext?: FlowExecutionContext,
): void => {
  if (!executionContext) {
    return;
  }

  for (const tableName of tableNames) {
    const cacheKey = `${pack.path}|${tableName}`;
    if (executionContext.tableFilesByPackAndTable.has(cacheKey)) {
      continue;
    }

    executionContext.tableFilesByPackAndTable.set(
      cacheKey,
      pack.packedFiles.filter((packedFile) => packedFile.name === tableName || packedFile.name.startsWith(`${tableName}\\`)),
    );
  }
};

const getTableFilesForPackAndTables = async (
  packPath: string,
  tableNames: string[],
  executionContext?: FlowExecutionContext,
): Promise<{ pack: Pack; matchingTablesByName: Map<string, PackedFile[]> }> => {
  const pack = await readPackCached(packPath, { tablesToRead: tableNames }, executionContext);
  getPacksTableData([pack], tableNames);
  cacheTableFilesForPack(pack, tableNames, executionContext);

  const matchingTablesByName = new Map<string, PackedFile[]>();
  for (const tableName of tableNames) {
    const cacheKey = `${pack.path}|${tableName}`;
    const cachedTables = executionContext?.tableFilesByPackAndTable.get(cacheKey);
    matchingTablesByName.set(
      tableName,
      cachedTables ??
        pack.packedFiles.filter((packedFile) => packedFile.name === tableName || packedFile.name.startsWith(`${tableName}\\`)),
    );
  }

  return { pack, matchingTablesByName };
};

const cloneNewPackedFile = (packedFile: NewPackedFile): NewPackedFile => ({
  name: packedFile.name,
  schemaFields: packedFile.schemaFields,
  file_size: packedFile.file_size,
  version: packedFile.version,
  tableSchema: packedFile.tableSchema,
  buffer: packedFile.buffer,
  readBuffer: packedFile.readBuffer,
});

const loadExistingOutputPackFiles = async (
  packPath: string,
  executionContext?: FlowExecutionContext,
): Promise<NewPackedFile[]> => {
  const cachedOutputPack = executionContext?.outputPackByPath.get(packPath);
  if (cachedOutputPack) {
    return cachedOutputPack.map(cloneNewPackedFile);
  }

  if (!fs.existsSync(packPath)) {
    return [];
  }

  const existingPack = await readPackCached(packPath, {}, executionContext);
  const dbTableNames = existingPack.packedFiles
    .filter((packedFile) => packedFile.name.toLowerCase().startsWith("db\\"))
    .map((packedFile) => {
      const parts = packedFile.name.split("\\");
      return parts.length >= 2 ? `${parts[0]}\\${parts[1]}` : packedFile.name;
    });
  const uniqueTableNames = [...new Set(dbTableNames)];

  if (uniqueTableNames.length > 0) {
    getPacksTableData([existingPack], uniqueTableNames);
    cacheTableFilesForPack(existingPack, uniqueTableNames, executionContext);
  }

  const outputFiles = existingPack.packedFiles
    .filter((packedFile) => packedFile.schemaFields && packedFile.tableSchema)
    .map((packedFile) => ({
      name: packedFile.name,
      schemaFields: packedFile.schemaFields,
      file_size: packedFile.file_size,
      version: packedFile.version,
      tableSchema: packedFile.tableSchema,
    }));

  if (executionContext) {
    executionContext.outputPackByPath.set(packPath, outputFiles.map(cloneNewPackedFile));
  }

  return outputFiles;
};

const mergeOutputPackFiles = async (
  packPath: string,
  newFiles: NewPackedFile[],
  executionContext?: FlowExecutionContext,
): Promise<NewPackedFile[]> => {
  const existingFiles = await loadExistingOutputPackFiles(packPath, executionContext);
  if (existingFiles.length === 0) {
    if (executionContext) {
      executionContext.outputPackByPath.set(packPath, newFiles.map(cloneNewPackedFile));
    }
    return newFiles;
  }

  const fileMap = new Map<string, NewPackedFile>();
  for (const existingFile of existingFiles) {
    fileMap.set(existingFile.name, cloneNewPackedFile(existingFile));
  }
  for (const newFile of newFiles) {
    fileMap.set(newFile.name, cloneNewPackedFile(newFile));
  }

  const mergedFiles = Array.from(fileMap.values());
  if (executionContext) {
    executionContext.outputPackByPath.set(packPath, mergedFiles.map(cloneNewPackedFile));
  }
  return mergedFiles;
};

export const executeNodeAction = async (request: NodeExecutionRequest): Promise<NodeExecutionResult> => {
  const { nodeId, nodeType, textValue, inputData, config, executionContext } = request;

  try {
    switch (nodeType) {
      case "packedfiles":
        return await executePackFilesNode(nodeId, textValue);

      case "packfilesdropdown":
        return await executePackFilesDropdownNode(nodeId, textValue, config);

      case "allenabledmods":
        return await executeAllEnabledModsNode(nodeId, textValue, config);

      case "tableselection":
        return await executeTableSelectionNode(nodeId, textValue, inputData, executionContext);

      case "tableselectiondropdown":
        return await executeTableSelectionDropdownNode(nodeId, textValue, inputData, executionContext, config);

      case "columnselection":
        return await executeColumnSelectionNode(nodeId, textValue, inputData, executionContext);

      case "columnselectiondropdown":
        return await executeColumnSelectionDropdownNode(nodeId, textValue, inputData, executionContext, config);

      case "groupbycolumns":
        return await executeGroupByColumnsNode(nodeId, textValue, inputData, config);

      case "filter":
        return await executeFilterNode(nodeId, textValue, inputData, config);

      case "multifilter":
        return await executeMultiFilterNode(nodeId, textValue, inputData, config);

      case "referencelookup":
        return await executeReferenceLookupNode(nodeId, textValue, inputData, config, executionContext);

      case "reversereferencelookup":
        return await executeReverseReferenceLookupNode(nodeId, textValue, inputData, config, executionContext);

      case "numericadjustment":
        return await executeNumericAdjustmentNode(nodeId, textValue, inputData, executionContext);

      case "mathmax":
        return await executeMathMaxNode(nodeId, textValue, inputData, executionContext);

      case "mathceil":
        return await executeMathCeilNode(nodeId, inputData, executionContext);

      case "mergechanges":
        return await executeMergeChangesNode(nodeId, inputData, executionContext);

      case "savechanges":
        return await executeSaveChangesNode(nodeId, textValue, inputData, config, executionContext);

      case "textsurround":
        return await executeTextSurroundNode(nodeId, textValue, inputData, config);

      case "appendtext":
        return await executeAppendTextNode(nodeId, textValue, inputData, config);

      case "textjoin":
        return await executeTextJoinNode(nodeId, textValue, inputData);

      case "groupedcolumnstotext":
        return await executeGroupedColumnsToTextNode(nodeId, textValue, inputData, config);

      case "indextable":
        return await executeIndexTableNode(nodeId, textValue, inputData, config);

      case "lookup":
        return await executeLookupNode(nodeId, textValue, inputData, config, executionContext);

      case "flattennested":
        return await executeFlattenNestedNode(nodeId, inputData);

      case "extracttable":
        return await executeExtractTableNode(nodeId, textValue, inputData, config);

      case "aggregatenested":
        return await executeAggregateNestedNode(nodeId, textValue, inputData, config);

      case "groupby":
        return await executeGroupByNode(nodeId, textValue, inputData, config);

      case "deduplicate":
        return await executeDeduplicateNode(nodeId, textValue, inputData, config, executionContext);

      case "generaterows":
      case "generaterowsschema":
        return await executeGenerateRowsNode(nodeId, textValue, inputData, config, executionContext);

      case "addnewcolumn":
        return await executeAddNewColumnNode(nodeId, textValue, inputData, config);

      case "dumptotsv":
        return await executeDumpToTSVNode(nodeId, textValue, inputData, config, executionContext);

      case "getcountercolumn":
        return await executeGetCounterColumnNode(nodeId, textValue, inputData, config, executionContext);

      case "customschema":
        return await executeCustomSchemaNode(nodeId, textValue, inputData, config);

      case "readtsvfrompack":
        return await executeReadTSVFromPackNode(nodeId, textValue, inputData, config, executionContext);

      case "customrowsinput":
        return await executeCustomRowsInputNode(nodeId, textValue, inputData, config);

      case "deepclone":
        return await executeDeepCloneNode(nodeId, textValue, inputData, config, executionContext);

      case "conditionalbranch":
        return executeConditionalBranchNode(nodeId, textValue, inputData, config);

      case "removetables":
        return executeRemoveTablesNode(nodeId, textValue, inputData, config);

      case "editloctext":
        return await executeEditLocTextNode(nodeId, textValue, inputData, config, executionContext);

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
  textValue: string,
  config?: unknown,
): Promise<NodeExecutionResult> {
  // Parse configuration (or use textValue directly for backwards compatibility)
  const parsedConfig = getNodeConfig<{ selectedPack?: string }>(config, textValue);
  const selectedPack = parsedConfig?.selectedPack ?? textValue;

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
              `PackFiles Dropdown Node ${nodeId}: Base game pack not found at ${baseGamePackPath}`,
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

async function executeAllEnabledModsNode(
  nodeId: string,
  textValue: string,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`AllEnabledMods Node ${nodeId}: Processing all enabled mods`);

  const packFiles = [] as PackFilesNodeFile[];

  try {
    // Parse the textValue to get includeBaseGame flag
    const parsedConfig = getNodeConfig<{ includeBaseGame?: boolean }>(config, textValue);
    const includeBaseGame = parsedConfig?.includeBaseGame !== false;

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
      `AllEnabledMods Node ${nodeId}: Found ${packFiles.length} packs (includeBaseGame: ${includeBaseGame})`,
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
  inputData: PackFilesNodeData,
  executionContext?: FlowExecutionContext,
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
      const { pack, matchingTablesByName } = await getTableFilesForPackAndTables(
        file.path,
        tableNames,
        executionContext,
      );

      for (const tableName of tableNames) {
        const matchingTables = matchingTablesByName.get(tableName) || [];

        for (const table of matchingTables) {
          selectedTables.push({
            name: tableName,
            fileName: table.name,
            sourceFile: pack,
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
  textValue: string,
  inputData: PackFilesNodeData,
  executionContext?: FlowExecutionContext,
  config?: unknown,
): Promise<NodeExecutionResult> {
  const parsedConfig = getNodeConfig<{ selectedTable?: string }>(config, textValue);
  const selectedTable = parsedConfig?.selectedTable ?? textValue;

  console.log(
    `TableSelection Dropdown Node ${nodeId}: Processing selected table "${selectedTable}" with input:`,
    inputData,
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
      const { pack, matchingTablesByName } = await getTableFilesForPackAndTables(
        file.path,
        [tableName],
        executionContext,
      );
      const matchingTables = matchingTablesByName.get(tableName) || [];

      for (const table of matchingTables) {
        // Limit to 300 rows for easier testing
        const limitedTable = table;
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
          sourceFile: pack,
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
  inputData: DBTablesNodeData,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`ColumnSelection Node ${nodeId}: Processing "${textValue}" with input:`, inputData);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  const selectedColumns = textValue
    .split("\n")
    .filter((line) => line.trim())
    .map((col) => col.trim());
  const selectedColumnsSet = new Set(selectedColumns);
  const columnData = [] as DBColumnSelectionTableValues[];

  for (const tableData of inputData.tables) {
    if (
      tableData.table.tableSchema &&
      tableData.table.schemaFields &&
      tableData.table.schemaFields.length != 0
    ) {
      const rows = getRowsForPackedFile(tableData.table, executionContext);
      const cellData = [] as { col: string; data: string }[];
      for (const row of rows) {
        for (const cell of row) {
          if (selectedColumnsSet.has(cell.name)) {
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
  inputData: DBTablesNodeData,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`GroupByColumns Node ${nodeId}: Processing with textValue:`, textValue);
  console.log(`GroupByColumns Node ${nodeId}: Input data:`, inputData);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse the column selections from textValue
  const parsed = getNodeConfig<{ column1?: string; column2?: string; onlyForMultiple?: boolean }>(config, textValue);
  if (!parsed) {
    return {
      success: false,
      error: "Invalid column configuration. Expected JSON with column1 and column2 fields.",
    };
  }
  const column1 = parsed.column1 || "";
  const column2 = parsed.column2 || "";
  const onlyForMultiple = parsed.onlyForMultiple || false;

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

    const rows = getRowsForPackedFile(tableData.table);

    // Find the column indices
    const column1Index = getColumnIndexForPackedFile(tableData.table, column1);
    const column2Index = getColumnIndexForPackedFile(tableData.table, column2);

    if (column1Index === -1 || column2Index === -1) {
      console.warn(
        `Columns ${column1} or ${column2} not found in table ${tableData.name}. Skipping this table.`,
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
      `GroupByColumns Node ${nodeId}: Filtered from ${groupedData.size} to ${filteredData.size} groups`,
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
  inputData: DBTablesNodeData,
  config?: unknown,
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
  const parsed = getNodeConfig<{ filters?: Array<{ column: string; value: string; not: boolean; operator: "AND" | "OR" }> }>(
    config,
    textValue,
  );
  if (!parsed) {
    return { success: false, error: "Invalid filter configuration" };
  }
  const filters = parsed.filters || [];

  if (filters.length === 0 || !filters[0].column || !filters[0].value) {
    // No filters configured, return all data unchanged
    console.log(`Filter Node ${nodeId}: No filters configured, passing through all data`);
    return {
      success: true,
      data: inputData,
    };
  }

  console.log(
    `Filter Node ${nodeId}: Applying ${filters.length} filters to ${inputData.tables.length} table(s)`,
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

    const rows = getRowsForPackedFile(tableData.table);

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

        // Case-insensitive exact match, or any-of when the value is a multiline list.
        let matches = matchesFilterValue(String(cellValue), filterValue);

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
      `Filter Node ${nodeId}: ${filteredRows.length} rows passed filters out of ${rows.length} in table "${tableData.name}"`,
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

    const rows = getRowsForPackedFile(tableData.table);

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

        // Case-insensitive exact match, or any-of when the value is a multiline list.
        let matches = matchesFilterValue(String(cellValue), filterValue);

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
    `Filter Node ${nodeId}: Match output has ${filteredData.tableCount} tables, Else output has ${elseData.tableCount} tables`,
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
  inputData: DBTablesNodeData,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`Multi-Filter Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse configuration from textValue
  const parsed = getNodeConfig<{ selectedColumn?: string; splitValues?: Array<{ id: string; value: string; enabled: boolean }> }>(
    config,
    textValue,
  );
  if (!parsed) {
    return { success: false, error: "Invalid multi-filter configuration" };
  }
  const selectedColumn = parsed.selectedColumn || "";
  const splitValues = parsed.splitValues || [];

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
    enabledSplitValues.map((s) => s.value),
  );

  // Create output data for each split value
  const multiOutputs: Record<string, DBTablesNodeData> = {};

  for (const splitValue of enabledSplitValues) {
    // Use split.id as the output key to match the stable handleId in the UI
    const outputKey = splitValue.id;
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

    const rows = getRowsForPackedFile(tableData.table);

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
      // Use split.id as the output key to match the stable handleId in the UI
      const outputKey = splitValue.id;
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
        `Multi-Filter Node ${nodeId}: Output "${outputKey}" has ${matchingRows.length} rows from table "${tableData.name}"`,
      );
    }
  }

  // Update table counts for each output
  for (const outputKey of Object.keys(multiOutputs)) {
    multiOutputs[outputKey].tableCount = multiOutputs[outputKey].tables.length;
  }

  console.log(
    `Multi-Filter Node ${nodeId}: Created ${Object.keys(multiOutputs).length} outputs:`,
    Object.keys(multiOutputs).map((key) => `${key} (${multiOutputs[key].tableCount} tables)`),
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
  inputData: DBTablesNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`Reference Lookup Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse selected reference table and includeBaseGame from textValue
  const parsed = getNodeConfig<{ selectedReferenceTable?: string; includeBaseGame?: boolean }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid node configuration" };
  }
  const selectedReferenceTable = parsed.selectedReferenceTable || "";
  const includeBaseGame = parsed.includeBaseGame !== false;

  // Build source files list, potentially including base game
  const sourceFiles = [...(inputData.sourceFiles || [])];

  if (includeBaseGame) {
    const baseGamePackName = gameToPackWithDBTablesName[appData.currentGame];
    if (baseGamePackName) {
      const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (baseGameFolder) {
        const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
        // Check if base game pack is not already in sourceFiles
        if (!sourceFiles.some((sf) => sf.path === baseGamePackPath)) {
          if (fs.existsSync(baseGamePackPath)) {
            sourceFiles.push({
              name: baseGamePackName,
              path: baseGamePackPath,
              loaded: true,
            });
            console.log(`Reference Lookup Node ${nodeId}: Added base game pack from ${baseGamePackPath}`);
          }
        }
      }
    }
  }

  if (!selectedReferenceTable || selectedReferenceTable.trim() === "") {
    console.log(`Reference Lookup Node ${nodeId}: No reference table selected, returning empty result`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: sourceFiles,
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  console.log(
    `Reference Lookup Node ${nodeId}: Looking up references to table "${selectedReferenceTable}" from ${inputData.tables.length} input table(s)`,
  );

  // Collect all reference values from the input tables
  const referenceValues = new Set<string>();

  for (const tableData of inputData.tables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      console.warn(`Reference Lookup Node ${nodeId}: Skipping table "${tableData.name}" - no schema`);
      continue;
    }

    const rows = getRowsForPackedFile(tableData.table, executionContext);

    // Find columns that reference the selected table
    // is_reference is an array where [0] is the referenced table name
    const referenceColumns = tableData.table.tableSchema.fields.filter(
      (field) =>
        field.is_reference &&
        field.is_reference.length > 0 &&
        field.is_reference[0] === selectedReferenceTable,
    );

    console.log(
      `Reference Lookup Node ${nodeId}: Found ${referenceColumns.length} reference column(s) in table "${tableData.name}"`,
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
        sourceFiles: sourceFiles,
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

  for (const sourceFile of sourceFiles) {
    if (!sourceFile.loaded) {
      console.warn(`Reference Lookup Node ${nodeId}: Skipping unloaded file: ${sourceFile.path}`);
      continue;
    }

    try {
      const { pack, matchingTablesByName } = await getTableFilesForPackAndTables(
        sourceFile.path,
        [tableNameToSearch],
        executionContext,
      );
      const matchingTables = matchingTablesByName.get(tableNameToSearch) || [];
      flowExecutionDebugLog(
        executionContext,
        `Reference Lookup Node ${nodeId}: ${sourceFile.name} yielded ${matchingTables.length} matching table(s)`,
      );

      for (const table of matchingTables) {
        referencedTables.push({
          name: tableNameToSearch,
          fileName: table.name,
          sourceFile: pack,
          table,
        });
      }
    } catch (error) {
      console.error(`Reference Lookup Node ${nodeId}: Error reading pack file ${sourceFile.path}:`, error);
    }
  }

  console.log(
    `Reference Lookup Node ${nodeId}: Found ${referencedTables.length} table(s) matching "${selectedReferenceTable}"`,
  );

  // Filter the referenced tables to only include rows with matching key values
  const filteredReferencedTables: DBTablesNodeData = {
    type: "TableSelection",
    tables: [],
    sourceFiles: sourceFiles,
    tableCount: 0,
  };

  for (const tableData of referencedTables) {
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      // No schema, include the whole table
      filteredReferencedTables.tables.push(tableData);
      continue;
    }

    const rows = getRowsForPackedFile(tableData.table, executionContext);

    // Find the key column (usually the first column or a column with is_key=true)
    const keyField =
      tableData.table.tableSchema.fields.find((field) => field.is_key) ||
      tableData.table.tableSchema.fields[0];

    if (!keyField) {
      console.warn(
        `Reference Lookup Node ${nodeId}: No key field found in table "${tableData.name}", skipping`,
      );
      continue;
    }

    const keyColumnName = keyField.name;
    console.log(
      `Reference Lookup Node ${nodeId}: Using key column "${keyColumnName}" in table "${tableData.name}"`,
    );

    // Filter rows where the key column value is in our reference values set
    const filteredRows = rows.filter((row) => {
      const keyCell = row.find((c) => c.name === keyColumnName);
      if (!keyCell) return false;

      const keyValue = String(keyCell.resolvedKeyValue || "").trim();
      return referenceValues.has(keyValue);
    });

    console.log(
      `Reference Lookup Node ${nodeId}: ${filteredRows.length} row(s) matched out of ${rows.length} in table "${tableData.name}"`,
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
    `Reference Lookup Node ${nodeId}: Returning ${filteredReferencedTables.tableCount} filtered table(s)`,
  );

  return {
    success: true,
    data: filteredReferencedTables,
  };
}

async function executeReverseReferenceLookupNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`Reverse Reference Lookup Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse selected reverse table and includeBaseGame from textValue
  const parsed = getNodeConfig<{ selectedReverseTable?: string; includeBaseGame?: boolean }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid node configuration" };
  }
  let selectedReverseTable = parsed.selectedReverseTable || "";
  const includeBaseGame = parsed.includeBaseGame !== false;

  // Build source files list, potentially including base game
  const sourceFiles = [...(inputData.sourceFiles || [])];

  if (includeBaseGame) {
    const baseGamePackName = gameToPackWithDBTablesName[appData.currentGame];
    if (baseGamePackName) {
      const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (baseGameFolder) {
        const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
        // Check if base game pack is not already in sourceFiles
        if (!sourceFiles.some((sf) => sf.path === baseGamePackPath)) {
          if (fs.existsSync(baseGamePackPath)) {
            sourceFiles.push({
              name: baseGamePackName,
              path: baseGamePackPath,
              loaded: true,
            });
            console.log(
              `Reverse Reference Lookup Node ${nodeId}: Added base game pack from ${baseGamePackPath}`,
            );
          }
        }
      }
    }
  }

  // Get the input table name to find reverse references
  let inputTableName = "";
  if (inputData.tables.length > 0) {
    inputTableName = inputData.tables[0].name.replace(/^db\\/, "").replace(/\\.*$/, "");
  }

  // If no reverse table is selected, try to auto-select if there's only one option
  if ((!selectedReverseTable || selectedReverseTable.trim() === "") && inputTableName) {
    console.log(
      `Reverse Reference Lookup Node ${nodeId}: No reverse table selected, checking for auto-selection for input table "${inputTableName}"`,
    );

    // Find all tables that have fields referencing the input table
    const reverseTableOptions = new Set<string>();

    for (const sourceFile of sourceFiles) {
      if (!sourceFile.loaded) continue;

      try {
        // Read the pack without parsing tables to get the list of table names
        const pack = await readPackCached(sourceFile.path, { skipParsingTables: true }, executionContext);

        // Get all unique db table names (base names without variants)
        const dbTableNames = new Set<string>();
        for (const packedFile of pack.packedFiles) {
          if (packedFile.name.startsWith("db\\")) {
            const baseTableName = packedFile.name.replace(/^db\\/, "").replace(/\\.*$/, "");
            dbTableNames.add(baseTableName);
          }
        }

        console.log(
          `Reverse Reference Lookup Node ${nodeId}: Found ${dbTableNames.size} potential table(s) in ${sourceFile.name}`,
        );

        // Now read each table's schema to check if it references the input table
        for (const tableName of dbTableNames) {
          try {
            const tableNameToRead = `db\\${tableName}`;
            const { matchingTablesByName } = await getTableFilesForPackAndTables(
              sourceFile.path,
              [tableNameToRead],
              executionContext,
            );
            const matchingTables = matchingTablesByName.get(tableNameToRead) || [];

            // Check the packed files for schema information
            for (const packedFile of matchingTables) {
              if (packedFile.tableSchema) {
                // Check if this table has any fields that reference the input table
                const hasReferenceToInput = packedFile.tableSchema.fields.some(
                  (field) =>
                    field.is_reference &&
                    field.is_reference.length > 0 &&
                    field.is_reference[0] === inputTableName,
                );

                if (hasReferenceToInput) {
                  reverseTableOptions.add(tableName);
                  console.log(
                    `Reverse Reference Lookup Node ${nodeId}: Table "${tableName}" has references to "${inputTableName}"`,
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
          error,
        );
      }
    }

    console.log(
      `Reverse Reference Lookup Node ${nodeId}: Found ${reverseTableOptions.size} table(s) that reference "${inputTableName}":`,
      Array.from(reverseTableOptions),
    );

    if (reverseTableOptions.size === 1) {
      selectedReverseTable = Array.from(reverseTableOptions)[0];
      console.log(
        `Reverse Reference Lookup Node ${nodeId}: Auto-selected only available reverse table: "${selectedReverseTable}"`,
      );
    } else if (reverseTableOptions.size === 0) {
      console.log(
        `Reverse Reference Lookup Node ${nodeId}: No tables reference "${inputTableName}", returning empty result`,
      );
      return {
        success: true,
        data: {
          type: "TableSelection",
          tables: [],
          sourceFiles: sourceFiles,
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
        sourceFiles: sourceFiles,
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  console.log(
    `Reverse Reference Lookup Node ${nodeId}: Finding rows in "${selectedReverseTable}" that reference ${inputData.tables.length} input table(s)`,
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

    const rows = getRowsForPackedFile(tableData.table, executionContext);

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
    `Reverse Reference Lookup Node ${nodeId}: Collected ${inputKeyValues.size} unique key value(s) from input`,
  );

  if (inputKeyValues.size === 0) {
    console.log(
      `Reverse Reference Lookup Node ${nodeId}: No key values found in input, returning empty result`,
    );
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: sourceFiles,
        tableCount: 0,
      } as DBTablesNodeData,
    };
  }

  // Search for the reverse table in all source files
  const reverseTables = [] as DBTablesNodeTable[];

  const tableNameToSearch = selectedReverseTable.startsWith("db\\")
    ? selectedReverseTable
    : `db\\${selectedReverseTable}`;

  for (const sourceFile of sourceFiles) {
    if (!sourceFile.loaded) {
      console.warn(`Reverse Reference Lookup Node ${nodeId}: Skipping unloaded file: ${sourceFile.path}`);
      continue;
    }

    try {
      const { pack, matchingTablesByName } = await getTableFilesForPackAndTables(
        sourceFile.path,
        [tableNameToSearch],
        executionContext,
      );
      const matchingTables = matchingTablesByName.get(tableNameToSearch) || [];

      for (const packedFile of matchingTables) {
        if (packedFile.schemaFields && packedFile.tableSchema) {
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
    `Reverse Reference Lookup Node ${nodeId}: Found ${reverseTables.length} table(s) from pack files`,
  );

  const filteredReverseTables: DBTablesNodeData = {
    type: "TableSelection",
    tables: [],
    sourceFiles: sourceFiles,
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

    const rows = getRowsForPackedFile(tableData.table, executionContext);

    // Find columns that reference the input table
    const referenceColumns = tableData.table.tableSchema.fields.filter(
      (field) =>
        field.is_reference && field.is_reference.length > 0 && field.is_reference[0] === inputTableName,
    );

    if (referenceColumns.length === 0) {
      console.log(
        `Reverse Reference Lookup Node ${nodeId}: No reference columns found in "${tableData.name}" pointing to "${inputTableName}"`,
      );
      continue;
    }

    console.log(
      `Reverse Reference Lookup Node ${nodeId}: Found ${referenceColumns.length} reference column(s) in "${tableData.name}"`,
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
      `Reverse Reference Lookup Node ${nodeId}: ${filteredRows.length} row(s) matched out of ${rows.length} in table "${tableData.name}"`,
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
    `Reverse Reference Lookup Node ${nodeId}: Returning ${filteredReverseTables.tableCount} filtered table(s)`,
  );

  return {
    success: true,
    data: filteredReverseTables,
  };
}


async function executeColumnSelectionDropdownNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  executionContext?: FlowExecutionContext,
  config?: unknown,
): Promise<NodeExecutionResult> {
  const parsedConfig = getNodeConfig<{ selectedColumn?: string }>(config, textValue);
  const selectedColumn = parsedConfig?.selectedColumn ?? textValue;

  console.log(
    `ColumnSelection Dropdown Node ${nodeId}: Processing selected column "${selectedColumn}" with num input tables:`,
    inputData.tables.length,
    `table names:`,
    inputData.tables.map((t) => t.name),
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
  const selectedColumnsSet = new Set(selectedColumns);
  const columnData = [] as DBColumnSelectionTableValues[];

  for (const tableData of inputData.tables) {
    if (
      tableData.table.tableSchema &&
      tableData.table.schemaFields &&
      tableData.table.schemaFields.length != 0
    ) {
      const rows = getRowsForPackedFile(tableData.table, executionContext);
      const cellData = [] as { col: string; data: string }[];
      for (const row of rows) {
        for (const cell of row) {
          if (selectedColumnsSet.has(cell.name)) {
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
  inputData:
    | DBColumnSelectionNodeData
    | DBColumnSelectionNodeData[]
    | DBNumericAdjustmentNodeData
    | DBNumericAdjustmentNodeData[],
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`NumericAdjustment Node ${nodeId}: Processing formula "${textValue}" with input:`, inputData);

  // Convert single input to array for uniform handling
  const inputs = Array.isArray(inputData) ? inputData : [inputData];

  if (inputs.length === 0) {
    return { success: false, error: "No inputs provided. Connect at least one node." };
  }

  // Extract ColumnSelection data from inputs (handle both ColumnSelection and ChangedColumnSelection)
  const columnSelectionInputs: DBColumnSelectionNodeData[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (!input) {
      return { success: false, error: `Invalid input at index ${i}: No data provided` };
    }

    if (input.type === "ColumnSelection") {
      columnSelectionInputs.push(input as DBColumnSelectionNodeData);
    } else if (input.type === "ChangedColumnSelection") {
      columnSelectionInputs.push((input as DBNumericAdjustmentNodeData).adjustedInputData);
    } else {
      return {
        success: false,
        error: `Invalid input at index ${i}: Expected ColumnSelection or ChangedColumnSelection data`,
      };
    }
  }

  // Merge all inputs if there are multiple
  let mergedInput: DBColumnSelectionNodeData;
  if (columnSelectionInputs.length === 1) {
    mergedInput = columnSelectionInputs[0];
  } else {
    hotPathLog(executionContext, `NumericAdjustment Node ${nodeId}: Merging ${columnSelectionInputs.length} inputs`);

    // Collect unique tables and merge selectedColumns/data WITHOUT cloning yet
    // We'll clone once at the end when we apply the formula
    const tableMap = new Map<
      string,
      { column: any; selectedColumns: Set<string>; dataMap: Map<string, any> }
    >();
    const allSourceTables: any[] = [];
    const seenSourceTables = new Set<string>();

    for (const input of columnSelectionInputs) {
      for (const column of input.columns) {
        const key = `${column.tableName}|${column.fileName}`;
        if (!tableMap.has(key)) {
          // First time seeing this table - store reference (no clone yet)
          tableMap.set(key, {
            column: column,
            selectedColumns: new Set(column.selectedColumns),
            dataMap: new Map(column.data.map((d: any) => [d.col, d])),
          });
        } else {
          // Already have this table - merge selectedColumns and data into Sets/Maps (fast)
          const existing = tableMap.get(key)!;
          for (const col of column.selectedColumns) {
            existing.selectedColumns.add(col);
          }
          for (const newData of column.data) {
            if (!existing.dataMap.has(newData.col)) {
              existing.dataMap.set(newData.col, newData);
            }
          }
        }
      }

      // Collect source tables (use Set for fast lookup)
      for (const sourceTable of input.sourceTables) {
        const stKey = `${sourceTable.name}|${sourceTable.fileName}`;
        if (!seenSourceTables.has(stKey)) {
          seenSourceTables.add(stKey);
          allSourceTables.push(sourceTable);
        }
      }
    }

    hotPathLog(executionContext, `NumericAdjustment Node ${nodeId}: After dedup, have ${tableMap.size} unique tables`);

    // Build merged columns - convert Sets/Maps back to arrays
    const mergedColumns = Array.from(tableMap.values()).map(({ column, selectedColumns, dataMap }) => ({
      ...column,
      selectedColumns: Array.from(selectedColumns),
      data: Array.from(dataMap.values()),
    }));

    mergedInput = {
      type: "ColumnSelection",
      columns: mergedColumns,
      sourceTables: allSourceTables,
      selectedColumnCount: mergedColumns.reduce((sum, col) => sum + col.selectedColumns.length, 0),
    } as DBColumnSelectionNodeData;
  }

  // Log the tables we're processing
  console.log(`NumericAdjustment Node ${nodeId}: Processing ${mergedInput.columns.length} table(s):`);
  for (const col of mergedInput.columns) {
    hotPathLog(
      executionContext,
      `  - ${col.tableName} (${col.selectedColumns.length} columns, ${col.data.length} data entries)`,
    );
  }

  const formula = textValue.trim();

  if (!formula) {
    return {
      success: false,
      error: "No value provided. Enter a number or a mathematical expression using x as the input variable.",
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
  const adjustedInputData = structuredClone(mergedInput);

  for (const column of adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) {
      console.log("MISSING SCHEMA!");
      continue;
    }
    hotPathLog(executionContext, "selected columns:", column.selectedColumns);

    // Use Set for O(1) lookup instead of O(n) includes()
    const selectedColumnsSet = new Set(column.selectedColumns);

    const rows = getRowsForPackedFile(column.sourceTable, executionContext);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (selectedColumnsSet.has(cell.name)) {
          const numVal = parseFloat(cell.resolvedKeyValue.replace(/[^\d.-]/g, ""));
          if (isNaN(numVal)) {
            hotPathLog(executionContext, "Not a number!");
            continue; // Keep non-numeric values as-is
          }

          try {
            const result = evaluateFormula(formula, numVal);
            rows[i][j].resolvedKeyValue = result.toString();
            rows[i][j].fields[0].val = result;
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
      originalData: mergedInput,
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeMathMaxNode(
  nodeId: string,
  textValue: string,
  inputData: DBNumericAdjustmentNodeData | DBNumericAdjustmentNodeData[],
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`MathMax Node ${nodeId}: Processing with value "${textValue}" and input:`, inputData);

  // Convert single input to array for uniform handling
  const inputs = Array.isArray(inputData) ? inputData : [inputData];

  if (inputs.length === 0) {
    return { success: false, error: "No inputs provided. Connect at least one node." };
  }

  // Validate all inputs are ChangedColumnSelection
  for (let i = 0; i < inputs.length; i++) {
    if (!inputs[i] || inputs[i].type !== "ChangedColumnSelection") {
      return {
        success: false,
        error: `Invalid input at index ${i}: Expected ChangedColumnSelection data`,
      };
    }
  }

  // Merge all inputs if there are multiple
  let mergedInputData: DBColumnSelectionNodeData;
  let originalData: DBColumnSelectionNodeData;

  if (inputs.length === 1) {
    mergedInputData = inputs[0].adjustedInputData;
    originalData = inputs[0].originalData;
  } else {
    // Start with a deep clone of the first input as the base
    mergedInputData = structuredClone(inputs[0].adjustedInputData);
    originalData = inputs[0].originalData;

    // Merge all subsequent inputs
    for (let i = 1; i < inputs.length; i++) {
      const currentInput = inputs[i].adjustedInputData;

      // For each table in the current input, merge with the corresponding table in mergedInputData
      for (const currentColumn of currentInput.columns) {
        // Find if this table already exists in mergedInputData
        const existingColumn = mergedInputData.columns.find(
          (col) => col.tableName === currentColumn.tableName && col.fileName === currentColumn.fileName,
        );

        if (existingColumn) {
          mergeChangedColumnRows(existingColumn, currentColumn, executionContext);

          // Merge selectedColumns using Set for efficiency
          const existingColsSet = new Set(existingColumn.selectedColumns);
          for (const col of currentColumn.selectedColumns) {
            if (!existingColsSet.has(col)) {
              existingColumn.selectedColumns.push(col);
              existingColsSet.add(col);
            }
          }

          // Merge data array using Map for efficiency
          const existingDataMap = new Map(existingColumn.data.map((d: any) => [d.col, d]));
          for (const newData of currentColumn.data) {
            const existingData = existingDataMap.get(newData.col);
            if (existingData) {
              existingData.data = newData.data;
            } else {
              existingColumn.data.push(newData);
            }
          }
        } else {
          // This table doesn't exist in mergedInputData yet, add it
          mergedInputData.columns.push(structuredClone(currentColumn));
        }
      }

      // Merge sourceTables
      for (const sourceTable of currentInput.sourceTables) {
        if (
          !mergedInputData.sourceTables.some(
            (t) => t.name === sourceTable.name && t.fileName === sourceTable.fileName,
          )
        ) {
          mergedInputData.sourceTables.push(sourceTable);
        }
      }

      // Update column count
      mergedInputData.selectedColumnCount += currentInput.selectedColumnCount;
    }
  }

  const maxValue = parseFloat(textValue.trim());

  if (isNaN(maxValue)) {
    return {
      success: false,
      error: "Invalid value. Please enter a valid number.",
    };
  }

  // Apply Math.max to numeric columns
  const adjustedInputData = structuredClone(mergedInputData);

  for (const column of adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) {
      console.log("MISSING SCHEMA!");
      continue;
    }

    // Use Set for O(1) lookup instead of O(n) includes()
    const selectedColumnsSet = new Set(column.selectedColumns);

    const rows = getRowsForPackedFile(column.sourceTable, executionContext);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (selectedColumnsSet.has(cell.name)) {
          const numVal = parseFloat(cell.resolvedKeyValue.replace(/[^\d.-]/g, ""));
          if (isNaN(numVal)) {
            hotPathLog(executionContext, "Not a number!");
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
      originalData: originalData,
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeMathCeilNode(
  nodeId: string,
  inputData: DBNumericAdjustmentNodeData | DBNumericAdjustmentNodeData[],
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`MathCeil Node ${nodeId}: Processing with input:`, inputData);

  // Convert single input to array for uniform handling
  const inputs = Array.isArray(inputData) ? inputData : [inputData];

  if (inputs.length === 0) {
    return { success: false, error: "No inputs provided. Connect at least one node." };
  }

  // Validate all inputs are ChangedColumnSelection
  for (let i = 0; i < inputs.length; i++) {
    if (!inputs[i] || inputs[i].type !== "ChangedColumnSelection") {
      return {
        success: false,
        error: `Invalid input at index ${i}: Expected ChangedColumnSelection data`,
      };
    }
  }

  // Merge all inputs if there are multiple
  let mergedInputData: DBColumnSelectionNodeData;
  let originalData: DBColumnSelectionNodeData;

  if (inputs.length === 1) {
    mergedInputData = inputs[0].adjustedInputData;
    originalData = inputs[0].originalData;
  } else {
    // Start with a deep clone of the first input as the base
    mergedInputData = structuredClone(inputs[0].adjustedInputData);
    originalData = inputs[0].originalData;

    // Merge all subsequent inputs
    for (let i = 1; i < inputs.length; i++) {
      const currentInput = inputs[i].adjustedInputData;

      // For each table in the current input, merge with the corresponding table in mergedInputData
      for (const currentColumn of currentInput.columns) {
        // Find if this table already exists in mergedInputData
        const existingColumn = mergedInputData.columns.find(
          (col) => col.tableName === currentColumn.tableName && col.fileName === currentColumn.fileName,
        );

        if (existingColumn) {
          mergeChangedColumnRows(existingColumn, currentColumn, executionContext);

          // Merge selectedColumns using Set for efficiency
          const existingColsSet = new Set(existingColumn.selectedColumns);
          for (const col of currentColumn.selectedColumns) {
            if (!existingColsSet.has(col)) {
              existingColumn.selectedColumns.push(col);
              existingColsSet.add(col);
            }
          }

          // Merge data array using Map for efficiency
          const existingDataMap = new Map(existingColumn.data.map((d: any) => [d.col, d]));
          for (const newData of currentColumn.data) {
            const existingData = existingDataMap.get(newData.col);
            if (existingData) {
              existingData.data = newData.data;
            } else {
              existingColumn.data.push(newData);
            }
          }
        } else {
          // This table doesn't exist in mergedInputData yet, add it
          mergedInputData.columns.push(structuredClone(currentColumn));
        }
      }

      // Merge sourceTables
      for (const sourceTable of currentInput.sourceTables) {
        if (
          !mergedInputData.sourceTables.some(
            (t) => t.name === sourceTable.name && t.fileName === sourceTable.fileName,
          )
        ) {
          mergedInputData.sourceTables.push(sourceTable);
        }
      }

      // Update column count
      mergedInputData.selectedColumnCount += currentInput.selectedColumnCount;
    }
  }

  // Apply Math.ceil to numeric columns
  const adjustedInputData = structuredClone(mergedInputData);

  for (const column of adjustedInputData.columns) {
    if (!column.sourceTable.schemaFields || !column.sourceTable.tableSchema) {
      console.log("MISSING SCHEMA!");
      continue;
    }

    // Use Set for O(1) lookup instead of O(n) includes()
    const selectedColumnsSet = new Set(column.selectedColumns);

    const rows = getRowsForPackedFile(column.sourceTable, executionContext);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (selectedColumnsSet.has(cell.name)) {
          const numVal = parseFloat(cell.resolvedKeyValue.replace(/[^\d.-]/g, ""));
          if (isNaN(numVal)) {
            hotPathLog(executionContext, "Not a number!");
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
      originalData: originalData,
    } as DBNumericAdjustmentNodeData,
  };
}

async function executeMergeChangesNode(
  nodeId: string,
  inputData: DBNumericAdjustmentNodeData | DBNumericAdjustmentNodeData[],
  executionContext?: FlowExecutionContext,
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
        (col) => col.tableName === currentColumn.tableName && col.fileName === currentColumn.fileName,
      );

      if (existingColumn) {
        mergeChangedColumnRows(existingColumn, currentColumn, executionContext);

        // Merge selectedColumns using Set for efficiency
        const existingColsSet = new Set(existingColumn.selectedColumns);
        for (const col of currentColumn.selectedColumns) {
          if (!existingColsSet.has(col)) {
            existingColumn.selectedColumns.push(col);
            existingColsSet.add(col);
          }
        }

        // Merge data array using Map for efficiency
        const existingDataMap = new Map(existingColumn.data.map((d: any) => [d.col, d]));
        for (const newData of currentColumn.data) {
          const existingData = existingDataMap.get(newData.col);
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

const openSavedFileForManualRun = async (
  filePath: string,
  openInWindows: boolean,
  executionContext?: FlowExecutionContext,
) => {
  if (!openInWindows || executionContext) return;

  try {
    const shellOutput = await shell.openPath(filePath);
    if (shellOutput) {
      console.warn(`Failed to open saved file ${filePath}: ${shellOutput}`);
    }
  } catch (error) {
    console.warn(`Failed to open saved file ${filePath}:`, error);
  }
};

async function executeSaveTextNode(
  nodeId: string,
  textContent: string,
  packName: string,
  packedFileName: string,
  openInWindows: boolean,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(
    `SaveText Node ${nodeId}: Saving text file with packName="${packName}", packedFileName="${packedFileName}"`,
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
    await openSavedFileForManualRun(newPackPath, openInWindows, executionContext);

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
  inputData: any,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  if (Array.isArray(inputData)) {
    const mergeResult = await executeMergeChangesNode(`${nodeId}:inputs`, inputData, executionContext);
    if (!mergeResult.success) {
      return mergeResult;
    }
    inputData = mergeResult.data;
  }

  console.log(`SaveChanges Node ${nodeId}: Processing save configuration "${textValue}" with tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t: any) => t.name),
  });

  // Parse configuration from textValue
  let packName = "";
  let packedFileName = "";
  let additionalConfig = "";
  let flowExecutionId = "";
  let openInWindows = false;

  const parsedConfig = getNodeConfig<{
    packName?: string;
    packedFileName?: string;
    additionalConfig?: string;
    flowExecutionId?: string;
    openInWindows?: boolean;
  }>(config, textValue);
  if (parsedConfig) {
    packName = parsedConfig.packName || "";
    packedFileName = parsedConfig.packedFileName || "";
    additionalConfig = parsedConfig.additionalConfig || "";
    flowExecutionId = parsedConfig.flowExecutionId || "";
    openInWindows = parsedConfig.openInWindows ?? false;
  } else {
    // If not JSON, treat textValue as additionalConfig
    additionalConfig = textValue.trim();
  }

  console.log(`Save Changes Node ${nodeId}: Received inputData type:`, inputData?.type);
  console.log(`Save Changes Node ${nodeId}: inputData exists:`, !!inputData);

  // Handle Text input - save as text file
  if (inputData && inputData.type === "Text") {
    return await executeSaveTextNode(
      nodeId,
      inputData.text || "",
      packName,
      packedFileName,
      openInWindows,
      executionContext,
    );
  }

  // Handle TableSelection input - save table data
  if (inputData && inputData.type === "TableSelection") {
    const toSave = [] as NewPackedFile[];

    for (const table of inputData.tables || []) {
      // A raw payload whose path is meaningful to the game (art keyed by a unit name) is written
      // verbatim, not under a generated db\ name.
      if (table.outputFileName && table.table.buffer) {
        toSave.push({
          name: table.outputFileName,
          buffer: table.table.buffer,
          file_size: table.table.buffer.length,
        });
        continue;
      }

      if (!table.table.schemaFields || !table.table.tableSchema) continue;

      toSave.push({
        name: "", // Will be set after we determine pack name
        schemaFields: table.table.schemaFields,
        version: table.table.version,
        tableSchema: table.table.tableSchema,
        tableName: table.name, // Store table name for later use
        outputPathPrefix: table.outputPathPrefix,
        outputPathSuffix: table.outputPathSuffix,
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
    // A table carrying outputPathPrefix is not a db table (e.g. a generated loc) and supplies its
    // own folder and extension instead.
    for (const file of toSave) {
      // Already named verbatim above.
      if (file.name) continue;

      const randomSuffix = Math.random().toString(36).substring(2, 8);
      // Producers are inconsistent about whether name carries the "db\" prefix; strip it so we
      // never build a doubled db\db\... path.
      const tableName = ((file as any).tableName || "unknown_table").replace(/^db\\/, "");
      const fileName = `${packFileBaseName}_${randomSuffix}`;
      const outputPathPrefix = (file as any).outputPathPrefix as string | undefined;
      file.name = outputPathPrefix
        ? `${outputPathPrefix}${fileName}${((file as any).outputPathSuffix as string) ?? ""}`
        : `db\\${tableName}\\${fileName}`;
      delete (file as any).tableName; // Remove temporary properties
      delete (file as any).outputPathPrefix;
      delete (file as any).outputPathSuffix;
    }

    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string;
    // If flowExecutionId is set, we're executing a flow at game start, so save to whmm_flows
    // Otherwise, save to data for manual execution
    const outputDir = flowExecutionId
      ? nodePath.join(gamePath, "whmm_flows")
      : nodePath.join(gamePath, "data");
    const packFilePath = nodePath.join(outputDir, `${packFileBaseName}.pack`);

    console.log(
      `Save Changes Node ${nodeId}: Saving to ${flowExecutionId ? "whmm_flows" : "data"} directory`,
    );
    console.log(`Save Changes Node ${nodeId}: Output path: ${packFilePath}`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    try {
      const filesToSave = await mergeOutputPackFiles(packFilePath, toSave, executionContext);
      await writePack(filesToSave, packFilePath);
      await openSavedFileForManualRun(packFilePath, openInWindows, executionContext);
      return {
        success: true,
        data: {
          type: "SaveResult",
          savedTo: packFilePath,
          format: "pack",
          message: `Successfully saved ${filesToSave.length} table(s) to ${packFilePath}`,
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

    let dbFileName = column.fileName as string;
    const lastBackslashIndex = dbFileName.lastIndexOf("\\");
    // Generate random suffix (6 alphanumeric characters)
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    if (lastBackslashIndex > -1) {
      const isVanillaPack = appData.allVanillaPackNames.has(column.sourcePack.name);
      dbFileName =
        dbFileName.substring(0, lastBackslashIndex + 1) +
        (isVanillaPack ? "" : "!") +
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
    packFileBaseName = buildFlowOutputPackBaseName(flowExecutionId);
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

  const filesToSave = await mergeOutputPackFiles(newPackPath, toSave, executionContext);

  await writePack(filesToSave, newPackPath);
  await openSavedFileForManualRun(newPackPath, openInWindows, executionContext);

  try {
    // Parse save configuration (could be JSON, simple path, or custom format)
    let filePath = saveConfig;
    let format = "tsv"; // default format

    // Try to parse as JSON for more complex configurations
    const parsedSaveConfig = getNodeConfig<{ path?: string; filePath?: string; format?: string }>(undefined, saveConfig);
    if (parsedSaveConfig) {
      filePath = parsedSaveConfig.path || parsedSaveConfig.filePath || "output.tsv";
      format = parsedSaveConfig.format || "tsv";
    } else {
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

    console.log(
      `SaveChanges Node ${nodeId}: Successfully saved ${filesToSave.length} file(s) to ${newPackPath}`,
    );

    return {
      success: true,
      data: {
        type: "SaveResult",
        savedTo: newPackPath,
        format: "pack",
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
  inputData: any,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`TextSurround Node ${nodeId}: Processing with config "${textValue}" and input:`, inputData);

  if (!inputData) {
    return { success: false, error: "Invalid input: No input data provided" };
  }

  // Parse configuration
  let surroundText = textValue;
  let groupedTextSelection: "Text" | "Text Lines" = "Text";

  const parsedConfig = getNodeConfig<{ surroundText?: string; groupedTextSelection?: "Text" | "Text Lines" }>(
    config,
    textValue,
  );
  if (parsedConfig) {
    surroundText = parsedConfig.surroundText || "";
    groupedTextSelection = parsedConfig.groupedTextSelection || "Text";
  } else {
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
          valueArray.map((value: string) => `${prefix}${value}${suffix}`),
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
  inputData: any,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`AppendText Node ${nodeId}: Processing with config "${textValue}" and input:`, inputData);

  if (!inputData) {
    return { success: false, error: "Invalid input: No input data provided" };
  }

  // Parse configuration
  let beforeText = "";
  let afterText = "";
  let groupedTextSelection: "Text" | "Text Lines" = "Text";

  const parsedConfig = getNodeConfig<{
    beforeText?: string;
    afterText?: string;
    groupedTextSelection?: "Text" | "Text Lines";
  }>(config, textValue);
  if (parsedConfig) {
    beforeText = parsedConfig.beforeText || "";
    afterText = parsedConfig.afterText || "";
    groupedTextSelection = parsedConfig.groupedTextSelection || "Text";
  } else {
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
          valueArray.map((value: string) => `${beforeText}${value}${afterText}`),
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
  inputData: any,
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
  inputData: any,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(
    `GroupedColumnsToText Node ${nodeId}: Processing with config "${textValue}" and input:`,
    inputData,
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

  const parsedConfig = getNodeConfig<{ pattern?: string; joinSeparator?: string }>(config, textValue);
  if (parsedConfig) {
    pattern = parsedConfig.pattern || pattern;
    joinSeparator = parsedConfig.joinSeparator || joinSeparator;
  } else {
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
  inputData: DBTablesNodeData,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`Index Table Node ${nodeId}: Processing ${inputData?.tables?.length || 0} table(s)`);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse index columns from textValue
  const parsed = getNodeConfig<{ indexColumns?: string[] }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid index configuration" };
  }
  const indexColumns = parsed.indexColumns || [];

  if (indexColumns.length === 0) {
    return { success: false, error: "No index columns specified" };
  }

  console.log(`Index Table Node ${nodeId}: Indexing by columns: ${indexColumns.join(", ")}`);

  // Combine rows from all tables
  if (inputData.tables.length === 0) {
    return { success: false, error: "No tables in input data" };
  }

  const allRows: AmendedSchemaField[][] = [];
  const sourceTable = inputData.tables[0]; // Keep first for metadata

  for (const table of inputData.tables) {
    if (!table.table.schemaFields || !table.table.tableSchema) {
      console.warn(`Index Table Node ${nodeId}: Skipping table without schema data`);
      continue;
    }

    const rows = getRowsForPackedFile(table.table);

    allRows.push(...rows);
  }

  const rows = allRows;
  console.log(
    `Index Table Node ${nodeId}: Indexing ${rows.length} rows from ${inputData.tables.length} pack file(s)`,
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
    `Index Table Node ${nodeId}: Created index with ${indexMap.size} unique keys for table "${sourceTable.name}"`,
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
  inputData: any,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`Lookup Node ${nodeId}: Processing with input tables:`, {
    sourceTableCount: inputData?.source?.tables?.length,
    indexedTableName: inputData?.indexed?.tableName,
  });

  // Parse configuration
  const parsed = getNodeConfig<{
    lookupColumn?: string;
    joinType?: "inner" | "left" | "anti" | "nested" | "cross";
    indexColumns?: string[];
    indexJoinColumn?: string;
  }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid lookup configuration" };
  }
  const lookupColumn = parsed.lookupColumn || "";
  const joinType = parsed.joinType || "inner";
  const indexColumns = parsed.indexColumns || [];
  const indexJoinColumn = parsed.indexJoinColumn || "";

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
    if (joinType === "cross") {
      const allRightRows: AmendedSchemaField[][] = [];
      let rightTable = rightInputData.tables[0];

      for (const table of rightInputData.tables) {
        if (!table.table.schemaFields || !table.table.tableSchema) {
          console.warn(`Lookup Node ${nodeId}: Skipping index table without schema data`);
          continue;
        }

        const rows = getRowsForPackedFile(table.table, executionContext);
        if (!rightTable) {
          rightTable = table;
        }
        allRightRows.push(...rows);
      }

      if (!rightTable) {
        return { success: false, error: "No tables in index data" };
      }

      hotPathLog(
        executionContext,
        `Lookup Node ${nodeId}: Collected ${allRightRows.length} rows from ${rightInputData.tables.length} pack files for cross join`,
      );

      indexedData = {
        type: "IndexedTable",
        indexMap: new Map<string, AmendedSchemaField[][]>([["__cross_join__", allRightRows]]),
        sourceTable: rightTable,
        tableName: rightTable.name,
      };
    } else {
      // Need to index it first - use indexJoinColumn if specified, otherwise indexColumns, otherwise lookupColumn
      const columnsToIndex = indexJoinColumn
        ? [indexJoinColumn]
        : indexColumns.length > 0
          ? indexColumns
          : [lookupColumn];

      hotPathLog(executionContext, `Lookup Node ${nodeId}: Auto-indexing second input by [${columnsToIndex.join(", ")}]`);

      const indexMap = new Map<string, AmendedSchemaField[][]>();
      let rightTable = rightInputData.tables[0];
      let indexedRowCount = 0;
      for (const table of rightInputData.tables) {
        if (!table.table.schemaFields || !table.table.tableSchema) {
          console.warn(`Lookup Node ${nodeId}: Skipping table without schema data`);
          continue;
        }

        const rows = getRowsForPackedFile(table.table, executionContext);
        const indexColumnsWithPositions = columnsToIndex.map((columnName) => ({
          columnName,
          index: getColumnIndexForPackedFile(table.table, columnName, executionContext),
        }));
        const missingColumns = indexColumnsWithPositions
          .filter(({ index }) => index === -1)
          .map(({ columnName }) => columnName);
        if (missingColumns.length > 0) {
          console.warn(
            `Lookup Node ${nodeId}: Skipping index table ${table.name} because column(s) are missing: ${missingColumns.join(", ")}`,
          );
          continue;
        }

        indexedRowCount += rows.length;
        if (!rightTable) rightTable = table;

        for (const row of rows) {
          const keyParts: string[] = [];
          for (const { index } of indexColumnsWithPositions) {
            const cell = row[index];
            if (!cell) {
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
      }

      if (!rightTable) {
        return { success: false, error: "No tables in index data" };
      }

      hotPathLog(
        executionContext,
        `Lookup Node ${nodeId}: Indexing ${indexedRowCount} rows from ${rightInputData.tables.length} pack files`,
      );

      hotPathLog(executionContext, `Lookup Node ${nodeId}: Created index with ${indexMap.size} unique key(s)`);

      indexedData = {
        type: "IndexedTable",
        indexMap,
        sourceTable: rightTable,
        tableName: rightTable.name,
      };
    }
  } else {
    return { success: false, error: "Invalid index input: Expected IndexedTable or TableSelection data" };
  }

  console.log(`Lookup Node ${nodeId}: Performing ${joinType} join on column "${lookupColumn}"`);

  // Get all source tables and combine rows from all of them
  if (sourceData.tables.length === 0) {
    return { success: false, error: "No tables in source data" };
  }

  const allSourceRows: AmendedSchemaField[][] = [];
  const sourceRowsWithLookupIndex: Array<{ row: AmendedSchemaField[]; lookupColumnIndex: number }> = [];
  const sourceTable = sourceData.tables[0]; // Keep first for metadata

  for (const table of sourceData.tables) {
    if (!table.table.schemaFields || !table.table.tableSchema) {
      console.warn(`Lookup Node ${nodeId}: Skipping table without schema data`);
      continue;
    }

    const rows = getRowsForPackedFile(table.table, executionContext);
    if (joinType === "cross") {
      allSourceRows.push(...rows);
      continue;
    }

    const lookupColumnIndex = getColumnIndexForPackedFile(table.table, lookupColumn, executionContext);
    if (lookupColumnIndex === -1) {
      console.warn(`Lookup Node ${nodeId}: Column "${lookupColumn}" not found in table ${table.name}, skipping`);
      continue;
    }

    for (const row of rows) {
      sourceRowsWithLookupIndex.push({ row, lookupColumnIndex });
    }
  }

  const sourceRows = joinType === "cross" ? allSourceRows : sourceRowsWithLookupIndex.map(({ row }) => row);
  hotPathLog(
    executionContext,
    `Lookup Node ${nodeId}: Processing ${sourceRows.length} source rows from ${sourceData.tables.length} pack files`,
  );

  // Get table names for auto-prefixing
  const sourceTableName = sourceTable.name.replace(/^db\\/, "").replace(/\\.*$/, "");
  const lookupTableName = indexedData.tableName.replace(/^db\\/, "").replace(/\\.*$/, "");

  // Perform join based on join type
  if (joinType === "cross") {
    // Cross join: Cartesian product of all source rows with all right table rows
    hotPathLog(executionContext, `Lookup Node ${nodeId}: Performing cross join (Cartesian product)`);

    // Extract all rows from the indexed data
    const allRightRows: AmendedSchemaField[][] = [];
    for (const rows of indexedData.indexMap.values()) {
      allRightRows.push(...rows);
    }

    hotPathLog(
      executionContext,
      `Lookup Node ${nodeId}: Cross joining ${sourceRows.length} source rows with ${allRightRows.length} right rows`,
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

    hotPathLog(executionContext, `Lookup Node ${nodeId}: Created ${crossJoinedRows.length} cross-joined rows`);

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

    for (const { row: sourceRow, lookupColumnIndex } of sourceRowsWithLookupIndex) {
      const lookupCell = sourceRow[lookupColumnIndex];
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

    hotPathLog(executionContext, `Lookup Node ${nodeId}: Created ${nestedRows.length} nested rows`);

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
    const sourceSchemaFields: DBField[] = sourceTable.table.tableSchema?.fields || [];
    const indexedSchemaFields: DBField[] = indexedData.sourceTable.table.tableSchema?.fields || [];
    const emptyIndexedRowTemplate: AmendedSchemaField[] =
      joinType === "left"
        ? await Promise.all(
            indexedSchemaFields.map(async (field) => ({
              name: `${lookupTableName}_${field.name}`,
              type: field.field_type,
              fields: [{ type: "Buffer" as const, val: await typeToBuffer(field.field_type, "") }],
              resolvedKeyValue: "",
              isKey: field.is_key,
            })),
          )
        : [];

    for (const { row: sourceRow, lookupColumnIndex } of sourceRowsWithLookupIndex) {
      const lookupCell = sourceRow[lookupColumnIndex];
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
          const emptyIndexedRow = emptyIndexedRowTemplate.map((cell) => ({
            ...cell,
            fields: cell.fields.map((field) => ({ ...field })),
          }));
          joinedRows.push([...prefixedSourceRow, ...emptyIndexedRow]);
        } else if (joinType === "anti") {
          joinedRows.push(sourceRow.map((cell) => ({ ...cell })));
        }
        // Inner join: skip row
      } else if (joinType !== "anti") {
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

    hotPathLog(executionContext, `Lookup Node ${nodeId}: Created ${joinedRows.length} joined rows`);

    // Build the joined schema from both input schemas so it does not depend on
    // whether the first output row matched.
    const schemaFields: DBField[] =
      joinType === "anti"
        ? sourceSchemaFields.map((field) => ({ ...field }))
        : [
            ...sourceSchemaFields.map((field) => ({
              ...field,
              name: `${sourceTableName}_${field.name}`,
              description: `Source column from ${joinType} join`,
              ca_order: -1,
            })),
            ...indexedSchemaFields.map((field) => ({
              ...field,
              name: `${lookupTableName}_${field.name}`,
              description: `Indexed column from ${joinType} join`,
              ca_order: -1,
            })),
          ];

    const schemaVersion = sourceTable.table.tableSchema?.version ?? 1;
    const tableVersion = sourceTable.table.version;

    hotPathLog(
      executionContext,
      `Lookup Node ${nodeId}: Source table version=${sourceTable.table.version}, schema version=${sourceTable.table.tableSchema?.version}`,
    );
    hotPathLog(
      executionContext,
      `Lookup Node ${nodeId}: Creating joined table with schema version=${schemaVersion}, table version=${tableVersion}`,
    );

    const outputTableName =
      joinType === "anti"
        ? `${sourceTableName}_unmatched_${lookupTableName}`
        : `${sourceTableName}_joined_${lookupTableName}`;
    const joinedTable: DBTablesNodeTable = {
      name: outputTableName,
      fileName: outputTableName,
      sourceFile: sourceTable.sourceFile,
      table: {
        ...sourceTable.table,
        name: `db\\${outputTableName}`,
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
  inputData: NestedTableSelection,
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
  inputData: DBTablesNodeData,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`Extract Table Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse table prefix from textValue
  const parsed = getNodeConfig<{ tablePrefix?: string }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid extract configuration" };
  }
  const tablePrefix = parsed.tablePrefix || "";

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

  const rows = getRowsForPackedFile(sourceTable.table);

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
  inputData: NestedTableSelection,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`Aggregate Nested Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "NestedTableSelection") {
    return { success: false, error: "Invalid input: Expected NestedTableSelection data" };
  }

  // Parse configuration
  let filterColumn: string = "";
  let filterOperator:
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "lessThan"
    | "greaterThanOrEqual"
    | "lessThanOrEqual" = "equals";
  const parsed = getNodeConfig<{
    aggregateColumn?: string;
    aggregateType?: "min" | "max" | "sum" | "avg" | "count";
    filterColumn?: string;
    filterOperator?:
      | "equals"
      | "notEquals"
      | "greaterThan"
      | "lessThan"
      | "greaterThanOrEqual"
      | "lessThanOrEqual";
    filterValue?: string;
  }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid aggregate configuration" };
  }
  const aggregateColumn = parsed.aggregateColumn || "";
  const aggregateType = parsed.aggregateType || "min";
  filterColumn = parsed.filterColumn || "";
  filterOperator = parsed.filterOperator || "equals";
  const filterValue = parsed.filterValue || "";

  if (!aggregateColumn && (aggregateType === "min" || aggregateType === "max")) {
    return { success: false, error: "No aggregate column specified" };
  }

  console.log(
    `Aggregate Nested Node ${nodeId}: Performing ${aggregateType.toUpperCase()} on column "${aggregateColumn}"${
      filterColumn ? ` with filter ${filterColumn} ${filterOperator} ${filterValue}` : ""
    }`,
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
            `Aggregate Nested Node ${nodeId}: Column "${aggregateColumn}" not found in lookup row`,
          );
          continue;
        }

        const value = parseFloat(String(cell.resolvedKeyValue || "0"));
        if (isNaN(value)) {
          console.warn(
            `Aggregate Nested Node ${nodeId}: Non-numeric value in column "${aggregateColumn}": ${cell.resolvedKeyValue}`,
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
  inputData: DBTablesNodeData,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`Group By Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse configuration from textValue
  let aggregations: Array<{
    sourceColumn: string;
    operation: "max" | "min" | "sum" | "avg" | "count" | "first" | "last";
    outputName: string;
    defaultValue?: string;
  }> = [];
  const parsed = getNodeConfig<{
    groupByColumns?: string[];
    aggregations?: Array<{
      sourceColumn: string;
      operation: "max" | "min" | "sum" | "avg" | "count" | "first" | "last";
      outputName: string;
      defaultValue?: string;
    }>;
  }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid group by configuration" };
  }
  const groupByColumns = parsed.groupByColumns || [];
  aggregations = parsed.aggregations || [];

  if (groupByColumns.length === 0) {
    return { success: false, error: "No group by columns specified" };
  }

  if (aggregations.length === 0) {
    return { success: false, error: "No aggregations specified" };
  }

  console.log(
    `Group By Node ${nodeId}: Grouping by [${groupByColumns.join(", ")}] with ${
      aggregations.length
    } aggregation(s)`,
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
    const rows = getRowsForPackedFile(tableData.table);

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
            `Group By Node ${nodeId}: Group by column "${colName}" not found in row, skipping row`,
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
            (c: AmendedSchemaField) => c.name === agg.sourceColumn,
          );
          aggregateValue = cell ? cell.resolvedKeyValue : "";
        } else {
          // max, min, sum, avg - need numeric values
          const values: number[] = [];

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
      `Group By Node ${nodeId}: Output ${groupedRows.length} grouped rows from ${rows.length} input rows`,
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
        (field: DBField) => field.name === colName,
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
            `Group By: Found sample field: name=${sampleField.name}, type=${sampleField.type}, isKey=${sampleField.isKey}`,
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
      `Group By Node ${nodeId}: Created schema with ${newSchemaFields.length} fields (schema version=${schemaVersion}):`,
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
  inputData: DBTablesNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`Deduplicate Node ${nodeId}: Processing with input tables:`, {
    tableCount: inputData?.tables?.length,
    tableNames: inputData?.tables?.map((t) => t.name),
  });

  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  // Parse configuration from textValue
  const parsed = getNodeConfig<{ dedupeByColumns?: string[]; dedupeAgainstVanilla?: boolean }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid deduplicate configuration" };
  }
  const dedupeByColumns = parsed.dedupeByColumns || [];
  const dedupeAgainstVanilla = parsed.dedupeAgainstVanilla || false;

  console.log(
    `Deduplicate Node ${nodeId}: dedupeByColumns: [${dedupeByColumns.join(", ")}], dedupeAgainstVanilla: ${dedupeAgainstVanilla}`,
  );

  if (dedupeByColumns.length === 0) {
    return { success: false, error: "No dedupe by columns specified" };
  }

  const dedupedTables = [] as DBTablesNodeTable[];
  const inputTableToDupes = new Map<number, Set<number>>();
  const alreadyPresentRowHashes = new Set<number>();

  // If dedupeAgainstVanilla is enabled, build a set of vanilla row hashes
  const vanillaRowHashes = new Set<number>();
  if (dedupeAgainstVanilla) {
    console.log(`Deduplicate Node ${nodeId}: Building vanilla row hashes...`);

    // Get the base game pack path
    const baseGamePackName = gameToPackWithDBTablesName[appData.currentGame];
    if (baseGamePackName) {
      const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame].dataFolder;
      if (baseGameFolder) {
        const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
        if (fs.existsSync(baseGamePackPath)) {
          // Get unique table names from input data
          const tableNamesToRead = new Set<string>();
          for (const tableData of inputData.tables) {
            tableNamesToRead.add(tableData.name);
          }

          console.log(
            `Deduplicate Node ${nodeId}: Reading vanilla tables: [${Array.from(tableNamesToRead).join(", ")}]`,
          );

          try {
            // Read the vanilla pack for the same tables
            const vanillaPack = await readPackCached(
              baseGamePackPath,
              { tablesToRead: Array.from(tableNamesToRead) },
              executionContext,
            );
            getPacksTableData([vanillaPack], Array.from(tableNamesToRead));

            // Process each vanilla table and build hashes
            for (const tableName of tableNamesToRead) {
              const matchingTables = vanillaPack.packedFiles.filter((pf) => {
                const tablePath = pf.name.toLowerCase();
                const searchPath = tableName.toLowerCase();
                return tablePath === searchPath || tablePath.startsWith(searchPath + "\\");
              });

              for (const vanillaTable of matchingTables) {
                if (!vanillaTable.schemaFields || !vanillaTable.tableSchema) {
                  continue;
                }

                const vanillaRows = getRowsForPackedFile(vanillaTable, executionContext);

                console.log(
                  `Deduplicate Node ${nodeId}: Vanilla table "${vanillaTable.name}" has ${vanillaRows.length} rows`,
                );

                for (const row of vanillaRows) {
                  let cellConcat = "";
                  for (const dedupeColumn of dedupeByColumns) {
                    const cell = row.find((c) => c.name === dedupeColumn);
                    if (cell) {
                      cellConcat += cell.resolvedKeyValue;
                    }
                  }
                  const rowHash = cyrb53(cellConcat);
                  vanillaRowHashes.add(rowHash);
                }
              }
            }

            console.log(`Deduplicate Node ${nodeId}: Built ${vanillaRowHashes.size} vanilla row hashes`);
          } catch (error) {
            console.error(`Deduplicate Node ${nodeId}: Error reading vanilla pack:`, error);
          }
        }
      }
    }
  }

  // Process each table
  for (let tableIndex = 0; tableIndex < inputData.tables.length; tableIndex++) {
    const tableData = inputData.tables[tableIndex];
    if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
      continue;
    }

    const rows = getRowsForPackedFile(tableData.table, executionContext);

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

      // If dedupeAgainstVanilla is enabled, mark rows that exist in vanilla as duplicates
      if (dedupeAgainstVanilla && vanillaRowHashes.has(rowHash)) {
        dupes.add(i);
        continue;
      }

      // Normal deduplication: mark subsequent duplicate rows
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

    const rows = getRowsForPackedFile(tableData.table, executionContext);

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
  inputData: DBTablesNodeData,
  rawConfig?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Starting execution`);

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
        | "counter_range"
        | "filterequal"
        | "filternotequal";
      prefix?: string;
      suffix?: string;
      numericValue?: number;
      startNumber?: number;
      rangeStart?: string; // For counter_range (supports flow options)
      endNumber?: string; // For counter_range (supports flow options)
      rangeIncrement?: string; // For counter_range (supports flow options)
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
      tableVersion?: number;
      columnMapping: string[];
      staticValues?: Record<string, string>;
    }>;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
    customSchemaData?: Array<{ id: string; name: string; type: string }> | null;
  };

  try {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: textValue to parse:`, textValue);
    const parsedConfig = getNodeConfig<typeof config>(rawConfig, textValue);
    if (!parsedConfig) {
      throw new Error("Invalid configuration");
    }
    config = parsedConfig;
    hotPathLog(
      executionContext,
      `Generate Rows Node ${nodeId}: Parsed - transformations length:`,
      (config.transformations || []).length,
    );
    hotPathLog(
      executionContext,
      `Generate Rows Node ${nodeId}: Parsed - outputTables length:`,
      (config.outputTables || []).length,
    );
  } catch (error) {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: JSON parse error:`, error);
    return {
      success: false,
      error: `Invalid configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }

  if (!config.transformations || !config.outputTables) {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Missing transformations or outputTables!`);
    return {
      success: false,
      error: "Missing transformations or outputTables in configuration",
    };
  }

  hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Configuration parsed (excluding DBNameToDBVersions):`, {
    transformations: config.transformations,
    outputTables: config.outputTables,
    hasDBNameToDBVersions: !!config.DBNameToDBVersions,
    hasCustomSchemaData: !!config.customSchemaData,
    customSchemaData: config.customSchemaData,
  });

  // Check if we have a counter_range transformation that can generate rows without input
  const counterRangeTransformation = config.transformations.find(
    (t) => t.transformationType === "counter_range",
  );
  const hasCustomSchema = !!config.customSchemaData;

  // 2. Extract input rows from ALL input tables
  // Allow empty input tables if we have counter_range (which generates its own rows)
  const hasInputTables = inputData?.tables && inputData.tables.length > 0;

  if (!hasInputTables && !counterRangeTransformation) {
    return {
      success: false,
      error: "No input tables found",
    };
  }

  // Collect rows from all input tables (handles multiple tables with same name from different mods)
  const rows: AmendedSchemaField[][] = [];
  const sourceTable = hasInputTables ? inputData.tables[0] : null; // Keep first table for metadata (fileName, sourceFile, etc.)

  if (hasInputTables) {
    for (const table of inputData.tables) {
      if (!table.table.tableSchema) {
        console.warn(`Generate Rows Node ${nodeId}: Skipping table ${table.name} - no schema information`);
        continue;
      }

      const tableRows = table.table.schemaFields ? getRowsForPackedFile(table.table, executionContext) : [];

      rows.push(...tableRows);
    }

    hotPathLog(
      executionContext,
      `Generate Rows Node ${nodeId}: Collected ${rows.length} rows from ${inputData.tables.length} input tables`,
    );
  } else {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: No input tables, will generate rows from counter_range`);
  }

  // If no rows but we have counter_range, generate rows from the range
  if (rows.length === 0 && counterRangeTransformation) {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: No input rows but has counter_range - generating from range`);

    const rangeStart = parseInt(counterRangeTransformation.rangeStart || "1", 10) || 1;
    const rangeEnd = parseInt(counterRangeTransformation.endNumber || "10", 10) || 10;
    const rangeIncrement = parseInt(counterRangeTransformation.rangeIncrement || "1", 10) || 1;

    hotPathLog(
      executionContext,
      `Generate Rows Node ${nodeId}: Generating rows from ${rangeStart} to ${rangeEnd} with increment ${rangeIncrement}`,
    );

    // Generate placeholder rows based on the range
    for (let i = rangeStart; rangeIncrement > 0 ? i <= rangeEnd : i >= rangeEnd; i += rangeIncrement) {
      // Create a minimal row with the counter value
      const row: AmendedSchemaField[] = [
        {
          name: "__counter_range_value__",
          resolvedKeyValue: String(i),
          type: "I32" as SCHEMA_FIELD_TYPE,
          fields: [{ type: "I32", val: i }],
        },
      ];
      rows.push(row);
    }

    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Generated ${rows.length} rows from counter_range`);
  }

  // If no rows (and no counter_range to generate them), return empty output for each configured output table
  // This allows the flow to continue on other branches
  if (rows.length === 0) {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: No input rows - returning empty output tables`);

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

  hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Processing ${rows.length} input rows`);

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

      hotPathLog(
        executionContext,
        `Generate Rows Node ${nodeId}: Initialized counter for "${key}" starting at ${startNumber} with ${existingValues.size} existing values`,
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
            `Generate Rows Node ${nodeId}: Source column "${transformation.sourceColumn}" not found in row ${rowIdx}. Using default value.`,
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

        case "counter_range": {
          // For counter_range, use the value from the __counter_range_value__ field
          // that was generated when creating rows from the range
          const counterRangeCell = row.find((c: AmendedSchemaField) => c.name === "__counter_range_value__");
          if (counterRangeCell) {
            outputValue = parseInt(String(counterRangeCell.resolvedKeyValue), 10) || 0;
          } else {
            // Fallback: use row index + start value
            const rangeStart = parseInt(transformation.rangeStart || "1", 10) || 1;
            const rangeIncrement = parseInt(transformation.rangeIncrement || "1", 10) || 1;
            outputValue = rangeStart + rowIdx * rangeIncrement;
          }
          break;
        }

        case "filterequal":
        case "filternotequal":
          // Filter transformations are handled before row processing
          // They don't produce output values, so skip storing them
          continue;

        default:
          console.warn(
            `Generate Rows Node ${nodeId}: Unknown transformation type "${transformation.transformationType}"`,
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

  hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Transformations applied`, {
    columnCount: globalTransformedData.size,
    keys: Array.from(globalTransformedData.keys()),
  });

  // 4. Create output tables
  const outputs: Record<string, DBTablesNodeData> = {};

  for (const outputConfig of config.outputTables) {
    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Creating output table "${outputConfig.name}"`);

    // Handle custom schema case
    let schema: DBVersion;
    let isCustomSchema = false;

    if (outputConfig.existingTableName === "__custom_schema__") {
      if (!config.customSchemaData || config.customSchemaData.length === 0) {
        console.error(
          `Generate Rows Node ${nodeId}: Custom schema selected but no customSchemaData provided`,
        );
        console.error(`Generate Rows Node ${nodeId}: config.customSchemaData:`, config.customSchemaData);
        return {
          success: false,
          error: "Custom schema selected but no schema data connected. Please connect a Custom Schema node.",
        };
      }
      // Build schema from custom schema data
      isCustomSchema = true;
      schema = {
        version: 1,
        fields: config.customSchemaData.map((col, index) => ({
          name: col.name,
          field_type: col.type as SCHEMA_FIELD_TYPE,
          is_key: index === 0, // First column is key by default
          default_value: "",
          is_filename: false,
          is_reference: [],
          description: "",
          ca_order: index,
          is_bitwise: 0,
          enum_values: {},
        })),
      };
      hotPathLog(
        executionContext,
        `Generate Rows Node ${nodeId}: Using custom schema with ${schema.fields.length} fields:`,
        schema.fields.map((f: any) => f.name),
      );
    } else {
      // Look up existing table schema from DBNameToDBVersions
      const schemaByTable =
        config.DBNameToDBVersions && Object.keys(config.DBNameToDBVersions).length > 0
          ? config.DBNameToDBVersions
          : await getSchemaForGame(appData.currentGame);
      const versions = schemaByTable?.[outputConfig.existingTableName];
      if (!versions || versions.length === 0) {
        return {
          success: false,
          error: `Table schema "${outputConfig.existingTableName}" not found`,
        };
      }

      schema = versions[0];
      if (outputConfig.tableVersion !== undefined) {
        const version = versions.find((v) => v.version === outputConfig.tableVersion);
        if (version) schema = version;
      } else {
        const defaultTableVersions = await getDefaultTableVersions();
        const defaultTableVersionNumber =
          defaultTableVersions && defaultTableVersions[outputConfig.existingTableName];
        if (defaultTableVersionNumber) {
          const version = versions.find((version) => version.version == defaultTableVersionNumber);
          if (version) schema = version;
        }
      }

      hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Using schema for "${outputConfig.existingTableName}"`, {
        fieldCount: schema.fields.length,
        fields: schema.fields.map((f: any) => f.name),
      });
    }

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

    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Created ${numRows} rows for output "${outputConfig.name}"`);

    // Determine the table name - use a proper name for custom schema
    const outputTableName = isCustomSchema
      ? `custom_${outputConfig.handleId}`
      : outputConfig.existingTableName;

    // Create a default table structure when there's no sourceTable (e.g., counter_range with custom schema only)
    const defaultTable: PackedFile = {
      name: `db\\${outputTableName}\\generated`,
      file_size: 0,
      start_pos: 0,
      tableSchema: schema,
      schemaFields: outputRows,
      version: schema.version,
    };

    // Create TableSelection for this output
    // Handle case where there's no sourceTable (e.g., counter_range with custom schema only)
    const outputTable: DBTablesNodeTable = {
      name: outputTableName,
      fileName: sourceTable?.fileName || `db\\${outputTableName}\\generated`,
      sourceFile:
        sourceTable?.sourceFile ||
        ({
          name: "generated.pack",
          path: "",
          packedFiles: [],
          packHeader: { header: Buffer.alloc(0), byteMask: 0, refFileCount: 0, pack_file_index_size: 0, pack_file_count: 0, header_buffer: Buffer.alloc(0) },
          lastChangedLocal: 0,
          size: 0,
          readTables: [],
        } as Pack),
      table: sourceTable?.table
        ? {
            ...sourceTable.table,
            tableSchema: schema,
            schemaFields: outputRows,
            version: schema.version,
          }
        : defaultTable,
    };

    hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Output table version set to ${schema.version}`);

    outputs[outputConfig.handleId] = {
      type: "TableSelection",
      tables: [outputTable],
      sourceFiles: inputData.sourceFiles || [],
      tableCount: 1,
    };
  }

  hotPathLog(executionContext, `Generate Rows Node ${nodeId}: Generated ${Object.keys(outputs).length} output tables`);

  // 5. Return multi-output result
  return {
    success: true,
    data: outputs,
  };
}

async function executeAddNewColumnNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  rawConfig?: unknown,
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
      /** Write the result back into sourceColumn instead of appending a column. */
      overwriteSource?: boolean;
      /** Apply this transformation only to rows where the condition holds. */
      conditionColumn?: string;
      conditionOperator?: "startsWith" | "equals" | "notEquals" | "contains";
      conditionValue?: string;
    }>;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
  };

  try {
    const parsedConfig = getNodeConfig<typeof config>(rawConfig, textValue);
    if (!parsedConfig) {
      throw new Error("Invalid configuration");
    }
    config = parsedConfig;
    console.log(
      `Add New Column Node ${nodeId}: Parsed ${(config.transformations || []).length} transformations`,
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

  // Helper function to escape regex special characters
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Helper to check if transformation is a filter
  function isFilterTransformation(trans: (typeof config.transformations)[0]): boolean {
    return trans.transformationType === "filterequal" || trans.transformationType === "filternotequal";
  }

  /** An overwriting transformation replaces its source column, so it adds no field to the schema. */
  function isOverwriteTransformation(trans: (typeof config.transformations)[0]): boolean {
    return trans.overwriteSource === true && !isFilterTransformation(trans);
  }

  /**
   * Whether a transformation applies to this row.
   *
   * This is separate from the filter transformations, which drop the row from the output entirely.
   * A condition leaves the row alone and only skips this one transformation, which is what lets a
   * single node hold several rules - append one suffix to the land unit names, another to the main
   * unit names - each matching on a different column from the one it writes.
   */
  function conditionHolds(
    trans: (typeof config.transformations)[0],
    row: AmendedSchemaField[],
  ): boolean {
    if (!trans.conditionColumn || !trans.conditionOperator) return true;
    const conditionValue = trans.conditionValue ?? "";
    const cellValue = row.find((cell) => cell.name === trans.conditionColumn)?.resolvedKeyValue ?? "";

    switch (trans.conditionOperator) {
      case "startsWith":
        return cellValue.startsWith(conditionValue);
      case "equals":
        return cellValue === conditionValue;
      case "notEquals":
        return cellValue !== conditionValue;
      case "contains":
        return cellValue.includes(conditionValue);
      default:
        return true;
    }
  }

  /**
   * A transformation is scoped to the tables that actually have its source column. Without this a
   * multi-table input - a deep clone's output, say - would give every unrelated table a column of
   * empty values. A transformation with no source column is a constant and applies everywhere.
   */
  function appliesToTable(trans: (typeof config.transformations)[0], schema: DBVersion): boolean {
    if (!trans.sourceColumn) return true;
    return schema.fields.some((field) => field.name === trans.sourceColumn);
  }

  // 3. Process every input table on its own terms. Merging their rows would interpret one table's
  // data against another's schema and collapse the whole selection into a single mangled table.
  const outputTables: DBTablesNodeTable[] = [];

  for (const sourceTable of inputData.tables) {
  const tableSchemaForRun = sourceTable.table.tableSchema;
  if (!tableSchemaForRun || !sourceTable.table.schemaFields) {
    console.warn(`Add New Column Node ${nodeId}: Passing through ${sourceTable.name} - no schema`);
    outputTables.push(sourceTable);
    continue;
  }

  const transformationsForTable = config.transformations.filter((trans) =>
    appliesToTable(trans, tableSchemaForRun),
  );
  const rows = getRowsForPackedFile(sourceTable.table);
  if (transformationsForTable.length === 0 || rows.length === 0) {
    outputTables.push(sourceTable);
    continue;
  }

  // Keyed by the transformation's position, not its output column: in overwrite mode several
  // transformations legitimately target the same column, and sharing one array would interleave
  // their values and shift every later row.
  const transformedData = new Map<number, any[]>();
  const filteredRowIndices = new Set<number>(); // Track which rows to exclude

  transformationsForTable.forEach((_transformation, transformationIndex) => {
    transformedData.set(transformationIndex, []);
  });

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const rowTransformedValues = new Map<string, any>(); // Per-row transformation outputs for chaining

    // Process transformations in order (to support chaining)
    for (const transformation of transformationsForTable) {
      let outputValue: any;

      // Get source value - either from original row or previous transformation (chaining)
      if (rowTransformedValues.has(transformation.sourceColumn)) {
        outputValue = rowTransformedValues.get(transformation.sourceColumn);
      } else {
        const sourceCell = row.find((c) => c.name === transformation.sourceColumn);
        outputValue = sourceCell?.resolvedKeyValue ?? "";
      }

      // A row the condition excludes keeps its source value: an overwriting transformation leaves
      // the cell alone, and an appending one copies the source across untransformed. Only the
      // per-row map is set here; the loop below is what pushes one entry per row into
      // transformedData, and pushing again here would shift every later row's value.
      if (!isFilterTransformation(transformation) && !conditionHolds(transformation, row)) {
        rowTransformedValues.set(transformation.outputColumnName, outputValue);
        continue;
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

        case "divide": {
          const divisor = transformation.numericValue || 1;
          outputValue = divisor !== 0 ? parseFloat(String(outputValue)) / divisor : 0;
          break;
        }

        case "rename_whole": {
          const strValue = String(outputValue);
          const matchValue = transformation.matchValue || "";
          if (strValue === matchValue) {
            outputValue = transformation.replaceValue || "";
          }
          // Otherwise keep original value
          break;
        }

        case "rename_substring": {
          const findStr = transformation.findSubstring || "";
          const replaceStr = transformation.replaceValue || "";
          if (findStr) {
            outputValue = String(outputValue).replace(new RegExp(escapeRegex(findStr), "g"), replaceStr);
          }
          break;
        }

        case "replace_substring_whole": {
          const searchSubstr = transformation.findSubstring || "";
          const wholeReplacement = transformation.replaceValue || "";
          if (searchSubstr && String(outputValue).includes(searchSubstr)) {
            outputValue = wholeReplacement;
          }
          // Otherwise keep original value
          break;
        }

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
              error,
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

    // Store all transformed values for this row, one entry per transformation per row
    transformationsForTable.forEach((transformation, transformationIndex) => {
      transformedData.get(transformationIndex)!.push(
        rowTransformedValues.get(transformation.outputColumnName),
      );
    });
  }

  console.log(`Add New Column Node ${nodeId}: Filtered out ${filteredRowIndices.size} rows`);

  // 4. Build output table with original columns + new columns
  const inputSchemaFields = sourceTable.table.tableSchema?.fields ?? [];
  const outputRows: AmendedSchemaField[] = [];
  let outputRowIdx = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    // Skip filtered rows
    if (filteredRowIndices.has(rowIdx)) {
      continue;
    }

    const row = rows[rowIdx];

    // Copy the original columns, applying any overwriting transformation in place. The column keeps
    // its own field type, so a table whose shape matters - a loc is exactly key/text/tooltip - comes
    // out with the same columns it went in with.
    const overwrittenRow = row.map((cell) => ({ ...cell }));
    for (const [transformationIndex, transformation] of transformationsForTable.entries()) {
      if (!isOverwriteTransformation(transformation)) continue;

      const cellIndex = overwrittenRow.findIndex((cell) => cell.name === transformation.sourceColumn);
      if (cellIndex === -1) continue;

      const value = String(transformedData.get(transformationIndex)?.[rowIdx] ?? "");
      if (value === overwrittenRow[cellIndex].resolvedKeyValue) continue;

      const fieldType = inputSchemaFields[cellIndex]?.field_type ?? "StringU8";
      overwrittenRow[cellIndex] = {
        ...overwrittenRow[cellIndex],
        resolvedKeyValue: value,
        type: "Buffer",
        fields: [{ type: "Buffer", val: await typeToBuffer(fieldType, value) }],
      };
    }
    for (const cell of overwrittenRow) {
      outputRows.push(cell);
    }

    // Append new transformed columns (excluding filters and in-place overwrites)
    for (const [transformationIndex, transformation] of transformationsForTable.entries()) {
      if (isFilterTransformation(transformation) || isOverwriteTransformation(transformation)) continue;

      const value = transformedData.get(transformationIndex)?.[rowIdx];

      // Create schema field for the new column
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
  const inputSchema = tableSchemaForRun;
  const extendedSchema: DBVersion = {
    ...inputSchema,
    fields: [
      ...inputSchema.fields,
      ...transformationsForTable
        .filter((t) => !isFilterTransformation(t) && !isOverwriteTransformation(t))
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

  // 6. Emit this table, keeping its own schema and identity
  outputTables.push({
    ...sourceTable,
    table: {
      ...sourceTable.table,
      tableSchema: extendedSchema,
      schemaFields: outputRows,
      version: extendedSchema.version,
    },
  });
  }

  // 7. One output entry per input entry, in the same order
  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: outputTables,
      sourceFiles: inputData.sourceFiles || [],
      tableCount: outputTables.length,
    },
  };
}

async function executeDumpToTSVNode(
  nodeId: string,
  textValue: string,
  inputData: DumpToTSVNodeData | DBNumericAdjustmentNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  console.log(`Dump to TSV Node ${nodeId}: Processing with input type: ${inputData?.type}`);

  if (!inputData || (inputData.type !== "TableSelection" && inputData.type !== "ChangedColumnSelection")) {
    return { success: false, error: "Invalid input: Expected TableSelection or ChangedColumnSelection data" };
  }

  // Handle ChangedColumnSelection input - convert to a format we can dump
  if (inputData.type === "ChangedColumnSelection") {
    const changedData = inputData as DBNumericAdjustmentNodeData;
    const adjustedInputData = changedData.adjustedInputData;

    // adjustedInputData has structure: { type, columns: [{tableName, fileName, sourcePack, sourceTable, selectedColumns, data}] }
    // where data is array of {col, data} - each entry is one value for one row
    if (!adjustedInputData?.columns || adjustedInputData.columns.length === 0) {
      console.log(`Dump to TSV Node ${nodeId}: No columns to dump - skipping file write`);
      return {
        success: true,
        data: changedData, // Pass through the input
      };
    }

    console.log(
      `Dump to TSV Node ${nodeId}: Processing ChangedColumnSelection with ${adjustedInputData.columns.length} table entries`,
    );

    // Build TSV from ChangedColumnSelection
    const tsvLines: string[] = [];

    // Process each adjusted source table so the dump includes the complete rows,
    // not just the columns that were selected for modification.
    for (const tableEntry of adjustedInputData.columns) {
      const tableName = tableEntry.tableName || "unknown";
      const sourceTable = tableEntry.sourceTable;

      if (!sourceTable.schemaFields || !sourceTable.tableSchema) {
        console.warn(`Dump to TSV Node ${nodeId}: Skipping adjusted table "${tableName}" without schema data`);
        continue;
      }

      const rows = getRowsForPackedFile(sourceTable, executionContext);

      console.log(
        `Dump to TSV Node ${nodeId}: Adjusted table "${tableName}" has ${sourceTable.tableSchema.fields.length} columns and ${rows.length} rows`,
      );

      if (rows.length > 0 && tsvLines.length === 0) {
        tsvLines.push(rows[0].map((cell) => cell.name).join("\t"));
      }

      for (const row of rows) {
        const values = row.map((cell) =>
          String(cell.resolvedKeyValue ?? "")
            .replace(/\t/g, " ")
            .replace(/\n/g, " "),
        );
        tsvLines.push(values.join("\t"));
      }
    }

    // Parse filename settings
    let openInWindows = false;
    let filename = "";
    const parsedConfig = getNodeConfig<{ filename?: string; openInWindows?: boolean }>(config, textValue);
    if (parsedConfig) {
      filename = parsedConfig.filename || "";
      openInWindows = parsedConfig.openInWindows ?? false;
    } else {
      filename = textValue || "";
    }

    if (!filename) {
      filename = `changed_columns_dump_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.tsv`;
    }
    if (!filename.endsWith(".tsv")) {
      filename += ".tsv";
    }

    const fs = require("fs");
    const nodePath = require("path");
    const gamePath = appData.gamesToGameFolderPaths[appData.currentGame].gamePath as string;
    const outputPath = nodePath.join(gamePath, filename);

    fs.writeFileSync(outputPath, tsvLines.join("\n"), "utf-8");

    if (openInWindows) {
      const shellOutput = await shell.openPath(outputPath);
      console.log("shell output:", shellOutput);
    }

    console.log(`Dump to TSV Node ${nodeId}: Wrote ${tsvLines.length} lines to ${outputPath}`);

    return {
      success: true,
      data: changedData, // Pass through the ChangedColumnSelection
    };
  }

  // Handle TableSelection input (original logic)
  const tableSelectionData = inputData as DumpToTSVNodeData;

  // Handle empty input - return success without writing file
  if (!tableSelectionData.tables || tableSelectionData.tables.length === 0) {
    console.log(`Dump to TSV Node ${nodeId}: No tables to dump - skipping file write`);
    return {
      success: true,
      data: {
        type: "TableSelection",
        tables: [],
        sourceFiles: tableSelectionData.sourceFiles || [],
        tableCount: 0,
      },
    };
  }

  // Parse filename and openInWindows from textValue (it's stored as JSON with filename key)
  let openInWindows = false;
  let filename = "";
  const parsedConfig = getNodeConfig<{ filename?: string; openInWindows?: boolean }>(config, textValue);
  if (parsedConfig) {
    filename = parsedConfig.filename || "";
    openInWindows = parsedConfig.openInWindows ?? false;
  } else {
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

    for (const tableData of tableSelectionData.tables) {
      if (!tableData.table.schemaFields || !tableData.table.tableSchema) {
        console.warn(`Dump to TSV Node ${nodeId}: Skipping table without schema data`);
        continue;
      }

      // Chunk into rows
      const rows = getRowsForPackedFile(tableData.table, executionContext);

      hotPathLog(executionContext, `Dump to TSV Node ${nodeId}: Processing table with ${rows.length} rows`);

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
          tables: tableSelectionData.tables,
          sourceFiles: tableSelectionData.sourceFiles || [],
          tableCount: tableSelectionData.tableCount || tableSelectionData.tables.length,
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
        tables: tableSelectionData.tables,
        sourceFiles: tableSelectionData.sourceFiles || [],
        tableCount: tableSelectionData.tableCount || tableSelectionData.tables.length,
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
  inputData: PackFilesNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "PackFiles") {
    return { success: false, error: "Invalid input: Expected PackFiles data" };
  }

  // Parse configuration from textValue
  const parsed = getNodeConfig<{ selectedTable?: string; selectedColumn?: string; newColumnName?: string }>(
    config,
    textValue,
  );
  if (!parsed) {
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }
  const selectedTable = parsed.selectedTable || "";
  const selectedColumn = parsed.selectedColumn || "";
  let newColumnName = parsed.newColumnName || "";

  // Use defaults for missing configuration to allow flow to continue
  if (!selectedTable) {
    hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: No table selected - returning empty output`);
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
    hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: No column selected - returning empty output`);
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
    hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: No column name specified, using default: ${newColumnName}`);
  }

  hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: Collecting values from ${selectedTable}.${selectedColumn}`);

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
      const { pack, matchingTablesByName } = await getTableFilesForPackAndTables(
        packFile.path,
        [tableName],
        executionContext,
      );
      const matchingTables = matchingTablesByName.get(tableName) || [];

      for (const table of matchingTables) {
        if (!table.schemaFields || !table.tableSchema) {
          console.warn(`GetCounterColumn Node ${nodeId}: Table without schema: ${table.name}`);
          continue;
        }

        // Chunk into rows
        const rows = getRowsForPackedFile(table, executionContext);

        hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: Found ${rows.length} rows in ${packFile.name}`);

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
    hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: No values found - returning empty output`);
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

  hotPathLog(executionContext, `GetCounterColumn Node ${nodeId}: Collected ${collectedValues.length} values`);

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
  inputData: any,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`CustomSchema Node ${nodeId}: Processing schema definition`);

  // Parse configuration from textValue
  let schemaColumns: Array<CustomSchemaColumn> = [];

  const parsed = getNodeConfig<{ schemaColumns?: Array<CustomSchemaColumn> }>(config, textValue);
  if (!parsed) {
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }
  schemaColumns = parsed.schemaColumns || [];

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
  inputData: any,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: Processing with input:`, inputData);

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

  hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: textValue received:`, textValue);

  const parsed = getNodeConfig<{ tsvFileName?: string }>(config, textValue);
  if (!parsed) {
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }
  tsvFileName = parsed.tsvFileName || "";

  if (!tsvFileName) {
    hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: No TSV file specified - returning empty output`);
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
    hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: No schema columns - returning empty output`);
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
    hotPathLog(
      executionContext,
      `ReadTSVFromPack Node ${nodeId}: Searching for TSV file "${tsvFileName}" in ${packFilesToSearch.length} connected pack(s)`,
    );
  } else {
    // Fall back to all enabled mods (backward compatibility)
    packFilesToSearch = appData.enabledMods.map((mod) => mod.path);
    hotPathLog(
      executionContext,
      `ReadTSVFromPack Node ${nodeId}: Searching for TSV file "${tsvFileName}" in ${packFilesToSearch.length} enabled pack(s)`,
    );
  }

  tsvFileName = tsvFileName.replace(/\//g, "\\");

  // Search for TSV file in pack files
  let tsvContent: string | null = null;
  let sourcePack: Pack | null = null;

  for (const packFile of packFilesToSearch) {
    try {
      // Read the pack file without parsing tables
      const pack = await readPackCached(
        packFile,
        { skipParsingTables: true, filesToRead: [tsvFileName] },
        executionContext,
      );

      // Search for the TSV file in packed files
      const tsvFile = pack.packedFiles.find((pf) =>
        pf.name.toLowerCase().endsWith(tsvFileName.toLowerCase()),
      );

      if (tsvFile) {
        hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: Found TSV file in pack: ${packFile}`);

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
    hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: TSV file not found in any enabled packs`);
    return {
      success: false,
      error: `TSV file "${tsvFileName}" not found in any enabled packs`,
    };
  }

  // Parse TSV content
  // Split by newlines and filter out empty lines (including trailing empty lines at end of file)
  const lines = tsvContent.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: TSV file is empty`);
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
    hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: TSV file only contains header, no data rows`);
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

  hotPathLog(
    executionContext,
    `ReadTSVFromPack Node ${nodeId}: Parsing ${dataLines.length} data rows with ${schemaColumns.length} columns`,
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
    hotPathLog(executionContext, "ReadTSVFromPack values:", values);
    hotPathLog(executionContext, "ReadTSVFromPack num values:", values.length);

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

  hotPathLog(executionContext, `ReadTSVFromPack Node ${nodeId}: Successfully parsed ${dataLines.length} rows from TSV file`);

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
  inputData: any,
  config?: unknown,
): Promise<NodeExecutionResult> {
  console.log(`CustomRowsInput Node ${nodeId}: Processing with input:`, inputData);

  if (!inputData || inputData.type !== "CustomSchema") {
    return { success: false, error: "Invalid input: Expected CustomSchema data" };
  }

  // Parse configuration from textValue
  let customRows: Array<Record<string, string>> = [];
  let tableName = "";
  const schemaColumns = (inputData.schemaColumns || []) as CustomSchemaColumn[];

  const parsed = getNodeConfig<{ customRows?: Array<Record<string, string>>; tableName?: string }>(config, textValue);
  if (!parsed) {
    return {
      success: false,
      error: "Invalid configuration: Failed to parse node settings",
    };
  }
  customRows = parsed.customRows || [];
  tableName = parsed.tableName || "";

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
    `CustomRowsInput Node ${nodeId}: Creating table with ${customRows.length} rows and ${schemaColumns.length} columns`,
  );

  const resolvedTableName = tableName.trim() || `_custom_${nodeId}`;
  const packedTableName = resolvedTableName.startsWith("db\\") ? resolvedTableName : `db\\${resolvedTableName}`;

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
    name: packedTableName,
    schemaFields: schemaFields,
    tableSchema: outputTableSchema,
    file_size: 0,
    start_pos: 0,
  };

  const resultTables: DBTablesNodeTable[] = [
    {
      name: packedTableName,
      fileName: packedTableName,
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

interface DeepCloneNodeConfig {
  cloneTree?: DeepCloneTreeNode;
  nameTemplate?: string;
  useModdersPrefix?: boolean;
  variantAxes?: DeepCloneVariantAxis[];
  columnOverrides?: DeepCloneOverride[];
  moddersPrefix?: string;
  generateLoc?: boolean;
  autoFollowReferences?: boolean;
}

/** Strips the "db\" prefix a TableSelection payload carries, leaving the bare table name. */
const toBareTableName = (name: string) => name.replace(/^db\\/, "").replace(/\\.*$/, "");

/**
 * Every table the run can touch: the clone tree itself, plus the tables that reference each renamed
 * key when auto-follow is on. Derived from the schema, so it is known before any row is read.
 *
 * Auto-follow does not recurse - copied rows keep their own key, so no new key is registered - which
 * is why one level of reverse references is the whole set.
 */
export const collectPlannedTables = (
  cloneTree: DeepCloneTreeNode | undefined,
  reverseReferencesByTable: Record<string, Record<string, string[][]>>,
  ignoredTables: string[],
): string[] => {
  const tables = new Set<string>();
  const walk = (node: DeepCloneTreeNode) => {
    const bareName = toBareTableName(node.table);
    tables.add(bareName);

    if (node.keyColumn) {
      for (const [referencingTable] of reverseReferencesByTable[bareName]?.[node.keyColumn] ?? []) {
        if (!ignoredTables.includes(referencingTable)) tables.add(referencingTable);
      }
    }
    for (const child of node.children || []) {
      if (child.selected) walk(child);
    }
  };
  if (cloneTree) walk(cloneTree);

  return [...tables];
};

async function executeDeepCloneNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  const parsed = getNodeConfig<DeepCloneNodeConfig>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid node configuration" };
  }
  if (!parsed.cloneTree || !parsed.cloneTree.table) {
    return { success: false, error: "No clone plan configured: pick which referenced tables to clone" };
  }
  if (inputData.tables.length === 0) {
    hotPathLog(executionContext, `Deep Clone Node ${nodeId}: No input tables, returning empty result`);
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

  // Search the input packs plus the base game pack, so references into vanilla data resolve.
  const searchPacks = [...(inputData.sourceFiles || [])];
  const baseGamePackName = gameToPackWithDBTablesName[appData.currentGame];
  const baseGameFolder = appData.gamesToGameFolderPaths[appData.currentGame]?.dataFolder;
  if (baseGamePackName && baseGameFolder) {
    const baseGamePackPath = path.join(baseGameFolder, baseGamePackName);
    if (!searchPacks.some((searchPack) => searchPack.path === baseGamePackPath) && fs.existsSync(baseGamePackPath)) {
      searchPacks.push({ name: baseGamePackName, path: baseGamePackPath, loaded: true });
    }
  }

  const rootTableName = toBareTableName(parsed.cloneTree.table);
  const rootTableFiles: LoadedTableFile[] = inputData.tables
    .filter((table) => table.table.tableSchema && table.table.schemaFields)
    .map((table) => ({
      tableName: rootTableName,
      packedFile: table.table,
      packName: table.sourceFile?.name ?? "",
      packPath: table.sourceFile?.path ?? "",
    }));

  /**
   * Tables already read by the prefetch below, and by the on-demand fallback.
   *
   * Reading one table at a time re-parses the whole pack index per call, which dominated the node's
   * runtime, so the planned tables are read in a single pass per pack instead.
   */
  const loadedTablesByName = new Map<string, LoadedTableFile[]>();

  const readTablesFromPacks = async (bareNames: string[]): Promise<void> => {
    if (bareNames.length === 0) return;
    const searchNames = bareNames.map((bareName) => `db\\${bareName}`);
    // Recorded even when a table has no rows anywhere, so a miss is not retried on every lookup.
    for (const bareName of bareNames) {
      if (!loadedTablesByName.has(bareName)) loadedTablesByName.set(bareName, []);
    }

    for (const searchPack of searchPacks) {
      if (!searchPack.loaded) continue;
      try {
        const { pack, matchingTablesByName } = await getTableFilesForPackAndTables(
          searchPack.path,
          searchNames,
          executionContext,
        );
        for (let index = 0; index < bareNames.length; index++) {
          for (const packedFile of matchingTablesByName.get(searchNames[index]) || []) {
            if (!packedFile.tableSchema || !packedFile.schemaFields) continue;
            // Pack order is preserved, so an input pack still shadows the base game.
            loadedTablesByName.get(bareNames[index])!.push({
              tableName: bareNames[index],
              packedFile,
              packName: pack.name,
              packPath: pack.path,
            });
          }
        }
      } catch (error) {
        console.error(`Deep Clone Node ${nodeId}: Error reading ${searchPack.path}:`, error);
      }
    }
  };

  const loadTable = async (tableName: string): Promise<LoadedTableFile[]> => {
    const bareName = toBareTableName(tableName);
    const alreadyLoaded = loadedTablesByName.get(bareName);
    if (alreadyLoaded) return alreadyLoaded;

    // Not in the planned set: the plan is derived from the schema, so this only happens if the graph
    // reaches somewhere unexpected. Reading it here keeps that a slow path, never a wrong result.
    hotPathLog(executionContext, `Deep Clone Node ${nodeId}: reading ${bareName} outside the prefetch`);
    await readTablesFromPacks([bareName]);
    return loadedTablesByName.get(bareName) ?? [];
  };

  let lookupLocText: ((locKey: string) => string | undefined) | undefined;
  if (parsed.generateLoc !== false) {
    const locTries: Trie<string>[] = [];
    const localePath = baseGameFolder ? path.join(baseGameFolder, "local_en.pack") : undefined;
    const locPackPaths = [
      ...(localePath && fs.existsSync(localePath) ? [localePath] : []),
      ...searchPacks.filter((searchPack) => searchPack.loaded).map((searchPack) => searchPack.path),
    ];

    for (const locPackPath of new Set(locPackPaths)) {
      try {
        const locPack = await readPackCached(
          locPackPath,
          { skipParsingTables: true, readLocs: true },
          executionContext,
        );
        const trie = getLocsTrie(locPack);
        if (trie) locTries.push(trie);
      } catch (error) {
        console.error(`Deep Clone Node ${nodeId}: Could not read locs from ${locPackPath}:`, error);
      }
    }

    lookupLocText = (locKey: string) => {
      for (const trie of locTries) {
        const value = trie.get(locKey);
        if (value) return value;
      }
      return undefined;
    };
  }

  // Art addressed by a unit key is not reachable through the schema, so it is found by name. Index
  // just the relevant folders, across the input packs first (a mod may override a vanilla porthole)
  // and then every vanilla pack.
  const plan: DeepClonePlan = {
    cloneTree: { ...parsed.cloneTree, table: rootTableName },
    nameTemplate: parsed.nameTemplate || "{original}{variant}",
    useModdersPrefix: parsed.useModdersPrefix !== false,
    // The flow's own prefix wins: it is the author's, and this may be running on a user's machine.
    // Flows authored before the prefix was saved fall back to the local setting.
    moddersPrefix: parsed.moddersPrefix || appData.moddersPrefix || "",
    variantAxes: parsed.variantAxes || [],
    columnOverrides: parsed.columnOverrides || [],
    generateLoc: parsed.generateLoc !== false,
    autoFollowReferences: parsed.autoFollowReferences !== false,
  };

  // Both reference indexes are built lazily per game; make sure they exist before the engine reads them.
  const referencedColumnsByTable = await getReferencesForGame(appData.currentGame);
  const reverseReferencesByTable = await getDBFieldsReferencedByForGame(appData.currentGame);

  const plannedTables = collectPlannedTables(
    plan.cloneTree,
    plan.autoFollowReferences ? reverseReferencesByTable : {},
    tablesToIgnore,
  );
  const prefetchStartedAt = Date.now();
  await readTablesFromPacks(plannedTables);
  console.log(
    `Deep Clone Node ${nodeId}: prefetched ${plannedTables.length} table(s) from ${searchPacks.length} pack(s) in ${Date.now() - prefetchStartedAt}ms`,
  );

  // Folders named by filename_relative_path on the tables being cloned. Derived from the schema, so
  // a table gaining a new file column needs no change here.
  const schemaFolders = new Set<string>();
  const gameSchema = await getSchemaForGame(appData.currentGame);
  for (const tableName of plannedTables) {
    for (const field of gameSchema[tableName]?.[0]?.fields ?? []) {
      for (const pattern of parseFilenameRelativePaths(field.filename_relative_path)) {
        // Everything before the first placeholder or wildcard is the fixed folder to index.
        const fixedPrefix = pattern.split(/[%*]/)[0];
        if (fixedPrefix.includes("\\")) {
          schemaFolders.add(fixedPrefix.slice(0, fixedPrefix.lastIndexOf("\\") + 1));
        }
      }
    }
  }

  const imageFolders = [...schemaFolders];
  const packPathByFileName = new Map<string, string>();
  if (imageFolders.length > 0) {
    // Only the packs declared to hold this art, never the whole vanilla set: indexing a pack parses
    // its entire file list, and all but one of them would be parsed for nothing.
    const declaredVanillaPacks = imageFolders.flatMap(
      (folder) => deepCloneVanillaPacksByFolder[folder] ?? [],
    );
    const undeclaredFolders = imageFolders.filter((folder) => !deepCloneVanillaPacksByFolder[folder]);
    if (undeclaredFolders.length > 0) {
      console.warn(
        `Deep Clone Node ${nodeId}: no vanilla pack declared for ${undeclaredFolders.join(", ")}; only the flow's input packs are searched there`,
      );
    }
    const vanillaPackPaths = baseGameFolder
      ? [...new Set(declaredVanillaPacks)]
          .map((vanillaPackName) => path.join(baseGameFolder, vanillaPackName))
          .filter((vanillaPackPath) => fs.existsSync(vanillaPackPath))
      : [];
    const indexPackPaths = [
      ...searchPacks.filter((searchPack) => searchPack.loaded).map((searchPack) => searchPack.path),
      ...vanillaPackPaths,
    ];

    for (const indexPackPath of new Set(indexPackPaths)) {
      try {
        const indexedPack = await readPackCached(indexPackPath, { skipParsingTables: true }, executionContext);
        for (const packedFile of indexedPack.packedFiles) {
          if (!imageFolders.some((folder) => packedFile.name.startsWith(folder))) continue;
          // First pack wins, so an input pack's override beats the vanilla file.
          if (!packPathByFileName.has(packedFile.name)) {
            packPathByFileName.set(packedFile.name, indexPackPath);
          }
        }
      } catch (error) {
        console.error(`Deep Clone Node ${nodeId}: Could not index ${indexPackPath}:`, error);
      }
    }
    // Always logged, not debug-gated: silently copying no art is the failure mode that looks like
    // the feature is missing entirely.
    console.log(
      `Deep Clone Node ${nodeId}: indexed ${packPathByFileName.size} art file(s) under ${imageFolders.join(", ")} from ${indexPackPaths.length} pack(s)`,
    );
    if (packPathByFileName.size === 0) {
      console.warn(
        `Deep Clone Node ${nodeId}: no art indexed - checked ${vanillaPackPaths.length} declared vanilla pack(s) (${declaredVanillaPacks.join(", ")}) under ${baseGameFolder ?? "<no data folder>"}`,
      );
    }
  }

  let result;
  try {
    result = await executeDeepClonePlan(rootTableFiles, plan, {
      loadTable,
      getRows: (packedFile) => getRowsForPackedFile(packedFile, executionContext),
      lookupLocText,
      referencedColumnsByTable,
      numericIdFieldByTable: gameToTablesWithNumericIds[appData.currentGame] || {},
      reverseReferencesByTable,
      tablesToIgnore,
      hasPackedFile: packPathByFileName.size > 0 ? (name) => packPathByFileName.has(name) : undefined,
      listPackedFiles:
        packPathByFileName.size > 0
          ? (prefix) => [...packPathByFileName.keys()].filter((name) => name.startsWith(prefix))
          : undefined,
      log: (...args) => hotPathLog(executionContext, `Deep Clone Node ${nodeId}:`, ...args),
    });
  } catch (error) {
    return {
      success: false,
      error: `Deep clone failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }

  // Collisions are reported rather than fatal: flows also run unattended at game launch, where
  // aborting the whole flow over a pre-existing key would be worse than writing the row.
  for (const collision of result.collisions) {
    console.warn(`Deep Clone Node ${nodeId}: Key collision - ${collision}`);
  }
  for (const warning of result.warnings) {
    console.warn(`Deep Clone Node ${nodeId}: ${warning}`);
  }

  const sourcePack = rootTableFiles[0]?.packedFile;
  const outputTables: DBTablesNodeTable[] = result.tables.map((table) => ({
    name: table.tableName,
    fileName: `db\\${table.tableName}\\deepclone`,
    sourceFile: inputData.tables[0]?.sourceFile,
    table: {
      ...(sourcePack ?? ({} as PackedFile)),
      name: `db\\${table.tableName}\\deepclone`,
      file_size: 0,
      start_pos: 0,
      tableSchema: table.tableSchema,
      schemaFields: table.rows.flat(),
      version: table.version,
      entryCount: table.rows.length,
    },
    outputPathPrefix: table.outputPathPrefix,
    outputPathSuffix: table.outputPathSuffix,
  }));

  // Art addressed by a unit key: read the bytes and hand each file to the save node under its new
  // name. Kept as a separate step because the engine only decides *which* files, never reads them.
  if (result.fileCopies.length > 0) {
    outputTables.push(
      ...(await buildFileCopyOutputs(
        result.fileCopies,
        packPathByFileName,
        async (sourcePackPath, names) => {
          const sourcePack = await readPack(sourcePackPath, {
            skipParsingTables: true,
            filesToRead: names,
          });
          return new Map(
            sourcePack.packedFiles
              .filter((packedFile) => names.includes(packedFile.name))
              .map((packedFile) => [packedFile.name, packedFile.buffer]),
          );
        },
        inputData.tables[0]?.sourceFile,
        (message) => console.warn(`Deep Clone Node ${nodeId}: ${message}`),
      )),
    );
  }

  console.log(
    `Deep Clone Node ${nodeId}: ${result.clonedRowCount} row(s) across ${outputTables.length} output entr(ies), including ${result.fileCopies.length} art file(s)`,
  );

  return {
    success: true,
    data: {
      type: "TableSelection",
      tables: outputTables,
      sourceFiles: inputData.sourceFiles || [],
      tableCount: outputTables.length,
    } as DBTablesNodeData,
  };
}

/**
 * Control-flow gate: passes its input straight through, out of one of two handles depending on a
 * checkbox flow option. The handle not taken is reported as inactive, so the executor never runs the
 * nodes behind it — a save or dump on the branch not taken writes nothing at all.
 */
function executeConditionalBranchNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  config?: unknown,
): NodeExecutionResult {
  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  const parsed = getNodeConfig<{ selectedFlowOptionId?: string; flowOptionChecked?: boolean }>(
    config,
    textValue,
  );
  if (!parsed) {
    return { success: false, error: "Invalid node configuration" };
  }
  if (!parsed.selectedFlowOptionId) {
    return { success: false, error: "No flow option selected: pick the checkbox that decides the branch" };
  }

  const isChecked = parsed.flowOptionChecked === true;
  const activeHandle = isChecked ? CONDITIONAL_BRANCH_TRUE_HANDLE : CONDITIONAL_BRANCH_FALSE_HANDLE;

  console.log(
    `Conditional Branch Node ${nodeId}: '${parsed.selectedFlowOptionId}' is ${isChecked}, continuing through ${activeHandle}`,
  );

  return {
    success: true,
    data: inputData,
    activeOutputHandles: [activeHandle],
  };
}

/**
 * Drops the named entries from a table selection and passes the rest through.
 *
 * Matching is on the entry's name, with or without the "db\\" prefix and case-insensitively, so a
 * name typed from the schema list works whichever convention the upstream node used. Non-table
 * payloads carry their own name too - the generated loc, or an art file's path - so they can be
 * dropped the same way.
 */
function executeRemoveTablesNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  config?: unknown,
): NodeExecutionResult {
  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  const parsed = getNodeConfig<{ tablesToRemove?: string[] }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid node configuration" };
  }

  const removalNames = new Set(
    (parsed.tablesToRemove || [])
      .map((tableName) => toBareTableName(tableName).toLowerCase())
      .filter((tableName) => tableName.length > 0),
  );
  if (removalNames.size === 0) {
    return { success: true, data: inputData };
  }

  const keptTables = (inputData.tables || []).filter((table) => {
    const bareName = toBareTableName(table.name).toLowerCase();
    return !removalNames.has(bareName) && !removalNames.has((table.name || "").toLowerCase());
  });

  const removedCount = (inputData.tables || []).length - keptTables.length;
  console.log(
    `Remove Tables Node ${nodeId}: dropped ${removedCount} of ${(inputData.tables || []).length} entr(ies) matching ${[...removalNames].join(", ")}`,
  );

  return {
    success: true,
    data: {
      ...inputData,
      tables: keptTables,
      tableCount: keptTables.length,
    } as DBTablesNodeData,
  };
}

/** A loc table is recognised by its columns rather than its name, so any loc source works. */
const isLocTable = (table: DBTablesNodeTable): boolean => {
  const fields = table.table.tableSchema?.fields;
  if (!fields) return false;
  return fields.some((field) => field.name === "key") && fields.some((field) => field.name === "text");
};

/**
 * Rewrites the text of localisation rows whose key starts with a given prefix.
 *
 * Matching is on a prefix because the rest of a generated loc key is only known at run time: it
 * carries the cloned row's new key, which depends on which rows the run touched, the modders prefix
 * and the variant suffix. The prefix - "<table>_<localised field>_" - comes from the schema and is
 * fixed while authoring, so it is the one part a rule can rely on.
 *
 * Every rule that matches is applied, in order. Rows and tables that match nothing pass through
 * untouched, which is normal: whether a table contributes locs at all depends on the run.
 */
async function executeEditLocTextNode(
  nodeId: string,
  textValue: string,
  inputData: DBTablesNodeData,
  config?: unknown,
  executionContext?: FlowExecutionContext,
): Promise<NodeExecutionResult> {
  if (!inputData || inputData.type !== "TableSelection") {
    return { success: false, error: "Invalid input: Expected TableSelection data" };
  }

  const parsed = getNodeConfig<{ locRules?: LocTextRule[] }>(config, textValue);
  if (!parsed) {
    return { success: false, error: "Invalid node configuration" };
  }

  const locRules = (parsed.locRules || []).filter((rule) => rule && rule.keyPrefix);
  if (locRules.length === 0) {
    return { success: true, data: inputData };
  }

  let changedRowCount = 0;
  const outputTables: DBTablesNodeTable[] = [];

  for (const table of inputData.tables || []) {
    if (!isLocTable(table) || !table.table.schemaFields) {
      outputTables.push(table);
      continue;
    }

    const tableSchema = table.table.tableSchema!;
    const keyIndex = tableSchema.fields.findIndex((field) => field.name === "key");
    const textIndex = tableSchema.fields.findIndex((field) => field.name === "text");
    const textField = tableSchema.fields[textIndex];

    const rows = getRowsForPackedFile(table.table, executionContext);
    const updatedRows: AmendedSchemaField[][] = [];

    for (const row of rows) {
      const locKey = (row[keyIndex]?.resolvedKeyValue ?? "").toLowerCase();
      const originalText = row[textIndex]?.resolvedKeyValue ?? "";
      let nextText = originalText;

      for (const rule of locRules) {
        if (!locKey.startsWith(rule.keyPrefix.toLowerCase())) continue;
        if (rule.find) {
          nextText = nextText.split(rule.find).join(rule.replaceWith ?? "");
        }
        if (rule.prepend) nextText = `${rule.prepend}${nextText}`;
        if (rule.append) nextText = `${nextText}${rule.append}`;
      }

      if (nextText === originalText) {
        updatedRows.push(row);
        continue;
      }

      const updatedRow = row.map((cell) => ({ ...cell }));
      updatedRow[textIndex] = {
        ...updatedRow[textIndex],
        resolvedKeyValue: nextText,
        type: "Buffer",
        fields: [{ type: "Buffer", val: await typeToBuffer(textField.field_type, nextText) }],
      };
      updatedRows.push(updatedRow);
      changedRowCount++;
    }

    outputTables.push({
      ...table,
      table: { ...table.table, schemaFields: updatedRows.flat() },
    });
  }

  console.log(`Edit Loc Text Node ${nodeId}: changed ${changedRowCount} localisation row(s)`);

  return {
    success: true,
    data: { ...inputData, tables: outputTables, tableCount: outputTables.length } as DBTablesNodeData,
  };
}
