import React, { memo, useContext, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import deepClone from "clone-deep";
import "@silevis/reactgrid/styles.css";
import localizationContext from "../../localizationContext";

import {
  Node,
  useNodesState,
  useEdgesState,
  Position,
  ViewportPortal,
  ReactFlow,
  Panel,
} from "@xyflow/react";
import groupBy from "object.groupby";

import "reactflow/dist/style.css";
import Skill, { SkillData } from "./Skill";
import { Dropdown } from "flowbite-react";
import { setIsLocalizingSubtypes } from "@/src/appSlice";

const edgeType = "straight";

const nodeTypes = { skill: Skill };

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

const SkillsView = memo(() => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);

  const [isShowingHiddentSkills, setIsShowingHiddenSkills] = useState(true);
  const [isShowingHiddenModifiersInsideSkills, setIsShowingHiddenModifiersInsideSkills] = useState(true);
  const [isCheckingSkillRequirements, setIsCheckingSkillRequirements] = useState(true);

  const isLocalizingSubtypes = useAppSelector((state) => state.app.isLocalizingSubtypes);

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

  let nodeSizeDelta = 0;
  let usingBiggerNodeHeight = false;
  // if we need to overlay nodes make the y gap between them bigger
  if (
    skills.some((skillFirst) =>
      skills.some(
        (skillSecond) =>
          skillFirst != skillSecond &&
          skillFirst.origIndent == skillSecond.origIndent &&
          skillFirst.origTier == skillSecond.origTier
      )
    )
  ) {
    nodeHeight = biggerNodeHeight;
    nodeSizeDelta = 20;
    usingBiggerNodeHeight = true;
  }
  console.log("usingBiggerNodeHeight:", usingBiggerNodeHeight);

  if (!isShowingHiddentSkills) {
    skills = skills.filter((skill) => !skill.isHiddentInUI);
  }

  // console.log("with group:", skills.filter((skill) => skill.group).length);
  const groupedSkills = groupBy(
    skills.filter((skill) => skill.group),
    (skill) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return skill.group!;
    }
  );

  for (const skillsInGroup of Object.values(groupedSkills)) {
    skillsInGroup.sort((firstSkill, secondSkill) => firstSkill.y - secondSkill.y);
  }

  const skillNodes: (Node<SkillData, "default"> | Node<SkillData, "skill">)[] = [];

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
      skills.map((skill) => skill.id)
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
      },
      position: {
        y: lowest.x * nodeHeight - (usingBiggerNodeHeight ? 15 + nodeSizeDelta / 2 : 15),
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
      height: nodeHeight - 10,
    });
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
      (iterSkill) => iterSkill.origIndent == skill.origIndent && iterSkill.origTier == skill.origTier
    );
    sameCoordinatesSkills.sort((first, second) => {
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
    });

    const indexInSameCoords = sameCoordinatesSkills.indexOf(skill);

    let position = {
      y: skill.x * nodeHeight + indexInSameCoords * 40,
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
      } as SkillData,
      position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      parentId: skill.group ? `${skill.group}_group` : undefined,
      type: "skill",
      style: { zIndex: "1" },
    };

    if (!isShowingHiddenModifiersInsideSkills) {
      node.data.effects = node.data.effects.filter((effect) => effect.priority != "0");
    }
    skillNodes.push(node);
  });

  // console.log("skillNodes:", skillNodes);

  const skillNodesByRow = groupBy(
    skillNodes.filter((node) => !node.parentId), // without sub-nodes, only groups or stand-alone nodes
    (node) => node.data.row.toString()
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
          (skillNode) => skillNode.data.nodeId == `${skillWithLink.nodeId}`
        );
        // console.log("linkedSkillNode:", !!linkedSkillNode);
        // console.log("sourceSkillNode:", !!sourceSkillNode);
        if (linkedSkillNode && sourceSkillNode) {
          initialEdges.push({
            id: `e${skillWithLink.id}2${linkedNode}`,
            source: sourceSkillNode && sourceSkillNode.parentId ? sourceSkillNode.parentId : skillWithLink.id,
            target: linkedSkillNode.parentId ? linkedSkillNode.parentId : linkedNode,
            type: edgeType,
            animated: false,
          });
        }
      }
    });

  // console.log(skills.map((skill) => [skill.x, skill.y]));
  // console.log(skillNodes);

  // console.log("initialEdges:", initialEdges);

  console.log("nodeSizeDelta:", nodeSizeDelta);
  const arrows = initialEdges
    .map((edge) => {
      console.log("edge:", edge.source, edge.target);
      const sourceNode =
        skillNodes.find((node) => node.id == edge.source) ||
        skillNodes.find((node) => node.data.id == edge.source);
      const targetNode =
        skillNodes.find((node) => node.id == edge.target) ||
        skillNodes.find((node) => node.data.id == edge.target);
      if (!sourceNode || !targetNode) return;

      let x = Math.max(sourceNode.position.x, targetNode.position.x) - 70;
      if (targetNode.data.isGrouping) x -= 20;
      const y = sourceNode.position.y + (sourceNode.data.isGrouping ? 40 + nodeSizeDelta / 2 : 27.5);
      // targetNode.position.y +
      // (targetNode.height ? targetNode.height / 2 : 30) -
      // (usingBiggerNodeHeight ? 0 : 5);

      return { x, y, sourceNode, targetNode };
    })
    .filter((arrow) => arrow != undefined);

  // console.log("arrows:", arrows);

  const [nodes, setNodes, onNodesChange] = useNodesState(deepClone(skillNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<(typeof initialEdges)[0]>(deepClone(initialEdges));

  // const onConnect = useCallback(
  //   (params) =>
  //     setEdges((eds) => addEdge({ ...params, type: ConnectionLineType.SmoothStep, animated: true }, eds)),
  //   []
  // );

  // ReactFlow won't refresh when things like isShowingHiddenModifiersInsideSkills change, so force it
  useEffect(() => {
    setNodes(deepClone(skillNodes));
    setEdges(deepClone(initialEdges));
  }, [skillsData, isShowingHiddenModifiersInsideSkills, isShowingHiddentSkills, isCheckingSkillRequirements]);

  return (
    <div className="w-full h-full hideReactFlowHandles">
      <ReactFlow
        key={skillsData.currentSubtype}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-center">
          <div className="text-cyan-500 text-xl opacity-80">WORK IN PROGRESS</div>
        </Panel>
        <Panel position="top-right">
          <div className="text-slate-200 text-xl opacity-80">{subtype}</div>
        </Panel>
        <Panel position="top-left">
          <div className="hover:bg-gray-700 dark:border-gray-600 border-2 rounded-lg">
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
        </Panel>
        <ViewportPortal>
          <div className="fixed w-full h-full top-0 left-0">
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
      </ReactFlow>
    </div>
  );
});

export default SkillsView;
