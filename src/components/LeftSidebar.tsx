import React, { memo, useContext, useEffect } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import "../styles/LeftSidebar.css";
import { IoIosList, IoMdCheckboxOutline } from "react-icons/io";
import { MdCategory } from "react-icons/md";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setCurrentTab } from "../appSlice";
import localizationContext from "../localizationContext";

// const Tab = () => {}

const tabIndexToTabType: MainWindowTab[] = ["mods", "enabledMods", "categories"];

const LeftSidebar = memo(() => {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const onTabSelected = (index: number) => {
    const tabType = tabIndexToTabType[index];
    console.log("setting tab", tabType);
    dispatch(setCurrentTab(tabType));
  };

  const localized: Record<string, string> = useContext(localizationContext);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        switch (e.key) {
          case "1":
            onTabSelected(0);
            break;
          case "2":
            onTabSelected(1);
            break;
          case "3":
            onTabSelected(2);
            break;
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
        className="fixed top-8 z-[200] left-0 outline-transparent parent-unhide-child"
        onSelect={(index) => onTabSelected(index)}
        selectedIndex={tabIndexToTabType.findIndex((tabType) => tabType == currentTab)}
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
        </TabList>
        <TabPanel></TabPanel>
        <TabPanel></TabPanel>
        <TabPanel></TabPanel>
      </Tabs>
    </>
  );
});
export default LeftSidebar;
