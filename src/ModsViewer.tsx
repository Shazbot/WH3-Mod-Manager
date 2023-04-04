import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "./flowbite/components/Modal/index";
import { Spinner } from "./flowbite";
import { getModsSortedByName, getModsSortedByHumanName, getModsSortedBySize } from "./modSortingHelpers";
import { ActionMeta, SingleValue } from "react-select";
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import { useAppSelector } from "./hooks";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import PackTablesTreeView from "./components/PackTablesTreeView";
import PackTablesTableView from "./components/PackTablesTableView";

type ModsMergeSorts = "Merge" | "MergeDesc" | "Pack" | "PackDesc" | "Name" | "NameDesc" | "Size" | "SizeDesc";
type NumModsOptionType = {
  value: string;
  label: string;
};
type ExistingMergerOptionType = {
  value: string;
  label: string;
};

const ModsViewer = React.memo(() => {
  const isDev = useAppSelector((state) => state.app.isDev);
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);

  const packsData = useAppSelector((state) => state.app.packsData);

  const packPath = currentDBTableSelection?.packPath ?? "data.pack";

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

  const mergerModsSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods) => mods.filter((mod) => mod.mergedModsData && mod.isEnabled)
  );
  const mergerMods = useSelector(mergerModsSelector);

  const [useEnabledModsOnly, setUseEnabledModsOnly] = React.useState(true);
  const [isHidingAlreadyMergedMods, setIsHidingAlreadyMergedMods] = React.useState(true);
  const [isOpen, setIsOpen] = React.useState(true);
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
        // setModsToMerge(
        //   new Set<string>(
        //     modsWithoutDependencies(modsToUse)
        //       .slice(0, newValue.value)
        //       .map((mod) => mod.workshopId)
        //   )
        // );
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
      mods.map((mod) => {
        return { value: mod.path, label: mod.name + ((mod.humanName != "" && mod.humanName) || "") };
      }),
    [mods]
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

  // only runs when mounted first time
  useEffect(() => {
    if (!currentDBTableSelection) {
      // window.api?.getPackData(packPath, { dbName: "main_units_tables", dbSubname: "data__" });
      // dispatch(
      //   selectDBTable({
      //     packPath: `\\\\${packPath}`,
      //     dbName: "main_units_tables",
      //     dbSubname: "data__",
      //   })
      // );
    }
  }, []);

  if (!packsData[packPath]) {
    // if (!currentPackData.data) {
    return <></>;
  }

  // console.log(`currentPackData.data is ${currentPackData.data}`);

  return (
    <div>
      {isOpen && (
        <>
          <div className="grid grid-cols-10 dark:text-gray-300">
            <div className="col-span-2 overflow-scroll h-[80vh]">
              <PackTablesTreeView tableFilter={modFilter} />
            </div>
            <div className="col-span-8">
              <PackTablesTableView />
            </div>
          </div>

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
        </>
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

export default ModsViewer;
