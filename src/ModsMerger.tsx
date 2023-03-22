import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "./flowbite/components/Modal/index";
import { Spinner, Tabs, Tooltip } from "./flowbite";
import {
  getModsSortedByName,
  getModsSortedByHumanName,
  getModsSortedBySize,
  getFilteredMods,
} from "./modSortingHelpers";
import Select, { ActionMeta, SingleValue } from "react-select";
import selectStyle from "./styles/selectStyle";
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import { useAppSelector } from "./hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

type ModsMergeSorts = "Merge" | "MergeDesc" | "Pack" | "PackDesc" | "Name" | "NameDesc" | "Size" | "SizeDesc";
type NumModsOptionType = {
  value: number;
  label: number;
};
type ExistingMergerOptionType = {
  value: string;
  label: string;
};

const ModsMerger = React.memo(() => {
  const isDev = useAppSelector((state) => state.app.isDev);

  const modsNotInDataSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods) => mods.filter((mod) => isDev || !mod.isInData)
  );
  const mods = useSelector(modsNotInDataSelector);

  const allDependencyPacks =
    mods
      .map((mod) => mod.dependencyPacks)
      .filter((depPack) => depPack != null)
      .reduce((acc, val) => {
        if (acc && val)
          return acc?.concat(val.filter((depPack) => !acc.find((accPack) => accPack == depPack)));
        return [];
      }, [] as string[]) || [];

  // console.log("allDependencyPacks", allDependencyPacks);

  const mergerModsSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods) => mods.filter((mod) => mod.mergedModsData && mod.isEnabled)
  );
  const mergerMods = useSelector(mergerModsSelector);

  const [useEnabledModsOnly, setUseEnabledModsOnly] = React.useState(true);
  const [isHidingAlreadyMergedMods, setIsHidingAlreadyMergedMods] = React.useState(true);
  const [isOpen, setIsOpen] = React.useState(false);
  const [modsToMerge, setModsToMerge] = React.useState<Set<string>>(new Set<string>());
  const [isSpinnerClosed, setIsSpinnerClosed] = React.useState(false);
  const [modsMergeSort, setModsMergeSort] = React.useState("Size" as ModsMergeSorts);

  let modsToUse = [...mods];

  if (isHidingAlreadyMergedMods) {
    modsToUse = modsToUse.filter((mod) =>
      mergerMods.every((mergerMod) =>
        mergerMod.mergedModsData?.every((mergedModData) => mergedModData.name != mod.name)
      )
    );
  }

  switch (modsMergeSort) {
    case "Merge":
      modsToUse = modsToUse.sort((firstMod, secondMod) => {
        if (modsToMerge.has(firstMod.workshopId) && modsToMerge.has(secondMod.workshopId)) return 0;
        if (modsToMerge.has(firstMod.workshopId)) return -1;
        if (modsToMerge.has(secondMod.workshopId)) return 1;
        return 0;
      });
      break;
    case "MergeDesc":
      modsToUse = modsToUse.sort((firstMod, secondMod) => {
        if (modsToMerge.has(firstMod.workshopId) && modsToMerge.has(secondMod.workshopId)) return 0;
        if (modsToMerge.has(firstMod.workshopId)) return 1;
        if (modsToMerge.has(secondMod.workshopId)) return -1;
        return 0;
      });
      break;
    case "Pack":
      modsToUse = getModsSortedByName(modsToUse);
      break;
    case "PackDesc":
      modsToUse = getModsSortedByName(modsToUse).reverse();
      break;
    case "Name":
      modsToUse = getModsSortedByHumanName(modsToUse);
      break;
    case "NameDesc":
      modsToUse = getModsSortedByHumanName(modsToUse).reverse();
      break;
    case "Size":
      modsToUse = getModsSortedBySize(modsToUse);
      break;
    case "SizeDesc":
      modsToUse = getModsSortedBySize(modsToUse).reverse();
      break;
  }
  modsToUse = modsToUse.filter((mod) => (!useEnabledModsOnly && mod) || mod.isEnabled);
  if (useEnabledModsOnly) {
    const filteredSet = new Set(
      Array.from(modsToMerge).filter((workshopId) =>
        modsToUse.some((modToUse) => modToUse.workshopId == workshopId)
      )
    );
    if (filteredSet.size != modsToMerge.size) setModsToMerge(filteredSet);
  }

  const isPackProcessingDone = true; //!!packCollisions.packFileCollisions;

  const onModToggled = useCallback(
    (mod: Mod) => {
      if (modsToMerge.has(mod.workshopId)) {
        modsToMerge.delete(mod.workshopId);
      } else {
        modsToMerge.add(mod.workshopId);
      }
      setModsToMerge(new Set<string>(modsToMerge));
    },
    [modsToMerge]
  );

  const modsWithoutDependencies = useCallback(
    (mods: Mod[]) => {
      return mods.filter(
        (mod) =>
          (!mod.dependencyPacks || mod.dependencyPacks.length < 1) &&
          !allDependencyPacks.some((packName) => packName == mod.name)
      );
    },
    [mods]
  );

  const onSelectNumModsChange = useCallback(
    (newValue: SingleValue<NumModsOptionType>, actionMeta: ActionMeta<NumModsOptionType>) => {
      if (!newValue) return;
      console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
      if (actionMeta.action === "select-option") {
        setModsToMerge(
          new Set<string>(
            modsWithoutDependencies(modsToUse)
              .slice(0, newValue.value)
              .map((mod) => mod.workshopId)
          )
        );
      }
    },
    [modsToUse]
  );
  const onSelectExistingMergerChange = useCallback(
    (newValue: SingleValue<ExistingMergerOptionType>, actionMeta: ActionMeta<ExistingMergerOptionType>) => {
      if (!newValue) return;
      console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
      if (actionMeta.action === "select-option") {
        const mergerMod = mergerMods.find((mergerMod) => mergerMod.name == newValue.value);
        if (!mergerMod || !mergerMod.mergedModsData) return;
        const mergedData = mergerMod.mergedModsData;
        setModsToMerge(
          new Set<string>(
            modsWithoutDependencies(modsToUse)
              .filter((mod) => mergedData.some((mergedModData) => mergedModData.name == mod.name))
              .map((mod) => mod.workshopId)
          )
        );
      }
    },
    [mergerMods]
  );

  const options: NumModsOptionType[] = useMemo(
    () =>
      [5, 10, 15, 20, 25, 30, 35, 40, 50, 75, 100, 0].map((num) => {
        return { value: num, label: num };
      }),
    []
  );

  const mergerOptions = useMemo<ExistingMergerOptionType[]>(
    () =>
      mergerMods.map((mod) => {
        return { value: mod.name, label: mod.name };
      }),
    [mergerMods]
  );

  const mergeMods = useCallback(() => {
    if (modsToMerge.size < 1) return;
    const modsToMergeArray = Array.from(modsToMerge);
    window.api?.mergeMods(
      mods.filter((mod) => modsToMergeArray.some((modToMergeId) => modToMergeId == mod.workshopId))
    );
    setIsOpen(false);
  }, [modsToMerge]);

  const toggleMergeSorting = useCallback(() => {
    if (modsMergeSort == "Merge") setModsMergeSort("MergeDesc");
    else setModsMergeSort("Merge");
  }, [modsMergeSort]);
  const toggleNameSorting = useCallback(() => {
    if (modsMergeSort == "Name") setModsMergeSort("NameDesc");
    else setModsMergeSort("Name");
  }, [modsMergeSort]);
  const toggleSizeSorting = useCallback(() => {
    if (modsMergeSort == "Size") setModsMergeSort("SizeDesc");
    else setModsMergeSort("Size");
  }, [modsMergeSort]);
  const togglePackSorting = useCallback(() => {
    if (modsMergeSort == "Pack") setModsMergeSort("PackDesc");
    else setModsMergeSort("Pack");
  }, [modsMergeSort]);

  const onMergeRightClick = useCallback(() => {
    setModsToMerge(new Set<string>());
  }, [modsMergeSort]);

  const [modFilter, setModFilter] = useState("");
  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setModFilter(e.target.value);
  };

  const clearFilter = () => {
    setModFilter("");
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        const modMergingFilter = document.getElementById("modMergingFilter");
        modMergingFilter?.focus();
        // e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  return (
    <div>
      <div className="text-center mt-4">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
        >
          Merge Mods
        </button>
      </div>

      {isOpen && (
        <Modal
          show={isOpen}
          // show={true}
          onClose={() => setIsOpen(false)}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "!max-w-7xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
          ]}
        >
          <Modal.Header>
            <span>Merge Mods{modsToMerge.size > 0 && ` - ${modsToMerge.size} selected`}</span>
          </Modal.Header>
          <Modal.Body>
            <Tabs.Group style="underline">
              <Tabs.Item active={true} title="Merge">
                <span className="absolute top-[6rem] right-0 flex items-center leading-relaxed dark:text-gray-300">
                  {mergerMods.length > 0 && (
                    <>
                      <span className="make-tooltip-inline">
                        <Tooltip
                          style={"light"}
                          content={<p>Load mods that are in an existing merged mod.</p>}
                        >
                          <span className="text-center w-full">Load existing:</span>
                        </Tooltip>
                      </span>
                      <Select
                        options={mergerOptions}
                        styles={selectStyle}
                        onChange={onSelectExistingMergerChange}
                        value={null}
                        className="mx-2"
                      ></Select>
                    </>
                  )}

                  <span className="border-l-2 px-2 border-gray-600">
                    <input
                      type="checkbox"
                      id="merge-hide-already-merged"
                      checked={isHidingAlreadyMergedMods}
                      onChange={() => {
                        setIsHidingAlreadyMergedMods(!isHidingAlreadyMergedMods);
                      }}
                    ></input>
                    <label className="ml-2" htmlFor="merge-hide-already-merged">
                      <span className="make-tooltip-inline">
                        <Tooltip
                          style={"light"}
                          content={<p>Don't show a mod if it's inside an enabled merged pack.</p>}
                        >
                          <span className="text-center w-full">Hide Already Merged</span>
                        </Tooltip>
                      </span>
                    </label>
                  </span>

                  <span className="border-x-2 px-2 border-gray-600">
                    <input
                      type="checkbox"
                      id="merge-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => {
                        if (!useEnabledModsOnly) setModsToMerge(new Set<string>());
                        setUseEnabledModsOnly(!useEnabledModsOnly);
                      }}
                    ></input>
                    <label className="ml-2" htmlFor="merge-enabled-mod-only">
                      Enabled Mods Only
                    </label>
                  </span>
                  <span className="ml-2">Select first</span>
                  <Select
                    options={options}
                    styles={selectStyle}
                    onChange={onSelectNumModsChange}
                    value={null}
                    className="mx-2"
                  ></Select>
                  <span>mods to merge</span>
                  <button
                    id="playGame"
                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded h-12 w-20 ml-6 mr-10"
                    onClick={() => mergeMods()}
                  >
                    Merge
                  </button>
                </span>

                <div className="flex items-center">
                  <span className="text-slate-100">Filter:</span>
                  <span className="relative">
                    <input
                      id="modMergingFilter"
                      type="text"
                      onChange={(e) => onFilterChange(e)}
                      value={modFilter}
                      className="ml-2 block bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                    ></input>

                    <span className="absolute right-[0.3rem] top-[0.6rem] text-gray-400">
                      <button onClick={() => clearFilter()}>
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </span>
                  </span>
                </div>

                <div className="mt-5 leading-relaxed dark:text-gray-300 relative gap-2">
                  <div className="grid grid-cols-9">
                    <div
                      onContextMenu={() => onMergeRightClick()}
                      className={
                        "col-span-1 justify-center flex " +
                        (((modsMergeSort == "Merge" || modsMergeSort == "MergeDesc") && "font-bold") || "")
                      }
                      onClick={() => toggleMergeSorting()}
                    >
                      Merge
                    </div>
                    <div
                      className={
                        "col-span-3 " +
                        (((modsMergeSort == "Pack" || modsMergeSort == "PackDesc") && "font-bold") || "")
                      }
                      onClick={() => togglePackSorting()}
                    >
                      Pack
                    </div>
                    <div
                      className={
                        "col-span-3 " +
                        (((modsMergeSort == "Name" || modsMergeSort == "NameDesc") && "font-bold") || "")
                      }
                      onClick={() => toggleNameSorting()}
                    >
                      Name
                    </div>
                    <div
                      className={
                        "col-span-2 " +
                        (((modsMergeSort == "Size" || modsMergeSort == "SizeDesc") && "font-bold") || "")
                      }
                      onClick={() => toggleSizeSorting()}
                    >
                      Size
                    </div>
                  </div>
                  {getFilteredMods(modsToUse, modFilter, true).map((mod) => (
                    <React.Fragment key={mod.path}>
                      <div className="grid grid-cols-9 items-center border-b gap-2 py-2 border-gray-600">
                        {(((mod.dependencyPacks && mod.dependencyPacks.length > 0) ||
                          allDependencyPacks.some((packName) => packName == mod.name)) && (
                          <span className="make-tooltip-inline">
                            <Tooltip
                              style={"light"}
                              content={
                                <p>
                                  Mod cannot be merged since it has a pack-level dependency with another mod.
                                </p>
                              }
                            >
                              <div className="col-span-1 justify-center flex">
                                <input
                                  type="checkbox"
                                  checked={modsToMerge.has(mod.workshopId) || false}
                                  onChange={() => onModToggled(mod)}
                                  id={mod.name + "_merge_checkbox"}
                                  name={mod.name}
                                  disabled={true}
                                />
                              </div>
                            </Tooltip>
                          </span>
                        )) || (
                          <div className="col-span-1 justify-center flex">
                            <input
                              type="checkbox"
                              checked={modsToMerge.has(mod.workshopId) || false}
                              onChange={() => onModToggled(mod)}
                              id={mod.name + "_merge_checkbox"}
                              name={mod.name}
                            />
                          </div>
                        )}

                        <div className="col-span-3">
                          <label htmlFor={mod.name + "_merge_checkbox"}>
                            {(((mod.dependencyPacks && mod.dependencyPacks.length > 0) ||
                              allDependencyPacks.some((packName) => packName == mod.name)) && (
                              <Tooltip
                                style={"light"}
                                content={
                                  <p>
                                    Mod cannot be merged since it has a pack-level dependency with another
                                    mod.
                                  </p>
                                }
                              >
                                <div className="line-through">{`${mod.name}`}</div>
                              </Tooltip>
                            )) || <div>{`${mod.name}`}</div>}
                          </label>
                        </div>
                        <div className="col-span-3">
                          <label htmlFor={mod.name + "_merge_checkbox"}>
                            {(((mod.dependencyPacks && mod.dependencyPacks.length > 0) ||
                              allDependencyPacks.some((packName) => packName == mod.name)) && (
                              <Tooltip
                                style={"light"}
                                content={
                                  <p>
                                    Mod cannot be merged since it has a pack-level dependency with another
                                    mod.
                                  </p>
                                }
                              >
                                <div className="line-through">{`${mod.humanName}`}</div>
                              </Tooltip>
                            )) || <div>{`${mod.humanName}`}</div>}
                          </label>
                        </div>
                        <div className="col-span-2">
                          <label htmlFor={mod.name + "_merge_checkbox"}>{mod.size}</label>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </Tabs.Item>
              <Tabs.Item title="Help">
                <div className="leading-relaxed dark:text-gray-300 relative font-normal">
                  <p>
                    This panel allows you to merge mods to get around the mod limit. It merges selected mods
                    into a new mod .pack and puts it inside the WH3/data folder. Merged mods also have an
                    accompanying .json file with the same name, if you rename or move the merged mod also
                    rename or move the json file. Mods are pre-sorted by size for quicker merging.
                  </p>
                  <p className="mt-6">
                    The merged mod won't have the same file names as the merged mods which can affect load
                    order priority, so skip merging mods that require manual load order fiddling. That said,
                    those kind of mods should be incredibly rare and as a rule you should never manually touch
                    load order anyway!
                  </p>
                  <p className="mt-6">
                    When mods get updated the merged pack will have the old outdated mod inside it. You should
                    get a warning in red (it'll be above the Play button) warning you about this and you can
                    then right click the merged pack and use the Update (Re-merge) option which will update
                    the merged pack. The warning can appear when you start the app but disappears once we get
                    newer info from the workshop, you don't have to update it in that case.
                  </p>
                  <p className="mt-6">
                    You can leave the mods that have been merged enabled in the mod manager, the manager will
                    automatically skip them if they're already present in a merged mod you have enabled. This
                    is reliant on the .json file, if it's missing you'll have to disable those mods or the
                    game will crash since it doesn't like duplicate files in mods.
                  </p>
                </div>
              </Tabs.Item>
            </Tabs.Group>
          </Modal.Body>
        </Modal>
      )}

      <Modal
        onClose={() => setIsSpinnerClosed(true)}
        show={!isSpinnerClosed && isOpen && !isPackProcessingDone}
        size="2xl"
        position="center"
      >
        <Modal.Header>Reading And Comparing Packs...</Modal.Header>
        <Modal.Body>
          <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
            Wait until all the mod packs have been read and compared with each other...
          </p>
          <div className="text-center mt-8">
            <Spinner color="purple" size="xl" />
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
});

export default ModsMerger;
