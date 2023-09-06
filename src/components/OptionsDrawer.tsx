import Select, { ActionMeta, SingleValue } from "react-select";
import React, { memo, useCallback, useContext, useState } from "react";
import {
  toggleAlwaysHiddenMods,
  toggleAreThumbnailsEnabled,
  toggleIsClosedOnPlay,
  toggleIsAuthorEnabled,
  toggleIsAutoStartCustomBattleEnabled,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleMakeUnitsGenerals,
  setIsCreateSteamCollectionOpen,
  setDataModsToEnableByName,
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
import localizationContext from "../localizationContext";

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
  const dataModsToEnableByName = useAppSelector((state) => state.app.dataModsToEnableByName);
  const availableLanguages = useAppSelector((state) => state.app.availableLanguages);
  const currentLanguage = useAppSelector((state) => state.app.currentLanguage);

  const localized: Record<string, string> = useContext(localizationContext);

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

  const availableLanguagesToOptionsSelector = createSelector(
    (state: { app: AppState }) => state.app.availableLanguages,
    (availableLanguages) =>
      availableLanguages.map((language) => {
        return { value: language, label: language };
      })
  );
  const languageOptions = useSelector(availableLanguagesToOptionsSelector);

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

  const onLanguageChange = useCallback(
    (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
      if (!newValue) return;
      console.log(newValue.label, newValue.value, actionMeta.action);
      const language = availableLanguages.find((language) => language == newValue.value);
      if (!language) return;
      if (actionMeta.action === "select-option") {
        window.api?.requestLanguageChange(language);
      }
    },
    [availableLanguages]
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
        dispatch(
          setDataModsToEnableByName([...dataModsToEnableByName, ...enabledMods.map((mod) => mod.name)])
        );
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
          {localized.otherOptions}
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
              {localized.otherOptions}
            </h5>

            <div className="flex ">
              <button
                className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[50%]"
                onClick={() => setIsShowingAboutScreen(true)}
              >
                <span className="uppercase">{localized.about}</span>
              </button>
            </div>

            <div className="flex justify-center items-center mt-6">
              <label className="" htmlFor="languageSelect">
                {localized.language}
              </label>
              <Select
                className="ml-2"
                id="languageSelect"
                options={languageOptions}
                styles={selectStyle}
                onChange={onLanguageChange}
                defaultValue={{ value: currentLanguage, label: currentLanguage }}
              ></Select>
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
                {localized.closeOnPlay}
              </label>
            </div>

            <h6 className="mt-6">{localized.extraColumns}</h6>
            <div className="flex items-center ml-1">
              <input
                className="mt-1"
                type="checkbox"
                id="enable-thumbnails"
                checked={!!areThumbnailsEnabled}
                onChange={() => dispatch(toggleAreThumbnailsEnabled())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="enable-thumbnails">
                {localized.modThumbnailColumn}
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
                {localized.modAuthorColumn}
              </label>
            </div>

            <h6 className="mt-10">{localized.forceReDownload}</h6>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{localized.forceDownloadMsg}</p>

            <div className="flex mt-2">
              <button
                className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => forceDownloadMods()}
              >
                <span className="uppercase">{localized.forceReDownload}</span>
              </button>
            </div>

            <h6 className="mt-8">{localized.contentVsData}</h6>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{localized.contentVsDataMsg}</p>

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
                      <div>{localized.copyToDataMsg1}</div>
                      <div>{localized.copyToDataMsg2}</div>
                      <div>{localized.copyToDataMsg3}</div>
                      <div>{localized.copyToDataMsg4}</div>
                    </>
                  }
                >
                  <span className="uppercase">{localized.copyToData}</span>
                </Tooltip>
              </button>
            </div>

            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => cleanData()}
              >
                <Tooltip placement="bottom" style="light" content={localized.cleanDataMsg}>
                  <span className="uppercase">{localized.cleanData}</span>
                </Tooltip>
              </button>
            </div>

            <p className="mt-6 mb-4 text-sm text-gray-500 dark:text-gray-400">{localized.symLink}</p>

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
                      {!isAdmin && <div className="text-red-700 font-bold">{localized.reqAdmin}</div>}
                      <div>{localized.symLinkMsg1}</div>
                      <div>{localized.symLinkMsg2}</div>
                      <div>{localized.symLinkMsg3}</div>
                      <div>{localized.symLinkMsg4}</div>
                    </>
                  }
                >
                  <span className="uppercase">{localized.createSymLinks}</span>
                </Tooltip>
              </button>
            </div>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => cleanSymbolicLinksInData()}
              >
                <Tooltip placement="bottom" style="light" content={localized.cleanSymLinksMsg}>
                  <span className="uppercase">{localized.createSymLinks}</span>
                </Tooltip>
              </button>
            </div>

            <h6 className="mt-10">{localized.hiddenMods}</h6>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{localized.unhideMods}</p>

            <div>
              <Select options={options} styles={selectStyle} onChange={onDeleteChange} value={null}></Select>
            </div>

            <h6 className="mt-10">{localized.shareMods}</h6>
            <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{localized.shareModsMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => setIsShowingShareMods(true)}
              >
                <span className="uppercase">{localized.shareModLists}</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{localized.copyModNames}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => exportModNamesToClipboard(enabledMods)}
              >
                <span className="uppercase">{localized.copyModList}</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {localized.createSteamCollectionMsg}
            </p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => dispatch(setIsCreateSteamCollectionOpen(true))}
              >
                <span className="uppercase">{localized.createSteamCollection}</span>
              </button>
            </div>

            <h6 className="mt-10">{localized.forModders}</h6>
            <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">{localized.keepInSync}</p>
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
                      <div>{localized.forCustomBattleTesting}</div>
                    </>
                  }
                >
                  {localized.makeCustomBattleGenerals}
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
                      <div>{localized.enableScriptLogging1}</div>
                      <div>{localized.enableScriptLogging2}</div>
                    </>
                  }
                >
                  {localized.enableScriptLogging}
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
                {localized.skipIntroMovies}
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
                      <div>{localized.autoStartCustomBattles1}</div>
                      <div>{localized.autoStartCustomBattles2}</div>
                    </>
                  }
                >
                  {localized.autoStartCustomBattles}
                </Tooltip>
              </label>
            </div>

            <h6 className="mt-10">{localized.setFolderPaths}</h6>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{localized.setFolderPathsMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => setIsShowingSetFolderPaths(true)}
              >
                <span className="uppercase">{localized.setFolderPaths}</span>
              </button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
});
export default OptionsDrawer;
