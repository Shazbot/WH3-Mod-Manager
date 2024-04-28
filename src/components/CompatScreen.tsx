import React, { memo, useCallback, useContext, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Modal } from "../flowbite/components/Modal/index";
import { Spinner, Tabs, Tooltip } from "../flowbite";
import { compareModNames, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { faStar } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  DBFileName,
  DBRefOrigin,
  FileAnalysisError,
  PackName,
  PackTableCollision,
  ScriptListenerCollision,
  UniqueIdsCollision,
} from "../packFileTypes";
import { setPackCollisions } from "../appSlice";
import groupBy from "object.groupby";
import localizationContext from "../localizationContext";
import { vanillaPackNames } from "../supportedGames";

let cachedIsCompatOpen = false;

const CompatScreen = memo(() => {
  const dispatch = useAppDispatch();
  const packCollisions = useAppSelector((state) => state.app.packCollisions);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const packCollisionsCheckProgress = useAppSelector((state) => state.app.packCollisionsCheckProgress);
  const sortedMods = sortByNameAndLoadOrder(mods);
  const enabledMods = sortedMods.filter((iterMod) => iterMod.isEnabled);

  const [lastPackCollisionCheckProgressIndex, setLastPackCollisionCheckProgressIndex] = React.useState(-1);
  const [isCompatOpen, setIsCompatOpen] = React.useState(false);
  const [isSpinnerClosed, setIsSpinnerClosed] = React.useState(true);
  const [useEnabledModsOnly, setUseEnabledModsOnly] = React.useState(true);

  useEffect(() => {
    if (!cachedIsCompatOpen && isCompatOpen) {
      console.log(
        "Compat Panel is opened, getCompatData called with useEnabledModsOnly:",
        useEnabledModsOnly
      );
      if (useEnabledModsOnly) {
        window.api?.getCompatData(enabledMods);
      } else {
        window.api?.getCompatData(mods);
      }
    }
    if (cachedIsCompatOpen && !isCompatOpen) {
      console.log("Compat Panel is closed, getting rid of compat data");
      dispatch(
        setPackCollisions({
          packFileCollisions: [],
          packTableCollisions: [],
          missingTableReferences: {},
          uniqueIdsCollisions: {},
          scriptListenerCollisions: {},
          packFileAnalysisErrors: {},
        })
      );
    }
    cachedIsCompatOpen = isCompatOpen;
  });

  if (
    lastPackCollisionCheckProgressIndex == -1 &&
    lastPackCollisionCheckProgressIndex != packCollisionsCheckProgress.currentIndex &&
    packCollisionsCheckProgress.currentIndex != packCollisionsCheckProgress.maxIndex
  ) {
    console.log(
      "in CompatScreen, first if",
      lastPackCollisionCheckProgressIndex,
      packCollisionsCheckProgress.currentIndex,
      packCollisionsCheckProgress.maxIndex
    );
    setLastPackCollisionCheckProgressIndex(packCollisionsCheckProgress.currentIndex);
    setIsSpinnerClosed(false);
  }
  if (
    lastPackCollisionCheckProgressIndex != -1 &&
    packCollisionsCheckProgress.currentIndex == packCollisionsCheckProgress.maxIndex
  ) {
    console.log(
      "in CompatScreen, second if",
      lastPackCollisionCheckProgressIndex,
      packCollisionsCheckProgress.currentIndex,
      packCollisionsCheckProgress.maxIndex
    );
    setIsSpinnerClosed(true);
    setLastPackCollisionCheckProgressIndex(-1);
  }

  const localized: Record<string, string> = useContext(localizationContext);
  const compatHelpTwo = ((localized.compatHelpTwo ?? "").includes("STAR_ICON") &&
    localized.compatHelpTwo.split("STAR_ICON")) || ["", ""];

  const groupedPackFileCollisions: Record<string, Record<string, string[]>> = {};
  if (packCollisions.packFileCollisions) {
    for (const pfCollision of packCollisions.packFileCollisions) {
      if (!groupedPackFileCollisions[pfCollision.firstPackName])
        groupedPackFileCollisions[pfCollision.firstPackName] = {};
      if (!groupedPackFileCollisions[pfCollision.firstPackName][pfCollision.secondPackName])
        groupedPackFileCollisions[pfCollision.firstPackName][pfCollision.secondPackName] = [];
      const collisionsWithSecond =
        groupedPackFileCollisions[pfCollision.firstPackName][pfCollision.secondPackName];
      if (collisionsWithSecond.every((collisiosWithSecond) => collisiosWithSecond != pfCollision.fileName)) {
        collisionsWithSecond.push(pfCollision.fileName);
      }
    }
  }

  const groupedPackTableCollisions: Record<string, Record<string, Record<string, PackTableCollision[]>>> = {};
  if (packCollisions.packTableCollisions) {
    for (const pfCollision of packCollisions.packTableCollisions) {
      if (!groupedPackTableCollisions[pfCollision.firstPackName])
        groupedPackTableCollisions[pfCollision.firstPackName] = {};
      if (!groupedPackTableCollisions[pfCollision.firstPackName][pfCollision.secondPackName])
        groupedPackTableCollisions[pfCollision.firstPackName][pfCollision.secondPackName] = {};
      const collisionsWithSecond =
        groupedPackTableCollisions[pfCollision.firstPackName][pfCollision.secondPackName];

      if (!collisionsWithSecond[pfCollision.secondFileName])
        collisionsWithSecond[pfCollision.secondFileName] = [];

      collisionsWithSecond[pfCollision.secondFileName].push(pfCollision);
    }
  }

  if (useEnabledModsOnly) {
    Object.keys(groupedPackFileCollisions).forEach((packName) => {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName);
      if (!mod) delete groupedPackFileCollisions[packName];
    });

    Object.keys(groupedPackFileCollisions).forEach((packName) => {
      const secondPackNames = Object.keys(groupedPackFileCollisions[packName]);
      secondPackNames.forEach((secondPackName) => {
        const mod = enabledMods.find((iterMod) => iterMod.name == secondPackName);
        if (!mod) delete groupedPackFileCollisions[packName][secondPackName];
      });
    });

    Object.keys(groupedPackTableCollisions).forEach((packName) => {
      const mod = enabledMods.find((iterMod) => iterMod.name == packName);
      if (!mod) delete groupedPackTableCollisions[packName];
    });

    Object.keys(groupedPackTableCollisions).forEach((packName) => {
      const secondPackNames = Object.keys(groupedPackTableCollisions[packName]);
      secondPackNames.forEach((secondPackName) => {
        const mod = enabledMods.find((iterMod) => iterMod.name == secondPackName);
        if (!mod) delete groupedPackTableCollisions[packName][secondPackName];
      });
    });
  }

  const numPackFileCollisions = Object.values(groupedPackFileCollisions).reduce(
    (acc, curr) => acc + Object.values(curr).reduce((acc2, curr2) => acc2 + Object.values(curr2).length, 0),
    0
  );

  const numPackTableCollisions = Object.values(groupedPackTableCollisions).reduce(
    (acc, curr) =>
      acc +
      Object.values(curr).reduce(
        (acc2, curr2) =>
          acc2 + Object.values(curr2).reduce((acc3, curr3) => acc3 + Object.values(curr3).length, 0),
        0
      ),
    0
  );

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
    0
  );

  const groupedUniqueIdsCollisions: Record<
    PackName,
    Record<DBFileName, Record<PackName, UniqueIdsCollision[]>>
  > = {};
  for (const [packName, uniqueIdsCollisions] of Object.entries(packCollisions.uniqueIdsCollisions)) {
    if (useEnabledModsOnly) {
      const mod =
        enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
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
            enabledMods.find((iterMod) => iterMod.name == secondPackName) ||
            vanillaPackNames.includes(secondPackName);
          if (!mod) {
            delete groupedUniqueIdsCollisions[packName][tableName][secondPackName];
          }
        }
      }
    }
  }

  const numUniqueIdsCollisions = Object.values(groupedUniqueIdsCollisions).reduce(
    (acc, curr) =>
      acc +
      Object.values(curr).reduce(
        (acc2, curr2) =>
          acc2 + Object.values(curr2).reduce((acc3, curr3) => acc3 + Object.values(curr3).length, 0),
        0
      ),
    0
  );

  const groupedScriptListenerCollisions: Record<PackName, ScriptListenerCollision[]> = {};
  for (const [packName, scriptListenerCollisions] of Object.entries(
    packCollisions.scriptListenerCollisions
  )) {
    if (useEnabledModsOnly) {
      const mod =
        enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
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
            groupedScriptListenerCollisions[packName].filter(
              (collision) => collision != scriptListenerCollision
            );
          }
        }
      }
    }
  }

  const numScriptListenerCollisions = Object.values(groupedScriptListenerCollisions).reduce(
    (acc, curr) => acc + curr.length,
    0
  );

  const groupedPackFileAnalysisErrors: Record<PackName, Record<string, FileAnalysisError[]>> = {};
  for (const [packName, packFileAnalysisErrors] of Object.entries(packCollisions.packFileAnalysisErrors)) {
    if (useEnabledModsOnly) {
      const mod =
        enabledMods.find((iterMod) => iterMod.name == packName) || vanillaPackNames.includes(packName);
      if (!mod) continue;
    }

    groupedPackFileAnalysisErrors[packName] = groupedPackFileAnalysisErrors[packName] || {};
    groupedPackFileAnalysisErrors[packName] = packFileAnalysisErrors;
  }

  const numPackFileAnalysisErrors = Object.values(groupedPackFileAnalysisErrors).reduce(
    (acc, curr) => acc + Object.values(curr).reduce((acc2, curr2) => acc2 + Object.values(curr2).length, 0),
    0
  );

  // console.log("groupedScriptListenerCollisions", groupedScriptListenerCollisions);

  const toggleUseEnabledModsOnly = useCallback(() => {
    if (useEnabledModsOnly) {
      console.log("READ ALL MODS");
      window.api?.readMods(mods, false);
    }
    setUseEnabledModsOnly(!useEnabledModsOnly);
  }, [useEnabledModsOnly, mods]);

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
              })
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
            <Tabs.Group style="underline">
              <Tabs.Item active={true} title={`${localized.files} (${numPackFileCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <span className="absolute top-[-4rem] right-0 flex items-center">
                    <input
                      type="checkbox"
                      id="compat-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => toggleUseEnabledModsOnly()}
                    ></input>
                    <label className="ml-2" htmlFor="compat-enabled-mod-only">
                      {localized.enabledModsOnly}
                    </label>
                  </span>
                  {packCollisions.packFileCollisions.length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noFileCollisionsFound}
                    </p>
                  )}
                  {packCollisions &&
                    packCollisions.packFileCollisions &&
                    Object.keys(groupedPackFileCollisions)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((firstPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPacks = groupedPackFileCollisions[firstPackName];
                        let donePackName = false;
                        return Object.keys(secondPacks)
                          .sort((firstPackName, secondPackName) => {
                            const firstPackIndex = sortedMods.indexOf(
                              sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                            );
                            const secondPackIndex = sortedMods.indexOf(
                              sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                            );

                            return firstPackIndex - secondPackIndex;
                          })
                          .map((secondPackName) => {
                            const secondPackIndex = sortedMods.indexOf(
                              sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                            );
                            let doneSecondPackName = false;
                            return secondPacks[secondPackName].map((secondPack) => {
                              const fragment = (
                                <React.Fragment key={firstPackName + secondPackName + secondPack}>
                                  {!donePackName && <div className="mt-4 underline">{firstPackName}</div>}
                                  {!doneSecondPackName && (
                                    <div className="ml-8">
                                      {secondPackName}
                                      {firstPackIndex > secondPackIndex && (
                                        <span className="ml-2 text-green-700">
                                          <FontAwesomeIcon fill="green" icon={faStar} />
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <div className="ml-16">{secondPack}</div>
                                </React.Fragment>
                              );
                              donePackName = true;
                              doneSecondPackName = true;
                              return fragment;
                            });
                          });
                      })}
                </div>
              </Tabs.Item>
              <Tabs.Item title={`${localized.tables} (${numPackTableCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <span className="absolute top-[-4rem] right-0 flex items-center">
                    <input
                      type="checkbox"
                      id="compat-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => toggleUseEnabledModsOnly()}
                    ></input>
                    <label className="ml-2" htmlFor="compat-enabled-mod-only">
                      {localized.enabledModsOnly}
                    </label>
                  </span>
                  {packCollisions.packTableCollisions.length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noDBKeyCollisionsFound}
                    </p>
                  )}
                  {packCollisions &&
                    packCollisions.packTableCollisions &&
                    Object.keys(groupedPackTableCollisions)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((firstPackName) => {
                        const secondPacks = groupedPackTableCollisions[firstPackName];
                        let donePackName = false;
                        return Object.keys(secondPacks)
                          .sort((firstPackName, secondPackName) => {
                            const firstPackIndex = sortedMods.indexOf(
                              sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                            );
                            const secondPackIndex = sortedMods.indexOf(
                              sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                            );

                            return firstPackIndex - secondPackIndex;
                          })
                          .map((secondPackName) => {
                            let doneSecondPackName = false;
                            return Object.keys(secondPacks[secondPackName]).map((secondFileName) => {
                              const collisions = secondPacks[secondPackName][secondFileName];
                              let doneSecondFileName = false;

                              return collisions.map((collision) => {
                                const firstBaseName = collision.fileName.replace(/.*\\/, "");
                                const secondBaseName = collision.secondFileName.replace(/.*\\/, "");

                                const dbNameMatches = collision.fileName.match(/.*?\\(.*?)\\.*?/);
                                const dbName = dbNameMatches && dbNameMatches[1];

                                const fragment = (
                                  <React.Fragment
                                    key={
                                      collision.firstPackName +
                                      donePackName +
                                      collision.secondPackName +
                                      doneSecondPackName +
                                      collision.fileName +
                                      collision.secondFileName +
                                      doneSecondFileName +
                                      collision.key +
                                      collision.value
                                    }
                                  >
                                    {!donePackName && <div className="mt-4 underline">{firstPackName}</div>}
                                    {!doneSecondPackName && <div className="ml-4">{secondPackName}</div>}
                                    {!doneSecondFileName && (
                                      <div className="ml-12">
                                        <span className="make-tooltip-inline">
                                          <Tooltip content={<p>{localized.dbTable}</p>}>
                                            <span className="text-center w-full">{dbName}</span>
                                          </Tooltip>
                                        </span>

                                        <span className="ml-2 make-tooltip-inline">
                                          <Tooltip
                                            content={
                                              <>
                                                <p>{localized.collisionWith}</p>
                                                <p>{firstBaseName}</p>
                                                <p>
                                                  {localized.in} {firstPackName}
                                                </p>
                                              </>
                                            }
                                          >
                                            <span className="text-center w-full">{secondBaseName}</span>
                                          </Tooltip>
                                        </span>
                                        <span className="ml-3 font-normal make-tooltip-inline">
                                          <Tooltip content={<p>{localized.tableColumn}</p>}>
                                            <span className="text-center w-full">{collision.key}</span>
                                          </Tooltip>
                                        </span>
                                        {compareModNames(firstBaseName, secondBaseName) == 1 && (
                                          <span className="ml-2 text-green-700">
                                            <FontAwesomeIcon fill="green" icon={faStar} />
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    <div className="ml-20">{collision.value}</div>
                                  </React.Fragment>
                                );
                                doneSecondFileName = true;
                                donePackName = true;
                                doneSecondPackName = true;
                                return fragment;
                              });
                            });
                          });
                      })}
                </div>
              </Tabs.Item>
              <Tabs.Item title={`${localized.missingKeys} (${numMissingTableReferences})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <span className="absolute top-[-4rem] right-0 flex items-center">
                    <input
                      type="checkbox"
                      id="compat-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => toggleUseEnabledModsOnly()}
                    ></input>
                    <label className="ml-2" htmlFor="compat-enabled-mod-only">
                      {localized.enabledModsOnly}
                    </label>
                  </span>
                  {Object.keys(groupedMissingTableReferences).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noMissingDBKeysFound}
                    </p>
                  )}
                  <div className="text-lg">
                    {Object.keys(groupedMissingTableReferences)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((firstPackName) => {
                        const tableKeyGroupToRefs = groupedMissingTableReferences[firstPackName];
                        return Object.keys(tableKeyGroupToRefs).map((tableKeyGroup) => {
                          const refs = tableKeyGroupToRefs[tableKeyGroup];
                          let donePackName = false;
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
                                  donePackName +
                                  doneTableKeyGroup
                                }
                              >
                                {!donePackName && <div className="mt-4 font-normal">{firstPackName}</div>}
                                {!doneTableKeyGroup && (
                                  <div className="ml-8">
                                    <span className="make-tooltip-inline">
                                      <Tooltip
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

                                <div className="ml-16">
                                  <span className="make-tooltip-inline">
                                    <Tooltip
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
                            donePackName = true;
                            doneTableKeyGroup = true;
                            return fragment;
                          });
                        });
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.duplicateKeys} (${numUniqueIdsCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <span className="absolute top-[-4rem] right-0 flex items-center">
                    <input
                      type="checkbox"
                      id="compat-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => toggleUseEnabledModsOnly()}
                    ></input>
                    <label className="ml-2" htmlFor="compat-enabled-mod-only">
                      {localized.enabledModsOnly}
                    </label>
                  </span>
                  {Object.keys(groupedUniqueIdsCollisions).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noDuplicateKeysFound}
                    </p>
                  )}
                  <div className="text-lg">
                    {Object.keys(groupedUniqueIdsCollisions)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((firstPackName) => {
                        const tableToUniqueIdCollisions = groupedUniqueIdsCollisions[firstPackName];
                        let donePackName = false;
                        return Object.keys(tableToUniqueIdCollisions).map((tableName) => {
                          const secondPackToUniqueIdCollisions = tableToUniqueIdCollisions[tableName];

                          let doneTableName = false;
                          return Object.keys(secondPackToUniqueIdCollisions)
                            .sort((firstPackName, secondPackName) => {
                              const firstPackIndex = sortedMods.indexOf(
                                sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                              );
                              const secondPackIndex = sortedMods.indexOf(
                                sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                              );

                              return firstPackIndex - secondPackIndex;
                            })
                            .map((secondPackName) => {
                              let doneSecondPackName = false;
                              const uniqueIdCollisions = secondPackToUniqueIdCollisions[secondPackName];
                              return uniqueIdCollisions.map((uniqueIdCollision) => {
                                const tableName = uniqueIdCollision.tableName;
                                const fieldName = uniqueIdCollision.fieldName;
                                const value = uniqueIdCollision.value;
                                const valueTwo = uniqueIdCollision.valueTwo;

                                const fragment = (
                                  <React.Fragment
                                    key={
                                      tableName +
                                      fieldName +
                                      value.value +
                                      firstPackName +
                                      secondPackName +
                                      donePackName +
                                      doneSecondPackName +
                                      doneTableName
                                    }
                                  >
                                    {!donePackName && <div className="mt-4 font-normal">{firstPackName}</div>}
                                    {!doneTableName && (
                                      <div className="ml-8 font-normal">
                                        <span className="make-tooltip-inline">
                                          <Tooltip
                                            content={
                                              <>
                                                <p>{localized.dbTable}</p>
                                              </>
                                            }
                                          >
                                            <span className="text-center w-full">{tableName}</span>
                                          </Tooltip>
                                        </span>
                                      </div>
                                    )}
                                    {!doneSecondPackName && (
                                      <div className="ml-16">
                                        <span className="make-tooltip-inline">
                                          <Tooltip
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

                                    <div className="ml-24">
                                      <div className="make-tooltip-inline">
                                        <Tooltip
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

                                doneTableName = true;
                                doneSecondPackName = true;
                                donePackName = true;
                                return fragment;
                              });
                            });
                        });
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.duplicateListenerNames} (${numScriptListenerCollisions})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <span className="absolute top-[-4rem] right-0 flex items-center">
                    <input
                      type="checkbox"
                      id="compat-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => toggleUseEnabledModsOnly()}
                    ></input>
                    <label className="ml-2" htmlFor="compat-enabled-mod-only">
                      {localized.enabledModsOnly}
                    </label>
                  </span>
                  {Object.keys(groupedScriptListenerCollisions).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noDuplicateListenerNamesFound}
                    </p>
                  )}
                  <div className="text-lg">
                    {Object.keys(groupedScriptListenerCollisions)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((packName) => {
                        const scriptListenerCollisions = groupedScriptListenerCollisions[packName];
                        let donePackName = false;
                        return scriptListenerCollisions.map((collision) => {
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
                              {!donePackName && <div className="mt-4 font-normal">{packName}</div>}
                              <div className="ml-8 font-normal">
                                <span className="make-tooltip-inline">
                                  <Tooltip
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

                              <div className="ml-24">
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
                                      {value.packFileName} in {packName}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </React.Fragment>
                          );

                          donePackName = true;
                          return fragment;
                        });
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={`${localized.fileErrors} (${numPackFileAnalysisErrors})`}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <span className="absolute top-[-4rem] right-0 flex items-center">
                    <input
                      type="checkbox"
                      id="compat-enabled-mod-only"
                      checked={useEnabledModsOnly}
                      onChange={() => toggleUseEnabledModsOnly()}
                    ></input>
                    <label className="ml-2" htmlFor="compat-enabled-mod-only">
                      {localized.enabledModsOnly}
                    </label>
                  </span>
                  {Object.keys(groupedPackFileAnalysisErrors).length == 0 && (
                    <p className="pt-16 text-lg font-normal text-gray-500 lg:text-xl sm:px-16 dark:text-gray-400 text-center">
                      {localized.noFileErrorsFound}
                    </p>
                  )}
                  <div className="text-lg">
                    {Object.keys(groupedPackFileAnalysisErrors)
                      .sort((firstPackName, secondPackName) => {
                        const firstPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == firstPackName) as Mod
                        );
                        const secondPackIndex = sortedMods.indexOf(
                          sortedMods.find((iterMod) => iterMod.name == secondPackName) as Mod
                        );

                        return firstPackIndex - secondPackIndex;
                      })
                      .map((packName) => {
                        const packFileToErrors = groupedPackFileAnalysisErrors[packName];

                        let donePackName = false;
                        return Object.keys(packFileToErrors).map((packFileName) => {
                          const errors = packFileToErrors[packFileName];
                          return errors.map((error) => {
                            const packName = error.packName;
                            const packFileName = error.packFileName;
                            const msg = error.msg;

                            const fragment = (
                              <React.Fragment key={packName + packFileName + msg}>
                                {!donePackName && <div className="mt-4 font-normal">{packName}</div>}
                                <div className="ml-8 font-normal">
                                  <span className="make-tooltip-inline">
                                    <Tooltip
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

                                <div className="ml-24">
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

                            donePackName = true;
                            return fragment;
                          });
                        });
                      })}
                  </div>
                </div>
              </Tabs.Item>

              <Tabs.Item title={localized.help}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <p>
                    {compatHelpTwo[0]}
                    <span className="mx-1 text-green-700">
                      <FontAwesomeIcon fill="green" icon={faStar} />
                    </span>
                    {compatHelpTwo[1]}
                  </p>
                  <p>{localized.compatHelpOne}</p>
                  <p className="mt-6">{localized.compatHelpThree}</p>
                  <p className="mt-6">{localized.compatHelpFour}</p>
                  <p className="mt-6">{localized.compatHelpFive}</p>
                  <p className="mt-6">{localized.compatHelpSix}</p>
                  <p className="mt-6">{localized.compatHelpSeven}</p>
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
          {packCollisionsCheckProgress.firstPackName != "" &&
            packCollisionsCheckProgress.secondPackName != "" && (
              <p className="mb-4">
                {localized.comparingFilesInPacks &&
                  localized.comparingFilesInPacks
                    .replace("<firstPackName>", packCollisionsCheckProgress.firstPackName)
                    .replace("<secondPackName>", packCollisionsCheckProgress.secondPackName)}
              </p>
            )}
          {packCollisionsCheckProgress.firstPackName != "" &&
            packCollisionsCheckProgress.secondPackName == "" && (
              <p className="mb-4">
                {localized.comparingKeysInPacks.replace(
                  "<firstPackName>",
                  packCollisionsCheckProgress.firstPackName
                )}
              </p>
            )}
          <div className="w-full h-5 bg-gray-200 rounded-full dark:bg-gray-600">
            <div
              className="h-5 bg-blue-600 rounded-full dark:bg-blue-500"
              style={{
                width: `${
                  (packCollisionsCheckProgress.currentIndex / packCollisionsCheckProgress.maxIndex) * 100
                }%`,
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
