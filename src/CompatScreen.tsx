import React, { memo } from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import { Modal } from "./flowbite/components/Modal/index";
import { Spinner, Tabs, Tooltip } from "./flowbite";
import { compareModNames, sortByNameAndLoadOrder } from "./modSortingHelpers";
import { faStar } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { PackTableCollision } from "./packFileTypes";
import { setPackCollisions } from "./appSlice";

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

  const toggleUseEnabledModsOnly = () => {
    if (useEnabledModsOnly) {
      console.log("READ ALL MODS");
      window.api?.readMods(mods);
    }
    setUseEnabledModsOnly(!useEnabledModsOnly);
  };

  return (
    <div>
      <div className="text-center mt-4">
        <button
          onClick={() =>
            setIsCompatOpen((wasOpen) => {
              if (!wasOpen) {
                window.api?.getCompatData();
              } else {
                dispatch(setPackCollisions({ packFileCollisions: [], packTableCollisions: [] }));
              }
              return !isCompatOpen;
            })
          }
          className="w-36 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mx-2 mb-2 m-auto dark:bg-transparent dark:hover:bg-gray-700 dark:border-gray-600 dark:border-2 focus:outline-none dark:focus:ring-gray-800"
          type="button"
        >
          Check Compat
        </button>
      </div>

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
          "!max-w-7xl",
          "md:!h-full",
          ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
        ]}
      >
        <Modal.Header>Mod Compatibility</Modal.Header>
        <Modal.Body>
          <Tabs.Group style="underline">
            <Tabs.Item active={true} title="Files">
              <div className="leading-relaxed dark:text-gray-300 relative">
                <span className="absolute top-[-4rem] right-0 flex items-center">
                  <input
                    type="checkbox"
                    id="compat-enabled-mod-only"
                    checked={useEnabledModsOnly}
                    onChange={() => toggleUseEnabledModsOnly()}
                  ></input>
                  <label className="ml-2" htmlFor="compat-enabled-mod-only">
                    Enabled Mods Only
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
            <Tabs.Item title="Tables">
              <div className="leading-relaxed dark:text-gray-300 relative">
                <span className="absolute top-[-4rem] right-0 flex items-center">
                  <input
                    type="checkbox"
                    id="compat-enabled-mod-only"
                    checked={useEnabledModsOnly}
                    onChange={() => toggleUseEnabledModsOnly()}
                  ></input>
                  <label className="ml-2" htmlFor="compat-enabled-mod-only">
                    Enabled Mods Only
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
                                        <Tooltip content={<p>DB Table</p>}>
                                          <span className="text-center w-full">{dbName}</span>
                                        </Tooltip>
                                      </span>

                                      <span className="ml-2 make-tooltip-inline">
                                        <Tooltip
                                          content={
                                            <>
                                              <p>Collision with</p>
                                              <p>{firstBaseName}</p>
                                              <p>in {firstPackName}</p>
                                            </>
                                          }
                                        >
                                          <span className="text-center w-full">{secondBaseName}</span>
                                        </Tooltip>
                                      </span>
                                      <span className="ml-3 font-normal make-tooltip-inline">
                                        <Tooltip content={<p>Table Column</p>}>
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
            <Tabs.Item title="Help">
              <div className="leading-relaxed dark:text-gray-300 relative">
                <p>
                  The Files tab covers whole files that overwrite each other, these are usually related to
                  unit visuals: .dds textures, .wsmodel and .variantmeshdefinition files that define how a
                  unit's look is constructed ingame. The game will use the file from the mod with higher load
                  order priority, so between two mod that apply visual changes the ingame result will depend
                  on the relative priority of the two mods.
                </p>
                <p>
                  In the panel the "parent" (underlined) mod will have priority unless a
                  <span className="mx-1 text-green-700">
                    <FontAwesomeIcon fill="green" icon={faStar} />
                  </span>
                  is next to the "child" mod name.
                </p>
                <p className="mt-6">
                  The Tables tab covers keys in database tables that conflict with each other. Database tables
                  usually are related to units stats. For example overhaul submods that affect unit stats will
                  always have collisions here. Unlike in the Files tab, here the actual table names are
                  compared to determine priority, not pack names. So changing load order won't affect anything
                  here.
                </p>
              </div>
            </Tabs.Item>
          </Tabs.Group>
        </Modal.Body>
      </Modal>
      <Modal
        onClose={() => setIsSpinnerClosed(true)}
        show={!isSpinnerClosed && isCompatOpen && !isPackProcessingDone}
        size="2xl"
        position="center"
      >
        <Modal.Header>Reading And Comparing Packs...</Modal.Header>
        <Modal.Body>
          <p className="self-center text-base leading-relaxed text-gray-500 dark:text-gray-300">
            Wait until all the mod packs have been read and compared with each other...
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
