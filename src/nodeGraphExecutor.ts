import { XYPosition } from "@xyflow/react";
import { executeNodeAction } from "./nodeExecutor";
import { DBVersion } from "./packFileTypes";

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

interface SerializedNode {
  id: string;
  type: FlowNodeType;
  position?: XYPosition;
  data: {
    label: string;
    type: FlowNodeType;
    textValue?: string;
    selectedPack?: string;
    selectedTable?: string;
    selectedColumn?: string;
    selectedColumn1?: string;
    selectedColumn2?: string;
    packName?: string;
    packedFileName?: string;
    pattern?: string;
    joinSeparator?: string;
    beforeText?: string;
    afterText?: string;
    useCurrentPack?: boolean;
    filters?: Array<{ column: string; value: string; not: boolean; operator: "AND" | "OR" }>;
    columnNames?: string[];
    connectedTableName?: string;
    outputType?: string;
    inputType?: string;
    DBNameToDBVersions?: Record<string, DBVersion[]>;
    groupedTextSelection?: "Text" | "Text Lines";
  };
}

interface SerializedConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType?: string;
  targetType?: string;
}

interface NodeExecutionResult {
  success: boolean;
  data?: any;
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
        console.log(`Node data:`, node.data);

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
          });
        } else if (node.type === "filter") {
          textValueToUse = JSON.stringify({
            filters: (node.data as any).filters || [],
          });
        } else if (node.type === "referencelookup") {
          textValueToUse = JSON.stringify({
            selectedReferenceTable: (node.data as any).selectedReferenceTable || "",
          });
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
                // Get input data from the most recent dependency (or combine if needed)
                const lastDependencyData =
                  targetIncomingConnections.length > 0
                    ? executionResults.get(
                        targetIncomingConnections[targetIncomingConnections.length - 1].sourceId
                      )?.data
                    : null;

                executionQueue.push({
                  node: targetNode,
                  inputData: lastDependencyData,
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
