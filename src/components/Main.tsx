import React, { RefObject } from "react";
import { useAppSelector } from "../hooks";
import Sidebar from "./Sidebar";
import ModRows from "./ModRows";
import Categories from "./Categories";
import ModTagPicker from "./ModTagPicker";
import NodeEditor from "./NodeEditor";

type MainProps = {
  scrollElement: RefObject<HTMLDivElement>;
};
const Main = (props: MainProps) => {
  const currentTab = useAppSelector((state) => state.app.currentTab);
  return (
    <>
      {(currentTab == "categories" && <NodeEditor></NodeEditor>) || (
        <div className="grid grid-cols-12 text-white max-w-[100rem] mx-auto">
          <div className="col-span-10">
            <ModRows scrollElement={props.scrollElement} />
          </div>
          <div className="ml-3 col-span-2 relative">
            <Sidebar />
          </div>
          <ModTagPicker></ModTagPicker>
        </div>
      )}
    </>
  );
};

export default Main;
