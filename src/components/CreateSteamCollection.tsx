import { Modal, Tooltip } from "../flowbite";
import React, { memo } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setIsCreateSteamCollectionOpen } from "../appSlice";

const CreateSteamCollection = memo(() => {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.app.isCreateSteamCollectionOpen);

  const onGoToSteamCreateCollectionPageClicked = () => {
    window.open(`https://steamcommunity.com/workshop/editcollection/?appid=1142710`);
  };

  const presetMods = useAppSelector((state) => state.app.currentPreset.mods);
  const allMods = useAppSelector((state) => state.app.allMods);
  const enabledMods = presetMods.filter((mod) => mod.isEnabled);

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
            "!max-w-5xl",
            "md:!h-full",
            ..."scrollbar scrollbar-track-gray-700 scrollbar-thumb-blue-700".split(" "),
          ]}
        >
          <Modal.Header>
            <span className="max-w-5xl">Create Steam Collection</span>
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
                        <div>
                          Will open the web page for creating a WH3 Steam Workshop collection in the browser.
                        </div>
                      </>
                    }
                  >
                    <span className="uppercase">Open Steam Page For Creating WH3 Collections</span>
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
                        <div>
                          Will paste into clipboard a script for populating currently enabled mods into a
                          collection.
                        </div>
                        <div>Hold Shift if you want to copy all mods, not just enabled mods.</div>
                      </>
                    }
                  >
                    <span className="uppercase">Copy Collection Script To Clipboard</span>
                  </Tooltip>
                </button>
              </div>

              <h6 className="mt-10 -mb-5">Instructions</h6>
              <div className="border border-gray-600 w-[80%]"></div>
              <div className="">
                This is a way to export mods into a Steam collection. It's not automatic and relies on running
                a console script in your browser to automate button presses in the browser.
              </div>
              <div className="">
                Open the create new Steam Workshop collection page in a browser. In the first page a
                collection name and an image thumbnail are mandatory. In the second page where you select what
                mods to add to the collection press Ctrl+Shift+I and switch to the console tab from the tabs
                in upper right:
              </div>
              <img className="" src={require("../assets/steam_collection_open_console.png")}></img>
              <div className="">
                Paste the script you recieved from pressing the "Copy Creation Script To Clipboard" button
                into the console and press enter:
              </div>
              <img className="" src={require("../assets/steam_collection_pasted_script.png")}></img>
              <div className="">
                Two buttons will appear, one to add mods to the collection and a reset button that removes any
                added mods. Click the green + button that appears and wait for the page to reload.
              </div>
              <img className="" src={require("../assets/steam_collection_buttons.png")}></img>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});

export default CreateSteamCollection;
