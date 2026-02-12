import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import deepClone from "clone-deep";
import "@silevis/reactgrid/styles.css";
import localizationContext from "../../localizationContext";

import {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Position,
  ViewportPortal,
  ReactFlow,
  Panel,
  Connection,
  addEdge,
  OnNodeDrag,
} from "@xyflow/react";
import groupBy from "object.groupby";

import "reactflow/dist/style.css";
import Skill, { SkillData } from "./Skill";
import { Dropdown } from "flowbite-react";
import AddNodeModal from "./AddNodeModal";

const edgeType = "straight";

const GROUP_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#34495e"];

const AddPlaceholderNode = memo(({ data }: { data: { row: number; column: number } }) => {
  return (
    <div className="flex items-center justify-center w-[260px] h-20 border-2 border-dashed border-gray-500 rounded-lg cursor-pointer hover:border-gray-300 hover:bg-gray-800/30 transition-colors">
      <span className="text-3xl text-gray-500">+</span>
    </div>
  );
});

const nodeTypes = { skill: Skill, addPlaceholder: AddPlaceholderNode };

const RequirementEdge = ({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: any) => {
  const midX = (sourceX + targetX) / 2;
  const arc = Math.min(Math.abs(targetX - sourceX) * 0.3, 135);
  const dy = data?.curveBelow ? arc : -arc;
  const baseY = data?.curveBelow ? Math.max(sourceY, targetY) : Math.min(sourceY, targetY);
  const path = `M ${sourceX},${sourceY} Q ${midX},${baseY + dy} ${targetX},${targetY}`;
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={style?.stroke || "#f59e0b"}
        strokeWidth={style?.strokeWidth || 2}
        markerEnd={markerEnd}
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth={20} />
    </g>
  );
};

const SkillLockEdge = ({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: any) => {
  const midX = (sourceX + targetX) / 2;
  const arc = Math.min(Math.abs(targetX - sourceX) * 0.3, 135);
  const dy = data?.curveBelow ? -arc : arc; // Opposite curve from requirements
  const baseY = data?.curveBelow ? Math.min(sourceY, targetY) : Math.max(sourceY, targetY);
  const path = `M ${sourceX},${sourceY} Q ${midX},${baseY + dy} ${targetX},${targetY}`;
  const level = data?.level || 1;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={style?.stroke || "#dc2626"}
        strokeWidth={2}
        markerEnd={markerEnd}
        strokeDasharray="5,5"
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth={20} />
      <circle cx={midX} cy={baseY + dy} r="12" fill="#dc2626" stroke="#fff" strokeWidth="1" />
      <text x={midX} y={baseY + dy + 4} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="bold">
        {level}
      </text>
    </g>
  );
};

const edgeTypes = { requirement: RequirementEdge, skillLock: SkillLockEdge };

const collator = new Intl.Collator("en");

let skillIconBackground = "";
let skillBackground = "";
let skillIcon = "";
let arrowImg = "";
let skillLevelImg = "";
let tooltipFrame = "";
let skillLevelLitIcon = "";

skillIconBackground = require("../../assets/skills/skills_tab_ornament.png");
skillBackground = require("../../assets/skills//tech_skills_tab_active.png");
skillIcon = require("../../assets/skills//character_magic.png");
arrowImg = require("../../assets/skills//parchment_divider_arrow.png");
skillLevelImg = require("../../assets/skills//skills_tab_level_off.png");
tooltipFrame = require("../../assets/skills//tooltip_frame.png");
skillLevelLitIcon = require("../../assets/skills//skills_tab_level_lit.png");

const nodeWidth = 300;
let nodeHeight = 100;
const biggerNodeHeight = 120;
const editModeNodeHeight = 160; // Larger spacing for edit/requirements mode

const sortSameCoordinateSkills = (first: Skill, second: Skill) => {
  if (first.faction == second.faction && first.subculture == second.subculture) return 0;

  const firstHasFaction = first.faction && first.faction != "";
  const secondHasFaction = second.faction && second.faction != "";
  const firstHasSubculture = first.subculture && first.subculture != "";
  const secondHasSubculture = second.subculture && second.subculture != "";

  if (!firstHasFaction && !firstHasSubculture && (secondHasFaction || secondHasSubculture)) {
    return -1;
  }
  if (!secondHasFaction && !secondHasSubculture && (firstHasFaction || firstHasSubculture)) {
    return 1;
  }
  if (firstHasFaction && secondHasFaction) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return collator.compare(first.faction!, second.faction!);
  }
  if (firstHasSubculture && secondHasSubculture) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return collator.compare(first.subculture!, second.subculture!);
  }
  if (firstHasFaction && secondHasSubculture) {
    return -1;
  }
  if (secondHasFaction && firstHasSubculture) {
    return 1;
  }

  return 0;
};

const SkillsView = memo(() => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);

  const [isShowingHiddentSkills, setIsShowingHiddenSkills] = useState(true);
  const [isShowingHiddenModifiersInsideSkills, setIsShowingHiddenModifiersInsideSkills] = useState(true);
  const [isCheckingSkillRequirements, setIsCheckingSkillRequirements] = useState(true);
  const [factionFilter, setFactionFilter] = useState<string>("all");
  const [isEditMode, setIsEditMode] = useState(false);
  let effectiveNodeHeight = isEditMode ? editModeNodeHeight : nodeHeight;
  const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState(false);
  const [placeholderRow, setPlaceholderRow] = useState<number | undefined>(undefined);
  const [placeholderCol, setPlaceholderCol] = useState<number | undefined>(undefined);
  const [editGroups, setEditGroups] = useState<Record<string, string>>({});
  const [nextGroupId, setNextGroupId] = useState(1);
  const [editingNodeId, setEditingNodeId] = useState<string | undefined>(undefined);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [isRequirementsMode, setIsRequirementsMode] = useState(false);
  const savedEditEdges = useRef<Edge[]>([]);
  const [isSkillLocksMode, setIsSkillLocksMode] = useState(false);
  const savedLocksEdges = useRef<Edge[]>([]);
  const [lockEdgeLevels, setLockEdgeLevels] = useState<Record<string, number>>({});
  const localNodeToSkillLocks = useRef<Record<string, [string, number][]> | null>(null);

  const groupIdToColor = useMemo(() => {
    const uniqueGroups = [...new Set(Object.values(editGroups))];
    const map: Record<string, string> = {};
    uniqueGroups.forEach((gid, i) => {
      map[gid] = GROUP_COLORS[i % GROUP_COLORS.length];
    });
    return map;
  }, [editGroups]);

  const currentRank = useAppSelector((state) => state.app.currentRank);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);

  const skillsData = useAppSelector((state) => state.app.skillsData);
  if (!skillsData) {
    console.log("skillsData missing!");
    return <></>;
  }
  let skills = skillsData.currentSkills;
  const subtype = skillsData.currentSubtype;

  // return <></>;
  if (!skills) {
    console.log("SkillsView: no skills");
    return <></>;
  }

  // Compute unique faction/subculture filter options
  const factionFilterOptions: { label: string; value: string }[] = [];
  const seenCombos = new Set<string>();
  for (const skill of skills) {
    const hasFaction = skill.faction && skill.faction !== "";
    const hasSubculture = skill.subculture && skill.subculture !== "";
    if (!hasFaction && !hasSubculture) continue;

    const comboKey = `${skill.faction || ""}|||${skill.subculture || ""}`;
    if (seenCombos.has(comboKey)) continue;
    seenCombos.add(comboKey);

    const parts: string[] = [];
    if (hasFaction) parts.push(skill.faction!);
    if (hasSubculture) parts.push(skill.subculture!);
    factionFilterOptions.push({ label: parts.join(" / "), value: comboKey });
  }
  factionFilterOptions.sort((a, b) => collator.compare(a.label, b.label));
  const hasFactionVariants = factionFilterOptions.length > 0;

  // Apply faction/subculture filter
  if (factionFilter !== "all" && hasFactionVariants) {
    skills = skills.filter((skill) => {
      const hasFaction = skill.faction && skill.faction !== "";
      const hasSubculture = skill.subculture && skill.subculture !== "";
      if (!hasFaction && !hasSubculture) return true; // base skills always shown
      const comboKey = `${skill.faction || ""}|||${skill.subculture || ""}`;
      return comboKey === factionFilter;
    });
  }

  if (!isShowingHiddentSkills) {
    skills = skills.filter((skill) => !skill.isHiddentInUI);
  }

  // Clean up group assignments: skills that end up alone in their group after filtering
  // should not be displayed as grouped
  const groupCounts: Record<string, number> = {};
  for (const skill of skills) {
    if (skill.group) {
      groupCounts[skill.group] = (groupCounts[skill.group] || 0) + 1;
    }
  }
  skills = skills.map((skill) => {
    if (skill.group && (groupCounts[skill.group] || 0) < 2) {
      return { ...skill, group: undefined };
    }
    return skill;
  });

  let nodeSizeDelta = 0;
  let usingBiggerNodeHeight = false;
  // if we need to overlay nodes make the y gap between them bigger
  if (
    skills.some((skillFirst) =>
      skills.some(
        (skillSecond) =>
          skillFirst != skillSecond &&
          skillFirst.origIndent == skillSecond.origIndent &&
          skillFirst.origTier == skillSecond.origTier,
      ),
    )
  ) {
    effectiveNodeHeight = biggerNodeHeight;
    nodeSizeDelta = 20;
    usingBiggerNodeHeight = true;
  }
  console.log("usingBiggerNodeHeight:", usingBiggerNodeHeight);

  // console.log("with group:", skills.filter((skill) => skill.group).length);
  const groupedSkills = groupBy(
    skills.filter((skill) => skill.group),
    (skill) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return skill.group!;
    },
  );

  for (const skillsInGroup of Object.values(groupedSkills)) {
    skillsInGroup.sort((firstSkill, secondSkill) => firstSkill.y - secondSkill.y);
  }

  const skillNodes: (Node<SkillData, "default"> | Node<SkillData, "skill">)[] = [];

  if (!isEditMode) {
    for (const [group, skills] of Object.entries(groupedSkills)) {
      let lowest = skills[0],
        highest = skills[0];
      for (let i = 1; i < skills.length - 1; i++) {
        if (skills[i].y < lowest.y) lowest = skills[i];
        if (skills[i].y > highest.y) highest = skills[i];
      }
      console.log(
        "group",
        group,
        "size",
        skills.length,
        "skills:",
        skills.map((skill) => skill.id),
      );
      skillNodes.push({
        id: `${group}_group`,
        data: {
          label: group,
          id: group,
          isAbilityIcon: false,
          imgPath: "",
          nodeId: `${group}_group`,
          skillBackground,
          skillIconBackground,
          skillLevelImg,
          tooltipFrame,
          skillLevelLitIcon,
          skillIcon,
          row: lowest.x,
          isGrouping: true,
          numLevels: 1,
          description: "",
          effects: [],
          origIndent: "",
          origTier: "",
          isHiddentInUI: false,
          isCheckingSkillRequirements,
          unlockRank: 0,
        },
        position: {
          y: lowest.x * effectiveNodeHeight - (usingBiggerNodeHeight ? 15 + nodeSizeDelta / 2 : 15),
          x: lowest.y * nodeWidth - 10,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        parentId: undefined,
        type: "default",
        style: {
          backgroundColor: "transparent",
          border: "2px solid rgb(42,11,13)",
          boxShadow: "inset 0px 0px 20px 20px rgba(0,0,0,0.5),inset 0px 0px 10px 10px rgba(42,11,13,0.5)",
          zIndex: "0",
        },
        className: "reactFlowGroup",
        width: skills.length * nodeWidth - 15,
        height: effectiveNodeHeight - 10,
      });
    }
  }

  // Edit mode: create group containers from editGroups
  const editGroupMembers: Record<string, Skill[]> = {};
  if (isEditMode) {
    for (const [nodeId, groupId] of Object.entries(editGroups)) {
      if (!editGroupMembers[groupId]) editGroupMembers[groupId] = [];
      const skill = skills.find((s) => s.nodeId === nodeId);
      if (skill) editGroupMembers[groupId].push(skill);
    }
    for (const members of Object.values(editGroupMembers)) {
      members.sort((a, b) => a.y - b.y);
    }
    for (const [groupId, members] of Object.entries(editGroupMembers)) {
      if (members.length < 2) continue;
      const lowest = members[0];
      const groupColor = groupIdToColor[groupId];
      skillNodes.push({
        id: `${groupId}_group`,
        data: {
          label: groupId,
          id: groupId,
          isAbilityIcon: false,
          imgPath: "",
          nodeId: `${groupId}_group`,
          skillBackground,
          skillIconBackground,
          skillLevelImg,
          tooltipFrame,
          skillLevelLitIcon,
          skillIcon,
          row: lowest.x,
          isGrouping: true,
          numLevels: 1,
          description: "",
          effects: [],
          origIndent: "",
          origTier: "",
          isHiddentInUI: false,
          isCheckingSkillRequirements,
          unlockRank: 0,
        },
        position: {
          y: lowest.x * effectiveNodeHeight - 15,
          x: lowest.y * nodeWidth - 10,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        parentId: undefined,
        type: "default",
        style: {
          backgroundColor: "transparent",
          border: `2px solid ${groupColor || "rgb(42,11,13)"}`,
          boxShadow: "inset 0px 0px 20px 20px rgba(0,0,0,0.5),inset 0px 0px 10px 10px rgba(42,11,13,0.5)",
          zIndex: "0",
        },
        className: "reactFlowGroup",
        width: members.length * nodeWidth - 15,
        height: effectiveNodeHeight - 10,
      });
    }
  }

  // console.log("grouped skills:", JSON.stringify(groupedSkills));

  // DEBUG
  for (const group of Object.keys(groupedSkills)) {
    console.log("GROUP:", group);

    const skills = groupedSkills[group];
    for (const skill of skills) {
      console.log("SKILL:", skill.id, skill.origTier, skill.origIndent);
    }
    console.log("DONE WITH GROUP");
  }

  skills.forEach((skill, i) => {
    // console.log("skill:", skill);

    const sameCoordinatesSkills = skills.filter(
      (iterSkill) => iterSkill.origIndent == skill.origIndent && iterSkill.origTier == skill.origTier,
    );
    sameCoordinatesSkills.sort(sortSameCoordinateSkills);

    const indexInSameCoords = sameCoordinatesSkills.indexOf(skill);

    let position: { x: number; y: number };
    if (isEditMode) {
      const editGroupId = editGroups[skill.nodeId];
      if (editGroupId && editGroupMembers[editGroupId]?.length >= 2) {
        const members = editGroupMembers[editGroupId];
        const indexInGroup = members.findIndex((s) => s.nodeId === skill.nodeId);
        position = { x: indexInGroup * nodeWidth + 10, y: 15 };
      } else {
        position = { x: skill.y * nodeWidth, y: skill.x * effectiveNodeHeight };
      }
    } else {
      position = {
        y: skill.x * effectiveNodeHeight + indexInSameCoords * 40,
        x: skill.y * nodeWidth + indexInSameCoords * 25,
      };
      if (skill.group) {
        const skillsInGroup = groupedSkills[skill.group];
        if (skillsInGroup && skillsInGroup.length > 1) {
          const index = skillsInGroup.indexOf(skill);
          if (index > -1) {
            position = {
              y: (usingBiggerNodeHeight ? 10 + nodeSizeDelta / 2 : 15) + indexInSameCoords * 40,
              x: index * nodeWidth + 10 + indexInSameCoords * 25,
            };
          }
        }
      }
    }

    const abilityIcon = `ui\\battle ui\\ability_icons\\${skill.img}`;
    const skillIcon = `ui\\campaign ui\\skills\\${skill.img}`;
    let skillIconBuffer = skillsData.icons[skillIcon];

    let isAbilityIcon = false;
    if (!skillIconBuffer) {
      skillIconBuffer = skillsData.icons[abilityIcon];
      isAbilityIcon = true;
    }

    const node: Node<SkillData, "skill"> = {
      id: `${skill.nodeId}`,
      data: {
        id: skill.id,
        label: skill.localizedTitle || skill.id,
        skillBackground,
        skillIconBackground,
        skillIcon: skillIconBuffer || skill.img,
        tooltipFrame,
        skillLevelLitIcon,
        row: skill.x,
        nodeId: skill.nodeId,
        imgPath: skill.img,
        isGrouping: false,
        numLevels: skill.maxLevel,
        skillLevelImg,
        description: skill.localizedDescription || "",
        isAbilityIcon,
        origIndent: skill.origIndent,
        origTier: skill.origTier,
        effects: skill.effects.map((effect) => {
          let iconData = "";
          if (effect.icon) {
            iconData = skillsData.icons[`ui\\campaign ui\\effect_bundles\\${effect.icon}`];
          }
          return { ...effect, iconData };
        }),
        isHiddentInUI: skill.isHiddentInUI,
        faction: skill.faction,
        subculture: skill.subculture,
        isCheckingSkillRequirements,
        unlockRank: skill.unlockRank + 1,
        isEditMode,
        editGroupColor: isEditMode ? groupIdToColor[editGroups[skill.nodeId]] : undefined,
      } as SkillData,
      position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      parentId: (() => {
        if (isEditMode) {
          const gid = editGroups[skill.nodeId];
          return gid && editGroupMembers[gid]?.length >= 2 ? `${gid}_group` : undefined;
        }
        return skill.group ? `${skill.group}_group` : undefined;
      })(),
      type: "skill",
      style: { zIndex: "1" },
    };

    if (!isShowingHiddenModifiersInsideSkills) {
      node.data.effects = node.data.effects.filter((effect) => effect.priority != "0");
    }
    skillNodes.push(node);
  });

  // Generate "+" placeholder nodes at end of each row in edit mode
  if (isEditMode) {
    for (let r = 0; r < 7; r++) {
      const skillsInRow = skills.filter((s) => s.x === r);
      const maxColInRow = skillsInRow.length > 0 ? Math.max(...skillsInRow.map((s) => s.y)) + 1 : 0;
      skillNodes.push({
        id: `add_placeholder_r${r}`,
        data: { row: r, column: maxColInRow } as any,
        position: { x: maxColInRow * nodeWidth, y: r * effectiveNodeHeight },
        type: "addPlaceholder",
        selectable: false,
        draggable: false,
        connectable: false,
      } as any);
    }
  }

  // console.log("skillNodes:", skillNodes);

  if (!isEditMode) {
    const skillNodesByRow = groupBy(
      skillNodes.filter((node) => !node.parentId), // without sub-nodes, only groups or stand-alone nodes
      (node) => node.data.row.toString(),
    );
    for (const row of Object.keys(skillNodesByRow)) {
      const skillNodesRow = skillNodesByRow[row];

      skillNodesRow.sort((firstNode, secondNode) => firstNode.position.x - secondNode.position.x);
      let delta = 0;
      console.log("row:", row);
      for (let i = 1; i < skillNodesRow.length; i++) {
        const node = skillNodesRow[i];
        const nodePrev = skillNodesRow[i - 1];
        console.log("current node:", node.data.label);
        if (node.position.x != nodePrev.position.x) {
          if (node.data.isGrouping) {
            delta += 50;
          }
          if (!node.data.isGrouping && nodePrev.data.isGrouping) {
            delta += 50;
          }
        } else {
          node.position.y = nodePrev.position.y + 20;
        }
        node.position.x += delta;
        if (!node.parentId) {
          // console.log("+");
        }
      }
    }
  }

  console.log("LINKED SKILLS:-----------------------");
  for (const skill of skills) {
    if (skill.linkedToNode) {
      console.log("SKILL:", skill.id, skill.x, skill.y, skill.linkedToNode);
    }
  }
  console.log("LINKED SKILLS DONE-------------------------");

  const initialEdges: {
    id: string;
    source: string;
    target: string;
    type: string;
    animated: boolean;
  }[] = [];
  skills
    .filter((skill) => skill.linkedToNode)
    .forEach((skillWithLink) => {
      const linkedNode = skillWithLink.linkedToNode;
      console.log("for", skillWithLink.nodeId, "searching for node", linkedNode);
      if (linkedNode) {
        const linkedSkillNode = skillNodes.find((skillNode) => skillNode.data.nodeId == `${linkedNode}`);
        const sourceSkillNode = skillNodes.find(
          (skillNode) => skillNode.data.nodeId == `${skillWithLink.nodeId}`,
        );
        // console.log("linkedSkillNode:", !!linkedSkillNode);
        // console.log("sourceSkillNode:", !!sourceSkillNode);
        if (linkedSkillNode && sourceSkillNode) {
          initialEdges.push({
            id: `e${skillWithLink.nodeId}2${linkedNode}`,
            source: isEditMode ? `${skillWithLink.nodeId}` : (sourceSkillNode.parentId || `${skillWithLink.nodeId}`),
            target: isEditMode ? `${linkedNode}` : (linkedSkillNode.parentId || `${linkedNode}`),
            type: edgeType,
            animated: false,
            ...(isEditMode
              ? { interactionWidth: 20, style: { stroke: "#ef4444", strokeWidth: 2 } }
              : { style: { opacity: 0 } }),
          });
        }
      }
    });

  // console.log(skills.map((skill) => [skill.x, skill.y]));
  // console.log(skillNodes);

  // console.log("initialEdges:", initialEdges);

  console.log("nodeSizeDelta:", nodeSizeDelta);

  const [nodes, setNodes, onNodesChange] = useNodesState(deepClone(skillNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<(typeof initialEdges)[0]>(deepClone(initialEdges));

  // Compute arrow positions from current edges and nodes state
  const arrows = edges
    .map((edge) => {
      const sourceNode =
        nodes.find((n) => n.id === edge.source) || nodes.find((n) => (n.data as any)?.id === edge.source);
      const targetNode =
        nodes.find((n) => n.id === edge.target) || nodes.find((n) => (n.data as any)?.id === edge.target);
      if (!sourceNode || !targetNode) return;
      let x = Math.max(sourceNode.position.x, targetNode.position.x) - 70;
      if ((targetNode.data as any)?.isGrouping) x -= 20;
      const y =
        sourceNode.position.y + ((sourceNode.data as any)?.isGrouping ? 40 + nodeSizeDelta / 2 : 27.5);
      return { x, y };
    })
    .filter((arrow): arrow is { x: number; y: number } => arrow != undefined);

  // Edit mode: connect nodes (translate to group container if applicable)
  const onConnect = useCallback(
    (connection: Connection) => {
      if (isSkillLocksMode) {
        const edgeId = `lock-${connection.source}-${connection.target}`;
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              id: edgeId,
              type: "skillLock",
              animated: false,
              style: { stroke: "#dc2626", strokeWidth: 2 },
              data: { curveBelow: false, level: 1 },
            },
            eds,
          ),
        );
        setLockEdgeLevels((prev) => ({ ...prev, [edgeId]: 1 }));
        return;
      }
      if (isRequirementsMode) {
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              id: `req-${connection.source}-${connection.target}`,
              type: "requirement",
              zIndex: 10,
              style: { stroke: "#f59e0b", strokeWidth: 2 },
              data: { curveBelow: true },
            },
            eds,
          ),
        );
        return;
      }
      const source = connection.source;
      const target = connection.target;
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            source,
            target,
            id: `e${source}-${target}`,
            type: edgeType,
            animated: false,
          },
          eds,
        ),
      );
    },
    [setEdges, nodes, isRequirementsMode, isSkillLocksMode, setLockEdgeLevels],
  );

  // Edit mode: handle node deletion (also clean up connected edges)
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      setEdges((eds) => eds.filter((e) => !deleted.some((n) => n.id === e.source || n.id === e.target)));
    },
    [setEdges],
  );

  // Edit mode: click an edge to remove it
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      if (isSkillLocksMode) {
        if (event.button === 2) {
          // Right-click: delete
          setEdges((eds) => eds.filter((e) => e.id !== edge.id));
          setLockEdgeLevels((prev) => {
            const next = { ...prev };
            delete next[edge.id];
            return next;
          });
        } else {
          // Left-click: edit level
          const currentLevel = lockEdgeLevels[edge.id] || 1;
          const newLevelStr = prompt(
            `Enter required level (current: ${currentLevel}):`,
            currentLevel.toString(),
          );
          if (newLevelStr === null) return;
          const newLevel = parseInt(newLevelStr, 10);
          if (isNaN(newLevel) || newLevel < 1) {
            alert("Level must be positive integer");
            return;
          }
          setLockEdgeLevels((prev) => ({ ...prev, [edge.id]: newLevel }));
          setEdges((eds) =>
            eds.map((e) => (e.id === edge.id ? { ...e, data: { ...e.data, level: newLevel } } : e)),
          );
        }
        return;
      }
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [setEdges, isSkillLocksMode, lockEdgeLevels, setLockEdgeLevels],
  );

  // Edit mode: capture position before drag starts (for swap)
  const onNodeDragStart: OnNodeDrag = useCallback((event, node) => {
    dragStartPos.current = { x: node.position.x, y: node.position.y };
  }, []);

  // Edit mode: snap node to grid after drag
  // - If dropped on another node: insert before it (or after if Shift held)
  // - If target is in a group, dragged node joins that group
  // - Placeholder repositions to stay past the rightmost skill
  const onNodeDragStop: OnNodeDrag = useCallback(
    (event, node) => {
      const shiftHeld = event.shiftKey;
      const draggedGroupId = editGroups[node.data.nodeId];

      // Compute absolute snapped position (grouped nodes have relative positions)
      let absX: number, absY: number;
      if (node.parentId) {
        const parent = nodes.find((p) => p.id === node.parentId);
        absX = (parent?.position.x ?? 0) + node.position.x;
        absY = (parent?.position.y ?? 0) + node.position.y;
      } else {
        absX = node.position.x;
        absY = node.position.y;
      }
      const snappedX = Math.round(absX / nodeWidth) * nodeWidth;
      const snappedY = Math.round(absY / effectiveNodeHeight) * effectiveNodeHeight;
      const origPos = dragStartPos.current;
      dragStartPos.current = null;

      // Find a normal skill node at the snapped position (ignore group containers)
      const targetNode = nodes.find((n) => {
        if (n.id === node.id || n.type !== "skill" || (n.data as any)?.isGrouping) return false;
        let nAbsX: number, nAbsY: number;
        if (n.parentId) {
          const parent = nodes.find((p) => p.id === n.parentId);
          nAbsX = (parent?.position.x ?? 0) + n.position.x;
          nAbsY = (parent?.position.y ?? 0) + n.position.y;
        } else {
          nAbsX = n.position.x;
          nAbsY = n.position.y;
        }
        return (
          Math.round(nAbsX / nodeWidth) * nodeWidth === snappedX &&
          Math.round(nAbsY / effectiveNodeHeight) * effectiveNodeHeight === snappedY
        );
      });

      // If target is in a group, move dragged node to that group
      if (targetNode) {
        const targetGroupId = editGroups[targetNode.data.nodeId];
        // Same group: swap positions within the group
        if (targetGroupId && targetGroupId === draggedGroupId) {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === node.id) return { ...n, position: { ...targetNode.position } };
              if (n.id === targetNode.id) return { ...n, position: { ...(origPos ?? node.position) } };
              return n;
            }),
          );
          return;
        }
        if (targetGroupId && targetGroupId !== draggedGroupId) {
          setEditGroups((prev) => ({ ...prev, [node.data.nodeId]: targetGroupId }));
          return;
        }
      }

      // If dragged node was in a group but dropped outside it (no target in same group), ungroup it
      if (draggedGroupId) {
        // Place it as standalone at the snapped absolute position
        setEditGroups((prev) => {
          const next = { ...prev };
          delete next[node.data.nodeId];
          return next;
        });
        // Also update its position to absolute coords since it's leaving the group
        setNodes((nds) =>
          nds.map((n) =>
            n.id === node.id ? { ...n, parentId: undefined, position: { x: snappedX, y: snappedY } } : n,
          ),
        );
        return;
      }

      setNodes((nds) => {
        let result: typeof nds;
        if (targetNode && origPos) {
          const targetCol = Math.round(snappedX / nodeWidth);
          const targetRow = Math.round(snappedY / effectiveNodeHeight);
          // Collect all skill nodes in this row (non-grouped), sorted by column
          const rowSkills = nds
            .filter(
              (n) =>
                n.type === "skill" &&
                !n.parentId &&
                Math.round(n.position.y / effectiveNodeHeight) === targetRow &&
                n.id !== node.id,
            )
            .sort((a, b) => a.position.x - b.position.x);

          const targetIdx = rowSkills.findIndex((n) => n.id === targetNode.id);
          // Insert before target (default) or after target (shift)
          const insertIdx = shiftHeld ? targetIdx + 1 : targetIdx;
          // Build new column order: insert dragged node at insertIdx
          const reordered = [...rowSkills];
          reordered.splice(insertIdx, 0, nds.find((n) => n.id === node.id)!);

          // Assign sequential column positions
          const posMap = new Map<string, number>();
          reordered.forEach((n, i) => posMap.set(n.id, i));

          result = nds.map((n) => {
            if (posMap.has(n.id)) {
              const col = posMap.get(n.id)!;
              return { ...n, position: { x: col * nodeWidth, y: targetRow * effectiveNodeHeight } };
            }
            return n;
          });
        } else {
          // No overlap, just snap
          result = nds.map((n) => (n.id === node.id ? { ...n, position: { x: snappedX, y: snappedY } } : n));
        }

        // Reposition placeholder for affected rows so it stays past the rightmost skill
        const affectedRows = new Set<number>();
        affectedRows.add(Math.round(snappedY / effectiveNodeHeight));
        if (origPos) affectedRows.add(Math.round(origPos.y / effectiveNodeHeight));
        for (const row of affectedRows) {
          const placeholderId = `add_placeholder_r${row}`;
          const maxCol = result
            .filter(
              (n) =>
                n.type === "skill" && !n.parentId && Math.round(n.position.y / effectiveNodeHeight) === row,
            )
            .reduce((max, n) => Math.max(max, Math.round(n.position.x / nodeWidth)), -1);
          const newCol = maxCol + 1;
          result = result.map((n) =>
            n.id === placeholderId
              ? {
                  ...n,
                  data: { ...n.data, column: newCol },
                  position: { x: newCol * nodeWidth, y: row * effectiveNodeHeight },
                }
              : n,
          );
        }

        return result;
      });
    },
    [setNodes, nodes, editGroups, setEditGroups],
  );

  // Edit mode: handle clicking placeholder nodes to add skills
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "addPlaceholder" && isEditMode) {
        setPlaceholderRow(node.data.row as number);
        setPlaceholderCol(node.data.column as number);
        setIsAddNodeModalOpen(true);
      }
    },
    [isEditMode],
  );

  // Edit mode: double-click to edit an existing node
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!isEditMode || node.type !== "skill") return;
      setEditingNodeId(node.id);
      setPlaceholderRow(undefined);
      setPlaceholderCol(undefined);
      setIsAddNodeModalOpen(true);
    },
    [isEditMode],
  );

  // Edit mode: right-click context menu on a skill node
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if ((!isEditMode && !isRequirementsMode) || node.type !== "skill") return;
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [isEditMode, isRequirementsMode],
  );

  // Close context menu on pane click
  const onPaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Context menu: insert selected nodes before/after target, optionally joining target's group
  const contextMenuInsert = useCallback(
    (position: "before" | "after", addToGroup: boolean) => {
      if (!contextMenu) return;
      const targetNode = nodes.find((n) => n.id === contextMenu.nodeId);
      const selectedNodes = nodes.filter(
        (n) => n.selected && n.type === "skill" && n.id !== contextMenu.nodeId,
      );
      if (selectedNodes.length === 0 || !targetNode) {
        setContextMenu(null);
        return;
      }

      // Sort selected by their current absolute x position for consistent ordering
      const sortedSelected = [...selectedNodes].sort((a, b) => {
        const aAbsX = a.parentId
          ? (nodes.find((p) => p.id === a.parentId)?.position.x ?? 0) + a.position.x
          : a.position.x;
        const bAbsX = b.parentId
          ? (nodes.find((p) => p.id === b.parentId)?.position.x ?? 0) + b.position.x
          : b.position.x;
        return aAbsX - bAbsX;
      });
      const N = sortedSelected.length;
      const selectedIds = new Set(sortedSelected.map((n) => n.id));

      // Compute target absolute position
      let targetAbsX: number, targetAbsY: number;
      if (targetNode.parentId) {
        const parent = nodes.find((p) => p.id === targetNode.parentId);
        targetAbsX = (parent?.position.x ?? 0) + targetNode.position.x;
        targetAbsY = (parent?.position.y ?? 0) + targetNode.position.y;
      } else {
        targetAbsX = targetNode.position.x;
        targetAbsY = targetNode.position.y;
      }
      const targetRow = Math.round(targetAbsY / effectiveNodeHeight);
      const targetGroupId = editGroups[targetNode.data.nodeId];

      if (addToGroup && targetGroupId) {
        // Place selected nodes near target with offsets so sort order is correct in the editGroups useEffect
        setNodes((nds) =>
          nds.map((n) => {
            const idx = sortedSelected.findIndex((s) => s.id === n.id);
            if (idx === -1) return n;
            const offsetX = position === "before" ? targetAbsX - N + idx : targetAbsX + 1 + idx;
            return {
              ...n,
              parentId: undefined,
              position: { x: offsetX, y: targetRow * effectiveNodeHeight },
            };
          }),
        );
        setEditGroups((prev) => {
          const next = { ...prev };
          for (const sn of sortedSelected) {
            next[sn.data.nodeId] = targetGroupId;
          }
          return next;
        });
      } else {
        // Remove all selected from any groups
        const hasGrouped = sortedSelected.some((n) => editGroups[n.data.nodeId]);
        if (hasGrouped) {
          setEditGroups((prev) => {
            const next = { ...prev };
            for (const sn of sortedSelected) {
              delete next[sn.data.nodeId];
            }
            return next;
          });
        }

        setNodes((nds) => {
          // Collect source rows from all selected nodes for placeholder fixup
          const sourceRows = new Set<number>();
          for (const sn of sortedSelected) {
            const snCurrent = nds.find((n) => n.id === sn.id);
            if (!snCurrent) continue;
            let selAbsY: number;
            if (snCurrent.parentId) {
              const parent = nds.find((p) => p.id === snCurrent.parentId);
              selAbsY = (parent?.position.y ?? 0) + snCurrent.position.y;
            } else {
              selAbsY = snCurrent.position.y;
            }
            sourceRows.add(Math.round(selAbsY / effectiveNodeHeight));
          }

          const targetCol = Math.round(targetAbsX / nodeWidth);

          // Standalone skill nodes in target row (excluding all selected nodes being moved)
          const rowNodes = nds.filter((n) => {
            if (n.type !== "skill" || selectedIds.has(n.id) || (n.data as any)?.isGrouping) return false;
            if (n.parentId) return false;
            return Math.round(n.position.y / effectiveNodeHeight) === targetRow;
          });
          const occupiedCols = new Set(rowNodes.map((n) => Math.round(n.position.x / nodeWidth)));

          let insertStartCol: number;
          const shiftIds = new Set<string>();

          if (position === "before") {
            // Check if N spots before target are all empty
            const spotsNeeded = Array.from({ length: N }, (_, i) => targetCol - N + i);
            const allEmpty = spotsNeeded.every((c) => c >= 0 && !occupiedCols.has(c));
            if (allEmpty) {
              insertStartCol = targetCol - N;
            } else {
              // Shift target and everything to its right by N to make room
              insertStartCol = targetCol;
              for (const n of rowNodes) {
                const col = Math.round(n.position.x / nodeWidth);
                if (col >= targetCol) shiftIds.add(n.id);
              }
            }
          } else {
            const spotsNeeded = Array.from({ length: N }, (_, i) => targetCol + 1 + i);
            const allEmpty = spotsNeeded.every((c) => !occupiedCols.has(c));
            if (allEmpty) {
              insertStartCol = targetCol + 1;
            } else {
              // Shift everything to the right of target by N to make room
              insertStartCol = targetCol + 1;
              for (const n of rowNodes) {
                const col = Math.round(n.position.x / nodeWidth);
                if (col > targetCol) shiftIds.add(n.id);
              }
            }
          }

          // Map each selected node to its target column
          const selectedColMap = new Map<string, number>();
          sortedSelected.forEach((n, i) => selectedColMap.set(n.id, insertStartCol + i));

          let result = nds.map((n) => {
            if (selectedColMap.has(n.id)) {
              const col = selectedColMap.get(n.id)!;
              return {
                ...n,
                parentId: undefined,
                position: { x: col * nodeWidth, y: targetRow * effectiveNodeHeight },
              };
            }
            if (shiftIds.has(n.id)) {
              const currentCol = Math.round(n.position.x / nodeWidth);
              return { ...n, position: { x: (currentCol + N) * nodeWidth, y: n.position.y } };
            }
            return n;
          });

          // Reposition placeholders for affected rows
          const affectedRows = new Set<number>(sourceRows);
          affectedRows.add(targetRow);
          for (const row of affectedRows) {
            const placeholderId = `add_placeholder_r${row}`;
            const maxCol = result
              .filter(
                (n) =>
                  n.type === "skill" && !n.parentId && Math.round(n.position.y / effectiveNodeHeight) === row,
              )
              .reduce((max, n) => Math.max(max, Math.round(n.position.x / nodeWidth)), -1);
            const newCol = maxCol + 1;
            result = result.map((n) =>
              n.id === placeholderId
                ? {
                    ...n,
                    data: { ...n.data, column: newCol },
                    position: { x: newCol * nodeWidth, y: row * effectiveNodeHeight },
                  }
                : n,
            );
          }

          return result;
        });
      }

      setContextMenu(null);
    },
    [contextMenu, nodes, editGroups, setEditGroups, setNodes],
  );

  // Context menu: delete nodes
  const contextMenuDelete = useCallback(() => {
    if (!contextMenu) return;
    const selectedNodes = nodes.filter((n) => n.selected && n.type === "skill");
    const rightClicked = nodes.find((n) => n.id === contextMenu.nodeId);
    // If right-clicked node is among selection, delete all selected; otherwise just delete right-clicked
    const toDelete =
      selectedNodes.length > 0 && selectedNodes.some((n) => n.id === contextMenu.nodeId)
        ? selectedNodes
        : rightClicked
          ? [rightClicked]
          : [];
    if (toDelete.length === 0) {
      setContextMenu(null);
      return;
    }

    const deleteIds = new Set(toDelete.map((n) => n.id));

    // Remove from editGroups
    setEditGroups((prev) => {
      const next = { ...prev };
      for (const n of toDelete) delete next[n.data.nodeId];
      return next;
    });
    // Remove connected edges
    setEdges((eds) => eds.filter((e) => !deleteIds.has(e.source) && !deleteIds.has(e.target)));
    // Remove nodes
    setNodes((nds) => nds.filter((n) => !deleteIds.has(n.id)));
    setContextMenu(null);
  }, [contextMenu, nodes, setNodes, setEdges, setEditGroups]);

  // Context menu: group nodes (right-clicked + selected, all must be ungrouped)
  const contextMenuGroup = useCallback(() => {
    if (!contextMenu) return;
    const rightClicked = nodes.find((n) => n.id === contextMenu.nodeId);
    const selected = nodes.filter((n) => n.selected && n.type === "skill");

    // Combine right-clicked + selected, deduplicate
    const toGroupMap = new Map<string, (typeof nodes)[0]>();
    if (rightClicked) toGroupMap.set(rightClicked.id, rightClicked);
    for (const n of selected) toGroupMap.set(n.id, n);
    const toGroup = Array.from(toGroupMap.values());

    if (toGroup.length < 2) {
      setContextMenu(null);
      return;
    }

    const groupId = `editGroup_${nextGroupId}`;
    setNextGroupId((id) => id + 1);
    setEditGroups((prev) => {
      const next = { ...prev };
      for (const node of toGroup) {
        next[node.data.nodeId] = groupId;
      }
      return next;
    });
    setContextMenu(null);
  }, [contextMenu, nodes, nextGroupId, setEditGroups]);

  // Context menu: remove all input connections (edges targeting this node)
  const contextMenuRemoveInputs = useCallback(() => {
    if (!contextMenu) return;
    const targetNodeId = contextMenu.nodeId;
    setEdges((eds) => eds.filter((e) => e.target !== targetNodeId));
    setContextMenu(null);
  }, [contextMenu, setEdges]);

  // Context menu: remove all output connections (edges from this node)
  const contextMenuRemoveOutputs = useCallback(() => {
    if (!contextMenu) return;
    const targetNodeId = contextMenu.nodeId;
    setEdges((eds) => eds.filter((e) => e.source !== targetNodeId));
    setContextMenu(null);
  }, [contextMenu, setEdges]);

  // Edit mode: group selected nodes
  const onGroupSelected = useCallback(() => {
    const selected = nodes.filter((n) => n.selected && n.type === "skill");
    if (selected.length < 2) return;
    const groupId = `editGroup_${nextGroupId}`;
    setNextGroupId((id) => id + 1);
    setEditGroups((prev) => {
      const next = { ...prev };
      for (const node of selected) {
        next[node.data.nodeId] = groupId;
      }
      return next;
    });
  }, [nodes, nextGroupId]);

  // Edit mode: ungroup selected nodes
  const onUngroupSelected = useCallback(() => {
    const selected = nodes.filter((n) => n.selected && n.type === "skill");
    if (selected.length === 0) return;
    setEditGroups((prev) => {
      const next = { ...prev };
      for (const node of selected) {
        delete next[node.data.nodeId];
      }
      return next;
    });
  }, [nodes]);

  // Edit mode: add or edit a node from modal
  const onAddOrEditNode = useCallback(
    (nodeData: {
      name: string;
      description: string;
      row: number;
      column: number;
      effects: Effect[];
      maxLevel: number;
      unlockRank: number;
      existingSkillKey?: string;
      imgPath?: string;
    }) => {
      const mapEffects = (effects: Effect[]) =>
        effects.map((effect) => {
          let iconData = "";
          if (effect.icon) {
            iconData = skillsData.icons[`ui\\campaign ui\\effect_bundles\\${effect.icon}`] || "";
          }
          return { ...effect, iconData };
        });

      // Resolve skillIcon from imgPath
      const resolveSkillIcon = (imgPath?: string): string => {
        if (!imgPath) return skillIcon;
        const iconBuffer = skillsData.icons[imgPath];
        if (iconBuffer) return iconBuffer;
        // Try battle ui fallback
        const battlePath = imgPath.replace("ui\\campaign ui\\skills\\", "ui\\battle ui\\ability_icons\\");
        return skillsData.icons[battlePath] || skillIcon;
      };

      if (editingNodeId) {
        // Update existing node
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== editingNodeId) return n;
            return {
              ...n,
              data: {
                ...n.data,
                label: nodeData.name,
                description: nodeData.description,
                numLevels: nodeData.maxLevel,
                unlockRank: nodeData.unlockRank,
                row: nodeData.row,
                effects: mapEffects(nodeData.effects),
                existingSkillKey: nodeData.existingSkillKey,
                imgPath: nodeData.imgPath || n.data.imgPath,
                skillIcon: resolveSkillIcon(nodeData.imgPath || n.data.imgPath),
              },
              position: {
                x: nodeData.column * nodeWidth,
                y: nodeData.row * effectiveNodeHeight,
              },
              parentId: undefined,
            };
          }),
        );
        setEditGroups((prev) => {
          const next = { ...prev };
          delete next[editingNodeId];
          return next;
        });
      } else {
        // Add new node
        const newNodeId = `new_node_${Date.now()}`;
        const newNode: Node<SkillData, "skill"> = {
          id: newNodeId,
          data: {
            id: newNodeId,
            label: nodeData.name,
            skillBackground,
            skillIconBackground,
            skillIcon: resolveSkillIcon(nodeData.imgPath),
            tooltipFrame,
            skillLevelLitIcon,
            row: nodeData.row,
            nodeId: newNodeId,
            imgPath: nodeData.imgPath || "",
            isGrouping: false,
            numLevels: nodeData.maxLevel,
            skillLevelImg,
            description: nodeData.description,
            isAbilityIcon: false,
            origIndent: nodeData.row.toString(),
            origTier: nodeData.column.toString(),
            effects: mapEffects(nodeData.effects),
            isHiddentInUI: false,
            isCheckingSkillRequirements: false,
            unlockRank: nodeData.unlockRank,
            isEditMode: true,
            existingSkillKey: nodeData.existingSkillKey,
          },
          position: {
            x: nodeData.column * nodeWidth,
            y: nodeData.row * effectiveNodeHeight,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          type: "skill",
          style: { zIndex: "1" },
        };

        // Check if there's a node at the target position
        const targetCol = nodeData.column;
        const targetRow = nodeData.row;
        const existingNode = nodes.find((n) => {
          if (n.type !== "skill" || (n.data as any)?.isGrouping) return false;
          let absX: number, absY: number;
          if (n.parentId) {
            const parent = nodes.find((p) => p.id === n.parentId);
            absX = (parent?.position.x ?? 0) + n.position.x;
            absY = (parent?.position.y ?? 0) + n.position.y;
          } else {
            absX = n.position.x;
            absY = n.position.y;
          }
          return (
            Math.round(absX / nodeWidth) === targetCol && Math.round(absY / effectiveNodeHeight) === targetRow
          );
        });

        // If existing node is grouped, add new node to that group
        const existingGroupId = existingNode ? editGroups[existingNode.data.nodeId] : undefined;
        if (existingGroupId) {
          // Place new node just before the existing node so sort order puts it first in the group
          newNode.position = {
            x: existingNode!.position.x - 1,
            y: existingNode!.position.y,
          };
          setEditGroups((prev) => ({ ...prev, [newNodeId]: existingGroupId }));
        }

        setNodes((nds) => {
          let updated = [...nds, newNode];

          // Shift existing node and everything to its right by 1 column (skip if adding to group — useEffect handles it)
          if (existingNode && !existingGroupId) {
            const shiftIds = new Set<string>();
            for (const n of nds) {
              if (n.type !== "skill" || (n.data as any)?.isGrouping || n.parentId) continue;
              const col = Math.round(n.position.x / nodeWidth);
              if (Math.round(n.position.y / effectiveNodeHeight) === targetRow && col >= targetCol) {
                shiftIds.add(n.id);
              }
            }
            updated = updated.map((n) => {
              if (shiftIds.has(n.id)) {
                const col = Math.round(n.position.x / nodeWidth);
                return { ...n, position: { x: (col + 1) * nodeWidth, y: n.position.y } };
              }
              return n;
            });
          }

          // Reposition placeholder
          const placeholderId = `add_placeholder_r${targetRow}`;
          const maxCol = updated
            .filter(
              (n) =>
                n.type === "skill" &&
                !n.parentId &&
                Math.round(n.position.y / effectiveNodeHeight) === targetRow,
            )
            .reduce((max, n) => Math.max(max, Math.round(n.position.x / nodeWidth)), -1);
          const newPlaceholderCol = maxCol + 1;
          return updated.map((n) => {
            if (n.id === placeholderId) {
              return {
                ...n,
                data: { ...n.data, column: newPlaceholderCol },
                position: { x: newPlaceholderCol * nodeWidth, y: targetRow * effectiveNodeHeight },
              };
            }
            return n;
          });
        });
      }
      setIsAddNodeModalOpen(false);
      setEditingNodeId(undefined);
    },
    [editingNodeId, setNodes, setEditGroups, skillsData, nodes, editGroups],
  );

  // Edit mode: export skill tree to JSON
  const onExport = useCallback(() => {
    const exportData = {
      nodes: nodes
        .filter((n) => n.type === "skill")
        .map((n) => ({
          nodeId: n.id,
          skillId: n.data.id,
          tier: Math.round(n.position.y / effectiveNodeHeight),
          indent: Math.round(n.position.x / nodeWidth),
          faction: n.data.faction || "",
          subculture: n.data.subculture || "",
          label: n.data.label,
          description: n.data.description,
          maxLevel: n.data.numLevels,
          unlockRank: n.data.unlockRank,
        })),
      links: edges.map((e) => ({
        parent: e.target,
        child: e.source,
        linkType: "REQUIRED" as const,
      })),
      effects: nodes
        .filter((n) => n.type === "skill")
        .flatMap((n) =>
          n.data.effects.map((effect) => ({
            skillId: n.data.id,
            effectKey: effect.effectKey,
            level: effect.level,
            value: effect.value,
          })),
        ),
      groups: [...new Set(Object.values(editGroups))].map((gid) => ({
        groupId: gid,
        nodeIds: Object.entries(editGroups)
          .filter(([, g]) => g === gid)
          .map(([nid]) => nid),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skill_tree_${subtype}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, subtype]);

  // Edit mode: save skill tree as a .pack file
  const onSavePack = useCallback(async () => {
    const skillNodes = nodes.filter((n) => n.type === "skill");

    // Build edges with linkType based on editGroups membership
    const expandedEdges: { source: string; target: string; linkType: "REQUIRED" | "SUBSET_REQUIRED" }[] = [];
    for (const e of edges) {
      const sourceGroupId = editGroups[e.source];
      if (sourceGroupId) {
        expandedEdges.push({ source: e.source, target: e.target, linkType: "SUBSET_REQUIRED" });
      } else {
        expandedEdges.push({ source: e.source, target: e.target, linkType: "REQUIRED" });
      }
    }

    const payload: SaveSkillsPackPayload = {
      subtype,
      subtypeIndex: skillsData.currentSubtypeIndex,
      nodes: skillNodes.map((n) => {
        // Compute absolute position (handle grouped nodes)
        let absX: number, absY: number;
        if (n.parentId) {
          const parent = nodes.find((p) => p.id === n.parentId);
          absX = (parent?.position.x ?? 0) + n.position.x;
          absY = (parent?.position.y ?? 0) + n.position.y;
        } else {
          absX = n.position.x;
          absY = n.position.y;
        }
        return {
          nodeId: n.id,
          skillId: n.data.id,
          label: n.data.label,
          description: n.data.description,
          row: Math.round(absY / effectiveNodeHeight),
          column: Math.round(absX / nodeWidth),
          maxLevel: n.data.numLevels,
          unlockRank: n.data.unlockRank,
          imgPath: n.data.imgPath || "",
          faction: n.data.faction || "",
          subculture: n.data.subculture || "",
          effects: n.data.effects,
          group: editGroups[n.data.nodeId],
          requiredNumParents: (n.data as any).requiredNumParents || 0,
          existingSkillKey: n.data.existingSkillKey,
        };
      }),
      edges: expandedEdges,
      skillLocks: [],
    };

    // Add skill locks data
    const skillLocksArray: { lockedNodeId: string; lockingSkillKey: string; requiredLevel: number }[] = [];
    const nodeToSkillLocks = localNodeToSkillLocks.current || skillsData.nodeToSkillLocks || {};

    for (const [lockedNodeId, skillAndLevelArray] of Object.entries(nodeToSkillLocks)) {
      for (const [lockingSkillKey, requiredLevel] of skillAndLevelArray) {
        skillLocksArray.push({ lockedNodeId, lockingSkillKey, requiredLevel });
      }
    }

    payload.skillLocks = skillLocksArray;

    const result = await window.api?.saveSkillsPack(payload);
    if (result?.success) {
      console.log("Pack saved:", result.packName);
      alert(`Pack saved: ${result.packName}`);
    } else {
      console.error("Failed to save pack:", result?.error);
      alert(`Failed to save pack: ${result?.error || "Unknown error"}`);
    }
  }, [nodes, edges, subtype, skillsData, editGroups, effectiveNodeHeight]);

  // Requirements mode: expand group edges to individual node-to-node curved edges
  const enterRequirementsMode = useCallback(() => {
    savedEditEdges.current = [...edges];

    // Build group member map: groupId → member nodeIds
    const groupToMembers: Record<string, string[]> = {};
    for (const [nodeId, groupId] of Object.entries(editGroups)) {
      if (!groupToMembers[groupId]) groupToMembers[groupId] = [];
      groupToMembers[groupId].push(nodeId);
    }

    const reqEdges: Edge[] = [];
    const addedEdgeKeys = new Set<string>();
    const processedGroupTargets = new Set<string>();

    const addReqEdge = (source: string, target: string, color: string, curveBelow: boolean) => {
      const key = `${source}->${target}`;
      if (addedEdgeKeys.has(key)) return;
      addedEdgeKeys.add(key);
      reqEdges.push({
        id: `req-${source}-${target}`,
        source,
        target,
        type: "requirement",
        zIndex: 10,
        style: { stroke: color, strokeWidth: 2 },
        data: { curveBelow },
      });
    };

    for (const edge of edges) {
      // Resolve source: grouped node or group container ID
      const sourceGroupId = editGroups[edge.source];
      const srcContainerGroupId = edge.source.endsWith("_group")
        ? Object.keys(groupToMembers).find((gid) => `${gid}_group` === edge.source)
        : undefined;
      const srcGroupId = sourceGroupId || srcContainerGroupId;

      if (srcGroupId && groupToMembers[srcGroupId]) {
        // Source in a group → expand source side (SUBSET_REQUIRED curves above)
        const key = `${srcGroupId}->${edge.target}`;
        if (processedGroupTargets.has(key)) continue;
        processedGroupTargets.add(key);

        const groupColor = groupIdToColor[srcGroupId];
        for (const memberId of groupToMembers[srcGroupId]) {
          addReqEdge(memberId, edge.target, groupColor || "#f59e0b", false);
        }
      } else if (edge.target.endsWith("_group")) {
        // Target is a group container → expand to individual member edges
        const tgtContainerGroupId = Object.keys(groupToMembers).find((gid) => `${gid}_group` === edge.target);
        if (tgtContainerGroupId && groupToMembers[tgtContainerGroupId]) {
          for (const memberId of groupToMembers[tgtContainerGroupId]) {
            addReqEdge(edge.source, memberId, "#f59e0b", true);
          }
        }
      } else {
        // Individual REQUIRED edge (curves below)
        addReqEdge(edge.source, edge.target, "#f59e0b", true);
      }
    }

    setEdges(reqEdges);
    setIsRequirementsMode(true);
  }, [edges, editGroups, groupIdToColor, setEdges]);

  // Requirements mode: convert individual edges back to groups + edit edges
  const exitRequirementsMode = useCallback(() => {
    const targetToSources: Record<string, string[]> = {};
    for (const edge of edges) {
      if (!targetToSources[edge.target]) targetToSources[edge.target] = [];
      if (!targetToSources[edge.target].includes(edge.source)) {
        targetToSources[edge.target].push(edge.source);
      }
    }

    const newEditGroups: Record<string, string> = {};
    const newEdges: Edge[] = [];
    let groupCounter = nextGroupId;

    for (const [target, sources] of Object.entries(targetToSources)) {
      if (sources.length === 1) {
        newEdges.push({
          id: `e${sources[0]}-${target}`,
          source: sources[0],
          target,
          type: edgeType,
          animated: false,
          interactionWidth: 20,
          style: { stroke: "#ef4444", strokeWidth: 2 },
        });
      } else {
        const groupId = `editGroup_${groupCounter++}`;
        for (const src of sources) {
          newEditGroups[src] = groupId;
          newEdges.push({
            id: `e${src}-${target}`,
            source: src,
            target,
            type: edgeType,
            animated: false,
            interactionWidth: 20,
            style: { stroke: "#ef4444", strokeWidth: 2 },
          });
        }
      }
    }

    setNextGroupId(groupCounter);
    setEditGroups(newEditGroups);
    setEdges(newEdges);
    setIsRequirementsMode(false);

    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "skill") return n;
        const sources = targetToSources[n.id];
        const requiredNumParents = sources && sources.length > 1 ? sources.length : 0;
        return { ...n, data: { ...n.data, requiredNumParents } };
      }),
    );
  }, [edges, nextGroupId, setEdges, setNodes, setEditGroups]);

  // Skill Locks mode: enter
  const enterSkillLocksMode = useCallback(() => {
    savedLocksEdges.current = [...edges];
    const nodeToSkillLocks = localNodeToSkillLocks.current || skillsData.nodeToSkillLocks || {};
    const lockEdges: Edge[] = [];
    const edgeLevels: Record<string, number> = {};

    // Convert nodeToSkillLocks[nodeId] = [[skillKey, level]] to edges
    for (const [lockedNodeId, skillAndLevelArray] of Object.entries(nodeToSkillLocks)) {
      const lockedNode = nodes.find((n) => n.data.nodeId === lockedNodeId);
      if (!lockedNode) continue;

      for (const [lockingSkillKey, requiredLevel] of skillAndLevelArray) {
        const lockingNode = nodes.find((n) => n.data.id === lockingSkillKey);
        if (!lockingNode) continue;

        const edgeId = `lock-${lockingNode.id}-${lockedNode.id}`;
        lockEdges.push({
          id: edgeId,
          source: lockingNode.id,
          target: lockedNode.id,
          type: "skillLock",
          animated: false,
          style: { stroke: "#dc2626", strokeWidth: 2 },
          data: { curveBelow: false, level: requiredLevel },
        });
        edgeLevels[edgeId] = requiredLevel;
      }
    }

    setLockEdgeLevels(edgeLevels);
    setEdges(lockEdges);
    setIsSkillLocksMode(true);
  }, [edges, nodes, skillsData, setEdges]);

  // Skill Locks mode: exit
  const exitSkillLocksMode = useCallback(() => {
    const newNodeToSkillLocks: Record<string, [string, number][]> = {};

    for (const edge of edges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode || sourceNode.type !== "skill" || targetNode.type !== "skill") continue;

      const lockingSkillKey = sourceNode.data.id;
      const lockedNodeId = targetNode.data.nodeId;
      const level = lockEdgeLevels[edge.id] || 1;

      if (!newNodeToSkillLocks[lockedNodeId]) newNodeToSkillLocks[lockedNodeId] = [];
      const existing = newNodeToSkillLocks[lockedNodeId].find(
        ([sk, lv]) => sk === lockingSkillKey && lv === level,
      );
      if (!existing) newNodeToSkillLocks[lockedNodeId].push([lockingSkillKey, level]);
    }

    localNodeToSkillLocks.current = newNodeToSkillLocks;
    setEdges(savedLocksEdges.current);
    setIsSkillLocksMode(false);
    setLockEdgeLevels({});
  }, [edges, nodes, lockEdgeLevels, setEdges, skillsData]);

  // Requirements mode: recolor edges so SUBSET_REQUIRED groups share the same color
  const reqEdgeKey = useMemo(() => {
    if (!isRequirementsMode) return "";
    return edges
      .map((e) => `${e.source}-${e.target}`)
      .sort()
      .join("|");
  }, [isRequirementsMode, edges]);

  useEffect(() => {
    if (!isRequirementsMode || !reqEdgeKey) return;

    const targetToSources: Record<string, string[]> = {};
    for (const edge of edges) {
      if (!targetToSources[edge.target]) targetToSources[edge.target] = [];
      targetToSources[edge.target].push(edge.source);
    }

    const targetToColor: Record<string, string> = {};
    let newColorIdx = 0;
    for (const [target, sources] of Object.entries(targetToSources)) {
      if (sources.length <= 1) continue;

      // Check if sources belong to a known edit group — use its color
      const groupIds = new Set(sources.map((s) => editGroups[s]).filter(Boolean));
      if (groupIds.size === 1) {
        const gid = [...groupIds][0];
        if (groupIdToColor[gid]) {
          targetToColor[target] = groupIdToColor[gid];
          continue;
        }
      }

      // Unknown group — assign a new color
      targetToColor[target] = GROUP_COLORS[newColorIdx % GROUP_COLORS.length];
      newColorIdx++;
    }

    // Targets with multiple sources are SUBSET_REQUIRED (curve above),
    // single-source targets are REQUIRED (curve below)
    const subsetTargets = new Set(
      Object.entries(targetToSources)
        .filter(([, sources]) => sources.length > 1)
        .map(([target]) => target),
    );

    let needsUpdate = false;
    const updated = edges.map((e) => {
      const color = targetToColor[e.target] || "#f59e0b";
      const curveBelow = !subsetTargets.has(e.target);
      const colorChanged = (e.style as any)?.stroke !== color;
      const curveChanged = (e.data as any)?.curveBelow !== curveBelow;
      if (!colorChanged && !curveChanged) return e;
      needsUpdate = true;
      return { ...e, style: { ...e.style, stroke: color, strokeWidth: 2 }, data: { ...e.data, curveBelow } };
    });

    if (needsUpdate) setEdges(updated);
  }, [reqEdgeKey, editGroups, groupIdToColor]);

  // Reset faction filter when subtype changes
  useEffect(() => {
    setFactionFilter("all");
    setIsEditMode(false);
  }, [skillsData?.currentSubtype]);

  // Initialize editGroups from existing skill groups when entering edit mode
  useEffect(() => {
    if (isEditMode) {
      const initial: Record<string, string> = {};
      for (const skill of skills) {
        if (skill.group) {
          initial[skill.nodeId] = skill.group;
        }
      }
      setEditGroups(initial);
    }
  }, [isEditMode]);

  // ReactFlow won't refresh when things like isShowingHiddenModifiersInsideSkills change, so force it
  useEffect(() => {
    setNodes(deepClone(skillNodes));
    setEdges(deepClone(initialEdges));
  }, [
    skillsData,
    isShowingHiddenModifiersInsideSkills,
    isShowingHiddentSkills,
    isCheckingSkillRequirements,
    factionFilter,
    isEditMode,
  ]);

  // Recalculate group containers and member positions from current nodes state
  useEffect(() => {
    if (!isEditMode) return;

    setNodes((currentNodes) => {
      // Build group membership from current nodes + editGroups
      const groupMembers: Record<string, typeof currentNodes> = {};
      for (const [nodeId, groupId] of Object.entries(editGroups)) {
        if (!groupMembers[groupId]) groupMembers[groupId] = [];
        const skillNode = currentNodes.find((n) => n.id === nodeId && n.type === "skill");
        if (skillNode) groupMembers[groupId].push(skillNode);
      }

      // Sort members by their current absolute x position (column order)
      for (const members of Object.values(groupMembers)) {
        members.sort((a, b) => {
          const aAbsX = a.parentId
            ? (currentNodes.find((n) => n.id === a.parentId)?.position.x ?? 0) + a.position.x
            : a.position.x;
          const bAbsX = b.parentId
            ? (currentNodes.find((n) => n.id === b.parentId)?.position.x ?? 0) + b.position.x
            : b.position.x;
          return aAbsX - bAbsX;
        });
      }

      // Remove old edit-mode group containers
      let result = currentNodes.filter(
        (n) => !(n.type === "default" && n.className === "reactFlowGroup" && n.id.startsWith("editGroup_")),
      );

      // Remove parentId from nodes no longer in a valid group (< 2 members)
      const validGroupIds = new Set(
        Object.entries(groupMembers)
          .filter(([, m]) => m.length >= 2)
          .map(([gid]) => gid),
      );
      result = result.map((n) => {
        if (
          n.parentId &&
          n.parentId.startsWith("editGroup_") &&
          !validGroupIds.has(n.parentId.replace("_group", ""))
        ) {
          return { ...n, parentId: undefined };
        }
        return n;
      });

      // Create new group containers and reposition members
      for (const [groupId, members] of Object.entries(groupMembers)) {
        if (members.length < 2) continue;

        const firstMember = members[0];
        const firstAbsX = firstMember.parentId
          ? (currentNodes.find((n) => n.id === firstMember.parentId)?.position.x ?? 0) +
            firstMember.position.x
          : firstMember.position.x;
        const firstAbsY = firstMember.parentId
          ? (currentNodes.find((n) => n.id === firstMember.parentId)?.position.y ?? 0) +
            firstMember.position.y
          : firstMember.position.y;
        const row = Math.round(firstAbsY / effectiveNodeHeight);

        const groupColor = groupIdToColor[groupId];
        const containerNode = {
          id: `${groupId}_group`,
          data: {
            label: groupId,
            id: groupId,
            isAbilityIcon: false,
            imgPath: "",
            nodeId: `${groupId}_group`,
            skillBackground,
            skillIconBackground,
            skillLevelImg,
            tooltipFrame,
            skillLevelLitIcon,
            skillIcon,
            row,
            isGrouping: true,
            numLevels: 1,
            description: "",
            effects: [],
            origIndent: "",
            origTier: "",
            isHiddentInUI: false,
            isCheckingSkillRequirements,
            unlockRank: 0,
          },
          position: { x: firstAbsX - 10, y: row * effectiveNodeHeight - 15 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          parentId: undefined,
          type: "default" as const,
          style: {
            backgroundColor: "transparent",
            border: `2px solid ${groupColor || "rgb(42,11,13)"}`,
            boxShadow: "inset 0px 0px 20px 20px rgba(0,0,0,0.5),inset 0px 0px 10px 10px rgba(42,11,13,0.5)",
            zIndex: "0",
          },
          className: "reactFlowGroup",
          width: members.length * nodeWidth - 15,
          height: effectiveNodeHeight - 10,
        };

        // Add container before members (ReactFlow requires parent before children)
        result = [containerNode as any, ...result.filter((n) => n.id !== `${groupId}_group`)];

        // Reposition members as children of the container and set editGroupColor
        const memberIds = new Set(members.map((m) => m.id));
        result = result.map((n) => {
          if (!memberIds.has(n.id)) return n;
          const idx = members.findIndex((m) => m.id === n.id);
          return {
            ...n,
            data: { ...n.data, editGroupColor: groupColor },
            parentId: `${groupId}_group`,
            position: { x: idx * nodeWidth + 10, y: 15 },
          };
        });
      }

      // Shift standalone nodes that overlap with group containers
      // Collect occupied columns per row from group containers
      const groupOccupied: { row: number; startCol: number; endCol: number }[] = [];
      for (const [groupId, members] of Object.entries(groupMembers)) {
        if (members.length < 2) continue;
        const container = result.find((n) => n.id === `${groupId}_group`);
        if (!container) continue;
        const row = Math.round((container.position.y + 15) / effectiveNodeHeight);
        const startCol = Math.round((container.position.x + 10) / nodeWidth);
        const endCol = startCol + members.length - 1;
        groupOccupied.push({ row, startCol, endCol });
      }

      // For each row, re-sequence standalone (non-grouped, non-placeholder) skill nodes
      // so they don't overlap with group columns
      const rowsToFix = new Set(groupOccupied.map((g) => g.row));
      for (const row of rowsToFix) {
        const rowGroups = groupOccupied.filter((g) => g.row === row);

        // Get standalone skill nodes in this row
        const standalone = result
          .filter(
            (n) =>
              n.type === "skill" &&
              !n.parentId &&
              !(n.data as any)?.isGrouping &&
              Math.round(n.position.y / effectiveNodeHeight) === row,
          )
          .sort((a, b) => a.position.x - b.position.x);

        if (standalone.length === 0) continue;

        // Build a sorted list of "items" in the row: groups (by startCol) and standalone nodes (by col)
        // Each item is either a group (occupies N columns) or a standalone node (1 column)
        type RowItem =
          | { kind: "group"; groupId: string; memberCount: number; origCol: number }
          | { kind: "node"; nodeId: string; origCol: number };
        const items: RowItem[] = [];
        for (const g of rowGroups) {
          const container = result.find(
            (n) =>
              n.id.endsWith("_group") &&
              Math.round((n.position.x + 10) / nodeWidth) === g.startCol &&
              Math.round((n.position.y + 15) / effectiveNodeHeight) === row,
          );
          if (container) {
            const groupId = container.id.replace("_group", "");
            items.push({
              kind: "group",
              groupId,
              memberCount: g.endCol - g.startCol + 1,
              origCol: g.startCol,
            });
          }
        }
        for (const n of standalone) {
          items.push({ kind: "node", nodeId: n.id, origCol: Math.round(n.position.x / nodeWidth) });
        }
        // Sort by original column to preserve relative order
        items.sort((a, b) => a.origCol - b.origCol);

        // Assign columns preserving gaps: each item stays at its original column
        // unless it would overlap with a previous item, in which case it shifts right
        let minNextCol = 0;
        const nodeNewPositions = new Map<string, number>();
        const groupNewPositions = new Map<string, number>();
        for (const item of items) {
          if (item.kind === "group") {
            const col = Math.max(item.origCol, minNextCol);
            groupNewPositions.set(item.groupId, col);
            minNextCol = col + item.memberCount;
          } else {
            const col = Math.max(item.origCol, minNextCol);
            nodeNewPositions.set(item.nodeId, col);
            minNextCol = col + 1;
          }
        }

        // Apply new positions to standalone nodes
        const standaloneIds = new Set(standalone.map((n) => n.id));
        result = result.map((n) => {
          if (!standaloneIds.has(n.id)) return n;
          const newCol = nodeNewPositions.get(n.id);
          if (newCol === undefined) return n;
          return { ...n, position: { x: newCol * nodeWidth, y: row * effectiveNodeHeight } };
        });

        // Apply new positions to group containers
        result = result.map((n) => {
          if (!n.id.endsWith("_group") || n.type !== "default") return n;
          const gid = n.id.replace("_group", "");
          const newCol = groupNewPositions.get(gid);
          if (newCol === undefined) return n;
          return { ...n, position: { ...n.position, x: newCol * nodeWidth - 10 } };
        });

        // Also reposition placeholder for this row
        const placeholderId = `add_placeholder_r${row}`;
        const maxCol = result
          .filter(
            (n) =>
              (n.type === "skill" || n.className === "reactFlowGroup") &&
              !n.parentId &&
              Math.round(n.position.y / effectiveNodeHeight) === row,
          )
          .reduce((max, n) => {
            const w =
              n.className === "reactFlowGroup" ? Math.ceil(((n as any).width ?? nodeWidth) / nodeWidth) : 1;
            return Math.max(max, Math.round(n.position.x / nodeWidth) + w - 1);
          }, -1);
        const placeholderCol = maxCol + 1;
        result = result.map((n) =>
          n.id === placeholderId
            ? {
                ...n,
                data: { ...n.data, column: placeholderCol },
                position: { x: placeholderCol * nodeWidth, y: row * effectiveNodeHeight },
              }
            : n,
        );
      }

      // Clear editGroupColor from nodes no longer in any valid group
      const groupedNodeIds = new Set(Object.keys(editGroups));
      result = result.map((n) => {
        if (n.type === "skill" && !groupedNodeIds.has(n.id) && (n.data as any)?.editGroupColor) {
          return { ...n, data: { ...n.data, editGroupColor: undefined } };
        }
        return n;
      });

      return result;
    });
  }, [editGroups]);

  return (
    <div className={`w-full h-full ${isEditMode ? "" : "hideReactFlowHandles"}`}>
      <ReactFlow
        key={skillsData.currentSubtype}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
        snapToGrid={isEditMode && !isRequirementsMode && !isSkillLocksMode}
        snapGrid={[nodeWidth, effectiveNodeHeight]}
        nodesDraggable={isEditMode && !isRequirementsMode && !isSkillLocksMode}
        nodesConnectable={isEditMode}
        elementsSelectable={isEditMode}
        onConnect={isEditMode ? onConnect : undefined}
        deleteKeyCode={isEditMode && !isRequirementsMode && !isSkillLocksMode ? "Delete" : null}
        onNodesDelete={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodesDelete : undefined}
        onEdgeClick={isEditMode ? onEdgeClick : undefined}
        onNodeDragStart={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeDragStart : undefined}
        onNodeDragStop={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeDragStop : undefined}
        onNodeClick={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeClick : undefined}
        onNodeDoubleClick={
          isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeDoubleClick : undefined
        }
        onNodeContextMenu={
          isEditMode || isRequirementsMode || isSkillLocksMode ? onNodeContextMenu : undefined
        }
        onPaneClick={isEditMode ? onPaneClick : undefined}
        defaultEdgeOptions={
          isEditMode
            ? isSkillLocksMode
              ? { interactionWidth: 20, style: { stroke: "#dc2626", strokeWidth: 2 } }
              : isRequirementsMode
                ? { interactionWidth: 20, style: { stroke: "#f59e0b", strokeWidth: 2 } }
                : { interactionWidth: 20, style: { stroke: "#ef4444", strokeWidth: 2 } }
            : undefined
        }
        multiSelectionKeyCode="Shift"
      >
        <Panel position="top-center">
          <div className="text-cyan-500 text-xl opacity-80">WORK IN PROGRESS</div>
        </Panel>
        <Panel position="top-right">
          <div className="text-slate-200 text-xl opacity-80">{subtype}</div>
          <div className="text-slate-200 text-xl opacity-80">{`${localized.rank} ${currentRank}`}</div>
        </Panel>
        <Panel position="top-left">
          <div className="hover:bg-gray-700 dark:border-gray-600 border-2 rounded-lg w-fit">
            <Dropdown dismissOnClick={false} label={localized.options}>
              <Dropdown.Item>
                <div className="flex items-center min-w-[18em]">
                  <label htmlFor="isShowingHiddentSkillsCheckbox">
                    <input
                      id="isShowingHiddentSkillsCheckbox"
                      type="checkbox"
                      checked={!!isShowingHiddentSkills}
                      onChange={() => {
                        setIsShowingHiddenSkills(!isShowingHiddentSkills);
                      }}
                    ></input>
                    <span className="ml-2">{localized.showHiddenSkills}</span>
                  </label>
                </div>
              </Dropdown.Item>
              <Dropdown.Item>
                <div className="flex items-center">
                  <label htmlFor="isShowingHiddenModifiersInsideSkillsCheckbox">
                    <input
                      id="isShowingHiddenModifiersInsideSkillsCheckbox"
                      type="checkbox"
                      checked={!!isShowingHiddenModifiersInsideSkills}
                      onChange={() => {
                        setIsShowingHiddenModifiersInsideSkills(!isShowingHiddenModifiersInsideSkills);
                      }}
                    ></input>
                    <span className="ml-2">{localized.showHiddenModifiersInsideSkills}</span>
                  </label>
                </div>
              </Dropdown.Item>
              <Dropdown.Item>
                <div className="flex items-center">
                  <label htmlFor="isCheckingSkillRequirementsCheckbox">
                    <input
                      id="isCheckingSkillRequirementsCheckbox"
                      type="checkbox"
                      checked={!!isCheckingSkillRequirements}
                      onChange={() => {
                        setIsCheckingSkillRequirements(!isCheckingSkillRequirements);
                      }}
                    ></input>
                    <span className="ml-2">{localized.checkSkillRequirements}</span>
                  </label>
                </div>
              </Dropdown.Item>
              {/* localizing subtype is actually not that useful since we want names_ */}
              {/* <Dropdown.Item>
                <div className="flex items-center">
                  <label htmlFor="isLocalizingSubtypesCheckbox">
                    <input
                      id="isLocalizingSubtypesCheckbox"
                      type="checkbox"
                      checked={!!isLocalizingSubtypes}
                      onChange={() => {
                        dispatch(setIsLocalizingSubtypes(!isLocalizingSubtypes));
                      }}
                    ></input>
                    <span className="ml-2">{localized.showHiddenModifiersInsideSkills}</span>
                  </label>
                </div>
              </Dropdown.Item> */}
            </Dropdown>
          </div>
          {hasFactionVariants && (
            <div className="hover:bg-gray-700 dark:border-gray-600 border-2 rounded-lg mt-2 w-fit">
              <Dropdown
                dismissOnClick={true}
                label={
                  factionFilter === "all"
                    ? localized.all || "All"
                    : factionFilterOptions.find((o) => o.value === factionFilter)?.label || factionFilter
                }
              >
                <Dropdown.Item onClick={() => setFactionFilter("all")}>
                  <span>{localized.all || "All"}</span>
                </Dropdown.Item>
                {factionFilterOptions.map((option) => (
                  <Dropdown.Item key={option.value} onClick={() => setFactionFilter(option.value)}>
                    <span>{option.label}</span>
                  </Dropdown.Item>
                ))}
              </Dropdown>
            </div>
          )}
          {isFeaturesForModdersEnabled && (
            <div className="mt-2">
              <button
                className={`px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                  isEditMode ? "bg-green-700 text-white" : "hover:bg-gray-700"
                }`}
                onClick={() => setIsEditMode(!isEditMode)}
              >
                {isEditMode ? localized.editModeOn || "Edit Mode: ON" : localized.edit || "Edit"}
              </button>
            </div>
          )}
          {isEditMode && (
            <div className="mt-2 flex gap-2">
              {!isRequirementsMode && (
                <>
                  <button
                    className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                    onClick={() => {
                      setPlaceholderRow(undefined);
                      setPlaceholderCol(undefined);
                      setIsAddNodeModalOpen(true);
                    }}
                  >
                    {localized.addNode || "Add Node"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                    onClick={onExport}
                  >
                    {localized.export || "Export"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-blue-700 bg-blue-600 text-white"
                    onClick={onSavePack}
                  >
                    {localized.savePack || "Save Pack"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                    onClick={onGroupSelected}
                  >
                    {localized.group || "Group"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                    onClick={onUngroupSelected}
                  >
                    {localized.ungroup || "Ungroup"}
                  </button>
                </>
              )}
              <button
                className={`px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                  isRequirementsMode ? "bg-amber-600 text-white" : "hover:bg-gray-700"
                }`}
                onClick={() => {
                  if (isSkillLocksMode) exitSkillLocksMode();
                  isRequirementsMode ? exitRequirementsMode() : enterRequirementsMode();
                }}
              >
                {isRequirementsMode
                  ? localized.requirementsModeOn || "Requirements: ON"
                  : localized.requirements || "Requirements"}
              </button>
              <button
                className={`px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                  isSkillLocksMode ? "bg-red-600 text-white" : "hover:bg-gray-700"
                }`}
                onClick={() => {
                  if (isRequirementsMode) exitRequirementsMode();
                  isSkillLocksMode ? exitSkillLocksMode() : enterSkillLocksMode();
                }}
              >
                {isSkillLocksMode
                  ? localized.skillLocksModeOn || "Skill Locks: ON"
                  : localized.skillLocks || "Skill Locks"}
              </button>
            </div>
          )}
        </Panel>
        {!isEditMode && (
          <ViewportPortal>
            <div className="fixed w-full h-full top-0 left-0 pointer-events-none">
              {arrows.map((arrow, i) => (
                <img
                  key={`arrow-${i}`}
                  src={arrowImg}
                  alt="arrow"
                  style={{
                    transform: `translate(${arrow.x}px, ${arrow.y}px)`,
                    position: "absolute",
                    width: "90px",
                  }}
                ></img>
              ))}
            </div>
          </ViewportPortal>
        )}
        {isEditMode && (
          <ViewportPortal>
            <div
              className="fixed w-full h-full top-0 left-0 pointer-events-none"
              style={{ userSelect: "none" }}
            >
              {Array.from({ length: 7 }, (_, r) => (
                <div
                  key={`row-label-${r}`}
                  style={{
                    transform: `translate(-50px, ${r * effectiveNodeHeight + 25}px)`,
                    position: "absolute",
                    color: "#94a3b8",
                    fontFamily: "monospace",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                >
                  R{r}
                </div>
              ))}
              {Array.from({ length: Math.max(1, ...skills.map((s) => s.y + 1)) + 2 }, (_, c) => (
                <div
                  key={`col-label-${c}`}
                  style={{
                    transform: `translate(${c * nodeWidth + 100}px, -30px)`,
                    position: "absolute",
                    color: "#94a3b8",
                    fontFamily: "monospace",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                >
                  C{c}
                </div>
              ))}
            </div>
          </ViewportPortal>
        )}
      </ReactFlow>
      {isAddNodeModalOpen &&
        (() => {
          const editingNode = editingNodeId ? nodes.find((n) => n.id === editingNodeId) : undefined;
          const editingRow = editingNode
            ? editingNode.parentId
              ? (() => {
                  const p = nodes.find((n) => n.id === editingNode.parentId);
                  return Math.round(((p?.position.y ?? 0) + editingNode.position.y) / effectiveNodeHeight);
                })()
              : Math.round(editingNode.position.y / effectiveNodeHeight)
            : undefined;
          const editingCol = editingNode
            ? editingNode.parentId
              ? (() => {
                  const p = nodes.find((n) => n.id === editingNode.parentId);
                  return Math.round(((p?.position.x ?? 0) + editingNode.position.x) / nodeWidth);
                })()
              : Math.round(editingNode.position.x / nodeWidth)
            : undefined;
          return (
            <AddNodeModal
              isOpen={isAddNodeModalOpen}
              onClose={() => {
                setIsAddNodeModalOpen(false);
                setEditingNodeId(undefined);
              }}
              onAdd={onAddOrEditNode}
              initialRow={editingNode ? editingRow : placeholderRow}
              initialColumn={editingNode ? editingCol : placeholderCol}
              editingData={
                editingNode
                  ? {
                      name: editingNode.data.label,
                      description: editingNode.data.description,
                      maxLevel: editingNode.data.numLevels,
                      unlockRank: editingNode.data.unlockRank,
                      effects: editingNode.data.effects,
                      existingSkillKey: editingNode.data.existingSkillKey,
                      imgPath: editingNode.data.imgPath,
                    }
                  : undefined
              }
            />
          );
        })()}
      {contextMenu &&
        (() => {
          const targetNode = nodes.find((n) => n.id === contextMenu.nodeId);
          const selectedNodes = nodes.filter(
            (n) => n.selected && n.type === "skill" && n.id !== contextMenu.nodeId,
          );
          const targetGroupId = targetNode ? editGroups[(targetNode.data as SkillData).nodeId] : undefined;
          const isTargetSelected = nodes.some((n) => n.id === contextMenu.nodeId && n.selected);
          const allSelected = nodes.filter((n) => n.selected && n.type === "skill");
          const deleteCount = isTargetSelected && allSelected.length > 1 ? allSelected.length : 1;

          // Nodes that would be grouped: right-clicked + all selected, deduplicated
          const groupCandidateMap = new Map<string, (typeof nodes)[0]>();
          if (targetNode) groupCandidateMap.set(targetNode.id, targetNode);
          for (const n of selectedNodes) groupCandidateMap.set(n.id, n);
          const groupCandidates = Array.from(groupCandidateMap.values());
          const canGroup =
            groupCandidates.length >= 2 &&
            groupCandidates.every((n) => !editGroups[(n.data as SkillData).nodeId]);

          // Count input and output connections
          const inputCount = edges.filter((e) => e.target === contextMenu.nodeId).length;
          const outputCount = edges.filter((e) => e.source === contextMenu.nodeId).length;

          const menuItemClass =
            "w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 cursor-pointer";

          return (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setContextMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu(null);
                }}
              />
              <div
                className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[200px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                {!isRequirementsMode && (
                  <>
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        if (targetNode) console.log("Node info:", JSON.stringify(targetNode, null, 2));
                        setContextMenu(null);
                      }}
                    >
                      Info
                    </button>
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        setEditingNodeId(contextMenu.nodeId);
                        setPlaceholderRow(undefined);
                        setPlaceholderCol(undefined);
                        setIsAddNodeModalOpen(true);
                        setContextMenu(null);
                      }}
                    >
                      Edit Node
                    </button>
                  </>
                )}
                {inputCount > 0 && (
                  <button className={menuItemClass} onClick={contextMenuRemoveInputs}>
                    Remove {inputCount} Input Connection{inputCount !== 1 ? "s" : ""}
                  </button>
                )}
                {outputCount > 0 && (
                  <button className={menuItemClass} onClick={contextMenuRemoveOutputs}>
                    Remove {outputCount} Output Connection{outputCount !== 1 ? "s" : ""}
                  </button>
                )}
                {!isRequirementsMode && (
                  <>
                    <div className="border-t border-gray-600 my-1" />
                    <button
                      className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 cursor-pointer"
                      onClick={contextMenuDelete}
                    >
                      {deleteCount > 1 ? `Delete ${deleteCount} Nodes` : "Delete Node"}
                    </button>
                    {canGroup && (
                      <button className={menuItemClass} onClick={contextMenuGroup}>
                        Group {groupCandidates.length} Nodes
                      </button>
                    )}
                    {selectedNodes.length > 0 && (
                      <>
                        <div className="border-t border-gray-600 my-1" />
                        <div className="px-4 py-1 text-xs text-gray-400">
                          {selectedNodes.length} selected node{selectedNodes.length > 1 ? "s" : ""}
                        </div>
                        <button className={menuItemClass} onClick={() => contextMenuInsert("before", false)}>
                          Insert Before
                        </button>
                        <button className={menuItemClass} onClick={() => contextMenuInsert("after", false)}>
                          Insert After
                        </button>
                        {targetGroupId && (
                          <>
                            <button
                              className={menuItemClass}
                              onClick={() => contextMenuInsert("before", true)}
                            >
                              Insert Before and Group
                            </button>
                            <button
                              className={menuItemClass}
                              onClick={() => contextMenuInsert("after", true)}
                            >
                              Insert After and Group
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          );
        })()}
    </div>
  );
});

export default SkillsView;
