import Select, { ActionMeta } from "react-select";
import React, { useState } from "react";
import {
  toggleAlwaysHiddenMods,
  toggleAreThumbnailsEnabled,
  toggleIsAuthorEnabled,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleMakeUnitsGenerals,
} from "./appSlice";
import Drawer from "./Drawer";
import { useAppDispatch, useAppSelector } from "./hooks";
import selectStyle from "./styles/selectStyle";
import { Tooltip } from "flowbite-react";
import ShareMods from "./ShareMods";

export default function OptionsDrawer() {
  const [isShowingShareMods, setIsShowingShareMods] = useState<boolean>(false);

  const dispatch = useAppDispatch();
  const alwaysHidden = useAppSelector((state) => state.app.hiddenMods);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const contentMods = useAppSelector((state) => state.app.currentPreset.mods).filter((mod) => !mod.isInData);

  const [areOptionsOpen, setAreOptionsOpen] = React.useState(false);

  const copyToData = () => {
    window.api.copyToData();
  };
  const cleanData = () => {
    window.api.cleanData();
  };

  const forceDownloadMods = () => {
    window.api.forceDownloadMods(contentMods.map((mod) => mod.workshopId));
  };

  const onDeleteChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(newValue.label, newValue.value, actionMeta.action);
    const mod = alwaysHidden.find((mod) => mod.name == newValue.value);
    if (!mod) return;
    if (actionMeta.action === "select-option") dispatch(toggleAlwaysHiddenMods([mod]));
  };

  type OptionType = {
    value: string;
    label: string;
  };

  const options: OptionType[] = useAppSelector((state) =>
    state.app.hiddenMods.map((mod) => {
      const humanName = mod.humanName !== "" ? mod.humanName : mod.name;
      return { value: mod.name, label: humanName };
    })
  );

  return (
    <div>
      <ShareMods isOpen={isShowingShareMods} setIsOpen={setIsShowingShareMods} />
      <div className="text-center">
        <button
          onClick={() => setAreOptionsOpen(!areOptionsOpen)}
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
          data-drawer-target="drawer-example"
          data-drawer-show="drawer-example"
          aria-controls="drawer-example"
        >
          Other Options
        </button>
      </div>

      <Drawer isOpen={areOptionsOpen} setIsOpen={setAreOptionsOpen}>
        <div
          id="drawer-example"
          className="overflow-y-auto fixed z-40 p-4 w-full h-screen bg-white dark:bg-gray-800 transition-transform left-0 top-0 transform-none"
          tabIndex={-1}
          aria-labelledby="drawer-label"
          aria-modal="true"
          role="dialog"
        >
          <h5
            id="drawer-label"
            className="inline-flex items-center mb-4 text-base font-semibold text-gray-500 dark:text-gray-400"
          >
            Other Options
          </h5>

          <h6>Extra Columns</h6>
          <div className="flex items-center ml-1">
            <input
              className="mt-1"
              type="checkbox"
              id="enable-thumbnails"
              checked={!!areThumbnailsEnabled}
              onChange={() => dispatch(toggleAreThumbnailsEnabled())}
            ></input>
            <label className="ml-2 mt-1" htmlFor="enable-thumbnails">
              Mod Thumbnail Column
            </label>
          </div>

          <div className="flex items-center ml-1">
            <input
              className="mt-1"
              type="checkbox"
              id="enable-mod-author"
              checked={!!isAuthorEnabled}
              onChange={() => dispatch(toggleIsAuthorEnabled())}
            ></input>
            <label className="ml-2 mt-1" htmlFor="enable-mod-author">
              Mod Author Column
            </label>
          </div>

          <h6 className="mt-10">Force Re-download</h6>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Force steam to download the latest version of all mods:
          </p>

          <div className="flex mt-2">
            <button
              className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
              onClick={() => forceDownloadMods()}
            >
              <span className="uppercase">Force Re-Download</span>
            </button>
          </div>

          <h6 className="mt-8">Content Mods Vs Data Mods</h6>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Mods you've subscribed to reside in the workshop (content) folder, but can also be loaded from the
            data folder. Don't touch unless you know what you're doing!
          </p>

          <div className="flex mt-2">
            <button
              className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
              onClick={() => copyToData()}
            >
              <Tooltip
                placement="bottom"
                content="Will copy all the mods from content into data. As a modder this can overwrite your mod in data with an
                older version you have in content!"
              >
                <span className="uppercase">Copy to data</span>
              </Tooltip>
            </button>
          </div>

          <div className="flex mt-2 w-full">
            <button
              className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
              onClick={() => cleanData()}
            >
              <Tooltip
                placement="bottom"
                content="Will remove mods in data if the mod already exists in content. As a modder this can remove a newer version of your mod in data!"
              >
                <span className="uppercase">Clean data</span>
              </Tooltip>
            </button>
          </div>

          <h6 className="mt-10">Hidden mods</h6>
          <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
            Unhide mods you've previously hidden:
          </p>

          <div>
            <Select options={options} styles={selectStyle} onChange={onDeleteChange} value={null}></Select>
          </div>

          <h6 className="mt-10">Share mods</h6>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Share current mod list with other people for multiplayer.
          </p>
          <div className="flex mt-2 w-full">
            <button
              className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
              onClick={() => setIsShowingShareMods(true)}
            >
              <span className="uppercase">Share Mod List</span>
            </button>
          </div>

          <h6 className="mt-10">For Modders</h6>
          <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Keep these in sync for MP.</p>
          <div className="flex items-center ml-1">
            <input
              className="mt-1"
              type="checkbox"
              id="make-general-units"
              checked={!!isMakeUnitsGeneralsEnabled}
              onChange={() => dispatch(toggleMakeUnitsGenerals())}
            ></input>
            <label className="ml-2 mt-1" htmlFor="make-general-units">
              Make all units custom battle generals
            </label>
          </div>
          <div className="flex items-center ml-1">
            <input
              className="mt-1"
              type="checkbox"
              id="toggle-script-logging"
              checked={!!isScriptLoggingEnabled}
              onChange={() => dispatch(toggleIsScriptLoggingEnabled())}
            ></input>
            <label className="ml-2 mt-1" htmlFor="toggle-script-logging">
              Enable script logging
            </label>
          </div>
          <div className="flex items-center ml-1">
            <input
              className="mt-1"
              type="checkbox"
              id="toggle-intro-movies"
              checked={!!isSkipIntroMoviesEnabled}
              onChange={() => dispatch(toggleIsSkipIntroMoviesEnabled())}
            ></input>
            <label className="ml-2 mt-1" htmlFor="toggle-intro-movies">
              Skip intro movies
            </label>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
