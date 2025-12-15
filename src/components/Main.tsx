import React, { RefObject } from "react";
import { useAppSelector } from "../hooks";
import Sidebar from "./Sidebar";
import ModRows from "./ModRows";
import Categories from "./Categories";
import ModTagPicker from "./ModTagPicker";
import NodeEditor from "./NodeEditor";
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

  // Determine current pack: prioritize flow file pack, then DB table pack, then default game pack
  const currentPack =
    currentFlowFilePackPath ??
    currentDBTableSelection?.packPath ??
    (gameToPackWithDBTablesName[currentGame] || "db.pack");

  return (
    <>
      {(currentTab == "nodeEditor" && (
        <NodeEditor currentFile={currentFlowFileSelection} currentPack={currentPack}></NodeEditor>
      )) ||
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
        )}
    </>
  );
};

export default Main;
