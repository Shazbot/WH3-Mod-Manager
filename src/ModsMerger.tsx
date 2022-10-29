import React, { useCallback, useMemo } from "react";
import { Modal } from "./flowbite/components/Modal/index";
import { Spinner, Tabs, Tooltip } from "./flowbite";
import { getModsSortedByName, getModsSortedByHumanName, getModsSortedBySize } from "./modSortingHelpers";
import Select, { ActionMeta, SingleValue } from "react-select";
import selectStyle from "./styles/selectStyle";
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";

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
  const modsNotInDataSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods) => mods.filter((mod) => !mod.isInData)
  );
  const mods = useSelector(modsNotInDataSelector);

  const mergerModsSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods) => mods.filter((mod) => mod.mergedModsData)
  );
  const mergerMods = useSelector(mergerModsSelector);

  const [useEnabledModsOnly, setUseEnabledModsOnly] = React.useState(true);
  const [isHidingAlreadyMergedMods, setIsHidingAlreadyMergedMods] = React.useState(true);
  const [isOpen, setIsOpen] = React.useState(false);
  const [modsToMerge, setModsToMerge] = React.useState<Set<Mod>>(new Set<Mod>());
  const [isSpinnerClosed, setIsSpinnerClosed] = React.useState(false);
  const [modsMergeSort, setModsMergeSort] = React.useState("Size" as ModsMergeSorts);

  let modsToUse = useMemo(() => [...mods], [mods]);

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
        if (modsToMerge.has(firstMod) && modsToMerge.has(secondMod)) return 0;
        if (modsToMerge.has(firstMod)) return -1;
        if (modsToMerge.has(secondMod)) return 1;
        return 0;
      });
      break;
    case "MergeDesc":
      modsToUse = modsToUse.sort((firstMod, secondMod) => {
        if (modsToMerge.has(firstMod) && modsToMerge.has(secondMod)) return 0;
        if (modsToMerge.has(firstMod)) return 1;
        if (modsToMerge.has(secondMod)) return -1;
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

  const isPackProcessingDone = true; //!!packCollisions.packFileCollisions;

  const onModToggled = useCallback(
    (mod: Mod) => {
      if (modsToMerge.has(mod)) {
        modsToMerge.delete(mod);
      } else {
        modsToMerge.add(mod);
      }
      setModsToMerge(new Set<Mod>(modsToMerge));
    },
    [modsToMerge]
  );

  const onSelectNumModsChange = useCallback(
    (newValue: SingleValue<NumModsOptionType>, actionMeta: ActionMeta<NumModsOptionType>) => {
      if (!newValue) return;
      console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
      if (actionMeta.action === "select-option") {
        setModsToMerge(new Set<Mod>(modsToUse.slice(0, newValue.value)));
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
          new Set<Mod>(
            modsToUse.filter((mod) => mergedData.some((mergedModData) => mergedModData.name == mod.name))
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
    window.api?.mergeMods(Array.from(modsToMerge));
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
    setModsToMerge(new Set<Mod>());
  }, [modsMergeSort]);

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
        <Modal.Header>Merge Mods{modsToMerge.size > 0 && ` - ${modsToMerge.size} selected`}</Modal.Header>
        <Modal.Body>
          <Tabs.Group style="underline">
            <Tabs.Item active={true} title="Merge">
              <span className="absolute top-[6rem] right-0 flex items-center leading-relaxed dark:text-gray-300">
                {mergerMods.length > 0 && (
                  <>
                    <span className="make-tooltip-inline">
                      <Tooltip style={"light"} content={<p>Load mods that are in an existing merged mod.</p>}>
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
                      if (!useEnabledModsOnly) setModsToMerge(new Set<Mod>());
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
              <div className="leading-relaxed dark:text-gray-300 relative gap-2 ">
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
                {modsToUse.map((mod) => (
                  <React.Fragment key={mod.path}>
                    <div className="grid grid-cols-9 items-center border-b gap-2 py-2 border-gray-600">
                      <div className="col-span-1 justify-center flex">
                        <input
                          type="checkbox"
                          checked={modsToMerge.has(mod) || false}
                          onChange={() => onModToggled(mod)}
                          id={mod.name + "_merge_checkbox"}
                          name={mod.name}
                        />
                      </div>
                      <div className="col-span-3">
                        <label htmlFor={mod.name + "_merge_checkbox"}>
                          <div>{`${mod.name}`}</div>
                        </label>
                      </div>
                      <div className="col-span-3">
                        <label htmlFor={mod.name + "_merge_checkbox"}>
                          <div>{`${mod.humanName}`}</div>
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
                  into a new mod .pack and puts it inside a data/merged folder. Mods are pre-sorted by size
                  for quicker merging.
                </p>
                <p className="mt-6">
                  The merged mod won't have the same file names as the merged mods which can affect load order
                  priority, so skip merging mods that require manual load order fiddling. That said, those
                  kind of mods should be incredibly rare and as a rule you should never manually touch load
                  order anyway!
                </p>
                <p className="mt-6">
                  When mods get updated the merged pack will have the old outdated mod inside it. You should
                  get a warning in red (it'll be above the Play button) warning you about this and you can
                  then right click the merged pack and use the Update (Re-merge) option which will update the
                  merged pack.
                </p>
                <p className="mt-6">
                  You can leave the mods that have been merged enabled in the mod manager, the manager will
                  automatically skip them if they're already present in a merged mod you have enabled.
                </p>
              </div>
            </Tabs.Item>
          </Tabs.Group>
        </Modal.Body>
      </Modal>
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
