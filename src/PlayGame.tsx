import Creatable from "react-select/creatable";
import Select, { ActionMeta } from "react-select";
import React, { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import { addPreset, deletePreset, replacePreset, selectPreset, setFilter } from "./appSlice";
import { Tooltip } from "flowbite-react";
import { UpdateNotification } from "./UpdateNotification";
import OptionsDrawer from "./OptionsDrawer";
import selectStyle from "./styles/selectStyle";
import SaveGames from "./SaveGames";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export default function PlayGame() {
  const dispatch = useAppDispatch();
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const filter = useAppSelector((state) => state.app.filter);
  const saves = [...useAppSelector((state) => state.app.saves)];
  saves.sort((first, second) => second.lastChanged - first.lastChanged);

  const [isUpdateCheckDone, setIsUpdateCheckDone] = useState<boolean>(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false);
  const [downloadURL, setDownloadURL] = useState<string>("");
  const [isShowingSavedGames, setIsShowingSavedGames] = useState<boolean>(false);

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const hiddenMods = useAppSelector((state) => state.app.hiddenMods);
  const lastSelectedPreset: Preset | null = useAppSelector((state) => state.app.lastSelectedPreset);

  const playGameClicked = () => {
    window.api.startGame(mods, {
      isMakeUnitsGeneralsEnabled,
      isSkipIntroMoviesEnabled,
      isScriptLoggingEnabled,
    });
  };

  type OptionType = {
    value: string;
    label: string;
  };

  const options: OptionType[] = useAppSelector((state) =>
    state.app.presets.map((preset) => {
      return { value: preset.name, label: preset.name };
    })
  );

  const newPresetMade = (name: string) => {
    dispatch(addPreset({ name: name, mods: mods }));
    console.log(name);
  };

  let isShiftDown = false;
  let isControlDown = false;

  const onChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
    if (actionMeta.action !== "select-option") return;

    let presetSelection = "unary" as PresetSelection;
    if (isControlDown) presetSelection = "subtraction" as PresetSelection;
    else if (isShiftDown) presetSelection = "addition" as PresetSelection;

    dispatch(selectPreset([newValue.value, presetSelection]));
  };

  const onDeleteChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
    if (actionMeta.action === "select-option") dispatch(deletePreset(newValue.value));
  };

  const onReplaceChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
    if (actionMeta.action === "select-option") dispatch(replacePreset(newValue.value));
  };

  const defaultOption =
    (lastSelectedPreset !== null &&
      options.filter((option) => option.value === lastSelectedPreset.name))[0] || null;

  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setFilter(e.target.value));
  };

  const onContinueGameClicked = () => {
    window.api.startGame(
      mods,
      { isMakeUnitsGeneralsEnabled, isSkipIntroMoviesEnabled, isScriptLoggingEnabled },
      saves[0]?.name
    );
  };
  const onShowSavedGamesClicked = () => {
    setIsShowingSavedGames(true);
  };

  const clearFilter = () => {
    dispatch(setFilter(""));
  };

  const getUpdateData = async () => {
    try {
      const appUpdateData: ModUpdateExists = await window.api.getUpdateData();
      if (appUpdateData.updateExists) {
        console.log("UPDATE EXITS");
        setIsUpdateAvailable(true);
        setDownloadURL(appUpdateData.downloadURL);

        setTimeout(() => {
          setIsUpdateAvailable(false);
        }, 15000);
      }
    } catch (err) {
      console.log(err);
    }
  };
  useEffect(() => {
    if (!isUpdateCheckDone) {
      setIsUpdateCheckDone(true);
      getUpdateData();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        const filterInput = document.getElementById("filterInput");
        filterInput?.focus();
      }

      if (e.key === "Shift") isShiftDown = true;
      if (e.key === "Control") isControlDown = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") isShiftDown = false;
      if (e.key === "Control") isControlDown = false;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
  });

  const numEnabledMods = mods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  ).length;

  return (
    <div>
      <SaveGames isOpen={isShowingSavedGames} setIsOpen={setIsShowingSavedGames} />
      <div id="presetSection">
        <Tooltip placement="left" content="Create new preset by typing its name">
          <span className="text-slate-100">Select or create preset:</span>
        </Tooltip>
        <Creatable
          id="createOrSelectPreset"
          value={defaultOption}
          options={options}
          onChange={onChange}
          styles={selectStyle}
          onCreateOption={(name) => newPresetMade(name)}
        ></Creatable>
        <div className="mt-5">
          <span className="text-slate-100">Replace preset:</span>
          <Select
            id="replacePreset"
            options={options}
            styles={selectStyle}
            onChange={onReplaceChange}
            value={null}
          ></Select>
        </div>
        <div className="mt-5">
          <span className="text-slate-100">Delete preset:</span>
          <Select
            id="deletePreset"
            options={options}
            styles={selectStyle}
            onChange={onDeleteChange}
            value={null}
          ></Select>
        </div>
      </div>

      <div className="fixed right-[5%] bottom-[4%]">
        <div className="text-center text-slate-100 mb-4">
          {numEnabledMods > 0 && <>Enabled Mods: {numEnabledMods}</>}
        </div>
        <button
          id="playGame"
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded h-14 w-36 m-auto"
          onClick={() => playGameClicked()}
        >
          Play
        </button>

        <div className="mt-2">
          <button
            id="continueGame"
            className="bg-green-600 border-green-500 border-2 hover:bg-green-700 text-white font-medium text-sm px-4 rounded  h-7 w-36 m-auto "
            onClick={() => onContinueGameClicked()}
            disabled={saves.length < 1}
          >
            <span className="ml-[-25%]">Continue</span>
          </button>
          <button
            id="showSaves"
            type="submit"
            className="absolute h-7 w-9 bottom-0 right-0 px-1 text-sm font-medium text-white bg-green-600 rounded-r-lg border border-green-500 hover:bg-green-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800"
            onClick={() => onShowSavedGamesClicked()}
            disabled={saves.length < 1}
          >
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              overflow="visible"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"></path>
            </svg>
          </button>
        </div>
      </div>

      <div className={"dark fixed w-80 mx-auto inset-x-0 bottom-[1%] " + (isUpdateAvailable ? "" : "hidden")}>
        <UpdateNotification downloadURL={downloadURL}></UpdateNotification>
      </div>
      <div className="mt-5 static">
        <span className="text-slate-100">Filter:</span>
        <span className="relative">
          <input
            id="filterInput"
            type="text"
            onChange={(e) => onFilterChange(e)}
            value={filter}
            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
          ></input>

          <span className="absolute right-[0.65rem] top-8 text-gray-400">
            <button onClick={() => clearFilter()}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </span>
        </span>
      </div>

      <div className="mt-6">
        <OptionsDrawer />
      </div>
    </div>
  );
}
