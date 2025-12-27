import { executeNodeAction } from "./nodeExecutor";
import { SerializedNode, SerializedConnection } from "./components/NodeEditor";

interface NodeGraphExecutionRequest {
  nodes: SerializedNode[];
  connections: SerializedConnection[];
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
  error?: string;
}

export const executeNodeGraph = async (
  request: NodeGraphExecutionRequest
): Promise<NodeGraphExecutionResult> => {
  const { nodes, connections } = request;

  console.log("Starting node graph execution in backend...");
  console.log(`Graph contains ${nodes.length} nodes and ${connections.length} connections`);

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
          console.log(`Node data (DBNameToDBVersions excluded, ${Object.keys(DBNameToDBVersions || {}).length} tables):`, dataWithoutDB);
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
        } else if (node.type === "referencelookup") {
          console.log(`Reference lookup node ${node.id} data:`, JSON.stringify(node.data, null, 2));
          textValueToUse = JSON.stringify({
            selectedReferenceTable: (node.data as any).selectedReferenceTable || "",
          });
          console.log(`Reference lookup node ${node.id} textValueToUse:`, textValueToUse);
        } else if (node.type === "reversereferencelookup") {
          console.log(`Reverse reference lookup node ${node.id} data:`, JSON.stringify(node.data, null, 2));
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
          console.log(`Generate Rows serialization - node.data.transformations:`, (node.data as any).transformations);
          console.log(`Generate Rows serialization - node.data.outputTables:`, (node.data as any).outputTables);
          console.log(`Generate Rows serialization - has DBNameToDBVersions:`, !!(node.data as any).DBNameToDBVersions);
          textValueToUse = JSON.stringify({
            transformations: (node.data as any).transformations || [],
            outputTables: (node.data as any).outputTables || [],
            DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
          });
          console.log(`Generate Rows serialization - textValueToUse length:`, textValueToUse.length);
        } else if (node.type === "groupby") {
          console.log(`Group By serialization - node.data.groupByColumns:`, (node.data as any).groupByColumns);
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
                      // Check if sourceHandle is "else" and use elseData if available
                      if (conn.sourceHandle === "else" && sourceResult?.elseData) {
                        return sourceResult.elseData;
                      }
                      return sourceResult?.data;
                    })
                    .filter((data) => data !== null && data !== undefined);
                  inputDataForTarget = allInputs.length > 0 ? allInputs : null;
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
                } else {
                  // Get input data from the most recent dependency
                  if (targetIncomingConnections.length > 0) {
                    const lastConnection =
                      targetIncomingConnections[targetIncomingConnections.length - 1];
                    const sourceResult = executionResults.get(lastConnection.sourceId);
                    const sourceNode = nodeMap.get(lastConnection.sourceId);

                    // Check if sourceHandle is "else" and use elseData if available (Filter node)
                    if (lastConnection.sourceHandle === "else" && sourceResult?.elseData) {
                      inputDataForTarget = sourceResult.elseData;
                    }
                    // Check if source is generaterows with multi-output
                    else if (
                      sourceNode?.type === "generaterows" &&
                      lastConnection.sourceHandle &&
                      sourceResult?.data &&
                      typeof sourceResult.data === "object" &&
                      !Array.isArray(sourceResult.data)
                    ) {
                      // Extract specific output by handle ID
                      const outputData = (sourceResult.data as any)[lastConnection.sourceHandle];
                      inputDataForTarget = outputData || null;
                      console.log(
                        `Using output "${lastConnection.sourceHandle}" from generaterows node ${lastConnection.sourceId}`
                      );
                      console.log(`Available handles in generaterows output:`, Object.keys(sourceResult.data));
                      console.log(`Extracted outputData:`, outputData);
                      console.log(`Output data type:`, outputData?.type);
                    }
                    else {
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

    console.log(
      `Backend graph execution completed: ${successCount}/${executionResults.size} nodes succeeded`
    );

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
