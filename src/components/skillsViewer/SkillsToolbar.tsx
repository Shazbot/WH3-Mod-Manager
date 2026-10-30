import React, { memo, useContext, useRef } from "react";
import { Panel } from "@xyflow/react";
import { Dropdown, DropdownItem } from "flowbite-react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import {
  setIsCheckingSkillRequirements,
  setIsShowingHiddenModifiersInsideSkills,
  setIsShowingHiddenSkills,
  setIsShowingSkillDbKeys,
  setIsShowingSkillsRankPanel,
} from "../../appSlice";
import localizationContext from "../../localizationContext";

export type FactionFilterOption = { label: string; value: string };

type SkillsToolbarProps = {
  isEditMode: boolean;
  isRequirementsMode: boolean;
  isSkillLocksMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  factionFilter: string;
  factionOptions: FactionFilterOption[];
  onFactionFilterChange: (value: string) => void;
  onNewSkillTree: () => void;
  onToggleEditMode: () => void;
  onToggleRequirementsMode: () => void;
  onToggleSkillLocksMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddNode: () => void;
  onReset: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onSavePack: (changesOnly: boolean) => void;
};

// The skills view re-renders on every node drag. Its faction options are rebuilt each time with the same content, so
// compare them by value; every other prop is a primitive or a stable callback.
const sameFactionOptions = (a: FactionFilterOption[], b: FactionFilterOption[]) =>
  a === b ||
  (a.length === b.length && a.every((option, i) => option.value === b[i].value && option.label === b[i].label));

const arePropsEqual = (prev: SkillsToolbarProps, next: SkillsToolbarProps) =>
  (Object.keys(next) as (keyof SkillsToolbarProps)[]).every((key) =>
    key === "factionOptions" ? sameFactionOptions(prev.factionOptions, next.factionOptions) : prev[key] === next[key],
  );

// The skills view's top-left panel: display options, faction filter, and the edit mode controls.
const SkillsToolbar = ({
  isEditMode,
  isRequirementsMode,
  isSkillLocksMode,
  canUndo,
  canRedo,
  factionFilter,
  factionOptions,
  onFactionFilterChange,
  onNewSkillTree,
  onToggleEditMode,
  onToggleRequirementsMode,
  onToggleSkillLocksMode,
  onUndo,
  onRedo,
  onAddNode,
  onReset,
  onImport,
  onExport,
  onSavePack,
}: SkillsToolbarProps) => {
  const dispatch = useAppDispatch();
  const localized: Record<string, string> = useContext(localizationContext);
  const isShowingHiddentSkills = useAppSelector((state) => state.app.isShowingHiddenSkills);
  const isShowingHiddenModifiersInsideSkills = useAppSelector(
    (state) => state.app.isShowingHiddenModifiersInsideSkills,
  );
  const isCheckingSkillRequirements = useAppSelector((state) => state.app.isCheckingSkillRequirements);
  const isShowingSkillsRankPanel = useAppSelector((state) => state.app.isShowingSkillsRankPanel);
  const isShowingSkillDbKeys = useAppSelector((state) => state.app.isShowingSkillDbKeys);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const importInputRef = useRef<HTMLInputElement>(null);

  return (
    <Panel position="top-left" className="select-none">
      <div className="flex gap-2 items-start">
        <div className="hover:bg-gray-700 dark:border-gray-600 border-2 rounded-lg w-fit">
          <Dropdown dismissOnClick={false} label={localized.options} color="blue">
            <DropdownItem>
              <div className="flex items-center min-w-[18em]">
                <label htmlFor="isShowingHiddentSkillsCheckbox">
                  <input
                    id="isShowingHiddentSkillsCheckbox"
                    type="checkbox"
                    checked={!!isShowingHiddentSkills}
                    onChange={() => {
                      dispatch(setIsShowingHiddenSkills(!isShowingHiddentSkills));
                    }}
                  ></input>
                  <span className="ml-2">{localized.showHiddenSkills}</span>
                </label>
              </div>
            </DropdownItem>
            <DropdownItem>
              <div className="flex items-center">
                <label htmlFor="isShowingHiddenModifiersInsideSkillsCheckbox">
                  <input
                    id="isShowingHiddenModifiersInsideSkillsCheckbox"
                    type="checkbox"
                    checked={!!isShowingHiddenModifiersInsideSkills}
                    onChange={() => {
                      dispatch(setIsShowingHiddenModifiersInsideSkills(!isShowingHiddenModifiersInsideSkills));
                    }}
                  ></input>
                  <span className="ml-2">{localized.showHiddenModifiersInsideSkills}</span>
                </label>
              </div>
            </DropdownItem>
            <DropdownItem>
              <div className="flex items-center">
                <label htmlFor="isCheckingSkillRequirementsCheckbox">
                  <input
                    id="isCheckingSkillRequirementsCheckbox"
                    type="checkbox"
                    checked={!!isCheckingSkillRequirements}
                    onChange={() => {
                      dispatch(setIsCheckingSkillRequirements(!isCheckingSkillRequirements));
                    }}
                  ></input>
                  <span className="ml-2">{localized.checkSkillRequirements}</span>
                </label>
              </div>
            </DropdownItem>
            <DropdownItem>
              <div className="flex items-center">
                <label htmlFor="isShowingSkillsRankPanelCheckbox">
                  <input
                    id="isShowingSkillsRankPanelCheckbox"
                    type="checkbox"
                    checked={!!isShowingSkillsRankPanel}
                    onChange={() => {
                      dispatch(setIsShowingSkillsRankPanel(!isShowingSkillsRankPanel));
                    }}
                  ></input>
                  <span className="ml-2">{localized.showSkillsRankPanel || "Show rank"}</span>
                </label>
              </div>
            </DropdownItem>
            <DropdownItem>
              <div className="flex items-center">
                <label htmlFor="isShowingSkillDbKeysCheckbox">
                  <input
                    id="isShowingSkillDbKeysCheckbox"
                    type="checkbox"
                    checked={!!isShowingSkillDbKeys}
                    onChange={() => {
                      dispatch(setIsShowingSkillDbKeys(!isShowingSkillDbKeys));
                    }}
                  ></input>
                  <span className="ml-2">{localized.showSkillDbKeys || "Show DB keys in tooltips"}</span>
                </label>
              </div>
            </DropdownItem>
          </Dropdown>
        </div>
        {isFeaturesForModdersEnabled && (
          <button
            className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
            onClick={onNewSkillTree}
          >
            New Skill Tree
          </button>
        )}
      </div>
      {factionOptions.length > 0 && (
        <div className="hover:bg-gray-700 dark:border-gray-600 border-2 rounded-lg mt-2 w-fit">
          <Dropdown
            color="blue"
            dismissOnClick={true}
            label={
              factionFilter === "all"
                ? localized.all || "All"
                : factionOptions.find((o) => o.value === factionFilter)?.label || factionFilter
            }
          >
            <DropdownItem onClick={() => onFactionFilterChange("all")}>
              <span>{localized.all || "All"}</span>
            </DropdownItem>
            {factionOptions.map((option) => (
              <DropdownItem key={option.value} onClick={() => onFactionFilterChange(option.value)}>
                <span>{option.label}</span>
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      )}
      {isFeaturesForModdersEnabled && (
        <div className="mt-2 flex gap-2">
          <button
            className={`px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
              isEditMode ? "bg-green-700 text-white" : "hover:bg-gray-700"
            } ${isRequirementsMode || isSkillLocksMode ? "grayscale cursor-not-allowed" : ""}`}
            onClick={onToggleEditMode}
          >
            {isEditMode ? localized.editModeOn || "Edit Mode: ON" : localized.edit || "Edit"}
          </button>
          {isEditMode && (
            <>
              <button
                className={`ml-4 px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                  isRequirementsMode ? "bg-amber-600 text-white" : "hover:bg-gray-700"
                }`}
                onClick={onToggleRequirementsMode}
              >
                {isRequirementsMode
                  ? localized.requirementsModeOn || "Requirements: ON"
                  : localized.requirements || "Requirements"}
              </button>
              <button
                className={`px-4 py-2 rounded-lg border-2 dark:border-gray-600 ${
                  isSkillLocksMode ? "bg-red-600 text-white" : "hover:bg-gray-700"
                }`}
                onClick={onToggleSkillLocksMode}
              >
                {isSkillLocksMode
                  ? localized.skillLocksModeOn || "Skill Locks: ON"
                  : localized.skillLocks || "Skill Locks"}
              </button>
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="px-3 py-2 rounded-lg border-2 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-700"
                title="Undo (Ctrl+Z)"
              >
                ↩
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                className="px-3 py-2 rounded-lg border-2 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-700"
                title="Redo (Ctrl+Y)"
              >
                ↪
              </button>
            </>
          )}
        </div>
      )}
      {isEditMode && (
        <div className="mt-2 flex gap-2">
          {!isRequirementsMode && !isSkillLocksMode && (
            <>
              <button
                className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                onClick={onAddNode}
              >
                {localized.addNode || "Add Node"}
              </button>
              <button
                className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-red-700 text-red-400"
                onClick={onReset}
              >
                Reset
              </button>

              <div className="hover:bg-green-700 bg-green-600 dark:border-gray-600 border-2 rounded-lg w-fit">
                <Dropdown dismissOnClick={false} label={localized.json || "JSON"} color="blue">
                  <DropdownItem>
                    <button
                      className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                      onClick={() => importInputRef.current?.click()}
                    >
                      {localized.import || "Import"}
                    </button>
                    <input ref={importInputRef} type="file" accept=".json" onChange={onImport} className="hidden" />
                  </DropdownItem>
                  <DropdownItem>
                    <button
                      className="px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-gray-700"
                      onClick={onExport}
                    >
                      {localized.export || "Export"}
                    </button>
                  </DropdownItem>
                </Dropdown>
              </div>

              <div className="hover:bg-green-700 bg-green-600 dark:border-gray-600 border-2 rounded-lg w-fit">
                <Dropdown dismissOnClick={false} label={localized.save} color="green">
                  <DropdownItem>
                    <button
                      className="w-36 px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-blue-700 bg-blue-600 text-white"
                      onClick={() => onSavePack(false)}
                    >
                      {localized.savePack || "Save Whole Tree"}
                    </button>
                  </DropdownItem>
                  <DropdownItem>
                    <button
                      className="w-36 px-4 py-2 rounded-lg border-2 dark:border-gray-600 hover:bg-green-700 bg-green-600 text-white"
                      onClick={() => onSavePack(true)}
                    >
                      {localized.saveOnlyChanges || "Save Only Changes"}
                    </button>
                  </DropdownItem>
                </Dropdown>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
};

export default memo(SkillsToolbar, arePropsEqual);
