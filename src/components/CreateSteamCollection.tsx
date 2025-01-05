import { Modal } from "../flowbite";
import { Tooltip } from "flowbite-react";
import React, { memo, useContext } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setIsCreateSteamCollectionOpen } from "../appSlice";
import localizationContext from "../localizationContext";
import { gameToSteamId } from "../supportedGames";

const CreateSteamCollection = memo(() => {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.app.isCreateSteamCollectionOpen);
  const currentGame = useAppSelector((state) => state.app.currentGame);

  const onGoToSteamCreateCollectionPageClicked = () => {
    window.open(`https://steamcommunity.com/workshop/editcollection/?appid=${gameToSteamId[currentGame]}`);
  };

  const presetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const allMods = useAppSelector((state) => state.app.allMods);
  const enabledMods = presetMods.filter((mod) => mod.isEnabled);

  const localized: Record<string, string> = useContext(localizationContext);

  const enabledPresetWorkshopMods = enabledMods
    .map(
      (mod) => (!mod.isInData && mod) || allMods.find((allMod) => !allMod.isInData && allMod.name == mod.name)
    )
    .filter((workshopId): workshopId is Mod => !!workshopId);

  const allPresetWorkshopMods = presetMods
    .map(
      (mod) => (!mod.isInData && mod) || allMods.find((allMod) => !allMod.isInData && allMod.name == mod.name)
    )
    .filter((workshopId): workshopId is Mod => !!workshopId);

  const onCopyCollectionCreationScriptClicked = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    if (e.shiftKey) {
      window.api?.createSteamCollection(allPresetWorkshopMods);
    } else {
      window.api?.createSteamCollection(enabledPresetWorkshopMods);
    }
  };

  return (
    <>
      {isOpen && (
        <Modal
          show={isOpen}
          // show={true}
          onClose={() => dispatch(setIsCreateSteamCollectionOpen(false))}
          size="2xl"
          position="top-center"
          explicitClasses={[
            "mt-8",
            "!max-w-5xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
            "modalDontOverflowWindowHeight",
          ]}
        >
          <Modal.Header>
            <span className="max-w-5xl">{localized.createSteamCollection}</span>
          </Modal.Header>

          <Modal.Body>
            <div className="flex flex-col gap-y-6 gap-x-4 z-10 leading-relaxed dark:text-gray-300 relative font-normal items-center">
              <div className="flex mt-2 w-[75%]">
                <button
                  className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                  onClick={() => onGoToSteamCreateCollectionPageClicked()}
                >
                  <Tooltip
                    placement="top"
                    style="light"
                    content={
                      <>
                        <div>{localized.openSteamCollectionsPageTooltip}</div>
                      </>
                    }
                  >
                    <span className="uppercase">{localized.openSteamCollectionsPage}</span>
                  </Tooltip>
                </button>
              </div>

              <div className="flex mt-2 w-[75%]">
                <button
                  className="make-tooltip-w-full inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-[70%]"
                  onClick={(e) => onCopyCollectionCreationScriptClicked(e)}
                >
                  <Tooltip
                    placement="top"
                    style="light"
                    content={
                      <>
                        <div>{localized.copyCollectionScriptTooltip1}</div>
                        <div>{localized.copyCollectionScriptTooltip2}</div>
                      </>
                    }
                  >
                    <span className="uppercase">{localized.copyCollectionScript}</span>
                  </Tooltip>
                </button>
              </div>

              <h6 className="mt-8 -mb-5 font-semibold text-xl">{localized.instructions}</h6>
              <div className="border border-gray-600 w-[80%]"></div>
              <div className="">{localized.createSteamCollectionHelp1}</div>
              <div className="">{localized.createSteamCollectionHelp2}</div>
              <img className="" src={require("../assets/steam_collection_open_console.png")}></img>
              <div className="">{localized.createSteamCollectionHelp3}</div>
              <img className="" src={require("../assets/steam_collection_pasted_script.png")}></img>
              <div className="">{localized.createSteamCollectionHelp4}</div>
              <img className="" src={require("../assets/steam_collection_buttons.png")}></img>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});

export default CreateSteamCollection;
