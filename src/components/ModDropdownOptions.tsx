import { Tooltip } from "flowbite-react";
import React, { memo, useCallback, useContext, useMemo, useState } from "react";
import {
  addToast,
  setCurrentModToUpload,
  setIsModTagPickerOpen,
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
  FaExchangeAlt,
} from "react-icons/fa";
import { MdOutlineCheckBox, MdHideImage, MdOutlineModeEdit, MdPlaylistRemove } from "react-icons/md";

import { Modal } from "../flowbite";
import RenameModal from "./RenameModal";

import { useAppDispatch, useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";
import { getModSourceKind, isWorkshopMod } from "../modSources";

type ModDropdownOptionsProps = {
  mod?: Mod;
  mods: Mod[];
  /** The mods the menu acts on. Defaults to the single `mod` used by the regular mod list. */
  selectedMods?: Mod[];
  /** Called after an action that can be completed immediately. */
  onAction?: () => void;
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
  const modInContent = isWorkshopMod(mod)
    ? mod
    : allMods.find((iterMod) => iterMod.name == mod.name && isWorkshopMod(iterMod));
  if (!modInContent) return;
  window.api?.unsubscribeToMod(modInContent);
};

const ModDropdownOptions = memo((props: ModDropdownOptionsProps) => {
  const dispatch = useAppDispatch();
  const allMods = useAppSelector((state) => state.app.allMods);
  const isDev = useAppSelector((state) => state.app.isDev);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isComparingToWorkshop, setIsComparingToWorkshop] = useState(false);

  const localized: Record<string, string> = useContext(localizationContext);
  const { onAction } = props;

  const workshopVersion =
    props.mod && getModSourceKind(props.mod) !== "workshop"
      ? allMods.find((iterMod) => iterMod.name === props.mod?.name && isWorkshopMod(iterMod))
      : undefined;

  const compareToWorkshop = useCallback(
    async (mod: Mod, workshopMod: Mod) => {
      if (isComparingToWorkshop) return;
      setIsComparingToWorkshop(true);

      try {
        const result = await window.api?.compareModsByteForByte(mod.path, workshopMod.path);
        if (!result?.success || result.identical === undefined) {
          throw new Error(result?.error || "The comparison could not be completed.");
        }

        dispatch(
          addToast({
            type: result.identical ? "success" : "info",
            messages: [
              result.identical
                ? localized.modMatchesWorkshop || `${mod.name} is byte-for-byte identical to the Workshop version.`
                : localized.modDiffersFromWorkshop || `${mod.name} differs from the Workshop version.`,
            ],
            duration: 8000,
            startTime: Date.now(),
          }),
        );
      } catch (error) {
        dispatch(
          addToast({
            type: "warning",
            messages: [
              `${localized.compareToWorkshopFailed || "Failed to compare with the Workshop version:"} ${
                error instanceof Error ? error.message : String(error)
              }`,
            ],
            duration: 8000,
            startTime: Date.now(),
          }),
        );
      } finally {
        setIsComparingToWorkshop(false);
      }
    },
    [dispatch, isComparingToWorkshop, localized],
  );

  const selectedMods = useMemo(
    () => props.selectedMods ?? (props.mod ? [props.mod] : []),
    [props.mod, props.selectedMods],
  );
  const primaryMod = selectedMods[0];
  const allSelected = useCallback(
    (predicate: (mod: Mod) => boolean) => selectedMods.length > 0 && selectedMods.every(predicate),
    [selectedMods],
  );
  const runForSelectedMods = useCallback(
    (action: (mod: Mod) => void) => {
      selectedMods.forEach(action);
      onAction?.();
    },
    [onAction, selectedMods],
  );
  const hasWorkshopMod = useCallback(
    (mod: Mod) => isWorkshopMod(mod) || allMods.some((iterMod) => iterMod.name === mod.name && isWorkshopMod(iterMod)),
    [allMods],
  );
  const hasWorkshopModForEverySelection = allSelected(hasWorkshopMod);
  const isUpdateable = useCallback(
    (mod: Mod) =>
      mod.isInData && (isDev || allMods.some((iterMod) => iterMod.name === mod.name && isWorkshopMod(iterMod))),
    [allMods, isDev],
  );
  const canUpdateEverySelection = allSelected(isUpdateable);
  const canRenameEverySelection = allSelected((mod) => mod.isInData);
  const canCopyEverySelectionToData = allSelected((mod) => !mod.isInData);
  const canReMergeEverySelection = allSelected((mod) => !!mod.mergedModsData);
  const canDeleteDataEverySelection = allSelected((mod) => mod.isInData);
  const canDeleteMergedEverySelection = canReMergeEverySelection;
  const canDeleteEverySelection = allSelected((mod) => mod.isInData || !!mod.mergedModsData);
  const canDeleteMixedSelection =
    canDeleteEverySelection && !canDeleteDataEverySelection && !canDeleteMergedEverySelection;

  const onGoToWorkshopPageClick = useCallback(
    (mod: Mod) => {
      let workshopId = mod.workshopId;
      if (!isWorkshopMod(mod)) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && isWorkshopMod(iterMod));
        if (!contentMod) return;
        workshopId = contentMod.workshopId;
      }
      window.open(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
    },
    [allMods],
  );

  const onOpenInSteam = useCallback(
    (mod: Mod) => {
      let workshopId = mod.workshopId;
      if (!isWorkshopMod(mod)) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && isWorkshopMod(iterMod));
        if (!contentMod) return;
        workshopId = contentMod.workshopId;
      }
      window.api?.openInSteam(`https://steamcommunity.com/workshop/filedetails/?id=${workshopId}`);
    },
    [allMods],
  );

  const updateMod = useCallback(
    (mod: Mod) => {
      const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && isWorkshopMod(iterMod));
      if (contentMod == null) return;

      window.api?.updateMod(mod, contentMod);
    },
    [allMods],
  );
  const uploadMod = useCallback(
    (mod: Mod) => {
      dispatch(setCurrentModToUpload(mod));
      dispatch(setIsModTagPickerOpen(true));
    },
    [dispatch],
  );
  const fakeUpdatePack = useCallback(
    (mod: Mod) => {
      if (!isDev) {
        const contentMod = allMods.find((iterMod) => iterMod.name == mod.name && isWorkshopMod(iterMod));
        if (contentMod == null) return;
      }

      window.api?.fakeUpdatePack(mod);
    },
    [allMods, isDev],
  );
  const forceModDownload = useCallback(
    (mod: Mod) => {
      let modToDownload: Mod | undefined = mod;
      if (!isWorkshopMod(mod))
        modToDownload = allMods.find((iterMod) => isWorkshopMod(iterMod) && iterMod.name == mod.name);
      if (!modToDownload) return;

      window.api?.forceModDownload(modToDownload);
    },
    [allMods],
  );
  const forceResubscribe = useCallback(
    (modsToResubscribe: Mod[]) => {
      const workshopMods = modsToResubscribe
        .map((mod) =>
          isWorkshopMod(mod) ? mod : allMods.find((iterMod) => isWorkshopMod(iterMod) && iterMod.name === mod.name),
        )
        .filter((mod): mod is Mod => !!mod);
      if (workshopMods.length > 0) window.api?.forceResubscribeMods(workshopMods);
    },
    [allMods],
  );
  const reMerge = useCallback(
    (mod: Mod) => {
      if (!mod) return;
      if (!mod.mergedModsData) return;

      const modsToMerge = mod.mergedModsData
        .map((mod) => allMods.find((iterMod) => iterMod.path == mod.path))
        .filter((mod) => mod) as Mod[];
      window.api?.reMerge(mod, modsToMerge);
    },
    [allMods],
  );

  return (
    (primaryMod == null && <></>) || (
      <>
        {primaryMod && (
          <RenameModal
            show={isRenameModalOpen}
            onClose={() => setIsRenameModalOpen(false)}
            mod={primaryMod}
            mods={selectedMods}
          />
        )}

        <Modal onClose={() => setIsDeleteConfirmOpen(false)} show={isDeleteConfirmOpen} size="md" position="center">
          <Modal.Header>{localized.deleteMod || "Delete Mod"}</Modal.Header>
          <Modal.Body>
            <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
              {localized.deleteModConfirmMessage || "Are you sure you want to delete this mod from the data folder?"}
              <br />
              <br />
              <span className="font-semibold text-gray-900 dark:text-white">
                {primaryMod?.name}
                {selectedMods.length > 1 && ` (+${selectedMods.length - 1})`}
              </span>
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
                if (primaryMod) {
                  selectedMods.forEach(deletePack);
                  setIsDeleteConfirmOpen(false);
                  onAction?.();
                }
              }}
            >
              {localized.delete || "Delete"}
            </button>
          </Modal.Footer>
        </Modal>

        <div>
          <ul className="py-1 text-sm text-gray-700 dark:text-gray-200" aria-labelledby="dropdownDefault">
            {hasWorkshopModForEverySelection && (
              <>
                <li>
                  <a
                    href="#"
                    onClick={() => {
                      runForSelectedMods(onGoToWorkshopPageClick);
                    }}
                    className={"block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"}
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
                      runForSelectedMods(onOpenInSteam);
                    }}
                    className={"block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"}
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
                  if (selectedMods.length > 0) {
                    dispatch(toggleAlwaysEnabledMods(selectedMods.map((mod) => mod.name)));
                    onAction?.();
                  }
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
                  if (selectedMods.length > 0) {
                    dispatch(toggleAlwaysHiddenMods(selectedMods.map((mod) => mod.name)));
                    onAction?.();
                  }
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
                  runForSelectedMods(openInExplorer);
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
                  runForSelectedMods(openInRPFM);
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
                  runForSelectedMods(openInViewer);
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
            {canRenameEverySelection && (
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
                  runForSelectedMods(putPathInClipboard);
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
            {canCopyEverySelectionToData && (
              <li>
                <a
                  onClick={() => {
                    runForSelectedMods(copyModToData);
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
            {props.mod && workshopVersion && ["data", "custom"].includes(getModSourceKind(props.mod)) && (
              <li>
                <a
                  onClick={(event) => {
                    event.preventDefault();
                    if (!isComparingToWorkshop) void compareToWorkshop(props.mod!, workshopVersion);
                  }}
                  href="#"
                  aria-disabled={isComparingToWorkshop}
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <FaExchangeAlt className="w-5 h-5"></FaExchangeAlt>
                    {isComparingToWorkshop
                      ? localized.comparingToWorkshop || "Comparing to Workshop..."
                      : localized.compareToWorkshop || "Compare to Workshop"}
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
            {canUpdateEverySelection && (
              <>
                <li>
                  <a
                    onClick={() => {
                      runForSelectedMods(updateMod);
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
                      runForSelectedMods(fakeUpdatePack);
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
                  runForSelectedMods(makePackBackup);
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
            {hasWorkshopModForEverySelection && (
              <li>
                <a
                  onClick={() => {
                    runForSelectedMods(forceModDownload);
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
            {hasWorkshopModForEverySelection && (
              <li>
                <a
                  onClick={() => {
                    forceResubscribe(selectedMods);
                    onAction?.();
                  }}
                  href="#"
                  className="block py-2 px-4 hover:bg-gray-100 dark:hover:bg-gray-600 dark:hover:text-white"
                >
                  <Tooltip
                    placement="right"
                    content={
                      <div className="min-w-[10rem]">
                        {localized.forceResubscribeModTooltip ||
                          "Force Steam to unsubscribe and re-subscribe to this mod."}
                      </div>
                    }
                    style="light"
                  >
                    <span className="flex items-center gap-2">
                      <FaSync className="w-5 h-5"></FaSync>
                      {localized.forceResubscribe || "Force Resubscribe"}
                    </span>
                  </Tooltip>
                </a>
              </li>
            )}
            {hasWorkshopModForEverySelection && (
              <li>
                <a
                  onClick={() => {
                    runForSelectedMods((mod) => unsubscribe(mod, allMods));
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
            {canReMergeEverySelection && (
              <li>
                <a
                  onClick={() => {
                    runForSelectedMods(reMerge);
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
            {canDeleteDataEverySelection && (
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
                    content={
                      <div className="min-w-[10rem]">
                        {localized.deleteModTooltip || "Delete this mod from the data folder"}
                      </div>
                    }
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
            {canDeleteMergedEverySelection && (
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
                    content={
                      <div className="min-w-[10rem]">{localized.deleteModTooltip || "Delete this merged mod"}</div>
                    }
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
            {canDeleteMixedSelection && (
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
                    content={<div className="min-w-[10rem]">{localized.deleteModTooltip || "Delete this mod"}</div>}
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
