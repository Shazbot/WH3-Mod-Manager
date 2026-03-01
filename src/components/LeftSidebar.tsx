import React, { memo, useContext, useEffect } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import "../styles/LeftSidebar.css";
import { IoIosList, IoMdCheckboxOutline } from "react-icons/io";
import { MdCategory } from "react-icons/md";
import { FaProjectDiagram } from "react-icons/fa";
import { BsCollection, BsPersonVcard } from "react-icons/bs";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setCurrentTab } from "../appSlice";
import localizationContext from "../localizationContext";

// const Tab = () => {}

const LeftSidebar = memo(() => {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const tabIndexToTabType: MainWindowTab[] = isFeaturesForModdersEnabled
    ? ["mods", "enabledMods", "categories", "presets", "visuals", "nodeEditor"]
    : ["mods", "enabledMods", "categories", "presets"];

  const onTabSelected = (index: number) => {
    const tabType = tabIndexToTabType[index];
    if (!tabType) return;
    console.log("setting tab", tabType);
    dispatch(setCurrentTab(tabType));
  };

  const localized: Record<string, string> = useContext(localizationContext);

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
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">Ctrl+1</span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child relative">
              <IoMdCheckboxOutline size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">{localized.enabledModsCapitalized}</span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">Ctrl+2</span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child relative">
              <MdCategory size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">{localized.categories}</span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">Ctrl+3</span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child relative">
              <BsCollection size="1.3rem" />
              <span className="ml-2 mr-2 hidden-child">
                {localized.presetsTab || localized.editPresets || "Presets"}
              </span>
              <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">Ctrl+4</span>
            </div>
          </Tab>
          {isFeaturesForModdersEnabled && (
            <Tab>
              <div className="flex items-center h-full parent-unhide-child relative">
                <BsPersonVcard size="1.25rem" />
                <span className="ml-2 mr-2 hidden-child">{localized.visualsTab || "Visuals"}</span>
                <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">Ctrl+5</span>
              </div>
            </Tab>
          )}
          {isFeaturesForModdersEnabled && (
            <Tab>
              <div className="flex items-center h-full parent-unhide-child relative">
                <FaProjectDiagram size="1.5rem" />
                <span className="ml-2 mr-2 hidden-child">{localized.nodeEditorTab || "Node Editor"}</span>
                <span className="text-xs absolute hidden-child -right-0 -bottom-2 opacity-60">Ctrl+6</span>
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
