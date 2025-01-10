import { Modal } from "../flowbite";
import React, { memo, useContext, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { addToast, setIsImportSteamCollectionOpen } from "../appSlice";
import localizationContext from "../localizationContext";

const ImportSteamCollection = memo(() => {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.app.isImportSteamCollectionOpen);
  const presets = useAppSelector((state) => state.app.presets);
  const [areNonCollectionModsToBeDisabled, setAreNonCollectionModsToBeDisabled] = useState(false);
  const [doImportWithLoadOrder, setDoImportWithLoadOrder] = useState(false);
  const [doPresetImportWithLoadOrder, setDoPresetImportWithLoadOrder] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [doImmediateImport, setDoImmediateImport] = useState(false);
  const [doPresetImport, setDoPresetImport] = useState(false);
  const [steamCollectionURL, setSteamCollectionURL] = useState("");

  const presetAlreadyExists = presets.some((preset) => preset.name == presetName);

  const localized: Record<string, string> = useContext(localizationContext);

  const onImportSteamCollectionClicked = () => {
    if (steamCollectionURL && steamCollectionURL != "")
      window.api?.importSteamCollection(
        steamCollectionURL,
        doImmediateImport,
        areNonCollectionModsToBeDisabled,
        doImportWithLoadOrder,
        doPresetImport,
        presetName,
        doPresetImportWithLoadOrder
      );
  };

  const onSetPresetNameChanged = (newPresetName: string) => {
    setPresetName(newPresetName);
  };

  const onSteamCollectionURLChanged = async (steamCollectionURL: string) => {
    console.log("onSteamCollectionURLChanged");
    try {
      setSteamCollectionURL(steamCollectionURL);
      if (steamCollectionURL == "") {
        return;
      }
      const steamCollectionTitle = await window.api?.getSteamCollectionName(steamCollectionURL);
      console.log("new:", steamCollectionTitle);
      if (steamCollectionTitle && steamCollectionTitle != "") {
        setPresetName(steamCollectionTitle);
      } else {
        dispatch(
          addToast({
            messages: ["loc:failedFetchingSteamCollection"],
            startTime: Date.now(),
            type: "warning",
          })
        );
      }
    } catch (e) {
      dispatch(
        addToast({
          messages: ["loc:failedFetchingSteamCollection"],
          startTime: Date.now(),
          type: "warning",
        })
      );
      console.log(e);
    }
  };

  return (
    <>
      {isOpen && (
        <Modal
          show={isOpen}
          // show={true}
          onClose={() => dispatch(setIsImportSteamCollectionOpen(false))}
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
            <span className="max-w-5xl">{localized.importSteamCollection}</span>
          </Modal.Header>

          <Modal.Body>
            <div className="flex flex-col gap-x-4 z-10 leading-relaxed dark:text-gray-300 relative font-normal items-center">
              <div className="mt-3 m-auto text-center">
                <p>{localized.importSteamCollectionMsg1}</p>
                <p>{localized.importSteamCollectionMsg2}</p>
              </div>
              <div className="flex gap-x-4 items-center w-3/4 mt-6">
                <span className="w-full">
                  <input
                    type="text"
                    onChange={(e) => onSteamCollectionURLChanged(e.currentTarget.value.trim())}
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                  ></input>
                </span>
                <button
                  className="inline-block px-6 py-2.5 bg-purple-600 text-white font-medium text-xs leading-tight rounded shadow-md hover:bg-purple-700 hover:shadow-lg focus:bg-purple-700 focus:shadow-lg focus:outline-none focus:ring-0 active:bg-purple-800 active:shadow-lg transition duration-150 ease-in-out m-auto w-56"
                  onClick={(e) => {
                    onImportSteamCollectionClicked();
                  }}
                >
                  <span className="uppercase">{localized.Import}</span>
                </button>
              </div>
              <div>
                <div className="flex items-center mt-12">
                  <div className="flex relative">
                    <div className="absolute flex justify-center font-normal text-lg items-center bg-gray-700 w-80 h-6 top-[-12px] left-8 rounded mt-[-0.05rem]">
                      <input
                        type="checkbox"
                        id="do-immediate-import"
                        checked={doImmediateImport}
                        onChange={() => {
                          setDoImmediateImport(!doImmediateImport);
                        }}
                      ></input>
                      <label className="ml-2" htmlFor="do-immediate-import">
                        {localized.importSteamCollectionEnableCollectionMods}
                      </label>
                    </div>
                    <div
                      className={
                        "rounded border w-[32rem] flex justify-center flex-col p-5 gap-4 " +
                        ((doImmediateImport && "border-blue-500") || "border-slate-400")
                      }
                    >
                      <div>
                        <div className="flex items-center">
                          <input
                            className={`${!doImmediateImport && "grayscale [&:not(:checked)]:bg-blue-600"}`}
                            disabled={!doImmediateImport}
                            type="checkbox"
                            id="disable-mods-not-in-collection"
                            checked={areNonCollectionModsToBeDisabled}
                            onChange={() => {
                              setAreNonCollectionModsToBeDisabled(!areNonCollectionModsToBeDisabled);
                            }}
                          ></input>
                          <label className="ml-2" htmlFor="disable-mods-not-in-collection">
                            {localized.importSteamCollectionDisableOtherMods}
                          </label>
                        </div>
                        <div className="ml-6 text-sm">
                          {localized.importSteamCollectionDisableOtherModsMsg}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center">
                          <input
                            className={`${!doImmediateImport && "grayscale [&:not(:checked)]:bg-blue-600"}`}
                            disabled={!doImmediateImport}
                            type="checkbox"
                            id="import-with-explicit-load-order"
                            checked={doImportWithLoadOrder}
                            onChange={() => {
                              setDoImportWithLoadOrder(!doImportWithLoadOrder);
                            }}
                          ></input>
                          <label className="ml-2" htmlFor="import-with-explicit-load-order">
                            {localized.importSteamCollectionUseLoadOrder}
                          </label>
                        </div>
                        <div className="ml-6 text-sm">{localized.importSteamCollectionUseLoadOrderMsg}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center mt-6">
                  <div className="flex relative">
                    <div className="absolute flex justify-center font-normal text-lg items-center bg-gray-700 w-56 h-6 top-[-12px] left-8 rounded mt-[-0.05rem]">
                      <input
                        type="checkbox"
                        checked={doPresetImport}
                        id="import-into-preset"
                        onChange={() => {
                          setDoPresetImport(!doPresetImport);
                        }}
                      ></input>
                      <label className="ml-2" htmlFor="import-into-preset">
                        {localized.importSteamCollectionImportIntoPreset}
                      </label>
                    </div>
                    <div
                      className={
                        "rounded border w-[32rem] flex justify-center flex-col p-5 gap-4 " +
                        ((doPresetImport && "border-blue-500") || "border-slate-400")
                      }
                    >
                      <div>
                        <span className="whitespace-nowrap">{localized.importSteamCollectionPresetName}</span>
                        <input
                          type="text"
                          value={presetName}
                          disabled={!doPresetImport}
                          onChange={(e) => onSetPresetNameChanged(e.target.value.trim())}
                          className={
                            "bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 " +
                            (!doPresetImport && "cursor-not-allowed")
                          }
                        ></input>

                        <div className="ml-6 text-sm">
                          {localized.importSteamCollectionPresetNameMsg1}
                          {presetAlreadyExists && (
                            <div className="text-yellow-300">
                              {localized.importSteamCollectionPresetNameMsg2}
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center">
                          <input
                            className={`${!doPresetImport && "grayscale [&:not(:checked)]:bg-blue-600"}`}
                            type="checkbox"
                            disabled={!doPresetImport}
                            checked={doPresetImportWithLoadOrder}
                            id="import-preset-with-explicit-load-order"
                            onChange={() => {
                              setDoPresetImportWithLoadOrder(!doPresetImportWithLoadOrder);
                            }}
                          ></input>
                          <label className="ml-2" htmlFor="import-preset-with-explicit-load-order">
                            {localized.importSteamCollectionUseLoadOrder}
                          </label>
                        </div>
                        <div className="ml-6 text-sm">
                          {localized.importSteamCollectionUsePresetLoadOrderMsg}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});

export default ImportSteamCollection;
