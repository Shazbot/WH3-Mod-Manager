import React, { RefObject } from "react";
import { useAppSelector } from "../hooks";
import Sidebar from "./Sidebar";
import ModRows from "./ModRows";
import Categories from "./Categories";
import ModTagPicker from "./ModTagPicker";
import NodeEditor from "./NodeEditor";
import { useKeepMountedOnceActive } from "./useKeepMountedOnceActive";
import VisualsTab from "./VisualsTab";
import PresetsTab from "./PresetsTab";
import TechTreesTab from "./techTrees/TechTreesTab";
import SkillsTab from "./skillsViewer/SkillsTab";
import { gameToPackWithDBTablesName } from "../supportedGames";

type MainProps = {
  scrollElement: RefObject<HTMLDivElement>;
};
const Main = (props: MainProps) => {
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const currentFlowFileSelection = useAppSelector((state) => state.app.currentFlowFileSelection);
  const currentFlowFilePackPath = useAppSelector((state) => state.app.currentFlowFilePackPath);
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const isTechnologyTreesSupported = currentGame === "wh3";
  const isNodeEditorTab = currentTab == "nodeEditor";
  // Once opened the node editor stays mounted, so switching tabs does not discard an unsaved graph.
  const isNodeEditorMounted = useKeepMountedOnceActive(isNodeEditorTab);

  // Determine current pack: prioritize flow file pack, then DB table pack, then default game pack
  const currentPack =
    currentFlowFilePackPath ??
    currentDBTableSelection?.packPath ??
    (gameToPackWithDBTablesName[currentGame] || "db.pack");

  return (
    <>
      {isNodeEditorMounted && (
        // Hidden rather than unmounted: React Flow keeps its nodes, edges and viewport, so the tab
        // comes back exactly as it was left.
        <div className={isNodeEditorTab ? undefined : "hidden"}>
          <NodeEditor currentFile={currentFlowFileSelection} currentPack={currentPack}></NodeEditor>
        </div>
      )}

      {!isNodeEditorTab &&
        ((currentTab == "skills" && <SkillsTab />) ||
        (currentTab == "techTrees" && isTechnologyTreesSupported && <TechTreesTab />) ||
        (currentTab == "visuals" && isFeaturesForModdersEnabled && <VisualsTab />) ||
        (currentTab == "presets" && <PresetsTab />) ||
        (currentTab == "categories" && <Categories></Categories>) || (
          <div className="grid grid-cols-12 text-white max-w-[100rem] mx-auto">
            <div className="col-span-10">
              <ModRows scrollElement={props.scrollElement} />
            </div>
            <div className="ml-3 col-span-2 relative">
              <Sidebar />
            </div>
            <ModTagPicker></ModTagPicker>
          </div>
        ))}
    </>
  );
};

export default Main;
