import React from "react";
import { Meta, StoryObj } from "@storybook/react";

import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { modsFive } from "./test_data/mods";
import initialState from "../initialAppState";
import SkillsViewer from "../components/skillsViewer/SkillsViewer";
import * as subtypeToSetAny from "../../dumps/subtypeToSet.json";
import * as setToNodesAny from "../../dumps/setToNodes.json";
import * as nodeToSkillAny from "../../dumps/nodeToSkill.json";
import * as skillsToEffectsAny from "../../dumps/skillsToEffects.json";
import * as nodeLinksAny from "../../dumps/nodeLinks.json";
import * as locsAny from "../../dumps/locs.json";
import * as skillAndIconsAny from "../../dumps/skills.json";
import * as effectsToEffectDataAny from "../../dumps/effectsToEffectData.json";
import SkillComponent from "../components/skillsViewer/Skill";
import { ConnectionLineType, ReactFlow } from "@xyflow/react";
import {
  appendLocalizationsToSkills,
  EffectsToEffectData,
  getNodesToParents,
  getSkills,
  getSkillToEffects,
  NodeLinks,
  NodeToSkill,
  SkillAndIcons,
  SkillsToEffects,
} from "../skills";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const imageFile = require("../../dumps/img/campaign_grimoires.png");
const skillIconBackground = require("../../dumps/skins/default/skills_tab_ornament.png");
const skillBackground = require("../../dumps/skins/wh3_main_theme_blue/tech_skills_tab_active.png");
const skillIcon = require("../../dumps/img/character_magic.png");
const arrow = require("../../dumps/skins/default/parchment_divider_arrow.png");
const skillLevelImg = require("../../dumps/skins/default/skills_tab_level_off.png");
const tooltipFrame = require("../../dumps/skins/default/tooltip_frame.png");
const skillLevelLitIcon = require("../../dumps/skins/default/skills_tab_level_lit.png");

const subtypeToSet = subtypeToSetAny as Record<string, string>;
const setToNodes = setToNodesAny as Record<string, string[]>;
const nodeToSkill = nodeToSkillAny as NodeToSkill;
const nodeLinks = nodeLinksAny as NodeLinks;
const skillsToEffects = skillsToEffectsAny as SkillsToEffects;
const locs = locsAny as Record<string, Record<string, string>>;
const skillAndIcons = Array.from(skillAndIconsAny) as SkillAndIcons;
const effectsToEffectData = effectsToEffectDataAny as EffectsToEffectData;

console.log("nodeToSkill:", nodeToSkill);
const set = subtypeToSet["wh_main_emp_karl_franz"];
const nodes = setToNodes[set];

const nodesToParents = getNodesToParents(
  nodes,
  nodeLinks,
  nodeToSkill,
  skillsToEffects,
);

const skills = getSkills(
  nodes,
  nodeLinks,
  nodeToSkill,
  nodesToParents,
  skillsToEffects,
  skillAndIcons,
);

// const skillToEffects = getSkillToEffects(skills, skillsToEffects);

const MockedState: AppState = {
  ...initialState,
  currentPreset: {
    mods: modsFive,
    name: "",
  },
  allMods: modsFive,
  categories: [],
  skillsData: {
    nodeLinks,
    currentSubtype: "wh_main_emp_karl_franz",
    currentSkills: skills,
    icons: {},
    subtypes: ["wh_main_emp_karl_franz"],
  },
};

const getLoc = (locId: string) => {
  for (const locsInPack of Object.values(locs)) {
    if (locsInPack[locId]) return locsInPack[locId];
  }
};

appendLocalizationsToSkills(skills, getLoc);

console.log(skills);

// A super-simple mock of a redux store
const Mockstore = ({
  appState,
  children,
}: {
  appState: AppState;
  children: React.ReactNode;
}) => (
  <Provider
    store={configureStore({
      reducer: {
        app: createSlice({
          name: "app",
          initialState: appState,
          reducers: {},
        }).reducer,
      },
    })}
  >
    {children}
  </Provider>
);

const taskList: Meta<typeof SkillsViewer> = {
  component: SkillsViewer,
  title: "SkillsViewer",
};
export default taskList;
type Story = StoryObj<typeof SkillsViewer>;

export const Default: Story = {
  decorators: [
    (story) => (
      <div className="dark dark:bg-slate-800 font-light overflow-hidden">
        <div className="m-auto px-8 pb-4 pt-11">
          <Mockstore appState={MockedState}>{story()}</Mockstore>
        </div>
      </div>
    ),
  ],
};

export const Skill: Story = {
  render: () => (
    <div className="h-20 relative w-[220px]">
      <img
        className="absolute h-20"
        src={skillBackground}
        alt={skillBackground}
      />
      <div className="absolute h-20 left-[-30px]">
        <img
          className="h-full object-cover"
          src={skillIconBackground}
          alt={skillIconBackground}
        />
        <img
          className="absolute h-[110%] top-[-6px] left-[32px]"
          src={skillIcon}
          alt={skillIcon}
        />
      </div>
      <div
        className="absolute left-[40%] top-[15%] text-center h-[50%] w-[50%] text-gray-200"
        style={{ fontFamily: '"Libre Baskerville", serif' }}
      >
        Devastating Charge
      </div>
    </div>
  ),
};

export const SkillAsComponent: Story = {
  render: () => (
    <ReactFlow
      nodes={undefined}
      edges={undefined}
      onNodesChange={undefined}
      onEdgesChange={undefined}
      onConnect={undefined}
      nodeTypes={undefined}
      connectionLineType={ConnectionLineType.SmoothStep}
    >
      <SkillComponent
        data={{
          label: "Devastating Charge",
          skillBackground,
          skillIconBackground,
          skillIcon: "character_magic.png",
          skillLevelImg,
          tooltipFrame,
          skillLevelLitIcon,
          row: 1,
          isGrouping: false,
          numLevels: Math.floor(Math.random() * 3 + 1),
          description: "Devastating Charge",
          effects: [],
          origIndent: "0",
          origTier: "0",
          isAbilityIcon: false,
          imgPath: "",
          id: "skillId",
        }}
      ></SkillComponent>
    </ReactFlow>
  ),
};
