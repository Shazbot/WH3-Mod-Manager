import React, { useCallback, useEffect } from "react";
import { useAppSelector } from "../../hooks";
import deepClone from "clone-deep";
import "@silevis/reactgrid/styles.css";

import { Node, useNodesState, useEdgesState, Position, ViewportPortal, ReactFlow } from "@xyflow/react";
import groupBy from "object.groupby";

import "reactflow/dist/style.css";
import Skill, { SkillData } from "./Skill";

const edgeType = "straight";

const nodeTypes = { skill: Skill };

let skillIconBackground = "";
let skillBackground = "";
let skillIcon = "";
let arrowImg = "";
let skillLevelImg = "";
let tooltipFrame = "";
let skillLevelLitIcon = "";

// if (process.env.STORYBOOK) {
skillIconBackground = require("../../../dumps/skins/default/skills_tab_ornament.png");
skillBackground = require("../../../dumps/skins/wh3_main_theme_blue/tech_skills_tab_active.png");
skillIcon = require("../../../dumps/img/character_magic.png");
arrowImg = require("../../../dumps/skins/default/parchment_divider_arrow.png");
skillLevelImg = require("../../../dumps/skins/default/skills_tab_level_off.png");
tooltipFrame = require("../../../dumps/skins/default/tooltip_frame.png");
skillLevelLitIcon = require("../../../dumps/skins/default/skills_tab_level_lit.png");
// }

const nodeWidth = 300;
const nodeHeight = 100;

const SkillsView = React.memo(() => {
  // const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  // const packsData = useAppSelector((state) => state.app.packsData);

  const skillsData = useAppSelector((state) => state.app.skillsData);
  if (!skillsData) {
    console.log("skillsData missing!");
    return <></>;
  }
  // const subtypeToSkills = skillsData.subtypeToSkills;
  // const nodeLinks = skillsData.nodeLinks;
  // const subtypes = Object.keys(subtypeToSkills);
  const skills = skillsData.currentSkills; //subtypeToSkills["wh_main_emp_karl_franz"];
  const subtype = skillsData.currentSubtype; //subtypeToSkills["wh_main_emp_karl_franz"];

  // return <></>;
  if (!skills) {
    console.log("SkillsView: no skills");
    return <></>;
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
    console.log("group", group, "size", skills.length);
    skillNodes.push({
      id: `${group}_group`,
      data: {
        label: group,
        id: group,
        isAbilityIcon: false,
        imgPath: "",
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
      },
      position: { y: lowest.x * nodeHeight - 10, x: lowest.y * nodeWidth - 10 },
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

  skills.forEach((skill, i) => {
    let position = { y: skill.x * nodeHeight, x: skill.y * nodeWidth };
    if (skill.group) {
      const skillsInGroup = groupedSkills[skill.group];
      if (skillsInGroup && skillsInGroup.length > 1) {
        const index = skillsInGroup.indexOf(skill);
        if (index > -1) {
          position = { y: 10, x: index * nodeWidth + 10 };
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
    // for (const effect of skill.effects) {
    //   if (effect.icon) {
    //     effect.iconData = skillsData.icons[`ui\\campaign ui\\effect_bundles\\${effect.icon}`];
    //   }
    // }

    const node: Node<SkillData, "skill"> = {
      id: `${skill.id}`,
      data: {
        id: skill.id,
        label: skill.localizedTitle || skill.id,
        skillBackground,
        skillIconBackground,
        skillIcon: skillIconBuffer || skill.img,
        tooltipFrame,
        skillLevelLitIcon,
        row: skill.x,
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
      } as SkillData,
      position,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      parentId: skill.group ? `${skill.group}_group` : undefined,
      type: "skill",
      style: { zIndex: "1" },
    };
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
      if (node.data.isGrouping) {
        delta += 50;
        console.log("INC");
      }
      if (!node.data.isGrouping && nodePrev.data.isGrouping) {
        delta += 50;
        console.log("INC");
      }
      node.position.x += delta;
      if (!node.parentId) {
        // console.log("+");
      }
    }
  }

  const initialEdges: {
    id: string;
    source: string;
    target: string;
    type: string;
    animated: boolean;
  }[] = [];
  skills
    .filter((skill) => skill.linkedToSkill)
    .forEach((skillWithLink) => {
      const linkedSkill = skillWithLink.linkedToSkill;
      if (linkedSkill)
        if (skills.some((skill) => skill.id == linkedSkill)) {
          const linkedSkillNode = skillNodes.find((skillNode) => skillNode.id == `${linkedSkill}`);
          const skillNode = skillNodes.find((skillNode) => skillNode.id == `${skillWithLink.id}`);
          if (linkedSkillNode) {
            initialEdges.push({
              id: `e${skillWithLink.id}2${linkedSkill}`,
              source: skillNode && skillNode.parentId ? skillNode.parentId : skillWithLink.id,
              target: linkedSkillNode.parentId ? linkedSkillNode.parentId : linkedSkill,
              type: edgeType,
              animated: false,
            });
          }
        }
    });

  // console.log(skills.map((skill) => [skill.x, skill.y]));
  // console.log(skillNodes);

  // console.log("initialEdges:", initialEdges);

  const arrows = initialEdges
    .map((edge) => {
      const sourceNode = skillNodes.find((node) => node.id == edge.source);
      const targetNode = skillNodes.find((node) => node.id == edge.target);
      if (!sourceNode || !targetNode) return;

      let x = Math.max(sourceNode.position.x, targetNode.position.x) - 70;
      if (targetNode.data.isGrouping) x -= 20;
      const y = targetNode.position.y + (targetNode.height ? targetNode.height / 2 : 30) - 5;

      return { x, y, sourceNode, targetNode };
    })
    .filter((arrow) => arrow != undefined);

  // console.log("arrows:", arrows);

  const [nodes, setNodes, onNodesChange] = useNodesState(deepClone(skillNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<typeof initialEdges[0]>(deepClone(initialEdges));

  // const onConnect = useCallback(
  //   (params) =>
  //     setEdges((eds) => addEdge({ ...params, type: ConnectionLineType.SmoothStep, animated: true }, eds)),
  //   []
  // );

  useEffect(() => {
    setNodes(deepClone(skillNodes));
    setEdges(deepClone(initialEdges));
  }, [skillsData]);

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
