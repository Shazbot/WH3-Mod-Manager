import { executeNodeAction, resetCounterTracking } from "./nodeExecutor";
import { SerializedNode, SerializedConnection } from "./components/NodeEditor";

interface NodeGraphExecutionRequest {
  nodes: SerializedNode[];
  connections: SerializedConnection[];
  resetCounters?: boolean; // Optional flag to control counter reset (defaults to true)
}

interface NodeGraphExecutionResult {
  success: boolean;
  executionResults: Map<string, NodeExecutionResult>;
  totalExecuted: number;
  successCount: number;
  failureCount: number;
  error?: string;
}

interface NodeExecutionResult {
  success: boolean;
  data?: any;
  elseData?: any; // For filter node's "else" output handle
  multiOutputs?: Record<string, any>; // For multi-output nodes like generaterows and multifilter
  error?: string;
}

export const executeNodeGraph = async (
  request: NodeGraphExecutionRequest
): Promise<NodeGraphExecutionResult> => {
  const { nodes, connections, resetCounters = true } = request;

  console.log("Starting node graph execution in backend...");
  console.log(`Graph contains ${nodes.length} nodes and ${connections.length} connections`);

  // Reset counter tracking at the start of each flow execution (unless explicitly disabled)
  if (resetCounters) {
    resetCounterTracking();
  }

  try {
    // Build execution graph
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const edgeMap = new Map<string, string[]>();

    // Build adjacency list for connections
    connections.forEach((connection) => {
      if (!edgeMap.has(connection.sourceId)) {
        edgeMap.set(connection.sourceId, []);
      }
      edgeMap.get(connection.sourceId)?.push(connection.targetId);
    });

    // Find starting nodes (nodes with no incoming edges)
    const incomingEdges = new Set(connections.map((conn) => conn.targetId));
    const startingNodes = nodes.filter((node) => !incomingEdges.has(node.id));

    if (startingNodes.length === 0) {
      return {
        success: false,
        executionResults: new Map(),
        totalExecuted: 0,
        successCount: 0,
        failureCount: 0,
        error: "No starting nodes found in the graph",
      };
    }

    console.log(
      `Found ${startingNodes.length} starting nodes:`,
      startingNodes.map((n) => n.id)
    );

    // Execute nodes in topological order using BFS
    const executionResults = new Map<string, NodeExecutionResult>();
    const executionQueue = [...startingNodes.map((node) => ({ node, inputData: null }))];
    const executed = new Set<string>();

    while (executionQueue.length > 0) {
      const { node, inputData } = executionQueue.shift()!;

      if (executed.has(node.id)) continue;

      try {
        console.log(`Executing node: ${node.id} (${node.type})`);

        // Log node data, but exclude verbose DBNameToDBVersions if present
        if ((node.data as any)?.DBNameToDBVersions) {
          const { DBNameToDBVersions, ...dataWithoutDB } = node.data as any;
          console.log(
            `Node data (DBNameToDBVersions excluded, ${
              Object.keys(DBNameToDBVersions || {}).length
            } tables):`,
            dataWithoutDB
          );
        } else {
          console.log(`Node data:`, node.data);
        }

        // Execute the node using existing backend executor
        let textValueToUse = "";
        if (node.type === "packfilesdropdown") {
          textValueToUse = node.data.selectedPack || "";
        } else if (node.type === "tableselectiondropdown") {
          textValueToUse = node.data.selectedTable || "";
        } else if (node.type === "columnselectiondropdown") {
          textValueToUse = node.data.selectedColumn || "";
        } else if (node.type === "groupbycolumns") {
          textValueToUse = JSON.stringify({
            column1: node.data.selectedColumn1 || "",
            column2: node.data.selectedColumn2 || "",
            onlyForMultiple: node.data.onlyForMultiple || false,
          });
        } else if (node.type === "filter") {
          textValueToUse = JSON.stringify({
            filters: (node.data as any).filters || [],
          });
        } else if (node.type === "multifilter") {
          textValueToUse = JSON.stringify({
            selectedColumn: (node.data as any).selectedColumn || "",
            splitValues: (node.data as any).splitValues || [],
          });
        } else if (node.type === "referencelookup") {
          console.log(
            `Reference lookup node ${node.id} data:`,
            JSON.stringify({ ...node.data, DBNameToDBVersions: "not logging this" }, null, 2)
          );
          textValueToUse = JSON.stringify({
            selectedReferenceTable: (node.data as any).selectedReferenceTable || "",
          });
          console.log(`Reference lookup node ${node.id} textValueToUse:`, textValueToUse);
        } else if (node.type === "reversereferencelookup") {
          console.log(
            `Reverse reference lookup node ${node.id} data:`,
            JSON.stringify({ ...node.data, DBNameToDBVersions: "not logging this" }, null, 2)
          );
          textValueToUse = JSON.stringify({
            selectedReverseTable: (node.data as any).selectedReverseTable || "",
          });
          console.log(`Reverse reference lookup node ${node.id} textValueToUse:`, textValueToUse);
        } else if (node.type === "groupedcolumnstotext") {
          textValueToUse = JSON.stringify({
            pattern: (node.data as any).pattern || "{0}: {1}",
            joinSeparator: (node.data as any).joinSeparator || "\\n",
          });
        } else if (node.type === "savechanges") {
          textValueToUse = JSON.stringify({
            packName: (node.data as any).packName || "",
            packedFileName: (node.data as any).packedFileName || "",
            additionalConfig: node.data.textValue || "",
            flowExecutionId: (node.data as any).flowExecutionId || "",
          });
        } else if (node.type === "textsurround") {
          textValueToUse = JSON.stringify({
            surroundText: node.data.textValue || "",
            groupedTextSelection: (node.data as any).groupedTextSelection || "Text",
          });
        } else if (node.type === "appendtext") {
          textValueToUse = JSON.stringify({
            beforeText: (node.data as any).beforeText || "",
            afterText: (node.data as any).afterText || "",
            groupedTextSelection: (node.data as any).groupedTextSelection || "Text",
          });
        } else if (node.type === "allenabledmods") {
          textValueToUse = JSON.stringify({
            includeBaseGame: (node.data as any).includeBaseGame !== false,
          });
        } else if (node.type === "indextable") {
          textValueToUse = JSON.stringify({
            indexColumns: (node.data as any).indexColumns || [],
          });
        } else if (node.type === "lookup") {
          textValueToUse = JSON.stringify({
            lookupColumn: (node.data as any).lookupColumn || "",
            joinType: (node.data as any).joinType || "inner",
            indexColumns: (node.data as any).indexColumns || [],
            indexJoinColumn: (node.data as any).indexJoinColumn || "",
          });
        } else if (node.type === "extracttable") {
          textValueToUse = JSON.stringify({
            tablePrefix: (node.data as any).tablePrefix || "",
          });
        } else if (node.type === "aggregatenested") {
          textValueToUse = JSON.stringify({
            aggregateColumn: (node.data as any).aggregateColumn || "",
            aggregateType: (node.data as any).aggregateType || "min",
            filterColumn: (node.data as any).filterColumn || "",
            filterOperator: (node.data as any).filterOperator || "equals",
            filterValue: (node.data as any).filterValue || "",
          });
        } else if (node.type === "generaterows") {
          console.log(
            `Generate Rows serialization - node.data.transformations:`,
            (node.data as any).transformations
          );
          console.log(
            `Generate Rows serialization - node.data.outputTables:`,
            (node.data as any).outputTables
          );
          console.log(
            `Generate Rows serialization - has DBNameToDBVersions:`,
            !!(node.data as any).DBNameToDBVersions
          );
          textValueToUse = JSON.stringify({
            transformations: (node.data as any).transformations || [],
            outputTables: (node.data as any).outputTables || [],
            DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
          });
          console.log(`Generate Rows serialization - textValueToUse length:`, textValueToUse.length);
        } else if (node.type === "groupby") {
          console.log(
            `Group By serialization - node.data.groupByColumns:`,
            (node.data as any).groupByColumns
          );
          console.log(`Group By serialization - node.data.aggregations:`, (node.data as any).aggregations);
          textValueToUse = JSON.stringify({
            groupByColumns: (node.data as any).groupByColumns || [],
            aggregations: (node.data as any).aggregations || [],
          });
          console.log(`Group By serialization - textValueToUse:`, textValueToUse);
        } else if (node.type === "dumptotsv") {
          textValueToUse = JSON.stringify({
            filename: (node.data as any).filename || "",
          });
        } else if (node.type === "getcountercolumn") {
          textValueToUse = JSON.stringify({
            selectedTable: (node.data as any).selectedTable || "",
            selectedColumn: (node.data as any).selectedColumn || "",
            newColumnName: (node.data as any).newColumnName || "",
          });
        } else if (node.type === "customschema") {
          textValueToUse = JSON.stringify({
            schemaColumns: (node.data as any).schemaColumns || [],
          });
        } else if (node.type === "readtsvfrompack") {
          textValueToUse = JSON.stringify({
            tsvFileName: (node.data as any).tsvFileName || "",
          });
        } else if (node.type === "customrowsinput") {
          textValueToUse = JSON.stringify({
            customRows: (node.data as any).customRows || [],
          });
        } else {
          textValueToUse = node.data.textValue || "";
        }

        const result = await executeNodeAction({
          nodeId: node.id,
          nodeType: node.type,
          textValue: textValueToUse,
          inputData: inputData,
        });

        executionResults.set(node.id, result);
        executed.add(node.id);

        if (result.success) {
          console.log(`Node ${node.id} executed successfully`);

          // Queue connected nodes for execution
          const connectedNodeIds = edgeMap.get(node.id) || [];
          for (const targetNodeId of connectedNodeIds) {
            const targetNode = nodeMap.get(targetNodeId);
            if (targetNode && !executed.has(targetNodeId)) {
              // Check if all dependencies of the target node are completed
              const targetIncomingConnections = connections.filter((conn) => conn.targetId === targetNodeId);
              const allDependenciesCompleted = targetIncomingConnections.every(
                (conn) => executed.has(conn.sourceId) && executionResults.get(conn.sourceId)?.success
              );

              if (allDependenciesCompleted) {
                // For merge changes node, collect all dependency data into an array
                let inputDataForTarget;
                if (targetNode.type === "mergechanges") {
                  // Collect all inputs from all incoming connections
                  const allInputs = targetIncomingConnections
                    .map((conn) => {
                      const sourceResult = executionResults.get(conn.sourceId);
                      const sourceNode = nodeMap.get(conn.sourceId);
                      // Check if sourceHandle is "else" and use elseData if available
                      if (conn.sourceHandle === "else" && sourceResult?.elseData) {
                        return sourceResult.elseData;
                      }
                      // Check if source is generaterows or multifilter with multi-output
                      if (
                        (sourceNode?.type === "generaterows" || sourceNode?.type === "multifilter") &&
                        conn.sourceHandle &&
                        sourceResult?.data &&
                        typeof sourceResult.data === "object" &&
                        !Array.isArray(sourceResult.data)
                      ) {
                        // Extract specific output by handle ID from data field
                        return (sourceResult.data as any)[conn.sourceHandle];
                      }
                      return sourceResult?.data;
                    })
                    .filter((data) => data !== null && data !== undefined);
                  inputDataForTarget = allInputs.length > 0 ? allInputs : null;
                } else if (targetNode.type === "savechanges") {
                  // Save changes node should collect all inputs
                  // Priority: Text > ChangedColumnSelection > TableSelection
                  const allTables: any[] = [];
                  const allSourceFiles: any[] = [];
                  let changedColumnSelectionData = null;
                  let textData = null;

                  for (const conn of targetIncomingConnections) {
                    const sourceResult = executionResults.get(conn.sourceId);
                    const sourceNode = nodeMap.get(conn.sourceId);
                    let inputData = null;

                    // Check if sourceHandle is "else" and use elseData if available
                    if (conn.sourceHandle === "else" && sourceResult?.elseData) {
                      inputData = sourceResult.elseData;
                    }
                    // Check if source is generaterows or multifilter with multi-output
                    else if (
                      (sourceNode?.type === "generaterows" || sourceNode?.type === "multifilter") &&
                      conn.sourceHandle &&
                      sourceResult?.data &&
                      typeof sourceResult.data === "object" &&
                      !Array.isArray(sourceResult.data)
                    ) {
                      // Extract specific output by handle ID from data field
                      inputData = (sourceResult.data as any)[conn.sourceHandle];
                      console.log(
                        `Save Changes: Using output "${conn.sourceHandle}" from ${sourceNode.type} node ${conn.sourceId}`
                      );
                    } else {
                      inputData = sourceResult?.data;
                    }

                    // Handle Text data
                    if (inputData && inputData.type === "Text") {
                      if (!textData) {
                        textData = inputData;
                      }
                    }
                    // Collect tables from TableSelection data
                    else if (inputData && inputData.type === "TableSelection") {
                      if (inputData.tables) {
                        allTables.push(...inputData.tables);
                      }
                      if (inputData.sourceFiles) {
                        allSourceFiles.push(...inputData.sourceFiles);
                      }
                    }
                    // Handle ChangedColumnSelection data
                    else if (inputData && inputData.type === "ChangedColumnSelection") {
                      if (!changedColumnSelectionData) {
                        changedColumnSelectionData = inputData;
                      }
                    }
                  }

                  // Priority: Text > ChangedColumnSelection > TableSelection > null
                  if (textData) {
                    inputDataForTarget = textData;
                    console.log(`Save Changes: Using Text input`);
                  } else if (changedColumnSelectionData) {
                    inputDataForTarget = changedColumnSelectionData;
                    console.log(`Save Changes: Using ChangedColumnSelection input`);
                  } else if (allTables.length > 0) {
                    inputDataForTarget = {
                      type: "TableSelection",
                      tables: allTables,
                      sourceFiles: allSourceFiles,
                      tableCount: allTables.length,
                    };
                    console.log(
                      `Save Changes: Merged ${allTables.length} tables from ${targetIncomingConnections.length} input(s)`
                    );
                  } else {
                    inputDataForTarget = null;
                  }
                } else if (targetNode.type === "lookup") {
                  // Lookup node has two inputs: source and indexed table
                  // Need to collect them in specific order based on targetHandle
                  const sourceConnection = targetIncomingConnections.find(
                    (conn) => conn.targetHandle === "input-source"
                  );
                  const indexConnection = targetIncomingConnections.find(
                    (conn) => conn.targetHandle === "input-index"
                  );

                  if (sourceConnection && indexConnection) {
                    const sourceResult = executionResults.get(sourceConnection.sourceId);
                    const indexResult = executionResults.get(indexConnection.sourceId);
                    inputDataForTarget = [sourceResult?.data, indexResult?.data];
                  } else {
                    inputDataForTarget = null;
                  }
                } else if (targetNode.type === "generaterows" && targetIncomingConnections.length > 1) {
                  // Generate Rows with multiple inputs: merge all TableSelection inputs
                  const mergedSourceFiles: any[] = [];
                  const allTables: any[] = [];

                  // Collect data from all inputs
                  for (const conn of targetIncomingConnections) {
                    const sourceNode = nodeMap.get(conn.sourceId);
                    const sourceResult = executionResults.get(conn.sourceId);

                    let sourceData = null;

                    // For multi-output nodes (generaterows, multifilter), extract specific output
                    if (
                      (sourceNode?.type === "generaterows" || sourceNode?.type === "multifilter") &&
                      conn.sourceHandle &&
                      sourceResult?.data &&
                      typeof sourceResult.data === "object" &&
                      !Array.isArray(sourceResult.data)
                    ) {
                      sourceData = (sourceResult.data as any)[conn.sourceHandle];
                    } else {
                      sourceData = sourceResult?.data;
                    }

                    if (sourceData?.type === "TableSelection") {
                      // Collect tables from this input
                      if (sourceData.tables) {
                        allTables.push(...sourceData.tables);
                      }

                      // Collect source files from this input
                      if (sourceData.sourceFiles) {
                        mergedSourceFiles.push(...sourceData.sourceFiles);
                      }
                    }
                  }

                  if (allTables.length > 0) {
                    inputDataForTarget = {
                      type: "TableSelection",
                      tables: allTables,
                      sourceFiles: mergedSourceFiles,
                      tableCount: allTables.length,
                    };

                    console.log(
                      `Generate Rows: Merged ${allTables.length} tables from ${targetIncomingConnections.length} inputs`
                    );
                  } else {
                    inputDataForTarget = null;
                  }
                } else {
                  // Get input data from the most recent dependency
                  if (targetIncomingConnections.length > 0) {
                    const lastConnection = targetIncomingConnections[targetIncomingConnections.length - 1];
                    const sourceResult = executionResults.get(lastConnection.sourceId);
                    const sourceNode = nodeMap.get(lastConnection.sourceId);

                    // Check if sourceHandle is "else" and use elseData if available (Filter node)
                    if (lastConnection.sourceHandle === "else" && sourceResult?.elseData) {
                      inputDataForTarget = sourceResult.elseData;
                    }
                    // Check if source is generaterows or multifilter with multi-output
                    else if (
                      (sourceNode?.type === "generaterows" || sourceNode?.type === "multifilter") &&
                      lastConnection.sourceHandle &&
                      sourceResult?.data &&
                      typeof sourceResult.data === "object" &&
                      !Array.isArray(sourceResult.data)
                    ) {
                      // Extract specific output by handle ID from data field
                      const outputData = (sourceResult.data as any)[lastConnection.sourceHandle];
                      inputDataForTarget = outputData || null;
                      console.log(
                        `Using output "${lastConnection.sourceHandle}" from ${sourceNode.type} node ${lastConnection.sourceId}`
                      );
                      console.log(
                        `Available handles in ${sourceNode.type} output:`,
                        Object.keys(sourceResult.data)
                      );
                      console.log(`Extracted outputData:`, outputData);
                      console.log(`Output data type:`, outputData?.type);
                    } else {
                      inputDataForTarget = sourceResult?.data;
                    }
                  } else {
                    inputDataForTarget = null;
                  }
                }

                executionQueue.push({
                  node: targetNode,
                  inputData: inputDataForTarget,
                });
              }
            }
          }
        } else {
          console.error(`Node ${node.id} execution failed:`, result.error);
        }
      } catch (error) {
        console.error(`Error executing node ${node.id}:`, error);
        const errorResult = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        executionResults.set(node.id, errorResult);
        executed.add(node.id);
      }
    }

    // Calculate summary statistics
    const successCount = Array.from(executionResults.values()).filter((r) => r.success).length;
    const failureCount = executionResults.size - successCount;

    // Log detailed execution results
    const summary = Array.from(executionResults.entries())
      .map(
        ([nodeId, nodeResult]) =>
          `${nodeId}(${nodeMap.get(nodeId)?.type}): ${nodeResult.success ? "✅" : "❌"}${
            nodeResult.error ? ` (${nodeResult.error})` : ""
          }`
      )
      .join("\n");

    const statusMessage =
      successCount === executionResults.size
        ? `✅ Graph execution successful!`
        : failureCount > 0
        ? `❌ Graph execution completed with errors`
        : `❌ Graph execution failed`;

    console.log("\n" + "=".repeat(80));
    console.log(`BACKEND: ${statusMessage}`);
    console.log(`Execution Summary: ${successCount}/${executionResults.size} nodes succeeded`);
    console.log("-".repeat(80));
    console.log(summary);
    console.log("=".repeat(80) + "\n");

    return {
      success: successCount > 0, // Consider successful if at least one node succeeded
      executionResults,
      totalExecuted: executionResults.size,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error("Graph execution failed:", error);
    return {
      success: false,
      executionResults: new Map(),
      totalExecuted: 0,
      successCount: 0,
      failureCount: 0,
      error: error instanceof Error ? error.message : "Unknown execution error",
    };
  }
};
