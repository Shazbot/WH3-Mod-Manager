import React, { useCallback, useEffect, useMemo } from "react";
import { getModsSortedByName, getModsSortedByHumanName, getModsSortedBySize } from "../modSortingHelpers";
import { ActionMeta, SingleValue } from "react-select";
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import { useAppDispatch, useAppSelector } from "../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";
import { getDBNameFromString, getDBSubnameFromString } from "../utility/packFileHelpers";
import { selectDBTable } from "../appSlice";

type ModsMergeSorts = "Merge" | "MergeDesc" | "Pack" | "PackDesc" | "Name" | "NameDesc" | "Size" | "SizeDesc";
type NumModsOptionType = {
  value: string;
  label: string;
};
type ExistingMergerOptionType = {
  value: string;
  label: string;
};

type PackTablesTreeViewProps = {
  tableFilter: string;
};

const PackTablesTreeView = React.memo((props: PackTablesTreeViewProps) => {
  const dispatch = useAppDispatch();
  const isDev = useAppSelector((state) => state.app.isDev);
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);

  const packsData = useAppSelector((state) => state.app.packsData);

  const packPath = currentDBTableSelection?.packPath ?? "data.pack";
  const packData = packsData[packPath];
  // const packData = currentPackData.data;
  if (!packData) {
    return <></>;
  }

  // console.log("packsData:");
  // console.log(packData);

  type TreeData = { name: string; children?: TreeData[] };
  const result = packData.tables.reduce(
    (map, packFileName) => {
      const dbName = getDBNameFromString(packFileName);
      const dbSubname = getDBSubnameFromString(packFileName);

      if (dbName && dbSubname) {
        if (typeof map.children === "undefined") {
          map.children = [];
        }
        map.children = map.children || [];
        map.children.push({ name: dbName, children: [{ name: dbSubname, children: [] }] });
      }
      return map;
    },
    { name: "", children: [] } as TreeData
  );

  // console.log(result);
  const data = flattenTree(result);

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

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    // console.log("ON TREE SELECT");
    // console.log(props);
    if (
      props.isSelected &&
      props.element.parent &&
      props.element.children &&
      props.element.children.length < 1
    ) {
      const parentLeaf = data.find((leaf) => leaf.id == props.element.parent);
      if (parentLeaf) {
        const packPath = packData.packPath;
        const dbName = parentLeaf.name;
        const dbSubname = props.element.name;
        console.log(`SENT GET PACK DATA ${packPath + " " + dbName + " " + dbSubname}}`);
        window.api?.getPackData(packPath, { dbName, dbSubname });
        dispatch(
          selectDBTable({
            packPath: packData.packPath,
            dbName: parentLeaf.name,
            dbSubname: props.element.name,
          })
        );
      }
    }
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

  const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className: string }) => {
    const baseClass = "arrow";
    const classes = cx(
      baseClass,
      { [`${baseClass}--closed`]: !isOpen },
      { [`${baseClass}--open`]: isOpen },
      { [`rotate-90`]: isOpen },
      className,
      "w-4",
      "h-4"
    );
    return (
      <span className="w-4 h-4">
        <IoMdArrowDropright size={"100%"} className={classes} />
      </span>
    );
  };

  const areNodeChildrenShown = (element: INode): boolean => {
    const elementData = data.find((node) => node.id == element.id);
    if (!elementData) return true;
    if (elementData.children.length == 0) return false;

    const childNodes = elementData.children
      .map((childId) => data.find((node) => node.id == childId))
      .filter((id) => id != null);

    const res = childNodes.reduce((isShown, currentNode) => {
      if (!currentNode) return isShown;
      return isShown || currentNode.name.includes(props.tableFilter) || areNodeChildrenShown(currentNode);
    }, false);

    return res;
  };

  const isAnyNodeParentShown = (element: INode): boolean => {
    const elementData = data.find((node) => node.id == element.id);
    if (!elementData) return true;
    if (elementData.parent == null) return false;

    let isParentFiltered = false;
    const parentNode = data.find((node) => node.id == element.parent);
    if (parentNode)
      isParentFiltered = parentNode.name.includes(props.tableFilter) || isAnyNodeParentShown(parentNode);

    return isParentFiltered;
  };

  const isTreeNodeFiltered = (element: INode): boolean => {
    if (props.tableFilter == "") return false;

    return !(
      element.name.includes(props.tableFilter) ||
      areNodeChildrenShown(element) ||
      isAnyNodeParentShown(element)
    );
  };

  return (
    <div>
      <TreeView
        data={data}
        aria-label="Controlled expanded node tree"
        onSelect={(props) => onTreeSelect(props)}
        nodeRenderer={({
          element,
          isBranch,
          isExpanded,
          isDisabled,
          getNodeProps,
          level,
          handleExpand,
          handleSelect,
        }) => {
          return (
            <div
              {...getNodeProps({ onClick: handleExpand })}
              style={{
                marginLeft: 40 * (level - 1),
                opacity: isDisabled ? 0.5 : 1,
              }}
              className={
                "flex items-center [&:not(:first-child)]:mt-2 hover:overflow-visible cursor-default " +
                (isTreeNodeFiltered(element) ? "hidden" : "")
              }
            >
              {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
              <span onClick={(e) => handleSelect(e)} className="relative">
                {/* <span onClick={(e) => handleSelect(e)} className="absolute">
                  {element.name}
                </span> */}
                {element.name}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
});

export default PackTablesTreeView;
