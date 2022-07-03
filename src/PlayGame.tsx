import Creatable from "react-select/creatable";
import Select from "react-select";

import React, { useState } from "react";
import { ActionMeta } from "react-select";
import { useAppDispatch, useAppSelector } from "./hooks";
import { addPreset, deletePreset, replacePreset, selectPreset, setFilter } from "./appSlice";
import { Tooltip } from "flowbite-react";

export default function PlayGame() {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((state) => state.app.filter);

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const lastSelectedPreset: Preset | null = useAppSelector((state) => state.app.lastSelectedPreset);

  const playGameClicked = () => {
    window.api.writeUserScript(mods);
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

  const onChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(newValue.label, newValue.value, actionMeta.action);
    if (actionMeta.action === "select-option") dispatch(selectPreset(newValue.value));
  };

  const onDeleteChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(newValue.label, newValue.value, actionMeta.action);
    if (actionMeta.action === "select-option") dispatch(deletePreset(newValue.value));
  };

  const onReplaceChange = (newValue: OptionType, actionMeta: ActionMeta<OptionType>) => {
    console.log(newValue.label, newValue.value, actionMeta.action);
    if (actionMeta.action === "select-option") dispatch(replacePreset(newValue.value));
  };

  const defaultOption =
    (lastSelectedPreset !== null &&
      options.filter((option) => option.value === lastSelectedPreset.name))[0] || null;

  // console.log(lastSelectedPreset);
  // console.log(defaultOption);

  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setFilter(e.target.value));
  };

  return (
    <div>
      <Tooltip placement="left" content="Create new preset by typing its name">
        Select or create preset:
      </Tooltip>
      <Creatable
        value={defaultOption}
        options={options}
        onChange={onChange}
        onCreateOption={(name) => newPresetMade(name)}
      ></Creatable>
      <div className="mt-5">
        Replace preset:
        <Select options={options} onChange={onReplaceChange} value={null}></Select>
      </div>
      <div className="mt-5">
        Delete preset:
        <Select options={options} onChange={onDeleteChange} value={null}></Select>
      </div>
      <button
        className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded fixed h-14 w-36 m-auto right-[5%] bottom-[5%]"
        onClick={() => playGameClicked()}
      >
        Play
      </button>
      <div className="mt-5">
        Filter:
        <input
          type="text"
          onChange={(e) => onFilterChange(e)}
          value={filter}
          className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
        ></input>
      </div>
    </div>
  );
}
