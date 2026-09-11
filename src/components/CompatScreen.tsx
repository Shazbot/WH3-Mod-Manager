import React, { memo, useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Modal } from "../flowbite/components/Modal/index";
import { Spinner, Tabs } from "../flowbite";
import { Tooltip } from "flowbite-react";
import CompatConflictCard from "./CompatConflictCard";
import CompatCollapsibleSection from "./CompatCollapsibleSection";
import { compareModNames, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { PiFiles } from "react-icons/pi";
import {
  DBFileName,
  DBRefOrigin,
  FileAnalysisError,
  FileToFileReference,
  PackName,
  PackCollisions,
  PackFileCollision,
  PackTableCollision,
  ScriptListenerCollision,
  UniqueIdsCollision,
} from "../packFileTypes";
import { setPackCollisions, setPackCollisionsCheckProgress } from "../appSlice";
import { formatCompatReport, formatCompatReportHtml } from "../modCompat/compatReportExport";
import groupBy from "object.groupby";
import { useLocalizations } from "../localizationContext";
import { vanillaPackNames } from "../supportedGames";
import { IoPeople } from "react-icons/io5";
import { BsPersonVcard } from "react-icons/bs";
import { LuPaintbrush2 } from "react-icons/lu";
import {
  collapsePackFileCollisions,
  collapsePackTableCollisions,
  collapseScriptListenerCollisions,
  collapseUniqueIdsCollisions,
  higherPriorityDatabaseFile,
  higherPriorityPack,
} from "../modCompat/compatViewModels";

const matchTablePartOfFileName = /.*?\\(.*?)\\.*?/;
const dbTableNameFromFileName = (fileName: string) => fileName.match(matchTablePartOfFileName)?.[1] || fileName;
const topLevelFolderFromFileName = (fileName: string) => fileName.split(/[\\/]/).find(Boolean) || fileName;

const fileNameToIcon = (packFileName: string) => {
  if (packFileName.endsWith(".wsmodel")) return <IoPeople className="h-5 w-5 self-center ml-2" />;
  if (packFileName.endsWith(".xml.material")) return <LuPaintbrush2 className="h-5 w-5 self-center ml-2" />;
  if (packFileName.endsWith(".variantmeshdefinition")) return <BsPersonVcard className="h-5 w-5 self-center ml-2" />;
};

const CompatScreen = memo(() => {
  const dispatch = useAppDispatch();
  const packCollisions = useAppSelector((state) => state.app.packCollisions);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const packCollisionsCheckProgress = useAppSelector((state) => state.app.packCollisionsCheckProgress);
  const sortedMods = sortByNameAndLoadOrder(mods);
  const enabledMods = sortedMods.filter((iterMod) => iterMod.isEnabled);

  const [isCompatOpen, setIsCompatOpen] = React.useState(false);
  const [isSpinnerClosed, setIsSpinnerClosed] = React.useState(true);
  const [useEnabledModsOnly, setUseEnabledModsOnly] = React.useState(true);
  const [selectedModFilter, setSelectedModFilter] = React.useState("");
  const wasCompatOpenRef = React.useRef(false);
  /** The collisions in state when a check was requested, so its arrival can be told from a stale one. */
  const awaitedCollisionsRef = React.useRef<PackCollisions | null>(null);
  const [isExportingReport, setIsExportingReport] = React.useState(false);

  /** Writes either a canonical JSON report for diffs or a standalone HTML report for people. */
  const exportReport = useCallback(
    async (format: "json" | "html") => {
      setIsExportingReport(true);
      try {
        const modsChecked = useEnabledModsOnly ? enabledMods : sortedMods;
        const reportMods = modsChecked.map((mod) => ({
          name: mod.name,
          isEnabled: mod.isEnabled,
          loadOrder: mod.loadOrder ?? null,
        }));
        const reportText =
          format === "html"
            ? formatCompatReportHtml(packCollisions, reportMods, {
                scopeLabel: useEnabledModsOnly ? "Enabled mods only" : "All discovered mods",
              })
            : formatCompatReport(packCollisions, reportMods);
        const result = await window.api?.exportCompatReport(reportText, `compat-report.${format}`);
        if (result?.success) console.log("compat report written to", result.savedPath);
        else if (result && !result.canceled) console.error("compat report export failed:", result.error);
      } finally {
        setIsExportingReport(false);
      }
    },
    [packCollisions, enabledMods, sortedMods, useEnabledModsOnly],
  );

  useEffect(() => {
    if (!wasCompatOpenRef.current && isCompatOpen) {
      console.log("Compat Panel is opened, getCompatData called with useEnabledModsOnly:", useEnabledModsOnly);
      // The spinner tracks the request, not the progress events. A cached result answers in
      // milliseconds without emitting any progress at all, which used to leave no spinner and a panel
      // that looked frozen while the report rendered.
      awaitedCollisionsRef.current = packCollisions;
      setIsSpinnerClosed(false);
      // Cleared so the spinner does not open showing the last run's pack names and 100%.
      dispatch(
        setPackCollisionsCheckProgress({
          currentIndex: -1,
          maxIndex: 0,
          firstPackName: "",
          secondPackName: "",
          type: "Files",
        }),
      );
      if (useEnabledModsOnly) {
        window.api?.getCompatData(enabledMods);
      } else {
        window.api?.getCompatData(mods);
      }
    }
    if (wasCompatOpenRef.current && !isCompatOpen) {
      console.log("Compat Panel is closed, getting rid of compat data");
      dispatch(
        setPackCollisions({
          packFileCollisions: [],
          packTableCollisions: [],
          missingTableReferences: {},
          uniqueIdsCollisions: {},
          scriptListenerCollisions: {},
          packFileAnalysisErrors: {},
          missingFileRefs: {},
        }),
      );
    }
    wasCompatOpenRef.current = isCompatOpen;
    // packCollisions is read when a check is requested. Re-running on it is a no-op: wasCompatOpenRef
    // already matches isCompatOpen by then, so neither branch fires again.
  }, [dispatch, enabledMods, isCompatOpen, mods, packCollisions, useEnabledModsOnly]);

  /**
   * Closes the spinner when the results land, whatever produced them.
   *
   * Keyed on the collisions object changing identity rather than on progress reaching its maximum: a
   * cached answer arrives without a single progress event, and the previous run leaves the progress
   * sitting at its maximum, so a progress-based rule could neither open nor close for it.
   */
  useEffect(() => {
    if (!isCompatOpen) {
      awaitedCollisionsRef.current = null;
      setIsSpinnerClosed(true);
      return;
    }
    if (awaitedCollisionsRef.current === null) return;
    if (packCollisions === awaitedCollisionsRef.current) return;

    awaitedCollisionsRef.current = null;
    setIsSpinnerClosed(true);
  }, [isCompatOpen, packCollisions]);

  const localized = useLocalizations();

  const enabledModNames = new Set(enabledMods.map((mod) => mod.name));
  const isPackInCompatScope = (packName: string) =>
    !useEnabledModsOnly || enabledModNames.has(packName) || vanillaPackNames.includes(packName);

  // File and table collisions are emitted in both directions by the scanner. Keep the raw data for
  // exports, but use one record per real conflict in the interactive view.
  const displayPackFileCollisions = collapsePackFileCollisions(packCollisions.packFileCollisions).filter(
    (collision) => isPackInCompatScope(collision.firstPackName) && isPackInCompatScope(collision.secondPackName),
  );
  const displayPackTableCollisions = collapsePackTableCollisions(packCollisions.packTableCollisions).filter(
    (collision) => isPackInCompatScope(collision.firstPackName) && isPackInCompatScope(collision.secondPackName),
  );

  const packOrderIndex = (packName: string) => {
    const index = sortedMods.findIndex((mod) => mod.name === packName);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sortPackNamesByLoadOrder = (firstPackName: string, secondPackName: string) =>
    packOrderIndex(firstPackName) - packOrderIndex(secondPackName) || compareModNames(firstPackName, secondPackName);
  const orderedPackNames = sortedMods.map((mod) => mod.name);

  const filteredDisplayPackFileCollisions = displayPackFileCollisions
    .filter(
      (collision) =>
        selectedModFilter === "" ||
        collision.firstPackName === selectedModFilter ||
        collision.secondPackName === selectedModFilter,
    )
    .sort(
      (first, second) =>
        compareModNames(first.fileName, second.fileName) ||
        sortPackNamesByLoadOrder(first.firstPackName, second.firstPackName) ||
        sortPackNamesByLoadOrder(first.secondPackName, second.secondPackName),
    );
  const filteredDisplayPackTableCollisions = displayPackTableCollisions
    .filter(
      (collision) =>
        selectedModFilter === "" ||
        collision.firstPackName === selectedModFilter ||
        collision.secondPackName === selectedModFilter,
    )
    .sort(
      (first, second) =>
        compareModNames(first.fileName, second.fileName) ||
        compareModNames(first.value, second.value) ||
        sortPackNamesByLoadOrder(first.firstPackName, second.firstPackName) ||
        sortPackNamesByLoadOrder(first.secondPackName, second.secondPackName),
    );

  const groupedDisplayPackFileCollisions: Record<string, PackFileCollision[]> = {};
  for (const collision of filteredDisplayPackFileCollisions) {
    const topLevelFolder = topLevelFolderFromFileName(collision.fileName);
    groupedDisplayPackFileCollisions[topLevelFolder] ||= [];
    groupedDisplayPackFileCollisions[topLevelFolder].push(collision);
  }
  const displayTopLevelFolders = Object.keys(groupedDisplayPackFileCollisions).sort(compareModNames);

  const groupedDisplayPackTableCollisions: Record<string, PackTableCollision[]> = {};
  for (const collision of filteredDisplayPackTableCollisions) {
    const dbName = dbTableNameFromFileName(collision.fileName);
    groupedDisplayPackTableCollisions[dbName] ||= [];
    groupedDisplayPackTableCollisions[dbName].push(collision);
  }
  const displayDbTableNames = Object.keys(groupedDisplayPackTableCollisions).sort(compareModNames);

  const numPackFileCollisions = displayPackFileCollisions.length;
  const numPackTableCollisions = displayPackTableCollisions.length;
  const compatFilterMods = useEnabledModsOnly ? enabledMods : sortedMods;

  // for(const [packName, refs] of Object.entries(packCollisions.missingTableReferences)){
  //   groupBy(refs,(ref)=>{return `${ref.targetDBFileName}/${ref.targetFieldName}`})

  // }

  const groupedMissingTableReferences: Record<string, Record<string, DBRefOrigin[]>> = {};
  for (const [packName, refs] of Object.entries(packCollisions.missingTableReferences)) {
    if (useEnabledModsOnly) {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName);
      if (!mod) continue;
    }

    groupedMissingTableReferences[packName] = groupBy(refs, (ref) => {
      return `${ref.targetDBFileName}/${ref.targetFieldName}`;
    });
  }

  const numMissingTableReferences = Object.values(groupedMissingTableReferences).reduce(
    (acc, curr) => acc + Object.values(curr).reduce((acc2, curr2) => acc2 + Object.values(curr2).length, 0),
    0,
  );

  const groupedUniqueIdsCollisions: Record<PackName, Record<DBFileName, Record<PackName, UniqueIdsCollision[]>>> = {};
  for (const [packName, uniqueIdsCollisions] of Object.entries(packCollisions.uniqueIdsCollisions)) {
    if (useEnabledModsOnly) {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
      if (!mod) continue;
    }

    const groupedByTableName = groupBy(uniqueIdsCollisions, (uniqueIdsCollision) => {
      return uniqueIdsCollision.tableName;
    });

    for (const [tableName, uniqueIdsCollisions] of Object.entries(groupedByTableName)) {
      const subGroupedBySecondPackName = groupBy(uniqueIdsCollisions, (uniqueIdsCollision) => {
        if (!uniqueIdsCollision.secondPackName) return uniqueIdsCollision.firstPackName;
        return uniqueIdsCollision.secondPackName == packName
          ? uniqueIdsCollision.firstPackName
          : uniqueIdsCollision.secondPackName;
      });
      groupedUniqueIdsCollisions[packName] = groupedUniqueIdsCollisions[packName] || {};
      groupedUniqueIdsCollisions[packName][tableName] = groupedUniqueIdsCollisions[packName][tableName] || {};
      groupedUniqueIdsCollisions[packName][tableName] = subGroupedBySecondPackName;

      if (useEnabledModsOnly) {
        for (const secondPackName of Object.keys(subGroupedBySecondPackName)) {
          const mod =
            enabledMods.find((iterMod) => iterMod.name == secondPackName) || vanillaPackNames.includes(secondPackName);
          if (!mod) {
            delete groupedUniqueIdsCollisions[packName][tableName][secondPackName];
          }
        }
      }
    }
  }

  const numUniqueIdsCollisions = collapseUniqueIdsCollisions(
    Object.values(groupedUniqueIdsCollisions).flatMap((tableGroups) =>
      Object.values(tableGroups).flatMap((packGroups) => Object.values(packGroups).flat()),
    ),
  ).length;

  const groupedScriptListenerCollisions: Record<PackName, ScriptListenerCollision[]> = {};
  for (const [packName, scriptListenerCollisions] of Object.entries(packCollisions.scriptListenerCollisions)) {
    if (useEnabledModsOnly) {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
      if (!mod) continue;
    }

    groupedScriptListenerCollisions[packName] = groupedScriptListenerCollisions[packName] || {};
    groupedScriptListenerCollisions[packName] = scriptListenerCollisions;

    if (useEnabledModsOnly) {
      for (const scriptListenerCollision of groupedScriptListenerCollisions[packName]) {
        if (scriptListenerCollision.secondPackName) {
          const mod =
            enabledMods.find((iterMod) => iterMod.name == scriptListenerCollision.secondPackName) ||
            vanillaPackNames.includes(scriptListenerCollision.secondPackName);
          if (!mod) {
            groupedScriptListenerCollisions[packName] = groupedScriptListenerCollisions[packName].filter(
              (collision) => collision != scriptListenerCollision,
            );
          }
        }
      }
    }
  }

  // The scanner creates an empty bucket for packs that have no duplicate listeners. Do not turn
  // those buckets into visible disclosure sections, especially after the enabled-mod filter removes
  // collisions involving out-of-scope packs.
  for (const packName of Object.keys(groupedScriptListenerCollisions)) {
    if (groupedScriptListenerCollisions[packName].length === 0) {
      delete groupedScriptListenerCollisions[packName];
    }
  }

  const numScriptListenerCollisions = collapseScriptListenerCollisions(
    Object.values(groupedScriptListenerCollisions).flat(),
  ).length;

  const groupedPackFileAnalysisErrors: Record<PackName, Record<string, FileAnalysisError[]>> = {};
  for (const [packName, packFileAnalysisErrors] of Object.entries(packCollisions.packFileAnalysisErrors)) {
    if (useEnabledModsOnly) {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
      if (!mod) continue;
    }

    groupedPackFileAnalysisErrors[packName] = groupedPackFileAnalysisErrors[packName] || {};
    groupedPackFileAnalysisErrors[packName] = packFileAnalysisErrors;
  }

  const numPackFileAnalysisErrors = Object.values(groupedPackFileAnalysisErrors).reduce(
    (acc, curr) => acc + Object.values(curr).reduce((acc2, curr2) => acc2 + Object.values(curr2).length, 0),
    0,
  );

  const groupedMissingFileRefs: Record<PackName, Record<DBFileName, FileToFileReference[]>> = {};
  for (const [packName, missingFileRefs] of Object.entries(packCollisions.missingFileRefs)) {
    if (useEnabledModsOnly) {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
      if (!mod) continue;
    }

    groupedMissingFileRefs[packName] = groupedMissingFileRefs[packName] || {};
    groupedMissingFileRefs[packName] = missingFileRefs;
  }

  const numMissingFileRefs = Object.values(groupedMissingFileRefs).reduce(
    (acc, curr) => acc + Object.values(curr).reduce((acc2, curr2) => acc2 + Object.values(curr2).length, 0),
    0,
  );

  // console.log("groupedScriptListenerCollisions", groupedScriptListenerCollisions);

  const toggleUseEnabledModsOnly = useCallback(() => {
    if (useEnabledModsOnly) {
      console.log("READ ALL MODS");
      window.api?.readMods(mods, false);
    }
    setSelectedModFilter("");
    setUseEnabledModsOnly(!useEnabledModsOnly);
  }, [useEnabledModsOnly, mods]);

  const progressPercent =
    packCollisionsCheckProgress.maxIndex > 0
      ? Math.min(
          100,
          Math.max(0, (packCollisionsCheckProgress.currentIndex / packCollisionsCheckProgress.maxIndex) * 100),
        )
      : 0;

  return (
    <div>
      <div className="text-center mt-4">
        <button
          onClick={() =>
            setIsCompatOpen(() => {
              return !isCompatOpen;
            })
          }
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
        >
          {localized.checkCompat}
        </button>
      </div>

      {isCompatOpen && (
        <Modal
          show={isCompatOpen}
          // show={true}
          onClose={() => {
            setIsCompatOpen(false);
            dispatch(
              setPackCollisions({
                packFileCollisions: [],
                packTableCollisions: [],
                missingTableReferences: {},
                uniqueIdsCollisions: {},
                scriptListenerCollisions: {},
                packFileAnalysisErrors: {},
                missingFileRefs: {},
              }),
            );
          }}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "mt-8",
            "!max-w-7xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>{localized.modCompatibility}</Modal.Header>
          <Modal.Body>
            <div className="flex justify-end gap-2 mb-2">
              <button
                onClick={() => void exportReport("json")}
                disabled={isExportingReport}
                className="px-3 py-1.5 text-xs bg-gray-600 hover:bg-gray-500 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                type="button"
                title="Write this report to a file, in a form two builds can be compared against"
              >
                {isExportingReport
                  ? localized.exporting || "Exporting..."
                  : localized.exportCompatReportJson || "Export JSON"}
              </button>
              <button
                onClick={() => void exportReport("html")}
                disabled={isExportingReport}
                className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50"
                type="button"
                title="Write a self-contained, searchable compatibility report for viewing in a browser"
              >
                {isExportingReport
                  ? localized.exporting || "Exporting..."
                  : localized.exportCompatReportHtml || "Export HTML"}
              </button>
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/50">
              <label
                className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                htmlFor="compat-enabled-mods-only"
              >
                <input
                  type="checkbox"
                  id="compat-enabled-mods-only"
                  checked={useEnabledModsOnly}
                  onChange={() => toggleUseEnabledModsOnly()}
                />
                {localized.enabledModsOnly}
              </label>
              <label
                className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                htmlFor="compat-mod-filter"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {localized.packName}
                </span>
                <select
                  id="compat-mod-filter"
                  value={selectedModFilter}
                  onChange={(e) => setSelectedModFilter(e.target.value)}
                  className="max-w-[18rem] rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">{localized.allMods}</option>
                  {compatFilterMods
                    .slice()
                    .sort((first, second) => sortPackNamesByLoadOrder(first.name, second.name))
                    .map((mod) => (
                      <option key={mod.name} value={mod.name}>
                        {mod.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <Tabs.Group style="underline">
              <Tabs.Item active={true} title={`${localized.files} (${numPackFileCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {filteredDisplayPackFileCollisions.length == 0 ? (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noFileCollisionsFound}
                    </p>
                  ) : (
                    <div className="space-y-2 pt-2">
                      {displayTopLevelFolders.map((topLevelFolder) => (
                        <CompatCollapsibleSection
                          key={topLevelFolder}
                          title={topLevelFolder}
                          count={groupedDisplayPackFileCollisions[topLevelFolder].length}
                        >
                          <div className="space-y-3 text-sm">
                            {groupedDisplayPackFileCollisions[topLevelFolder].map((collision) => {
                              const firstIsWinner =
                                higherPriorityPack(
                                  collision.firstPackName,
                                  collision.secondPackName,
                                  orderedPackNames,
                                ) === "first";

                              return (
                                <CompatConflictCard
                                  key={`${collision.firstPackName}:${collision.secondPackName}:${collision.fileName}`}
                                  heading={collision.fileName}
                                  headingLabel={localized.packFileName}
                                  first={{ packName: collision.firstPackName }}
                                  second={{ packName: collision.secondPackName }}
                                  firstIsWinner={firstIsWinner}
                                  status={
                                    collision.areSameSize && (
                                      <div className="flex items-start gap-2 text-sm">
                                        <PiFiles className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                                        <div>
                                          <div className="font-bold">{localized.sameFileSize}</div>
                                          <div className="text-xs text-emerald-800 dark:text-emerald-200">
                                            {localized.sameFileSizeLikelyNoConflict}
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  }
                                  labels={{
                                    winner: localized.compatHigherPriority,
                                    lowerPriority: localized.compatLowerPriority,
                                    compare: localized.compatCompare,
                                  }}
                                />
                              );
                            })}
                          </div>
                        </CompatCollapsibleSection>
                      ))}
                    </div>
                  )}
                </div>
              </Tabs.Item>
              <Tabs.Item title={`${localized.tables} (${numPackTableCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {filteredDisplayPackTableCollisions.length == 0 ? (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noDBKeyCollisionsFound}
                    </p>
                  ) : (
                    <div className="space-y-2 pt-2">
                      {displayDbTableNames.map((dbName) => (
                        <CompatCollapsibleSection
                          key={dbName}
                          title={dbName}
                          count={groupedDisplayPackTableCollisions[dbName].length}
                        >
                          <div className="space-y-3 text-sm">
                            {groupedDisplayPackTableCollisions[dbName].map((collision) => {
                              const firstIsWinner = higherPriorityDatabaseFile(collision) === "first";

                              return (
                                <CompatConflictCard
                                  key={`${collision.firstPackName}:${collision.secondPackName}:${collision.fileName}:${collision.secondFileName}:${collision.key}:${collision.value}`}
                                  heading={collision.value}
                                  headingLabel={localized.key}
                                  headingClassName="font-mono text-base font-bold tracking-tight text-amber-950 sm:text-lg dark:text-amber-100"
                                  metaClassName="mt-2 text-sm text-gray-700 dark:text-gray-300"
                                  meta={
                                    <div className="grid gap-2 sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-center">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        {localized.tableColumn}
                                      </span>
                                      <code className="min-w-0 break-all rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-sm font-semibold leading-snug text-gray-800 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-100">
                                        {collision.key}
                                      </code>
                                    </div>
                                  }
                                  first={{ packName: collision.firstPackName, fileName: collision.fileName }}
                                  second={{ packName: collision.secondPackName, fileName: collision.secondFileName }}
                                  firstIsWinner={firstIsWinner}
                                  labels={{
                                    winner: localized.compatHigherPriority,
                                    lowerPriority: localized.compatLowerPriority,
                                    compare: localized.compatCompare,
                                  }}
                                />
                              );
                            })}
                          </div>
                        </CompatCollapsibleSection>
                      ))}
                    </div>
                  )}
                </div>
              </Tabs.Item>
              <Tabs.Item title={`${localized.missingKeys} (${numMissingTableReferences})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {Object.keys(groupedMissingTableReferences).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noMissingDBKeysFound}
                    </p>
                  )}
                  <div className="space-y-2 text-lg">
                    {Object.keys(groupedMissingTableReferences)
                      .filter((firstPackName) => selectedModFilter === "" || firstPackName === selectedModFilter)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod,
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod,
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((firstPackName) => {
                        const tableKeyGroupToRefs = groupedMissingTableReferences[firstPackName];
                        return (
                          <CompatCollapsibleSection key={firstPackName} title={firstPackName}>
                            {Object.keys(tableKeyGroupToRefs).map((tableKeyGroup) => {
                              const refs = tableKeyGroupToRefs[tableKeyGroup];
                              let doneTableKeyGroup = false;
                              return refs.map((ref) => {
                                const targetDBFileName = ref.targetDBFileName;
                                const targetFieldName = ref.targetFieldName;
                                const value = ref.value;
                                const originFieldName = ref.originFieldName;
                                const originDBFileName = ref.originDBFileName;
                                const originFileSuffix = ref.originFileSuffix;

                                const fragment = (
                                  <React.Fragment
                                    key={
                                      firstPackName +
                                      targetDBFileName +
                                      targetFieldName +
                                      value +
                                      originFieldName +
                                      originDBFileName +
                                      originFileSuffix +
                                      doneTableKeyGroup
                                    }
                                  >
                                    {!doneTableKeyGroup && (
                                      <div className="ml-4">
                                        <span className="make-tooltip-inline">
                                          <Tooltip
                                            style="light"
                                            content={
                                              <>
                                                <p>{localized.missingKeyTableAndColumn}</p>
                                              </>
                                            }
                                          >
                                            <span className="text-center w-full ">{tableKeyGroup}</span>
                                          </Tooltip>
                                        </span>
                                      </div>
                                    )}

                                    <div className="ml-8">
                                      <span className="make-tooltip-inline">
                                        <Tooltip
                                          style="light"
                                          content={
                                            <>
                                              <p>{localized.missingDBKey}</p>
                                            </>
                                          }
                                        >
                                          <span className="text-center w-full decoration-red-700 underline decoration-2 underline-offset-4">
                                            {value}
                                          </span>
                                        </Tooltip>
                                      </span>

                                      <span className="ml-2 make-tooltip-inline">
                                        <span className="text-center w-full">
                                          {localized.missingKeyIsReferencedIn &&
                                            localized.missingKeyIsReferencedIn
                                              .replace("<originFileSuffix>", originFileSuffix)
                                              .replace("<originFieldName>", originFieldName)}
                                        </span>
                                      </span>
                                    </div>
                                  </React.Fragment>
                                );
                                doneTableKeyGroup = true;
                                return fragment;
                              });
                            })}
                          </CompatCollapsibleSection>
                        );
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.duplicateKeys} (${numUniqueIdsCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {Object.keys(groupedUniqueIdsCollisions).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noDuplicateKeysFound}
                    </p>
                  )}
                  <div className="space-y-2 text-lg">
                    {Object.keys(groupedUniqueIdsCollisions)
                      .filter((firstPackName) => selectedModFilter === "" || firstPackName === selectedModFilter)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod,
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod,
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((firstPackName) => {
                        const tableToUniqueIdCollisions = groupedUniqueIdsCollisions[firstPackName];
                        return (
                          <CompatCollapsibleSection key={firstPackName} title={firstPackName}>
                            <div className="space-y-2">
                              {Object.keys(tableToUniqueIdCollisions).map((tableName) => {
                                const secondPackToUniqueIdCollisions = tableToUniqueIdCollisions[tableName];
                                const tableCollisionCount = Object.values(secondPackToUniqueIdCollisions).reduce(
                                  (count, collisions) => count + collisions.length,
                                  0,
                                );

                                return (
                                  <CompatCollapsibleSection
                                    key={tableName}
                                    title={tableName}
                                    count={tableCollisionCount}
                                  >
                                    {Object.keys(secondPackToUniqueIdCollisions)
                                      .sort((firstPackName, secondPackName) => {
                                        const firstPackIndex = sortedMods.indexOf(
                                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod,
                                        );
                                        const secondPackIndex = sortedMods.indexOf(
                                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod,
                                        );

                                        return firstPackIndex - secondPackIndex;
                                      })
                                      .map((secondPackName) => {
                                        let doneSecondPackName = false;
                                        const uniqueIdCollisions = secondPackToUniqueIdCollisions[secondPackName];
                                        return uniqueIdCollisions.map((uniqueIdCollision) => {
                                          const collisionTableName = uniqueIdCollision.tableName;
                                          const fieldName = uniqueIdCollision.fieldName;
                                          const value = uniqueIdCollision.value;
                                          const valueTwo = uniqueIdCollision.valueTwo;

                                          const fragment = (
                                            <React.Fragment
                                              key={
                                                collisionTableName +
                                                fieldName +
                                                value.value +
                                                firstPackName +
                                                secondPackName +
                                                doneSecondPackName
                                              }
                                            >
                                              {!doneSecondPackName && (
                                                <div className="ml-4">
                                                  <span className="make-tooltip-inline">
                                                    <Tooltip
                                                      style="light"
                                                      content={
                                                        <>
                                                          <p>{localized.packName}</p>
                                                        </>
                                                      }
                                                    >
                                                      <span className="text-center w-full font-normal">
                                                        {secondPackName}
                                                      </span>
                                                    </Tooltip>
                                                  </span>
                                                </div>
                                              )}

                                              <div className="ml-12">
                                                <div className="make-tooltip-inline">
                                                  <Tooltip
                                                    style="light"
                                                    content={
                                                      <>
                                                        <p>{localized.duplicateDBKey}</p>
                                                      </>
                                                    }
                                                  >
                                                    <span className="text-center w-full">{value.value}</span>
                                                  </Tooltip>
                                                </div>

                                                {(valueTwo &&
                                                  ((valueTwo.packName == secondPackName && (
                                                    <div className="ml-6 mb-4">
                                                      <div>
                                                        {value.packFileName} in {firstPackName}
                                                      </div>
                                                      <div className="ml-4 flex gap-2 flex-wrap">
                                                        {value.tableRow.map((field, i) => {
                                                          if (field != valueTwo.tableRow[i])
                                                            return (
                                                              <span key={i} className="text-blue-500">
                                                                {field}
                                                              </span>
                                                            );
                                                          return <span key={i}>{field}</span>;
                                                        })}
                                                      </div>
                                                      <div>
                                                        {valueTwo.packFileName} in {secondPackName}
                                                      </div>
                                                      <div className="ml-4 flex gap-2 flex-wrap">
                                                        {valueTwo.tableRow.map((field, i) => {
                                                          if (field != value.tableRow[i])
                                                            return (
                                                              <span key={i} className="text-blue-500">
                                                                {field}
                                                              </span>
                                                            );
                                                          return <span key={i}>{field}</span>;
                                                        })}
                                                      </div>
                                                    </div>
                                                  )) || (
                                                    <div className="ml-6 mb-4">
                                                      <div>
                                                        {valueTwo.packFileName} in {firstPackName}
                                                      </div>
                                                      <div className="ml-4 flex gap-2 flex-wrap">
                                                        {valueTwo.tableRow.map((field, i) => {
                                                          if (field != value.tableRow[i])
                                                            return (
                                                              <span key={i} className="text-blue-500">
                                                                {field}
                                                              </span>
                                                            );
                                                          return <span key={i}>{field}</span>;
                                                        })}
                                                      </div>
                                                      <div>
                                                        {value.packFileName} in {secondPackName}
                                                      </div>
                                                      <div className="ml-4 flex gap-2 flex-wrap">
                                                        {value.tableRow.map((field, i) => {
                                                          if (field != valueTwo.tableRow[i])
                                                            return (
                                                              <span key={i} className="text-blue-500">
                                                                {field}
                                                              </span>
                                                            );
                                                          return <span key={i}>{field}</span>;
                                                        })}
                                                      </div>
                                                    </div>
                                                  ))) || (
                                                  <div className="ml-6 mb-4">
                                                    <div>
                                                      {value.packFileName} in {firstPackName}
                                                    </div>
                                                    <div className="ml-4 flex gap-2 flex-wrap">
                                                      {value.tableRow.map((field, i) => {
                                                        return <span key={i}>{field}</span>;
                                                      })}
                                                    </div>
                                                  </div>
                                                )}
                                                {/* <span className="ml-2 make-tooltip-inline">
                                    <span className="text-center w-full">
                                      {localized.missingKeyIsReferencedIn &&
                                        localized.missingKeyIsReferencedIn
                                          .replace("<originFileSuffix>", originFileSuffix)
                                          .replace("<originFieldName>", originFieldName)}
                                    </span>
                                  </span> */}
                                              </div>
                                            </React.Fragment>
                                          );

                                          doneSecondPackName = true;
                                          return fragment;
                                        });
                                      })}
                                  </CompatCollapsibleSection>
                                );
                              })}
                            </div>
                          </CompatCollapsibleSection>
                        );
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.duplicateListenerNames} (${numScriptListenerCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {numScriptListenerCollisions == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noDuplicateListenerNamesFound}
                    </p>
                  )}
                  <div className="space-y-2 text-lg">
                    {Object.keys(groupedScriptListenerCollisions)
                      .filter((packName) => selectedModFilter === "" || packName === selectedModFilter)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod,
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod,
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((packName) => {
                        const scriptListenerCollisions = groupedScriptListenerCollisions[packName];
                        return (
                          <CompatCollapsibleSection key={packName} title={packName}>
                            {scriptListenerCollisions.map((collision) => {
                              const firstPackName = collision.firstPackName;
                              const secondPackName = collision.secondPackName;
                              const packFileName = collision.packFileName;
                              const value = collision.value;
                              const valueTwo = collision.valueTwo;

                              const fragment = (
                                <React.Fragment
                                  key={
                                    packName +
                                    firstPackName +
                                    packFileName +
                                    value.value +
                                    value.packName +
                                    value.packFileName +
                                    value.position +
                                    valueTwo.position +
                                    (secondPackName || "")
                                  }
                                >
                                  <div className="ml-4 font-normal">
                                    <span className="make-tooltip-inline">
                                      <Tooltip
                                        style="light"
                                        content={
                                          <>
                                            <p>{localized.duplicateListenerName}</p>
                                          </>
                                        }
                                      >
                                        <span className="text-center w-full">{value.value}</span>
                                      </Tooltip>
                                    </span>
                                  </div>

                                  <div className="ml-16">
                                    {(valueTwo &&
                                      valueTwo.packName != value.packName &&
                                      ((valueTwo.packName == packName && (
                                        <div className="mb-4">
                                          <div>
                                            {value.packFileName} in {value.packName}
                                          </div>
                                          <div>
                                            {valueTwo.packFileName} in {valueTwo.packName}
                                          </div>
                                        </div>
                                      )) || (
                                        <div className="mb-4">
                                          <div>
                                            {valueTwo.packFileName} in {valueTwo.packName}
                                          </div>

                                          <div>
                                            {value.packFileName} in {value.packName}
                                          </div>
                                        </div>
                                      ))) || (
                                      <div className="mb-4">
                                        <div>
                                          {value.packFileName} in {value.packName}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </React.Fragment>
                              );

                              return fragment;
                            })}
                          </CompatCollapsibleSection>
                        );
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.fileErrors} (${numPackFileAnalysisErrors})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {Object.keys(groupedPackFileAnalysisErrors).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noFileErrorsFound}
                    </p>
                  )}
                  <div className="space-y-2 text-lg">
                    {Object.keys(groupedPackFileAnalysisErrors)
                      .filter((packName) => selectedModFilter === "" || packName === selectedModFilter)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod,
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod,
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((packName) => {
                        const packFileToErrors = groupedPackFileAnalysisErrors[packName];

                        return (
                          <CompatCollapsibleSection key={packName} title={packName}>
                            {Object.keys(packFileToErrors).map((packFileName) => {
                              const errors = packFileToErrors[packFileName];
                              return errors.map((error) => {
                                const packName = error.packName;
                                const packFileName = error.packFileName;
                                const msg = error.msg;

                                const fragment = (
                                  <React.Fragment key={packName + packFileName + msg}>
                                    <div className="ml-4 font-normal">
                                      <span className="make-tooltip-inline">
                                        <Tooltip
                                          style="light"
                                          content={
                                            <>
                                              <p>{localized.packFileName}</p>
                                            </>
                                          }
                                        >
                                          <span className="text-center w-full">{packFileName}</span>
                                        </Tooltip>
                                      </span>
                                    </div>

                                    <div className="ml-16">
                                      <div className="mb-4">
                                        <div>{msg}</div>
                                        {error.lineNum && (
                                          <div>
                                            {localized.line} {error.lineNum}
                                            {error.colNum && `, ${localized.column} ${error.colNum}`}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </React.Fragment>
                                );

                                return fragment;
                              });
                            })}
                          </CompatCollapsibleSection>
                        );
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.missingFiles} (${numMissingFileRefs})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  {Object.keys(groupedMissingFileRefs).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noMissingFilesFound}
                    </p>
                  )}
                  <div className="space-y-2 text-lg">
                    {Object.keys(groupedMissingFileRefs)
                      .filter((packName) => selectedModFilter === "" || packName === selectedModFilter)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod,
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod,
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((packName) => {
                        const packFileToMissingRefs = groupedMissingFileRefs[packName];
                        const packFileTooltip = localized.fileInsidePack.replace("<PACKNAME>", packName);

                        return (
                          <CompatCollapsibleSection key={packName} title={packName}>
                            {Object.keys(packFileToMissingRefs).map((packFileName) => {
                              let doneFileName = false;
                              const refs = packFileToMissingRefs[packFileName];
                              return refs.map((ref, refsIndex) => {
                                const packName = ref.packName;
                                const packFileName = ref.packFileName;
                                const reference = ref.reference;

                                const fragment = (
                                  <React.Fragment key={packName + packFileName + reference}>
                                    {!doneFileName && (
                                      <div className="ml-4 font-normal mb-2 flex">
                                        <span className="make-tooltip-inline">
                                          <Tooltip
                                            style="light"
                                            content={
                                              <>
                                                <p>{packFileTooltip}</p>
                                              </>
                                            }
                                          >
                                            <span className="text-center w-full">{packFileName}</span>
                                          </Tooltip>
                                        </span>
                                        {fileNameToIcon(packFileName)}
                                      </div>
                                    )}

                                    <div className={`ml-16 mb-2 ${refsIndex == refs.length - 1 && "mb-5"}`}>
                                      <div>{reference}</div>
                                    </div>
                                  </React.Fragment>
                                );

                                doneFileName = true;
                                return fragment;
                              });
                            })}
                          </CompatCollapsibleSection>
                        );
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={localized.help}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <p>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      {localized.compatHigherPriority}
                    </span>
                    <span className="mx-1">—</span>
                    {localized.compatHelpTwo}
                  </p>
                  <p>{localized.compatHelpOne}</p>
                  <p className="mt-6">{localized.compatHelpThree}</p>
                  <p>{localized.compatHelpFilesOne}</p>
                  <p className="mt-6">{localized.compatHelpFour}</p>
                  <p className="mt-6">{localized.compatHelpFive}</p>
                  <p className="mt-6">{localized.compatHelpSix}</p>
                  <p className="mt-6">{localized.compatHelpSeven}</p>
                  <p className="mt-6">{localized.compatHelpEight}</p>
                  <div className="flex gap-[1ch]">
                    <IoPeople className="h-5 w-5 self-center ml-2" /> - wsmodel
                  </div>
                  <div className="flex gap-[1ch]">
                    <LuPaintbrush2 className="h-5 w-5 self-center ml-2" /> - xml.material
                  </div>
                  <div className="flex gap-[1ch]">
                    <BsPersonVcard className="h-5 w-5 self-center ml-2" /> - variantmeshdefinition
                  </div>
                </div>
              </Tabs.Item>
            </Tabs.Group>
          </Modal.Body>
        </Modal>
      )}

      <Modal
        onClose={() => setIsSpinnerClosed(true)}
        show={!isSpinnerClosed && isCompatOpen}
        // show={true}
        size="2xl"
        position="center"
      >
        <Modal.Header>{localized.readingAndComparingPacks}</Modal.Header>
        <Modal.Body>
          <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300 mb-4">
            {localized.waitForReadingAndComparingPacks}
          </p>
          {packCollisionsCheckProgress.firstPackName != "" && packCollisionsCheckProgress.secondPackName != "" && (
            <p className="mb-4">
              {localized.comparingFilesInPacks &&
                localized.comparingFilesInPacks
                  .replace("<firstPackName>", packCollisionsCheckProgress.firstPackName)
                  .replace("<secondPackName>", packCollisionsCheckProgress.secondPackName)}
            </p>
          )}
          {packCollisionsCheckProgress.firstPackName != "" && packCollisionsCheckProgress.secondPackName == "" && (
            <p className="mb-4">
              {localized.comparingKeysInPacks.replace("<firstPackName>", packCollisionsCheckProgress.firstPackName)}
            </p>
          )}
          <div className="w-full h-5 bg-gray-200 rounded-full dark:bg-gray-600">
            <div
              className="h-5 bg-blue-600 rounded-full dark:bg-blue-500"
              style={{
                width: `${progressPercent}%`,
              }}
            ></div>
          </div>
          <div className="text-center mt-8">
            <Spinner color="purple" size="xl" />
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
});
export default CompatScreen;
