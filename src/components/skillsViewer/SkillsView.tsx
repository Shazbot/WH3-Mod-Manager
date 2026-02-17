import React, {
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { setSkillNodeLevel } from "../../appSlice";
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
import { Modal } from "../../flowbite/components/Modal/index";

const edgeType = "straight";

type ClipboardEntry = {
  label: string;
  description: string;
  effects: Effect[];
  numLevels: number;
  unlockRank: number;
  existingSkillKey?: string;
  imgPath?: string;
  relRow: number;
  relCol: number;
  groupKey?: string;
};

let clipboard: ClipboardEntry[] = [];

type ClipboardEdge = {
  sourceRelRow: number;
  sourceRelCol: number;
  targetRelRow: number;
  targetRelCol: number;
  type: string;
  data?: any;
  style?: any;
};

let clipboardEdges: ClipboardEdge[] = [];

const GROUP_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#34495e"];

const AddPlaceholderNode = memo(({ data }: { data: { row: number; column: number } }) => {
  return (
    <div className="flex items-center justify-center w-[260px] h-20 border-2 border-dashed border-transparent rounded-lg cursor-pointer hover:border-gray-500 hover:bg-gray-800/30 transition-colors group">
      <span className="text-3xl text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">+</span>
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

const SkillLockEdge = ({ sourceX, sourceY, targetX, targetY, style, markerEnd, data }: any) => {
  const [hovered, setHovered] = useState(false);
  const midX = (sourceX + targetX) / 2;
  const arc = Math.min(Math.abs(targetX - sourceX) * 0.3, 135);
  const dy = data?.curveBelow ? -arc : arc;
  const baseY = data?.curveBelow ? Math.min(sourceY, targetY) : Math.max(sourceY, targetY);
  const path = `M ${sourceX},${sourceY} Q ${midX},${baseY + dy} ${targetX},${targetY}`;
  const level = data?.level || 1;
  const color = style?.stroke || "#dc2626";

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={hovered ? 2 : 1}
        markerEnd={markerEnd}
        strokeDasharray="8,4"
        opacity={hovered ? 1 : 0.5}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {hovered && (
        <>
          <circle cx={midX} cy={baseY + dy} r="12" fill={color} stroke="#fff" strokeWidth="1" />
          <text x={midX} y={baseY + dy + 4} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="bold">
            {level}
          </text>
        </>
      )}
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

export type SkillsViewSnapshot = {
  nodes: Nodes[];
  edges: Edge[];
  isEditMode: boolean;
  isRequirementsMode: boolean;
  isSkillLocksMode: boolean;
  editGroups: Record<string, string>;
  nextGroupId: number;
  factionFilter: string;
  isShowingHiddentSkills: boolean;
  isShowingHiddenModifiersInsideSkills: boolean;
  isCheckingSkillRequirements: boolean;
  savedEditEdges: Edge[];
  savedLocksEdges: Edge[];
  allLockEdges: Edge[];
  lockEdgeLevels: Record<string, number>;
  localNodeToSkillLocks: Record<string, [string, number][]> | null;
};

export type SkillsViewHandle = {
  getSnapshot: () => SkillsViewSnapshot;
};

type AddPlaceHolderNodeData = {
  row: number;
  column: number;
  isGrouping: false;
  label: "addPlaceholder";
  nodeId: "addPlaceholder";
} & Pick<SkillData, "editGroupColor" | "imgPath" | "id">;

type Nodes =
  | Node<SkillData, "default">
  | Node<SkillData, "skill">
  | Node<AddPlaceHolderNodeData, "addPlaceholder">;

type NodesWithoutPlaceholders = Exclude<Nodes, Node<AddPlaceHolderNodeData, "addPlaceholder">>;

type SkillsViewProps = {
  skillsData: SkillsData;
  initialSnapshot?: SkillsViewSnapshot;
};

const SkillsView = memo(
  forwardRef<SkillsViewHandle, SkillsViewProps>(({ skillsData, initialSnapshot }, ref) => {
    const dispatch = useAppDispatch();
    const localized: Record<string, string> = useContext(localizationContext);

    const [isShowingHiddentSkills, setIsShowingHiddenSkills] = useState(
      initialSnapshot?.isShowingHiddentSkills ?? true,
    );
    const [isShowingHiddenModifiersInsideSkills, setIsShowingHiddenModifiersInsideSkills] = useState(
      initialSnapshot?.isShowingHiddenModifiersInsideSkills ?? true,
    );
    const [isCheckingSkillRequirements, setIsCheckingSkillRequirements] = useState(
      initialSnapshot?.isCheckingSkillRequirements ?? true,
    );
    const [factionFilter, setFactionFilter] = useState<string>(initialSnapshot?.factionFilter ?? "all");
    const [isEditMode, setIsEditMode] = useState(initialSnapshot?.isEditMode ?? false);
    const prevIsEditModeRef = useRef(isEditMode);
    let effectiveNodeHeight = isEditMode ? editModeNodeHeight : nodeHeight;
    const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState(false);
    const [placeholderRow, setPlaceholderRow] = useState<number | undefined>(undefined);
    const [placeholderCol, setPlaceholderCol] = useState<number | undefined>(undefined);
    const [editGroups, setEditGroups] = useState<Record<string, string>>(initialSnapshot?.editGroups ?? {});
    const [nextGroupId, setNextGroupId] = useState(initialSnapshot?.nextGroupId ?? 1);
    const [editingNodeId, setEditingNodeId] = useState<string | undefined>(undefined);
    const dragStartPos = useRef<{ x: number; y: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      nodeId: string;
      nodeType: string;
    } | null>(null);
    const [isRequirementsMode, setIsRequirementsMode] = useState(
      initialSnapshot?.isRequirementsMode ?? false,
    );
    const isRequirementsModeRef = useRef(false);
    const savedEditEdges = useRef<SkillEdge[]>((initialSnapshot?.savedEditEdges as SkillEdge[]) ?? []);
    const [isSkillLocksMode, setIsSkillLocksMode] = useState(initialSnapshot?.isSkillLocksMode ?? false);
    const isSkillLocksModeRef = useRef(false);
    const savedLocksEdges = useRef<SkillEdge[]>((initialSnapshot?.savedLocksEdges as SkillEdge[]) ?? []);
    const allLockEdges = useRef<SkillEdge[]>((initialSnapshot?.allLockEdges as SkillEdge[]) ?? []);
    const [lockEdgeLevels, setLockEdgeLevels] = useState<Record<string, number>>(
      initialSnapshot?.lockEdgeLevels ?? {},
    );
    const localNodeToSkillLocks = useRef<Record<string, [string, number][]> | null>(
      initialSnapshot?.localNodeToSkillLocks ?? null,
    );
    const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
    const [editingEdgeLevel, setEditingEdgeLevel] = useState("");
    const [editingEdgePosition, setEditingEdgePosition] = useState<{ x: number; y: number } | null>(null);
    const [isSavePackModalOpen, setIsSavePackModalOpen] = useState(false);
    const [saveChangesMode, setSaveChangesMode] = useState(false);
    const [savePackName, setSavePackName] = useState("");
    const [savePackDirectory, setSavePackDirectory] = useState<string | undefined>(undefined);
    const [savePackCloneAll, setSavePackCloneAll] = useState(false);
    const [isSavePackProcessing, setIsSavePackProcessing] = useState(false);
    const [, setClipboardVersion] = useState(0);
    const [resetCounter, setResetCounter] = useState(0);
    const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(
      null,
    );
    const [customTableName, setCustomTableName] = useState("");
    const [customKeyPrefix, setCustomKeyPrefix] = useState("");
    const isRestoringSnapshot = useRef(!!initialSnapshot);
    const skipEditGroupsEffect = useRef(!!initialSnapshot);
    const skipSubtypeReset = useRef(!!initialSnapshot);
    const skipTransitionEffect = useRef(false);
    const savePackNameInputRef = useRef<HTMLInputElement>(null);

    isRequirementsModeRef.current = isRequirementsMode;
    isSkillLocksModeRef.current = isSkillLocksMode;

    useEffect(() => {
      if (isSavePackModalOpen && savePackNameInputRef.current) {
        setTimeout(() => savePackNameInputRef.current?.focus(), 0);
      }
    }, [isSavePackModalOpen]);

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

    const resolveSkillIcon = (imgPath?: string): string => {
      if (!imgPath) return skillIcon;

      let iconBuffer = skillsData.icons[imgPath];
      if (iconBuffer) return iconBuffer;

      if (!imgPath.startsWith("ui\\")) {
        imgPath = `ui\\campaign ui\\skills\\${imgPath}`;
        iconBuffer = skillsData.icons[imgPath];
        if (iconBuffer) return iconBuffer;
      }

      // Try battle ui fallback
      const battlePath = imgPath.replace("ui\\campaign ui\\skills\\", "ui\\battle ui\\ability_icons\\");
      return skillsData.icons[battlePath] || skillIcon;
    };

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

    const skillNodes: Nodes[] = [];

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
          existingSkillKey: skill.id,
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

    // Generate "+" placeholder nodes in empty grid positions (gaps + end of row) in edit mode
    if (isEditMode) {
      const globalMaxCol = skills.length > 0 ? Math.max(...skills.map((s) => s.y)) : 0;
      for (let r = 0; r < 7; r++) {
        const skillsInRow = skills.filter((s) => s.x === r);
        const occupiedCols = new Set(skillsInRow.map((s) => s.y));
        const maxColBound = Math.max(
          skillsInRow.length > 0 ? Math.max(...occupiedCols) + 1 : 0,
          globalMaxCol + 1,
        );
        for (let c = 0; c <= maxColBound; c++) {
          if (!occupiedCols.has(c)) {
            skillNodes.push({
              id: `add_placeholder_r${r}_c${c}`,
              data: { row: r, column: c } as any,
              position: { x: c * nodeWidth, y: r * effectiveNodeHeight },
              type: "addPlaceholder",
              selectable: false,
              draggable: false,
              connectable: false,
            } as any);
          }
        }
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

    type SkillEdge = Edge & {
      id: string;
      source: string;
      target: string;
      type: string;
      animated: boolean;
      curveBelow?: boolean;
    };
    const initialEdges: SkillEdge[] = [];
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
              source: isEditMode
                ? `${skillWithLink.nodeId}`
                : sourceSkillNode.parentId || `${skillWithLink.nodeId}`,
              target: isEditMode ? `${linkedNode}` : linkedSkillNode.parentId || `${linkedNode}`,
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

    const [nodes, setNodes, onNodesChange] = useNodesState<Nodes>(
      initialSnapshot?.nodes ? deepClone(initialSnapshot.nodes) : deepClone(skillNodes),
    );
    const [edges, setEdges, onEdgesChange] = useEdgesState<(typeof initialEdges)[0]>(
      initialSnapshot?.edges
        ? (deepClone(initialSnapshot.edges) as typeof initialEdges)
        : deepClone(initialEdges),
    );

    useImperativeHandle(ref, () => ({
      getSnapshot: (): SkillsViewSnapshot => ({
        nodes: deepClone(nodes),
        edges: deepClone(edges),
        isEditMode,
        isRequirementsMode,
        isSkillLocksMode,
        editGroups,
        nextGroupId,
        factionFilter,
        isShowingHiddentSkills,
        isShowingHiddenModifiersInsideSkills,
        isCheckingSkillRequirements,
        savedEditEdges: deepClone(savedEditEdges.current),
        savedLocksEdges: deepClone(savedLocksEdges.current),
        allLockEdges: deepClone(allLockEdges.current),
        lockEdgeLevels,
        localNodeToSkillLocks: localNodeToSkillLocks.current
          ? deepClone(localNodeToSkillLocks.current)
          : null,
      }),
    }));

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
          const newLockEdge: SkillEdge = {
            ...connection,
            id: edgeId,
            source: connection.source!,
            target: connection.target!,
            type: "skillLock",
            animated: false,
            zIndex: 10,
            style: { stroke: "#dc2626", strokeWidth: 2 },
            data: { curveBelow: false, level: 1 },
          };
          allLockEdges.current = [...allLockEdges.current, newLockEdge];
          setEdges((eds) => addEdge(newLockEdge, eds));
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

    // Helper: remove placeholders in affected rows and regenerate them based on current skill positions
    const repositionPlaceholders = useCallback(
      (currentNodes: Nodes[], affectedRows: Set<number>) => {
        let result = currentNodes.filter(
          (n) =>
            !(
              n.type === "addPlaceholder" && affectedRows.has(Math.round(n.position.y / effectiveNodeHeight))
            ),
        );
        // Compute global max column across all skill nodes for consistent placeholder coverage
        const allSkillNodes = result.filter((n) => n.type === "skill" && !n.parentId);
        const globalMaxCol = allSkillNodes.reduce(
          (max, n) => Math.max(max, Math.round(n.position.x / nodeWidth)),
          -1,
        );
        for (const row of affectedRows) {
          const rowSkills = allSkillNodes.filter(
            (n) => Math.round(n.position.y / effectiveNodeHeight) === row,
          );
          const occupiedCols = new Set(rowSkills.map((n) => Math.round(n.position.x / nodeWidth)));
          const maxCol = rowSkills.reduce(
            (max, n) => Math.max(max, Math.round(n.position.x / nodeWidth)),
            -1,
          );
          const maxColBound = Math.max(maxCol + 1, globalMaxCol + 1);
          for (let c = 0; c <= maxColBound; c++) {
            if (!occupiedCols.has(c)) {
              result.push({
                id: `add_placeholder_r${row}_c${c}`,
                data: { row, column: c } as AddPlaceHolderNodeData,
                position: { x: c * nodeWidth, y: row * effectiveNodeHeight },
                type: "addPlaceholder",
                selectable: false,
                draggable: false,
                connectable: false,
              } as Node<AddPlaceHolderNodeData, "addPlaceholder">);
            }
          }
        }
        return result;
      },
      [effectiveNodeHeight],
    );
    const repositionPlaceholdersRef = useRef(repositionPlaceholders);
    repositionPlaceholdersRef.current = repositionPlaceholders;

    // Edit mode: handle node deletion (also clean up connected edges)
    const onNodesDelete = useCallback(
      (deleted: Node[]) => {
        if (isSkillLocksMode) {
          allLockEdges.current = allLockEdges.current.filter(
            (e) => !deleted.some((n) => n.id === e.source || n.id === e.target),
          );
        }
        setEdges((eds) => eds.filter((e) => !deleted.some((n) => n.id === e.source || n.id === e.target)));
        // Regenerate placeholders for affected rows after deletion
        const affectedRows = new Set<number>();
        for (const n of deleted) {
          affectedRows.add(Math.round(n.position.y / effectiveNodeHeight));
        }
        setNodes((nds) => repositionPlaceholders(nds, affectedRows));
      },
      [setEdges, setNodes, repositionPlaceholders, effectiveNodeHeight],
    );

    // Edit mode: click an edge to remove it
    const onEdgeClick = useCallback(
      (event: React.MouseEvent, edge: Edge) => {
        if (isSkillLocksMode) {
          if (event.button === 2) {
            // Right-click: delete
            allLockEdges.current = allLockEdges.current.filter((e) => e.id !== edge.id);
            setEdges((eds) => eds.filter((e) => e.id !== edge.id));
            setLockEdgeLevels((prev) => {
              const next = { ...prev };
              delete next[edge.id];
              return next;
            });
          } else {
            // Left-click: open inline level editor
            const currentLevel = lockEdgeLevels[edge.id] || 1;
            setEditingEdgeId(edge.id);
            setEditingEdgeLevel(currentLevel.toString());
            setEditingEdgePosition({ x: event.clientX, y: event.clientY });
          }
          return;
        }
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        // In requirements mode, if a SUBSET_REQUIRED edge is deleted (curveBelow=false),
        // remove the source node from its group so it becomes standalone
        if (isRequirementsMode && edge.data?.curveBelow === false && editGroups[edge.source]) {
          setEditGroups((prev) => {
            const next = { ...prev };
            delete next[edge.source];
            return next;
          });
        }
      },
      [setEdges, isSkillLocksMode, lockEdgeLevels, setLockEdgeLevels, isRequirementsMode, editGroups],
    );

    const confirmEdgeLevelEdit = useCallback(() => {
      if (!editingEdgeId) return;
      const newLevel = parseInt(editingEdgeLevel, 10);
      if (isNaN(newLevel) || newLevel < 1) {
        setEditingEdgeId(null);
        return;
      }
      setLockEdgeLevels((prev) => ({ ...prev, [editingEdgeId]: newLevel }));
      setEdges((eds) =>
        eds.map((e) => (e.id === editingEdgeId ? { ...e, data: { ...e.data, level: newLevel } } : e)),
      );
      setEditingEdgeId(null);
    }, [editingEdgeId, editingEdgeLevel, setEdges, setLockEdgeLevels]);

    const deleteEditingEdge = useCallback(() => {
      if (!editingEdgeId) return;
      allLockEdges.current = allLockEdges.current.filter((e) => e.id !== editingEdgeId);
      setEdges((eds) => eds.filter((e) => e.id !== editingEdgeId));
      setLockEdgeLevels((prev) => {
        const next = { ...prev };
        delete next[editingEdgeId];
        return next;
      });
      setEditingEdgeId(null);
    }, [editingEdgeId, setEdges, setLockEdgeLevels]);

    const addLockEdge = useCallback(
      (sourceId: string, targetId: string) => {
        const edgeId = `lock-${sourceId}-${targetId}`;
        if (allLockEdges.current.some((e) => e.id === edgeId)) return;
        const newEdge: SkillEdge = {
          id: edgeId,
          source: sourceId,
          target: targetId,
          type: "skillLock",
          animated: false,
          zIndex: 10,
          style: { stroke: "#dc2626", strokeWidth: 2 },
          data: { curveBelow: false, level: 1 },
        };
        allLockEdges.current = [...allLockEdges.current, newEdge];
        setEdges((eds) => [...eds, newEdge]);
        setLockEdgeLevels((prev) => ({ ...prev, [edgeId]: 1 }));
      },
      [setEdges, setLockEdgeLevels],
    );

    const removeLockEdge = useCallback(
      (sourceId: string, targetId: string) => {
        const edgeId = `lock-${sourceId}-${targetId}`;
        allLockEdges.current = allLockEdges.current.filter((e) => e.id !== edgeId);
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
        setLockEdgeLevels((prev) => {
          const next = { ...prev };
          delete next[edgeId];
          return next;
        });
      },
      [setEdges, setLockEdgeLevels],
    );

    const contextMenuLockSelected = useCallback(
      (direction: "locks" | "lockedBy" | "both") => {
        if (!contextMenu) return;
        const targetId = contextMenu.nodeId;
        const selected = nodes.filter((n) => n.selected && n.type === "skill" && n.id !== targetId);
        for (const sel of selected) {
          if (direction === "locks" || direction === "both") addLockEdge(targetId, sel.id);
          if (direction === "lockedBy" || direction === "both") addLockEdge(sel.id, targetId);
        }
        setContextMenu(null);
      },
      [contextMenu, nodes, addLockEdge],
    );

    const contextMenuUnlockSelected = useCallback(() => {
      if (!contextMenu) return;
      const targetId = contextMenu.nodeId;
      const selected = nodes.filter((n) => n.selected && n.type === "skill" && n.id !== targetId);
      for (const sel of selected) {
        removeLockEdge(targetId, sel.id);
        removeLockEdge(sel.id, targetId);
      }
      setContextMenu(null);
    }, [contextMenu, nodes, removeLockEdge]);

    const contextMenuLockAllSelectedBothWays = useCallback(() => {
      if (!contextMenu) return;
      const allSelected = nodes.filter((n) => n.selected && n.type === "skill");
      for (let i = 0; i < allSelected.length; i++) {
        for (let j = i + 1; j < allSelected.length; j++) {
          addLockEdge(allSelected[i].id, allSelected[j].id);
          addLockEdge(allSelected[j].id, allSelected[i].id);
        }
      }
      setContextMenu(null);
    }, [contextMenu, nodes, addLockEdge]);

    // Edit mode: capture position before drag starts (for swap)
    const onNodeDragStart: OnNodeDrag = useCallback((event, node) => {
      dragStartPos.current = { x: node.position.x, y: node.position.y };
      setIsDragging(true);
    }, []);

    // Edit mode: snap node to grid after drag
    // - If dropped on another node: insert before it (or after if Shift held)
    // - If target is in a group, dragged node joins that group
    // - Placeholder repositions to stay past the rightmost skill
    const onNodeDragStop: OnNodeDrag = useCallback(
      (event, node) => {
        setIsDragging(false);
        const shiftHeld = event.shiftKey;
        const draggedGroupId = editGroups[(node.data as SkillData).nodeId];

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
            setEditGroups((prev) => ({ ...prev, [(node.data as SkillData).nodeId]: targetGroupId }));
            return;
          }
        }

        // If dragged node was in a group but dropped outside it (no target in same group), ungroup it
        if (draggedGroupId) {
          // Place it as standalone at the snapped absolute position
          setEditGroups((prev) => {
            const next = { ...prev };
            delete next[(node.data as SkillData).nodeId];
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
            // Swap: dragged node goes to target's position, target goes to dragged node's original position
            result = nds.map((n) => {
              if (n.id === node.id) return { ...n, position: { ...targetNode.position } };
              if (n.id === targetNode.id) return { ...n, position: { ...origPos } };
              return n;
            });
          } else {
            // No overlap, just snap
            result = nds.map((n) =>
              n.id === node.id ? { ...n, position: { x: snappedX, y: snappedY } } : n,
            );
          }

          // Reposition placeholders for affected rows
          const affectedRows = new Set<number>();
          affectedRows.add(Math.round(snappedY / effectiveNodeHeight));
          if (origPos) affectedRows.add(Math.round(origPos.y / effectiveNodeHeight));
          result = repositionPlaceholders(result, affectedRows);

          return result;
        });
      },
      [setNodes, nodes, editGroups, setEditGroups, repositionPlaceholders],
    );

    const skillNodesToLevel = useAppSelector((state) => state.app.skillNodesToLevel);

    // Handle clicking nodes: edit mode placeholders or normal mode skill rank changes
    const onNodeClick = useCallback(
      (_: React.MouseEvent, node: Node) => {
        if (node.type === "addPlaceholder" && isEditMode) {
          setPlaceholderRow(node.data.row as number);
          setPlaceholderCol(node.data.column as number);
          setIsAddNodeModalOpen(true);
          return;
        }
        if (!isEditMode && node.type === "skill") {
          const data = node.data as SkillData;
          const currentLevel = skillNodesToLevel[data.nodeId] || 0;
          if (isCheckingSkillRequirements && data.unlockRank > currentRank) return;
          if (currentLevel < data.numLevels) {
            dispatch(setSkillNodeLevel({ skillNodeId: data.nodeId, level: currentLevel + 1 }));
          }
        }
      },
      [isEditMode, skillNodesToLevel, isCheckingSkillRequirements, currentRank, dispatch],
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

    // Edit mode: right-click context menu on a skill node or placeholder
    const onNodeContextMenu = useCallback(
      (event: React.MouseEvent, node: Node) => {
        if (node.type === "addPlaceholder" && isEditMode && clipboard.length > 0) {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, nodeType: "addPlaceholder" });
          return;
        }
        if ((!isEditMode && !isRequirementsMode && !isSkillLocksMode) || node.type !== "skill") return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, nodeType: "skill" });
      },
      [isEditMode, isRequirementsMode, isSkillLocksMode],
    );

    // Close context menu on pane click
    const onPaneClick = useCallback(() => {
      setContextMenu(null);
    }, []);

    const onPaneContextMenu = useCallback(
      (event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
        event.preventDefault();
        setContextMenu(null);
        // Clear node selection
        setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
      },
      [setNodes],
    );

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
            result = repositionPlaceholders(result, affectedRows);

            return result;
          });
        }

        setContextMenu(null);
      },
      [contextMenu, nodes, editGroups, setEditGroups, setNodes, repositionPlaceholders],
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
      // Remove nodes and regenerate placeholders for affected rows
      const affectedRows = new Set(toDelete.map((n) => Math.round(n.position.y / effectiveNodeHeight)));
      setNodes((nds) =>
        repositionPlaceholders(
          nds.filter((n) => !deleteIds.has(n.id)),
          affectedRows,
        ),
      );
      setContextMenu(null);
    }, [contextMenu, nodes, setNodes, setEdges, setEditGroups, repositionPlaceholders, effectiveNodeHeight]);

    // Context menu: group nodes (right-clicked + selected, all must be ungrouped)
    const contextMenuGroup = useCallback(
      (connect: boolean) => {
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

        if (connect) {
          // Find the row and column range of the group
          const row = Math.round(toGroup[0].position.y / effectiveNodeHeight);
          const groupCols = toGroup.map((n) => Math.round(n.position.x / nodeWidth));
          const minCol = Math.min(...groupCols);
          const maxCol = Math.max(...groupCols);

          // Find ungrouped node to the left (column = minCol - 1, same row)
          const leftNode = nodes.find(
            (n) =>
              n.type === "skill" &&
              !n.parentId &&
              !editGroups[(n.data as SkillData).nodeId] &&
              !toGroupMap.has(n.id) &&
              Math.round(n.position.y / effectiveNodeHeight) === row &&
              Math.round(n.position.x / nodeWidth) === minCol - 1,
          );

          // Find ungrouped node to the right (column = maxCol + 1, same row)
          const rightNode = nodes.find(
            (n) =>
              n.type === "skill" &&
              !n.parentId &&
              !editGroups[(n.data as SkillData).nodeId] &&
              !toGroupMap.has(n.id) &&
              Math.round(n.position.y / effectiveNodeHeight) === row &&
              Math.round(n.position.x / nodeWidth) === maxCol + 1,
          );

          setEdges((eds) => {
            const newEdges = [...eds];
            if (leftNode) {
              // REQUIRED: left node → each group member
              for (const member of toGroup) {
                const id = `e${leftNode.id}-${member.id}`;
                if (!newEdges.some((e) => e.id === id)) {
                  newEdges.push({
                    id,
                    source: leftNode.id,
                    target: member.id,
                    type: edgeType,
                    animated: false,
                    interactionWidth: 20,
                    style: { stroke: "#ef4444", strokeWidth: 2 },
                  });
                }
              }
            }
            if (rightNode) {
              // SUBSET_REQUIRED: each group member → right node
              for (const member of toGroup) {
                const id = `e${member.id}-${rightNode.id}`;
                if (!newEdges.some((e) => e.id === id)) {
                  newEdges.push({
                    id,
                    source: member.id,
                    target: rightNode.id,
                    type: edgeType,
                    animated: false,
                    interactionWidth: 20,
                    style: { stroke: "#ef4444", strokeWidth: 2 },
                  });
                }
              }
            }
            return newEdges;
          });
        }

        setContextMenu(null);
      },
      [contextMenu, nodes, nextGroupId, editGroups, effectiveNodeHeight, setEditGroups, setEdges],
    );

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

    const contextMenuMoveRow = useCallback(
      (direction: "left" | "right") => {
        if (!contextMenu) return;
        const targetNode = nodes.find((n) => n.id === contextMenu.nodeId);
        if (!targetNode || targetNode.parentId) return;

        const targetRow = Math.round(targetNode.position.y / effectiveNodeHeight);
        const targetCol = Math.round(targetNode.position.x / nodeWidth);

        const delta = direction === "right" ? nodeWidth : -nodeWidth;
        setNodes((nds) => {
          const result = nds.map((n) => {
            if (n.parentId) return n;
            const isGroup = n.className === "reactFlowGroup";
            const isSkill = n.type === "skill";
            if (!isGroup && !isSkill) return n;
            const row = isGroup
              ? Math.round((n.position.y + 15) / effectiveNodeHeight)
              : Math.round(n.position.y / effectiveNodeHeight);
            if (row !== targetRow) return n;
            const col = isGroup
              ? Math.round((n.position.x + 10) / nodeWidth)
              : Math.round(n.position.x / nodeWidth);
            if (col < targetCol) return n;
            return { ...n, position: { ...n.position, x: n.position.x + delta } };
          });
          return repositionPlaceholders(result, new Set([targetRow]));
        });
        setContextMenu(null);
      },
      [contextMenu, nodes, effectiveNodeHeight, repositionPlaceholders],
    );

    // Context menu: move entire group left or right
    const contextMenuMoveGroup = useCallback(
      (direction: "left" | "right") => {
        if (!contextMenu) return;
        const targetNode = nodes.find((n) => n.id === contextMenu.nodeId);
        if (!targetNode) return;
        const targetGroupId = editGroups[(targetNode.data as SkillData).nodeId];
        if (!targetGroupId) return;
        const containerId = `${targetGroupId}_group`;
        const container = nodes.find((n) => n.id === containerId);
        if (!container) return;

        const row = Math.round((container.position.y + 15) / effectiveNodeHeight);
        const containerStartCol = Math.round((container.position.x + 10) / nodeWidth);
        const memberCount = Object.values(editGroups).filter((gid) => gid === targetGroupId).length;

        const delta = direction === "right" ? nodeWidth : -nodeWidth;

        setNodes((nds) => {
          const result = [...nds];

          // Move the group container
          const containerIdx = result.findIndex((n) => n.id === containerId);
          if (containerIdx !== -1) {
            result[containerIdx] = {
              ...result[containerIdx],
              position: { ...result[containerIdx].position, x: result[containerIdx].position.x + delta },
            };
          }

          // Collect non-member nodes on the same row with their column info
          const rowNodesInfo: { idx: number; col: number; colWidth: number }[] = [];
          for (let i = 0; i < result.length; i++) {
            const n = result[i];
            if (n.id === containerId || n.parentId) continue;
            const isGroup = n.className === "reactFlowGroup";
            const isSkill = n.type === "skill";
            if (!isGroup && !isSkill) continue;
            const nRow = isGroup
              ? Math.round((n.position.y + 15) / effectiveNodeHeight)
              : Math.round(n.position.y / effectiveNodeHeight);
            if (nRow !== row) continue;
            const col = isGroup
              ? Math.round((n.position.x + 10) / nodeWidth)
              : Math.round(n.position.x / nodeWidth);
            const colWidth = isGroup ? Math.ceil(((n as any).width ?? nodeWidth) / nodeWidth) : 1;
            rowNodesInfo.push({ idx: i, col, colWidth });
          }

          // Sort for cascade: right = ascending, left = descending
          if (direction === "right") {
            rowNodesInfo.sort((a, b) => a.col - b.col);
          } else {
            rowNodesInfo.sort((a, b) => b.col - a.col);
          }

          // Build occupied set with the group's new columns
          const occupiedCols = new Set<number>();
          const newStartCol = containerStartCol + (direction === "right" ? 1 : -1);
          for (let i = 0; i < memberCount; i++) occupiedCols.add(newStartCol + i);

          // Cascade-push nodes that conflict; collect moves first to allow aborting
          const moves: { idx: number; newCol: number; colWidth: number }[] = [];
          for (const info of rowNodesInfo) {
            let conflicts = false;
            for (let c = 0; c < info.colWidth; c++) {
              if (occupiedCols.has(info.col + c)) {
                conflicts = true;
                break;
              }
            }
            if (conflicts) {
              const newCol = info.col + (direction === "right" ? 1 : -1);
              // Abort entire move if any node would be pushed to negative columns
              if (newCol < 0) return nds;
              moves.push({ idx: info.idx, newCol, colWidth: info.colWidth });
              for (let c = 0; c < info.colWidth; c++) {
                occupiedCols.add(newCol + c);
              }
            }
          }

          // Apply moves
          for (const move of moves) {
            result[move.idx] = {
              ...result[move.idx],
              position: {
                ...result[move.idx].position,
                x: result[move.idx].position.x + delta,
              },
            };
          }

          // Collapse gaps: pull nodes from the opposite side into the vacated column(s)
          // When moving right, the group vacates its old leftmost col — pull right-side nodes left
          // When moving left, the group vacates its old rightmost col — pull left-side nodes right
          const vacatedCol = direction === "right" ? containerStartCol : containerStartCol + memberCount - 1;

          // Re-collect row nodes with updated positions
          const pullNodesInfo: { idx: number; col: number; colWidth: number }[] = [];
          for (let i = 0; i < result.length; i++) {
            const n = result[i];
            if (n.id === containerId || n.parentId) continue;
            const isGroup = n.className === "reactFlowGroup";
            const isSkill = n.type === "skill";
            if (!isGroup && !isSkill) continue;
            const nRow = isGroup
              ? Math.round((n.position.y + 15) / effectiveNodeHeight)
              : Math.round(n.position.y / effectiveNodeHeight);
            if (nRow !== row) continue;
            const col = isGroup
              ? Math.round((n.position.x + 10) / nodeWidth)
              : Math.round(n.position.x / nodeWidth);
            const colWidth = isGroup ? Math.ceil(((n as any).width ?? nodeWidth) / nodeWidth) : 1;
            // Only consider nodes on the trailing side (opposite to move direction)
            if (direction === "right" && col > containerStartCol + memberCount - 1) {
              pullNodesInfo.push({ idx: i, col, colWidth });
            } else if (direction === "left" && col < containerStartCol) {
              pullNodesInfo.push({ idx: i, col, colWidth });
            }
          }

          // Sort: for right move, pull from left (ascending); for left move, pull from right (descending)
          if (direction === "right") {
            pullNodesInfo.sort((a, b) => a.col - b.col);
          } else {
            pullNodesInfo.sort((a, b) => b.col - a.col);
          }

          // Build occupied set from all current positions (group's new pos + all row nodes)
          const allOccupied = new Set<number>();
          for (let i = 0; i < memberCount; i++) allOccupied.add(newStartCol + i);
          for (let i = 0; i < result.length; i++) {
            const n = result[i];
            if (n.id === containerId || n.parentId) continue;
            const isGroup = n.className === "reactFlowGroup";
            const isSkill = n.type === "skill";
            if (!isGroup && !isSkill) continue;
            const nRow = isGroup
              ? Math.round((n.position.y + 15) / effectiveNodeHeight)
              : Math.round(n.position.y / effectiveNodeHeight);
            if (nRow !== row) continue;
            const col = isGroup
              ? Math.round((n.position.x + 10) / nodeWidth)
              : Math.round(n.position.x / nodeWidth);
            const colWidth = isGroup ? Math.ceil(((n as any).width ?? nodeWidth) / nodeWidth) : 1;
            for (let c = 0; c < colWidth; c++) allOccupied.add(col + c);
          }

          // Pull each node toward the gap as far as possible
          const pullDelta = direction === "right" ? -nodeWidth : nodeWidth;
          for (const info of pullNodesInfo) {
            const targetCol = info.col + (direction === "right" ? -1 : 1);
            let canPull = true;
            for (let c = 0; c < info.colWidth; c++) {
              if (allOccupied.has(targetCol + c)) {
                canPull = false;
                break;
              }
            }
            if (canPull) {
              result[info.idx] = {
                ...result[info.idx],
                position: {
                  ...result[info.idx].position,
                  x: result[info.idx].position.x + pullDelta,
                },
              };
              // Update occupied
              for (let c = 0; c < info.colWidth; c++) {
                allOccupied.delete(info.col + c);
                allOccupied.add(targetCol + c);
              }
              info.col = targetCol;
            }
          }

          return repositionPlaceholders(result, new Set([row]));
        });
        setContextMenu(null);
      },
      [contextMenu, nodes, editGroups, effectiveNodeHeight, repositionPlaceholders],
    );

    // Requirements mode: add REQUIRED/SUBSET_REQUIRED edges from context menu
    const contextMenuAddRequirement = useCallback(
      (type: "REQUIRED" | "SUBSET_REQUIRED") => {
        if (!contextMenu) return;
        const selectedNodes = nodes.filter(
          (n) => n.selected && n.type === "skill" && n.id !== contextMenu.nodeId,
        );
        if (selectedNodes.length === 0) {
          setContextMenu(null);
          return;
        }

        setEdges((eds) => {
          const newEdges = [...eds];
          const existingKeys = new Set(eds.map((e) => `${e.source}->${e.target}`));

          for (const sel of selectedNodes) {
            const source = type === "SUBSET_REQUIRED" ? sel.id : contextMenu.nodeId;
            const target = type === "SUBSET_REQUIRED" ? contextMenu.nodeId : sel.id;
            const key = `${source}->${target}`;
            if (existingKeys.has(key)) continue;
            existingKeys.add(key);
            newEdges.push({
              id: `req-${source}-${target}`,
              source,
              target,
              type: "requirement",
              zIndex: 10,
              style: { stroke: "#f59e0b", strokeWidth: 2 },
              data: { curveBelow: type === "REQUIRED" },
              animated: false,
            });
          }
          return newEdges;
        });

        // Auto-group: if SUBSET_REQUIRED with 2+ adjacent selected nodes, group them
        if (type === "SUBSET_REQUIRED" && selectedNodes.length >= 2) {
          const getAbsX = (n: (typeof nodes)[0]) => {
            if (n.parentId) {
              const parent = nodes.find((p) => p.id === n.parentId);
              return (parent?.position.x ?? 0) + n.position.x;
            }
            return n.position.x;
          };
          const sorted = [...selectedNodes].sort((a, b) => getAbsX(a) - getAbsX(b));
          let isAdjacent = true;
          for (let i = 1; i < sorted.length; i++) {
            const prevCol = Math.round(getAbsX(sorted[i - 1]) / nodeWidth);
            const currCol = Math.round(getAbsX(sorted[i]) / nodeWidth);
            if (currCol !== prevCol + 1) {
              isAdjacent = false;
              break;
            }
          }
          if (isAdjacent) {
            const alreadyGrouped = sorted.some((n) => editGroups[n.data.nodeId]);
            if (!alreadyGrouped) {
              const groupId = `editGroup_${nextGroupId}`;
              setNextGroupId((id) => id + 1);
              setEditGroups((prev) => {
                const next = { ...prev };
                for (const node of sorted) {
                  next[node.data.nodeId] = groupId;
                }
                return next;
              });
            }
          }
        }

        setContextMenu(null);
      },
      [contextMenu, nodes, edges, editGroups, nextGroupId, setEdges, setEditGroups],
    );

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
              } as Nodes;
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
              Math.round(absX / nodeWidth) === targetCol &&
              Math.round(absY / effectiveNodeHeight) === targetRow
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

            // Reposition placeholders
            return repositionPlaceholders(updated, new Set([targetRow]));
          });
        }
        setIsAddNodeModalOpen(false);
        setEditingNodeId(undefined);
      },
      [editingNodeId, setNodes, setEditGroups, skillsData, nodes, editGroups, repositionPlaceholders],
    );

    // Edit mode: export skill tree to JSON
    const onExport = useCallback(() => {
      // Build edge expansion to resolve group containers back to individual nodes with proper linkType
      const containerToMembers: Record<string, string[]> = {};
      for (const [nodeId, groupId] of Object.entries(editGroups)) {
        const containerId = `${groupId}_group`;
        if (!containerToMembers[containerId]) containerToMembers[containerId] = [];
        containerToMembers[containerId].push(nodeId);
      }

      const expandedEdges: { source: string; target: string; linkType: "REQUIRED" | "SUBSET_REQUIRED" }[] =
        [];
      for (const e of edges) {
        const sourceMembers = containerToMembers[e.source];
        const targetMembers = containerToMembers[e.target];
        if (sourceMembers && targetMembers) {
          for (const s of sourceMembers) {
            for (const t of targetMembers) {
              expandedEdges.push({ source: s, target: t, linkType: "REQUIRED" });
            }
          }
        } else if (sourceMembers) {
          for (const s of sourceMembers) {
            expandedEdges.push({ source: s, target: e.target, linkType: "SUBSET_REQUIRED" });
          }
        } else if (targetMembers) {
          for (const t of targetMembers) {
            expandedEdges.push({ source: e.source, target: t, linkType: "REQUIRED" });
          }
        } else {
          const sourceGroupId = editGroups[e.source];
          expandedEdges.push({
            source: e.source,
            target: e.target,
            linkType: sourceGroupId ? "REQUIRED" : "SUBSET_REQUIRED",
          });
        }
      }
      const seen = new Set<string>();
      const dedupedEdges = expandedEdges.filter((e) => {
        const key = `${e.source}|${e.target}|${e.linkType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const exportData = {
        nodes: nodes
          .filter((n) => n.type === "skill")
          .map((n) => {
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
              tier: Math.round(absY / effectiveNodeHeight),
              indent: Math.round(absX / nodeWidth),
              faction: n.data.faction || "",
              subculture: n.data.subculture || "",
              label: n.data.label,
              description: n.data.description,
              imgPath: n.data.imgPath || "",
              maxLevel: n.data.numLevels,
              unlockRank: n.data.unlockRank,
              existingSkillKey: n.data.existingSkillKey,
              requiredNumParents: (n.data as any).requiredNumParents || 0,
              effects: n.data.effects,
            };
          }),
        links: dedupedEdges.map((e) => ({
          parent: e.target,
          child: e.source,
          linkType: e.linkType,
        })),
        groups: [...new Set(Object.values(editGroups))].map((gid) => ({
          groupId: gid,
          nodeIds: Object.entries(editGroups)
            .filter(([, g]) => g === gid)
            .map(([nid]) => nid),
        })),
        skillLocks: (() => {
          const nodeToSkillLocks = localNodeToSkillLocks.current || skillsData.nodeToSkillLocks || {};
          const locks: { lockedNodeId: string; lockingSkillKey: string; requiredLevel: number }[] = [];
          for (const [lockedNodeId, skillAndLevelArray] of Object.entries(nodeToSkillLocks)) {
            for (const [lockingSkillKey, requiredLevel] of skillAndLevelArray) {
              locks.push({ lockedNodeId, lockingSkillKey, requiredLevel });
            }
          }
          return locks;
        })(),
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `skill_tree_${subtype}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, [nodes, edges, subtype, editGroups, effectiveNodeHeight, skillsData]);

    const onImport = useCallback(
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = "";

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target?.result as string);
            if (!data.nodes || !Array.isArray(data.nodes)) {
              setNotification({ message: "Invalid JSON: missing nodes array", type: "error" });
              return;
            }

            // Rebuild editGroups from groups array
            const newEditGroups: Record<string, string> = {};
            let maxGroupNum = 0;
            if (data.groups && Array.isArray(data.groups)) {
              for (const group of data.groups) {
                for (const nodeId of group.nodeIds) {
                  newEditGroups[nodeId] = group.groupId;
                }
                const match = group.groupId.match(/editGroup_(\d+)/);
                if (match) maxGroupNum = Math.max(maxGroupNum, parseInt(match[1]));
              }
            }

            // Build skill nodes
            const importedNodes: typeof nodes = data.nodes.map((n: any) => ({
              id: n.nodeId,
              type: "skill" as const,
              position: {
                x: n.indent * nodeWidth,
                y: n.tier * effectiveNodeHeight,
              },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
              data: {
                id: n.skillId,
                nodeId: n.nodeId,
                label: n.label,
                description: n.description,
                numLevels: n.maxLevel,
                unlockRank: n.unlockRank,
                imgPath: n.imgPath || "",
                faction: n.faction || "",
                subculture: n.subculture || "",
                effects: n.effects || [],
                existingSkillKey: n.existingSkillKey,
                requiredNumParents: n.requiredNumParents || 0,
                isAbilityIcon: false,
                isHiddentInUI: false,
                isCheckingSkillRequirements: false,
                origIndent: String(n.indent),
                origTier: String(n.tier),
                row: n.tier,
                skillBackground,
                skillIconBackground,
                skillLevelImg,
                tooltipFrame,
                skillLevelLitIcon,
                skillIcon:
                  n.imgPath && skillsData?.icons[n.imgPath]
                    ? skillsData.icons[n.imgPath]
                    : resolveSkillIcon(n.imgPath),
              },
            }));

            // Build edges from links
            const importedEdges: SkillEdge[] = [];
            if (data.links && Array.isArray(data.links)) {
              for (const link of data.links) {
                const id = `e${link.child}-${link.parent}`;
                importedEdges.push({
                  id,
                  source: link.child,
                  target: link.parent,
                  type: edgeType,
                  animated: false,
                  interactionWidth: 20,
                  style: { stroke: "#ef4444", strokeWidth: 2 },
                });
              }
            }

            // Restore skill locks
            if (data.skillLocks && Array.isArray(data.skillLocks)) {
              const newLocks: Record<string, [string, number][]> = {};
              for (const lock of data.skillLocks) {
                if (!newLocks[lock.lockedNodeId]) newLocks[lock.lockedNodeId] = [];
                newLocks[lock.lockedNodeId].push([lock.lockingSkillKey, lock.requiredLevel]);
              }
              localNodeToSkillLocks.current = newLocks;
            } else {
              localNodeToSkillLocks.current = null;
            }

            setEditGroups(newEditGroups);
            setNextGroupId(maxGroupNum + 1);
            setNodes(importedNodes);
            setEdges(importedEdges);
            setNotification({ message: "Skill tree imported successfully", type: "success" });
          } catch (err: any) {
            console.error("Failed to import skill tree:", err);
            setNotification({ message: `Failed to import: ${err.message}`, type: "error" });
          }
        };
        reader.readAsText(file);
      },
      [effectiveNodeHeight, setNodes, setEdges, skillsData],
    );

    const importInputRef = useRef<HTMLInputElement>(null);

    // Edit mode: save skill tree as a .pack file
    const handleSavePackConfirm = useCallback(async () => {
      if (!savePackName.trim()) return;
      setIsSavePackProcessing(true);
      try {
        const skillNodes = nodes.filter((n) => n.type === "skill");

        // Build edges with linkType, reversing group container retargeting back to individual nodes
        const containerToMembers: Record<string, string[]> = {};
        for (const [nodeId, groupId] of Object.entries(editGroups)) {
          const containerId = `${groupId}_group`;
          if (!containerToMembers[containerId]) containerToMembers[containerId] = [];
          containerToMembers[containerId].push(nodeId);
        }

        const expandedEdges: { source: string; target: string; linkType: "REQUIRED" | "SUBSET_REQUIRED" }[] =
          [];
        for (const e of edges) {
          const sourceMembers = containerToMembers[e.source];
          const targetMembers = containerToMembers[e.target];

          if (sourceMembers && targetMembers) {
            for (const s of sourceMembers) {
              for (const t of targetMembers) {
                expandedEdges.push({ source: s, target: t, linkType: "REQUIRED" });
              }
            }
          } else if (sourceMembers) {
            for (const s of sourceMembers) {
              expandedEdges.push({ source: s, target: e.target, linkType: "SUBSET_REQUIRED" });
            }
          } else if (targetMembers) {
            for (const t of targetMembers) {
              expandedEdges.push({ source: e.source, target: t, linkType: "REQUIRED" });
            }
          } else {
            const sourceGroupId = editGroups[e.source];
            expandedEdges.push({
              source: e.source,
              target: e.target,
              linkType: sourceGroupId ? "REQUIRED" : "SUBSET_REQUIRED",
            });
          }
        }

        // Deduplicate: group container expansion can produce duplicate edges
        const seen = new Set<string>();
        const dedupedEdges = expandedEdges.filter((e) => {
          const key = `${e.source}|${e.target}|${e.linkType}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

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
          edges: dedupedEdges,
          skillLocks: [],
          packName: savePackName.trim(),
          packDirectory: savePackDirectory || "",
          cloneAllSkills: savePackCloneAll,
          tableNameOverride: customTableName.trim() || undefined,
          keyPrefix: customKeyPrefix.trim() || undefined,
        };

        // Add skill locks data
        const skillLocksArray: { lockedNodeId: string; lockingSkillKey: string; requiredLevel: number }[] =
          [];
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
          setNotification({ message: `Pack saved: ${result.packName}`, type: "success" });
          setIsSavePackModalOpen(false);
        } else {
          console.error("Failed to save pack:", result?.error);
          setNotification({
            message: `Failed to save pack: ${result?.error || "Unknown error"}`,
            type: "error",
          });
        }
      } finally {
        setIsSavePackProcessing(false);
      }
    }, [
      savePackName,
      savePackDirectory,
      savePackCloneAll,
      nodes,
      edges,
      subtype,
      skillsData,
      editGroups,
      effectiveNodeHeight,
      customTableName,
      customKeyPrefix,
    ]);

    const handleSaveChangesConfirm = useCallback(async () => {
      if (!savePackName.trim()) return;
      setIsSavePackProcessing(true);
      try {
        const ts = Date.now().toString();
        const kp = customKeyPrefix.trim();
        const makeNodeKey = (row: number, col: number) =>
          kp ? `${kp}_node_${row}_${col}` : `custom_node_${ts}_${row}_${col}`;
        const makeSkillKey = (row: number, col: number) =>
          kp ? `${kp}_skill_${row}_${col}` : `custom_skill_${ts}_${row}_${col}`;
        const skillNodes = nodes.filter((n) => n.type === "skill");

        // Build group expansion maps (same as handleSavePackConfirm)
        const containerToMembers: Record<string, string[]> = {};
        for (const [nodeId, groupId] of Object.entries(editGroups)) {
          const containerId = `${groupId}_group`;
          if (!containerToMembers[containerId]) containerToMembers[containerId] = [];
          containerToMembers[containerId].push(nodeId);
        }

        // Expand and dedup current edges
        const expandedEdges: { source: string; target: string; linkType: "REQUIRED" | "SUBSET_REQUIRED" }[] =
          [];
        for (const e of edges) {
          const sourceMembers = containerToMembers[e.source];
          const targetMembers = containerToMembers[e.target];
          if (sourceMembers && targetMembers) {
            for (const s of sourceMembers) {
              for (const t of targetMembers) {
                expandedEdges.push({ source: s, target: t, linkType: "REQUIRED" });
              }
            }
          } else if (sourceMembers) {
            for (const s of sourceMembers) {
              expandedEdges.push({ source: s, target: e.target, linkType: "SUBSET_REQUIRED" });
            }
          } else if (targetMembers) {
            for (const t of targetMembers) {
              expandedEdges.push({ source: e.source, target: t, linkType: "REQUIRED" });
            }
          } else {
            const sourceGroupId = editGroups[e.source];
            expandedEdges.push({
              source: e.source,
              target: e.target,
              linkType: sourceGroupId ? "REQUIRED" : "SUBSET_REQUIRED",
            });
          }
        }
        const seenEdge = new Set<string>();
        const dedupedEdges = expandedEdges.filter((e) => {
          const key = `${e.source}|${e.target}|${e.linkType}`;
          if (seenEdge.has(key)) return false;
          seenEdge.add(key);
          return true;
        });

        // Build original node map from skillsData
        // skill.x = row (from indent), skill.y = adjusted column (from tier after getSkills repositioning)
        const origNodeMap = new Map<string, Skill>();
        for (const skill of skillsData.currentSkills) {
          origNodeMap.set(skill.nodeId, skill);
        }

        // Build original edge set: "parentNodeKey|childNodeKey|linkType"
        const origEdgeSet = new Set<string>();
        for (const [parentKey, children] of Object.entries(skillsData.nodeLinks)) {
          for (const link of children) {
            origEdgeSet.add(`${parentKey}|${link.child}|${link.linkType || "REQUIRED"}`);
          }
        }

        // Build current edges per node (as parent or child)
        const currentEdgesForNode = new Map<string, Set<string>>();
        for (const e of dedupedEdges) {
          if (!currentEdgesForNode.has(e.source)) currentEdgesForNode.set(e.source, new Set());
          if (!currentEdgesForNode.has(e.target)) currentEdgesForNode.set(e.target, new Set());
          const edgeKey = `${e.source}|${e.target}|${e.linkType}`;
          currentEdgesForNode.get(e.source)!.add(edgeKey);
          currentEdgesForNode.get(e.target)!.add(edgeKey);
        }

        // Build original edges per node
        const origEdgesForNode = new Map<string, Set<string>>();
        for (const [parentKey, children] of Object.entries(skillsData.nodeLinks)) {
          if (!origEdgesForNode.has(parentKey)) origEdgesForNode.set(parentKey, new Set());
          for (const link of children) {
            if (!origEdgesForNode.has(link.child)) origEdgesForNode.set(link.child, new Set());
            const edgeKey = `${parentKey}|${link.child}|${link.linkType || "REQUIRED"}`;
            origEdgesForNode.get(parentKey)!.add(edgeKey);
            origEdgesForNode.get(link.child)!.add(edgeKey);
          }
        }

        // Compute absolute positions for current nodes
        const getAbsPos = (n: (typeof skillNodes)[0]) => {
          if (n.parentId) {
            const parent = nodes.find((p) => p.id === n.parentId);
            return {
              x: (parent?.position.x ?? 0) + n.position.x,
              y: (parent?.position.y ?? 0) + n.position.y,
            };
          }
          return { x: n.position.x, y: n.position.y };
        };

        const overrideNodes: SaveSkillsChangesPayload["overrideNodes"] = [];
        const replacedNodes: SaveSkillsChangesPayload["replacedNodes"] = [];
        const newNodes: SaveSkillsChangesPayload["newNodes"] = [];
        const deletedNodeKeys: string[] = [];
        const currentNodeIds = new Set<string>();

        // Map from original nodeId -> replacement key (for edge remapping)
        const nodeKeyMap = new Map<string, string>(); // oldNodeId -> finalNodeKey

        for (const n of skillNodes) {
          const data = n.data as SkillData;
          const abs = getAbsPos(n);
          const currentRow = Math.round(abs.y / effectiveNodeHeight);
          const currentCol = Math.round(abs.x / nodeWidth);

          if (data.existingSkillKey) {
            // Existing node — compare against original
            const origNodeId = data.nodeId;
            currentNodeIds.add(origNodeId);
            const origSkill = origNodeMap.get(origNodeId);
            if (!origSkill) {
              // Node has existingSkillKey but isn't in original data — newly added node reusing an existing skill
              const newNodeKey = makeNodeKey(currentRow, currentCol);
              nodeKeyMap.set(n.id, newNodeKey);
              newNodes.push({
                newNodeKey,
                newSkillKey: data.existingSkillKey,
                tier: currentCol,
                indent: currentRow,
                faction: data.faction || "",
                subculture: data.subculture || "",
                requiredNumParents: (data as any).requiredNumParents || 0,
                label: data.label,
                description: data.description,
                imgPath: data.imgPath || "",
                unlockRank: data.unlockRank,
                effects: data.effects,
                maxLevel: data.numLevels,
              });
              continue;
            }

            // Check if connections changed
            const origEdges = origEdgesForNode.get(origNodeId) || new Set<string>();
            const currEdges = currentEdgesForNode.get(n.id) || new Set<string>();
            // Remap current edges that reference ReactFlow node IDs to original node IDs
            // For existing nodes, n.id === origNodeId (the ReactFlow id IS the nodeId)
            const edgesChanged =
              origEdges.size !== currEdges.size ||
              [...origEdges].some((e) => !currEdges.has(e)) ||
              [...currEdges].some((e) => !origEdges.has(e));

            if (edgesChanged) {
              // Connections changed — need replacement
              const newKey = makeNodeKey(currentRow, currentCol);
              nodeKeyMap.set(origNodeId, newKey);
              replacedNodes.push({
                originalNodeKey: origNodeId,
                newNodeKey: newKey,
                characterSkillKey: data.existingSkillKey,
                tier: currentCol,
                indent: currentRow,
                faction: data.faction || "",
                subculture: data.subculture || "",
                requiredNumParents: (data as any).requiredNumParents || 0,
              });
            } else {
              // Check if position or skill changed
              // Compare against visual grid positions (skill.x = row, skill.y = adjusted col)
              const posChanged = currentRow !== origSkill.x || currentCol !== origSkill.y;
              const skillChanged = data.existingSkillKey !== origSkill.id;

              if (posChanged || skillChanged) {
                nodeKeyMap.set(origNodeId, origNodeId); // same key
                overrideNodes.push({
                  originalNodeKey: origNodeId,
                  characterSkillKey: data.existingSkillKey,
                  tier: currentCol,
                  indent: currentRow,
                  faction: data.faction || "",
                  subculture: data.subculture || "",
                  requiredNumParents: (data as any).requiredNumParents || 0,
                });
              } else {
                // Unchanged
                nodeKeyMap.set(origNodeId, origNodeId);
              }
            }
          } else {
            // New node (pasted/added)
            const newNodeKey = makeNodeKey(currentRow, currentCol);
            const newSkillKey = makeSkillKey(currentRow, currentCol);
            nodeKeyMap.set(n.id, newNodeKey);
            newNodes.push({
              newNodeKey,
              newSkillKey,
              tier: currentCol,
              indent: currentRow,
              faction: data.faction || "",
              subculture: data.subculture || "",
              requiredNumParents: (data as any).requiredNumParents || 0,
              label: data.label,
              description: data.description,
              imgPath: data.imgPath || "",
              unlockRank: data.unlockRank,
              effects: data.effects,
              maxLevel: data.numLevels,
            });
          }
        }

        // Detect deleted nodes
        for (const [origNodeId] of origNodeMap) {
          if (!currentNodeIds.has(origNodeId)) {
            deletedNodeKeys.push(origNodeId);
          }
        }

        // Build edges for replaced and new nodes (using final node keys)
        const changedNodeIds = new Set<string>([
          ...replacedNodes.map((n) => n.newNodeKey),
          ...newNodes.map((n) => n.newNodeKey),
        ]);
        // We need edges where at least one endpoint is a replaced or new node
        const payloadEdges: SaveSkillsChangesPayload["edges"] = [];
        for (const e of dedupedEdges) {
          const sourceKey = nodeKeyMap.get(e.source) || e.source;
          const targetKey = nodeKeyMap.get(e.target) || e.target;
          // Include edge if either end is a replaced/new node
          if (changedNodeIds.has(sourceKey) || changedNodeIds.has(targetKey)) {
            payloadEdges.push({
              parentKey: sourceKey,
              childKey: targetKey,
              linkType: e.linkType,
            });
          }
        }

        // Skill locks for changed nodes
        const skillLocksArray: SaveSkillsChangesPayload["skillLocks"] = [];
        const nodeToSkillLocks = localNodeToSkillLocks.current || skillsData.nodeToSkillLocks || {};
        for (const [lockedNodeId, locks] of Object.entries(nodeToSkillLocks)) {
          const finalKey = nodeKeyMap.get(lockedNodeId);
          if (!finalKey || !changedNodeIds.has(finalKey)) continue;
          for (const [lockingSkillKey, requiredLevel] of locks) {
            skillLocksArray.push({ lockedNodeKey: finalKey, lockingSkillKey, requiredLevel });
          }
        }

        const payload: SaveSkillsChangesPayload = {
          subtype,
          subtypeIndex: skillsData.currentSubtypeIndex,
          overrideNodes,
          replacedNodes,
          newNodes,
          deletedNodeKeys,
          edges: payloadEdges,
          skillLocks: skillLocksArray,
          packName: savePackName.trim(),
          packDirectory: savePackDirectory || "",
          tableNameOverride: customTableName.trim() || undefined,
          keyPrefix: customKeyPrefix.trim() || undefined,
        };

        console.log("Save Changes payload:", payload);
        const result = await window.api?.saveSkillsChanges(payload);
        if (result?.success) {
          console.log("Changes pack saved:", result.packName);
          setNotification({ message: `Changes pack saved: ${result.packName}`, type: "success" });
          setIsSavePackModalOpen(false);
        } else {
          console.error("Failed to save changes pack:", result?.error);
          setNotification({
            message: `Failed to save changes pack: ${result?.error || "Unknown error"}`,
            type: "error",
          });
        }
      } finally {
        setIsSavePackProcessing(false);
      }
    }, [
      savePackName,
      savePackDirectory,
      nodes,
      edges,
      subtype,
      skillsData,
      editGroups,
      effectiveNodeHeight,
      customTableName,
      customKeyPrefix,
    ]);

    const handleResetConfirm = useCallback(() => {
      setIsResetConfirmOpen(false);

      setIsRequirementsMode(false);
      setIsSkillLocksMode(false);

      setEditGroups({});
      setNextGroupId(1);
      setLockEdgeLevels({});
      savedEditEdges.current = [];
      savedLocksEdges.current = [];
      allLockEdges.current = [];
      localNodeToSkillLocks.current = null;
      setEditingNodeId(undefined);
      setEditingEdgeId(null);
      setContextMenu(null);

      // Force the refresh effect to fire and rebuild nodes/edges from skillsData
      setResetCounter((c) => c + 1);
      // Skip the transition effect so it doesn't corrupt the freshly rebuilt nodes
      skipTransitionEffect.current = true;
      // Exit edit mode
      setIsEditMode(false);
    }, []);

    const handleSelectSavePackDirectory = useCallback(async () => {
      const selectedDirectory = await window.api?.selectDirectory();
      if (selectedDirectory) setSavePackDirectory(selectedDirectory);
    }, []);

    // Requirements mode: expand group edges to individual node-to-node curved edges
    const enterRequirementsMode = useCallback(() => {
      // If transitioning from skill locks mode, use the saved edit edges (not the current skill lock edges)
      const editEdges = isSkillLocksMode ? savedLocksEdges.current : edges;
      savedEditEdges.current = [...editEdges];

      // Build group member map: groupId → member nodeIds
      const groupToMembers: Record<string, string[]> = {};
      for (const [nodeId, groupId] of Object.entries(editGroups)) {
        if (!groupToMembers[groupId]) groupToMembers[groupId] = [];
        groupToMembers[groupId].push(nodeId);
      }

      const reqEdges: SkillEdge[] = [];
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
          animated: false,
        });
      };

      for (const edge of editEdges) {
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
          const tgtContainerGroupId = Object.keys(groupToMembers).find(
            (gid) => `${gid}_group` === edge.target,
          );
          if (tgtContainerGroupId && groupToMembers[tgtContainerGroupId]) {
            for (const memberId of groupToMembers[tgtContainerGroupId]) {
              addReqEdge(edge.source, memberId, "#f59e0b", true);
            }
          }
        } else {
          // Check if target is a member of a group → expand to all group members
          const targetGroupId = editGroups[edge.target];
          if (targetGroupId && groupToMembers[targetGroupId]) {
            const key = `${edge.source}->${targetGroupId}`;
            if (!processedGroupTargets.has(key)) {
              processedGroupTargets.add(key);
              for (const memberId of groupToMembers[targetGroupId]) {
                addReqEdge(edge.source, memberId, "#f59e0b", true);
              }
            }
          } else {
            // Individual REQUIRED edge (curves below)
            addReqEdge(edge.source, edge.target, "#f59e0b", true);
          }
        }
      }

      setEdges(reqEdges);
      setIsRequirementsMode(true);
      if (isSkillLocksMode) setIsSkillLocksMode(false);
    }, [edges, editGroups, groupIdToColor, setEdges, isSkillLocksMode]);

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
      const newEdges: SkillEdge[] = [];
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

      // Preserve manually created groups that have no requirement edges
      for (const [nodeId, groupId] of Object.entries(editGroups)) {
        if (!newEditGroups[nodeId]) {
          newEditGroups[nodeId] = groupId;
        }
      }

      // Retarget edges: if source/target is a grouped node, point to group container
      const groupMemberCounts: Record<string, number> = {};
      for (const gid of Object.values(newEditGroups)) {
        groupMemberCounts[gid] = (groupMemberCounts[gid] || 0) + 1;
      }
      const nodeToContainer: Record<string, string> = {};
      for (const [nodeId, groupId] of Object.entries(newEditGroups)) {
        if ((groupMemberCounts[groupId] || 0) >= 2) {
          nodeToContainer[nodeId] = `${groupId}_group`;
        }
      }
      // Deduplicate edges after retargeting (multiple members → same container)
      const seenEdgeKeys = new Set<string>();
      const retargetedEdges: typeof newEdges = [];
      for (const e of newEdges) {
        const source = nodeToContainer[e.source] || e.source;
        const target = nodeToContainer[e.target] || e.target;
        const key = `${source}->${target}`;
        if (seenEdgeKeys.has(key)) continue;
        seenEdgeKeys.add(key);
        retargetedEdges.push({ ...e, source, target });
      }

      setNextGroupId(groupCounter);
      setEditGroups(newEditGroups);
      setEdges(retargetedEdges);
      setIsRequirementsMode(false);

      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== "skill") return n;
          const sources = targetToSources[n.id];
          const requiredNumParents = sources && sources.length > 1 ? sources.length : 0;
          return { ...n, data: { ...n.data, requiredNumParents } };
        }),
      );
    }, [edges, nextGroupId, editGroups, setEdges, setNodes, setEditGroups]);

    // Skill Locks mode: enter
    const enterSkillLocksMode = useCallback(() => {
      // If transitioning from requirements mode, use the saved edit edges (not the current requirement edges)
      const editEdges = isRequirementsMode ? savedEditEdges.current : edges;
      savedLocksEdges.current = [...editEdges];
      const nodeToSkillLocks = localNodeToSkillLocks.current || skillsData.nodeToSkillLocks || {};
      const lockEdges: SkillEdge[] = [];
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
            zIndex: 10,
            style: { stroke: "#dc2626", strokeWidth: 2 },
            data: { curveBelow: false, level: requiredLevel },
          });
          edgeLevels[edgeId] = requiredLevel;
        }
      }

      setLockEdgeLevels(edgeLevels);
      allLockEdges.current = lockEdges;
      setEdges(lockEdges);
      setIsSkillLocksMode(true);
      if (isRequirementsMode) setIsRequirementsMode(false);
    }, [edges, nodes, skillsData, setEdges, isRequirementsMode]);

    // Skill Locks mode: filter edges by selected nodes
    const lockSelectionKey = useMemo(() => {
      if (!isSkillLocksMode) return "";
      return nodes
        .filter((n) => n.selected && n.type === "skill")
        .map((n) => n.id)
        .sort()
        .join(",");
    }, [nodes, isSkillLocksMode]);

    useEffect(() => {
      if (!isSkillLocksMode || allLockEdges.current.length === 0) return;
      if (lockSelectionKey === "") {
        setEdges(allLockEdges.current.map((e) => ({ ...e, style: { ...e.style, stroke: "#dc2626" } })));
        setNodes((nds) => nds.map((n) => ({ ...n, style: { ...n.style, opacity: 1 } })));
      } else {
        const selectedIds = new Set(lockSelectionKey.split(","));
        const filtered = allLockEdges.current
          .filter((e) => selectedIds.has(e.source) || selectedIds.has(e.target))
          .map((e) => ({
            ...e,
            style: {
              ...e.style,
              stroke: selectedIds.has(e.source) ? "#f97316" : "#dc2626",
            },
          }));
        const connectedIds = new Set<string>();
        for (const e of filtered) {
          connectedIds.add(e.source);
          connectedIds.add(e.target);
        }
        for (const id of selectedIds) connectedIds.add(id);
        setEdges(filtered);
        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            style: { ...n.style, opacity: connectedIds.has(n.id) ? 1 : 0.25 },
          })),
        );
      }
    }, [lockSelectionKey, isSkillLocksMode, setEdges, setNodes]);

    // Skill Locks mode: exit
    const exitSkillLocksMode = useCallback(() => {
      const newNodeToSkillLocks: Record<string, [string, number][]> = {};

      for (const edge of allLockEdges.current) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode || sourceNode.type !== "skill" || targetNode.type !== "skill")
          continue;

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
      setNodes((nds) => nds.map((n) => ({ ...n, style: { ...n.style, opacity: 1 } })));
      setIsSkillLocksMode(false);
      setLockEdgeLevels({});
    }, [nodes, lockEdgeLevels, setEdges, setNodes, skillsData]);

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
        return {
          ...e,
          style: { ...e.style, stroke: color, strokeWidth: 2 },
          data: { ...e.data, curveBelow },
        };
      });

      if (needsUpdate) setEdges(updated);
    }, [reqEdgeKey, editGroups, groupIdToColor]);

    // Reset faction filter when subtype changes
    useEffect(() => {
      if (skipSubtypeReset.current) {
        skipSubtypeReset.current = false;
        return;
      }
      setFactionFilter("all");
      if (isEditMode) {
        skipTransitionEffect.current = true;
        setResetCounter((c) => c + 1);
      }
      setIsRequirementsMode(false);
      setIsSkillLocksMode(false);
      setEditGroups({});
      setNextGroupId(1);
      setLockEdgeLevels({});
      savedEditEdges.current = [];
      savedLocksEdges.current = [];
      allLockEdges.current = [];
      setIsEditMode(false);
      localNodeToSkillLocks.current = null;
    }, [skillsData?.currentSubtype]);

    // Initialize editGroups from existing skill groups when entering edit mode
    useEffect(() => {
      if (isEditMode) {
        // Only initialize from original skills if editGroups is empty (first entry).
        // On re-entry, preserve runtime-modified groups (insert-and-group, paste, etc.)
        setEditGroups((prev) => {
          if (Object.keys(prev).length > 0) return prev;
          const initial: Record<string, string> = {};
          for (const skill of skills) {
            if (skill.group) {
              initial[skill.nodeId] = skill.group;
            }
          }
          return initial;
        });
      }
    }, [isEditMode]);

    // Auto-dismiss notification after 4 seconds
    useEffect(() => {
      if (!notification) return;
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }, [notification]);

    // ReactFlow won't refresh when things like isShowingHiddenModifiersInsideSkills change, so force it
    useEffect(() => {
      if (isRestoringSnapshot.current) return;
      if (isEditMode && !skipTransitionEffect.current) return; // edit mode manages its own nodes
      setNodes(deepClone(skillNodes));
      setEdges(deepClone(initialEdges));
    }, [
      skillsData,
      isShowingHiddenModifiersInsideSkills,
      isShowingHiddentSkills,
      isCheckingSkillRequirements,
      factionFilter,
      resetCounter,
    ]);

    // Clear snapshot restoration flag after all mount effects have fired
    useEffect(() => {
      if (isRestoringSnapshot.current) {
        const id = requestAnimationFrame(() => {
          isRestoringSnapshot.current = false;
        });
        return () => cancelAnimationFrame(id);
      }
    }, []);

    // Handle edit mode transitions: transform current nodes in-place instead of recomputing from scratch
    useEffect(() => {
      const prev = prevIsEditModeRef.current;
      prevIsEditModeRef.current = isEditMode;
      if (prev === isEditMode) return; // No transition

      if (skipTransitionEffect.current) {
        skipTransitionEffect.current = false;
        return;
      }

      if (!isEditMode) {
        // Leaving edit mode: transform current nodes to normal-mode layout
        const newHeight = nodeHeight;
        const oldHeight = editModeNodeHeight;

        setNodes((currentNodes) => {
          let result = currentNodes
            // Remove placeholder nodes
            .filter((n) => n.type !== "addPlaceholder")
            .map((n) => {
              if (n.type === "skill" && !(n.data as any)?.isGrouping) {
                // Rescale Y for ungrouped nodes
                if (!n.parentId) {
                  const row = Math.round(n.position.y / oldHeight);
                  return {
                    ...n,
                    data: { ...n.data, isEditMode: false, editGroupColor: undefined },
                    position: { x: n.position.x, y: row * newHeight },
                  };
                }
                // Grouped nodes: update data only (positions are relative to container)
                return {
                  ...n,
                  data: { ...n.data, isEditMode: false, editGroupColor: undefined },
                };
              }
              // Group containers: rescale Y position and update height
              if (n.className === "reactFlowGroup" && (n.data as any)?.isGrouping) {
                const row = Math.round((n.position.y + 15) / oldHeight);
                return {
                  ...n,
                  position: { x: n.position.x, y: row * newHeight - 15 },
                  height: newHeight - 10,
                  style: {
                    ...((n.style as Record<string, string>) || {}),
                    border: "2px solid rgb(42,11,13)",
                  },
                };
              }
              return n;
            });
          return result;
        });

        // Update edges: retarget to group containers and set normal-mode styling
        setEdges((currentEdges) => {
          // Build a map of nodeId -> groupContainerId for retargeting
          const nodeToContainer: Record<string, string> = {};
          for (const [nodeId, groupId] of Object.entries(editGroups)) {
            nodeToContainer[nodeId] = `${groupId}_group`;
          }
          return currentEdges.map((e) => {
            // Remove edit-mode styling
            const { interactionWidth, ...rest } = e as any;
            return {
              ...rest,
              source: nodeToContainer[e.source] || e.source,
              target: nodeToContainer[e.target] || e.target,
              style: { opacity: 0 },
            };
          });
        });
      } else {
        // Entering edit mode: transform current nodes to edit-mode layout
        const newHeight = editModeNodeHeight;
        const oldHeight = nodeHeight;

        setNodes((currentNodes) => {
          let result = currentNodes.map((n) => {
            if (n.type === "skill" && !(n.data as any)?.isGrouping) {
              const groupColor = groupIdToColor[editGroups[(n.data as SkillData).nodeId]];
              if (!n.parentId) {
                const row = Math.round(n.position.y / oldHeight);
                return {
                  ...n,
                  data: { ...n.data, isEditMode: true, editGroupColor: groupColor },
                  position: { x: n.position.x, y: row * newHeight },
                };
              }
              return {
                ...n,
                data: { ...n.data, isEditMode: true, editGroupColor: groupColor },
              };
            }
            // Group containers: rescale Y and update height
            if (n.className === "reactFlowGroup" && (n.data as any)?.isGrouping) {
              const row = Math.round((n.position.y + 15) / oldHeight);
              const groupId = n.id.replace(/_group$/, "");
              const groupColor = groupIdToColor[groupId];
              return {
                ...n,
                position: { x: n.position.x, y: row * newHeight - 15 },
                height: newHeight - 10,
                style: {
                  ...((n.style as Record<string, string>) || {}),
                  border: `2px solid ${groupColor || "rgb(42,11,13)"}`,
                },
              };
            }
            return n;
          });

          // Add placeholder nodes
          const allRows = new Set<number>();
          for (const n of result) {
            if (n.type === "skill" && !n.parentId) {
              allRows.add(Math.round(n.position.y / newHeight));
            }
          }
          for (let r = 0; r < 7; r++) allRows.add(r);
          result = repositionPlaceholders(result, allRows);

          return result;
        });

        // Update edges: keep group container retargeting, just set edit-mode styling
        setEdges((currentEdges) =>
          currentEdges.map((e) => ({
            ...e,
            interactionWidth: 20,
            style: { stroke: "#ef4444", strokeWidth: 2 },
          })),
        );
      }
    }, [isEditMode]);

    // Recalculate group containers and member positions from current nodes state
    useEffect(() => {
      if (!isEditMode) return;
      if (skipEditGroupsEffect.current) {
        skipEditGroupsEffect.current = false;
        return;
      }

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

        // Remove old group containers (both editGroup_ and original data groups)
        // They get recreated below for groups still in editGroups
        const activeGroupIds = new Set(Object.values(editGroups));
        let result = currentNodes.filter((n) => {
          if (n.className === "reactFlowGroup" && (n.data as any)?.isGrouping) {
            const groupId = n.id.replace(/_group$/, "");
            return activeGroupIds.has(groupId);
          }
          return true;
        });

        // Remove parentId from nodes no longer in a valid group (< 2 members)
        // and restore their absolute position from the old container
        const validGroupIds = new Set(
          Object.entries(groupMembers)
            .filter(([, m]) => m.length >= 2)
            .map(([gid]) => gid),
        );
        result = result.map((n) => {
          if (
            n.parentId &&
            n.parentId.endsWith("_group") &&
            !validGroupIds.has(n.parentId.replace(/_group$/, ""))
          ) {
            // Restore absolute position using the old container (from currentNodes, before removal)
            const oldContainer = currentNodes.find((c) => c.id === n.parentId);
            const absX = oldContainer ? oldContainer.position.x + n.position.x : n.position.x;
            const absY = oldContainer ? oldContainer.position.y + n.position.y : n.position.y;
            return { ...n, parentId: undefined, position: { x: absX, y: absY } };
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
            height: nodeHeight + 10,
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
            } as Nodes;
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

          // Assign columns: compact items to remove data gaps
          // unless it would overlap with a previous item, in which case it shifts right
          let minNextCol = 0;
          const nodeNewPositions = new Map<string, number>();
          const groupNewPositions = new Map<string, number>();
          for (const item of items) {
            if (item.kind === "group") {
              const col = minNextCol;
              groupNewPositions.set(item.groupId, col);
              minNextCol = col + item.memberCount;
            } else {
              const col = minNextCol;
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

          // Reposition placeholders for this row
          result = repositionPlaceholdersRef.current(result, new Set([row]));
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

      // Retarget edges: if an edge targets an individual node that is now inside a group,
      // point it at the group container instead
      const groupToMembers: Record<string, string[]> = {};
      for (const [nodeId, groupId] of Object.entries(editGroups)) {
        if (!groupToMembers[groupId]) groupToMembers[groupId] = [];
        groupToMembers[groupId].push(nodeId);
      }
      const validGroups = new Set(
        Object.entries(groupToMembers)
          .filter(([, m]) => m.length >= 2)
          .map(([gid]) => gid),
      );
      const nodeToGroupContainer: Record<string, string> = {};
      for (const [nodeId, groupId] of Object.entries(editGroups)) {
        if (validGroups.has(groupId)) {
          nodeToGroupContainer[nodeId] = `${groupId}_group`;
        }
      }

      if (
        Object.keys(nodeToGroupContainer).length > 0 &&
        !isRequirementsModeRef.current &&
        !isSkillLocksModeRef.current
      ) {
        setEdges((eds) => {
          const seenKeys = new Set<string>();
          const result: typeof eds = [];
          for (const e of eds) {
            const source = nodeToGroupContainer[e.source] || e.source;
            const target = nodeToGroupContainer[e.target] || e.target;
            const key = `${source}->${target}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            if (source !== e.source || target !== e.target) {
              result.push({ ...e, source, target });
            } else {
              result.push(e);
            }
          }
          return result;
        });
      }
    }, [editGroups]);

    return (
      <div
        className={`w-full h-full ${isEditMode ? "" : "hideReactFlowHandles"} ${isDragging ? "hide-placeholders" : ""}`}
      >
        <ReactFlow
          key={skillsData.currentSubtype}
          nodes={nodes}
          edges={edges}
          onNodesChange={
            isEditMode
              ? onNodesChange
              : (changes) => onNodesChange(changes.filter((c) => c.type !== "select"))
          }
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={{ hideAttribution: true }}
          snapToGrid={isEditMode && !isRequirementsMode && !isSkillLocksMode}
          snapGrid={[nodeWidth, effectiveNodeHeight]}
          nodesDraggable={isEditMode && !isRequirementsMode && !isSkillLocksMode}
          nodesConnectable={isEditMode}
          elementsSelectable={true}
          onConnect={isEditMode ? onConnect : undefined}
          deleteKeyCode={isEditMode && !isRequirementsMode && !isSkillLocksMode ? "Delete" : null}
          onNodesDelete={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodesDelete : undefined}
          onEdgeClick={isEditMode ? onEdgeClick : undefined}
          onNodeDragStart={
            isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeDragStart : undefined
          }
          onNodeDragStop={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeDragStop : undefined}
          onNodeClick={isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeClick : undefined}
          onNodeDoubleClick={
            isEditMode && !isRequirementsMode && !isSkillLocksMode ? onNodeDoubleClick : undefined
          }
          onNodeContextMenu={
            isEditMode || isRequirementsMode || isSkillLocksMode ? onNodeContextMenu : undefined
          }
          onPaneClick={isEditMode ? onPaneClick : undefined}
          onPaneContextMenu={isEditMode ? onPaneContextMenu : undefined}
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
            <div className="text-cyan-500 text-xl opacity-80 select-none">WORK IN PROGRESS</div>
          </Panel>
          <Panel position="top-right">
            <div className="text-slate-200 text-xl opacity-80">{subtype}</div>
            <div className="text-slate-200 text-xl opacity-80">{`${localized.rank} ${currentRank}`}</div>
          </Panel>
          {notification && (
            <Panel position="bottom-center">
              <div
                className={`px-6 py-3 rounded-lg text-white text-sm shadow-lg cursor-pointer ${
                  notification.type === "success" ? "bg-green-700" : "bg-red-700"
                }`}
                onClick={() => setNotification(null)}
              >
                {notification.message}
              </div>
            </Panel>
          )}
          <Panel position="top-left" className="select-none">
            <div className="flex gap-2 items-start">
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
              {isFeaturesForModdersEnabled && (
                <button
                  className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                  onClick={() => {
                    window.api?.createNewSkillTree(skillsData.currentSubtype);
                  }}
                >
                  New Skill Tree
                </button>
              )}
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
              <div className="mt-2 flex gap-2">
                <button
                  className={`px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                    isEditMode ? "bg-green-700 text-white" : "hover:bg-gray-700"
                  } ${isRequirementsMode || isSkillLocksMode ? "grayscale cursor-not-allowed" : ""}`}
                  onClick={() => {
                    if (isEditMode && (isRequirementsMode || isSkillLocksMode)) return;
                    setIsEditMode(!isEditMode);
                  }}
                >
                  {isEditMode ? localized.editModeOn || "Edit Mode: ON" : localized.edit || "Edit"}
                </button>
                {isEditMode && (
                  <>
                    <button
                      className={`ml-4 px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                        isRequirementsMode ? "bg-amber-600 text-white" : "hover:bg-gray-700"
                      }`}
                      onClick={() => {
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
                        isSkillLocksMode ? exitSkillLocksMode() : enterSkillLocksMode();
                      }}
                    >
                      {isSkillLocksMode
                        ? localized.skillLocksModeOn || "Skill Locks: ON"
                        : localized.skillLocks || "Skill Locks"}
                    </button>
                  </>
                )}
              </div>
            )}
            {isEditMode && (
              <div className="mt-2 flex gap-2">
                {!isRequirementsMode && !isSkillLocksMode && (
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
                      className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-red-700 text-red-400"
                      onClick={() => setIsResetConfirmOpen(true)}
                    >
                      Reset
                    </button>

                    <div className="hover:bg-green-700 bg-green-600 dark:border-gray-600 border-2 rounded-lg w-fit">
                      <Dropdown dismissOnClick={false} label={localized.json || "JSON"} color={"info"}>
                        <Dropdown.Item>
                          <button
                            className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                            onClick={() => importInputRef.current?.click()}
                          >
                            {localized.import || "Import"}
                          </button>
                          <input
                            ref={importInputRef}
                            type="file"
                            accept=".json"
                            onChange={onImport}
                            className="hidden"
                          />
                        </Dropdown.Item>
                        <Dropdown.Item>
                          <button
                            className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                            onClick={onExport}
                          >
                            {localized.export || "Export"}
                          </button>
                        </Dropdown.Item>
                      </Dropdown>
                    </div>

                    <div className="hover:bg-green-700 bg-green-600 dark:border-gray-600 border-2 rounded-lg w-fit">
                      <Dropdown dismissOnClick={false} label={localized.save} color={"success"}>
                        <Dropdown.Item>
                          <button
                            className="w-36 px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-blue-700 bg-blue-600 text-white"
                            onClick={() => {
                              const ts = Date.now().toString();
                              setSavePackName(`custom_skills_${subtype}_${ts}`);
                              setSavePackDirectory(undefined);
                              setSavePackCloneAll(false);
                              setSaveChangesMode(false);
                              setCustomTableName("");
                              setCustomKeyPrefix("");
                              setIsSavePackModalOpen(true);
                            }}
                          >
                            {localized.savePack || "Save Whole Tree"}
                          </button>
                        </Dropdown.Item>
                        <Dropdown.Item>
                          <button
                            className="w-36 px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-green-700 bg-green-600 text-white"
                            onClick={() => {
                              const ts = Date.now().toString();
                              setSavePackName(`skill_changes_${subtype}_${ts}`);
                              setSavePackDirectory(undefined);
                              setSavePackCloneAll(false);
                              setCustomTableName("");
                              setCustomKeyPrefix("");
                              setIsSavePackModalOpen(true);
                              setSaveChangesMode(true);
                            }}
                          >
                            {localized.saveOnlyChanges || "Save Only Changes"}
                          </button>
                        </Dropdown.Item>
                      </Dropdown>
                    </div>

                    {/* <button
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
                    </button> */}
                  </>
                )}
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
        <Modal
          onClose={() => setIsSavePackModalOpen(false)}
          show={isSavePackModalOpen}
          size="md"
          position="center"
        >
          <Modal.Header>{saveChangesMode ? "Save Changes" : "Save Skills Pack"}</Modal.Header>
          <Modal.Body>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Pack Name (without .pack extension)
                </label>
                <input
                  ref={savePackNameInputRef}
                  type="text"
                  value={savePackName}
                  onChange={(e) => setSavePackName(e.target.value)}
                  placeholder="Enter pack name"
                  className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                  disabled={isSavePackProcessing}
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
                    disabled={isSavePackProcessing}
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
                  value={customTableName}
                  onChange={(e) => setCustomTableName(e.target.value)}
                  placeholder="Leave empty for default"
                  disabled={isSavePackProcessing}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2.5 placeholder-gray-400"
                />
                <p className="text-xs text-gray-400 mt-1">Overrides table file names in the pack</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Key Prefix (optional)</label>
                <input
                  type="text"
                  value={customKeyPrefix}
                  onChange={(e) => setCustomKeyPrefix(e.target.value)}
                  placeholder="Leave empty for default (custom)"
                  disabled={isSavePackProcessing}
                  className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg p-2.5 placeholder-gray-400"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Prefix for generated keys (e.g. "xxx" → xxx_node_4_0 instead of custom_node_1234_4_0)
                </p>
              </div>
              {!saveChangesMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Existing Character Skills
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="cloneOption"
                        checked={!savePackCloneAll}
                        onChange={() => setSavePackCloneAll(false)}
                        className="text-blue-600"
                      />
                      <span className="text-sm text-gray-300">
                        Preserve existing (reference by original key)
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="cloneOption"
                        checked={savePackCloneAll}
                        onChange={() => setSavePackCloneAll(true)}
                        className="text-blue-600"
                      />
                      <span className="text-sm text-gray-300">
                        Clone all (create new entries for all skills)
                      </span>
                    </label>
                  </div>
                </div>
              )}
              {saveChangesMode && (
                <p className="text-sm text-gray-400">
                  Only changed, moved, added, or deleted nodes will be included in the output pack. Unchanged
                  nodes are left as-is.
                </p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button
              onClick={() => setIsSavePackModalOpen(false)}
              disabled={isSavePackProcessing}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={saveChangesMode ? handleSaveChangesConfirm : handleSavePackConfirm}
              disabled={isSavePackProcessing || !savePackName.trim()}
              className={`px-4 py-2 ${
                saveChangesMode ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"
              } text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isSavePackProcessing ? "Saving..." : saveChangesMode ? "Save Changes" : "Save"}
            </button>
          </Modal.Footer>
        </Modal>
        <Modal show={isResetConfirmOpen} onClose={() => setIsResetConfirmOpen(false)} size="md">
          <Modal.Header>Reset Skill Tree</Modal.Header>
          <Modal.Body>
            <p className="text-gray-300">Reset skill tree to original values? All changes will be lost.</p>
          </Modal.Body>
          <Modal.Footer>
            <div className="flex gap-2 justify-end w-full">
              <button
                onClick={() => setIsResetConfirmOpen(false)}
                className="px-4 py-2 text-gray-300 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResetConfirm}
                className="px-4 py-2 text-white bg-red-700 hover:bg-red-800 rounded-lg text-sm"
              >
                Reset
              </button>
            </div>
          </Modal.Footer>
        </Modal>
        {isAddNodeModalOpen &&
          (() => {
            const editingNode = editingNodeId
              ? (nodes.find((n) => n.id === editingNodeId) as NodesWithoutPlaceholders)
              : undefined;
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
            const targetGroupId =
              contextMenu.nodeType === "skill" && targetNode
                ? editGroups[(targetNode.data as SkillData).nodeId]
                : undefined;
            const isTargetSelected = nodes.some((n) => n.id === contextMenu.nodeId && n.selected);
            const allSelected = nodes.filter((n) => n.selected && n.type === "skill");
            const deleteCount = isTargetSelected && allSelected.length > 1 ? allSelected.length : 1;

            // Nodes that would be grouped: right-clicked + all selected, deduplicated
            const groupCandidateMap = new Map<string, (typeof nodes)[0]>();
            if (targetNode && contextMenu.nodeType === "skill")
              groupCandidateMap.set(targetNode.id, targetNode);
            for (const n of selectedNodes) groupCandidateMap.set(n.id, n);
            const groupCandidates = Array.from(groupCandidateMap.values());
            const canGroup =
              groupCandidates.length >= 2 &&
              groupCandidates.every((n) => !editGroups[(n.data as SkillData).nodeId]);

            // Count input and output connections
            const inputCount =
              contextMenu.nodeType === "skill"
                ? edges.filter((e) => e.target === contextMenu.nodeId).length
                : 0;
            const outputCount =
              contextMenu.nodeType === "skill"
                ? edges.filter((e) => e.source === contextMenu.nodeId).length
                : 0;

            // Helper to get absolute position for a node
            const getNodeAbsPos = (n: (typeof nodes)[0]) => {
              if (n.parentId) {
                const parent = nodes.find((p) => p.id === n.parentId);
                return {
                  x: (parent?.position.x ?? 0) + n.position.x,
                  y: (parent?.position.y ?? 0) + n.position.y,
                };
              }
              return n.position;
            };

            // Copy/paste helpers
            const copyNodes = (nodesToCopy: (typeof nodes)[0][]) => {
              if (nodesToCopy.length === 0) return;
              // Find anchor (top-left node)
              const withPos = nodesToCopy.map((n) => {
                const abs = getNodeAbsPos(n);
                return {
                  node: n,
                  row: Math.round(abs.y / effectiveNodeHeight),
                  col: Math.round(abs.x / nodeWidth),
                };
              });
              withPos.sort((a, b) => a.row - b.row || a.col - b.col);
              const anchorRow = withPos[0].row;
              const anchorCol = withPos[0].col;
              // Build groupKey mapping: nodes sharing the same editGroups groupId get the same key
              const groupIdToKey = new Map<string, string>();
              let groupKeyCounter = 0;
              clipboard = withPos.map(({ node, row, col }) => {
                const data = node.data as SkillData;
                const groupId = editGroups[data.nodeId];
                let groupKey: string | undefined;
                if (groupId) {
                  if (!groupIdToKey.has(groupId)) {
                    groupIdToKey.set(groupId, String(groupKeyCounter++));
                  }
                  groupKey = groupIdToKey.get(groupId);
                }
                return {
                  label: data.label,
                  description: data.description,
                  effects: data.effects,
                  numLevels: data.numLevels,
                  unlockRank: data.unlockRank,
                  existingSkillKey: data.existingSkillKey,
                  imgPath: data.imgPath,
                  relRow: row - anchorRow,
                  relCol: col - anchorCol,
                  groupKey,
                };
              });

              // Capture edges between copied nodes
              const nodeIdToRel = new Map<string, { relRow: number; relCol: number }>();
              for (const { node, row, col } of withPos) {
                nodeIdToRel.set(node.id, { relRow: row - anchorRow, relCol: col - anchorCol });
              }
              // Also map group container IDs to the leftmost member's position
              for (const { node, row, col } of withPos) {
                const groupId = editGroups[(node.data as SkillData).nodeId];
                if (groupId) {
                  const containerId = `${groupId}_group`;
                  const rel = { relRow: row - anchorRow, relCol: col - anchorCol };
                  const existing = nodeIdToRel.get(containerId);
                  if (
                    !existing ||
                    rel.relCol < existing.relCol ||
                    (rel.relCol === existing.relCol && rel.relRow < existing.relRow)
                  ) {
                    nodeIdToRel.set(containerId, rel);
                  }
                }
              }
              const allEdgeSources = [...edges, ...savedEditEdges.current, ...allLockEdges.current];
              const seen = new Set<string>();
              clipboardEdges = [];
              for (const e of allEdgeSources) {
                const srcRel = nodeIdToRel.get(e.source);
                const tgtRel = nodeIdToRel.get(e.target);
                if (!srcRel || !tgtRel) continue;
                const key = `${e.type}:${srcRel.relRow},${srcRel.relCol}->${tgtRel.relRow},${tgtRel.relCol}`;
                if (seen.has(key)) continue;
                seen.add(key);
                clipboardEdges.push({
                  sourceRelRow: srcRel.relRow,
                  sourceRelCol: srcRel.relCol,
                  targetRelRow: tgtRel.relRow,
                  targetRelCol: tgtRel.relCol,
                  type: e.type || "straight",
                  data: e.data ? { ...e.data } : undefined,
                  style: e.style ? { ...e.style } : undefined,
                });
              }

              setClipboardVersion((v) => v + 1);
            };

            const pasteAtPosition = (targetRow: number, targetCol: number) => {
              if (clipboard.length === 0) return;
              const mapEffects = (effects: Effect[]) =>
                effects.map((effect) => {
                  let iconData = "";
                  if (effect.icon) {
                    iconData = skillsData.icons[`ui\\campaign ui\\effect_bundles\\${effect.icon}`] || "";
                  }
                  return { ...effect, iconData };
                });

              const newNodes: Node<SkillData, "skill">[] = [];
              const affectedRows = new Set<number>();
              const ts = Date.now();
              const relToNewId = new Map<string, string>();
              for (const entry of clipboard) {
                relToNewId.set(
                  `${entry.relRow},${entry.relCol}`,
                  `new_node_${ts}_${entry.relRow}_${entry.relCol}`,
                );
              }
              for (const entry of clipboard) {
                const destRow = targetRow + entry.relRow;
                const destCol = targetCol + entry.relCol;
                affectedRows.add(destRow);
                const newNodeId = relToNewId.get(`${entry.relRow},${entry.relCol}`)!;
                newNodes.push({
                  id: newNodeId,
                  data: {
                    id: newNodeId,
                    label: entry.label,
                    skillBackground,
                    skillIconBackground,
                    skillIcon: resolveSkillIcon(entry.imgPath),
                    tooltipFrame,
                    skillLevelLitIcon,
                    row: destRow,
                    nodeId: newNodeId,
                    imgPath: entry.imgPath || "",
                    isGrouping: false,
                    numLevels: entry.numLevels,
                    skillLevelImg,
                    description: entry.description,
                    isAbilityIcon: false,
                    origIndent: destRow.toString(),
                    origTier: destCol.toString(),
                    effects: mapEffects(entry.effects),
                    isHiddentInUI: false,
                    isCheckingSkillRequirements: false,
                    unlockRank: entry.unlockRank,
                    isEditMode: true,
                    existingSkillKey: entry.existingSkillKey,
                  } as SkillData,
                  position: {
                    x: destCol * nodeWidth,
                    y: destRow * effectiveNodeHeight,
                  },
                  sourcePosition: Position.Right,
                  targetPosition: Position.Left,
                  type: "skill",
                  style: { zIndex: "1" },
                });
              }

              setNodes((nds) => {
                let updated = [...nds, ...newNodes];
                // For each new node, shift existing nodes at that position to the right
                for (const newNode of newNodes) {
                  const col = Math.round(newNode.position.x / nodeWidth);
                  const row = Math.round(newNode.position.y / effectiveNodeHeight);
                  const existingAtPos = updated.find((n) => {
                    if (
                      n.id === newNode.id ||
                      n.type !== "skill" ||
                      (n.data as any)?.isGrouping ||
                      n.parentId
                    )
                      return false;
                    return (
                      Math.round(n.position.x / nodeWidth) === col &&
                      Math.round(n.position.y / effectiveNodeHeight) === row
                    );
                  });
                  if (existingAtPos) {
                    const shiftIds = new Set<string>();
                    for (const n of updated) {
                      if (
                        n.id === newNode.id ||
                        n.type !== "skill" ||
                        (n.data as any)?.isGrouping ||
                        n.parentId
                      )
                        continue;
                      const nCol = Math.round(n.position.x / nodeWidth);
                      if (
                        Math.round(n.position.y / effectiveNodeHeight) === row &&
                        nCol >= col &&
                        n.id !== newNode.id
                      ) {
                        shiftIds.add(n.id);
                      }
                    }
                    updated = updated.map((n) => {
                      if (shiftIds.has(n.id)) {
                        const nCol = Math.round(n.position.x / nodeWidth);
                        return { ...n, position: { x: (nCol + 1) * nodeWidth, y: n.position.y } };
                      }
                      return n;
                    });
                  }
                }
                return repositionPlaceholders(updated, affectedRows);
              });

              // Recreate edges between pasted nodes
              if (clipboardEdges.length > 0) {
                const pastedEdges: SkillEdge[] = [];
                for (const ce of clipboardEdges) {
                  const sourceId = relToNewId.get(`${ce.sourceRelRow},${ce.sourceRelCol}`);
                  const targetId = relToNewId.get(`${ce.targetRelRow},${ce.targetRelCol}`);
                  if (!sourceId || !targetId) continue;

                  if (ce.type === "skillLock") {
                    pastedEdges.push({
                      id: `lock-${sourceId}-${targetId}`,
                      source: sourceId,
                      target: targetId,
                      type: "skillLock",
                      animated: false,
                      zIndex: 10,
                      style: { stroke: "#dc2626", strokeWidth: 2 },
                      data: { curveBelow: false, level: ce.data?.level || 1 },
                    });
                  } else if (ce.type === "requirement") {
                    pastedEdges.push({
                      id: `req-${sourceId}-${targetId}`,
                      source: sourceId,
                      target: targetId,
                      type: "requirement",
                      animated: false,
                      zIndex: 10,
                      style: ce.style || { stroke: "#f59e0b", strokeWidth: 2 },
                      data: { curveBelow: ce.data?.curveBelow ?? true },
                    });
                  } else {
                    pastedEdges.push({
                      id: `e${sourceId}-${targetId}`,
                      source: sourceId,
                      target: targetId,
                      type: edgeType,
                      animated: false,
                      interactionWidth: 20,
                      style: { stroke: "#ef4444", strokeWidth: 2 },
                    } as SkillEdge);
                  }
                }

                if (pastedEdges.length > 0) {
                  setEdges((eds) => [...eds, ...pastedEdges]);
                  const lockEdges = pastedEdges.filter((e) => e.type === "skillLock");
                  if (lockEdges.length > 0) {
                    allLockEdges.current = [...allLockEdges.current, ...lockEdges];
                    setLockEdgeLevels((prev) => {
                      const next = { ...prev };
                      for (const e of lockEdges) next[e.id] = Number(e.data?.level) || 1;
                      return next;
                    });
                  }
                }
              }

              // Recreate groups from clipboard groupKey
              const groupKeyToNodeIds = new Map<string, string[]>();
              for (const entry of clipboard) {
                if (entry.groupKey !== undefined) {
                  const newId = relToNewId.get(`${entry.relRow},${entry.relCol}`);
                  if (!newId) continue;
                  if (!groupKeyToNodeIds.has(entry.groupKey)) groupKeyToNodeIds.set(entry.groupKey, []);
                  groupKeyToNodeIds.get(entry.groupKey)!.push(newId);
                }
              }
              // Count valid groups (2+ members) and create them
              const validGroups: string[][] = [];
              for (const [, memberIds] of groupKeyToNodeIds) {
                if (memberIds.length >= 2) validGroups.push(memberIds);
              }
              if (validGroups.length > 0) {
                setEditGroups((prev) => {
                  const next = { ...prev };
                  for (let i = 0; i < validGroups.length; i++) {
                    const groupId = `editGroup_${nextGroupId + i}`;
                    for (const id of validGroups[i]) {
                      next[id] = groupId;
                    }
                  }
                  return next;
                });
                setNextGroupId((id) => id + validGroups.length);
              }
            };

            const menuItemClass =
              "w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 cursor-pointer";

            // For placeholder nodes, only show paste
            if (contextMenu.nodeType === "addPlaceholder") {
              const placeholderRow = targetNode ? Math.round(targetNode.position.y / effectiveNodeHeight) : 0;
              const placeholderCol = targetNode ? Math.round(targetNode.position.x / nodeWidth) : 0;
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
                    <button
                      className={menuItemClass}
                      onClick={() => {
                        pasteAtPosition(placeholderRow, placeholderCol);
                        setContextMenu(null);
                      }}
                    >
                      Paste ({clipboard.length} node{clipboard.length !== 1 ? "s" : ""})
                    </button>
                  </div>
                </>
              );
            }

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
                  {isRequirementsMode &&
                    selectedNodes.length > 0 &&
                    targetNode &&
                    (() => {
                      const getAbsX = (n: (typeof nodes)[0]) => {
                        if (n.parentId) {
                          const parent = nodes.find((p) => p.id === n.parentId);
                          return (parent?.position.x ?? 0) + n.position.x;
                        }
                        return n.position.x;
                      };
                      const getAbsY = (n: (typeof nodes)[0]) => {
                        if (n.parentId) {
                          const parent = nodes.find((p) => p.id === n.parentId);
                          return (parent?.position.y ?? 0) + n.position.y;
                        }
                        return n.position.y;
                      };
                      const targetCol = Math.round(getAbsX(targetNode) / nodeWidth);
                      const targetRow = Math.round(getAbsY(targetNode) / effectiveNodeHeight);
                      const sameRowSelected = selectedNodes.filter(
                        (n) => Math.round(getAbsY(n) / effectiveNodeHeight) === targetRow,
                      );
                      if (sameRowSelected.length === 0) return null;
                      const allToLeft = sameRowSelected.every(
                        (n) => Math.round(getAbsX(n) / nodeWidth) < targetCol,
                      );
                      const allToRight = sameRowSelected.every(
                        (n) => Math.round(getAbsX(n) / nodeWidth) > targetCol,
                      );
                      return (
                        <>
                          <div className="border-t border-gray-600 my-1" />
                          {allToLeft && (
                            <button
                              className={menuItemClass}
                              onClick={() => contextMenuAddRequirement("SUBSET_REQUIRED")}
                            >
                              Add SUBSET_REQUIRED ({sameRowSelected.length} → target)
                            </button>
                          )}
                          {allToRight && (
                            <button
                              className={menuItemClass}
                              onClick={() => contextMenuAddRequirement("REQUIRED")}
                            >
                              Add REQUIRED (target → {sameRowSelected.length})
                            </button>
                          )}
                        </>
                      );
                    })()}
                  {isSkillLocksMode &&
                    selectedNodes.length > 0 &&
                    targetNode &&
                    (() => {
                      const targetId = contextMenu.nodeId;
                      const hasExisting = allLockEdges.current.some((e) =>
                        selectedNodes.some(
                          (n) =>
                            (e.source === targetId && e.target === n.id) ||
                            (e.source === n.id && e.target === targetId),
                        ),
                      );
                      return (
                        <>
                          <div className="border-t border-gray-600 my-1" />
                          <button className={menuItemClass} onClick={() => contextMenuLockSelected("locks")}>
                            This Locks {selectedNodes.length} Selected
                          </button>
                          <button
                            className={menuItemClass}
                            onClick={() => contextMenuLockSelected("lockedBy")}
                          >
                            Locked By {selectedNodes.length} Selected
                          </button>
                          <button className={menuItemClass} onClick={() => contextMenuLockSelected("both")}>
                            Lock Both Ways
                          </button>
                          <button className={menuItemClass} onClick={contextMenuLockAllSelectedBothWays}>
                            Lock All Selected Both Ways
                          </button>
                          {hasExisting && (
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 cursor-pointer"
                              onClick={contextMenuUnlockSelected}
                            >
                              Remove Lock Connections
                            </button>
                          )}
                        </>
                      );
                    })()}
                  {!isRequirementsMode && !isSkillLocksMode && (
                    <>
                      <div className="border-t border-gray-600 my-1" />
                      <button
                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 cursor-pointer"
                        onClick={contextMenuDelete}
                      >
                        {deleteCount > 1 ? `Delete ${deleteCount} Nodes` : "Delete Node"}
                      </button>
                      {canGroup && (
                        <>
                          <button className={menuItemClass} onClick={() => contextMenuGroup(true)}>
                            Group {groupCandidates.length} Nodes
                          </button>
                          <button className={menuItemClass} onClick={() => contextMenuGroup(false)}>
                            Group {groupCandidates.length} Nodes (Don't connect)
                          </button>
                        </>
                      )}
                      {selectedNodes.length === 1 && targetNode && (
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            const otherNode = selectedNodes[0];
                            setNodes((nds) =>
                              nds.map((n) => {
                                if (n.id === targetNode.id) {
                                  return {
                                    ...n,
                                    position: { ...otherNode.position },
                                    parentId: otherNode.parentId,
                                  };
                                }
                                if (n.id === otherNode.id) {
                                  return {
                                    ...n,
                                    position: { ...targetNode.position },
                                    parentId: targetNode.parentId,
                                  };
                                }
                                return n;
                              }),
                            );
                            // Also swap edges: remap source/target references
                            setEdges((eds) =>
                              eds.map((e) => {
                                let source = e.source;
                                let target = e.target;
                                if (source === targetNode.id) source = otherNode.id;
                                else if (source === otherNode.id) source = targetNode.id;
                                if (target === targetNode.id) target = otherNode.id;
                                else if (target === otherNode.id) target = targetNode.id;
                                if (source !== e.source || target !== e.target) {
                                  return { ...e, source, target };
                                }
                                return e;
                              }),
                            );
                            setContextMenu(null);
                          }}
                        >
                          Swap with {(selectedNodes[0].data as SkillData).label || "Selected"}
                        </button>
                      )}
                      {(() => {
                        if (!targetNode || targetNode.parentId) return null;
                        const targetRow = Math.round(targetNode.position.y / effectiveNodeHeight);
                        const targetCol = Math.round(targetNode.position.x / nodeWidth);
                        const leftCol = targetCol - 1;
                        const canMoveLeft =
                          leftCol >= 0 &&
                          !nodes.some((n) => {
                            if (n.parentId) return false;
                            const isGroup = n.className === "reactFlowGroup";
                            const isSkill = n.type === "skill";
                            if (!isGroup && !isSkill) return false;
                            const nRow = isGroup
                              ? Math.round((n.position.y + 15) / effectiveNodeHeight)
                              : Math.round(n.position.y / effectiveNodeHeight);
                            if (nRow !== targetRow) return false;
                            const col = isGroup
                              ? Math.round((n.position.x + 10) / nodeWidth)
                              : Math.round(n.position.x / nodeWidth);
                            if (isGroup) {
                              const w = Math.ceil(((n as any).width ?? nodeWidth) / nodeWidth);
                              return leftCol >= col && leftCol < col + w;
                            }
                            return col === leftCol;
                          });
                        return (
                          <>
                            <button className={menuItemClass} onClick={() => contextMenuMoveRow("right")}>
                              Move Row Right
                            </button>
                            {canMoveLeft && (
                              <button className={menuItemClass} onClick={() => contextMenuMoveRow("left")}>
                                Move Row Left
                              </button>
                            )}
                          </>
                        );
                      })()}
                      {(() => {
                        if (!targetNode || !targetGroupId) return null;
                        const containerId = `${targetGroupId}_group`;
                        const container = nodes.find((n) => n.id === containerId);
                        if (!container) return null;
                        const memberCount = Object.values(editGroups).filter(
                          (gid) => gid === targetGroupId,
                        ).length;
                        if (memberCount < 2) return null;
                        const containerCol = Math.round((container.position.x + 10) / nodeWidth);
                        const canMoveGroupLeft = containerCol > 0;
                        return (
                          <>
                            <button className={menuItemClass} onClick={() => contextMenuMoveGroup("right")}>
                              Move Group Right
                            </button>
                            {canMoveGroupLeft && (
                              <button className={menuItemClass} onClick={() => contextMenuMoveGroup("left")}>
                                Move Group Left
                              </button>
                            )}
                            <button
                              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 cursor-pointer"
                              onClick={() => {
                                // Remove all edges connected to group members
                                const memberNodeIds = new Set(
                                  Object.entries(editGroups)
                                    .filter(([, gid]) => gid === targetGroupId)
                                    .map(([nodeId]) => nodeId),
                                );
                                const memberIds = new Set(
                                  nodes
                                    .filter(
                                      (n) =>
                                        n.type === "skill" && memberNodeIds.has((n.data as SkillData).nodeId),
                                    )
                                    .map((n) => n.id),
                                );
                                const containerId = `${targetGroupId}_group`;
                                setEdges((eds) =>
                                  eds.filter(
                                    (e) =>
                                      !memberIds.has(e.source) &&
                                      !memberIds.has(e.target) &&
                                      e.source !== containerId &&
                                      e.target !== containerId,
                                  ),
                                );
                                // Remove group assignments
                                setEditGroups((prev) => {
                                  const next = { ...prev };
                                  for (const nodeId of memberNodeIds) {
                                    delete next[nodeId];
                                  }
                                  return next;
                                });
                                setContextMenu(null);
                              }}
                            >
                              Delete Group
                            </button>
                          </>
                        );
                      })()}
                      {selectedNodes.length > 0 && (
                        <>
                          <div className="border-t border-gray-600 my-1" />
                          <div className="px-4 py-1 text-xs text-gray-400">
                            {selectedNodes.length} selected node{selectedNodes.length > 1 ? "s" : ""}
                          </div>
                          <button
                            className={menuItemClass}
                            onClick={() => contextMenuInsert("before", false)}
                          >
                            Insert Before{targetGroupId && " Group"}
                          </button>
                          <button className={menuItemClass} onClick={() => contextMenuInsert("after", false)}>
                            Insert After{targetGroupId && " Group"}
                          </button>
                          {targetGroupId && (
                            <>
                              <button
                                className={menuItemClass}
                                onClick={() => contextMenuInsert("before", true)}
                              >
                                Insert Before Node, Inside Group
                              </button>
                              <button
                                className={menuItemClass}
                                onClick={() => contextMenuInsert("after", true)}
                              >
                                Insert After Node, Inside Group
                              </button>
                            </>
                          )}
                        </>
                      )}
                      <div className="border-t border-gray-600 my-1" />
                      {targetNode && (
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            copyNodes([targetNode]);
                            setContextMenu(null);
                          }}
                        >
                          Copy Node
                        </button>
                      )}
                      {allSelected.length > 1 && (
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            copyNodes(allSelected);
                            setContextMenu(null);
                          }}
                        >
                          Copy {allSelected.length} Selected Nodes
                        </button>
                      )}
                      {targetNode &&
                        (() => {
                          const abs = getNodeAbsPos(targetNode);
                          const row = Math.round(abs.y / effectiveNodeHeight);
                          const rowNodes = nodes.filter((n) => {
                            if (n.type !== "skill" || (n.data as any)?.isGrouping) return false;
                            const nAbs = getNodeAbsPos(n);
                            return Math.round(nAbs.y / effectiveNodeHeight) === row;
                          });
                          if (rowNodes.length < 2) return null;
                          return (
                            <button
                              className={menuItemClass}
                              onClick={() => {
                                copyNodes(rowNodes);
                                setContextMenu(null);
                              }}
                            >
                              Copy Row ({rowNodes.length} nodes)
                            </button>
                          );
                        })()}
                      {clipboard.length > 0 && targetNode && (
                        <button
                          className={menuItemClass}
                          onClick={() => {
                            const abs = getNodeAbsPos(targetNode);
                            const row = Math.round(abs.y / effectiveNodeHeight);
                            const col = Math.round(abs.x / nodeWidth);
                            pasteAtPosition(row, col);
                            setContextMenu(null);
                          }}
                        >
                          Paste ({clipboard.length} node{clipboard.length !== 1 ? "s" : ""})
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            );
          })()}
        {editingEdgeId && editingEdgePosition && (
          <div
            className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-lg"
            style={{ left: editingEdgePosition.x, top: editingEdgePosition.y }}
          >
            <label className="text-xs text-gray-300 block mb-1">Required Level</label>
            <input
              type="number"
              min={1}
              autoFocus
              value={editingEdgeLevel}
              onChange={(e) => setEditingEdgeLevel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmEdgeLevelEdit();
                if (e.key === "Escape") setEditingEdgeId(null);
              }}
              className="w-20 px-2 py-1 bg-gray-700 text-white border border-gray-600 rounded text-sm"
            />
            <div className="flex gap-1 mt-1">
              <button
                onClick={confirmEdgeLevelEdit}
                className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded"
              >
                OK
              </button>
              <button
                onClick={() => setEditingEdgeId(null)}
                className="px-2 py-0.5 bg-gray-600 text-white text-xs rounded"
              >
                Cancel
              </button>
              <button
                onClick={deleteEditingEdge}
                className="px-2 py-0.5 bg-red-600 text-white text-xs rounded"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }),
);

export default SkillsView;
