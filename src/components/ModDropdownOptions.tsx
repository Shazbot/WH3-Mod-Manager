import { Tooltip } from "flowbite-react";
import React, { memo, useCallback, useContext, useState } from "react";
import {
  setCurrentModToUpload,
  setIsModTagPickerOpen,
  setModLoadOrderRelativeTo,
  toggleAlwaysEnabledMods,
  toggleAlwaysHiddenMods,
} from "../appSlice";
import {
  FaFolderOpen,
  FaExternalLinkAlt,
  FaCopy,
  FaTable,
  FaSteam,
  FaRegClipboard,
  FaDownload,
  FaEdit,
  FaRegCopy,
  FaTrash,
  FaSync,
  FaClock,
} from "react-icons/fa";
import { GoListOrdered } from "react-icons/go";
import { MdOutlineCheckBox, MdHideImage, MdOutlineModeEdit, MdPlaylistRemove } from "react-icons/md";

import { Modal } from "../flowbite";
import RenameModal from "./RenameModal";

import { useAppDispatch, useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";

type ModDropdownOptionsProps = {
  mod?: Mod;
  mods: Mod[];
  visibleMods: Mod[];
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
const copyModToData = (mod: Mod) => {
  console.log(mod);
  window.api?.copyModToData(mod.path);
};
const makePackBackup = (mod: Mod) => {
  window.api?.makePackBackup(mod);
};
const deletePack = (mod: Mod) => {
  if (!mod) return;
  window.api?.deletePack(mod);
};
const unsubscribe = (mod: Mod, allMods: Mod[]) => {
  const modInContent = mod.isInData
    ? allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData)
    : mod;
  if (!modInContent) return;
  window.api?.unsubscribeToMod(modInContent);
};

const ModDropdownOptions = memo((props: ModDropdownOptionsProps) => {
  const dispatch = useAppDispatch();
  const allMods = useAppSelector((state) => state.app.allMods);
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const isDev = useAppSelector((state) => state.app.isDev);
  const [isSetLoadOrderOpen, setIsSetLoadOrderOpen] = useState(false);
  const [loadOrderHasError, setLoadOrderHasError] = useState(false);
  const [currentModLoadOrder, setCurrentModLoadOrder] = useState("");
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

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
  const uploadMod = useCallback(
    (mod: Mod) => {
      dispatch(setCurrentModToUpload(mod));
      dispatch(setIsModTagPickerOpen(true));
    },
    [allMods]
  );
  const fakeUpdatePack = useCallback(
    (mod: Mod) => {
      if (!isDev) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && !iterMod.isInData);
        if (contentMod == null) return;
      }

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
                    const numLordOrder = Number(currentModLoadOrder);
                    if (numLordOrder == null || isNaN(numLordOrder)) return;
                    if (numLordOrder < 0) return;
                    console.log("set numLordOrder:", numLordOrder);
                    let relativeMod = props.visibleMods[numLordOrder];
                    let setAfterMod = false;
                    if (!relativeMod) {
                      relativeMod = props.visibleMods[numLordOrder - 1];
                      setAfterMod = true;
                    }
                    if (!relativeMod) return;
                    dispatch(
                      setModLoadOrderRelativeTo({
                        modNameToChange: props.mod?.name,
                        modNameRelativeTo: relativeMod.name,
                        visualModList: props.visibleMods,
                        setAfterMod: setAfterMod,
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

        {props.mod && (
          <RenameModal show={isRenameModalOpen} onClose={() => setIsRenameModalOpen(false)} mod={props.mod} />
        )}

        <Modal
          onClose={() => setIsDeleteConfirmOpen(false)}
          show={isDeleteConfirmOpen}
          size="md"
          position="center"
        >
          <Modal.Header>
            {localized.deleteMod || "Delete Mod"}
          </Modal.Header>
          <Modal.Body>
            <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
              {localized.deleteModConfirmMessage || "Are you sure you want to delete this mod from the data folder?"}
              <br />
              <br />
              <span className="font-semibold text-gray-900 dark:text-white">{props.mod?.name}</span>
              <br />
              <br />
              <span className="text-red-600 font-semibold">
                {localized.deleteModWarning || "This action cannot be undone!"}
              </span>
            </p>
          </Modal.Body>
          <Modal.Footer>
            <button
              className="px-4 py-2 bg-gray-500 text-white font-medium text-sm rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
              onClick={() => setIsDeleteConfirmOpen(false)}
            >
              {localized.cancel || "Cancel"}
            </button>
            <button
              className="px-4 py-2 bg-red-600 text-white font-medium text-sm rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              onClick={() => {
                if (props.mod) {
                  deletePack(props.mod);
                  setIsDeleteConfirmOpen(false);
                }
              }}
            >
              {localized.delete || "Delete"}
            </button>
          </Modal.Footer>
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
                  <span className="flex items-center gap-2">
                    <GoListOrdered className="w-5 h-5"></GoListOrdered>
                    {localized.setLoadOrder}
                  </span>
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
                      <span className="flex items-center gap-2">
                        <FaExternalLinkAlt className="w-5 h-5"></FaExternalLinkAlt>
                        {localized.goToWorkshopPage}
                      </span>
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
                      <span className="flex items-center gap-2">
                        <FaSteam className="w-5 h-5"></FaSteam>
                        {localized.openInSteam}
                      </span>
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
                  <span className="flex items-center gap-2">
                    <MdOutlineCheckBox className="w-5 h-5"></MdOutlineCheckBox>
                    {localized.keepAlwaysEnabled}
                  </span>
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
                  <span className="flex items-center gap-2">
                    <MdHideImage className="w-5 h-5"></MdHideImage>
                    {localized.hideFromList}
                  </span>
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
                <span className="flex items-center gap-2">
                  <FaFolderOpen className="w-5 h-5"></FaFolderOpen>
                  {localized.showInExplorer}
                </span>
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
                <span className="flex items-center gap-2">
                  <MdOutlineModeEdit className="w-5 h-5"></MdOutlineModeEdit>
                  {localized.showInRPFM}
                </span>
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
                <span className="flex items-center gap-2">
                  <FaTable className="w-5 h-5"></FaTable>
                  {localized.openInViewer}
                </span>
              </a>
            </li>
            {props.mod?.isInData && (
              <li>
                <a
                  onClick={() => setIsRenameModalOpen(true)}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <FaEdit className="w-5 h-5"></FaEdit>
                    {localized.renamePackedFiles}
                  </span>
                </a>
              </li>
            )}
            <li>
              <a
                onClick={() => {
                  if (props.mod) putPathInClipboard(props.mod);
                }}
                href="#"
                className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <span className="flex items-center gap-2">
                  <FaRegClipboard className="w-5 h-5"></FaRegClipboard>
                  {localized.copyPathToClipboard}
                </span>
              </a>
            </li>
            {!props.mod?.isInData && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) copyModToData(props.mod);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <FaRegCopy className="w-5 h-5"></FaRegCopy>
                    {localized.copyModToData}
                  </span>
                </a>
              </li>
            )}
            {/* {props.mod?.isInData &&
              !allMods.some((iterMod) => iterMod.name == props.mod?.name && !iterMod.isInData) && (
                <li>
                  <a
                    onClick={() => {
                      if (props.mod) uploadMod(props.mod);
                    }}
                    href="#"
                    className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                  >
                    <Tooltip
                      placement="right"
                      style="light"
                      content={<div className="min-w-[10rem]">{localized.uploadModTooltip}</div>}
                    >
                      {localized.uploadMod}
                    </Tooltip>
                  </a>
                </li>
              )} */}
            {props.mod?.isInData &&
              (allMods.some((iterMod) => iterMod.name == props.mod?.name && !iterMod.isInData) || isDev) && (
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
                        <span className="flex items-center gap-2">
                          <FaSync className="w-5 h-5"></FaSync>
                          {localized.updateMod}
                        </span>
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
                        <span className="flex items-center gap-2">
                          <FaClock className="w-5 h-5"></FaClock>
                          {localized.fakeUpdatePack}
                        </span>
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
                  <span className="flex items-center gap-2">
                    <FaCopy className="w-5 h-5"></FaCopy>
                    {localized.createBackup}
                  </span>
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
                    <span className="flex items-center gap-2">
                      <FaDownload className="w-5 h-5"></FaDownload>
                      {localized.forceDownload}
                    </span>
                  </Tooltip>
                </a>
              </li>
            )}
            {(!props.mod?.isInData ||
              allMods.find((iterMod) => !iterMod.isInData && iterMod.name == props.mod?.name)) && (
              <li>
                <a
                  onClick={() => {
                    if (props.mod) unsubscribe(props.mod, allMods);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.unsubscribeTooltip}</div>}
                    style="light"
                  >
                    <span className="flex items-center gap-2">
                      <MdPlaylistRemove className="w-5 h-5"></MdPlaylistRemove>
                      {localized.unsubscribe}
                    </span>
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
            {props.mod?.isInData && (
              <li>
                <a
                  onClick={() => {
                    setIsDeleteConfirmOpen(true);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.deleteModTooltip || "Delete this mod from the data folder"}</div>}
                    style="light"
                  >
                    <span className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <FaTrash className="w-5 h-5"></FaTrash>
                      {localized.deleteMod || "Delete Mod"}
                    </span>
                  </Tooltip>
                </a>
              </li>
            )}
            {props.mod?.mergedModsData && (
              <li>
                <a
                  onClick={() => {
                    setIsDeleteConfirmOpen(true);
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={<div className="min-w-[10rem]">{localized.deleteModTooltip || "Delete this merged mod"}</div>}
                    style="light"
                  >
                    <span className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      <FaTrash className="w-5 h-5"></FaTrash>
                      {localized.deleteMod || "Delete Mod"}
                    </span>
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
