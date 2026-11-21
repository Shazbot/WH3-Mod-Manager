import React, { RefObject, Suspense, useEffect, useLayoutEffect } from "react";
import { useAppSelector } from "../hooks";
import Sidebar from "./Sidebar";
import ModRows from "./ModRows";
import ModTagPicker from "./ModTagPicker";
import { useKeepMountedOnceActive } from "./useKeepMountedOnceActive";
import { gameToPackWithDBTablesName } from "../supportedGames";
import { Spinner } from "../flowbite/components/Spinner";

// Feature tabs are intentionally loaded on first use. Their modules pull in large editors and
// data-grid/3D dependencies that are not needed for the ordinary mod list.
const LazyNodeEditor = React.lazy(() => import("./NodeEditor"));
const LazyVisualsTab = React.lazy(() => import("./VisualsTab"));
const LazyPresetsTab = React.lazy(() => import("./PresetsTab"));
const LazyTechTreesTab = React.lazy(() => import("./techTrees/TechTreesTab"));
const LazySkillsTab = React.lazy(() => import("./skillsViewer/SkillsTab"));
const LazyUnitViewerTab = React.lazy(() => import("./UnitViewerTab"));
const LazyBuildingsTab = React.lazy(() => import("./buildings/BuildingsTab"));
const LazyAncillariesTab = React.lazy(() => import("./ancillaries/AncillariesTab"));
const LazyGameLogTab = React.lazy(() => import("./gameLog/GameLogTab"));
const LazyEsfMapTab = React.lazy(() => import("./EsfMapTab"));
const LazyLoadOrderRulesTab = React.lazy(() => import("./loadOrderRules/LoadOrderRulesTab"));
const LazyCategories = React.lazy(() => import("./Categories"));

type MainProps = {
  scrollElement: RefObject<HTMLDivElement | null>;
};

const LazyTab = ({ children }: { children: React.ReactNode }) => (
  <Suspense
    fallback={
      <div className="flex min-h-32 items-center justify-center">
        <Spinner aria-label="Loading" />
      </div>
    }
  >
    {children}
  </Suspense>
);

const Main = (props: MainProps) => {
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const modListWidth = useAppSelector((state) => state.app.modListWidth);
  const currentFlowFileSelection = useAppSelector((state) => state.app.currentFlowFileSelection);
  const currentFlowFilePackPath = useAppSelector((state) => state.app.currentFlowFilePackPath);
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const isTechnologyTreesSupported = currentGame === "wh3";
  const isNodeEditorTab = currentTab == "nodeEditor";
  const isUnitViewerTab = currentTab == "unitViewer" && currentGame === "wh3";
  const isVisualsTab = currentTab == "visuals" && isFeaturesForModdersEnabled;
  const isSkillsTab = currentTab == "skills";
  const isTechTreesTab = currentTab == "techTrees" && isTechnologyTreesSupported;
  const isBuildingsTab = currentTab == "buildings" && currentGame === "wh3";
  const isAncillariesTab = currentTab == "ancillaries" && currentGame === "wh3";
  const isMapTab = currentTab == "map" && currentGame === "wh3";
  const isGameLogTab = currentTab == "gameLog" && isFeaturesForModdersEnabled;
  const isLoadOrderRulesTab = currentTab == "loadOrderRules";
  // Stateful tabs stay mounted once opened so switching tabs preserves their in-memory work.
  const isNodeEditorMounted = useKeepMountedOnceActive(isNodeEditorTab);
  const isUnitViewerMounted = useKeepMountedOnceActive(isUnitViewerTab);
  const isVisualsMounted = useKeepMountedOnceActive(isVisualsTab);
  const isSkillsMounted = useKeepMountedOnceActive(isSkillsTab);
  const isTechTreesMounted = useKeepMountedOnceActive(isTechTreesTab);
  const isBuildingsMounted = useKeepMountedOnceActive(isBuildingsTab);
  const isAncillariesMounted = useKeepMountedOnceActive(isAncillariesTab);
  const isMapMounted = useKeepMountedOnceActive(isMapTab);
  const isGameLogMounted = useKeepMountedOnceActive(isGameLogTab);
  const isAssetHostTabActive = isUnitViewerTab || isVisualsTab;
  const isKeptMountedTab =
    isNodeEditorTab ||
    isUnitViewerTab ||
    isVisualsTab ||
    isSkillsTab ||
    isTechTreesTab ||
    isBuildingsTab ||
    isAncillariesTab ||
    isMapTab ||
    isGameLogTab;

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
          <LazyTab>
            <LazyNodeEditor
              currentFile={currentFlowFileSelection}
              currentPack={currentPack}
              isActive={isNodeEditorTab}
            />
          </LazyTab>
        </div>
      )}

      {isUnitViewerMounted && (
        <div className={isUnitViewerTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyUnitViewerTab isActive={isUnitViewerTab} />
          </LazyTab>
        </div>
      )}

      {isVisualsMounted && (
        <div className={isVisualsTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyVisualsTab isActive={isVisualsTab} />
          </LazyTab>
        </div>
      )}

      {isSkillsMounted && (
        <div className={isSkillsTab ? undefined : "hidden"}>
          <LazyTab>
            <LazySkillsTab isActive={isSkillsTab} />
          </LazyTab>
        </div>
      )}

      {isTechTreesMounted && (
        <div className={isTechTreesTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyTechTreesTab />
          </LazyTab>
        </div>
      )}

      {isBuildingsMounted && (
        <div className={isBuildingsTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyBuildingsTab isActive={isBuildingsTab} />
          </LazyTab>
        </div>
      )}

      {isAncillariesMounted && (
        <div className={isAncillariesTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyAncillariesTab isActive={isAncillariesTab} />
          </LazyTab>
        </div>
      )}

      {isMapMounted && (
        <div className={isMapTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyEsfMapTab isActive={isMapTab} />
          </LazyTab>
        </div>
      )}

      {isGameLogMounted && (
        <div className={isGameLogTab ? undefined : "hidden"}>
          <LazyTab>
            <LazyGameLogTab isActive={isGameLogTab} />
          </LazyTab>
        </div>
      )}

      {!isKeptMountedTab &&
        ((currentTab == "presets" && (
          <LazyTab>
            <LazyPresetsTab />
          </LazyTab>
        )) ||
          (isLoadOrderRulesTab && (
            <LazyTab>
              <LazyLoadOrderRulesTab />
            </LazyTab>
          )) ||
          (currentTab == "categories" && (
            <LazyTab>
              <LazyCategories />
            </LazyTab>
          )) || (
            <div
              className={
                modListWidth === "wide"
                  ? "grid grid-cols-12 text-white max-w-[120rem] mx-auto"
                  : modListWidth === "default"
                    ? "grid grid-cols-12 text-white max-w-[100rem] mx-auto"
                    : "grid grid-cols-12 text-white"
              }
            >
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
