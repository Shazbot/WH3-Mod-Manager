import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Connection,
  Edge,
  EdgeTypes,
  MarkerType,
  Node,
  NodeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { Dropdown } from "flowbite-react";
import "@xyflow/react/dist/style.css";
import { Modal } from "../../flowbite/components/Modal/index";
import TechNode from "./TechNode";
import TechGroupNode from "./TechGroupNode";
import AddTechNodeModal, { TechNodeFormData } from "./AddTechNodeModal";
import TechTreeLinkEdge from "./TechTreeLinkEdge";
import { buildTechTreeLinkGeometry } from "./techTreeLinkGeometry";
import {
  getTechnologyNodeScopeValues,
  hasBaseNodesOnlyNodes,
  resolveTechTreeScopeSelection,
} from "./techTreeScope";

const NODE_WIDTH = 325;
const NODE_HEIGHT = 140;
const MIN_TECH_ROW = -2;
const TECH_NODE_RENDER_WIDTH = 240;
const TECH_NODE_RENDER_HEIGHT = 80;
const PIXEL_OFFSET_X_PER_NODE = 70 / 0.3;
const PIXEL_OFFSET_Y_PER_NODE = 40 / 0.6;

const toNodeUnitsFromPixelOffsetX = (pixelOffsetX: number) => pixelOffsetX / PIXEL_OFFSET_X_PER_NODE;
const toNodeUnitsFromPixelOffsetY = (pixelOffsetY: number) => pixelOffsetY / PIXEL_OFFSET_Y_PER_NODE;
const collator = new Intl.Collator("en");

const TechPlaceholderNode = memo(({ data }: { data: { tier: number; indent: number } }) => (
  <div className="flex items-center justify-center w-[240px] h-20 border-2 border-dashed border-transparent rounded-lg cursor-pointer hover:border-gray-500 hover:bg-gray-800/30 transition-colors group">
    <span className="text-3xl text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">+</span>
  </div>
));

const TechLabelNode = memo(({ data }: { data: { label: string } }) => (
  <div className="text-gray-500 text-xs font-mono select-none">{data.label}</div>
));

const compassToHandleId = (compass: number | undefined, type: "source" | "target") => {
  const normalized =
    compass === 1 || compass === 2 || compass === 3 || compass === 4 ? compass : type === "source" ? 2 : 4;
  if (normalized === 1) return `${type}-north`;
  if (normalized === 2) return `${type}-east`;
  if (normalized === 3) return `${type}-south`;
  return `${type}-west`;
};

const handleIdToCompass = (handleId: string | null | undefined, fallback: number) => {
  if (!handleId) return fallback;
  if (handleId.endsWith("north")) return 1;
  if (handleId.endsWith("east")) return 2;
  if (handleId.endsWith("south")) return 3;
  if (handleId.endsWith("west")) return 4;
  return fallback;
};

const areStringArraysEqual = (first: string[], second: string[]) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const formatLinkOffsetLabel = (offset: number) => {
  if (!Number.isFinite(offset) || offset === 0) return "0";
  return `${offset > 0 ? "+" : ""}${offset}`;
};

type TechClipboardEntry = {
  technologyKey: string;
  localizedName: string;
  requiredParents: number;
  researchPointsRequired: number;
  isHidden: boolean;
  pixelOffsetX: number;
  pixelOffsetY: number;
  buildingLevel?: string;
  shortDescription?: string;
  longDescription?: string;
  iconData?: string;
  effects?: TechEffect[];
  relTier: number;
  relIndent: number;
};
let techClipboard: TechClipboardEntry[] = [];

type TechEditSnapshot = {
  changedNodePositions: Record<string, { tier: number; indent: number }>;
  changedLinks: Record<string, TechnologyLinkData>;
  hiddenOverrides: Record<string, boolean>;
  addedNodes: TechnologyNodeData[];
  deletedLinks: string[];
  deletedNodeKeys: string[];
  editedNodes: Record<string, Partial<TechnologyNodeData>>;
};

type TechContextMenu =
  | {
      x: number;
      y: number;
      targetType: "techNode" | "techPlaceholder";
      nodeId: string;
    }
  | {
      x: number;
      y: number;
      targetType: "techEdge";
      edgeId: string;
    };

const menuItemClass = "w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 cursor-pointer";
type TechSaveMode = "whole" | "changes";

type TechTreeCanvasProps = {
  setKey: string;
};

const TechTreeCanvas = memo(({ setKey }: TechTreeCanvasProps) => {
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [technologyTree, setTechnologyTree] = useState<TechnologyTreePayload | undefined>(undefined);
  const [selectedUiTab, setSelectedUiTab] = useState("all");
  const [selectedScopeKey, setSelectedScopeKey] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [showHiddenTechnologies, setShowHiddenTechnologies] = useState(false);
  const [showTechKeys, setShowTechKeys] = useState(false);
  const [isCheckingRequirements, setIsCheckingRequirements] = useState(false);
  const [savePackName, setSavePackName] = useState(`technology_changes_${Date.now().toString()}`);
  const [savePackDirectory, setSavePackDirectory] = useState<string | undefined>(undefined);
  const [tableNameOverride, setTableNameOverride] = useState("");
  const [saveMode, setSaveMode] = useState<TechSaveMode>("changes");
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [changedNodePositions, setChangedNodePositions] = useState<
    Record<string, { tier: number; indent: number }>
  >({});
  const [changedLinks, setChangedLinks] = useState<Record<string, TechnologyLinkData>>({});
  const [hiddenOverrides, setHiddenOverrides] = useState<Record<string, boolean>>({});
  const [addedNodes, setAddedNodes] = useState<TechnologyNodeData[]>([]);
  const [addNodeTarget, setAddNodeTarget] = useState<{ tier: number; indent: number } | null>(null);

  // New state for deletion, editing, context menu, requirements mode
  const [deletedNodeKeys, setDeletedNodeKeys] = useState<Set<string>>(new Set());
  const [deletedLinks, setDeletedLinks] = useState<Set<string>>(new Set());
  const [editedNodes, setEditedNodes] = useState<Record<string, Partial<TechnologyNodeData>>>({});
  const [contextMenu, setContextMenu] = useState<TechContextMenu | null>(null);
  const [isRequirementsMode, setIsRequirementsMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [unlockedNodeKeys, setUnlockedNodeKeys] = useState<Set<string>>(new Set());
  const [editLinkTarget, setEditLinkTarget] = useState<{
    linkKey: string;
    parentOffset: string;
    childOffset: string;
  } | null>(null);
  const [editNodeTarget, setEditNodeTarget] = useState<{
    nodeKey: string;
    tier: number;
    indent: number;
    technologyKey: string;
    displayName: string;
    requiredParents: number;
    researchPointsRequired: number;
    campaignKey?: string;
    factionKey?: string;
    isHidden: boolean;
    pixelOffsetX: number;
    pixelOffsetY: number;
    buildingLevel?: string;
    shortDescription?: string;
    longDescription?: string;
    iconPath?: string;
    iconData?: string;
    effects: TechEffect[];
  } | null>(null);

  // Undo/redo
  const historyPast = useRef<TechEditSnapshot[]>([]);
  const historyFuture = useRef<TechEditSnapshot[]>([]);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });

  const nodeTypes = useMemo(
    () =>
      ({
        techNode: TechNode,
        techGroup: TechGroupNode,
        techPlaceholder: TechPlaceholderNode,
        techLabel: TechLabelNode,
      }) as NodeTypes,
    [],
  );

  const edgeTypes = useMemo(
    () =>
      ({
        techTreeLink: TechTreeLinkEdge,
      }) as EdgeTypes,
    [],
  );

  useEffect(() => {
    const loadTree = async () => {
      if (!setKey) return;
      setIsLoadingTree(true);
      try {
        const fetchedTree = await window.api?.getTechnologyTree(setKey);
        setTechnologyTree(fetchedTree);
        setSelectedUiTab("all");
        setSelectedScopeKey("");
        setChangedNodePositions({});
        setChangedLinks({});
        setHiddenOverrides({});
        setAddedNodes([]);
        setSavePackDirectory(undefined);
        setDeletedNodeKeys(new Set());
        setDeletedLinks(new Set());
        setEditedNodes({});
        setContextMenu(null);
        setEditLinkTarget(null);
        setIsRequirementsMode(false);
        setUnlockedNodeKeys(new Set());
        setIsCheckingRequirements(false);
        setIsSaveModalOpen(false);
        setStatusMessage(undefined);
        historyPast.current = [];
        historyFuture.current = [];
        setHistorySize({ past: 0, future: 0 });
      } finally {
        setIsLoadingTree(false);
      }
    };
    loadTree();
  }, [setKey]);

  const originalHiddenByTechnologyKey = useMemo(() => {
    const output: Record<string, boolean> = {};
    for (const node of technologyTree?.nodes || []) {
      if (output[node.technologyKey] === undefined) {
        output[node.technologyKey] = !!node.isHidden;
      }
    }
    return output;
  }, [technologyTree]);

  const currentTierOffset = useMemo(() => {
    if (selectedUiTab === "all") return 0;
    return technologyTree?.uiTabs.find((uiTab) => uiTab.key === selectedUiTab)?.tierOffset || 0;
  }, [selectedUiTab, technologyTree]);

  const allTechnologiesByKey = useMemo(() => {
    const byKey: Record<string, TechnologyCatalogEntry> = {};
    for (const technology of technologyTree?.allTechnologies || []) {
      byKey[technology.key] = technology;
    }
    return byKey;
  }, [technologyTree?.allTechnologies]);

  const effectiveTechnologyNodes = useMemo(() => {
    if (!technologyTree) return [] as TechnologyNodeData[];

    const nodes = technologyTree.nodes
      .filter((node) => !deletedNodeKeys.has(node.nodeKey))
      .map((node) => (editedNodes[node.nodeKey] ? { ...node, ...editedNodes[node.nodeKey] } : node));

    for (const addedNode of addedNodes) {
      if (deletedNodeKeys.has(addedNode.nodeKey)) continue;
      nodes.push(addedNode);
    }

    return nodes;
  }, [technologyTree, deletedNodeKeys, editedNodes, addedNodes]);

  const baseVisibleNodeSet = useMemo(() => {
    if (!technologyTree) return new Set<string>();
    const visibleNodeKeys =
      selectedUiTab === "all"
        ? technologyTree.nodes.map((node) => node.nodeKey)
        : technologyTree.uiTabToNodes[selectedUiTab] || [];

    const visibleNodeKeySet = new Set(visibleNodeKeys.filter((nodeKey) => !deletedNodeKeys.has(nodeKey)));
    for (const addedNode of addedNodes) {
      if (!deletedNodeKeys.has(addedNode.nodeKey)) {
        visibleNodeKeySet.add(addedNode.nodeKey);
      }
    }
    return visibleNodeKeySet;
  }, [technologyTree, selectedUiTab, deletedNodeKeys, addedNodes]);

  const availableScopeOptions = useMemo(
    () =>
      Array.from(
        new Map(
          effectiveTechnologyNodes
            .filter((node) => baseVisibleNodeSet.has(node.nodeKey))
            .flatMap((node) => [
              node.factionKey ? [`faction:${node.factionKey}`, `Faction: ${node.factionKey}`] : null,
              node.campaignKey ? [`campaign:${node.campaignKey}`, `Campaign: ${node.campaignKey}`] : null,
            ])
            .filter((entry): entry is [string, string] => !!entry),
        ).entries(),
      )
        .map(([value, label]) => ({ value, label }))
        .sort((first, second) => collator.compare(first.label, second.label)),
    [effectiveTechnologyNodes, baseVisibleNodeSet],
  );

  const hasBaseNodesOnly = useMemo(
    () => hasBaseNodesOnlyNodes(effectiveTechnologyNodes, baseVisibleNodeSet),
    [baseVisibleNodeSet, effectiveTechnologyNodes],
  );

  useEffect(() => {
    const nextSelectedScopeKey = resolveTechTreeScopeSelection({
      selectedScopeKey,
      availableScopeKeys: availableScopeOptions.map((option) => option.value),
      hasBaseNodesOnly,
    });
    if (nextSelectedScopeKey !== selectedScopeKey) {
      setSelectedScopeKey(nextSelectedScopeKey);
    }
  }, [availableScopeOptions, hasBaseNodesOnly, selectedScopeKey]);

  const scopedVisibleNodeSet = useMemo(() => {
    if (!technologyTree) return new Set<string>();
    const selectedNodeKeys = new Set<string>();
    for (const node of effectiveTechnologyNodes) {
      if (!baseVisibleNodeSet.has(node.nodeKey)) continue;
      const nodeScopeValues = getTechnologyNodeScopeValues(node);
      if (nodeScopeValues.length < 1 || (selectedScopeKey && nodeScopeValues.includes(selectedScopeKey))) {
        selectedNodeKeys.add(node.nodeKey);
      }
    }
    return selectedNodeKeys;
  }, [baseVisibleNodeSet, selectedScopeKey, technologyTree, effectiveTechnologyNodes]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const unlockedNodeKeySet = useMemo(() => new Set(unlockedNodeKeys), [unlockedNodeKeys]);
  const isRequirementCheckActive = isCheckingRequirements && !isEditMode && !isRequirementsMode;

  const handleUnlockNode = useCallback(
    (nodeKey: string) => {
      if (!isRequirementCheckActive) return;
      setUnlockedNodeKeys((prev) => new Set(prev).add(nodeKey));
    },
    [isRequirementCheckActive],
  );

  const handleLockNode = useCallback((nodeKey: string) => {
    setUnlockedNodeKeys((prev) => {
      if (!prev.has(nodeKey)) return prev;
      const next = new Set(prev);
      next.delete(nodeKey);
      return next;
    });
  }, []);

  // Undo/redo helpers
  const buildCurrentSnapshot = useCallback(
    (): TechEditSnapshot => ({
      changedNodePositions: { ...changedNodePositions },
      changedLinks: { ...changedLinks },
      hiddenOverrides: { ...hiddenOverrides },
      addedNodes: [...addedNodes],
      deletedLinks: [...deletedLinks],
      deletedNodeKeys: [...deletedNodeKeys],
      editedNodes: { ...editedNodes },
    }),
    [
      changedNodePositions,
      changedLinks,
      hiddenOverrides,
      addedNodes,
      deletedLinks,
      deletedNodeKeys,
      editedNodes,
    ],
  );

  const applySnapshot = useCallback((snap: TechEditSnapshot) => {
    setChangedNodePositions({ ...snap.changedNodePositions });
    setChangedLinks({ ...snap.changedLinks });
    setHiddenOverrides({ ...snap.hiddenOverrides });
    setAddedNodes([...snap.addedNodes]);
    setDeletedLinks(new Set(snap.deletedLinks));
    setDeletedNodeKeys(new Set(snap.deletedNodeKeys));
    setEditedNodes({ ...snap.editedNodes });
  }, []);

  const captureHistory = useCallback(() => {
    if (!isEditMode) return;
    historyPast.current.push(buildCurrentSnapshot());
    if (historyPast.current.length > 50) historyPast.current.shift();
    historyFuture.current = [];
    setHistorySize({ past: historyPast.current.length, future: 0 });
  }, [isEditMode, buildCurrentSnapshot]);

  const handleUndo = useCallback(() => {
    if (!isEditMode || historyPast.current.length === 0) return;
    const current = buildCurrentSnapshot();
    historyFuture.current.push(current);
    const prev = historyPast.current.pop()!;
    applySnapshot(prev);
    setHistorySize({ past: historyPast.current.length, future: historyFuture.current.length });
  }, [isEditMode, buildCurrentSnapshot, applySnapshot]);

  const handleRedo = useCallback(() => {
    if (!isEditMode || historyFuture.current.length === 0) return;
    const current = buildCurrentSnapshot();
    historyPast.current.push(current);
    const next = historyFuture.current.pop()!;
    applySnapshot(next);
    setHistorySize({ past: historyPast.current.length, future: historyFuture.current.length });
  }, [isEditMode, buildCurrentSnapshot, applySnapshot]);

  // Clear history on edit mode exit
  useEffect(() => {
    if (!isEditMode) {
      historyPast.current = [];
      historyFuture.current = [];
      setHistorySize({ past: 0, future: 0 });
    }
  }, [isEditMode]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    if (!isEditMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditMode, handleUndo, handleRedo]);

  // Merged edges map (used by graphModel and context menu)
  const allEdgesMap = useMemo(() => {
    if (!technologyTree) return new Map<string, TechnologyLinkData>();
    const map = new Map<string, TechnologyLinkData>();
    for (const baseLink of technologyTree.links) {
      const key = `${baseLink.parentKey}|${baseLink.childKey}`;
      map.set(key, baseLink);
    }
    for (const [linkKey, changedLink] of Object.entries(changedLinks)) {
      map.set(linkKey, changedLink);
    }
    return map;
  }, [technologyTree, changedLinks]);

  const graphModel = useMemo(() => {
    if (!technologyTree) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const nodesByKey = Object.fromEntries(technologyTree.nodes.map((node) => [node.nodeKey, node]));
    const effectiveNodesByKey: Record<string, TechnologyNodeData> = Object.fromEntries(
      technologyTree.nodes.map((node) => [
        node.nodeKey,
        editedNodes[node.nodeKey] ? { ...node, ...editedNodes[node.nodeKey] } : node,
      ]),
    );
    for (const addedNode of addedNodes) {
      effectiveNodesByKey[addedNode.nodeKey] = addedNode;
    }
    const activeNodeKeySet = new Set(
      [...technologyTree.nodes.map((node) => node.nodeKey), ...addedNodes.map((node) => node.nodeKey)].filter(
        (nodeKey) => !deletedNodeKeys.has(nodeKey),
      ),
    );
    const incomingLinksByChildKey = new Map<string, TechnologyLinkData[]>();
    for (const [linkKey, link] of allEdgesMap.entries()) {
      if (deletedLinks.has(linkKey)) continue;
      if (!activeNodeKeySet.has(link.parentKey) || !activeNodeKeySet.has(link.childKey)) continue;
      const existingLinks = incomingLinksByChildKey.get(link.childKey) || [];
      existingLinks.push(link);
      incomingLinksByChildKey.set(link.childKey, existingLinks);
    }
    const requirementNodeKeySet = isRequirementCheckActive ? scopedVisibleNodeSet : activeNodeKeySet;
    const requirementIncomingLinksByChildKey = new Map<string, TechnologyLinkData[]>();
    for (const [childKey, links] of incomingLinksByChildKey.entries()) {
      if (!requirementNodeKeySet.has(childKey)) continue;
      const visibleLinks = links.filter(
        (link) => requirementNodeKeySet.has(link.parentKey) && requirementNodeKeySet.has(link.childKey),
      );
      if (visibleLinks.length > 0) {
        requirementIncomingLinksByChildKey.set(childKey, visibleLinks);
      }
    }
    const visibleNodes: Node[] = [];
    const visibleNodeKeySet = new Set<string>();
    const visibleNodeLayoutByKey = new Map<
      string,
      {
        x: number;
        y: number;
        width: number;
        height: number;
        requiredParents: number;
      }
    >();

    for (const technologyNode of technologyTree.nodes) {
      if (!scopedVisibleNodeSet.has(technologyNode.nodeKey)) continue;
      if (deletedNodeKeys.has(technologyNode.nodeKey)) continue;

      const positionOverride = changedNodePositions[technologyNode.nodeKey];
      const actualTier = positionOverride?.tier ?? technologyNode.tier;
      const actualIndent = positionOverride?.indent ?? technologyNode.indent;
      const displayTier = actualTier - currentTierOffset;

      // Apply edits
      const edits = editedNodes[technologyNode.nodeKey];
      const effectiveNode = edits ? { ...technologyNode, ...edits } : technologyNode;
      const effectiveTechnologyKey = effectiveNode.technologyKey;
      const hiddenOverride = hiddenOverrides[effectiveTechnologyKey];
      const isHiddenNow = hiddenOverride === undefined ? !!effectiveNode.isHidden : hiddenOverride;
      if (!showHiddenTechnologies && isHiddenNow) continue;
      const xOffsetInNodeUnits = toNodeUnitsFromPixelOffsetX(effectiveNode.pixelOffsetX || 0);
      const yOffsetInNodeUnits = toNodeUnitsFromPixelOffsetY(effectiveNode.pixelOffsetY || 0);

      const parentLinks = [...allEdgesMap.values()].filter(
        (link) =>
          link.childKey === technologyNode.nodeKey && !deletedLinks.has(`${link.parentKey}|${link.childKey}`),
      );
      const prerequisiteTechNames = parentLinks
        .map((link) => effectiveNodesByKey[link.parentKey]?.localizedName || link.parentKey)
        .filter(Boolean);
      const requirementParentLinks = requirementIncomingLinksByChildKey.get(technologyNode.nodeKey) || [];
      const unlockedParentCount = requirementParentLinks.filter((link) =>
        unlockedNodeKeySet.has(link.parentKey),
      ).length;
      const requiredParents = effectiveNode.requiredParents || 0;
      const areRequirementsValid =
        requiredParents > 0
          ? unlockedParentCount >= requiredParents
          : requirementParentLinks.every((link) => unlockedNodeKeySet.has(link.parentKey));
      const nodeX = (displayTier + xOffsetInNodeUnits) * NODE_WIDTH;
      const nodeY = (actualIndent + yOffsetInNodeUnits) * NODE_HEIGHT;

      visibleNodeKeySet.add(technologyNode.nodeKey);
      visibleNodeLayoutByKey.set(technologyNode.nodeKey, {
        x: nodeX,
        y: nodeY,
        width: TECH_NODE_RENDER_WIDTH,
        height: TECH_NODE_RENDER_HEIGHT,
        requiredParents: effectiveNode.requiredParents || 0,
      });
      visibleNodes.push({
        id: technologyNode.nodeKey,
        type: "techNode",
        position: {
          x: nodeX,
          y: nodeY,
        },
        data: {
          nodeKey: technologyNode.nodeKey,
          title: effectiveNode.localizedName || effectiveNode.technologyKey,
          iconData: effectiveNode.iconData,
          technologyKey: effectiveTechnologyKey,
          researchPointsRequired: effectiveNode.researchPointsRequired,
          isHidden: isHiddenNow,
          showHandles: isRequirementsMode,
          showKeys: showTechKeys,
          isCheckingRequirements: isRequirementCheckActive,
          areRequirementsValid,
          isUnlocked: unlockedNodeKeySet.has(technologyNode.nodeKey),
          onUnlock: handleUnlockNode,
          onLock: handleLockNode,
          shortDescription: effectiveNode.shortDescription,
          longDescription: effectiveNode.longDescription,
          buildingLevel: effectiveNode.buildingLevel,
          prerequisiteTechNames,
          effects: effectiveNode.effects || [],
        },
      });
    }

    // Include manually added nodes
    for (const addedNode of addedNodes) {
      if (!scopedVisibleNodeSet.has(addedNode.nodeKey)) continue;
      if (deletedNodeKeys.has(addedNode.nodeKey)) continue;
      const hiddenOverride = hiddenOverrides[addedNode.technologyKey];
      const isHiddenNow = hiddenOverride === undefined ? !!addedNode.isHidden : hiddenOverride;
      if (!showHiddenTechnologies && isHiddenNow) continue;
      const addedPosOverride = changedNodePositions[addedNode.nodeKey];
      const addedActualTier = addedPosOverride?.tier ?? addedNode.tier;
      const addedActualIndent = addedPosOverride?.indent ?? addedNode.indent;
      const addedDisplayTier = addedActualTier - currentTierOffset;
      const xOffsetInNodeUnits = toNodeUnitsFromPixelOffsetX(addedNode.pixelOffsetX || 0);
      const yOffsetInNodeUnits = toNodeUnitsFromPixelOffsetY(addedNode.pixelOffsetY || 0);
      const parentLinks = incomingLinksByChildKey.get(addedNode.nodeKey) || [];
      const prerequisiteTechNames = parentLinks
        .map((link) => effectiveNodesByKey[link.parentKey]?.localizedName || link.parentKey)
        .filter(Boolean);
      const requirementParentLinks = requirementIncomingLinksByChildKey.get(addedNode.nodeKey) || [];
      const unlockedParentCount = requirementParentLinks.filter((link) =>
        unlockedNodeKeySet.has(link.parentKey),
      ).length;
      const requiredParents = addedNode.requiredParents || 0;
      const areRequirementsValid =
        requiredParents > 0
          ? unlockedParentCount >= requiredParents
          : requirementParentLinks.every((link) => unlockedNodeKeySet.has(link.parentKey));
      const nodeX = (addedDisplayTier + xOffsetInNodeUnits) * NODE_WIDTH;
      const nodeY = (addedActualIndent + yOffsetInNodeUnits) * NODE_HEIGHT;
      visibleNodeKeySet.add(addedNode.nodeKey);
      visibleNodeLayoutByKey.set(addedNode.nodeKey, {
        x: nodeX,
        y: nodeY,
        width: TECH_NODE_RENDER_WIDTH,
        height: TECH_NODE_RENDER_HEIGHT,
        requiredParents: addedNode.requiredParents || 0,
      });
      visibleNodes.push({
        id: addedNode.nodeKey,
        type: "techNode",
        position: {
          x: nodeX,
          y: nodeY,
        },
        data: {
          nodeKey: addedNode.nodeKey,
          title: addedNode.localizedName || addedNode.technologyKey,
          iconData: addedNode.iconData,
          technologyKey: addedNode.technologyKey,
          researchPointsRequired: addedNode.researchPointsRequired,
          isHidden: isHiddenNow,
          showHandles: isRequirementsMode,
          showKeys: showTechKeys,
          isCheckingRequirements: isRequirementCheckActive,
          areRequirementsValid,
          isUnlocked: unlockedNodeKeySet.has(addedNode.nodeKey),
          onUnlock: handleUnlockNode,
          onLock: handleLockNode,
          shortDescription: addedNode.shortDescription,
          longDescription: addedNode.longDescription,
          buildingLevel: addedNode.buildingLevel,
          prerequisiteTechNames,
          effects: addedNode.effects || [],
        },
      });
    }

    const visibleLinks = [...allEdgesMap.entries()].filter(([linkKey, link]) => {
      if (deletedLinks.has(linkKey)) return false;
      if (!isRequirementsMode && !link.visibleInUi) return false;
      return visibleNodeKeySet.has(link.parentKey) && visibleNodeKeySet.has(link.childKey);
    });
    const displayedRequiredParentLinkByChild = new Map<string, string>();
    if (!isRequirementsMode) {
      const visibleParentLinksByChild = new Map<
        string,
        {
          linkKey: string;
          link: TechnologyLinkData;
          categoryRank: number;
          primaryDistance: number;
          secondaryDistance: number;
        }[]
      >();
      for (const [linkKey, link] of visibleLinks) {
        const childLayout = visibleNodeLayoutByKey.get(link.childKey);
        const parentLayout = visibleNodeLayoutByKey.get(link.parentKey);
        if (!childLayout || !parentLayout || childLayout.requiredParents < 1) continue;

        const deltaX = parentLayout.x - childLayout.x;
        const deltaY = parentLayout.y - childLayout.y;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const alignedHorizontally = absDeltaY < NODE_HEIGHT / 2;
        const alignedVertically = absDeltaX < NODE_WIDTH / 2;
        const candidate = {
          linkKey,
          link,
          categoryRank:
            alignedHorizontally && deltaX < 0
              ? 0
              : alignedVertically && deltaY < 0
                ? 1
                : alignedVertically && deltaY > 0
                  ? 2
                  : alignedHorizontally && deltaX > 0
                    ? 3
                    : 4,
          primaryDistance: alignedHorizontally
            ? absDeltaX
            : alignedVertically
              ? absDeltaY
              : Math.hypot(absDeltaX, absDeltaY),
          secondaryDistance: alignedHorizontally ? absDeltaY : alignedVertically ? absDeltaX : 0,
        };
        const childCandidates = visibleParentLinksByChild.get(link.childKey) || [];
        childCandidates.push(candidate);
        visibleParentLinksByChild.set(link.childKey, childCandidates);
      }

      for (const [childKey, candidates] of visibleParentLinksByChild.entries()) {
        candidates.sort(
          (first, second) =>
            first.categoryRank - second.categoryRank ||
            first.primaryDistance - second.primaryDistance ||
            first.secondaryDistance - second.secondaryDistance,
        );
        if (candidates[0]) displayedRequiredParentLinkByChild.set(childKey, candidates[0].linkKey);
      }
    }

    const visibleEdges: Edge[] = [];
    for (const [linkKey, link] of visibleLinks) {
      if (
        isRequirementsMode &&
        selectedNodeIdSet.size > 0 &&
        !selectedNodeIdSet.has(link.parentKey) &&
        !selectedNodeIdSet.has(link.childKey)
      ) {
        continue;
      }
      const edgeColor = (() => {
        if (!isRequirementsMode) return "#d4a373";
        if (selectedNodeIdSet.size < 1) return "#f59e0b";
        const isInput = selectedNodeIdSet.has(link.childKey);
        const isOutput = selectedNodeIdSet.has(link.parentKey);
        if (isInput && isOutput) return "#f59e0b";
        if (isInput) return "#38bdf8";
        if (isOutput) return "#f97316";
        return "#f59e0b";
      })();
      const childLayout = visibleNodeLayoutByKey.get(link.childKey);
      const parentLayout = visibleNodeLayoutByKey.get(link.parentKey);
      if (!childLayout || !parentLayout) continue;
      const requiredParents = childLayout?.requiredParents || 0;
      const unlockedParentCount =
        requiredParents > 0
          ? (requirementIncomingLinksByChildKey.get(link.childKey) || []).filter((parentLink) =>
              unlockedNodeKeySet.has(parentLink.parentKey),
            ).length
          : 0;
      if (
        !isRequirementsMode &&
        requiredParents > 0 &&
        displayedRequiredParentLinkByChild.get(link.childKey) !== linkKey
      ) {
        continue;
      }
      const geometry = buildTechTreeLinkGeometry({
        sourceRect: parentLayout,
        targetRect: childLayout,
        rawSourceCompass: link.parentLinkPosition,
        rawTargetCompass: link.childLinkPosition,
        rawSourceOffset: link.parentLinkPositionOffset,
        rawTargetOffset: link.childLinkPositionOffset,
      });
      const hasOffsetLabel =
        isRequirementsMode &&
        (link.parentLinkPositionOffset !== 0 || link.childLinkPositionOffset !== 0);
      visibleEdges.push({
        id: `tech-link-${linkKey}`,
        source: link.parentKey,
        target: link.childKey,
        sourceHandle: compassToHandleId(geometry.sourceCompass, "source"),
        targetHandle: compassToHandleId(geometry.targetCompass, "target"),
        type: "techTreeLink",
        data: {
          path: geometry.path,
          labelX: geometry.labelX,
          labelY: geometry.labelY,
          labelText: hasOffsetLabel
            ? `P:${formatLinkOffsetLabel(link.parentLinkPositionOffset)} C:${formatLinkOffsetLabel(
                link.childLinkPositionOffset,
              )}`
            : !isRequirementsMode && requiredParents > 0
              ? `(${unlockedParentCount}/${requiredParents})`
              : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
        style: {
          stroke: edgeColor,
          strokeWidth: 3,
          opacity: 0.9,
          strokeDasharray: !link.visibleInUi && isRequirementsMode ? "8 5" : undefined,
        },
      });
    }

    const uiGroupsByKey = Object.fromEntries(
      technologyTree.uiGroups.map((uiGroup) => [uiGroup.key, uiGroup]),
    );
    const groupNodes: Node[] = [];
    for (const bounds of technologyTree.uiGroupBounds) {
      const group = uiGroupsByKey[bounds.groupKey];
      if (!group) continue;
      if (!visibleNodeKeySet.has(bounds.topLeftNode) || !visibleNodeKeySet.has(bounds.bottomRightNode))
        continue;

      const cornerNodeKeys = [
        bounds.topLeftNode,
        bounds.bottomRightNode,
        bounds.optionalTopRightNode,
        bounds.optionalBottomLeftNode,
      ].filter((nodeKey): nodeKey is string => !!nodeKey && visibleNodeKeySet.has(nodeKey));

      if (cornerNodeKeys.length < 2) continue;
      const corners = cornerNodeKeys.map((nodeKey) => {
        const node = nodesByKey[nodeKey];
        const edits = editedNodes[nodeKey];
        const effectiveNode = edits ? { ...node, ...edits } : node;
        const positionOverride = changedNodePositions[nodeKey];
        const actualTier = positionOverride?.tier ?? node.tier;
        const actualIndent = positionOverride?.indent ?? node.indent;
        const xOffsetInNodeUnits = toNodeUnitsFromPixelOffsetX(effectiveNode.pixelOffsetX || 0);
        const yOffsetInNodeUnits = toNodeUnitsFromPixelOffsetY(effectiveNode.pixelOffsetY || 0);
        return {
          x: (actualTier - currentTierOffset + xOffsetInNodeUnits) * NODE_WIDTH,
          y: (actualIndent + yOffsetInNodeUnits) * NODE_HEIGHT,
        };
      });

      const minX = Math.min(...corners.map((c) => c.x));
      const maxX = Math.max(...corners.map((c) => c.x));
      const minY = Math.min(...corners.map((c) => c.y));
      const maxY = Math.max(...corners.map((c) => c.y));

      groupNodes.push({
        id: `tech-group-${bounds.groupKey}`,
        type: "techGroup",
        position: { x: minX - 12, y: minY - 12 },
        selectable: false,
        draggable: false,
        connectable: false,
        style: { zIndex: -1 },
        data: {
          label: group.optionalDisplayName || bounds.groupKey,
          colorHex: group.colourHex,
          width: maxX - minX + TECH_NODE_RENDER_WIDTH + 24,
          height: maxY - minY + TECH_NODE_RENDER_HEIGHT + 24,
        },
      });
    }

    // Placeholder + label nodes in edit mode
    const editNodes: Node[] = [];
    if (isEditMode && visibleNodes.length > 0) {
      const occupiedPositions = new Set<string>();
      let maxDisplayTier = 0;
      let minIndent = MIN_TECH_ROW;
      let maxIndent = MIN_TECH_ROW;
      for (const node of visibleNodes) {
        const displayTier = Math.round(node.position.x / NODE_WIDTH);
        const indent = Math.round(node.position.y / NODE_HEIGHT);
        occupiedPositions.add(`${displayTier},${indent}`);
        if (displayTier > maxDisplayTier) maxDisplayTier = displayTier;
        if (indent < minIndent) minIndent = indent;
        if (indent > maxIndent) maxIndent = indent;
      }

      // Placeholders at empty grid positions
      for (let tier = 0; tier <= maxDisplayTier + 1; tier++) {
        for (let indent = minIndent; indent <= maxIndent + 1; indent++) {
          if (!occupiedPositions.has(`${tier},${indent}`)) {
            editNodes.push({
              id: `placeholder_t${tier}_i${indent}`,
              type: "techPlaceholder",
              data: { tier, indent },
              position: { x: tier * NODE_WIDTH, y: indent * NODE_HEIGHT },
              selectable: false,
              draggable: false,
              connectable: false,
            });
          }
        }
      }

      // Column labels along top
      for (let tier = 0; tier <= maxDisplayTier + 1; tier++) {
        editNodes.push({
          id: `label_col_${tier}`,
          type: "techLabel",
          data: { label: `Col ${tier}` },
          position: { x: tier * NODE_WIDTH + NODE_WIDTH / 2 - 20, y: -50 },
          selectable: false,
          draggable: false,
          connectable: false,
        });
      }

      // Row labels along left
      for (let indent = minIndent; indent <= maxIndent + 1; indent++) {
        editNodes.push({
          id: `label_row_${indent}`,
          type: "techLabel",
          data: { label: `Row ${indent}` },
          position: { x: -120, y: indent * NODE_HEIGHT + NODE_HEIGHT / 2 - 10 },
          selectable: false,
          draggable: false,
          connectable: false,
        });
      }
    }

    const nodes = [...groupNodes, ...visibleNodes, ...editNodes];

    return { nodes, edges: visibleEdges };
  }, [
    technologyTree,
    scopedVisibleNodeSet,
    hiddenOverrides,
    showHiddenTechnologies,
    changedNodePositions,
    currentTierOffset,
    allEdgesMap,
    deletedLinks,
    deletedNodeKeys,
    editedNodes,
    isEditMode,
    selectedNodeIdSet,
    showTechKeys,
    addedNodes,
    isRequirementsMode,
    isRequirementCheckActive,
    unlockedNodeKeySet,
    handleUnlockNode,
    handleLockNode,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(graphModel.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphModel.edges);

  useEffect(() => {
    setNodes((prevNodes) => {
      const selectedIds = new Set(prevNodes.filter((node) => node.selected).map((node) => node.id));
      return graphModel.nodes.map((node) => ({
        ...node,
        selected: selectedIds.has(node.id),
      }));
    });
  }, [graphModel.nodes, setNodes]);

  useEffect(() => {
    setEdges((prevEdges) => {
      const selectedIds = new Set(prevEdges.filter((edge) => edge.selected).map((edge) => edge.id));
      return graphModel.edges.map((edge) => ({
        ...edge,
        selected: selectedIds.has(edge.id),
      }));
    });
  }, [graphModel.edges, setEdges]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[]; edges: Edge[] }) => {
    const nextSelectedNodeIds = selectedNodes
      .filter((node) => node.type === "techNode")
      .map((node) => node.id)
      .sort();
    setSelectedNodeIds((prevSelectedNodeIds) =>
      areStringArraysEqual(prevSelectedNodeIds, nextSelectedNodeIds)
        ? prevSelectedNodeIds
        : nextSelectedNodeIds,
    );
  }, []);

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!isEditMode) return;
      captureHistory();
      const baseNode = technologyTree?.nodes.find((n) => n.nodeKey === node.id);
      const addedNode = addedNodes.find((n) => n.nodeKey === node.id);
      const edits = editedNodes[node.id];
      const effectiveNode = edits ? { ...(baseNode || addedNode), ...edits } : baseNode || addedNode;
      const xOffsetInNodeUnits = effectiveNode
        ? toNodeUnitsFromPixelOffsetX(effectiveNode.pixelOffsetX || 0)
        : 0;
      const yOffsetInNodeUnits = effectiveNode
        ? toNodeUnitsFromPixelOffsetY(effectiveNode.pixelOffsetY || 0)
        : 0;
      const displayTier = Math.max(0, Math.round(node.position.x / NODE_WIDTH - xOffsetInNodeUnits));
      const indent = Math.max(MIN_TECH_ROW, Math.round(node.position.y / NODE_HEIGHT - yOffsetInNodeUnits));
      const actualTier = displayTier + currentTierOffset;
      setChangedNodePositions((prev) => ({ ...prev, [node.id]: { tier: actualTier, indent } }));
    },
    [isEditMode, currentTierOffset, technologyTree?.nodes, captureHistory, addedNodes, editedNodes],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "techPlaceholder" && isEditMode) {
        const { tier, indent } = node.data as { tier: number; indent: number };
        setAddNodeTarget({ tier: tier + currentTierOffset, indent });
      }
    },
    [isEditMode, currentTierOffset],
  );

  const onAddNode = useCallback(
    (modalData: TechNodeFormData) => {
      if (!addNodeTarget || !technologyTree) return;
      captureHistory();
      const generatedNodeKey = `custom_node_${modalData.technologyKey}_${Date.now().toString()}`;
      const newNode: TechnologyNodeData = {
        nodeKey: generatedNodeKey,
        technologyKey: modalData.technologyKey,
        setKey: technologyTree.set.key,
        tier: addNodeTarget.tier,
        indent: addNodeTarget.indent,
        requiredParents: modalData.requiredParents,
        campaignKey: modalData.campaignKey || undefined,
        factionKey: modalData.factionKey || undefined,
        pixelOffsetX: modalData.pixelOffsetX,
        pixelOffsetY: modalData.pixelOffsetY,
        researchPointsRequired: modalData.researchPointsRequired,
        localizedName: modalData.displayName,
        shortDescription: modalData.shortDescription,
        longDescription: modalData.longDescription,
        iconPath: modalData.iconPath || allTechnologiesByKey[modalData.technologyKey]?.iconPath,
        isHidden: modalData.isHidden,
        buildingLevel: modalData.buildingLevel,
        effects: modalData.effects,
        iconData: modalData.iconData || allTechnologiesByKey[modalData.technologyKey]?.iconData,
      };
      setAddedNodes((prev) => [...prev, newNode]);
      if (allTechnologiesByKey[modalData.technologyKey]) {
        setHiddenOverrides((prev) => ({ ...prev, [modalData.technologyKey]: modalData.isHidden }));
      }
      setAddNodeTarget(null);
    },
    [addNodeTarget, technologyTree, captureHistory, allTechnologiesByKey],
  );

  const onEditNode = useCallback(
    (nodeKey: string, changes: TechNodeFormData) => {
      captureHistory();
      const addedIdx = addedNodes.findIndex((n) => n.nodeKey === nodeKey);
      if (addedIdx >= 0) {
        setAddedNodes((prev) =>
          prev.map((n) =>
            n.nodeKey === nodeKey
              ? {
                  ...n,
                  technologyKey: changes.technologyKey,
                  localizedName: changes.displayName,
                  requiredParents: changes.requiredParents,
                  researchPointsRequired: changes.researchPointsRequired,
                  campaignKey: changes.campaignKey || undefined,
                  factionKey: changes.factionKey || undefined,
                  isHidden: changes.isHidden,
                  pixelOffsetX: changes.pixelOffsetX,
                  pixelOffsetY: changes.pixelOffsetY,
                  buildingLevel: changes.buildingLevel,
                  shortDescription: changes.shortDescription,
                  longDescription: changes.longDescription,
                  iconPath: changes.iconPath || allTechnologiesByKey[changes.technologyKey]?.iconPath,
                  effects: changes.effects,
                  iconData: changes.iconData || allTechnologiesByKey[changes.technologyKey]?.iconData,
                }
              : n,
          ),
        );
      } else {
        setEditedNodes((prev) => ({
          ...prev,
          [nodeKey]: {
            ...prev[nodeKey],
            technologyKey: changes.technologyKey,
            localizedName: changes.displayName,
            requiredParents: changes.requiredParents,
            researchPointsRequired: changes.researchPointsRequired,
            campaignKey: changes.campaignKey,
            factionKey: changes.factionKey,
            isHidden: changes.isHidden,
            pixelOffsetX: changes.pixelOffsetX,
            pixelOffsetY: changes.pixelOffsetY,
            buildingLevel: changes.buildingLevel,
            shortDescription: changes.shortDescription,
            longDescription: changes.longDescription,
            iconPath: changes.iconPath || allTechnologiesByKey[changes.technologyKey]?.iconPath,
            effects: changes.effects,
            iconData: changes.iconData || allTechnologiesByKey[changes.technologyKey]?.iconData,
          },
        }));
      }
      if (allTechnologiesByKey[changes.technologyKey]) {
        setHiddenOverrides((prev) => ({ ...prev, [changes.technologyKey]: changes.isHidden }));
      }
      setEditNodeTarget(null);
    },
    [captureHistory, addedNodes, allTechnologiesByKey],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isEditMode || !connection.source || !connection.target) return;
      captureHistory();
      const link: TechnologyLinkData = {
        parentKey: connection.source,
        childKey: connection.target,
        parentLinkPosition: handleIdToCompass(connection.sourceHandle, 2),
        childLinkPosition: handleIdToCompass(connection.targetHandle, 4),
        parentLinkPositionOffset: 0,
        childLinkPositionOffset: 0,
        initialDescentTiers: 0,
        visibleInUi: true,
      };
      const linkKey = `${link.parentKey}|${link.childKey}`;
      setChangedLinks((prev) => ({ ...prev, [linkKey]: link }));
      setEdges((existingEdges) => addEdge(connection, existingEdges));
    },
    [isEditMode, setEdges, captureHistory],
  );

  // Context menu handlers
  const getLinkKeyFromEdge = useCallback(
    (edge: Pick<Edge, "id" | "source" | "target">) =>
      edge.id.startsWith("tech-link-") ? edge.id.replace("tech-link-", "") : `${edge.source}|${edge.target}`,
    [],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (!isEditMode) return;
      if (node.type === "techPlaceholder") {
        if (techClipboard.length > 0) {
          event.preventDefault();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            nodeId: node.id,
            targetType: "techPlaceholder",
          });
        }
        return;
      }
      if (node.type !== "techNode") return;
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, targetType: "techNode" });
    },
    [isEditMode],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!isEditMode) return;
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        targetType: "techEdge",
        edgeId: getLinkKeyFromEdge(edge),
      });
    },
    [getLinkKeyFromEdge, isEditMode],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const updateChangedLink = useCallback(
    (linkKey: string, updater: (link: TechnologyLinkData) => TechnologyLinkData) => {
      const existingLink = allEdgesMap.get(linkKey);
      if (!existingLink) return;
      setChangedLinks((prev) => {
        const currentLink = prev[linkKey] || existingLink;
        return { ...prev, [linkKey]: updater(currentLink) };
      });
    },
    [allEdgesMap],
  );

  const openLinkOffsetEditor = useCallback(
    (linkKey: string) => {
      const link = allEdgesMap.get(linkKey);
      if (!link) return;
      setEditLinkTarget({
        linkKey,
        parentOffset: link.parentLinkPositionOffset.toString(),
        childOffset: link.childLinkPositionOffset.toString(),
      });
      closeContextMenu();
    },
    [allEdgesMap, closeContextMenu],
  );

  const toggleLinkVisibility = useCallback(
    (linkKey: string, visibleInUi: boolean) => {
      captureHistory();
      updateChangedLink(linkKey, (link) => ({ ...link, visibleInUi }));
      closeContextMenu();
    },
    [captureHistory, closeContextMenu, updateChangedLink],
  );

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  const clearSelections = useCallback(() => {
    setNodes((prevNodes) => prevNodes.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setEdges((prevEdges) => prevEdges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
    setSelectedNodeIds([]);
  }, [setEdges, setNodes]);

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      setContextMenu(null);
      clearSelections();
    },
    [clearSelections],
  );

  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (!isEditMode) return;
      event.preventDefault();
      event.stopPropagation();
      const linkKey = getLinkKeyFromEdge(edge);
      captureHistory();
      setDeletedLinks((prev) => new Set([...prev, linkKey]));
      setChangedLinks((prev) => {
        const next = { ...prev };
        delete next[linkKey];
        return next;
      });
      setEdges((prevEdges) => prevEdges.filter((existingEdge) => existingEdge.id !== edge.id));
    },
    [captureHistory, getLinkKeyFromEdge, isEditMode, setEdges],
  );

  const saveEditedLinkOffsets = useCallback(() => {
    if (!editLinkTarget) return;
    const parentOffset = Number.parseFloat(editLinkTarget.parentOffset);
    const childOffset = Number.parseFloat(editLinkTarget.childOffset);
    if (!Number.isFinite(parentOffset) || !Number.isFinite(childOffset)) {
      setStatusMessage("Link offsets must be valid numbers.");
      return;
    }

    captureHistory();
    updateChangedLink(editLinkTarget.linkKey, (link) => ({
      ...link,
      parentLinkPositionOffset: parentOffset,
      childLinkPositionOffset: childOffset,
    }));
    setEditLinkTarget(null);
  }, [captureHistory, editLinkTarget, updateChangedLink]);

  // Context menu: Escape to close
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [contextMenu]);

  const buildChangesPayload = useCallback(() => {
    const hiddenTechnologies = Object.entries(hiddenOverrides)
      .filter(([technologyKey, overriddenValue]) => {
        const originalHidden = originalHiddenByTechnologyKey[technologyKey] || false;
        return originalHidden !== overriddenValue;
      })
      .map(([technologyKey, isHidden]) => ({ technologyKey, isHidden }));

    const changedNodes = Object.entries(changedNodePositions).map(([nodeKey, position]) => ({
      nodeKey,
      tier: position.tier,
      indent: position.indent,
    }));

    const changedLinksArray = Object.values(changedLinks);
    const newNodes = addedNodes
      .filter((node) => !deletedNodeKeys.has(node.nodeKey))
      .map((node) => ({
        nodeKey: node.nodeKey,
        technologyKey: node.technologyKey,
        displayName: node.localizedName,
        tier: changedNodePositions[node.nodeKey]?.tier ?? node.tier,
        indent: changedNodePositions[node.nodeKey]?.indent ?? node.indent,
        setKey: node.setKey,
        requiredParents: node.requiredParents,
        researchPointsRequired: node.researchPointsRequired,
        campaignKey: node.campaignKey,
        factionKey: node.factionKey,
        isHidden: !!node.isHidden,
        pixelOffsetX: node.pixelOffsetX || 0,
        pixelOffsetY: node.pixelOffsetY || 0,
        buildingLevel: node.buildingLevel,
        shortDescription: node.shortDescription,
        longDescription: node.longDescription,
        iconPath: node.iconPath,
        effects: node.effects || [],
      }));

    const deletedNodeKeysArray = [...deletedNodeKeys].filter(
      (key) => !addedNodes.some((n) => n.nodeKey === key),
    );
    const deletedLinkKeysArray = [...deletedLinks];
    const editedNodesArray = Object.entries(editedNodes).map(([nodeKey, changes]) => ({
      nodeKey,
      technologyKey: changes.technologyKey,
      displayName: changes.localizedName,
      requiredParents: changes.requiredParents,
      researchPointsRequired: changes.researchPointsRequired,
      campaignKey: changes.campaignKey,
      factionKey: changes.factionKey,
      isHidden: changes.isHidden,
      pixelOffsetX: changes.pixelOffsetX,
      pixelOffsetY: changes.pixelOffsetY,
      buildingLevel: changes.buildingLevel,
      shortDescription: changes.shortDescription,
      longDescription: changes.longDescription,
      iconPath: changes.iconPath,
      effects: changes.effects || [],
    }));

    const hasChanges =
      changedNodes.length > 0 ||
      changedLinksArray.length > 0 ||
      hiddenTechnologies.length > 0 ||
      newNodes.length > 0 ||
      deletedNodeKeysArray.length > 0 ||
      deletedLinkKeysArray.length > 0 ||
      editedNodesArray.length > 0;

    return {
      hiddenTechnologies,
      changedNodes,
      changedLinksArray,
      newNodes,
      deletedNodeKeysArray,
      deletedLinkKeysArray,
      editedNodesArray,
      hasChanges,
    };
  }, [
    addedNodes,
    changedLinks,
    changedNodePositions,
    deletedLinks,
    deletedNodeKeys,
    editedNodes,
    hiddenOverrides,
    originalHiddenByTechnologyKey,
  ]);

  const buildWholeTreePayload = useCallback((): SaveTechnologyPackPayload | undefined => {
    if (!technologyTree) return undefined;

    const finalNodesByKey = new Map<string, SaveTechnologyPackPayload["nodes"][number]>();
    for (const node of technologyTree.nodes) {
      if (deletedNodeKeys.has(node.nodeKey)) continue;
      const positionOverride = changedNodePositions[node.nodeKey];
      const edits = editedNodes[node.nodeKey];
      const effectiveTechnologyKey = edits?.technologyKey ?? node.technologyKey;
      const hiddenOverride = hiddenOverrides[effectiveTechnologyKey];
      const isHiddenNow = hiddenOverride === undefined ? node.isHidden : hiddenOverride;
      finalNodesByKey.set(node.nodeKey, {
        nodeKey: node.nodeKey,
        technologyKey: effectiveTechnologyKey,
        setKey: technologyTree.set.key,
        tier: positionOverride?.tier ?? node.tier,
        indent: positionOverride?.indent ?? node.indent,
        requiredParents: edits?.requiredParents ?? node.requiredParents ?? 0,
        campaignKey: edits?.campaignKey ?? node.campaignKey,
        factionKey: edits?.factionKey ?? node.factionKey,
        pixelOffsetX: edits?.pixelOffsetX ?? node.pixelOffsetX ?? 0,
        pixelOffsetY: edits?.pixelOffsetY ?? node.pixelOffsetY ?? 0,
        optionalUiGroup: node.optionalUiGroup,
        researchPointsRequired: edits?.researchPointsRequired ?? node.researchPointsRequired,
        buildingLevel: edits?.buildingLevel ?? node.buildingLevel,
        displayName: edits?.localizedName ?? (node.localizedName || node.technologyKey),
        shortDescription: edits?.shortDescription ?? node.shortDescription,
        longDescription: edits?.longDescription ?? node.longDescription,
        iconPath: edits?.iconPath ?? node.iconPath,
        isHidden: !!isHiddenNow,
        effects: edits?.effects ?? node.effects ?? [],
      });
    }

    for (const node of addedNodes) {
      if (deletedNodeKeys.has(node.nodeKey)) continue;
      const positionOverride = changedNodePositions[node.nodeKey];
      const hiddenOverride = hiddenOverrides[node.technologyKey];
      finalNodesByKey.set(node.nodeKey, {
        nodeKey: node.nodeKey,
        technologyKey: node.technologyKey,
        setKey: technologyTree.set.key,
        tier: positionOverride?.tier ?? node.tier,
        indent: positionOverride?.indent ?? node.indent,
        requiredParents: node.requiredParents,
        campaignKey: node.campaignKey,
        factionKey: node.factionKey,
        pixelOffsetX: node.pixelOffsetX || 0,
        pixelOffsetY: node.pixelOffsetY || 0,
        optionalUiGroup: node.optionalUiGroup,
        researchPointsRequired: node.researchPointsRequired,
        buildingLevel: node.buildingLevel,
        displayName: node.localizedName || node.technologyKey,
        shortDescription: node.shortDescription,
        longDescription: node.longDescription,
        iconPath: node.iconPath,
        isHidden: !!(hiddenOverride ?? false),
        effects: node.effects || [],
      });
    }

    const finalNodeKeySet = new Set(finalNodesByKey.keys());
    const finalLinksMap = new Map<string, TechnologyLinkData>();
    for (const link of technologyTree.links) {
      finalLinksMap.set(`${link.parentKey}|${link.childKey}`, link);
    }
    for (const [linkKey, changedLink] of Object.entries(changedLinks)) {
      finalLinksMap.set(linkKey, changedLink);
    }
    const finalLinks = [...finalLinksMap.entries()]
      .filter(([linkKey, link]) => {
        if (deletedLinks.has(linkKey)) return false;
        return finalNodeKeySet.has(link.parentKey) && finalNodeKeySet.has(link.childKey);
      })
      .map(([, link]) => link);

    return {
      setKey: technologyTree.set.key,
      packName: savePackName.trim(),
      packDirectory: savePackDirectory || "",
      tableNameOverride: tableNameOverride.trim() || undefined,
      nodes: [...finalNodesByKey.values()],
      links: finalLinks,
    };
  }, [
    addedNodes,
    changedLinks,
    changedNodePositions,
    deletedLinks,
    deletedNodeKeys,
    editedNodes,
    hiddenOverrides,
    savePackDirectory,
    savePackName,
    tableNameOverride,
    technologyTree,
  ]);

  const resetStateAfterSave = useCallback(() => {
    setChangedNodePositions({});
    setChangedLinks({});
    setHiddenOverrides({});
    setAddedNodes([]);
    setDeletedNodeKeys(new Set());
    setDeletedLinks(new Set());
    setEditedNodes({});
    setEditLinkTarget(null);
    historyPast.current = [];
    historyFuture.current = [];
    setHistorySize({ past: 0, future: 0 });
    setSavePackDirectory(undefined);
  }, []);

  const saveTechnologyChanges = useCallback(async () => {
    if (!technologyTree) return;
    if (!savePackName.trim()) {
      setStatusMessage("Pack name is required.");
      return;
    }

    const {
      hiddenTechnologies,
      changedNodes,
      changedLinksArray,
      newNodes,
      deletedNodeKeysArray,
      deletedLinkKeysArray,
      editedNodesArray,
      hasChanges,
    } = buildChangesPayload();

    if (!hasChanges) {
      setStatusMessage("No changes to save.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await window.api?.saveTechnologyChanges({
        setKey: technologyTree.set.key,
        packName: savePackName.trim(),
        packDirectory: savePackDirectory || "",
        tableNameOverride: tableNameOverride.trim() || undefined,
        changedNodes,
        changedLinks: changedLinksArray,
        hiddenTechnologies,
        newNodes,
        deletedNodeKeys: deletedNodeKeysArray,
        deletedLinkKeys: deletedLinkKeysArray,
        editedNodes: editedNodesArray,
      });

      if (!result?.success) {
        setStatusMessage(`Failed to save: ${result?.error || "Unknown error"}`);
        return;
      }

      setStatusMessage(`Saved ${result.packName} to ${result.packPath}`);
      const refreshedTree = await window.api?.getTechnologyTree(technologyTree.set.key);
      if (refreshedTree) setTechnologyTree(refreshedTree);
      resetStateAfterSave();
      setIsSaveModalOpen(false);
    } finally {
      setIsSaving(false);
    }
  }, [
    buildChangesPayload,
    resetStateAfterSave,
    savePackDirectory,
    savePackName,
    tableNameOverride,
    technologyTree,
  ]);

  const saveWholeTechnologyTree = useCallback(async () => {
    if (!technologyTree) return;
    if (!savePackName.trim()) {
      setStatusMessage("Pack name is required.");
      return;
    }

    const payload = buildWholeTreePayload();
    if (!payload || payload.nodes.length < 1) {
      setStatusMessage("No technology nodes to save.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await window.api?.saveTechnologyPack(payload);
      if (!result?.success) {
        setStatusMessage(`Failed to save: ${result?.error || "Unknown error"}`);
        return;
      }

      setStatusMessage(`Saved ${result.packName} to ${result.packPath}`);
      const refreshedTree = await window.api?.getTechnologyTree(technologyTree.set.key);
      if (refreshedTree) setTechnologyTree(refreshedTree);
      resetStateAfterSave();
      setIsSaveModalOpen(false);
    } finally {
      setIsSaving(false);
    }
  }, [buildWholeTreePayload, resetStateAfterSave, savePackName, technologyTree]);

  const openSaveModal = useCallback(
    (mode: TechSaveMode) => {
      if (!technologyTree) return;
      const timestamp = Date.now().toString();
      setSaveMode(mode);
      setSavePackName(
        mode === "whole"
          ? `technology_tree_${technologyTree.set.key}_${timestamp}`
          : `technology_changes_${timestamp}`,
      );
      setSavePackDirectory(undefined);
      setTableNameOverride("");
      setIsSaveModalOpen(true);
    },
    [technologyTree],
  );

  const handleSelectSavePackDirectory = useCallback(async () => {
    const selectedDirectory = await window.api?.selectDirectory();
    if (selectedDirectory) setSavePackDirectory(selectedDirectory);
  }, []);

  const handleSaveConfirm = useCallback(() => {
    if (saveMode === "whole") {
      void saveWholeTechnologyTree();
      return;
    }
    void saveTechnologyChanges();
  }, [saveMode, saveTechnologyChanges, saveWholeTechnologyTree]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-gray-900 border-b border-gray-700 px-3 py-1.5 flex-wrap shrink-0">
        {(technologyTree?.uiTabs.length || 0) > 0 && (
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            value={selectedUiTab}
            onChange={(event) => setSelectedUiTab(event.target.value)}
            disabled={!technologyTree}
          >
            <option value="all">All</option>
            {(technologyTree?.uiTabs || []).map((uiTab) => (
              <option key={uiTab.key} value={uiTab.key}>
                {uiTab.localizedName || uiTab.key}
              </option>
            ))}
          </select>
        )}
        {availableScopeOptions.length > 0 && (
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            value={selectedScopeKey}
            onChange={(event) => setSelectedScopeKey(event.target.value)}
            disabled={!technologyTree}
          >
            {hasBaseNodesOnly && <option value="">Base nodes only</option>}
            {availableScopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <Dropdown dismissOnClick={false} label="View" color="gray" className="min-w-[12rem]">
          <Dropdown.Item className="p-0">
            <label className="flex items-center gap-2 px-4 py-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHiddenTechnologies}
                onChange={(event) => setShowHiddenTechnologies(event.target.checked)}
              />
              Show hidden
            </label>
          </Dropdown.Item>
          <Dropdown.Item className="p-0">
            <label className="flex items-center gap-2 px-4 py-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTechKeys}
                onChange={(event) => setShowTechKeys(event.target.checked)}
              />
              Show tech keys
            </label>
          </Dropdown.Item>
          <Dropdown.Item className="p-0">
            <label className="flex items-center gap-2 px-4 py-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isCheckingRequirements}
                onChange={(event) => setIsCheckingRequirements(event.target.checked)}
              />
              Check requirements
            </label>
          </Dropdown.Item>
        </Dropdown>
        <label className="text-xs flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isEditMode}
            onChange={(event) => {
              const checked = event.target.checked;
              setIsEditMode(checked);
              if (!checked) {
                setIsRequirementsMode(false);
                setContextMenu(null);
                setEditLinkTarget(null);
                setIsSaveModalOpen(false);
              }
            }}
          />
          Edit mode
        </label>
        {isEditMode && (
          <>
            <button
              type="button"
              className={`px-3 py-1 rounded border text-xs ${
                isRequirementsMode
                  ? "bg-amber-600 text-white border-amber-500"
                  : "bg-gray-700 border-gray-600 hover:bg-gray-600"
              }`}
              onClick={() => setIsRequirementsMode((prev) => !prev)}
            >
              {isRequirementsMode ? "Requirements: ON" : "Requirements"}
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-gray-700 border border-gray-600 text-xs hover:bg-gray-600 disabled:opacity-40"
              disabled={historySize.past === 0}
              onClick={handleUndo}
              title="Undo (Ctrl+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-gray-700 border border-gray-600 text-xs hover:bg-gray-600 disabled:opacity-40"
              disabled={historySize.future === 0}
              onClick={handleRedo}
              title="Redo (Ctrl+Y)"
            >
              Redo
            </button>
            <div className="hover:bg-green-700 bg-green-600 border-2 border-gray-600 rounded-lg w-fit">
              <Dropdown dismissOnClick={false} label="Save" color={"success"}>
                <Dropdown.Item>
                  <button
                    className="w-36 px-4 py-2 rounded-lg border-2 border-gray-600 hover:bg-blue-700 bg-blue-600 text-white disabled:opacity-60"
                    disabled={isSaving || !technologyTree}
                    onClick={() => openSaveModal("whole")}
                  >
                    Save Whole Tree
                  </button>
                </Dropdown.Item>
                <Dropdown.Item>
                  <button
                    className="w-36 px-4 py-2 rounded-lg border-2 border-gray-600 hover:bg-green-700 bg-green-600 text-white disabled:opacity-60"
                    disabled={isSaving || !technologyTree}
                    onClick={() => openSaveModal("changes")}
                  >
                    Save Only Changes
                  </button>
                </Dropdown.Item>
              </Dropdown>
            </div>
          </>
        )}
      </div>
      {/* Status message */}
      {statusMessage && (
        <div className="flex items-center justify-between px-3 py-1 bg-gray-800/60 border-b border-gray-700 text-xs text-gray-400 shrink-0">
          <span>{statusMessage}</span>
          <button
            type="button"
            className="ml-2 opacity-60 hover:opacity-100"
            onClick={() => setStatusMessage(undefined)}
          >
            ×
          </button>
        </div>
      )}
      {/* ReactFlow canvas */}
      <div className={`relative flex-1 ${isEditMode ? "" : "hideReactFlowHandles"}`}>
        {isLoadingTree && (
          <div className="absolute inset-0 bg-gray-900/40 z-10 pointer-events-none flex items-center justify-center">
            <div className="dots-loader" />
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onEdgeClick={onEdgeClick}
          onEdgeContextMenu={isEditMode ? onEdgeContextMenu : undefined}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={isEditMode && !isRequirementsMode ? onNodeClick : undefined}
          onNodeContextMenu={isEditMode ? onNodeContextMenu : undefined}
          onPaneClick={isEditMode ? onPaneClick : undefined}
          onPaneContextMenu={isEditMode ? onPaneContextMenu : undefined}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          snapToGrid={isEditMode && !isRequirementsMode}
          snapGrid={[NODE_WIDTH, NODE_HEIGHT]}
          zoomOnDoubleClick={false}
          nodesDraggable={isEditMode && !isRequirementsMode}
          nodesConnectable={isEditMode}
          elementsSelectable
          multiSelectionKeyCode="Shift"
          connectOnClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#374151" gap={24} />
        </ReactFlow>
      </div>
      <Modal onClose={() => setIsSaveModalOpen(false)} show={isSaveModalOpen} size="md" position="center">
        <Modal.Header>{saveMode === "changes" ? "Save Only Changes" : "Save Technology Tree"}</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Pack Name (without .pack extension)
              </label>
              <input
                type="text"
                value={savePackName}
                onChange={(e) => setSavePackName(e.target.value)}
                placeholder="Enter pack name"
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                disabled={isSaving}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Save Location</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={savePackDirectory || ""}
                  placeholder="Default: game data folder"
                  readOnly
                  className="flex-1 px-3 py-2 bg-gray-700 text-gray-400 border border-gray-600 rounded-lg focus:outline-none"
                />
                <button
                  onClick={handleSelectSavePackDirectory}
                  disabled={isSaving}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                >
                  Browse
                </button>
              </div>
              {savePackDirectory && (
                <p className="text-xs text-gray-400 mt-1 truncate">{savePackDirectory}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Table Name (optional)</label>
              <input
                type="text"
                value={tableNameOverride}
                onChange={(e) => setTableNameOverride(e.target.value)}
                placeholder="Leave empty for default"
                disabled={isSaving}
                className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2.5 placeholder-gray-400"
              />
              <p className="text-xs text-gray-400 mt-1">Overrides table file names in the pack</p>
            </div>
            {saveMode === "changes" ? (
              <p className="text-sm text-gray-400">
                Only changed, moved, added, or deleted nodes and links will be included in the output pack.
              </p>
            ) : (
              <p className="text-sm text-gray-400">
                The entire currently edited technology tree snapshot will be written to the output pack.
              </p>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            onClick={() => setIsSaveModalOpen(false)}
            disabled={isSaving}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveConfirm}
            disabled={isSaving || !savePackName.trim()}
            className={`px-4 py-2 ${
              saveMode === "changes" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"
            } text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isSaving ? "Saving..." : saveMode === "changes" ? "Save Only Changes" : "Save Whole Tree"}
          </button>
        </Modal.Footer>
      </Modal>
      {addNodeTarget && (
        <AddTechNodeModal
          tier={addNodeTarget.tier}
          indent={addNodeTarget.indent}
          onAdd={onAddNode}
          onClose={() => setAddNodeTarget(null)}
          allTechnologies={technologyTree?.allTechnologies || []}
          allTechnologyIcons={technologyTree?.allTechnologyIcons || []}
          allEffects={technologyTree?.allEffects || []}
        />
      )}
      {editNodeTarget && (
        <AddTechNodeModal
          tier={editNodeTarget.tier}
          indent={editNodeTarget.indent}
          onAdd={onAddNode}
          onClose={() => setEditNodeTarget(null)}
          existingNode={editNodeTarget}
          onEdit={onEditNode}
          allTechnologies={technologyTree?.allTechnologies || []}
          allTechnologyIcons={technologyTree?.allTechnologyIcons || []}
          allEffects={technologyTree?.allEffects || []}
        />
      )}
      <Modal onClose={() => setEditLinkTarget(null)} show={!!editLinkTarget} size="sm" position="center">
        <Modal.Header>Edit Link Offsets</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="tech-link-parent-offset">
                Parent offset
              </label>
              <input
                id="tech-link-parent-offset"
                type="number"
                step="0.1"
                value={editLinkTarget?.parentOffset || ""}
                onChange={(event) =>
                  setEditLinkTarget((prev) =>
                    prev ? { ...prev, parentOffset: event.target.value } : prev,
                  )
                }
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="tech-link-child-offset">
                Child offset
              </label>
              <input
                id="tech-link-child-offset"
                type="number"
                step="0.1"
                value={editLinkTarget?.childOffset || ""}
                onChange={(event) =>
                  setEditLinkTarget((prev) =>
                    prev ? { ...prev, childOffset: event.target.value } : prev,
                  )
                }
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>
            <p className="text-xs text-gray-400">
              `0` stays centered, `1` moves to the far right or bottom edge, `-1` moves to the far left or top edge.
            </p>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200"
            onClick={() => setEditLinkTarget(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors duration-200"
            onClick={() =>
              setEditLinkTarget((prev) =>
                prev ? { ...prev, parentOffset: "0", childOffset: "0" } : prev,
              )
            }
          >
            Reset to 0
          </button>
          <button
            type="button"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200"
            onClick={saveEditedLinkOffsets}
          >
            Save
          </button>
        </Modal.Footer>
      </Modal>
      {/* Context Menu */}
      {contextMenu &&
        (() => {
          const targetNodeData = (() => {
            if (contextMenu.targetType !== "techNode") return null;
            const baseNode = technologyTree?.nodes.find((n) => n.nodeKey === contextMenu.nodeId);
            const addedNode = addedNodes.find((n) => n.nodeKey === contextMenu.nodeId);
            return baseNode || addedNode || null;
          })();
          const targetLink =
            contextMenu.targetType === "techEdge" ? allEdgesMap.get(contextMenu.edgeId) || null : null;

          const selectedNodeIds = nodes
            .filter((n) => n.selected && n.type === "techNode" && n.id !== ("nodeId" in contextMenu ? contextMenu.nodeId : ""))
            .map((n) => n.id);
          const isTargetSelected =
            "nodeId" in contextMenu && nodes.some((n) => n.id === contextMenu.nodeId && n.selected);
          const allSelectedIds =
            isTargetSelected && selectedNodeIds.length > 0
              ? [contextMenu.nodeId, ...selectedNodeIds]
              : "nodeId" in contextMenu
                ? [contextMenu.nodeId]
                : [];
          const deleteCount = contextMenu.targetType === "techNode" ? allSelectedIds.length : 0;

          // Count connections for the right-clicked node
          const inputCount =
            contextMenu.targetType === "techNode"
              ? [...allEdgesMap.entries()].filter(
                  ([key, link]) => link.childKey === contextMenu.nodeId && !deletedLinks.has(key),
                ).length
              : 0;
          const outputCount =
            contextMenu.targetType === "techNode"
              ? [...allEdgesMap.entries()].filter(
                  ([key, link]) => link.parentKey === contextMenu.nodeId && !deletedLinks.has(key),
                ).length
              : 0;

          return (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={closeContextMenu}
                onContextMenu={(e) => {
                  e.preventDefault();
                  closeContextMenu();
                }}
              />
              <div
                className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[200px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                {contextMenu.targetType === "techNode" && targetNodeData && (
                  <>
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        console.log("Tech Node Info:", contextMenu.nodeId, targetNodeData);
                        closeContextMenu();
                      }}
                    >
                      Info
                    </button>
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        const edits = editedNodes[contextMenu.nodeId];
                        const effectiveNode = edits ? { ...targetNodeData, ...edits } : targetNodeData;
                        const posOverride = changedNodePositions[contextMenu.nodeId];
                        setEditNodeTarget({
                          nodeKey: contextMenu.nodeId,
                          tier: posOverride?.tier ?? effectiveNode.tier,
                          indent: posOverride?.indent ?? effectiveNode.indent,
                          technologyKey: effectiveNode.technologyKey,
                          displayName: effectiveNode.localizedName || effectiveNode.technologyKey,
                          requiredParents: effectiveNode.requiredParents || 0,
                          researchPointsRequired: effectiveNode.researchPointsRequired,
                          campaignKey: effectiveNode.campaignKey,
                          factionKey: effectiveNode.factionKey,
                          isHidden:
                            hiddenOverrides[effectiveNode.technologyKey] === undefined
                              ? !!effectiveNode.isHidden
                              : !!hiddenOverrides[effectiveNode.technologyKey],
                          pixelOffsetX: effectiveNode.pixelOffsetX || 0,
                          pixelOffsetY: effectiveNode.pixelOffsetY || 0,
                          buildingLevel: effectiveNode.buildingLevel,
                          shortDescription: effectiveNode.shortDescription,
                          longDescription: effectiveNode.longDescription,
                          iconPath: effectiveNode.iconPath,
                          iconData: effectiveNode.iconData,
                          effects: effectiveNode.effects || [],
                        });
                        closeContextMenu();
                      }}
                    >
                      Edit Node
                    </button>
                    <div className="border-t border-gray-700 my-1" />
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        captureHistory();
                        const keysToDelete = new Set(allSelectedIds);
                        setDeletedNodeKeys((prev) => new Set([...prev, ...keysToDelete]));
                        setAddedNodes((prev) => prev.filter((n) => !keysToDelete.has(n.nodeKey)));
                        // Cascade-delete links
                        const linksToDelete: string[] = [];
                        for (const [linkKey, link] of allEdgesMap.entries()) {
                          if (deletedLinks.has(linkKey)) continue;
                          if (keysToDelete.has(link.parentKey) || keysToDelete.has(link.childKey)) {
                            linksToDelete.push(linkKey);
                          }
                        }
                        if (linksToDelete.length > 0) {
                          setDeletedLinks((prev) => new Set([...prev, ...linksToDelete]));
                        }
                        // Remove from changedLinks
                        setChangedLinks((prev) => {
                          const next = { ...prev };
                          for (const key of linksToDelete) delete next[key];
                          return next;
                        });
                        closeContextMenu();
                      }}
                    >
                      Delete {deleteCount > 1 ? `${deleteCount} Nodes` : "Node"}
                    </button>
                    {inputCount > 0 && (
                      <button
                        className={menuItemClass}
                        onClick={() => {
                          captureHistory();
                          const linksToDelete: string[] = [];
                          for (const [linkKey, link] of allEdgesMap.entries()) {
                            if (deletedLinks.has(linkKey)) continue;
                            if (link.childKey === contextMenu.nodeId) linksToDelete.push(linkKey);
                          }
                          setDeletedLinks((prev) => new Set([...prev, ...linksToDelete]));
                          setChangedLinks((prev) => {
                            const next = { ...prev };
                            for (const key of linksToDelete) delete next[key];
                            return next;
                          });
                          closeContextMenu();
                        }}
                      >
                        Remove {inputCount} Input Connection{inputCount > 1 ? "s" : ""}
                      </button>
                    )}
                    {outputCount > 0 && (
                      <button
                        className={menuItemClass}
                        onClick={() => {
                          captureHistory();
                          const linksToDelete: string[] = [];
                          for (const [linkKey, link] of allEdgesMap.entries()) {
                            if (deletedLinks.has(linkKey)) continue;
                            if (link.parentKey === contextMenu.nodeId) linksToDelete.push(linkKey);
                          }
                          setDeletedLinks((prev) => new Set([...prev, ...linksToDelete]));
                          setChangedLinks((prev) => {
                            const next = { ...prev };
                            for (const key of linksToDelete) delete next[key];
                            return next;
                          });
                          closeContextMenu();
                        }}
                      >
                        Remove {outputCount} Output Connection{outputCount > 1 ? "s" : ""}
                      </button>
                    )}
                    <div className="border-t border-gray-700 my-1" />
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        const nodesToCopy = allSelectedIds
                          .map((id) => {
                            const base = technologyTree?.nodes.find((n) => n.nodeKey === id);
                            const added = addedNodes.find((n) => n.nodeKey === id);
                            return base || added || null;
                          })
                          .filter((n): n is TechnologyNodeData => n !== null);
                        if (nodesToCopy.length === 0) {
                          closeContextMenu();
                          return;
                        }
                        const anchorTier = Math.min(
                          ...nodesToCopy.map((n) => changedNodePositions[n.nodeKey]?.tier ?? n.tier),
                        );
                        const anchorIndent = Math.min(
                          ...nodesToCopy.map((n) => changedNodePositions[n.nodeKey]?.indent ?? n.indent),
                        );
                        techClipboard = nodesToCopy.map((n) => {
                          const pos = changedNodePositions[n.nodeKey];
                          const edits = editedNodes[n.nodeKey];
                          const effective = edits ? { ...n, ...edits } : n;
                          return {
                            technologyKey: effective.technologyKey,
                            localizedName: effective.localizedName,
                            requiredParents: effective.requiredParents || 0,
                            researchPointsRequired: effective.researchPointsRequired,
                            isHidden:
                              hiddenOverrides[effective.technologyKey] === undefined
                                ? !!effective.isHidden
                                : !!hiddenOverrides[effective.technologyKey],
                            pixelOffsetX: effective.pixelOffsetX || 0,
                            pixelOffsetY: effective.pixelOffsetY || 0,
                            buildingLevel: effective.buildingLevel,
                            shortDescription: effective.shortDescription,
                            longDescription: effective.longDescription,
                            iconData: effective.iconData,
                            effects: effective.effects || [],
                            relTier: (pos?.tier ?? n.tier) - anchorTier,
                            relIndent: (pos?.indent ?? n.indent) - anchorIndent,
                          };
                        });
                        closeContextMenu();
                      }}
                    >
                      Copy {allSelectedIds.length > 1 ? `${allSelectedIds.length} Nodes` : "Node"}
                    </button>
                  </>
                )}
                {contextMenu.targetType === "techEdge" && targetLink && (
                  <>
                    <button
                      className={menuItemClass}
                      onClick={() =>
                        openLinkOffsetEditor(
                          `${targetLink.parentKey}|${targetLink.childKey}`,
                        )
                      }
                    >
                      Adjust Link Offsets...
                    </button>
                    <button
                      className={menuItemClass}
                      onClick={() =>
                        toggleLinkVisibility(
                          `${targetLink.parentKey}|${targetLink.childKey}`,
                          !targetLink.visibleInUi,
                        )
                      }
                    >
                      {targetLink.visibleInUi ? "Hide Connection" : "Show Connection"}
                    </button>
                  </>
                )}
                {contextMenu.targetType === "techPlaceholder" && techClipboard.length > 0 && (
                  <button
                    className={menuItemClass}
                    onClick={() => {
                      const match = contextMenu.nodeId.match(/placeholder_t(-?\d+)_i(-?\d+)/);
                      if (!match || !technologyTree) {
                        closeContextMenu();
                        return;
                      }
                      const baseTier = Number(match[1]) + currentTierOffset;
                      const baseIndent = Number(match[2]);
                      captureHistory();
                      const newNodes: TechnologyNodeData[] = techClipboard.map((entry) => ({
                        nodeKey: `custom_node_${entry.technologyKey}_${Date.now()}`,
                        technologyKey: `${entry.technologyKey}_copy_${Date.now()}`,
                        setKey: technologyTree.set.key,
                        tier: baseTier + entry.relTier,
                        indent: baseIndent + entry.relIndent,
                        requiredParents: entry.requiredParents,
                        pixelOffsetX: entry.pixelOffsetX,
                        pixelOffsetY: entry.pixelOffsetY,
                        researchPointsRequired: entry.researchPointsRequired,
                        localizedName: entry.localizedName,
                        shortDescription: entry.shortDescription,
                        longDescription: entry.longDescription,
                        isHidden: entry.isHidden,
                        buildingLevel: entry.buildingLevel,
                        iconData: entry.iconData,
                        effects: entry.effects || [],
                      }));
                      setAddedNodes((prev) => [...prev, ...newNodes]);
                      closeContextMenu();
                    }}
                  >
                    Paste {techClipboard.length > 1 ? `${techClipboard.length} Nodes` : "Node"}
                  </button>
                )}
              </div>
            </>
          );
        })()}
    </div>
  );
});

export default TechTreeCanvas;
