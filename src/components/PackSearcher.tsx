import { Modal } from "../flowbite";
import React, { memo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { setIsPackSearcherOpen, setPackSearchResults } from "../appSlice";
import { useLocalizations } from "../localizationContext";

const PackSearcher = memo(() => {
  const dispatch = useAppDispatch();
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const alwaysEnabledMods = useAppSelector((state) => state.app.alwaysEnabledMods);
  const isOpen = useAppSelector((state) => state.app.isPackSearcherOpen);
  const packSearchResults = useAppSelector((state) => state.app.packSearchResults);

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const enabledMods = mods.filter(
    (iterMod) => iterMod.isEnabled || alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
  );

  const localized = useLocalizations();

  const onSearchClicked = () => {
    if (searchTerm == "") {
      setIsSearching(false);
      return;
    }
    dispatch(setPackSearchResults(undefined));
    setIsSearching(true);
    window.api?.searchInsidePacks(searchTerm, enabledMods);
  };

  const onSearchTermChanged = async (newSearchTerm: string) => {
    console.log("onSteamCollectionURLChanged");
    setSearchTerm(newSearchTerm);
  };

  return (
    <>
      {isOpen && (
        <Modal
          show={isOpen}
          onClose={() => {
            setIsSearching(false);
            dispatch(setIsPackSearcherOpen(false));
          }}
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
            <span className="max-w-5xl">{localized.searchInsidePacks}</span>
          </Modal.Header>

          <Modal.Body>
            <div className="flex flex-col gap-x-4 z-10 leading-relaxed dark:text-gray-300 relative font-normal items-center">
              <div className="mt-3 m-auto space-y-3 text-center max-w-[75%]">
                <p>{localized.searchInsidePacksMsg1}</p>
                <p>{localized.searchInsidePacksMsg2}</p>
                <p>{localized.searchInsidePacksMsg3}</p>
              </div>
              <div className="flex gap-x-4 items-center w-3/4 mt-6">
                <span className="w-full">
                  <input
                    type="text"
                    onChange={(e) => onSearchTermChanged(e.currentTarget.value.trim())}
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                  ></input>
                </span>
                <button
                  className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-56"
                  onClick={() => {
                    onSearchClicked();
                  }}
                >
                  <span className="uppercase">{localized.search}</span>
                </button>
              </div>
              <div className="flex flex-col items-center mt-12">
                {packSearchResults && (
                  <>
                    <div>{localized.searchInsidePacksResults}</div>
                    {(packSearchResults.length > 0 &&
                      packSearchResults.map((packName) => <div key={packName}>{packName}</div>)) ||
                      "None"}
                  </>
                )}
                {!packSearchResults && isSearching && (
                  <>
                    <div>Searching...</div>
                  </>
                )}
              </div>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});

export default PackSearcher;
