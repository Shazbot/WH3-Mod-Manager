import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "@/src/hooks";
import { FaSquare, FaCheckSquare, FaMinusSquare, FaArrowRight } from "react-icons/fa";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "./DBDuplicationStyles.css";
import { IconBaseProps } from "react-icons";
import { chunkTableIntoRows } from "./viewerHelpers";
import { packDataStore } from "./packDataStore";
import { getDBPackedFilePath } from "@/src/utility/packFileHelpers";
import { Spinner } from "flowbite-react";
import { FloatingOverlay } from "@floating-ui/react";
import { useLocalizations } from "@/src/localizationContext";
import { Modal } from "../../flowbite";
import DBCloneRenameInput from "./DBCloneRenameInput";
import {
  BUILDINGS_CULTURE_VARIANT_PRESELECT_ALL_TABLES,
  BUILDINGS_CULTURE_VARIANT_PRESELECT_TABLES,
  filterDBCloneRedundantIndirectReferences,
  getDBCloneAutoSelectedParentNames,
  getDBCloneExpandedNodeNamesForSelection,
  getDBCloneInitialSelectedNodeNames,
} from "./dbCloneSelection";
import type { PackedFile } from "../../packFileTypes";
import { applyDBCloneGlobalKey, getDBCloneGlobalKey, normalizeDBCloneModdersPrefix } from "./dbCloneGlobalKey";

const getAllNodesInTree = (tree: IViewerTreeNodeWithData | IViewerTreeNode) => {
  const getAllNodesInTreeIter = (
    tree: IViewerTreeNodeWithData | IViewerTreeNode,
    acc: (IViewerTreeNodeWithData | IViewerTreeNode)[],
  ) => {
    acc.push(tree);
    if (tree.children) {
      for (const child of tree.children) {
        getAllNodesInTreeIter(child, acc);
      }
    }
    return acc;
  };
  return getAllNodesInTreeIter(tree, []);
};

const MemoizedFloatingOverlay = memo(FloatingOverlay);

const DBCloneOperationOverlay = ({ statusText, onCancel }: { statusText: string; onCancel?: () => void }) => (
  <MemoizedFloatingOverlay
    className="absolute h-full w-full z-50 dark flex justify-center bg-black opacity-25"
    id="DBDuplicationOverlay"
  >
    <div className="self-center text-center flex flex-col items-center gap-4 bg-gray-900/80 px-6 py-5 rounded-xl">
      <div className="scale-[2] self-center">
        <Spinner color="purple" size="xl" />
      </div>
      <div className="text-white text-sm max-w-[520px]">{statusText}</div>
      {onCancel && (
        <button
          className="bg-red-700 border-red-500 border-2 hover:bg-red-800 text-white font-medium text-sm px-4 rounded h-8"
          onClick={onCancel}
        >
          Cancel
        </button>
      )}
    </div>
  </MemoizedFloatingOverlay>
);

export type DBDuplicationLaunchSource = "modsViewer" | "buildings" | "ancillaries";

/**
 * Launch sources that keep a pending-row store of their own, so the generated rows can be added to
 * that panel. The Mods Viewer has none and only offers "Save to pack".
 */
const SOURCES_WITH_PENDING_ROWS: DBDuplicationLaunchSource[] = ["buildings", "ancillaries"];

export type DBDuplicationProps = {
  launchSource: DBDuplicationLaunchSource;
  /** Receives the generated rows when the user adds them to the target panel. */
  onSaveToBuildings?: (packedFiles: PackedFile[]) => void;
};

const DBDuplication = memo(({ launchSource, onSaveToBuildings }: DBDuplicationProps) => {
  const canSaveToMemory = SOURCES_WITH_PENDING_ROWS.includes(launchSource);
  const memoryTargetName = launchSource === "ancillaries" ? "Ancillaries" : "Buildings";
  const memoryActionLabel = canSaveToMemory ? `Add to ${memoryTargetName} panel` : "Save to memory";
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);
  // important to reload the component
  useAppSelector((state) => state.app.referencesHash);
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);
  const moddersPrefix = useAppSelector((state) => state.app.moddersPrefix);
  const packPath = currentDBTableSelection?.packPath ?? "db.pack";

  const [selectedNodesByName, setSelectedNodesByName] = useState<string[]>([]);
  const [expandedNodesByName, setExpandedNodesByName] = useState<string[]>([]);
  const [nodeNameToRenameValue, setNodeNameToRenameValue] = useState<Record<string, string>>({});
  const [globalRenameValue, setGlobalRenameValue] = useState("");
  const [appendModdersPrefix, setAppendModdersPrefix] = useState(true);
  const [hideRepeatedIndirectTables, setHideRepeatedIndirectTables] = useState(true);
  const [treeData, setTreeData] = useState<IViewerTreeNodeWithData | null>(null);
  const [pendingOperations, setPendingOperations] = useState(0);
  const [isAppendSave, setIsAppendSave] = useState<boolean>(false);
  const [openInWindows, setOpenInWindows] = useState<boolean>(false);
  const [savePackedFileName, setSavePackedFileName] = useState<string>("");
  const [savePackFileName, setSavePackFileName] = useState<string>("");
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [isErrorOpen, setIsErrorOpen] = useState<boolean>(false);
  const [duplicationError, setDuplicationError] = useState<string>("");
  const [isSuccessOpen, setIsSuccessOpen] = useState<boolean>(false);
  const [duplicationSuccessMessage, setDuplicationSuccessMessage] = useState<string>("");
  const [duplicationProgress, setDuplicationProgress] = useState<DBDuplicationProgress | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const isProgressSubscribed = useRef(false);
  const treeBuildRequestId = useRef(0);

  const localized = useLocalizations();
  const displayedTreeData = useMemo(
    () => (treeData && hideRepeatedIndirectTables ? filterDBCloneRedundantIndirectReferences(treeData) : treeData),
    [hideRepeatedIndirectTables, treeData],
  );

  useEffect(() => {
    if (!hideRepeatedIndirectTables || !displayedTreeData) return;
    const visibleNodeNames = new Set(getAllNodesInTree(displayedTreeData).map((node) => node.name));
    setSelectedNodesByName((selectedNames) => selectedNames.filter((nodeName) => visibleNodeNames.has(nodeName)));
    setExpandedNodesByName((expandedNames) => expandedNames.filter((nodeName) => visibleNodeNames.has(nodeName)));
  }, [displayedTreeData, hideRepeatedIndirectTables]);

  const beginOverlayOperation = () => {
    setPendingOperations((current) => current + 1);
  };

  const endOverlayOperation = () => {
    setPendingOperations((current) => Math.max(0, current - 1));
  };

  useEffect(() => {
    if (!window.api || isProgressSubscribed.current) return;
    isProgressSubscribed.current = true;

    window.api.setDBDuplicationProgress((event, progress) => {
      setDuplicationProgress(progress);
      if (progress.stage == "done" || progress.stage == "error" || progress.stage == "canceled") {
        setIsSaving(false);
      }
    });
  }, []);

  // Fetch tree data from backend
  useEffect(() => {
    if (!currentDBTableSelection || !deepCloneTarget) return;

    const requestId = ++treeBuildRequestId.current;
    let isCurrentRequest = true;
    setTreeData(null);
    setSelectedNodesByName([]);
    setExpandedNodesByName([]);

    const buildTree = async () => {
      try {
        beginOverlayOperation();
        setDuplicationError("");
        const treeNodeResult = await window.api?.buildDBReferenceTree(
          packPath,
          {
            dbName: currentDBTableSelection.dbName,
            dbSubname: currentDBTableSelection.dbSubname,
            packPath: currentDBTableSelection.packPath,
          } as DBTableSelection,
          deepCloneTarget,
          [],
          [],
          undefined,
        );

        if (!isCurrentRequest || requestId !== treeBuildRequestId.current) return;

        if (treeNodeResult) {
          console.log("buildDBReferenceTree RECIEVED", treeNodeResult);
          console.log(
            "currentDBTableSelection:",
            currentDBTableSelection,
            "deepCloneTarget:",
            deepCloneTarget,
            "packPath:",
            packPath,
          );
          setTreeData(treeNodeResult);
          setNodeNameToRenameValue({});
          const preselectedTables =
            launchSource == "buildings" && currentDBTableSelection.dbName == "building_culture_variants_tables"
              ? BUILDINGS_CULTURE_VARIANT_PRESELECT_TABLES
              : [];
          const preselectedNodeNames = getDBCloneInitialSelectedNodeNames(
            treeNodeResult,
            preselectedTables,
            BUILDINGS_CULTURE_VARIANT_PRESELECT_ALL_TABLES,
          );
          setSelectedNodesByName(preselectedNodeNames);
          setExpandedNodesByName(getDBCloneExpandedNodeNamesForSelection(treeNodeResult, preselectedNodeNames));
        } else {
          setDuplicationError("DB Clone could not build the reference tree.");
        }
      } catch (error) {
        if (!isCurrentRequest || requestId !== treeBuildRequestId.current) return;
        console.error("Failed to build reference tree:", error);
        setDuplicationError(error instanceof Error ? error.message : String(error));
      } finally {
        endOverlayOperation();
      }
    };

    buildTree();
    return () => {
      isCurrentRequest = false;
    };
  }, [currentDBTableSelection, deepCloneTarget, launchSource, packPath]);
  // }, [currentDBTableSelection, deepCloneTarget, selectedNodesByName, packPath]);

  if (!currentDBTableSelection) {
    console.log("NO currentDBTableSelection");
    return <></>;
  }

  console.log("currentDBTableSelection", currentDBTableSelection);

  if (!packsData[packPath]) {
    console.log("NO packsData for,", packPath, " NOT RENDERING");
    return <></>;
  }

  if (!deepCloneTarget) {
    console.log("NO DEEP CLONE TARGET, NOT RENDERING");
    return <></>;
  }

  const packData = packsData[packPath];
  if (!packData) {
    console.log("no packData");
    return <></>;
  }

  const packedFilePath = getDBPackedFilePath(currentDBTableSelection);

  if (!packData.packedFiles) {
    console.log("No packed files!");
    return <></>;
  }
  let packFile = packData.packedFiles[packedFilePath];
  if (!packFile) {
    // check case where we have just the pack file name as instead of full path (e.g. 'data.pack')
    for (const [iterPackedFilePath, iterPackedFile] of Object.entries(packData.packedFiles)) {
      if (iterPackedFilePath.startsWith(`${packedFilePath}`)) {
        packFile = iterPackedFile;
      }
    }

    if (!packFile) {
      console.log("no packFile found:", packedFilePath);
      return <></>;
    }
  }
  const currentSchema = packFile.tableSchema;
  if (!currentSchema) {
    console.log("NO current schema");
    return <></>;
  }
  if (!packFile.schemaFields) {
    console.log("NO packFile schemaFields");
    return <></>;
  }

  const rows = chunkTableIntoRows(packFile.schemaFields, currentSchema);
  const toClone = rows[deepCloneTarget.row][deepCloneTarget.col];
  const schema = currentSchema;

  const field = schema.fields[deepCloneTarget.col];

  console.log(
    "packDataStore:",
    packDataStore[packData.packPath]?.packedFiles
      ?.filter((pf) => pf.name.startsWith("db\\") && pf.schemaFields)
      .map((pf) => pf.name),
  );

  const rootNode = {
    name: `${currentDBTableSelection.dbName} ${field.name} : ${toClone.resolvedKeyValue}`,
    children: [],
  } as ITreeNode;

  if (!treeData || !displayedTreeData) {
    if (duplicationError) {
      return (
        <div className="m-8 rounded border border-red-600 bg-red-950/50 p-4 text-red-100" role="alert">
          Failed to load DB Clone references: {duplicationError}
        </div>
      );
    }
    return <DBCloneOperationOverlay statusText="Loading references..." />;
  }

  const data = flattenTree(displayedTreeData);
  const nodeById = new Map<INode["id"], INode>();
  const nodeIdsByName = new Map<string, INode["id"][]>();
  for (const node of data) {
    nodeById.set(node.id, node);
    const existingIds = nodeIdsByName.get(node.name) ?? [];
    existingIds.push(node.id);
    nodeIdsByName.set(node.name, existingIds);
  }
  const getFirstNodeByName = (nodeName: string) => {
    const ids = nodeIdsByName.get(nodeName);
    if (!ids || ids.length == 0) return undefined;
    return nodeById.get(ids[0]);
  };
  const nodeNameToData = {} as Record<string, IViewerTreeNodeWithData>;
  for (const node of getAllNodesInTree(displayedTreeData)) {
    const currentNode = node as IViewerTreeNodeWithData;
    nodeNameToData[currentNode.name] = currentNode;
  }
  const nodeNameToDataLookup = {
    ...nodeNameToData,
    [rootNode.name]: {
      name: rootNode.name,
      children: [],
      tableName: currentDBTableSelection.dbName,
      columnName: field.name,
      value: toClone.resolvedKeyValue,
    } as IViewerTreeNodeWithData,
  };

  // console.log("data is", data);
  console.log("SELECTED NODES ARE", selectedNodesByName);
  console.log("EXPANDED NODES ARE", expandedNodesByName);

  const rootNodeName = (displayedTreeData.children[0] as IViewerTreeNodeWithData | undefined)?.name ?? rootNode.name;

  const defaultNodeNameToRenameValue = data.reduce(
    (acc, current) => {
      acc[current.name] = (nodeNameToDataLookup[current.name] && nodeNameToDataLookup[current.name].value) || "";
      return acc;
    },
    {} as Record<string, string>,
  );

  console.log("tryign to amend", rows[deepCloneTarget.row][deepCloneTarget.col]);

  // console.log(`currentPackData.data is ${currentPackData.data}`);
  console.log("packDataStore", packDataStore);
  if (packDataStore[packPath]) console.log(packDataStore[packPath].packedFiles.map((pf) => pf.name));

  const getParentNodeNames = (acc: string[], node: INode) => {
    const nodeName = nodeById.get(node.id)?.name;
    if (nodeName && !acc.some((iterNodeName) => iterNodeName == nodeName)) acc.push(nodeName);
    if (node.parent) {
      const parentNode = nodeById.get(node.parent);
      if (parentNode) getParentNodeNames(acc, parentNode);
    }
    return acc;
  };

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    console.log("selected tree node", props.element.name);
    console.log("selectedNodesByName:", selectedNodesByName);
    const currentName = props.element.name;
    // const expandedByName = Array.from(props.treeState.selectedIds.values())
    //   .map((id) => data.find((node) => node.id == id)?.name)
    //   .filter((name): name is string => !!name);

    let newselectedNodesByName = [...selectedNodesByName];
    if (selectedNodesByName.includes(currentName))
      newselectedNodesByName = newselectedNodesByName.filter((name) => name != currentName);
    else newselectedNodesByName.push(currentName);

    for (const nodeName of [...newselectedNodesByName]) {
      const node = getFirstNodeByName(nodeName);
      if (node) {
        const parentNodesNames = getDBCloneAutoSelectedParentNames(getParentNodeNames([], node), nodeNameToDataLookup);
        for (const parentNodeName of parentNodesNames) {
          if (!newselectedNodesByName.includes(parentNodeName)) newselectedNodesByName.push(parentNodeName);
        }
      }
    }

    // setSelectedNodesByName(newselectedNodesByName);
  };

  const onNodeExpanded = (nodeName: string) => {
    if (isSaving) return;
    console.log("expanded tree node", nodeName);
    const currentName = nodeName;

    // const expandedByName = Array.from(props.treeState.selectedIds.values())
    //   .map((id) => data.find((node) => node.id == id)?.name)
    //   .filter((name): name is string => !!name);

    let newExpandedNodesByName = [...expandedNodesByName];
    if (expandedNodesByName.includes(currentName))
      newExpandedNodesByName = newExpandedNodesByName.filter((name) => name != currentName);
    else newExpandedNodesByName.push(currentName);

    for (const nodeName of [...newExpandedNodesByName]) {
      const node = getFirstNodeByName(nodeName);
      if (node) {
        const parentNodesNames = getParentNodeNames([], node);
        for (const parentNodeName of parentNodesNames) {
          if (!newExpandedNodesByName.includes(parentNodeName)) newExpandedNodesByName.push(parentNodeName);
        }
      }
    }

    setExpandedNodesByName(newExpandedNodesByName);
  };

  const ensureNodesExpanded = (nodeNames: string[]) => {
    if (isSaving || !displayedTreeData) return;
    const requiredExpandedNames = getDBCloneExpandedNodeNamesForSelection(displayedTreeData, nodeNames);
    setExpandedNodesByName((currentNames) => [...new Set([...currentNames, ...requiredExpandedNames])]);
  };

  const onNodeToggled = (nodeName: string) => {
    if (isSaving) return;
    console.log("toggled node", nodeName);
    const currentName = nodeName;
    if (currentName == rootNodeName) return;

    const isSelecting = !selectedNodesByName.includes(currentName);
    let newselectedNodesByName = [...selectedNodesByName];
    if (!isSelecting) newselectedNodesByName = newselectedNodesByName.filter((name) => name != currentName);
    else newselectedNodesByName.push(currentName);

    for (const nodeName of [...newselectedNodesByName]) {
      const node = getFirstNodeByName(nodeName);
      if (node) {
        const parentNodesNames = getDBCloneAutoSelectedParentNames(getParentNodeNames([], node), nodeNameToDataLookup);
        for (const parentNodeName of parentNodesNames) {
          if (!newselectedNodesByName.includes(parentNodeName)) newselectedNodesByName.push(parentNodeName);
        }
      }
    }
    if (!newselectedNodesByName.includes(rootNodeName)) {
      newselectedNodesByName.push(rootNodeName);
    }

    console.log("SELECTED NODES ARE NOW:", newselectedNodesByName);
    setSelectedNodesByName(newselectedNodesByName);
    if (isSelecting) {
      ensureNodesExpanded([currentName]);
    }
  };

  const selectedIds = selectedNodesByName
    .flatMap((name) => nodeIdsByName.get(name) ?? [])
    .filter((id): id is INode["id"] => id != null);

  const expandedIds = expandedNodesByName
    .flatMap((name) => nodeIdsByName.get(name) ?? [])
    .filter((id): id is INode["id"] => id != null);

  console.log("expandedIds:", expandedIds);

  const onFilterChange = (value: string, nodeName: string) => {
    if (isSaving) return;
    console.log("textbox change:", value, nodeName);
    setNodeNameToRenameValue((prev) => ({ ...prev, [nodeName]: value }));
  };

  const needsWarningBorder = (nodeName: string) => {
    if (!selectedNodesByName.includes(nodeName)) return false;
    if (nodeNameToDataLookup[nodeName]?.isIndirectRef) return false;

    return (
      !nodeNameToRenameValue[nodeName] || nodeNameToRenameValue[nodeName] == defaultNodeNameToRenameValue[nodeName]
    );
  };

  const hasGlobalRenameValue = globalRenameValue.trim() !== "";
  const normalizedModdersPrefix = normalizeDBCloneModdersPrefix(moddersPrefix);
  const effectiveGlobalRenameValue = getDBCloneGlobalKey(
    globalRenameValue,
    normalizedModdersPrefix,
    appendModdersPrefix,
  );

  const isSavingPossible = () => {
    const selectedDirectNodes = selectedNodesByName.filter(
      (nodeName) => nodeNameToDataLookup[nodeName] && !nodeNameToDataLookup[nodeName].isIndirectRef,
    );

    if (selectedDirectNodes.length < 1) return false;

    if (hasGlobalRenameValue) {
      if (!effectiveGlobalRenameValue) return false;
      return selectedDirectNodes.every(
        (nodeName) => effectiveGlobalRenameValue !== nodeNameToDataLookup[nodeName]?.value,
      );
    }

    for (const nodeName of selectedDirectNodes) {
      const newValue =
        nodeNameToRenameValue[nodeName] != null
          ? nodeNameToRenameValue[nodeName]
          : defaultNodeNameToRenameValue[nodeName];

      if (!newValue || newValue.trim() == "") return false;
      if (newValue == defaultNodeNameToRenameValue[nodeName]) return false;
    }

    return true;
  };

  const getProgressLabel = (progress: DBDuplicationProgress | null) => {
    if (!progress) return "Working...";
    const stageToLabel = {
      validating: "Validating",
      discovering_indirect: "Discovering indirect refs",
      cloning: "Cloning rows",
      localizing: "Generating localization",
      writing: "Writing pack",
      done: "Done",
      error: "Error",
      canceled: "Canceled",
    } as Record<DBDuplicationStage, string>;

    const stageLabel = stageToLabel[progress.stage] ?? progress.stage;
    const progressRatio =
      progress.current != null && progress.total != null && progress.total > 0
        ? ` (${progress.current}/${progress.total})`
        : "";
    const message = progress.message ? ` - ${progress.message}` : "";
    return `${stageLabel}${progressRatio}${message}`;
  };

  const onCancelDuplication = () => {
    if (!isSaving) return;
    window.api?.cancelDBDuplication();
    setDuplicationProgress({
      stage: "canceled",
      message: "Cancel requested",
    });
  };

  const overlayStatusText = isSaving ? getProgressLabel(duplicationProgress) : "Loading references...";

  const onSave = async (destination: DBCloneSaveOptions["destination"]) => {
    console.log("SAVING");

    // const selecedNodesWithRootNode = [...selectedNodesByName, rootNode.name];

    if (!isSavingPossible()) {
      console.log("Cannot save with default value");
      return;
    }

    const selectedNodeNames = selectedNodesByName.includes(rootNodeName)
      ? selectedNodesByName
      : [rootNodeName, ...selectedNodesByName];
    const renameValuesForSave = hasGlobalRenameValue
      ? applyDBCloneGlobalKey(
          nodeNameToRenameValue,
          selectedNodeNames,
          nodeNameToDataLookup,
          effectiveGlobalRenameValue,
        )
      : nodeNameToRenameValue;

    try {
      beginOverlayOperation();
      setIsSaving(true);
      setDuplicationError("");
      setIsErrorOpen(false);
      setDuplicationSuccessMessage("");
      setIsSuccessOpen(false);
      setDuplicationProgress({
        stage: "validating",
        message: "Starting clone",
      });
      const result = await window.api?.executeDBDuplication(
        packData.packPath,
        selectedNodeNames,
        nodeNameToDataLookup,
        renameValuesForSave,
        defaultNodeNameToRenameValue,
        treeData,
        { isAppendSave, savePackedFileName, savePackFileName, destination },
      );

      if (!result?.ok) {
        console.error("executeDBDuplication failed:", result?.error ?? "Unknown error");
        setDuplicationError(result?.error ?? "Unknown duplication error");
        setIsErrorOpen(true);
      } else if (destination == "memory") {
        if (!result.generatedPackedFiles) {
          setDuplicationError("DB Clone completed without returning any generated rows.");
          setIsErrorOpen(true);
          return;
        }
        if (!onSaveToBuildings) {
          setDuplicationError(`The ${memoryTargetName} tab is not available to receive the generated rows.`);
          setIsErrorOpen(true);
          return;
        }
        onSaveToBuildings(result.generatedPackedFiles);
      } else {
        console.log("executeDBDuplication success, output:", result.outputPackPath);
        if (openInWindows && result.outputPackPath) {
          window.api?.openPack(result.outputPackPath);
        }
        setDuplicationSuccessMessage(
          result.outputPackPath ? `Created pack:\n${result.outputPackPath}` : "Clone completed successfully.",
        );
        setIsSuccessOpen(true);
      }
    } catch (error) {
      console.error("executeDBDuplication IPC failed:", error);
      setDuplicationError(error instanceof Error ? error.message : String(error));
      setIsErrorOpen(true);
    } finally {
      setIsSaving(false);
      endOverlayOperation();
    }

    // dispatch(setDeepCloneTarget(undefined));

    // for (const node of selectedNodesByName) {
    //   console.log("node is", node, nodeNameToData[node]);
    // }
  };

  const memoryActionButton = canSaveToMemory ? (
    <button
      className={`bg-cyan-700 border-cyan-600 border-2 hover:bg-cyan-800 text-white font-medium text-sm px-4 rounded h-8 min-w-44 m-auto ${
        ((!isSavingPossible() || isSaving) &&
          "bg-opacity-50 hover:bg-opacity-50 text-opacity-50 hover:text-opacity-50 cursor-not-allowed") ||
        ""
      }`}
      onClick={async () => await onSave("memory")}
      disabled={!isSavingPossible() || isSaving}
    >
      {memoryActionLabel}
    </button>
  ) : null;

  return (
    <>
      {isHelpOpen && (
        <Modal
          show={isHelpOpen}
          // show={true}
          onClose={() => setIsHelpOpen(false)}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "mt-8",
            "!max-w-5xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>
            <span className="max-w-5xl">{localized.help}</span>
          </Modal.Header>

          <Modal.Body>
            <div className="flex flex-col gap-8">
              <p>
                Deep DB Cloning allows you to clone a row in a table. We can only clone tables that have a key column
                that uniquely identifies that row, for example for the main_units_table that would be the "unit" column.
              </p>
              <p>
                We look at the row we're cloning and look at all the tables that are referenced from that row, for
                main_units those would be: unit_castes_tables, land_units_tables, naval_units_tables,
                unit_weights_tables, ui_unit_groupings_tables, unit_porthole_camera_settings_tables,
                audio_vo_actor_groups_tables.
              </p>
              <p>
                So we look inside each of those tables and find the rows that references the main_unit we're aiming to
                clone. We then in turn find all the refences to other tables in those rows, and so on.
              </p>
              <p>
                We end up with a tree of refences and we select what refences we want to clone and which ones should be
                left the same. So for example we could also clone the land_unit of our main_unit but leave the
                unit_castes_tables the same.
              </p>
              <p>
                References in <span className="text-amber-500">yellow</span> are non-direct references. These are from
                tables that reference the key we're duplicating but they're not directly referenced from the table we're
                cloning. For example units_to_groupings_military_permissions_tables refences the main_units table but
                the main_units table doesn't reference it.
              </p>
              <p>
                Non-direct references are selectable and are resolved with the rest of the dependency tree when the
                clone window opens.
              </p>
              <p>
                With "Append Existing Pack" enabled we will append an existing pack file instead of creating a new one,
                using the pack name from "(Optional) Name for new pack".
              </p>
              <p>"Open in Windows" opens the newly created pack with the operating system after the clone is saved.</p>
              {canSaveToMemory && (
                <p>
                  "{memoryActionLabel}" adds every generated DB and localization row to the {memoryTargetName} tab. The
                  generated tables can be inspected and edited under New rows before you save them to a pack.
                </p>
              )}
              <p>
                "New key for all cloned keys" assigns one replacement key to every selected direct key and hides the
                individual key inputs. Leave it empty to rename each selected key separately.
              </p>
              <p>
                "(Optional) Name for new tables" specifices what name the new DB tables will have. Leave it blank for an
                automaitc name with a timestamp (e.g. dbclone_140925_152525_).
              </p>
              <p>
                "(Optional) Name for new pack" specifices what name the new pack will have. Leave it blank for an
                automaitc name with a timestamp (e.g. dbclone_140925_152525.pack). WARNING: Using an existing pack name
                WITHOUT "Append Existing Pack" enabled will OVERWRITE the existing pack.
              </p>
            </div>
          </Modal.Body>
        </Modal>
      )}
      {isErrorOpen && (
        <Modal
          show={isErrorOpen}
          onClose={() => setIsErrorOpen(false)}
          size="lg"
          position="top-center"
          explicitClasses={["mt-8", "modalDontOverflowWindowHeight"]}
        >
          <Modal.Header>
            <span>DB Clone Error</span>
          </Modal.Header>
          <Modal.Body>
            <p>{duplicationError || "Unknown duplication error"}</p>
          </Modal.Body>
        </Modal>
      )}
      {isSuccessOpen && (
        <Modal
          show={isSuccessOpen}
          onClose={() => setIsSuccessOpen(false)}
          size="lg"
          position="top-center"
          explicitClasses={["mt-8", "modalDontOverflowWindowHeight"]}
        >
          <Modal.Header>
            <span>DB Clone Complete</span>
          </Modal.Header>
          <Modal.Body>
            <p className="whitespace-pre-wrap">{duplicationSuccessMessage || "Clone completed successfully."}</p>
          </Modal.Body>
        </Modal>
      )}
      {pendingOperations > 0 && (
        <DBCloneOperationOverlay
          statusText={overlayStatusText}
          onCancel={isSaving && duplicationProgress?.stage != "writing" ? onCancelDuplication : undefined}
        />
      )}

      <div className="absolute right-8 top-24 flex flex-col items-center gap-6">
        {launchSource === "buildings" && memoryActionButton}
        <div className="flex w-60 flex-col items-center gap-3 rounded-lg border border-gray-600 bg-gray-800/60 p-3">
          <button
            className={`bg-green-600 border-green-500 border-2 hover:bg-green-700 text-white font-medium text-sm px-4 rounded h-8 min-w-32 m-auto ${
              ((!isSavingPossible() || isSaving) &&
                "bg-opacity-50 hover:bg-opacity-50 text-opacity-50 hover:text-opacity-50 cursor-not-allowed") ||
              ""
            }`}
            onClick={async () => await onSave("pack")}
            disabled={!isSavingPossible() || isSaving}
          >
            <div>
              <span>{"Save to pack"}</span>
            </div>
          </button>
          <input
            defaultValue={savePackFileName}
            placeholder={"(Optional) Name for new pack"}
            disabled={isSaving}
            onChange={(e) => setSavePackFileName(e.target.value)}
            className={`bg-gray-50 w-52 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 focus:outline-none ${
              isSaving ? "opacity-60 cursor-not-allowed" : ""
            }`}
          />
          <label className="flex w-52 items-center gap-2 text-sm text-gray-300" htmlFor="dbclone-append-existing-pack">
            <input
              type="checkbox"
              id="dbclone-append-existing-pack"
              checked={isAppendSave}
              disabled={isSaving}
              onChange={(event) => setIsAppendSave(event.target.checked)}
            />
            <span>Append Existing Pack</span>
          </label>
          <label className="flex w-52 items-center gap-2 text-sm text-gray-300" htmlFor="dbclone-open-in-windows">
            <input
              type="checkbox"
              id="dbclone-open-in-windows"
              checked={openInWindows}
              disabled={isSaving}
              onChange={(event) => setOpenInWindows(event.target.checked)}
            />
            <span>Open in Windows</span>
          </label>
        </div>
        {launchSource !== "buildings" && memoryActionButton}
        <div>
          <input
            defaultValue={savePackedFileName}
            placeholder={"(Optional) Name for new tables"}
            disabled={isSaving}
            onChange={(e) => setSavePackedFileName(e.target.value)}
            className={`bg-gray-50 w-52 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 focus:outline-none ${
              isSaving ? "opacity-60 cursor-not-allowed" : ""
            }`}
          />
        </div>
        <div className="text-center">
          <button
            onClick={() => setIsHelpOpen(true)}
            className="w-28 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:border-blue-500 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
            type="button"
          >
            {localized.help}
          </button>
        </div>
        <label className="mx-auto flex w-52 items-start gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={hideRepeatedIndirectTables}
            disabled={isSaving}
            onChange={(event) => setHideRepeatedIndirectTables(event.target.checked)}
            className="mt-1"
          />
          <span>Hide indirect references when their table already appears above</span>
        </label>
      </div>
      <div className="mx-auto mb-4 flex w-full max-w-xl flex-col gap-2 px-4 text-left">
        <label htmlFor="dbclone-global-rename" className="text-sm font-medium text-gray-200">
          New key for all cloned keys
        </label>
        <input
          id="dbclone-global-rename"
          type="text"
          value={globalRenameValue}
          disabled={isSaving}
          onChange={(event) => setGlobalRenameValue(event.target.value)}
          placeholder="Leave empty to rename keys individually"
          className="block w-full rounded-lg border border-gray-600 bg-gray-700 p-2.5 text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {normalizedModdersPrefix && (
          <label className="flex items-center gap-2 text-sm text-gray-300" htmlFor="dbclone-append-modders-prefix">
            <input
              id="dbclone-append-modders-prefix"
              type="checkbox"
              checked={appendModdersPrefix}
              disabled={isSaving}
              onChange={(event) => setAppendModdersPrefix(event.target.checked)}
            />
            Append modder prefix
          </label>
        )}
        {hasGlobalRenameValue && effectiveGlobalRenameValue !== globalRenameValue.trim() && (
          <div className="text-xs text-gray-400">New key: {effectiveGlobalRenameValue}</div>
        )}
      </div>
      <div>Cloning {toClone.resolvedKeyValue}</div>
      <div className="checkbox dark:text-gray-300">
        <TreeView
          key={hideRepeatedIndirectTables ? "hide-repeated-indirect-tables" : "show-all-indirect-tables"}
          data={data}
          aria-label="Checkbox tree"
          multiSelect
          onSelect={(props) => onTreeSelect(props)}
          selectedIds={selectedIds}
          expandedIds={expandedIds}
          nodeRenderer={({
            element,
            isBranch,
            isExpanded,
            isSelected,
            isHalfSelected,
            getNodeProps,
            level,
            handleSelect,
            handleExpand,
          }) => {
            return (
              <div
                onClick={(e) => {
                  // handleSelect(e);
                  onNodeExpanded(element.name);
                  e.stopPropagation();
                }}
                // {...getNodeProps({ onClick: handleExpand })}
                style={{ marginLeft: 40 * (level - 1) }}
                className="flex items-center min-h-[42px]"
              >
                {isBranch && <ArrowIcon isOpen={isExpanded} />}
                <CheckBoxIcon
                  className={`checkbox-icon scale-125 ${!isBranch && "!ml-[26px]"}`}
                  onClick={(e) => {
                    // handleSelect(e);
                    onNodeToggled(element.name);
                    e.stopPropagation();
                  }}
                  variant={isHalfSelected ? "some" : isSelected ? "all" : "none"}
                />
                <span className={`name ${nodeNameToDataLookup[element.name].isIndirectRef ? "text-amber-500" : ""}`}>
                  {element.name}
                </span>
                {!hasGlobalRenameValue && !nodeNameToDataLookup[element.name].isIndirectRef && (
                  <span className="flex items-center">
                    <span className="text-slate-100 ml-4">
                      <FaArrowRight></FaArrowRight>
                    </span>
                    <span className="relative">
                      <DBCloneRenameInput
                        id={`dbclone-rename-${element.id}`}
                        disabled={isSaving}
                        value={nodeNameToRenameValue[element.name] ?? defaultNodeNameToRenameValue[element.name]}
                        hasWarning={needsWarningBorder(element.name)}
                        onChange={(value) => onFilterChange(value, element.name)}
                      />
                    </span>
                  </span>
                )}
              </div>
            );
          }}
        />
      </div>
    </>
  );
});

const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className?: string }) => {
  const baseClass = "arrow";
  const classes = cx(baseClass, { [`${baseClass}--closed`]: !isOpen }, { [`${baseClass}--open`]: isOpen }, className);
  return <IoMdArrowDropright className={classes} />;
};

type CheckBoxItemProps = { variant: string } & IconBaseProps;
const CheckBoxIcon = ({ variant, ...rest }: CheckBoxItemProps) => {
  switch (variant) {
    case "all":
      return <FaCheckSquare {...rest} />;
    case "none":
      return <FaSquare {...rest} />;
    case "some":
      return <FaMinusSquare {...rest} />;
    default:
      return null;
  }
};

export default DBDuplication;
