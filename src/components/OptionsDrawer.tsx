import Select, { ActionMeta, SingleValue, SingleValueProps, components } from "react-select";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  toggleAlwaysHiddenMods,
  toggleAreThumbnailsEnabled,
  toggleIsClosedOnPlay,
  toggleIsUsingEnglishLocalizations,
  toggleIsAuthorEnabled,
  toggleIsAutoStartCustomBattleEnabled,
  toggleIsScriptLoggingEnabled,
  toggleIsSkipIntroMoviesEnabled,
  toggleMakeUnitsGenerals,
  toggleIsChangingGameProcessPriority,
  toggleIsFeaturesForModdersEnabled,
  setModdersPrefix,
  setIsCreateSteamCollectionOpen,
  setIsImportSteamCollectionOpen,
  setDataModsToEnableByName,
  createBisectedModListPresets,
  toggleIsCompatCheckingVanillaPacks,
  setIsPackSearcherOpen,
  setSkillTreesDisplayMode,
  setTechnologyTreesDisplayMode,
  setAppFolderPaths,
} from "../appSlice";
import Drawer from "./Drawer";
import { useAppDispatch, useAppSelector } from "../hooks";
import selectStyle from "../styles/selectStyle";
import { Tooltip } from "flowbite-react";
import { Modal, Select as FormSelect } from "../flowbite";
import ShareMods from "./ShareMods";
import { useSelector } from "react-redux";
import { createSelector } from "@reduxjs/toolkit";
import GamePathsSetup from "./GamePathsSetup";
import AboutScreen from "./AboutScreen";
import CreateSteamCollection from "./CreateSteamCollection";
import ImportSteamCollection from "./ImportSteamCollection";
import { useLocalizations } from "../localizationContext";
import ISO6391 from "iso-639-1";
import { gameToSupportedGameOptions, supportedGames } from "../supportedGames";
import store from "../store";
import PackSearcher from "./PackSearcher";
import {
  DATA_MOD_SOURCE_ID,
  getModSourceId,
  insertCustomSourceAfterData,
  normalizeModSourceOrder,
  isWorkshopMod,
  WORKSHOP_MOD_SOURCE_ID,
} from "../modSources";
import { selectConfigSavePayload } from "../config/configSavePayload";

const cleanData = () => {
  window.api?.cleanData();
};

const cleanSymbolicLinksInData = () => {
  window.api?.cleanSymbolicLinksInData();
};

const exportModNamesToClipboard = (enabledMods: Mod[]) => {
  window.api?.exportModNamesToClipboard(enabledMods);
};

type OptionType = {
  value: string;
  label: string;
};

const gameToImageSrc = supportedGames.reduce(
  (acc, currentGame) => {
    acc[currentGame as string] = require(`../assets/game_icons/${currentGame}.png`);
    return acc;
  },
  {} as Record<string, string>,
);

const OptionsDrawer = memo(() => {
  const [isShowingShareMods, setIsShowingShareMods] = useState<boolean>(false);
  const [isShowingSetFolderPaths, setIsShowingSetFolderPaths] = useState<boolean>(false);
  const [isShowingAboutScreen, setIsShowingAboutScreen] = useState<boolean>(false);
  const [isForceResubscribeConfirmOpen, setIsForceResubscribeConfirmOpen] = useState(false);
  const [modsToForceResubscribe, setModsToForceResubscribe] = useState<Mod[]>([]);
  const [modFolderMessage, setModFolderMessage] = useState("");
  const [logPathStatus, setLogPathStatus] = useState<{ message: string; isError: boolean }>();
  const [customFolderStatuses, setCustomFolderStatuses] = useState<Record<string, boolean>>({});
  const [syncingCustomFolderId, setSyncingCustomFolderId] = useState<string>();
  const [pendingCustomFolderCopy, setPendingCustomFolderCopy] = useState<{
    destinationPath: string;
    modPaths: string[];
    conflicts: string[];
  } | null>(null);

  const dispatch = useAppDispatch();
  const hiddenModNames = useAppSelector((state) => state.app.hiddenModNames);
  const areThumbnailsEnabled = useAppSelector((state) => state.app.areThumbnailsEnabled);
  const isClosedOnPlay = useAppSelector((state) => state.app.isClosedOnPlay);
  const isUsingEnglishLocalizations = useAppSelector((state) => state.app.isUsingEnglishLocalizations);
  const isCompatCheckingVanillaPacks = useAppSelector((state) => state.app.isCompatCheckingVanillaPacks);
  const isAuthorEnabled = useAppSelector((state) => state.app.isAuthorEnabled);
  const isMakeUnitsGeneralsEnabled = useAppSelector((state) => state.app.isMakeUnitsGeneralsEnabled);
  const isScriptLoggingEnabled = useAppSelector((state) => state.app.isScriptLoggingEnabled);
  const isSkipIntroMoviesEnabled = useAppSelector((state) => state.app.isSkipIntroMoviesEnabled);
  const isAutoStartCustomBattleEnabled = useAppSelector((state) => state.app.isAutoStartCustomBattleEnabled);
  const isChangingGameProcessPriority = useAppSelector((state) => state.app.isChangingGameProcessPriority);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const moddersPrefix = useAppSelector((state) => state.app.moddersPrefix);
  const skillTreesDisplayMode = useAppSelector((state) => state.app.skillTreesDisplayMode);
  const technologyTreesDisplayMode = useAppSelector((state) => state.app.technologyTreesDisplayMode);
  const isDev = useAppSelector((state) => state.app.isDev);
  const isAdmin = useAppSelector((state) => state.app.isAdmin);
  const dataModsToEnableByName = useAppSelector((state) => state.app.dataModsToEnableByName);
  const availableLanguages = useAppSelector((state) => state.app.availableLanguages);
  const currentLanguage = useAppSelector((state) => state.app.currentLanguage);
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const currentMods = useAppSelector((state) => state.app.currentPreset.mods);
  const allMods = useAppSelector((state) => state.app.allMods);
  const appFolderPaths = useAppSelector((state) => state.app.appFolderPaths);

  const localized = useLocalizations();

  const enabledModsSelector = createSelector(
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (mods: Mod[]) => mods.filter((iterMod) => iterMod.isEnabled),
  );
  const enabledMods = useSelector(enabledModsSelector);
  const workshopMods = useMemo(() => allMods.filter(isWorkshopMod), [allMods]);
  const customModFolders = useMemo(() => appFolderPaths.customModFolders || [], [appFolderPaths.customModFolders]);
  const modSourceOrder = useMemo(
    () => normalizeModSourceOrder(appFolderPaths, isFeaturesForModdersEnabled),
    [appFolderPaths, isFeaturesForModdersEnabled],
  );
  const activeModCountBySourceId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mod of currentMods) {
      const sourceId = getModSourceId(mod);
      counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
    }
    return counts;
  }, [currentMods]);

  useEffect(() => {
    window.api?.getCustomModFolderStatuses(customModFolders.map((folder) => folder.path)).then(setCustomFolderStatuses);
  }, [customModFolders]);

  const updateCustomModSources = useCallback(
    async (folders: CustomModFolder[], sourceOrder: string[]) => {
      const result = await window.api?.updateCustomModSources({
        game: currentGame,
        customModFolders: folders,
        modSourceOrder: sourceOrder,
      });
      if (!result?.success || !result.folderPaths) {
        setModFolderMessage(result?.error || "Failed to update mod folders.");
        return false;
      }
      dispatch(setAppFolderPaths(result.folderPaths));
      setModFolderMessage("");
      return true;
    },
    [currentGame, dispatch],
  );

  const addCustomModFolder = useCallback(async () => {
    const folderPath = await window.api?.selectDirectory();
    if (!folderPath) return;
    const sourceId = `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nextFolders = [...customModFolders, { id: sourceId, path: folderPath }];
    const nextOrder = insertCustomSourceAfterData(modSourceOrder, sourceId);
    await updateCustomModSources(nextFolders, nextOrder);
  }, [customModFolders, modSourceOrder, updateCustomModSources]);

  const removeCustomModFolder = useCallback(
    async (sourceId: string) => {
      await updateCustomModSources(
        customModFolders.filter((folder) => folder.id !== sourceId),
        modSourceOrder.filter((iterSourceId) => iterSourceId !== sourceId),
      );
    },
    [customModFolders, modSourceOrder, updateCustomModSources],
  );

  const moveModSource = useCallback(
    async (sourceId: string, offset: -1 | 1) => {
      const currentIndex = modSourceOrder.indexOf(sourceId);
      const targetIndex = currentIndex + offset;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= modSourceOrder.length) return;
      const nextOrder = [...modSourceOrder];
      [nextOrder[currentIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[currentIndex]];
      await updateCustomModSources(customModFolders, nextOrder);
    },
    [customModFolders, modSourceOrder, updateCustomModSources],
  );

  const finishCustomFolderCopy = useCallback(
    async (destinationPath: string, modPaths: string[], overwrite: boolean) => {
      const result = await window.api?.copyModsToNewCustomFolder({ destinationPath, modPaths, overwrite });
      if (result?.requiresConfirmation && result.conflicts) {
        setPendingCustomFolderCopy({ destinationPath, modPaths, conflicts: result.conflicts });
        return;
      }
      setPendingCustomFolderCopy(null);
      if (!result?.success) {
        setModFolderMessage(result?.error || "Failed to copy mods.");
        return;
      }
      if (result.folderPaths) dispatch(setAppFolderPaths(result.folderPaths));
      const failureSuffix = result.failed?.length ? ` ${result.failed.length} file(s) failed.` : "";
      setModFolderMessage(`Copied ${result.copied?.length || 0} mod(s).${failureSuffix}`);
    },
    [dispatch],
  );

  const copyModsToNewCustomFolder = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const modsToCopy = event.shiftKey ? currentMods : enabledMods;
      if (modsToCopy.length === 0) {
        setModFolderMessage("No mods selected to copy.");
        return;
      }
      const destinationPath = await window.api?.selectDirectory();
      if (!destinationPath) return;
      await finishCustomFolderCopy(
        destinationPath,
        modsToCopy.map((mod) => mod.path),
        false,
      );
    },
    [currentMods, enabledMods, finishCustomFolderCopy],
  );

  const syncWorkshopModsToCustomFolder = useCallback(
    async (customSourceId: string) => {
      setSyncingCustomFolderId(customSourceId);
      setModFolderMessage("");
      try {
        const result = await window.api?.syncWorkshopModsToCustomFolder({
          customSourceId,
          enabledWorkshopModNames: enabledMods.filter(isWorkshopMod).map((mod) => mod.name),
        });
        if (!result?.success) {
          setModFolderMessage(result?.error || "Failed to update the custom mod folder.");
          return;
        }

        const updatedCount = result.updated?.length || 0;
        const addedCount = result.added?.length || 0;
        const failedCount = result.failed?.length || 0;
        const failureSuffix = failedCount ? ` ${failedCount} file(s) failed.` : "";
        setModFolderMessage(
          updatedCount === 0 && addedCount === 0
            ? failedCount > 0
              ? `Failed to copy ${failedCount} Workshop file(s).`
              : "No Workshop updates or newly enabled Workshop mods were found."
            : `Updated ${updatedCount} and added ${addedCount} Workshop mod(s).${failureSuffix}`,
        );
      } finally {
        setSyncingCustomFolderId(undefined);
      }
    },
    [enabledMods],
  );

  // hidden mods are stored as names, so the label comes from the installed mod when we still have it
  const hiddenModsToOptionViewDataSelector = createSelector(
    (state: { app: AppState }) => state.app.hiddenModNames,
    (state: { app: AppState }) => state.app.currentPreset.mods,
    (names, mods) => {
      const humanNamesByName = new Map(mods.map((mod) => [mod.name, mod.humanName]));
      return names.map((name) => ({ value: name, label: humanNamesByName.get(name) || name }));
    },
  );
  const options: OptionType[] = useSelector(hiddenModsToOptionViewDataSelector);

  const availableLanguagesToOptionsSelector = createSelector(
    (state: { app: AppState }) => state.app.availableLanguages,
    (availableLanguages) =>
      availableLanguages
        .map((language) => {
          return { value: language, label: ISO6391.getName(language) };
        })
        .toSorted((a, b) => {
          return a.label.localeCompare(b.label);
        }),
  );
  const languageOptions = useSelector(availableLanguagesToOptionsSelector);

  const availableGames = supportedGames.map((gameKey) => ({ value: gameKey, label: localized[gameKey] }) as OptionType);

  const [areOptionsOpen, setAreOptionsOpen] = useState(false);

  const treeDisplayModeOptions: { value: TreeDisplayMode; label: string }[] = [
    { value: "off", label: localized.off || "Off" },
    { value: "tab", label: localized.tab || "Tab" },
    { value: "window", label: localized.window || "Window" },
  ];

  const forceDownloadMods = useCallback((contentModsWorshopIds: string[]) => {
    window.api?.forceDownloadMods(contentModsWorshopIds);
  }, []);

  const forceResubscribeMods = useCallback((mods: Mod[]) => {
    window.api?.forceResubscribeMods(mods);
  }, []);

  const openForceResubscribeConfirm = useCallback((mods: Mod[]) => {
    setModsToForceResubscribe(mods);
    setIsForceResubscribeConfirmOpen(true);
  }, []);

  const closeForceResubscribeConfirm = useCallback(() => {
    setIsForceResubscribeConfirmOpen(false);
    setModsToForceResubscribe([]);
  }, []);

  const confirmForceResubscribe = useCallback(() => {
    forceResubscribeMods(modsToForceResubscribe);
    closeForceResubscribeConfirm();
  }, [closeForceResubscribeConfirm, forceResubscribeMods, modsToForceResubscribe]);

  const openCreateSteamCollectionFromConfirm = useCallback(() => {
    closeForceResubscribeConfirm();
    dispatch(setIsCreateSteamCollectionOpen(true));
  }, [closeForceResubscribeConfirm, dispatch]);

  const openDiagnosticPath = useCallback(
    async (target: DiagnosticPathTarget, copyPath: boolean) => {
      const result = await window.api?.openDiagnosticPath(target, copyPath);
      if (!result) {
        setLogPathStatus({ message: "Log tools are unavailable.", isError: true });
        return;
      }
      if (!result.success) {
        setLogPathStatus({ message: result.error || "Could not open the requested path.", isError: true });
        return;
      }
      setLogPathStatus(
        copyPath
          ? {
              message: (localized.logPathCopied || "Path copied to clipboard: {{path}}").replace(
                "{{path}}",
                result.path || "",
              ),
              isError: false,
            }
          : undefined,
      );
    },
    [localized.logPathCopied],
  );

  const onDeleteChange = useCallback(
    (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
      if (!newValue) return;
      console.log(newValue.label, newValue.value, actionMeta.action);
      if (!hiddenModNames.includes(newValue.value)) return;
      if (actionMeta.action === "select-option") dispatch(toggleAlwaysHiddenMods([newValue.value]));
    },
    [hiddenModNames, dispatch],
  );

  const onGameChange = useCallback(
    (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
      if (!newValue) return;
      console.log(newValue.label, newValue.value, actionMeta.action);
      const game = supportedGames.find((game) => game == newValue.value);
      if (!game) return;
      if (actionMeta.action === "select-option") {
        window.api?.requestGameChange(game, selectConfigSavePayload(store.getState().app));
      }
    },
    [supportedGames],
  );

  const onLanguageChange = useCallback(
    (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
      if (!newValue) return;
      console.log(newValue.label, newValue.value, actionMeta.action);
      const language = availableLanguages.find((language) => language == newValue.value);
      if (!language) return;
      if (actionMeta.action === "select-option") {
        window.api?.requestLanguageChange(language);
      }
    },
    [availableLanguages],
  );

  const copyToData = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      if (e.shiftKey) {
        window.api?.copyToData();
      } else {
        window.api?.copyToData(enabledMods.map((mod) => mod.path));
      }
    },
    [enabledMods],
  );

  const bisectModList = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>, isModSelectionRandom = false) => {
      dispatch(
        createBisectedModListPresets({
          isRandom: isModSelectionRandom,
          ignoreDependencies: e.shiftKey,
        }),
      );
    },
    [dispatch],
  );

  const copyToDataAsSymbolicLink = useCallback(
    (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      if (e.shiftKey) {
        window.api?.copyToDataAsSymbolicLink();
      } else {
        window.api?.copyToDataAsSymbolicLink(enabledMods.map((mod) => mod.path));
        dispatch(setDataModsToEnableByName([...dataModsToEnableByName, ...enabledMods.map((mod) => mod.name)]));
      }
    },
    [enabledMods],
  );

  const SingleValue = ({ children, ...props }: SingleValueProps<OptionType, false>) => (
    <components.SingleValue {...props}>
      <img className="mt-[5px]" src={gameToImageSrc[props.data.value]} />
    </components.SingleValue>
  );

  return (
    <div>
      <GamePathsSetup isOpen={isShowingSetFolderPaths} setIsOpen={setIsShowingSetFolderPaths}></GamePathsSetup>
      <AboutScreen isOpen={isShowingAboutScreen} setIsOpen={setIsShowingAboutScreen}></AboutScreen>
      <ShareMods isOpen={isShowingShareMods} setIsOpen={setIsShowingShareMods} />
      <CreateSteamCollection />
      <ImportSteamCollection />
      <PackSearcher />
      <Modal show={isForceResubscribeConfirmOpen} onClose={closeForceResubscribeConfirm} size="lg" position="center">
        <Modal.Header>{localized.forceResubscribe}</Modal.Header>
        <Modal.Body>
          <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
            {localized.forceResubscribeBackupRecommendation}
          </p>
        </Modal.Body>
        <Modal.Footer>
          <button
            className="px-4 py-2 bg-gray-500 text-white font-medium text-sm rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
            onClick={closeForceResubscribeConfirm}
          >
            {localized.cancel}
          </button>
          <button
            className="px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={openCreateSteamCollectionFromConfirm}
          >
            {localized.createSteamCollection}
          </button>
          <button
            className="px-4 py-2 bg-purple-600 text-white font-medium text-sm rounded hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
            onClick={confirmForceResubscribe}
          >
            {localized.forceResubscribeContinue}
          </button>
        </Modal.Footer>
      </Modal>
      <Modal
        show={!!pendingCustomFolderCopy}
        onClose={() => setPendingCustomFolderCopy(null)}
        size="lg"
        position="center"
      >
        <Modal.Header>{localized.overwriteMods || "Overwrite existing mods?"}</Modal.Header>
        <Modal.Body>
          <p className="text-sm text-gray-300">
            {(
              localized.customFolderCopyConflicts || "The destination already contains {{count}} matching pack(s)."
            ).replace("{{count}}", String(pendingCustomFolderCopy?.conflicts.length || 0))}
          </p>
          <div className="mt-2 max-h-40 overflow-auto text-xs text-gray-400">
            {pendingCustomFolderCopy?.conflicts.join(", ")}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500"
            onClick={() => setPendingCustomFolderCopy(null)}
          >
            {localized.cancel || "Cancel"}
          </button>
          <button
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            onClick={() => {
              if (!pendingCustomFolderCopy) return;
              finishCustomFolderCopy(pendingCustomFolderCopy.destinationPath, pendingCustomFolderCopy.modPaths, true);
            }}
          >
            {localized.overwrite || "Overwrite"}
          </button>
        </Modal.Footer>
      </Modal>

      <div className="text-center">
        <button
          onClick={() => setAreOptionsOpen(!areOptionsOpen)}
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
          aria-controls="drawer-example"
        >
          {localized.otherOptions}
        </button>
      </div>

      {areOptionsOpen && (
        <Drawer isOpen={areOptionsOpen} setIsOpen={setAreOptionsOpen}>
          <div
            id="drawer-example"
            className="overflow-y-scroll fixed z-40 p-4 w-full h-screen bg-white dark:bg-gray-800 transition-transform left-[-16px] top-0 transform-none scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700"
            tabIndex={-1}
            aria-labelledby="drawer-label"
            aria-modal="true"
            role="dialog"
          >
            <h5
              id="drawer-label"
              className="inline-flex items-center mb-4 text-base font-semibold text-gray-500 dark:text-gray-400 mt-6 cursor-default"
            >
              {localized.otherOptions}
            </h5>

            <div className="flex justify-center relative">
              <div className="absolute flex font-normal text-lg items-center bg-gray-800 justify-center w-[5.5rem] h-6 top-[-12px] rounded mt-[-0.05rem] cursor-default">
                {localized.Game}
                <span className="text-xs pl-2">▼</span>
              </div>
              <div className="rounded border border-slate-400 h-32 w-32 flex justify-center items-center">
                <Select
                  className="aspect-square m-2 mt-5 cursor-pointer"
                  id="gameSelect"
                  options={availableGames}
                  styles={selectStyle}
                  onChange={onGameChange}
                  isClearable={false}
                  isSearchable={false}
                  components={{ SingleValue, DropdownIndicator: null }}
                  value={{ value: currentGame, label: currentGame } as OptionType}
                ></Select>
              </div>
            </div>

            <div className="flex mt-8">
              <button
                className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[50%]"
                onClick={() => setIsShowingAboutScreen(true)}
              >
                <span className="uppercase">{localized.about}</span>
              </button>
            </div>

            <div className="flex justify-center items-center mt-6">
              <label className="" htmlFor="languageSelect">
                {localized.language}
              </label>
              <Select
                className="ml-2"
                id="languageSelect"
                options={languageOptions}
                styles={selectStyle}
                onChange={onLanguageChange}
                isClearable={false}
                isSearchable={false}
                defaultValue={{
                  value: currentLanguage as string,
                  label: ISO6391.getName(currentLanguage as string),
                }}
              ></Select>
            </div>

            <section className="mt-8 rounded border border-gray-600 p-4">
              <h6>{localized.applicationLogs || "Application Logs"}</h6>
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                {localized.applicationLogsHelp ||
                  "Open application diagnostics. Hold Shift while clicking to copy the path instead."}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="flex-1 rounded bg-purple-600 px-4 py-2 text-xs font-medium uppercase text-white hover:bg-purple-700"
                  onClick={(event) => void openDiagnosticPath("appLogFile", event.shiftKey)}
                >
                  {localized.openMainLog || "Open main.log"}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-purple-600 px-4 py-2 text-xs font-medium uppercase text-white hover:bg-purple-700"
                  onClick={(event) => void openDiagnosticPath("appLogsFolder", event.shiftKey)}
                >
                  {localized.openLogsFolder || "Open Logs Folder"}
                </button>
              </div>
            </section>

            <section className="mt-6 rounded border border-gray-600 p-4">
              <h6>{localized.gameLogs || "Game Logs"}</h6>
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                {localized.gameLogsHelp ||
                  "Open the newest script_log_* file from the configured game folder. Hold Shift to copy its path instead."}
              </p>
              <button
                type="button"
                disabled={!appFolderPaths.gamePath}
                className="w-full rounded bg-purple-600 px-4 py-2 text-xs font-medium uppercase text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={(event) => void openDiagnosticPath("latestGameScriptLog", event.shiftKey)}
              >
                {localized.openLatestGameLog || "Open Latest Script Log"}
              </button>
            </section>

            {logPathStatus && (
              <p
                className={`mt-3 break-all text-sm ${logPathStatus.isError ? "text-red-400" : "text-green-400"}`}
                role={logPathStatus.isError ? "alert" : "status"}
              >
                {logPathStatus.message}
              </p>
            )}

            <div className="flex items-center ml-1 mt-6">
              <input
                className="mt-1"
                type="checkbox"
                id="enable-closed-on-play"
                checked={!!isClosedOnPlay}
                onChange={() => dispatch(toggleIsClosedOnPlay())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="enable-closed-on-play">
                {localized.closeOnPlay}
              </label>
            </div>

            <div className="flex items-center ml-1 mt-4">
              <input
                className="mt-1"
                type="checkbox"
                id="use-english-localizations"
                checked={!!isUsingEnglishLocalizations}
                onChange={() => dispatch(toggleIsUsingEnglishLocalizations())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="use-english-localizations">
                {localized.useEnglishLocalizations || "Use English Localizations"}
              </label>
            </div>
            <p className="ml-1 mt-1 text-sm text-gray-500 dark:text-gray-400">
              {localized.useEnglishLocalizationsHelp ||
                "Read the game's English text even when the manager is set to another language."}
            </p>

            <h6 className="mt-6">{localized.extraColumns}</h6>
            <div className="flex items-center ml-1">
              <input
                className="mt-1"
                type="checkbox"
                id="enable-thumbnails"
                checked={!!areThumbnailsEnabled}
                onChange={() => dispatch(toggleAreThumbnailsEnabled())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="enable-thumbnails">
                {localized.modThumbnailColumn}
              </label>
            </div>

            <div className="flex items-center ml-1">
              <input
                className="mt-1"
                type="checkbox"
                id="enable-mod-author"
                checked={!!isAuthorEnabled}
                onChange={() => dispatch(toggleIsAuthorEnabled())}
              ></input>
              <label className="ml-2 mt-1" htmlFor="enable-mod-author">
                {localized.modAuthorColumn}
              </label>
            </div>

            <h6 className="mt-10">{localized.forceReDownload}</h6>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{localized.forceDownloadMsg}</p>

            <div className="flex mt-2">
              <button
                className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={(e) => {
                  const modIds = (
                    e.shiftKey
                      ? workshopMods
                      : workshopMods.filter((mod) => enabledMods.some((enabledMod) => enabledMod.name === mod.name))
                  ).map((mod) => mod.workshopId);
                  forceDownloadMods(modIds);
                }}
              >
                <span className="uppercase">{localized.forceReDownload}</span>
              </button>
            </div>

            <h6 className="mt-10">{localized.forceResubscribe}</h6>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{localized.forceResubscribeMsg}</p>

            <div className="flex mt-2">
              <button
                className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={(e) => {
                  const mods = e.shiftKey
                    ? workshopMods
                    : workshopMods.filter((mod) => enabledMods.some((enabledMod) => enabledMod.name === mod.name));
                  openForceResubscribeConfirm(mods);
                }}
              >
                <span className="uppercase">{localized.forceResubscribe}</span>
              </button>
            </div>

            <h6 className="mt-8">{localized.modFolders || "Mod Folders"}</h6>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
              {localized.modFoldersHelp ||
                "Add folders containing pack files and order them from highest to lowest priority."}
            </p>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
              {localized.modFolderPriorityHelp ||
                "Priority: If a mod exists in multiple folders, the copy from the highest-priority folder is used."}
            </p>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
              {localized.customModFoldersVersionHelp ||
                "Tip: Copy enabled mods to a higher-priority custom folder to keep those exact versions. Workshop updates will not replace the active custom copies; use Update when you want to refresh them."}
            </p>
            <div className="space-y-2">
              {modSourceOrder.map((sourceId, index) => {
                const customFolder = customModFolders.find((folder) => folder.id === sourceId);
                const isBuiltIn = sourceId === DATA_MOD_SOURCE_ID || sourceId === WORKSHOP_MOD_SOURCE_ID;
                const canMoveSource = !isBuiltIn || isFeaturesForModdersEnabled;
                const label =
                  sourceId === DATA_MOD_SOURCE_ID
                    ? localized.dataFolder || "Data"
                    : sourceId === WORKSHOP_MOD_SOURCE_ID
                      ? localized.workshop || "Workshop"
                      : customFolder?.path.split(/[\\/]/).filter(Boolean).pop() || "Custom folder";
                const sourcePath =
                  sourceId === DATA_MOD_SOURCE_ID
                    ? appFolderPaths.dataFolder
                    : sourceId === WORKSHOP_MOD_SOURCE_ID
                      ? appFolderPaths.contentFolder
                      : customFolder?.path;
                const isMissing = customFolder ? customFolderStatuses[customFolder.path] === false : false;
                return (
                  <div key={sourceId} className="rounded border border-gray-600 bg-gray-900/40 p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-xs text-gray-400">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-gray-200">
                          {label}
                          {isMissing && (
                            <span className="ml-2 text-xs text-red-400">{localized.missing || "Missing"}</span>
                          )}
                        </div>
                        {sourcePath && !isMissing ? (
                          <button
                            type="button"
                            className="block w-full truncate text-left text-xs text-gray-500 hover:text-gray-300 hover:underline focus:text-gray-300 focus:underline focus:outline-none"
                            title={sourcePath}
                            onClick={() => window.api?.openDirectoryInExplorer(sourcePath)}
                          >
                            {sourcePath}
                          </button>
                        ) : (
                          <div className="truncate text-xs text-gray-500" title={sourcePath || ""}>
                            {sourcePath || "—"}
                          </div>
                        )}
                        {customFolder && (
                          <div
                            className="mt-1 text-xs text-gray-400"
                            title="Mods currently selected from this folder by source priority."
                          >
                            {(localized.activeModsFromFolder || "Active mods: {{count}}").replace(
                              "{{count}}",
                              String(activeModCountBySourceId.get(sourceId) || 0),
                            )}
                          </div>
                        )}
                      </div>
                      {canMoveSource && (
                        <>
                          <button
                            type="button"
                            aria-label={`Move ${label} up`}
                            disabled={index === 0}
                            onClick={() => moveModSource(sourceId, -1)}
                            className="px-2 py-1 text-gray-300 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${label} down`}
                            disabled={index === modSourceOrder.length - 1}
                            onClick={() => moveModSource(sourceId, 1)}
                            className="px-2 py-1 text-gray-300 disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </>
                      )}
                      {customFolder && (
                        <>
                          <button
                            type="button"
                            disabled={isMissing || syncingCustomFolderId !== undefined}
                            title={
                              localized.updateCustomFolderFromWorkshopHelp ||
                              "Copies newer Workshop versions already in this folder and adds enabled Workshop mods."
                            }
                            onClick={() => syncWorkshopModsToCustomFolder(sourceId)}
                            className="px-2 py-1 text-xs text-purple-300 hover:text-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {syncingCustomFolderId === sourceId
                              ? localized.updating || "Updating…"
                              : localized.update || "Update"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCustomModFolder(sourceId)}
                            className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                          >
                            {localized.remove || "Remove"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {modFolderMessage && <p className="mt-2 text-sm text-gray-300">{modFolderMessage}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={addCustomModFolder}
                className="flex-1 rounded bg-purple-600 px-3 py-2 text-xs font-medium uppercase text-white hover:bg-purple-700"
              >
                {localized.addModFolder || "Add Folder"}
              </button>
              <button
                type="button"
                onClick={copyModsToNewCustomFolder}
                title={localized.copyModsToFolderHelp || "Copies enabled mods; hold Shift to copy all mods."}
                className="flex-1 rounded bg-purple-600 px-3 py-2 text-xs font-medium uppercase text-white hover:bg-purple-700"
              >
                {localized.copyModsToFolder || "Copy Mods to New Folder"}
              </button>
            </div>

            <h6 className="mt-8">{localized.contentVsData}</h6>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{localized.contentVsDataMsg}</p>

            <div className="flex mt-2">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={(e) => copyToData(e)}
              >
                <Tooltip
                  placement="top"
                  style="light"
                  content={
                    <>
                      <div>{localized.copyToDataMsg1}</div>
                      <div>{localized.copyToDataMsg2}</div>
                      <div>{localized.copyToDataMsg3}</div>
                      <div>{localized.copyToDataMsg4}</div>
                    </>
                  }
                >
                  <span className="uppercase">{localized.copyToData}</span>
                </Tooltip>
              </button>
            </div>

            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => cleanData()}
              >
                <Tooltip placement="bottom" style="light" content={localized.cleanDataMsg}>
                  <span className="uppercase">{localized.cleanData}</span>
                </Tooltip>
              </button>
            </div>

            <p className="mt-6 mb-4 text-sm text-gray-500 dark:text-gray-400">{localized.symLink}</p>

            <div className="flex mt-2">
              <button
                className={
                  "make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%] " +
                  ((!isAdmin &&
                    "bg-opacity-50 hover:bg-opacity-50 text-opacity-50 hover:text-opacity-50 cursor-not-allowed") ||
                    "")
                }
                onClick={(e) => copyToDataAsSymbolicLink(e)}
                disabled={!isAdmin && !isDev}
              >
                <Tooltip
                  placement="top"
                  style="light"
                  content={
                    <>
                      {!isAdmin && <div className="text-red-700 font-bold">{localized.reqAdmin}</div>}
                      <div>{localized.symLinkMsg1}</div>
                      <div>{localized.symLinkMsg2}</div>
                      <div>{localized.symLinkMsg3}</div>
                      <div>{localized.symLinkMsg4}</div>
                    </>
                  }
                >
                  <span className="uppercase">{localized.createSymLinks}</span>
                </Tooltip>
              </button>
            </div>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => cleanSymbolicLinksInData()}
              >
                <Tooltip placement="bottom" style="light" content={localized.cleanSymLinksMsg}>
                  <span className="uppercase">{localized.cleanSymLinks}</span>
                </Tooltip>
              </button>
            </div>

            <h6 className="mt-10">{localized.hiddenMods}</h6>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{localized.unhideMods}</p>

            <div>
              <Select options={options} styles={selectStyle} onChange={onDeleteChange} value={null}></Select>
            </div>

            <h6 className="mt-10">{localized.shareMods}</h6>
            <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{localized.shareModsMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => setIsShowingShareMods(true)}
              >
                <span className="uppercase">{localized.shareModLists}</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{localized.copyModNames}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => exportModNamesToClipboard(enabledMods)}
              >
                <span className="uppercase">{localized.copyModList}</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{localized.createSteamCollectionMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => dispatch(setIsCreateSteamCollectionOpen(true))}
              >
                <span className="uppercase">{localized.createSteamCollection}</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{localized.importSteamCollectionOptionsMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => dispatch(setIsImportSteamCollectionOpen(true))}
              >
                <span className="uppercase">{localized.importSteamCollection}</span>
              </button>
            </div>

            {gameToSupportedGameOptions[currentGame].length > 0 && (
              <>
                <h6 className="mt-10">{localized.forModders}</h6>
                <p className="mb-1 text-sm text-gray-500 dark:text-red-500">{localized.keepInSync}</p>
                {gameToSupportedGameOptions[currentGame].includes("MakeUnitsGenerals") && (
                  <div className="flex items-center ml-1 mt-2">
                    <input
                      className=""
                      type="checkbox"
                      id="make-general-units"
                      checked={!!isMakeUnitsGeneralsEnabled}
                      onChange={() => dispatch(toggleMakeUnitsGenerals())}
                    ></input>
                    <label className="ml-2" htmlFor="make-general-units">
                      <Tooltip
                        placement="left"
                        style="light"
                        content={
                          <>
                            <div>{localized.forCustomBattleTesting}</div>
                          </>
                        }
                      >
                        {localized.makeCustomBattleGenerals}
                      </Tooltip>
                    </label>
                  </div>
                )}
                {gameToSupportedGameOptions[currentGame].includes("ScriptLogging") && (
                  <div className="flex items-center ml-1 mt-2">
                    <input
                      className=""
                      type="checkbox"
                      id="toggle-script-logging"
                      checked={!!isScriptLoggingEnabled}
                      onChange={() => dispatch(toggleIsScriptLoggingEnabled())}
                    ></input>
                    <label className="ml-2" htmlFor="toggle-script-logging">
                      <Tooltip
                        placement="left"
                        style="light"
                        content={
                          <>
                            <div>{localized.enableScriptLogging1}</div>
                            <div>{localized.enableScriptLogging2}</div>
                          </>
                        }
                      >
                        {localized.enableScriptLogging}
                      </Tooltip>
                    </label>
                  </div>
                )}
                {gameToSupportedGameOptions[currentGame].includes("SkipIntroMovies") && (
                  <div className="flex items-center ml-1 mt-2">
                    <input
                      className=""
                      type="checkbox"
                      id="toggle-intro-movies"
                      checked={!!isSkipIntroMoviesEnabled}
                      onChange={() => dispatch(toggleIsSkipIntroMoviesEnabled())}
                    ></input>
                    <label className="ml-2" htmlFor="toggle-intro-movies">
                      {localized.skipIntroMovies}
                    </label>
                  </div>
                )}
                {gameToSupportedGameOptions[currentGame].includes("AutoStartCustomBattle") && (
                  <div className="flex items-center ml-1 mt-2">
                    <input
                      className=""
                      type="checkbox"
                      id="toggleIsAutoStartCustomBattleEnabled"
                      checked={!!isAutoStartCustomBattleEnabled}
                      onChange={() => dispatch(toggleIsAutoStartCustomBattleEnabled())}
                    ></input>
                    <label className="ml-2" htmlFor="toggleIsAutoStartCustomBattleEnabled">
                      <Tooltip
                        placement="bottom"
                        style="light"
                        content={
                          <>
                            <div>{localized.autoStartCustomBattles1}</div>
                            <div>{localized.autoStartCustomBattles2}</div>
                          </>
                        }
                      >
                        {localized.autoStartCustomBattles}
                      </Tooltip>
                    </label>
                  </div>
                )}
                <div className="flex items-center ml-1 mt-2">
                  <input
                    className=""
                    type="checkbox"
                    id="toggleIsChangingGameProcessPriority"
                    checked={!!isChangingGameProcessPriority}
                    onChange={() => dispatch(toggleIsChangingGameProcessPriority())}
                  ></input>
                  <label className="ml-2" htmlFor="toggleIsChangingGameProcessPriority">
                    <Tooltip
                      placement="bottom"
                      style="light"
                      content={
                        <>
                          <div>{localized.changeGameProcessPriority1}</div>
                          <div>{localized.changeGameProcessPriority2}</div>
                        </>
                      }
                    >
                      {localized.changeGameProcessPriority}
                    </Tooltip>
                  </label>
                </div>
                <div className="flex items-center ml-1 mt-2">
                  <input
                    className=""
                    type="checkbox"
                    id="toggleIsFeaturesForModdersEnabled"
                    checked={!!isFeaturesForModdersEnabled}
                    onChange={() => {
                      dispatch(toggleIsFeaturesForModdersEnabled());
                      const newValue = !isFeaturesForModdersEnabled;
                      window.api?.syncIsFeaturesForModdersEnabled(newValue);
                    }}
                  ></input>
                  <label className="ml-2" htmlFor="toggleIsFeaturesForModdersEnabled">
                    <Tooltip
                      placement="bottom"
                      style="light"
                      content={
                        <>
                          <div>
                            {localized.featuresForModdersHelp ||
                              "Enables features inside the Mod Manager intended for modders."}
                          </div>
                        </>
                      }
                    >
                      {localized.featuresForModders || "Features For Modders"}
                    </Tooltip>
                  </label>
                </div>
                {isFeaturesForModdersEnabled && (
                  <div className="ml-7 mt-3">
                    <label
                      className="block text-sm font-medium text-gray-900 dark:text-gray-100"
                      htmlFor="moddersPrefix"
                    >
                      {localized.prefixForModders || "Prefix For Modders"}
                    </label>
                    <input
                      id="moddersPrefix"
                      type="text"
                      value={moddersPrefix}
                      onChange={(event) => {
                        dispatch(setModdersPrefix(event.target.value));
                        window.api?.syncModdersPrefix(event.target.value);
                      }}
                      className="mt-2 block w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                    <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
                      {localized.prefixForModdersDescription ||
                        "Use this prefix as default when auto-generating database keys and table names."}
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="mt-4 max-w-md">
              <div className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                {localized.treeDisplayModes || "Tree Display"}
              </div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {localized.treeDisplayModesDescription ||
                  "Choose whether Skill Trees and Tech Trees appear as tabs, standalone windows, or not at all."}
              </p>
              <div className="mt-3 grid gap-3">
                <label className="block text-sm text-gray-900 dark:text-gray-100" htmlFor="skillTreesDisplayMode">
                  {localized.skillTrees || "Skill Trees"}
                </label>
                <FormSelect
                  id="skillTreesDisplayMode"
                  value={skillTreesDisplayMode}
                  onChange={(event) => dispatch(setSkillTreesDisplayMode(event.target.value as TreeDisplayMode))}
                >
                  {treeDisplayModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </FormSelect>
                <label className="block text-sm text-gray-900 dark:text-gray-100" htmlFor="technologyTreesDisplayMode">
                  {localized.techTreesTab || "Tech Trees"}
                </label>
                <FormSelect
                  id="technologyTreesDisplayMode"
                  value={technologyTreesDisplayMode}
                  onChange={(event) => dispatch(setTechnologyTreesDisplayMode(event.target.value as TreeDisplayMode))}
                >
                  {treeDisplayModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </FormSelect>
              </div>
            </div>

            {isFeaturesForModdersEnabled && (
              <>
                <h6 className="mt-10">{localized.compatCheckVanillaPacks}</h6>
                <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{localized.compatCheckVanillaPacksMsg}</p>
                <div className="flex mt-3 w-ful items-center">
                  <input
                    className=""
                    type="checkbox"
                    id="enable-compatCheckVanillaPacksMsg"
                    checked={!!isCompatCheckingVanillaPacks}
                    onChange={() => dispatch(toggleIsCompatCheckingVanillaPacks())}
                  ></input>
                  <label className="ml-2" htmlFor="enable-compatCheckVanillaPacksMsg">
                    {localized.compatCheckVanillaPacks}
                  </label>
                </div>
              </>
            )}

            <h6 className="mt-10">{localized.setFolderPaths}</h6>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{localized.setFolderPathsMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => setIsShowingSetFolderPaths(true)}
              >
                <span className="uppercase">{localized.setFolderPaths}</span>
              </button>
            </div>

            <h6 className="mt-10">{localized.bisectModList}</h6>
            <p className="text-sm text-gray-500 dark:text-gray-400">{localized.bisectModListMsg}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={(e) => bisectModList(e)}
              >
                <span className="uppercase">{localized.bisectModList}</span>
              </button>
            </div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">{localized.bisectModListRandomMsg}</p>
            <div className="flex mt-2 mb-4 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={(e) => bisectModList(e, true)}
              >
                <span className="uppercase">{localized.bisectModListRandomly}</span>
              </button>
            </div>

            <h6 className="mt-10">{localized.searchInsidePacks}</h6>
            <p className="text-sm text-gray-500 dark:text-gray-400">{localized.searchInsidePacksDescription}</p>
            <div className="flex mt-2 w-full">
              <button
                className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                onClick={() => dispatch(setIsPackSearcherOpen(true))}
              >
                <span className="uppercase">{localized.searchInsidePacks}</span>
              </button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
});
export default OptionsDrawer;
