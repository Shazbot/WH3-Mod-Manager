import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useCallback, useContext, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import localizationContext from "../localizationContext";
import selectStyle from "../styles/selectStyle";
import Select, { ActionMeta, SingleValue } from "react-select";
import { setIsModTagPickerOpen, setTagForMod } from "../appSlice";

type OptionType = {
  value: string;
  label: string;
};

const options: OptionType[] = [
  "graphical",
  "campaign",
  "units",
  "battle",
  "ui",
  "maps",
  "overhaul",
  "compilation",
  "cheat",
].map((tag) => ({ value: tag, label: tag }));

const ModTagPicker = memo(() => {
  const dispatch = useAppDispatch();

  const isModTagPickerOpen = useAppSelector((state) => state.app.isModTagPickerOpen);
  const currentModToUpload = useAppSelector((state) => state.app.currentModToUpload);

  const [currentTag, setCurrentTag] = useState<string>("graphical");

  const onUploadMod = () => {
    if (currentModToUpload) {
      window.api?.uploadMod({ ...currentModToUpload, tags: ["mod", currentTag] });
      dispatch(setIsModTagPickerOpen(false));
    }
  };

  const onClose = useCallback(() => {
    dispatch(setIsModTagPickerOpen(false));
  }, []);

  const onTagChange = (newValue: SingleValue<OptionType>, actionMeta: ActionMeta<OptionType>) => {
    if (!newValue) return;
    if (!currentModToUpload) return;

    console.log(`label: ${newValue.label}, value: ${newValue.value}, action: ${actionMeta.action}`);
    if (actionMeta.action === "select-option") {
      setCurrentTag(newValue.value);
      dispatch(setTagForMod({ mod: currentModToUpload, tag: newValue.value }));
    }
  };

  const localized: Record<string, string> = useContext(localizationContext);

  return (
    <>
      {currentModToUpload && isModTagPickerOpen && (
        <Modal
          show={isModTagPickerOpen}
          onClose={onClose}
          size="lg"
          position="top-center"
          explicitClasses={["mt-8", "modalDontOverflowWindowHeight", "modalGiveChildVisibleOverflow"]}
        >
          <Modal.Header>{localized.uploadMod}</Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-4">
              <span className="text-slate-100 select-none text-center w-full">
                {localized.chooseNewModTag}
              </span>
              <Select
                options={options}
                styles={selectStyle}
                onChange={onTagChange}
                defaultValue={options[0]}
              ></Select>
              <button
                className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded text-sm m-auto "
                type="button"
                onClick={() => onUploadMod()}
              >
                {localized.upload}
              </button>
            </div>
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});
export default ModTagPicker;
