import * as fs from "fs";
import * as path from "path";
import { readPack } from "./packFileSerializer";

interface NodeExecutionRequest {
  nodeId: string;
  nodeType: string;
  textValue: string;
  inputData: any;
}

interface NodeExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export const executeNodeAction = async (request: NodeExecutionRequest): Promise<NodeExecutionResult> => {
  const { nodeId, nodeType, textValue, inputData } = request;

  try {
    switch (nodeType) {
      case 'packedfiles':
        return await executePackFilesNode(nodeId, textValue);

      case 'tableselection':
        return await executeTableSelectionNode(nodeId, textValue, inputData);

      case 'columnselection':
        return await executeColumnSelectionNode(nodeId, textValue, inputData);

      case 'numericadjustment':
        return await executeNumericAdjustmentNode(nodeId, textValue, inputData);

      default:
        return {
          success: false,
          error: `Unsupported node type: ${nodeType}`
        };
    }
  } catch (error) {
    console.error(`Error executing ${nodeType} node ${nodeId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown execution error'
    };
  }
};

async function executePackFilesNode(nodeId: string, textValue: string): Promise<NodeExecutionResult> {
  console.log(`PackFiles Node ${nodeId}: Processing "${textValue}"`);

  // Parse file paths from text input
  const filePaths = textValue.split('\n').filter(line => line.trim());
  const packFiles = [];

  for (const filePath of filePaths) {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) continue;

    try {
      // Check if file exists
      if (fs.existsSync(trimmedPath)) {
        const stats = fs.statSync(trimmedPath);
        packFiles.push({
          name: path.basename(trimmedPath),
          path: trimmedPath,
          size: stats.size,
          lastModified: stats.mtime,
          loaded: true
        });
      } else {
        console.warn(`PackFiles Node ${nodeId}: File not found: ${trimmedPath}`);
        packFiles.push({
          name: path.basename(trimmedPath),
          path: trimmedPath,
          size: 0,
          lastModified: null,
          loaded: false,
          error: 'File not found'
        });
      }
    } catch (error) {
      console.error(`PackFiles Node ${nodeId}: Error processing file ${trimmedPath}:`, error);
      packFiles.push({
        name: path.basename(trimmedPath),
        path: trimmedPath,
        size: 0,
        lastModified: null,
        loaded: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return {
    success: true,
    data: {
      type: 'PackFiles',
      files: packFiles,
      count: packFiles.length,
      loadedCount: packFiles.filter(f => f.loaded).length
    }
  };
}

async function executeTableSelectionNode(nodeId: string, textValue: string, inputData: any): Promise<NodeExecutionResult> {
  console.log(`TableSelection Node ${nodeId}: Processing "${textValue}" with input:`, inputData);

  if (!inputData || inputData.type !== 'PackFiles') {
    return { success: false, error: 'Invalid input: Expected PackFiles data' };
  }

  const tableNames = textValue.split('\n').filter(line => line.trim()).map(name => name.trim());
  const selectedTables = [];

  for (const file of inputData.files) {
    if (!file.loaded) {
      console.warn(`Skipping unloaded file: ${file.path}`);
      continue;
    }

    try {
      // Read pack file to get table information
      const pack = await readPack(file.path);

      for (const tableName of tableNames) {
        // Find tables that match the criteria
        const matchingTables = pack.packedFiles.filter(pf =>
          pf.name.includes(tableName) || pf.name.includes(`${tableName}.tsv`)
        );

        for (const table of matchingTables) {
          selectedTables.push({
            name: tableName,
            fileName: table.name,
            sourceFile: file.path,
            size: table.data?.length || 0,
            // Mock some columns for now - in real implementation, you'd parse the table structure
            columns: ['id', 'key', 'value', 'description']
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
      type: 'TableSelection',
      tables: selectedTables,
      sourceFiles: inputData.files,
      tableCount: selectedTables.length
    }
  };
}

async function executeColumnSelectionNode(nodeId: string, textValue: string, inputData: any): Promise<NodeExecutionResult> {
  console.log(`ColumnSelection Node ${nodeId}: Processing "${textValue}" with input:`, inputData);

  if (!inputData || inputData.type !== 'TableSelection') {
    return { success: false, error: 'Invalid input: Expected TableSelection data' };
  }

  const selectedColumns = textValue.split('\n').filter(line => line.trim()).map(col => col.trim());
  const columnData = [];

  for (const table of inputData.tables) {
    // Filter columns that exist in the table and match selection criteria
    const availableColumns = selectedColumns.filter(col =>
      table.columns.includes(col)
    );

    if (availableColumns.length > 0) {
      columnData.push({
        tableName: table.name,
        fileName: table.fileName,
        sourceFile: table.sourceFile,
        selectedColumns: availableColumns,
        // Mock some sample data - in real implementation, you'd extract actual column data
        data: availableColumns.map(col => ({
          column: col,
          type: 'string', // This would be determined from actual data
          sampleValues: Array.from({length: Math.min(5, 10)}, (_, i) => `${col}_value_${i + 1}`)
        }))
      });
    }
  }

  return {
    success: true,
    data: {
      type: 'ColumnSelection',
      columns: columnData,
      sourceTables: inputData.tables,
      selectedColumnCount: columnData.reduce((sum, table) => sum + table.selectedColumns.length, 0)
    }
  };
}

// Formula evaluation function
function evaluateFormula(formula: string, x: number): number {
  // Sanitize the formula - only allow safe mathematical operations
  const sanitized = formula
    .replace(/\s+/g, '') // Remove whitespace
    .replace(/\^/g, '**') // Convert ^ to ** for exponentiation
    .replace(/[^x0-9+\-*/().\s]/g, ''); // Remove any unsafe characters

  // Replace 'x' with the actual value
  const expression = sanitized.replace(/x/g, x.toString());

  // Validate that the expression only contains safe characters
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error('Invalid formula: contains unsafe characters');
  }

  try {
    // Use Function constructor for safe evaluation (better than eval)
    const result = new Function('return ' + expression)();

    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
      throw new Error('Formula evaluation resulted in invalid number');
    }

    return result;
  } catch (error) {
    throw new Error(`Formula evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function executeNumericAdjustmentNode(nodeId: string, textValue: string, inputData: any): Promise<NodeExecutionResult> {
  console.log(`NumericAdjustment Node ${nodeId}: Processing formula "${textValue}" with input:`, inputData);

  if (!inputData || inputData.type !== 'ColumnSelection') {
    return { success: false, error: 'Invalid input: Expected ColumnSelection data' };
  }

  const formula = textValue.trim();

  if (!formula) {
    return {
      success: false,
      error: 'No formula provided. Enter a mathematical expression using x as the input variable.'
    };
  }

  // Validate that the formula contains 'x' variable
  if (!formula.includes('x')) {
    return {
      success: false,
      error: 'Formula must contain variable x representing the input value.'
    };
  }

  // Test the formula with a sample value to check for syntax errors
  try {
    evaluateFormula(formula, 1);
  } catch (error) {
    return {
      success: false,
      error: `Invalid formula: ${error instanceof Error ? error.message : 'Syntax error'}`
    };
  }

  // Apply formula to numeric columns
  const adjustedData = inputData.columns.map((table: any) => ({
    ...table,
    data: table.data.map((col: any) => ({
      ...col,
      formula: formula,
      // In real implementation, you'd apply formula to actual numeric data
      adjustedSampleValues: col.sampleValues?.map((val: string) => {
        const numVal = parseFloat(val.replace(/[^\d.-]/g, ''));
        if (isNaN(numVal)) return val; // Keep non-numeric values as-is

        try {
          const result = evaluateFormula(formula, numVal);
          return result.toString();
        } catch (error) {
          console.warn(`Failed to apply formula to value ${numVal}:`, error);
          return val; // Return original value on error
        }
      }) || []
    }))
  }));

  return {
    success: true,
    data: {
      type: 'ChangedColumnSelection',
      adjustedColumns: adjustedData,
      appliedFormula: formula,
      originalData: inputData,
      processedValues: adjustedData.reduce((count, table) =>
        count + table.data.reduce((colCount: number, col: any) =>
          colCount + (col.adjustedSampleValues?.length || 0), 0), 0)
    }
  };
}