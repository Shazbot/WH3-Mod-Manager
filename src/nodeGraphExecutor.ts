import { executeNodeAction } from "./nodeExecutor";

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
  data: {
    label: string;
    type: string;
    textValue?: string;
    selectedPack?: string;
    outputType?: string;
    inputType?: string;
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

        // Execute the node using existing backend executor
        const textValueToUse = node.type === "packfilesdropdown"
          ? (node.data.selectedPack || "")
          : (node.data.textValue || "");

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
