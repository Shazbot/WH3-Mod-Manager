import React, { memo, useContext, useEffect } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import "../styles/LeftSidebar.css";
import { IoIosList, IoMdCheckboxOutline } from "react-icons/io";
import { MdCategory } from "react-icons/md";
import { FaProjectDiagram } from "react-icons/fa";
import { BsCollection, BsDiagram3, BsPersonVcard } from "react-icons/bs";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setCurrentTab } from "../appSlice";
import localizationContext from "../localizationContext";

// const Tab = () => {}

const LeftSidebar = memo(() => {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const isDev = useAppSelector((state) => state.app.isDev);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const skillTreesDisplayMode = useAppSelector((state) => state.app.skillTreesDisplayMode);
  const technologyTreesDisplayMode = useAppSelector((state) => state.app.technologyTreesDisplayMode);
  const showVisualsTab = isFeaturesForModdersEnabled && isDev;
  const isSkillsTabVisible = currentGame === "wh3" && skillTreesDisplayMode === "tab";
  const isTechTreesTabVisible = currentGame === "wh3" && technologyTreesDisplayMode === "tab";
  const tabIndexToTabType: MainWindowTab[] = ["mods", "enabledMods", "categories", "presets"];
  if (isSkillsTabVisible) tabIndexToTabType.push("skills");
  if (showVisualsTab) tabIndexToTabType.push("visuals");
  if (isTechTreesTabVisible) tabIndexToTabType.push("techTrees");
  if (isFeaturesForModdersEnabled) tabIndexToTabType.push("nodeEditor");

  const onTabSelected = (index: number) => {
    const tabType = tabIndexToTabType[index];
    if (!tabType) return;
    console.log("setting tab", tabType);
    dispatch(setCurrentTab(tabType));
  };

  const localized: Record<string, string> = useContext(localizationContext);

  useEffect(() => {
    if (!tabIndexToTabType.includes(currentTab)) {
      dispatch(setCurrentTab("mods"));
    }
  }, [currentTab, dispatch, tabIndexToTabType]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        const keyNum = parseInt(e.key, 10);
        if (!Number.isNaN(keyNum)) {
          onTabSelected(keyNum - 1);
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  return (
    <>
      <Tabs
        id="left-sidebar"
        className="fixed top-8 z-[200] left-0 outline-transparent parent-unhide-child select-none"
        onSelect={(index) => onTabSelected(index)}
        selectedIndex={Math.max(
          0,
          tabIndexToTabType.findIndex((tabType) => tabType == currentTab),
        )}
      >
        <TabList>
          <Tab>
            <div className="flex items-center h-full relative">
              <IoIosList size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">{localized.allMods}</span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                Ctrl+{tabIndexToTabType.indexOf("mods") + 1}
              </span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child relative">
              <IoMdCheckboxOutline size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">{localized.enabledModsCapitalized}</span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                Ctrl+{tabIndexToTabType.indexOf("enabledMods") + 1}
              </span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child relative">
              <MdCategory size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">{localized.categories}</span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                Ctrl+{tabIndexToTabType.indexOf("categories") + 1}
              </span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child relative">
              <BsCollection size="1.3rem" />
              <span className="ml-2 mr-2 hidden-child">
                {localized.presetsTab || localized.editPresets || "Presets"}
              </span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                Ctrl+{tabIndexToTabType.indexOf("presets") + 1}
              </span>
            </div>
          </Tab>
          {isSkillsTabVisible && (
            <Tab>
              <div className="flex items-center h-full parent-unhide-child relative">
                <BsDiagram3 size="1.3rem" />
                <span className="ml-2 mr-2 hidden-child">{localized.skillsViewer || "Skill Trees"}</span>
                <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                  Ctrl+{tabIndexToTabType.indexOf("skills") + 1}
                </span>
              </div>
            </Tab>
          )}
          {showVisualsTab && (
            <Tab>
              <div className="flex items-center h-full parent-unhide-child relative">
                <BsPersonVcard size="1.25rem" />
                <span className="ml-2 mr-2 hidden-child">{localized.visualsTab || "Visuals"}</span>
                <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                  Ctrl+{tabIndexToTabType.indexOf("visuals") + 1}
                </span>
              </div>
            </Tab>
          )}
          {isTechTreesTabVisible && (
            <Tab>
              <div className="flex items-center h-full parent-unhide-child relative">
                <BsDiagram3 size="1.3rem" />
                <span className="ml-2 mr-2 hidden-child">{localized.techTreesTab || "Tech Trees"}</span>
                <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                  Ctrl+{tabIndexToTabType.indexOf("techTrees") + 1}
                </span>
              </div>
            </Tab>
          )}
          {isFeaturesForModdersEnabled && (
            <Tab>
              <div className="flex items-center h-full parent-unhide-child relative">
                <FaProjectDiagram size="1.5rem" />
                <span className="ml-2 mr-2 hidden-child">{localized.nodeEditorTab || "Node Editor"}</span>
                <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">
                  Ctrl+{tabIndexToTabType.indexOf("nodeEditor") + 1}
                </span>
              </div>
            </Tab>
          )}
        </TabList>
        {tabIndexToTabType.map((tabType) => (
          <TabPanel key={tabType}></TabPanel>
        ))}
      </Tabs>
    </>
  );
});
export default LeftSidebar;
