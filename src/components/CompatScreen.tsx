import React, { memo, useCallback, useContext } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Modal } from "../flowbite/components/Modal/index";
import { Spinner, Tabs, Tooltip } from "../flowbite";
import { compareModNames, sortByNameAndLoadOrder } from "../modSortingHelpers";
import { faStar } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { PackTableCollision } from "../packFileTypes";
import { setPackCollisions } from "../appSlice";
import localizationContext from "../localizationContext";

const CompatScreen = memo(() => {
  const dispatch = useAppDispatch();
  const packCollisions = useAppSelector((state) => state.app.packCollisions);
  const pathsOfReadPacks = useAppSelector((state) => state.app.pathsOfReadPacks);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const sortedMods = sortByNameAndLoadOrder(mods);
  const enabledMods = sortedMods.filter((iterMod) => iterMod.isEnabled);

  const [isCompatOpen, setIsCompatOpen] = React.useState(false);
  const [isSpinnerClosed, setIsSpinnerClosed] = React.useState(false);
  const [useEnabledModsOnly, setUseEnabledModsOnly] = React.useState(true);

  const localized: Record<string, string> = useContext(localizationContext);
  const compatHelpTwo = ((localized.compatHelpTwo ?? "").includes("STAR_ICON") &&
    localized.compatHelpTwo.split("STAR_ICON")) || ["", ""];

  const isPackProcessingDone = ((useEnabledModsOnly && enabledMods) || mods).every((mod) =>
    pathsOfReadPacks.some((path) => path == mod.path)
  );

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
            setIsCompatOpen((wasOpen) => {
              if (!wasOpen) {
                if (useEnabledModsOnly) {
                  window.api?.getCompatData(enabledMods);
                } else {
                  window.api?.getCompatData(mods);
                }
              } else {
                dispatch(setPackCollisions({ packFileCollisions: [], packTableCollisions: [] }));
              }
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
            dispatch(setPackCollisions({ packFileCollisions: [], packTableCollisions: [] }));
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
              <Tabs.Item active={true} title={localized.files}>
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
              <Tabs.Item title={localized.tables}>
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
              <Tabs.Item title={localized.help}>
                <div className="leading-relaxed dark:text-gray-300 relative">
                  <p>{localized.compatHelpOne}</p>
                  <p>
                    {compatHelpTwo[0]}
                    <span className="mx-1 text-green-700">
                      <FontAwesomeIcon fill="green" icon={faStar} />
                    </span>
                    {compatHelpTwo[1]}
                  </p>
                  <p className="mt-6">{localized.compatHelpThree}</p>
                </div>
              </Tabs.Item>
            </Tabs.Group>
          </Modal.Body>
        </Modal>
      )}

      <Modal
        onClose={() => setIsSpinnerClosed(true)}
        show={!isSpinnerClosed && isCompatOpen && !isPackProcessingDone}
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
export default CompatScreen;
