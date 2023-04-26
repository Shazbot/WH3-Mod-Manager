import Select, { ActionMeta, SingleValue } from "react-select";
import React, { memo, useCallback, useState } from "react";
import {
  toggleAlwaysHiddenMods,
  toggleAreThumbnailsEnabled,
  toggleIsClosedOnPlay,
  toggleIsAuthorEnabled,
  toggleIsAutoStartCustomBattleEnabled,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleMakeUnitsGenerals,
  dataModsToEnableByName,
  setIsCreateSteamCollectionOpen,
} from "../appSlice";
import Drawer from "./Drawer";
import { useAppDispatch, useAppSelector } from "../hooks";
import selectStyle from "../styles/selectStyle";
import { Tooltip } from "flowbite-react";
import ShareMods from "./ShareMods";
import { useSelector } from "react-redux";
import { createSelector } from "@reduxjs/toolkit";
import GamePathsSetup from "./GamePathsSetup";
import AboutScreen from "./AboutScreen";
import CreateSteamCollection from "./CreateSteamCollection";

const cleanData = () => {
  window.api?.cleanData();
};

const cleanSymbolicLinksInData = () => {
  window.api?.cleanSymbolicLinksInData();
};

const exportModNamesToClipboard = (enabledMods: Mod[]) => {
  window.api?.exportModNamesToClipboard(enabledMods);
};

type OptionType = {
  value: string;
  label: string;
};

const OptionsDrawer = memo(() => {
  const [isShowingShareMods, setIsShowingShareMods] = useState<boolean>(false);
  const [isShowingSetFolderPaths, setIsShowingSetFolderPaths] = useState<boolean>(false);
  const [isShowingAboutScreen, setIsShowingAboutScreen] = useState<boolean>(false);

  const dispatch = useAppDispatch();
  const alwaysHidden = useAppSelector((state) => state.app.hiddenMods);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
  const isClosedOnPlay = useAppSelector((state) => state.app.isClosedOnPlay);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const isAutoStartCustomBattleEnabled = useAppSelector((state) => state.app.isAutoStartCustomBattleEnabled);
  const isAdmin = useAppSelector((state) => state.app.isAdmin);

  const enabledModsSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods: Mod[]) => mods.filter((iterMod) => iterMod.isEnabled)
  );
  const contentModsWorshopIdsSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods: Mod[]) => mods.filter((mod) => !mod.isInData).map((mod) => mod.workshopId)
  );
  const contentModsWorshopIds = useSelector(contentModsWorshopIdsSelector);
  const enabledMods = useSelector(enabledModsSelector);

  const hiddenModsToOptionViewDataSelector = createSelector(
    (state: { app: AppState }) => state.app.hiddenMods,
    (hiddenMods) =>
      hiddenMods.map((mod) => {
        const humanName = mod.humanName !== "" ? mod.humanName : mod.name;
        return { value: mod.name, label: humanName };
      })
  );
  const options: OptionType[] = useSelector(hiddenModsToOptionViewDataSelector);

  const [areOptionsOpen, setAreOptionsOpen] = React.useState(false);

  const forceDownloadMods = useCallback(() => {
    window.api?.forceDownloadMods(contentModsWorshopIds);
  }, [contentModsWorshopIds]);

  const onDeleteChange = useCallback(
    (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
      if (!newValue) return;
      console.log(newValue.label, newValue.value, actionMeta.action);
      const mod = alwaysHidden.find((mod) => mod.name == newValue.value);
      if (!mod) return;
      if (actionMeta.action === "select-option") dispatch(toggleAlwaysHiddenMods([mod]));
    },
    [alwaysHidden]
  );

  const copyToData = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      if (e.shiftKey) {
        window.api?.copyToData();
      } else {
        window.api?.copyToData(enabledMods.map((mod) => mod.path));
      }
    },
    [enabledMods]
  );

  const copyToDataAsSymbolicLink = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      if (e.shiftKey) {
        window.api?.copyToDataAsSymbolicLink();
      } else {
        window.api?.copyToDataAsSymbolicLink(enabledMods.map((mod) => mod.path));
        dataModsToEnableByName.push(...enabledMods.map((mod) => mod.name));
      }
    },
    [enabledMods]
  );

  return (
    <div>
      <GamePathsSetup
        isOpen={isShowingSetFolderPaths}
        setIsOpen={setIsShowingSetFolderPaths}
      ></GamePathsSetup>
      <AboutScreen isOpen={isShowingAboutScreen} setIsOpen={setIsShowingAboutScreen}></AboutScreen>
      <ShareMods isOpen={isShowingShareMods} setIsOpen={setIsShowingShareMods} />
      <CreateSteamCollection />

      <div className="text-center">
        <button
          onClick={() => setAreOptionsOpen(!areOptionsOpen)}
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
          aria-controls="drawer-example"
        >
          Other Options
        </button>
      </div>

      {areOptionsOpen && (
        <Drawer isOpen={areOptionsOpen} setIsOpen={setAreOptionsOpen}>
          <div
            id="drawer-example"
            className="overflow-y-scroll fixed z-40 p-4 w-full h-screen bg-white dark:bg-gray-800 transition-transform left-[-16px] top-0 transform-none scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
            tabIndex={-1}
            aria-labelledby="drawer-label"
            aria-modal="true"
            role="dialog"
          >
            <h5
              id="drawer-label"
              className="inline-flex items-center mb-4 text-base font-semibold text-gray-500 dark:text-gray-400 mt-6"
            >
              Other Options
            </h5>

            <div className="flex ">
              <button
                className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[50%]"
                onClick={() => setIsShowingAboutScreen(true)}
              >
                <span className="uppercase">About</span>
              </button>
            </div>

            <div className="flex items-center ml-1 mt-6">
              <input
                className="mt-1"
                type="checkbox"
                id="enable-closed-on-play"
                checked={!!isClosedOnPlay}
                onChange={() => dispatch(toggleIsClosedOnPlay())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="enable-closed-on-play">
                Close Mananger On Play
              </label>
            </div>

            <h6 className="mt-6">Extra Columns</h6>
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
              Mods you've subscribed to reside in the workshop (content) folder, but can also be loaded from
              the data folder. Don't touch unless you know what you're doing!
            </p>

            <div className="flex mt-2">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={(e) => copyToData(e)}
              >
                <Tooltip
                  placement="top"
                  style="light"
                  content={
                    <>
                      <div>Will copy currently enabled mods from content into data.</div>
                      <div>Hold Shift if you want to copy all mods.</div>
                      <div>
                        As a modder this can overwrite your mod in data with an older version you have in
                        content!
                      </div>
                      <div>Mods that are in data will have a red name in the manager.</div>
                    </>
                  }
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
                  style="light"
                  content="Will remove mods in data if the mod already exists in content. As a modder this can remove a newer version of your mod in data!"
                >
                  <span className="uppercase">Clean data</span>
                </Tooltip>
              </button>
            </div>

            <p className="mt-6 mb-4 text-sm text-gray-500 dark:text-gray-400">
              You can also copy them as symbolic links (basically a shortcut) so they don't take up duplicate
              space. They will also always be up-to-date with the content mod since they're just a shortcut to
              the actual mod.
            </p>

            <div className="flex mt-2">
              <button
                className={
                  "make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%] " +
                  ((!isAdmin &&
                    "bg-opacity-50 hover:bg-opacity-50 text-opacity-50 hover:text-opacity-50 cursor-not-allowed") ||
                    "")
                }
                onClick={(e) => copyToDataAsSymbolicLink(e)}
                disabled={!isAdmin}
              >
                <Tooltip
                  placement="top"
                  style="light"
                  content={
                    <>
                      {!isAdmin && (
                        <div className="text-red-700 font-bold">Requires running as administrator!</div>
                      )}
                      <div>Will create Symbolic Links of currently enabled mods from content into data.</div>
                      <div>Hold Shift if you want to create links of all mods.</div>
                      <div>This won't create links of mods that already exist in data.</div>
                      <div>Mods that are symbolic links will have a blue name in the manager.</div>
                    </>
                  }
                >
                  <span className="uppercase">Create symbolic links in data</span>
                </Tooltip>
              </button>
            </div>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => cleanSymbolicLinksInData()}
              >
                <Tooltip
                  placement="bottom"
                  style="light"
                  content="Will remove all symbolic links in data. Won't touch real mods that aren't symbolic links."
                >
                  <span className="uppercase">Clean symbolic links in data</span>
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
            <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
              Share current mod list with other people for multiplayer:
            </p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => setIsShowingShareMods(true)}
              >
                <span className="uppercase">Share Mod List</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Copy names of enabled mods to clipboard:
            </p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => exportModNamesToClipboard(enabledMods)}
              >
                <span className="uppercase">Copy Mod List</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Create a Steam collection from enabled mods:
            </p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => dispatch(setIsCreateSteamCollectionOpen(true))}
              >
                <span className="uppercase">Create Steam Collection</span>
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
                <Tooltip
                  placement="left"
                  style="light"
                  content={
                    <>
                      <div>For 1v1 testing in custom battles.</div>
                    </>
                  }
                >
                  Make all units custom battle generals
                </Tooltip>
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
                <Tooltip
                  placement="left"
                  style="light"
                  content={
                    <>
                      <div>Enables WH3 script logging.</div>
                      <div>Logs are created in the WH3 folder.</div>
                    </>
                  }
                >
                  Enable script logging
                </Tooltip>
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
            <div className="flex items-center ml-1">
              <input
                className="mt-1"
                type="checkbox"
                id="toggleIsAutoStartCustomBattleEnabled"
                checked={!!isAutoStartCustomBattleEnabled}
                onChange={() => dispatch(toggleIsAutoStartCustomBattleEnabled())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="toggleIsAutoStartCustomBattleEnabled">
                <Tooltip
                  placement="bottom"
                  style="light"
                  content={
                    <>
                      <div>For repetitive visual testing that involves restarting the game.</div>
                      <div>Set up a custom battle once and enable this to auto-enter it.</div>
                    </>
                  }
                >
                  Auto-start custom battle
                </Tooltip>
              </label>
            </div>

            <h6 className="mt-10">Set Folder Paths</h6>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Set WH3 and Steam Workshop content folder paths.
            </p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => setIsShowingSetFolderPaths(true)}
              >
                <span className="uppercase">Set Folder Paths</span>
              </button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
});
export default OptionsDrawer;
