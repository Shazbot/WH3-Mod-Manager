import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getModsSortedByName, getModsSortedByHumanName, getModsSortedBySize } from "../modSortingHelpers";
import { ActionMeta, SingleValue } from "react-select";
import { createSelector } from "@reduxjs/toolkit";
import { useSelector } from "react-redux";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Column, Row } from "@silevis/reactgrid";
import "@silevis/reactgrid/styles.css";
import { getPackNameFromPath } from "../utility/packFileHelpers";
import { AmendedSchemaField, SCHEMA_FIELD_TYPE } from "../packFileTypes";

import "handsontable/dist/handsontable.full.min.css";

import { HotTable } from "@handsontable/react";

import { registerAllModules } from "handsontable/registry";

type ModsMergeSorts = "Merge" | "MergeDesc" | "Pack" | "PackDesc" | "Name" | "NameDesc" | "Size" | "SizeDesc";
type NumModsOptionType = {
  value: string;
  label: string;
};
type ExistingMergerOptionType = {
  value: string;
  label: string;
};

const PackTablesTableView = React.memo(() => {
  const isDev = useAppSelector((state) => state.app.isDev);
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);

  // console.log("packsData:");
  // console.log(packData);

  const modsNotInDataSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods) => mods.filter((mod) => isDev || !mod.isInData)
  );
  const mods = useSelector(modsNotInDataSelector);

  const hotRef = useRef<HotTable>(null);

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

  useEffect(() => {
    if (!hotRef || !hotRef.current) return;
    const hot = hotRef.current.hotInstance;
    if (!hot) return;
    const plugin = hot.getPlugin("autoColumnSize");

    // console.log("WIDHT IS", plugin.getColumnWidth(4));

    if (plugin.isEnabled()) {
      // code...
    }
  });

  // registerPlugin(AutoColumnSize);
  // registerPlugin(DropdownMenu);
  // registerPlugin(HiddenRows);
  // registerCellType(CheckboxCellType);
  // registerPlugin(Filters);
  registerAllModules();

  console.log(currentDBTableSelection);
  if (!currentDBTableSelection) {
    return <></>;
  }

  const packName = getPackNameFromPath(currentDBTableSelection.packPath);
  const packPath = currentDBTableSelection.packPath;
  console.log("packPath for table view is ", packName);

  // console.log("BASENAME", packName);
  if (!packsData) {
    return <></>;
  }

  const packData = packsData[packPath];
  if (!packData) {
    return <></>;
  }

  const packFile = packData.currentTable;
  const currentSchema = packData.currentTableSchema;

  // console.log("PACKFILE IS ", packFile);
  // console.log("CURRENT SCHEMA IS ", currentSchema);

  if (!packFile || !currentSchema) {
    return <></>;
  }

  const getColumns = (): Column[] =>
    Array.from(currentSchema.fields.keys()).map((i) => {
      return {
        columnId: i,
      };
    });

  const headerRow: Row = {
    rowId: "header",
    cells: currentSchema.fields.map((field) => {
      {
        return { type: "header", text: field.name };
      }
    }),
  };

  const chunkedTable =
    (packFile.schemaFields &&
      packFile.schemaFields.reduce<AmendedSchemaField[][]>((resultArray, item, index) => {
        const chunkIndex = Math.floor(index / currentSchema.fields.length);

        if (!resultArray[chunkIndex]) {
          resultArray[chunkIndex] = []; // start a new chunk
        }

        resultArray[chunkIndex].push(item as AmendedSchemaField);

        return resultArray;
      }, [])) ||
    [];

  const rows = [
    headerRow,
    ...chunkedTable.map<Row>((fieldsRow, idx) => ({
      rowId: idx,
      cells: fieldsRow.map((field) => ({
        type: "text",
        text: field.resolvedKeyValue,
      })),
    })),
  ];

  const data = chunkedTable.map((row) =>
    row.map((cell) => {
      if (cell.type == "Boolean") {
        return cell.resolvedKeyValue != "0";
      }
      if (cell.type == "OptionalStringU8" && cell.resolvedKeyValue == "0") {
        return "";
      }
      return cell.resolvedKeyValue;
    })
  );

  // const columns = getColumns();

  // const columns = currentSchema.fields.map((field) => ({ data: field.name }));
  const columnHeaders = currentSchema.fields.map((field) => field.name.replaceAll("_", " "));

  const fieldTypeToCellType = (fieldType: SCHEMA_FIELD_TYPE) => {
    switch (fieldType) {
      case "I64":
      case "F32":
      case "I32":
      case "F64":
        return "numeric";
      case "Boolean":
        return "checkbox";
      default:
        return "text";
    }
  };

  const columns = currentSchema.fields.map((field) => ({ type: fieldTypeToCellType(field.field_type) }));
  // const hotColumns = columns.map((column) => <HotColumn title={column} />);

  // console.log("COLUMNS:", columns);

  return (
    <div>
      <HotTable
        ref={hotRef}
        filters={true}
        autoColumnSize={{ useHeaders: false }}
        // beforeStretchingColumnWidth={(w, c) => {
        //   console.log(w, c);
        //   return 10;
        // }}
        data={data}
        rowHeaders={true}
        columns={columns}
        manualColumnResize={true}
        columnSorting={true}
        manualColumnFreeze={true}
        stretchH="all"
        contextMenu={true}
        viewportColumnRenderingOffset={50}
        // dropdownMenu={["filter_by_condition", "filter_action_bar"]}
        dropdownMenu={[
          "filter_by_condition",
          "filter_by_condition2",
          "filter_operators",
          "filter_by_value",
          "filter_action_bar",
        ]}
        // dropdownMenu={true}
        width="100%"
        height="90vh"
        colHeaders={columnHeaders}
        licenseKey="non-commercial-and-evaluation" // for non-commercial use only
        // columns={columns}
      >
        {/* {...hotColumns} */}
      </HotTable>
    </div>
  );
});

export default PackTablesTableView;
