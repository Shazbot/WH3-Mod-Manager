import React, { memo, useCallback, useContext } from "react";
import localizationContext from "../localizationContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { ModCustomizationSorts } from "./ModCustomization";
import { compareModNames } from "../modSortingHelpers";
import { useAppDispatch } from "../hooks";
import { removePackDataOverwrite, setPackDataOverwrites } from "../appSlice";
import { getLocFromTree } from "../utility/packDataHandling";

export interface ModCustomizationRowsProps {
  tablesData: Record<string, PlainPackFileData>;
  packPath: string;
  currentPackDataOverwrites: PackDataOverwrite[];
  modFilter: string;
  onFilterChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearFilter: () => void;
  modsMergeSort: ModCustomizationSorts;
  toggleUnitKeySorting: () => void;
  toggleNameSorting: () => void;
  toggleEnabledSorting: () => void;
  getRowKey: (data: PlainPackFileDataRow) => string;
  firstColumnData: (data: PlainPackFileDataRow) => string;
  secondColumnData: (data: PlainPackFileDataRow) => string;
  getAllowedForRow: (data: PlainPackFileDataRow) => boolean;
  operation: PackDataOverwriteOperation;
  firstColumnHeaderLocId: string;
  secondColumnHeaderLocId: string;
  columnIndices: number[];
  columnIndexForEnabled: number | null;
  firstColumnTableLoc?: string;
  secondColumnTableLoc?: string;
  firstColumnLocBuilder?: (data: PlainPackFileDataRow) => string;
  locTree: Tree;
}

const ModCustomizationRows = memo(
  ({
    tablesData,
    packPath,
    currentPackDataOverwrites,
    modsMergeSort,
    modFilter,
    clearFilter,
    onFilterChange,
    toggleUnitKeySorting,
    toggleNameSorting,
    toggleEnabledSorting,
    getRowKey,
    getAllowedForRow,
    operation,
    firstColumnData,
    secondColumnData,
    firstColumnHeaderLocId,
    secondColumnHeaderLocId,
    columnIndices,
    columnIndexForEnabled,
    firstColumnTableLoc,
    secondColumnTableLoc,
    firstColumnLocBuilder,
    locTree,
  }: ModCustomizationRowsProps) => {
    const dispatch = useAppDispatch();
    const localized: Record<string, string> = useContext(localizationContext);

    const getFilteredPlainData = useCallback(
      (data: PlainPackFileData, rowLocalizations: WeakMap<object, string[]>) => {
        if (modFilter == "") return data;
        return data.filter((dataRow) => {
          const [firstColumnText, secondColumnText] = rowLocalizations.get(dataRow) ?? ["", ""];
          return (
            firstColumnData(dataRow).toLowerCase().includes(modFilter) ||
            secondColumnData(dataRow).toLowerCase().includes(modFilter) ||
            (firstColumnText != "" && firstColumnText.toLowerCase().includes(modFilter)) ||
            (secondColumnText != "" && secondColumnText.toLowerCase().includes(modFilter))
          );
        });
      },
      [modFilter, firstColumnData, secondColumnData]
    );

    const getSortedPlainData = useCallback(
      (data: PlainPackFileData, currentPackDataOverwrites: PackDataOverwrite[]) => {
        const enabledSort = () => {
          return data.sort((firstMod, secondMod) => {
            const keyOne = `${firstMod[0]}_${firstMod[1]}`;
            const keyTwo = `${secondMod[0]}_${secondMod[1]}`;
            const existingOverwriteOne = currentPackDataOverwrites.find(
              (iterOverwrite) => iterOverwrite.columnsId == keyOne
            );
            const existingOverwriteTwo = currentPackDataOverwrites.find(
              (iterOverwrite) => iterOverwrite.columnsId == keyTwo
            );
            const enabledOverwriteOne =
              existingOverwriteOne && existingOverwriteOne.overwriteData != undefined
                ? (existingOverwriteOne.overwriteData as boolean)
                : firstMod.length > 2
                ? (firstMod[2] as boolean)
                : true;

            const enabledOverwriteTwo =
              existingOverwriteTwo && existingOverwriteTwo.overwriteData != undefined
                ? (existingOverwriteTwo.overwriteData as boolean)
                : secondMod.length > 2
                ? (secondMod[2] as boolean)
                : true;

            if (enabledOverwriteOne && enabledOverwriteTwo) return 0;
            if (enabledOverwriteOne && !enabledOverwriteTwo) return -1;
            if (!enabledOverwriteOne && enabledOverwriteTwo) return 1;
            return 0;
          });
        };

        switch (modsMergeSort) {
          case "UnitKeyTableOrder":
            return data;
            break;
          case "UnitKey":
            return data.sort((firstMod, secondMod) => {
              return compareModNames(firstMod[0] as string, secondMod[0] as string);
            });
            break;
          case "UnitKeyDesc":
            return data
              .sort((firstMod, secondMod) => {
                return compareModNames(firstMod[0] as string, secondMod[0] as string);
              })
              .reverse();
            break;
          case "UnitOwner":
            return data.sort((firstMod, secondMod) => {
              return compareModNames(firstMod[1] as string, secondMod[1] as string);
            });
            break;
          case "UnitOwnerDesc":
            return data
              .sort((firstMod, secondMod) => {
                return compareModNames(firstMod[1] as string, secondMod[1] as string);
              })
              .reverse();
            break;
          case "Enabled":
            return enabledSort();
            break;
          case "EnabledDesc":
            return enabledSort().reverse();
            break;
        }
      },
      [modsMergeSort]
    );

    const onModCustomized = useCallback(
      (
        packPath: string,
        packFilePath: string,
        data: PlainPackFileData,
        currentPackDataOverwrites: PackDataOverwrite[],
        rowData: PlainPackFileDataRow,
        columnIndices: number[],
        getRowKey: (data: PlainPackFileDataRow) => string,
        columnIndexForEnabled: number | null,
        operation?: PackDataOverwriteOperation
      ) => {
        console.log("onModCustomized for:", rowData);
        console.log("currentPackDataOverwrites are:", currentPackDataOverwrites);
        for (let i = 0; i < data.length; i++) {
          const isMatch = columnIndices.reduce((acc, currentIndex) => {
            return acc && data[i][currentIndex] == rowData[currentIndex];
          }, true);
          if (isMatch) {
            const columnsId = getRowKey(rowData);
            console.log("currentPackDataOverwrites", currentPackDataOverwrites);
            const existingOverwrite =
              currentPackDataOverwrites &&
              currentPackDataOverwrites.find(
                (iterOverwrite) =>
                  iterOverwrite.packFilePath == packFilePath && iterOverwrite.columnsId == columnsId
              );

            let newOverwriteData: PlainPackDataTypes | undefined = undefined;

            if (operation && operation != "REMOVE" && columnIndexForEnabled != null)
              newOverwriteData =
                existingOverwrite && existingOverwrite.overwriteData != undefined
                  ? !existingOverwrite.overwriteData
                  : !data[i][columnIndexForEnabled];

            console.log("modPath:", packPath);

            const dataOverwrite: PackDataOverwritePayload = {
              packName: packPath,
              packFilePath,
              columnsId,
              columnIndices: columnIndices,
              columnValues: columnIndices.map((i) => rowData[i]),
              operation: operation || "REMOVE",
              overwriteIndex: columnIndexForEnabled ?? undefined,
              overwriteData: newOverwriteData,
            };
            if (existingOverwrite) {
              console.log("REMOVING pack data overwrite:", dataOverwrite);
              dispatch(removePackDataOverwrite(dataOverwrite));
              break;
            }

            console.log("dispatching setPackDataOverwrites:", dataOverwrite);
            dispatch(setPackDataOverwrites(dataOverwrite));
            break;
          }
        }
      },
      []
    );

    const getDefaultEnabledValue = useCallback(
      (
        operation: PackDataOverwriteOperation,
        existingOverwrite: PackDataOverwrite | undefined,
        rowData: PlainPackFileDataRow
      ) => {
        if (existingOverwrite == undefined) return getAllowedForRow(rowData);
        if (operation == "REMOVE") return false;
        if (existingOverwrite.overwriteData == undefined) return getAllowedForRow(rowData);

        return existingOverwrite.overwriteData as boolean;
      },
      [getAllowedForRow]
    );

    const rowLocalizations = Object.values(tablesData).reduce((acc, current) => {
      current.forEach((rowData) => {
        const firstColumnLocId = firstColumnLocBuilder
          ? firstColumnLocBuilder(rowData)
          : firstColumnData(rowData);
        const firstColumnLocalized =
          firstColumnTableLoc && getLocFromTree(locTree, firstColumnTableLoc, firstColumnLocId);

        const secondColumnLocId = secondColumnData(rowData);
        const secondColumnLocalized =
          secondColumnTableLoc && getLocFromTree(locTree, secondColumnTableLoc, secondColumnLocId);

        acc.set(rowData, [firstColumnLocalized ?? "", secondColumnLocalized ?? ""]);
      });
      return acc;
    }, new WeakMap<object, string[]>());

    // const firstColumnLocId = firstColumnLocBuilder
    //   ? firstColumnLocBuilder(rowData)
    //   : firstColumnData(rowData);
    // const firstColumnLocalized =
    //   firstColumnTableLoc && getLocFromTree(locTree, firstColumnTableLoc, firstColumnLocId);

    // const secondColumnLocId = secondColumnData(rowData);
    // const secondColumnLocalized =
    //   secondColumnTableLoc && getLocFromTree(locTree, secondColumnTableLoc, secondColumnLocId);

    return (
      <>
        <div className="flex items-center">
          <span className="text-slate-100">{localized.filter}</span>
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
          <div className="grid grid-cols-10">
            <div
              className={
                "col-span-4 flex " +
                (((modsMergeSort == "UnitKeyTableOrder" ||
                  modsMergeSort == "UnitKey" ||
                  modsMergeSort == "UnitKeyDesc") &&
                  "font-bold") ||
                  "")
              }
              onClick={() => toggleUnitKeySorting()}
            >
              {localized[firstColumnHeaderLocId]}
              {modsMergeSort == "UnitKeyTableOrder" && ` ${localized.unitKeySortTableOrder}▼`}
              {modsMergeSort == "UnitKey" && "▼"}
              {modsMergeSort == "UnitKeyDesc" && "▲"}
            </div>
            <div
              className={
                "col-span-4 " +
                (((modsMergeSort == "UnitOwner" || modsMergeSort == "UnitOwnerDesc") && "font-bold") || "")
              }
              onClick={() => toggleNameSorting()}
            >
              {localized[secondColumnHeaderLocId]}
              {modsMergeSort == "UnitOwner" && "▼"}
              {modsMergeSort == "UnitOwnerDesc" && "▲"}
            </div>
            <div
              className={
                "col-span-2 flex justify-center " +
                (((modsMergeSort == "Enabled" || modsMergeSort == "EnabledDesc") && "font-bold") || "")
              }
              onClick={() => toggleEnabledSorting()}
            >
              {localized.allowed}
              {modsMergeSort == "Enabled" && "▼"}
              {modsMergeSort == "EnabledDesc" && "▲"}
            </div>
          </div>
          {tablesData &&
            Object.entries(tablesData).map(([packFilePath, data]) => {
              return getFilteredPlainData(
                getSortedPlainData(data, currentPackDataOverwrites),
                rowLocalizations
              ).map((rowData, i) => {
                const key = getRowKey(rowData);
                const existingOverwrite = currentPackDataOverwrites.find(
                  (iterOverwrite) => iterOverwrite.columnsId == key
                );

                // console.log("firstColumnLocId", firstColumnLocId);
                // console.log("firstColumnTableLoc", firstColumnTableLoc);
                // console.log("firstColumnLocalized", firstColumnLocalized);

                const [firstColumnLocalized, secondColumnLocalized] = rowLocalizations.get(rowData) ?? [
                  "",
                  "",
                ];

                return (
                  <React.Fragment key={key}>
                    {i == 0 && (
                      <div className="grid grid-cols-10 items-center border-b gap-2 py-2 border-gray-600">
                        <div className="col-span-10 -ml-7 pt-2">{packFilePath}</div>
                      </div>
                    )}
                    <div className="grid grid-cols-10 items-center border-b gap-2 py-2 border-gray-600">
                      <div className="col-span-4">
                        <label
                          htmlFor={key + "_merge_checkbox"}
                          className={existingOverwrite && "text-blue-600"}
                        >
                          <div>{firstColumnData(rowData)}</div>
                          {firstColumnLocalized != "" && <div>{`${firstColumnLocalized}`}</div>}
                        </label>
                      </div>
                      <div className="col-span-4">
                        <label
                          htmlFor={key + "_merge_checkbox"}
                          className={existingOverwrite && "text-blue-600"}
                        >
                          <div>{secondColumnData(rowData)}</div>
                          {secondColumnLocalized != "" && <div>{`${secondColumnLocalized}`}</div>}
                        </label>
                      </div>
                      <div className="col-span-2 justify-center flex">
                        <input
                          type="checkbox"
                          defaultChecked={getDefaultEnabledValue(operation, existingOverwrite, rowData)}
                          onChange={() =>
                            onModCustomized(
                              packPath,
                              packFilePath,
                              data,
                              currentPackDataOverwrites,
                              rowData,
                              columnIndices,
                              getRowKey,
                              columnIndexForEnabled,
                              operation
                            )
                          }
                          id={key + "_merge_checkbox"}
                          name={key}
                        />
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })}
        </div>
      </>
    );
  }
);
export default ModCustomizationRows;
