/**
 * Launch-time flow runs: prepares each packaged flow with the player's option values and executes
 * it before the game starts. Kept out of packFileSerializer so pack I/O does not depend on the
 * flow executor.
 */
import deepClone from "clone-deep";
import * as fs from "fs";
import appData from "./appData";
import {
  PreparedFlow,
  buildAutomaticFlowExecutionId,
  canReuseFlowSourcePack,
  createFlowExecutionContext,
  flowExecutionDebugLog,
  isFlowExecutionDebugEnabled,
} from "./flowExecutionSupport";
import type { NativePatchFlowRuntimeContribution } from "./nativePatches/flowTemplate";
import { isPackedFlowName } from "./nodeGraph/flowPackOperations";
import { transformationOptionFields } from "./nodeGraph/graphSerialization";
import { isNativePatchSchemaConnection } from "./nodeGraph/nativePatchSchema";
import {
  substituteDeepCloneOptionValues,
  substituteEditXmlOptionValues,
  substituteFilterOptionValues,
  substituteLocRuleValues,
  substituteTextFileRuleValues,
} from "./nodeGraph/nestedOptionValues";
import type { SerializedNodeGraph } from "./nodeGraph/types";
import { resolveRadioChoiceId, splitMultilineOptionValue } from "./nodeGraph/types";
import { executeNodeGraph } from "./nodeGraphExecutor";
import { readPack } from "./packFileSerializer";
import type { Pack } from "./packFileTypes";
import { DBNameToDBVersions } from "./schema";
import { normalizePackFilePathKey } from "./utility/packFilePathUtils";

const flowOptionTextFields = [
  "textValue",
  "pattern",
  "beforeText",
  "afterText",
  "joinSeparator",
  "packName",
  "packedFileName",
  "filePath",
  "replacementXml",
] as const;
const schemaAwareFlowNodeTypes = new Set([
  "columnselectiondropdown",
  "tableselectiondropdown",
  "groupbycolumns",
  "filter",
  "referencelookup",
  "reversereferencelookup",
  "indextable",
  "lookup",
  "extracttable",
  "aggregatenested",
  "groupby",
  "generaterows",
  "generaterowsschema",
  "addnewcolumn",
  "deepclone",
  "onnx",
]);
/** Exported for tests: the same hop as serializeNodeConfigForExecution, for the game-start run. */
export const prepareNodeConfig = (node: SerializedNodeGraph["nodes"][number]): unknown => {
  switch (node.type) {
    case "packfilesdropdown":
      return {
        selectedPack: node.data.selectedPack || "",
        includeBaseGame: node.data.includeBaseGame ?? false,
      };
    case "removepacksource":
      return { selectedPack: node.data.selectedPack || "" };
    case "tableselectiondropdown":
      return { selectedTable: node.data.selectedTable || "" };
    case "columnselectiondropdown":
      return {
        selectedColumn: node.data.selectedColumn || "",
        DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
      };
    case "groupbycolumns":
      return {
        column1: node.data.selectedColumn1 || "",
        column2: node.data.selectedColumn2 || "",
        onlyForMultiple: node.data.onlyForMultiple || false,
      };
    case "filter":
      return { filters: (node.data as any).filters || [] };
    case "multifilter":
      return {
        selectedColumn: (node.data as any).selectedColumn || "",
        splitValues: (node.data as any).splitValues || [],
      };
    case "referencelookup":
      return {
        selectedReferenceTable: (node.data as any).selectedReferenceTable || "",
        includeBaseGame: (node.data as any).includeBaseGame !== false,
      };
    case "reversereferencelookup":
      return {
        selectedReverseTable: (node.data as any).selectedReverseTable || "",
        includeBaseGame: (node.data as any).includeBaseGame !== false,
        connectedTableName: (node.data as any).connectedTableName || "",
      };
    case "groupedcolumnstotext":
      return {
        pattern: (node.data as any).pattern || "{0}: {1}",
        joinSeparator: (node.data as any).joinSeparator || "\\n",
      };
    case "savechanges":
      return {
        packName: (node.data as any).packName || "",
        packedFileName: (node.data as any).packedFileName || "",
        additionalConfig: node.data.textValue || "",
        flowExecutionId: (node.data as any).flowExecutionId || "",
        openInWindows: (node.data as any).openInWindows ?? false,
        openInViewer: (node.data as any).openInViewer ?? false,
        saveAsMoviePack: (node.data as any).saveAsMoviePack ?? false,
      };
    case "textsurround":
      return {
        surroundText: node.data.textValue || "",
        groupedTextSelection: (node.data as any).groupedTextSelection || "Text",
      };
    case "appendtext":
      return {
        beforeText: (node.data as any).beforeText || "",
        afterText: (node.data as any).afterText || "",
        groupedTextSelection: (node.data as any).groupedTextSelection || "Text",
      };
    case "allenabledmods":
      return { includeBaseGame: (node.data as any).includeBaseGame !== false };
    case "indextable":
      return { indexColumns: (node.data as any).indexColumns || [] };
    case "lookup":
      return {
        lookupColumn: (node.data as any).lookupColumn || "",
        joinType: (node.data as any).joinType || "inner",
        indexColumns: (node.data as any).indexColumns || [],
        indexJoinColumn: (node.data as any).indexJoinColumn || "",
      };
    case "extracttable":
      return { tablePrefix: (node.data as any).tablePrefix || "" };
    case "aggregatenested":
      return {
        aggregateColumn: (node.data as any).aggregateColumn || "",
        aggregateType: (node.data as any).aggregateType || "min",
        filterColumn: (node.data as any).filterColumn || "",
        filterOperator: (node.data as any).filterOperator || "equals",
        filterValue: (node.data as any).filterValue || "",
      };
    case "generaterows":
    case "generaterowsschema":
      return {
        transformations: (node.data as any).transformations || [],
        outputTables: (node.data as any).outputTables || [],
        DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
        customSchemaData: (node.data as any).customSchemaData || null,
      };
    case "addnewcolumn":
      return {
        transformations: (node.data as any).transformations || [],
        DBNameToDBVersions: (node.data as any).DBNameToDBVersions || {},
      };
    case "groupby":
      return {
        groupByColumns: (node.data as any).groupByColumns || [],
        aggregations: (node.data as any).aggregations || [],
      };
    case "deduplicate":
      return {
        dedupeByColumns: (node.data as any).dedupeByColumns || [],
        dedupeAgainstVanilla: (node.data as any).dedupeAgainstVanilla || false,
      };
    case "dumptotsv":
      return {
        filename: (node.data as any).filename || "",
        openInWindows: (node.data as any).openInWindows ?? false,
        openInViewer: (node.data as any).openInViewer ?? false,
      };
    case "getcountercolumn":
      return {
        selectedTable: (node.data as any).selectedTable || "",
        selectedColumn: (node.data as any).selectedColumn || "",
        newColumnName: (node.data as any).newColumnName || "",
      };
    case "customschema":
      return { schemaColumns: (node.data as any).schemaColumns || [] };
    case "readtsvfrompack":
      return { tsvFileName: (node.data as any).tsvFileName || "" };
    case "nativepatch":
      return {
        selectedPackName: (node.data as any).selectedPackName || "",
        templatePath: (node.data as any).templatePath || "",
        scalarValues: (node.data as any).scalarValues || {},
        scalarOptionBindings: (node.data as any).scalarOptionBindings || {},
        tableBindings: (node.data as any).tableBindings || [],
      };
    case "customrowsinput":
      return {
        customRows: (node.data as any).customRows || [],
        tableName: (node.data as any).tableName || "",
      };
    case "packfileoperations":
      return { fileOperations: (node.data as any).fileOperations || [] };
    case "edittextfile":
      return {
        textFileRules: (node.data as any).textFileRules || [],
        textFileFormatter: (node.data as any).textFileFormatter || "none",
        ignoreFlowSourcePack: (node.data as any).ignoreFlowSourcePack === true,
        flowSourcePack: (node.data as any).flowSourcePack || "",
      };
    case "editxmlfile":
      return {
        targetMode: (node.data as any).targetMode || "path",
        filePath: (node.data as any).filePath || "",
        ignoreHierarchy: (node.data as any).ignoreHierarchy !== false,
        locatorSteps: (node.data as any).locatorSteps || [],
        action: (node.data as any).action || "setAttributes",
        attributeEdits: (node.data as any).attributeEdits || [],
        replacementXml: (node.data as any).replacementXml || "",
      };
    case "editloctext":
      return { locRules: (node.data as any).locRules || [] };
    case "removetables":
      return { tablesToRemove: (node.data as any).tablesToRemove || [] };
    case "conditionalbranch":
      return {
        selectedFlowOptionId: (node.data as any).selectedFlowOptionId || "",
        flowOptionChecked: (node.data as any).flowOptionChecked === true,
        flowOptionKind: (node.data as any).flowOptionKind || "checkbox",
        flowOptionChoiceId: (node.data as any).flowOptionChoiceId || "",
      };
    case "deepclone":
      return {
        cloneTree: (node.data as any).cloneTree,
        nameTemplate: (node.data as any).nameTemplate || "{original}{variant}",
        useModdersPrefix: (node.data as any).useModdersPrefix !== false,
        moddersPrefix: (node.data as any).moddersPrefix || "",
        variantAxes: (node.data as any).variantAxes || [],
        columnOverrides: (node.data as any).columnOverrides || [],
        generateLoc: (node.data as any).generateLoc !== false,
        autoFollowReferences: (node.data as any).autoFollowReferences !== false,
      };
    case "onnx":
      return {
        mode: node.data.mode === "standalone" ? "standalone" : "bundle",
        selectedPackName: node.data.selectedPackName || "",
        rootTableName: node.data.rootTableName || "main_units_tables",
        reuseExistingKeys: node.data.reuseExistingKeys !== false,
        modelsDirectory: node.data.modelsDirectory || "onnx_models",
        modelsManifestPath: node.data.modelsManifestPath || "onnx_models/models.json",
        preprocessorManifestPath: node.data.preprocessorManifestPath || "onnx_models/preprocessor.json",
        preprocessorModelPath: node.data.preprocessorModelPath || "onnx_models/preprocessor.onnx",
        standaloneModelPath: node.data.standaloneModelPath || "",
        standaloneInputBindings: node.data.standaloneInputBindings || {},
        standaloneOutputName: node.data.standaloneOutputName || "",
        inputBindings: node.data.inputBindings || {},
        outputBindings: node.data.outputBindings || {},
        strength: node.data.strength ?? 1,
        strengthOptionId: node.data.strengthOptionId || "",
      };
    default:
      return node.data.textValue;
  }
};
/** Exported for regression tests around packaged-flow-only runtime substitutions. */
export const prepareFlow = (
  flowFileName: string,
  flowData: SerializedNodeGraph,
  packName: string,
  flowOptions: UserFlowOptionValues | undefined,
  isDebug: boolean,
): PreparedFlow => {
  const preparedNodes = deepClone(flowData.nodes);
  const preparedConnections = deepClone(flowData.connections);
  const flowExecutionId = buildAutomaticFlowExecutionId(packName, flowFileName);
  const currentGameSchema = DBNameToDBVersions[appData.currentGame];
  const nodeConfigs: Record<string, unknown> = {};
  const optionReplacements =
    flowData.options?.map((option) => {
      const userValue = flowOptions?.optionValues?.[option.id];
      const valueToUse = userValue !== undefined ? userValue : option.value;
      const placeholder = `{{${option.id}}}`;
      return {
        placeholder,
        matcher: new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        replacement: String(valueToUse),
      };
    }) ?? [];
  for (const node of preparedNodes) {
    if (optionReplacements.length > 0) {
      for (const fieldName of flowOptionTextFields) {
        const fieldValue = (node.data as any)[fieldName];
        if (typeof fieldValue !== "string" || fieldValue.length === 0) {
          continue;
        }
        let modifiedValue = fieldValue;
        for (const optionReplacement of optionReplacements) {
          if (!modifiedValue.includes(optionReplacement.placeholder)) {
            continue;
          }
          modifiedValue = modifiedValue.replace(optionReplacement.matcher, optionReplacement.replacement);
        }
        if (modifiedValue !== fieldValue) {
          (node.data as any)[fieldName] = modifiedValue;
        }
      }
    }
    if (
      optionReplacements.length > 0 &&
      (node.type === "deepclone" ||
        node.type === "filter" ||
        node.type === "editloctext" ||
        node.type === "edittextfile" ||
        node.type === "editxmlfile")
    ) {
      const replace = (value: string) => {
        let modifiedValue = value;
        for (const optionReplacement of optionReplacements) {
          if (!modifiedValue.includes(optionReplacement.placeholder)) continue;
          modifiedValue = modifiedValue.replace(optionReplacement.matcher, optionReplacement.replacement);
        }
        return modifiedValue;
      };
      const nestedData = node.data as unknown as Record<string, unknown>;
      if (node.type === "filter") substituteFilterOptionValues(nestedData, replace);
      else if (node.type === "editloctext") substituteLocRuleValues(nestedData, replace);
      else if (node.type === "edittextfile") substituteTextFileRuleValues(nestedData, replace);
      else if (node.type === "editxmlfile") substituteEditXmlOptionValues(nestedData, replace);
      else substituteDeepCloneOptionValues(nestedData, replace);
    }
    // The manual run substitutes into transformation fields too; without this the same flow behaves
    // differently at game start.
    if (optionReplacements.length > 0 && Array.isArray((node.data as any).transformations)) {
      (node.data as any).transformations = (node.data as any).transformations.map(
        (transformation: Record<string, unknown>) => {
          if (!transformation || typeof transformation !== "object") return transformation;
          const nextTransformation = { ...transformation };
          for (const fieldName of transformationOptionFields) {
            const fieldValue = nextTransformation[fieldName];
            if (typeof fieldValue !== "string" || fieldValue.length === 0) continue;
            let modifiedValue = fieldValue;
            for (const optionReplacement of optionReplacements) {
              if (!modifiedValue.includes(optionReplacement.placeholder)) continue;
              modifiedValue = modifiedValue.replace(optionReplacement.matcher, optionReplacement.replacement);
            }
            nextTransformation[fieldName] = modifiedValue;
          }
          return nextTransformation;
        },
      );
    }

    // Same resolution as the manual run, but against the values the end user actually set.
    if (node.type === "conditionalbranch") {
      const selectedOption = flowData.options?.find((option) => option.id === (node.data as any).selectedFlowOptionId);
      const userValue = selectedOption ? flowOptions?.optionValues?.[selectedOption.id] : undefined;
      const effectiveValue = userValue !== undefined ? userValue : selectedOption?.value;
      const isRadio = selectedOption?.type === "radio";

      (node.data as any).flowOptionChecked = selectedOption?.type === "checkbox" ? effectiveValue === true : false;
      (node.data as any).flowOptionKind = isRadio ? "radio" : "checkbox";
      (node.data as any).flowOptionChoices = isRadio ? selectedOption.choices : [];
      (node.data as any).flowOptionChoiceId = isRadio ? resolveRadioChoiceId(selectedOption, userValue) : "";
    }
    if (node.data.useCurrentPack === true) {
      if (node.type === "packfilesdropdown") {
        node.data.selectedPack = packName;
      } else if (node.type === "removepacksource") {
        node.data.selectedPack = packName;
      } else if (node.type === "packedfiles") {
        node.data.textValue = packName;
      }
    }
    if (node.type === "savechanges") {
      (node.data as any).flowExecutionId = flowExecutionId;
    }
    if (node.type === "nativepatch") {
      const scalarValues = { ...(((node.data as any).scalarValues || {}) as Record<string, unknown>) };
      for (const [inputId, optionId] of Object.entries((node.data as any).scalarOptionBindings || {}) as Array<
        [string, string]
      >) {
        const option = flowData.options?.find((item) => item.id === optionId);
        if (!option) continue;
        const userValue = flowOptions?.optionValues?.[optionId];
        const value = userValue !== undefined ? userValue : option.value;
        scalarValues[inputId] = option.type === "multiline" ? splitMultilineOptionValue(String(value)) : value;
      }
      (node.data as any).scalarValues = scalarValues;
    }
    if (node.type === "onnx") {
      const resolveNumericOption = (optionId: string): number => {
        const option = flowData.options?.find((item) => item.id === optionId);
        if (!option) return Number.NaN;
        const userValue = flowOptions?.optionValues?.[optionId];
        const value = userValue !== undefined ? userValue : option.value;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : Number.NaN;
      };
      const strengthOptionId = String((node.data as any).strengthOptionId || "");
      if (strengthOptionId) (node.data as any).strength = resolveNumericOption(strengthOptionId);
      const outputBindings = {
        ...(((node.data as any).outputBindings || {}) as Record<string, Record<string, unknown>>),
      };
      for (const [modelKey, binding] of Object.entries(outputBindings)) {
        const optionId = typeof binding?.strengthOptionId === "string" ? binding.strengthOptionId : "";
        if (!optionId) continue;
        outputBindings[modelKey] = { ...binding, strength: resolveNumericOption(optionId) };
      }
      (node.data as any).outputBindings = outputBindings;
    }
    if (node.type === "edittextfile") {
      // Runtime-only: lets the node omit the pack which owns this flow from PackFiles resolution.
      (node.data as any).flowSourcePack = packName;
    }
    if (schemaAwareFlowNodeTypes.has(node.type)) {
      const existingSchema = (node.data as any).DBNameToDBVersions;
      if (!existingSchema || Object.keys(existingSchema).length === 0) {
        (node.data as any).DBNameToDBVersions = currentGameSchema;
      }
    }
    nodeConfigs[node.id] = prepareNodeConfig(node);
  }
  flowExecutionDebugLog(isDebug ? { isDebug } : undefined, `Prepared flow ${flowFileName}`);
  return {
    flowFileName,
    nodes: preparedNodes,
    connections: preparedConnections,
    nodeConfigs,
  };
};
export const executeFlowsForPack = async (
  pathSource: string,
  pathTarget: string,
  userFlowOptions: UserFlowOptions,
  packName: string,
  sourcePack?: Pick<Pack, "packedFiles" | "lastChangedLocal" | "size">,
  /** Packs whose data overwrites were written to a copy, so flows read that copy instead. */
  packPathSubstitutes?: Map<string, string>,
  deletedFlowFileNames: Iterable<string> = [],
): Promise<{
  createdPackPaths: string[];
  replacedPackPaths: string[];
  hadErrors: boolean;
  nativePatchFlowError?: string;
  nativePatchContributions: NativePatchFlowRuntimeContribution[];
}> => {
  void pathTarget;
  const createdPackPaths = new Set<string>();
  /** Packs a flow wrote a full replacement for, which must not also be loaded. */
  const replacedPackPaths = new Set<string>();
  let hadErrors = false;
  let nativePatchFlowError: string | undefined;
  const nativePatchContributions: NativePatchFlowRuntimeContribution[] = [];
  const packStartTime = performance.now();
  const isDebug = isFlowExecutionDebugEnabled();
  const executionContext = createFlowExecutionContext(isDebug);
  executionContext.flowSourcePackPath = pathSource;
  executionContext.flowSourcePackName = packName;
  if (packPathSubstitutes) {
    for (const [originalPath, substitutePath] of packPathSubstitutes) {
      executionContext.packPathSubstitutes.set(originalPath, substitutePath);
    }
  }
  try {
    console.log("Executing flows for pack:", packName);
    // Note: Counter tracking is NOT reset here - it's reset once at game launch level
    // This ensures counters are unique across all flows in all packs
    // Read the pack to get flow files
    const sourceStat = await fs.promises.stat(pathSource);
    const sourceMod = canReuseFlowSourcePack(sourcePack, sourceStat)
      ? sourcePack
      : await readPack(pathSource, { readFlows: true, skipParsingTables: true });
    const deletedFlowKeys = new Set(Array.from(deletedFlowFileNames, normalizePackFilePathKey));
    const flowFiles = sourceMod.packedFiles.filter(
      (file) => isPackedFlowName(file.name) && !deletedFlowKeys.has(normalizePackFilePathKey(file.name)),
    );
    if (flowFiles.length === 0) {
      console.log("No flow files found in pack");
      return {
        createdPackPaths: Array.from(createdPackPaths),
        replacedPackPaths: Array.from(replacedPackPaths),
        hadErrors,
        nativePatchContributions,
      };
    }
    console.log(`Found ${flowFiles.length} flow files in pack`);
    // Get user options for this pack
    const packFlowOptions = userFlowOptions[packName] || {};
    const preparedFlows: PreparedFlow[] = [];
    const prepareStartTime = performance.now();
    for (const flowFile of flowFiles) {
      try {
        const flowContent = flowFile.text || (flowFile.buffer ? flowFile.buffer.toString("utf-8") : "");
        if (!flowContent) {
          console.warn(`Flow file ${flowFile.name} has no content`);
          hadErrors = true;
          continue;
        }
        const flowFileName = flowFile.name;
        const flowData: SerializedNodeGraph = JSON.parse(flowContent);
        const flowOptions = packFlowOptions[flowFileName];
        if (flowData.isGraphEnabled && flowOptions?.graphEnabled === false) {
          console.log(`Flow ${flowFileName} is disabled by user, skipping`);
          continue;
        }
        preparedFlows.push(prepareFlow(flowFileName, flowData, packName, flowOptions, isDebug));
      } catch (error) {
        console.error(`Error preparing flow ${flowFile.name}:`, error);
        hadErrors = true;
      }
    }
    console.log(
      `Prepared ${preparedFlows.length}/${flowFiles.length} flow(s) in ${(performance.now() - prepareStartTime).toFixed(2)}ms`,
    );
    for (const preparedFlow of preparedFlows) {
      executionContext.flowFileName = preparedFlow.flowFileName;
      const flowStartTime = performance.now();
      try {
        const result = await executeNodeGraph({
          nodes: preparedFlow.nodes,
          connections: preparedFlow.connections,
          nodeConfigs: preparedFlow.nodeConfigs,
          executionContext,
          resetCounters: false,
        });
        if (result.success) {
          console.log(
            `Flow ${preparedFlow.flowFileName} executed successfully in ${(performance.now() - flowStartTime).toFixed(
              2,
            )}ms`,
          );
          console.log(`Executed ${result.successCount}/${result.totalExecuted} nodes`);
          for (const node of preparedFlow.nodes) {
            if (
              node.type !== "nativepatch" ||
              preparedFlow.connections.some(
                (edge) => edge.sourceId === node.id && !isNativePatchSchemaConnection(node, edge.sourceHandle),
              )
            )
              continue;
            const output = result.executionResults.get(node.id);
            if (!output?.success) continue;
            for (const file of output.data?.tables ?? []) {
              nativePatchContributions.push({
                sourcePackPath: pathSource,
                sourceModName: packName,
                fileName: file.outputFileName,
                bytes: file.table.buffer,
              });
            }
          }
          for (const [, nodeResult] of result.executionResults.entries()) {
            if (nodeResult.success && nodeResult.data?.type === "SaveResult") {
              const savedPath = nodeResult.data.savedTo;
              if (savedPath) {
                createdPackPaths.add(savedPath);
              }
              for (const replacedPath of nodeResult.data.replacedPackPaths ?? []) {
                replacedPackPaths.add(replacedPath);
              }
            }
          }
        } else {
          console.error(`Flow ${preparedFlow.flowFileName} execution failed:`, result.error);
          hadErrors = true;
          const activeNativePatchNode = preparedFlow.nodes.find(
            (node) =>
              node.type === "nativepatch" && node.data.isDisabled !== true && !result.skippedNodeIds?.includes(node.id),
          );
          if (activeNativePatchNode) {
            const failedNode = [...result.executionResults.entries()].find(([, nodeResult]) => !nodeResult.success);
            const reason =
              result.executionResults.get(activeNativePatchNode.id)?.error ||
              failedNode?.[1].error ||
              result.error ||
              "flow graph execution failed";
            nativePatchFlowError = `${packName} :: ${preparedFlow.flowFileName} :: node ${activeNativePatchNode.id}: ${reason}`;
            break;
          }
        }
      } catch (error) {
        console.error(`Error executing flow ${preparedFlow.flowFileName}:`, error);
        hadErrors = true;
        const activeNativePatchNode = preparedFlow.nodes.find(
          (node) => node.type === "nativepatch" && node.data.isDisabled !== true,
        );
        if (activeNativePatchNode) {
          nativePatchFlowError = `${packName} :: ${preparedFlow.flowFileName} :: node ${activeNativePatchNode.id}: ${error instanceof Error ? error.message : String(error)}`;
          break;
        }
      }
    }
    console.log(
      `Flow execution completed for pack: ${packName} in ${(performance.now() - packStartTime).toFixed(2)}ms`,
    );
    console.log(`Created ${createdPackPaths.size} pack file(s):`, Array.from(createdPackPaths));
  } catch (error) {
    console.error("Error in executeFlowsForPack:", error);
    hadErrors = true;
  }
  return {
    createdPackPaths: Array.from(createdPackPaths),
    replacedPackPaths: Array.from(replacedPackPaths),
    hadErrors,
    nativePatchFlowError,
    nativePatchContributions,
  };
};
