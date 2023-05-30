import React from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import "../styles/LeftSidebar.css";
import { IoIosList, IoMdCheckboxOutline } from "react-icons/io";
import { MdCategory } from "react-icons/md";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setCurrentTab } from "../appSlice";

// const Tab = () => {}

const tabIndexToTabType: MainWindowTab[] = ["mods", "enabledMods", "categories"];

const LeftSidebar = () => {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const onTabSelected = (index: number) => {
    const tabType = tabIndexToTabType[index];
    console.log("setting tab", tabType);
    dispatch(setCurrentTab(tabType));
  };

  return (
    <>
      <Tabs
        className="fixed top-14 z-[200] left-0 outline-transparent parent-unhide-child"
        onSelect={(index) => onTabSelected(index)}
        defaultIndex={tabIndexToTabType.findIndex((tabType) => tabType == currentTab)}
      >
        <TabList>
          <Tab>
            <div className="flex items-center h-full">
              <IoIosList size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">All Mods</span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child">
              <IoMdCheckboxOutline size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">Enabled Mods</span>
            </div>
          </Tab>
          <Tab>
            <div className="flex items-center h-full parent-unhide-child">
              <MdCategory size="1.5rem" />
              <span className="ml-2 mr-2 hidden-child">Categories</span>
            </div>
          </Tab>
        </TabList>
        <TabPanel></TabPanel>
        <TabPanel></TabPanel>
        <TabPanel></TabPanel>
      </Tabs>
    </>
  );
};
export default LeftSidebar;
