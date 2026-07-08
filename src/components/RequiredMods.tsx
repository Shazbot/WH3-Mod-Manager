import { Modal } from "../flowbite/components/Modal/index";
import React, { memo, useContext, useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { toggleIgnoredMissingReqMods, toggleMod } from "../appSlice";
import localizationContext from "../localizationContext";
import { MissingModDependency, splitIgnoredMissingModDependencies } from "../utility/frontend/missingModDependencies";

const subbedModIdsToWaitFor: string[] = [];

export interface RequiredModsProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modDependencies: MissingModDependency[];
}

interface MissingModGroupsProps {
  modDependencies: MissingModDependency[];
  onModClick: (name: string, id: string) => void;
}

/**
 * Lists missing required mods grouped under the mod that requires them, with ignored groups in their own section.
 * @param props The missing mod groups and the enable handler.
 * @returns The grouped list.
 */
const MissingModGroups = ({ modDependencies, onModClick }: MissingModGroupsProps) => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);

  const allMods = useAppSelector((state) => state.app.allMods);
  const installedWorkshopIds = useMemo(() => new Set(allMods.map((mod) => mod.workshopId)), [allMods]);
  const ignoredMissingReqModNames = useAppSelector((state) => state.app.ignoredMissingReqModNames);
  const [ignoredNamesAtOpen] = useState(() => ignoredMissingReqModNames);
  const { active, ignored } = splitIgnoredMissingModDependencies(modDependencies, ignoredNamesAtOpen);

  const renderGroup = ([mod, reqs]: MissingModDependency) => (
    <div key={mod.path} className="rounded-md border border-gray-200 dark:border-gray-600 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-4 px-3 py-2">
        <div className="font-semibold text-gray-700 dark:text-gray-100">
          {mod.humanName || mod.name}
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
            {`${reqs.length} ${localized.missingRequiredModsCount || "missing"}`}
          </span>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <input
            type="checkbox"
            checked={ignoredMissingReqModNames.includes(mod.name)}
            onChange={() => dispatch(toggleIgnoredMissingReqMods([mod.name]))}
          />
          {localized.ignoreMissingRequiredMods || "Ignore"}
        </label>
      </div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-t border-gray-200 px-3 py-2 dark:border-gray-700">
        {reqs.map(([reqId, reqHumanName]) => (
          <React.Fragment key={reqId}>
            <div className="text-base leading-relaxed text-gray-500 dark:text-gray-300">{reqHumanName}</div>
            <button
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
              type="button"
              onClick={() => onModClick(reqHumanName, reqId)}
            >
              {installedWorkshopIds.has(reqId) ? `Enable` : `Subscribe And Enable`}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {active.map(renderGroup)}
      {ignored.length > 0 && (
        <div className="space-y-3 opacity-60">
          <div className="pt-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {`${localized.ignoredMissingRequiredMods || "Ignored"} (${ignored.length})`}
          </div>
          {ignored.map(renderGroup)}
        </div>
      )}
    </div>
  );
};

const RequiredMods = memo((props: RequiredModsProps) => {
  const dispatch = useAppDispatch();

  const localized: Record<string, string> = useContext(localizationContext);

  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const allMods = useAppSelector((state) => state.app.allMods);
  const saves = [...useAppSelector((state) => state.app.saves)];
  saves.sort((first, second) => second.lastChanged - first.lastChanged);
  const onClose = () => {
    props.setIsOpen(!props.isOpen);
  };
  const onModClick = (name: string, id: string) => {
    let foundMod = mods.find((mod) => mod.workshopId == id);
    if (!foundMod) {
      const modInAll = allMods.find((mod) => mod.workshopId == id);
      if (!modInAll) {
        subbedModIdsToWaitFor.push(id);
        window.api?.subscribeToMods([id]);
      } else {
        foundMod = mods.find((mod) => mod.name == name);
        if (!foundMod) return;
      }
    }

    if (foundMod) {
      dispatch(toggleMod(foundMod));
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const newMods = subbedModIdsToWaitFor.filter((subbedModId) =>
        mods.find((iterMod) => iterMod.workshopId === subbedModId),
      );
      if (newMods.length == 0) return;

      const restOfMods = subbedModIdsToWaitFor.filter(
        (subbedModId) => !mods.find((iterMod) => iterMod.workshopId === subbedModId),
      );
      console.log("waiting for:", restOfMods);
      subbedModIdsToWaitFor.splice(0, subbedModIdsToWaitFor.length, ...restOfMods);

      newMods.forEach((id) => {
        const foundMod = mods.find((mod) => mod.workshopId == id);
        if (foundMod) {
          dispatch(toggleMod(foundMod));
        }
      });
    }, 100);
    return () => clearInterval(interval);
  }, [subbedModIdsToWaitFor, mods]);

  return (
    <>
      {props.isOpen && (
        <Modal
          show={props.isOpen}
          onClose={onClose}
          size="2xl"
          position="top-center"
          explicitClasses={["mt-8"]}
        >
          <Modal.Header>{localized.missingRequiredMods}</Modal.Header>
          <Modal.Body>
            <MissingModGroups modDependencies={props.modDependencies} onModClick={onModClick} />
          </Modal.Body>
        </Modal>
      )}
    </>
  );
});
export default RequiredMods;
