import React from "react";
import { useAppSelector } from "../hooks";
import Sidebar from "./Sidebar";
import ModRows from "./ModRows";
import Categories from "./Categories";
import ModTagPicker from "./ModTagPicker";

const Main = () => {
  const currentTab = useAppSelector((state) => state.app.currentTab);
  return (
    <>
      {(currentTab == "categories" && <Categories></Categories>) || (
        <div className="grid grid-cols-12 text-white max-w-[100rem] mx-auto">
          <div className="col-span-10">
            <ModRows />
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
