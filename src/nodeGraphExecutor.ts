import type { SerializedConnection, SerializedNode } from "./nodeGraph/types";
import { FlowExecutionContext, flowExecutionDebugLog } from "./flowExecutionSupport";
import { executeNodeAction, resetCounterTracking } from "./nodeExecutor";
interface NodeGraphExecutionRequest {
  nodes: SerializedNode[];
  connections: SerializedConnection[];
  nodeConfigs?: Record<string, unknown>;
  executionContext?: FlowExecutionContext;
  resetCounters?: boolean;
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
  elseData?: any;
  multiOutputs?: Record<string, any>;
  error?: string;
}
const isMultiOutputNodeType = (nodeType?: string): boolean =>
  nodeType === "generaterows" || nodeType === "generaterowsschema" || nodeType === "multifilter";
const serializeNodeConfigForExecution = (node: SerializedNode): string => {
  if (node.type === "packfilesdropdown") {
    return node.data.selectedPack || "";
  }
  if (node.type === "tableselectiondropdown") {
    return node.data.selectedTable || "";
  }
  if (node.type === "columnselectiondropdown") {
    return node.data.selectedColumn || "";
  }
  if (node.type === "groupbycolumns") {
    return JSON.stringify({
      column1: node.data.selectedColumn1 || "",
      column2: node.data.selectedColumn2 || "",
      onlyForMultiple: node.data.onlyForMultiple || false,
    });
  }
  if (node.type === "filter") {
    return JSON.stringify({
      filters: (node.data as any).filters || [],
    });
  }
  if (node.type === "multifilter") {
    return JSON.stringify({
      selectedColumn: (node.data as any).selectedColumn || "",
      splitValues: (node.data as any).splitValues || [],
    });
  }
  if (node.type === "referencelookup") {
    return JSON.stringify({
      selectedReferenceTable: (node.data as any).selectedReferenceTable || "",
      includeBaseGame: (node.data as any).includeBaseGame !== false,
    });
  }
  if (node.type === "reversereferencelookup") {
    return JSON.stringify({
      selectedReverseTable: (node.data as any).selectedReverseTable || "",
      includeBaseGame: (node.data as any).includeBaseGame !== false,
    });
  }
  if (node.type === "groupedcolumnstotext") {
    return JSON.stringify({
      pattern: (node.data as any).pattern || "{0}: {1}",
      joinSeparator: (node.data as any).joinSeparator || "\\n",
    });
  }
  if (node.type === "savechanges") {
    return JSON.stringify({
      packName: (node.data as any).packName || "",
      packedFileName: (node.data as any).packedFileName || "",
      additionalConfig: node.data.textValue || "",
      flowExecutionId: (node.data as any).flowExecutionId || "",
    });
  }
  if (node.type === "textsurround") {
    return JSON.stringify({
      surroundText: node.data.textValue || "",
      groupedTextSelection: (node.data as any).groupedTextSelection || "Text",
    });
  }
  if (node.type === "appendtext") {
    return JSON.stringify({
      beforeText: (node.data as any).beforeText || "",
      afterText: (node.data as any).afterText || "",
      groupedTextSelection: (node.data as any).groupedTextSelection || "Text",
    });
  }
  if (node.type === "allenabledmods") {
    return JSON.stringify({
      includeBaseGame: (node.data as any).includeBaseGame !== false,
    });
  }
  if (node.type === "indextable") {
    return JSON.stringify({
      indexColumns: (node.data as any).indexColumns || [],
    });
  }
  if (node.type === "lookup") {
    return JSON.stringify({
      lookupColumn: (node.data as any).lookupColumn || "",
      joinType: (node.data as any).joinType || "inner",
      indexColumns: (node.data as any).indexColumns || [],
      indexJoinColumn: (node.data as any).indexJoinColumn || "",
    });
  }
  if (node.type === "extracttable") {
    return JSON.stringify({
      tablePrefix: (node.data as any).tablePrefix || "",
    });
  }
  if (node.type === "aggregatenested") {
    return JSON.stringify({
      aggregateColumn: (node.data as any).aggregateColumn || "",
      aggregateType: (node.data as any).aggregateType || "min",
      filterColumn: (node.data as any).filterColumn || "",
      filterOperator: (node.data as any).filterOperator || "equals",
      filterValue: (node.data as any).filterValue || "",
    });
  }
  if (node.type === "generaterows" || node.type === "generaterowsschema") {
    return JSON.stringify({
      transformations: (node.data as any).transformations || [],
      outputTables: (node.data as any).outputTables || [],
      DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
      customSchemaData: (node.data as any).customSchemaData || null,
    });
  }
  if (node.type === "addnewcolumn") {
    return JSON.stringify({
      transformations: (node.data as any).transformations || [],
      DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
    });
  }
  if (node.type === "groupby") {
    return JSON.stringify({
      groupByColumns: (node.data as any).groupByColumns || [],
      aggregations: (node.data as any).aggregations || [],
    });
  }
  if (node.type === "deduplicate") {
    return JSON.stringify({
      dedupeByColumns: (node.data as any).dedupeByColumns || [],
      dedupeAgainstVanilla: (node.data as any).dedupeAgainstVanilla || false,
    });
  }
  if (node.type === "dumptotsv") {
    return JSON.stringify({
      filename: (node.data as any).filename || "",
      openInWindows: (node.data as any).openInWindows ?? false,
    });
  }
  if (node.type === "getcountercolumn") {
    return JSON.stringify({
      selectedTable: (node.data as any).selectedTable || "",
      selectedColumn: (node.data as any).selectedColumn || "",
      newColumnName: (node.data as any).newColumnName || "",
    });
  }
  if (node.type === "customschema") {
    return JSON.stringify({
      schemaColumns: (node.data as any).schemaColumns || [],
    });
  }
  if (node.type === "readtsvfrompack") {
    return JSON.stringify({
      tsvFileName: (node.data as any).tsvFileName || "",
    });
  }
  if (node.type === "customrowsinput") {
    return JSON.stringify({
      customRows: (node.data as any).customRows || [],
    });
  }
  return node.data.textValue || "";
};
const extractConnectionData = (
  connection: SerializedConnection,
  executionResults: Map<string, NodeExecutionResult>,
  nodeMap: Map<string, SerializedNode>,
) => {
  const sourceResult = executionResults.get(connection.sourceId);
  if (!sourceResult) return null;
  if (connection.sourceHandle === "else" && sourceResult.elseData) {
    return sourceResult.elseData;
  }
  const sourceNode = nodeMap.get(connection.sourceId);
  if (
    isMultiOutputNodeType(sourceNode?.type) &&
    connection.sourceHandle &&
    sourceResult.data &&
    typeof sourceResult.data === "object" &&
    !Array.isArray(sourceResult.data)
  ) {
    return (sourceResult.data as Record<string, any>)[connection.sourceHandle] ?? null;
  }
  return sourceResult.data ?? null;
};
const mergeTableSelectionInputs = (
  targetIncomingConnections: SerializedConnection[],
  executionResults: Map<string, NodeExecutionResult>,
  nodeMap: Map<string, SerializedNode>,
) => {
  const mergedSourceFiles: any[] = [];
  const allTables: any[] = [];
  for (const connection of targetIncomingConnections) {
    const sourceData = extractConnectionData(connection, executionResults, nodeMap);
    if (sourceData?.type !== "TableSelection") continue;
    if (sourceData.tables) {
      allTables.push(...sourceData.tables);
    }
    if (sourceData.sourceFiles) {
      mergedSourceFiles.push(...sourceData.sourceFiles);
    }
  }
  if (allTables.length === 0) {
    return null;
  }
  return {
    type: "TableSelection",
    tables: allTables,
    sourceFiles: mergedSourceFiles,
    tableCount: allTables.length,
  };
};
const buildInputDataForTarget = (
  targetNode: SerializedNode,
  targetIncomingConnections: SerializedConnection[],
  executionResults: Map<string, NodeExecutionResult>,
  nodeMap: Map<string, SerializedNode>,
) => {
  if (
    targetNode.type === "mergechanges" ||
    targetNode.type === "numericadjustment" ||
    targetNode.type === "mathmax" ||
    targetNode.type === "mathceil"
  ) {
    const allInputs = targetIncomingConnections
      .map((connection) => extractConnectionData(connection, executionResults, nodeMap))
      .filter((data) => data !== null && data !== undefined);
    return allInputs.length > 0 ? allInputs : null;
  }
  if (targetNode.type === "savechanges") {
    const allTables: any[] = [];
    const allSourceFiles: any[] = [];
    let changedColumnSelectionData = null;
    let textData = null;
    for (const connection of targetIncomingConnections) {
      const inputData = extractConnectionData(connection, executionResults, nodeMap);
      if (inputData?.type === "Text" && !textData) {
        textData = inputData;
      } else if (inputData?.type === "TableSelection") {
        if (inputData.tables) {
          allTables.push(...inputData.tables);
        }
        if (inputData.sourceFiles) {
          allSourceFiles.push(...inputData.sourceFiles);
        }
      } else if (inputData?.type === "ChangedColumnSelection" && !changedColumnSelectionData) {
        changedColumnSelectionData = inputData;
      }
    }
    if (textData) return textData;
    if (changedColumnSelectionData) return changedColumnSelectionData;
    if (allTables.length > 0) {
      return {
        type: "TableSelection",
        tables: allTables,
        sourceFiles: allSourceFiles,
        tableCount: allTables.length,
      };
    }
    return null;
  }
  if (targetNode.type === "lookup") {
    const sourceConnection = targetIncomingConnections.find((connection) => connection.targetHandle === "input-source");
    const indexConnection = targetIncomingConnections.find((connection) => connection.targetHandle === "input-index");
    if (!sourceConnection || !indexConnection) {
      return null;
    }
    return [
      extractConnectionData(sourceConnection, executionResults, nodeMap),
      extractConnectionData(indexConnection, executionResults, nodeMap),
    ];
  }
  if (targetNode.type === "readtsvfrompack") {
    const schemaConnection = targetIncomingConnections.find((connection) => connection.targetHandle === "input-schema");
    const packsConnection = targetIncomingConnections.find((connection) => connection.targetHandle === "input-packs");
    if (!schemaConnection) {
      return null;
    }
    return [
      extractConnectionData(schemaConnection, executionResults, nodeMap),
      packsConnection ? extractConnectionData(packsConnection, executionResults, nodeMap) : null,
    ];
  }
  if (
    (targetNode.type === "generaterows" ||
      targetNode.type === "generaterowsschema" ||
      targetNode.type === "dumptotsv") &&
    targetIncomingConnections.length > 1
  ) {
    return mergeTableSelectionInputs(targetIncomingConnections, executionResults, nodeMap);
  }
  if (targetIncomingConnections.length === 0) {
    return null;
  }
  return extractConnectionData(targetIncomingConnections[targetIncomingConnections.length - 1], executionResults, nodeMap);
};
export const executeNodeGraph = async (request: NodeGraphExecutionRequest): Promise<NodeGraphExecutionResult> => {
  const { nodes, connections, nodeConfigs, executionContext, resetCounters = true } = request;
  const startTime = performance.now();
  console.log(`Starting node graph execution: ${nodes.length} nodes, ${connections.length} connections`);
  if (resetCounters) {
    resetCounterTracking();
  }
  try {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const outgoingConnectionsBySource = new Map<string, SerializedConnection[]>();
    const incomingConnectionsByTarget = new Map<string, SerializedConnection[]>();
    const incomingEdges = new Set<string>();
    for (const connection of connections) {
      const outgoingConnections = outgoingConnectionsBySource.get(connection.sourceId);
      if (outgoingConnections) {
        outgoingConnections.push(connection);
      } else {
        outgoingConnectionsBySource.set(connection.sourceId, [connection]);
      }
      const incomingConnections = incomingConnectionsByTarget.get(connection.targetId);
      if (incomingConnections) {
        incomingConnections.push(connection);
      } else {
        incomingConnectionsByTarget.set(connection.targetId, [connection]);
      }
      incomingEdges.add(connection.targetId);
    }
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
    flowExecutionDebugLog(
      executionContext,
      `Graph starting nodes: ${startingNodes.map((node) => `${node.id}(${node.type})`).join(", ")}`,
    );
    const executionResults = new Map<string, NodeExecutionResult>();
    const executed = new Set<string>();
    const executionQueue = startingNodes.map((node) => ({ node, inputData: null as any }));
    let queueIndex = 0;
    while (queueIndex < executionQueue.length) {
      const { node, inputData } = executionQueue[queueIndex++];
      if (executed.has(node.id)) {
        continue;
      }
      try {
        flowExecutionDebugLog(executionContext, `Executing node ${node.id} (${node.type})`);
        const config = nodeConfigs?.[node.id];
        const textValue =
          config === undefined ? serializeNodeConfigForExecution(node) : typeof config === "string" ? config : "";
        const result = await executeNodeAction({
          nodeId: node.id,
          nodeType: node.type,
          textValue,
          inputData,
          config,
          executionContext,
        });
        executionResults.set(node.id, result);
        executed.add(node.id);
        if (!result.success) {
          console.error(`Node ${node.id} (${node.type}) execution failed:`, result.error);
          continue;
        }
        const outgoingConnections = outgoingConnectionsBySource.get(node.id) || [];
        for (const connection of outgoingConnections) {
          const targetNode = nodeMap.get(connection.targetId);
          if (!targetNode || executed.has(targetNode.id)) {
            continue;
          }
          const targetIncomingConnections = incomingConnectionsByTarget.get(targetNode.id) || [];
          const allDependenciesCompleted = targetIncomingConnections.every(
            (incomingConnection) =>
              executed.has(incomingConnection.sourceId) && executionResults.get(incomingConnection.sourceId)?.success,
          );
          if (!allDependenciesCompleted) {
            continue;
          }
          executionQueue.push({
            node: targetNode,
            inputData: buildInputDataForTarget(targetNode, targetIncomingConnections, executionResults, nodeMap),
          });
        }
      } catch (error) {
        console.error(`Error executing node ${node.id}:`, error);
        executionResults.set(node.id, {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        executed.add(node.id);
      }
    }
    const successCount = Array.from(executionResults.values()).filter((result) => result.success).length;
    const failureCount = executionResults.size - successCount;
    const elapsedTime = performance.now() - startTime;
    console.log(
      `Node graph execution finished in ${elapsedTime.toFixed(2)}ms: ${successCount}/${executionResults.size} nodes succeeded`,
    );
    return {
      success: successCount > 0,
      executionResults,
      totalExecuted: executionResults.size,
      successCount,
      failureCount,
    };
  } catch (error) {
    const elapsedTime = performance.now() - startTime;
    console.error(`Graph execution failed after ${elapsedTime.toFixed(2)}ms:`, error);
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
