import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Modal } from "../flowbite/components/Modal/index";
import { Spinner, Tabs } from "../flowbite";
import { useAppDispatch, useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";
import { getPackNameFromPath } from "../utility/packFileHelpers";
import { selectDBTable, setModBeingCustomized } from "../appSlice";
import getPackTableData, { getLocsTree } from "../utility/packDataHandling";
import ModCustomizationRows from "./ModCustomizationRows";

export type ModCustomizationSorts =
  | "UnitKeyTableOrder"
  | "UnitKey"
  | "UnitKeyDesc"
  | "UnitOwner"
  | "UnitOwnerDesc"
  | "Enabled"
  | "EnabledDesc";

export interface ModCustomizationProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  modPath: string | undefined;
}

const ModCustomization = React.memo(() => {
  const dispatch = useAppDispatch();
  const packDataOverwrites = useAppSelector((state) => state.app.packDataOverwrites);
  const modBeingCustomized = useAppSelector((state) => state.app.modBeingCustomized);
  const modPath = modBeingCustomized && modBeingCustomized.path;
  const isOpen = !!modBeingCustomized;

  console.log("MODPATH is", modPath);

  const localized: Record<string, string> = useContext(localizationContext);

  // console.log("allDependencyPacks", allDependencyPacks);

  const closePanel = useCallback(() => {
    dispatch(setModBeingCustomized(undefined));
  }, []);

  const [isSpinnerClosed, setIsSpinnerClosed] = React.useState(false);
  const [modsMergeSort, setModsMergeSort] = React.useState<ModCustomizationSorts>("UnitKey");

  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const packsData = useAppSelector((state) => state.app.packsData);

  // console.log("packsData:");
  // console.log(packData);

  const isPackProcessingDone = true; //!!packCollisions.packFileCollisions;

  console.log("packDataOverwrites:", packDataOverwrites);

  const toggleUnitKeySorting = useCallback(() => {
    if (modsMergeSort == "UnitKey") setModsMergeSort("UnitKeyDesc");
    else if (modsMergeSort == "UnitKeyDesc") setModsMergeSort("UnitKeyTableOrder");
    else if (modsMergeSort == "UnitKeyTableOrder") setModsMergeSort("UnitKey");
    else setModsMergeSort("UnitKey");
  }, [modsMergeSort]);
  const toggleNameSorting = useCallback(() => {
    if (modsMergeSort == "UnitOwner") setModsMergeSort("UnitOwnerDesc");
    else setModsMergeSort("UnitOwner");
  }, [modsMergeSort]);
  const toggleEnabledSorting = useCallback(() => {
    if (modsMergeSort == "EnabledDesc") setModsMergeSort("Enabled");
    else setModsMergeSort("EnabledDesc");
  }, [modsMergeSort]);

  const stringOrUnderdash = useCallback((text: string | boolean) => {
    return (text == "" && "_") || `${text}`;
  }, []);

  const [modFilter, setModFilter] = useState("");
  const onFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setModFilter(e.target.value);
  };

  const clearFilter = () => {
    setModFilter("");
  };

  const sanitizedModFilter = useMemo(() => {
    return modFilter.trim().toLowerCase();
  }, [modFilter]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

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
    if (modPath && (!currentDBTableSelection || currentDBTableSelection.packPath != modPath)) {
      console.log("getPackData in UnitPermissions for", modPath);

      // window.api?.getPackDataWithLocs(
      //   //"K:\\SteamLibrary\\steamapps\\workshop\\content\\1142710\\2927296206\\!ak_teb3.pack"
      //   modPath,
      //   { dbName: "units_to_exclusive_faction_permissions_tables", dbSubname: "" }
      // );
      // dispatch(
      //   selectDBTable({
      //     packPath: modPath,
      //     dbName: "units_to_exclusive_faction_permissions_tables",
      //     dbSubname: "",
      //   })
      // );

      window.api?.getPackDataWithLocs(modPath, {
        dbName: "units_to_groupings_military_permissions_tables",
        dbSubname: "",
      });
      dispatch(
        selectDBTable({
          packPath: modPath,
          dbName: "units_to_groupings_military_permissions_tables",
          dbSubname: "",
        })
      );

      window.api?.getPackDataWithLocs(modPath, {
        dbName: "building_culture_variants_tables",
        dbSubname: "",
      });
      dispatch(
        selectDBTable({
          packPath: modPath,
          dbName: "building_culture_variants_tables",
          dbSubname: "",
        })
      );

      window.api?.getPackDataWithLocs(modPath, {
        dbName: "faction_agent_permitted_subtypes_tables",
        dbSubname: "",
      });
      dispatch(
        selectDBTable({
          packPath: modPath,
          dbName: "faction_agent_permitted_subtypes_tables",
          dbSubname: "",
        })
      );

      window.api?.getPackDataWithLocs(modPath, {
        dbName: "campaign_group_unique_agents_tables",
        dbSubname: "",
      });
      dispatch(
        selectDBTable({
          packPath: modPath,
          dbName: "campaign_group_unique_agents_tables",
          dbSubname: "",
        })
      );
    }
  });

  if (!modPath) return <></>;
  console.log("currentDBTableSelection", currentDBTableSelection);

  if (!currentDBTableSelection) return <></>;
  const packName = getPackNameFromPath(currentDBTableSelection.packPath);
  const packPath = currentDBTableSelection.packPath;
  console.log("packPath for table view is ", packName);

  const currentPackDataOverwrites = packDataOverwrites[packPath] ?? [];

  // console.log("BASENAME", packName);
  if (!packsData) {
    console.log("NO packsData");
    return <></>;
  }

  console.log(packsData);
  const packData = packsData[packPath];
  // console.log(packData);
  if (!packData) {
    return <></>;
  }

  const factionData = undefined; //getPackTableData("db\\units_to_exclusive_faction_permissions_tables\\", packData);
  const groupingsData = getPackTableData("db\\units_to_groupings_military_permissions_tables\\", packData);
  const buildingsData = getPackTableData(
    "db\\building_culture_variants_tables\\",
    packData,
    (row) => (row[6] as boolean) == false // filter out the disabled buildings
  );
  const agentsData = getPackTableData("db\\faction_agent_permitted_subtypes_tables\\", packData);
  const uniqueAgentsData = getPackTableData("db\\campaign_group_unique_agents_tables\\", packData);
  if (!factionData && !groupingsData && !buildingsData && !agentsData && !uniqueAgentsData) return <></>;

  const locTree = getLocsTree(packData);
  // console.log("locTree IS", locTree);
  // console.log("PACK DATA IS", packData);
  // console.log("data is", factionData, groupingsData);
  // console.log("building data is", buildingsData);

  return (
    <div>
      {isOpen && (
        <Modal
          show={isOpen}
          // show={true}
          onClose={() => {
            closePanel();
          }}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "!max-w-7xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
          ]}
        >
          <Modal.Header>
            <span>{localized.customizeMod}</span>
          </Modal.Header>
          <Modal.Body>
            <Tabs.Group style="underline">
              {groupingsData != undefined && (
                <Tabs.Item active={true} title={localized.groupingsUnitPermissions}>
                  <ModCustomizationRows
                    locTree={locTree}
                    tablesData={groupingsData}
                    packPath={packPath}
                    currentPackDataOverwrites={currentPackDataOverwrites}
                    modFilter={sanitizedModFilter}
                    onFilterChange={onFilterChange}
                    clearFilter={clearFilter}
                    modsMergeSort={modsMergeSort}
                    toggleUnitKeySorting={toggleUnitKeySorting}
                    toggleNameSorting={toggleNameSorting}
                    toggleEnabledSorting={toggleEnabledSorting}
                    getRowKey={(rowData: PlainPackFileDataRow) => {
                      return `${rowData[0]}_${rowData[1]}`;
                    }}
                    columnIndices={[0, 1]}
                    getAllowedForRow={() => true}
                    columnIndexForEnabled={null}
                    operation="REMOVE"
                    firstColumnData={(rowData: PlainPackFileDataRow) => rowData[0] as string}
                    secondColumnData={(rowData: PlainPackFileDataRow) => rowData[1] as string}
                    firstColumnHeaderLocId="unit"
                    secondColumnHeaderLocId="group"
                    firstColumnTableLoc="land_units_onscreen_name"
                  />
                </Tabs.Item>
              )}
              {factionData != undefined && (
                <Tabs.Item title={localized.factionsUnitPermissions}>
                  <ModCustomizationRows
                    locTree={locTree}
                    tablesData={factionData}
                    packPath={packPath}
                    currentPackDataOverwrites={currentPackDataOverwrites}
                    modFilter={sanitizedModFilter}
                    onFilterChange={onFilterChange}
                    clearFilter={clearFilter}
                    modsMergeSort={modsMergeSort}
                    toggleUnitKeySorting={toggleUnitKeySorting}
                    toggleNameSorting={toggleNameSorting}
                    toggleEnabledSorting={toggleEnabledSorting}
                    getRowKey={(rowData: PlainPackFileDataRow) => {
                      return `${rowData[0]}_${rowData[1]}`;
                    }}
                    columnIndices={[0, 1]}
                    columnIndexForEnabled={2}
                    getAllowedForRow={(rowData: PlainPackFileDataRow) => rowData[2] as boolean}
                    operation="EDIT"
                    firstColumnData={(rowData: PlainPackFileDataRow) => rowData[0] as string}
                    secondColumnData={(rowData: PlainPackFileDataRow) => rowData[1] as string}
                    firstColumnHeaderLocId="unit"
                    secondColumnHeaderLocId="owner"
                    firstColumnTableLoc="land_units_onscreen_name"
                    secondColumnTableLoc="factions_screen_name"
                  />
                </Tabs.Item>
              )}
              {buildingsData != undefined && (
                <Tabs.Item title={localized.buildingsPermissions}>
                  <ModCustomizationRows
                    locTree={locTree}
                    tablesData={buildingsData}
                    packPath={packPath}
                    currentPackDataOverwrites={currentPackDataOverwrites}
                    modFilter={sanitizedModFilter}
                    onFilterChange={onFilterChange}
                    clearFilter={clearFilter}
                    modsMergeSort={modsMergeSort}
                    toggleUnitKeySorting={toggleUnitKeySorting}
                    toggleNameSorting={toggleNameSorting}
                    toggleEnabledSorting={toggleEnabledSorting}
                    getRowKey={(rowData: PlainPackFileDataRow) => {
                      return `${rowData[0]}_${rowData[1]}_${rowData[4]}_${rowData[5]}`;
                    }}
                    getAllowedForRow={(rowData: PlainPackFileDataRow) => !rowData[6] as boolean}
                    operation="EDIT"
                    firstColumnData={(rowData: PlainPackFileDataRow) => rowData[0] as string}
                    secondColumnData={(rowData: PlainPackFileDataRow) =>
                      `${stringOrUnderdash(rowData[1])} ${stringOrUnderdash(rowData[4])} ${stringOrUnderdash(
                        rowData[5]
                      )}`
                    }
                    columnIndices={[0, 1, 4, 5]}
                    columnIndexForEnabled={6}
                    firstColumnHeaderLocId="Building"
                    secondColumnHeaderLocId="cultureSubcultureFaction"
                    firstColumnLocBuilder={(rowData: PlainPackFileDataRow) => {
                      return [rowData[0], rowData[1], rowData[4], rowData[5]]
                        .filter((text) => text != "")
                        .join("");
                    }}
                    firstColumnTableLoc="building_culture_variants_name"
                  />
                </Tabs.Item>
              )}
              {agentsData != undefined && (
                <Tabs.Item active={true} title={localized.agentsPermissions}>
                  <ModCustomizationRows
                    locTree={locTree}
                    tablesData={agentsData}
                    packPath={packPath}
                    currentPackDataOverwrites={currentPackDataOverwrites}
                    modFilter={sanitizedModFilter}
                    onFilterChange={onFilterChange}
                    clearFilter={clearFilter}
                    modsMergeSort={modsMergeSort}
                    toggleUnitKeySorting={toggleUnitKeySorting}
                    toggleNameSorting={toggleNameSorting}
                    toggleEnabledSorting={toggleEnabledSorting}
                    getRowKey={(rowData: PlainPackFileDataRow) => {
                      return `${rowData[0]}_${rowData[1]}_${rowData[2]}`;
                    }}
                    columnIndices={[0, 1, 2]}
                    getAllowedForRow={() => true}
                    columnIndexForEnabled={null}
                    operation="REMOVE"
                    firstColumnData={(rowData: PlainPackFileDataRow) => `${rowData[2]} (${rowData[0]})`}
                    secondColumnData={(rowData: PlainPackFileDataRow) => rowData[1] as string}
                    firstColumnLocBuilder={(rowData: PlainPackFileDataRow) => rowData[2] as string}
                    firstColumnHeaderLocId="agentSubtypeAndType"
                    secondColumnHeaderLocId="faction"
                    firstColumnTableLoc="agent_subtypes_onscreen_name_override"
                    secondColumnTableLoc="factions_screen_name"
                  />
                </Tabs.Item>
              )}
              {uniqueAgentsData != undefined && (
                <Tabs.Item active={true} title={localized.uniqueAgentsPermissions}>
                  <ModCustomizationRows
                    locTree={locTree}
                    tablesData={uniqueAgentsData}
                    packPath={packPath}
                    currentPackDataOverwrites={currentPackDataOverwrites}
                    modFilter={sanitizedModFilter}
                    onFilterChange={onFilterChange}
                    clearFilter={clearFilter}
                    modsMergeSort={modsMergeSort}
                    toggleUnitKeySorting={toggleUnitKeySorting}
                    toggleNameSorting={toggleNameSorting}
                    toggleEnabledSorting={toggleEnabledSorting}
                    getRowKey={(rowData: PlainPackFileDataRow) => {
                      return `${rowData[0]}_${rowData[1]}_${rowData[2]}`;
                    }}
                    columnIndices={[0, 1, 2]}
                    getAllowedForRow={() => true}
                    columnIndexForEnabled={null}
                    operation="REMOVE"
                    firstColumnData={(rowData: PlainPackFileDataRow) => rowData[2] as string}
                    secondColumnData={(rowData: PlainPackFileDataRow) => rowData[1] as string}
                    firstColumnHeaderLocId="agentSubtype"
                    secondColumnHeaderLocId="campaignGroup"
                    firstColumnTableLoc="agent_subtypes_onscreen_name_override"
                  />
                </Tabs.Item>
              )}
              <Tabs.Item title={localized.help}>
                <div className="leading-relaxed dark:text-gray-300 relative font-normal">
                  <p>{localized.modCustomizationHelp1}</p>
                  <p className="mt-6">{localized.modCustomizationHelp2}</p>
                  <p className="mt-6">{localized.modCustomizationHelp3}</p>
                  <p className="mt-6">{localized.modCustomizationHelp4}</p>
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
        <Modal.Header>{localized.readingAndComparingPacks}</Modal.Header>
        <Modal.Body>
          <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
            {localized.waitForReadingAndComparingPacks}
          </p>
          <div className="text-center mt-8">
            <Spinner color="purple" size="xl" />
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
});

export default ModCustomization;
