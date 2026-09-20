import React, { RefObject, useEffect, useLayoutEffect } from "react";
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
import UnitViewerTab from "./UnitViewerTab";
import AbilitiesTab from "./abilities/AbilitiesTab";
import BuildingsTab from "./buildings/BuildingsTab";
import AncillariesTab from "./ancillaries/AncillariesTab";
import EsfMapTab from "./EsfMapTab";
import LoadOrderRulesTab from "./loadOrderRules/LoadOrderRulesTab";

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
  const isUnitViewerTab = currentTab == "unitViewer" && currentGame === "wh3";
  const isAbilitiesTab = currentTab == "abilities" && currentGame === "wh3";
  const isVisualsTab = currentTab == "visuals" && isFeaturesForModdersEnabled;
  const isSkillsTab = currentTab == "skills";
  const isTechTreesTab = currentTab == "techTrees" && isTechnologyTreesSupported;
  const isBuildingsTab = currentTab == "buildings" && currentGame === "wh3";
  const isAncillariesTab = currentTab == "ancillaries" && currentGame === "wh3";
  const isMapTab = currentTab == "map" && currentGame === "wh3";
  const isLoadOrderRulesTab = currentTab == "loadOrderRules";
  // Stateful tabs stay mounted once opened so switching tabs preserves their in-memory work.
  const isNodeEditorMounted = useKeepMountedOnceActive(isNodeEditorTab);
  const isUnitViewerMounted = useKeepMountedOnceActive(isUnitViewerTab);
  const isAbilitiesMounted = useKeepMountedOnceActive(isAbilitiesTab);
  const isVisualsMounted = useKeepMountedOnceActive(isVisualsTab);
  const isSkillsMounted = useKeepMountedOnceActive(isSkillsTab);
  const isTechTreesMounted = useKeepMountedOnceActive(isTechTreesTab);
  const isBuildingsMounted = useKeepMountedOnceActive(isBuildingsTab);
  const isAncillariesMounted = useKeepMountedOnceActive(isAncillariesTab);
  const isMapMounted = useKeepMountedOnceActive(isMapTab);
  const isAssetHostTabActive = isUnitViewerTab || isVisualsTab;
  const isKeptMountedTab =
    isNodeEditorTab ||
    isUnitViewerTab ||
    isAbilitiesTab ||
    isVisualsTab ||
    isSkillsTab ||
    isTechTreesTab ||
    isBuildingsTab ||
    isAncillariesTab ||
    isMapTab;

  useLayoutEffect(() => {
    if (!isAssetHostTabActive) return;

    // The viewer panels stay mounted for state preservation, so their host lifecycle must follow
    // the visible main tab rather than React mounting/unmounting.
    void window.api?.startWh3AssetHost?.();
    return () => {
      void window.api?.stopWh3AssetHost?.();
    };
  }, [isAssetHostTabActive]);

  useEffect(() => {
    const focusSidebarFilter = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== "f") return;

      const modRows = document.getElementById("rowsParent");
      const filterInput = document.getElementById("filterInput");
      if (!modRows || !filterInput) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      filterInput.focus();
    };

    document.addEventListener("keydown", focusSidebarFilter, true);
    return () => document.removeEventListener("keydown", focusSidebarFilter, true);
  }, []);

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
          <NodeEditor
            currentFile={currentFlowFileSelection}
            currentPack={currentPack}
            isActive={isNodeEditorTab}
          ></NodeEditor>
        </div>
      )}

      {isUnitViewerMounted && (
        <div className={isUnitViewerTab ? undefined : "hidden"}>
          <UnitViewerTab isActive={isUnitViewerTab} />
        </div>
      )}

      {isAbilitiesMounted && (
        <div className={isAbilitiesTab ? undefined : "hidden"}>
          <AbilitiesTab isActive={isAbilitiesTab} />
        </div>
      )}

      {isVisualsMounted && (
        <div className={isVisualsTab ? undefined : "hidden"}>
          <VisualsTab isActive={isVisualsTab} />
        </div>
      )}

      {isSkillsMounted && (
        <div className={isSkillsTab ? undefined : "hidden"}>
          <SkillsTab isActive={isSkillsTab} />
        </div>
      )}

      {isTechTreesMounted && (
        <div className={isTechTreesTab ? undefined : "hidden"}>
          <TechTreesTab />
        </div>
      )}

      {isBuildingsMounted && (
        <div className={isBuildingsTab ? undefined : "hidden"}>
          <BuildingsTab isActive={isBuildingsTab} />
        </div>
      )}

      {isAncillariesMounted && (
        <div className={isAncillariesTab ? undefined : "hidden"}>
          <AncillariesTab isActive={isAncillariesTab} />
        </div>
      )}

      {isMapMounted && (
        <div className={isMapTab ? undefined : "hidden"}>
          <EsfMapTab isActive={isMapTab} />
        </div>
      )}

      {!isKeptMountedTab &&
        ((currentTab == "presets" && <PresetsTab />) ||
          (isLoadOrderRulesTab && <LoadOrderRulesTab />) ||
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
