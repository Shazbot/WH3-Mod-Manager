import { Tooltip } from "flowbite-react";
import React, { memo, useCallback, useContext, useState } from "react";
import {
  setModLoadOrder,
  setModLoadOrderRelativeTo,
  toggleAlwaysEnabledMods,
  toggleAlwaysHiddenMods,
} from "../appSlice";
import { Modal } from "../flowbite";
import { useAppDispatch, useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";

type ModDropdownOptionsProps = {
  isOpen: boolean;
  mod?: Mod;
  mods: Mod[];
};

const openInExplorer = (mod: Mod) => {
  window.api?.openFolderInExplorer(mod.path);
};
const openInRPFM = (mod: Mod) => {
  window.api?.openPack(mod.path);
};
const openInViewer = (mod: Mod) => {
  window.api?.requestOpenModInViewer(mod.path);
};
const putPathInClipboard = (mod: Mod) => {
  console.log(mod);
  window.api?.putPathInClipboard(mod.path);
};
const makePackBackup = (mod: Mod) => {
  window.api?.makePackBackup(mod);
};
const deletePack = (mod: Mod) => {
  if (!mod) return;
  window.api?.deletePack(mod);
};
const unsubscribe = (mod: Mod) => {
  window.api?.unsubscribeToMod(mod);
};

const ModDropdownOptions = memo((props: ModDropdownOptionsProps) => {
  const dispatch = useAppDispatch();
  const allMods = useAppSelector((state) => state.app.allMods);
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const [isSetLoadOrderOpen, setIsSetLoadOrderOpen] = useState(false);
  const [loadOrderHasError, setLoadOrderHasError] = useState(false);
  const [currentModLoadOrder, setCurrentModLoadOrder] = useState("");

  const localized: Record<string, string> = useContext(localizationContext);

  const onGoToWorkshopPageClick = useCallback(
    (mod: Mod) => {
      let workshopId = mod.workshopId;
      if (mod.isInData) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
        if (!contentMod) return;
        workshopId = contentMod.workshopId;
      }
      window.open(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
    },
    [allMods]
  );

  const onOpenInSteam = useCallback(
    (mod: Mod) => {
      let workshopId = mod.workshopId;
      if (mod.isInData) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
        if (!contentMod) return;
        workshopId = contentMod.workshopId;
      }
      window.api?.openInSteam(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
    },
    [allMods]
  );

  const updateMod = useCallback(
    (mod: Mod) => {
      const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
      if (contentMod == null) return;

      window.api?.updateMod(mod, contentMod);
    },
    [allMods]
  );
  const fakeUpdatePack = useCallback(
    (mod: Mod) => {
      const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
      if (contentMod == null) return;

      window.api?.fakeUpdatePack(mod);
    },
    [allMods]
  );
  const forceModDownload = useCallback(
    (mod: Mod) => {
      let modToDownload: Mod | undefined = mod;
      if (mod.isInData)
        modToDownload = allMods.find((iterMod) => !iterMod.isInData && iterMod.name == mod.name);
      if (!modToDownload) return;

      window.api?.forceModDownload(modToDownload);
    },
    [allMods]
  );
  const reMerge = (mod: Mod) => {
    if (!mod) return;
    if (!mod.mergedModsData) return;

    const modsToMerge = mod.mergedModsData
      .map((mod) => allMods.find((iterMod) => iterMod.path == mod.path))
      .filter((mod) => mod) as Mod[];
    window.api?.reMerge(mod, modsToMerge);
  };

  return (
    (props.mod == null && <></>) || (
      <>
        <Modal
          onClose={() => setIsSetLoadOrderOpen(false)}
          // show={true}
          show={isSetLoadOrderOpen}
          size="2xl"
          position="center"
        >
          <Modal.Header>
            {localized.setLoadOrderFor} {props.mod?.name}
          </Modal.Header>
          <Modal.Body>
            <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
              {`${localized.setLoadOrderMessage1} `}
              <span className="text-red-600 font-semibold">{localized.setLoadOrderMessage2}</span>
            </p>
            <div className="flex mt-4 justify-center items-center">
              <input
                id="filterInput"
                type="text"
                onChange={(e) => {
                  const loadOrder = e.target.value;
                  setCurrentModLoadOrder(loadOrder);
                  setLoadOrderHasError(loadOrder != "" && !Number(loadOrder));
                }}
                value={currentModLoadOrder}
                className={
                  "inline-block bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 w-20 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 " +
                  (loadOrderHasError ? "!border-red-700" : "")
                }
              ></input>
              <div className="ml-4 justify-center inline-block">
                <button
                  className="make-tooltip-w-full px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out"
                  onClick={() => {
                    const numLordOrder = Number(currentModLoadOrder) - 1;
                    if (numLordOrder == null || isNaN(numLordOrder)) return;
                    if (numLordOrder < 0) return;
                    console.log(numLordOrder);
                    const relativeMod = props.mods.filter((mod) => mod != props.mod)[numLordOrder];
                    if (!relativeMod) return;
                    dispatch(
                      setModLoadOrderRelativeTo({
                        modNameToChange: props.mod?.name,
                        modNameRelativeTo: relativeMod.name,
                      } as ModLoadOrderRelativeTo)
                    );

                    // dispatch(
                    //   setModLoadOrder({
                    //     modName: props.mod?.name ?? "",
                    //     loadOrder: numLordOrder,
                    //     originalOrder: props.mod?.loadOrder,
                    //   })
                    // );
                    setIsSetLoadOrderOpen(false);
                  }}
                >
                  <span className="uppercase">{localized.setLoadOrder}</span>
                </button>
              </div>
            </div>
          </Modal.Body>
        </Modal>
        <div>
          <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
            {currentTab != "categories" && (
              <li>
                <a
                  onClick={() => setIsSetLoadOrderOpen(true)}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  {localized.setLoadOrder}
                </a>
              </li>
            )}
            {props.mod &&
              (!props.mod?.isInData ||
                allMods.some((iterMod) => iterMod.name == props.mod?.name && !iterMod.isInData)) && (
                <>
                  <li>
                    <a
                      href="#"
                      onClick={() => {
                        if (props.mod) {
                          onGoToWorkshopPageClick(props.mod);
                        }
                      }}
                      className={
                        "block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                      }
                    >
                      {localized.goToWorkshopPage}
                    </a>
                  </li>
                  <li>
                    <a
                      href="#"
                      onClick={() => {
                        if (props.mod) {
                          onOpenInSteam(props.mod);
                        }
                      }}
                      className={
                        "block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                      }
                    >
                      {localized.openInSteam}
                    </a>
                  </li>
                </>
              )}
            <li>
              <a
                onClick={() => {
                  if (props.mod) dispatch(toggleAlwaysEnabledMods([props.mod]));
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={<div className="min-w-[10rem]">{localized.keepAlwaysEnabledTooltip}</div>}
                >
                  {localized.keepAlwaysEnabled}
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) dispatch(toggleAlwaysHiddenMods([props.mod]));
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={<div className="min-w-[10rem]">{localized.hideFromListTooltip}</div>}
                >
                  {localized.hideFromList}
                </Tooltip>
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) openInExplorer(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                {localized.showInExplorer}
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) openInRPFM(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                {localized.showInRPFM}
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) openInViewer(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                {localized.openInViewer}
              </a>
            </li>
            <li>
              <a
                onClick={() => {
                  if (props.mod) putPathInClipboard(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                {localized.copyPathToClipboard}
              </a>
            </li>
            {props.mod?.isInData &&
              allMods.some((iterMod) => iterMod.name == props.mod?.name && !iterMod.isInData) && (
                <>
                  <li>
                    <a
                      onClick={() => {
                        if (props.mod) updateMod(props.mod);
                      }}
                      href="#"
                      className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    >
                      <Tooltip
                        placement="right"
                        style="light"
                        content={<div className="min-w-[10rem]">{localized.updateModTooltip}</div>}
                      >
                        {localized.updateMod}
                      </Tooltip>
                    </a>
                  </li>
                  <li>
                    <a
                      onClick={() => {
                        if (props.mod) fakeUpdatePack(props.mod);
                      }}
                      href="#"
                      className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                    >
                      <Tooltip
                        placement="right"
                        style="light"
                        content={<div className="min-w-[10rem]">{localized.fakeUpdatePackTooltip}</div>}
                      >
                        {localized.fakeUpdatePack}
                      </Tooltip>
                    </a>
                  </li>
                </>
              )}
            <li>
              <a
                onClick={() => {
                  if (props.mod) makePackBackup(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Tooltip
                  placement="right"
                  style="light"
                  content={<div className="min-w-[10rem]">{localized.createBackupTooltip}</div>}
                >
                  {localized.createBackup}
                </Tooltip>
              </a>
            </li>
            {(!props.mod?.isInData ||
              allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod?.name)) && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) forceModDownload(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.forceDownloadTooltip}</div>}
                    style="light"
                  >
                    {localized.forceDownload}
                  </Tooltip>
                </a>
              </li>
            )}
            {(!props.mod?.isInData ||
              allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod?.name)) && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) unsubscribe(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.unsubscribeTooltip}</div>}
                    style="light"
                  >
                    {localized.unsubscribe}
                  </Tooltip>
                </a>
              </li>
            )}
            {props.mod?.mergedModsData && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) reMerge(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.reMergeTooltip}</div>}
                    style="light"
                  >
                    {localized.reMerge}
                  </Tooltip>
                </a>
              </li>
            )}
            {props.mod?.mergedModsData && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) deletePack(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.deleteModTooltip}</div>}
                    style="light"
                  >
                    {localized.deleteMod}
                  </Tooltip>
                </a>
              </li>
            )}
          </ul>
        </div>
      </>
    )
  );
});
export default ModDropdownOptions;
