import React, { memo, useMemo, useState } from "react";
import { Modal } from "../../flowbite/components/Modal/index";
import { useAppSelector } from "../../hooks";
import { useLocalizations } from "@/src/localizationContext";
import Select, { createFilter } from "react-select";
import WindowedSelect from "react-windowed-select";
import selectStyle from "@/src/styles/selectStyle";

interface AddNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (nodeData: {
    name: string;
    description: string;
    row: number;
    column: number;
    effects: Effect[];
    maxLevel: number;
    unlockRank: number;
    existingSkillKey?: string;
    imgPath?: string;
  }) => void;
  initialRow?: number;
  initialColumn?: number;
  editingData?: {
    name: string;
    description: string;
    maxLevel: number;
    unlockRank: number;
    effects: Effect[];
    existingSkillKey?: string;
    imgPath?: string;
  };
}

interface EffectOption {
  value: string;
  label: string;
  effect: Effect;
}

interface SkillOption {
  value: string;
  label: string;
  effectsCount: number;
}

interface IconOption {
  value: string;
  label: string;
}

const inputClass =
  "w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500";

const AddNodeModal = memo(
  ({ isOpen, onClose, onAdd, initialRow, initialColumn, editingData }: AddNodeModalProps) => {
    const localized = useLocalizations();
    const skillsData = useAppSelector((state) => state.app.skillsData);

    const [mode, setMode] = useState<"custom" | "existing">(
      editingData?.existingSkillKey ? "existing" : "custom",
    );
    const [name, setName] = useState(editingData?.name ?? "");
    const [description, setDescription] = useState(editingData?.description ?? "");
    const [row, setRow] = useState(initialRow ?? 0);
    const [column, setColumn] = useState(initialColumn ?? 0);
    const [maxLevel, setMaxLevel] = useState(editingData?.maxLevel ?? 3);
    const [unlockRank, setUnlockRank] = useState(editingData?.unlockRank ?? 0);
    const [selectedEffects, setSelectedEffects] = useState<EffectOption[]>(
      editingData?.effects.map((e) => ({
        value: e.effectKey,
        label: e.localizedKey || e.effectKey,
        effect: e,
      })) ?? [],
    );
    const [effectValues, setEffectValues] = useState<Record<string, string>>(() => {
      if (!editingData?.effects) return {};
      const vals: Record<string, string> = {};
      for (const e of editingData.effects) {
        vals[e.effectKey] = e.value || "0";
      }
      return vals;
    });
    const [selectedSkill, setSelectedSkill] = useState<SkillOption | null>(() => {
      if (editingData?.existingSkillKey && skillsData?.allSkills) {
        const skill = skillsData.allSkills.find((s) => s.key === editingData.existingSkillKey);
        if (skill)
          return { value: skill.key, label: skill.localizedName, effectsCount: skill.effects.length };
      }
      return null;
    });
    const [selectedIcon, setSelectedIcon] = useState<IconOption | null>(() => {
      if (editingData?.imgPath) {
        return {
          value: editingData.imgPath,
          label: editingData.imgPath
            .replace("ui\\campaign ui\\skills\\", "")
            .replace(/\.(png|jpg|jpeg)$/i, ""),
        };
      }
      return null;
    });

    // All available effects from vanilla game + enabled mods with raw localization
    const effectOptions = useMemo(() => {
      if (!skillsData?.allEffects) return [];
      return skillsData.allEffects
        .map((e) => ({
          value: e.effectKey,
          label: e.localizedKey || e.effectKey,
          effect: {
            key: "",
            effectKey: e.effectKey,
            localizedKey: e.localizedKey,
            effectScope: "",
            level: 1,
            value: "0",
            icon: e.icon,
            iconData: e.icon ? skillsData.icons[`ui\\campaign ui\\effect_bundles\\${e.icon}`] || "" : "",
            priority: e.priority,
          } as Effect,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }, [skillsData?.allEffects, skillsData?.icons]);

    // All available skills from vanilla game + enabled mods
    const skillOptions = useMemo(() => {
      if (!skillsData?.allSkills) return [];
      return skillsData.allSkills
        .map((s) => ({
          value: s.key,
          label: s.localizedName,
          effectsCount: s.effects.length,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }, [skillsData?.allSkills]);

    // All available skill icons from vanilla game + enabled mods
    const iconOptions = useMemo(() => {
      if (!skillsData?.allSkillIcons) return [];
      return skillsData.allSkillIcons.map((icon) => ({
        value: icon.path,
        label: icon.name,
      }));
    }, [skillsData?.allSkillIcons]);

    const handleSkillSelect = (option: SkillOption | null) => {
      setSelectedSkill(option);
      if (option) {
        const skill = skillsData?.allSkills?.find((s) => s.key === option.value);
        if (skill) {
          setName(skill.localizedName);
          setDescription(skill.localizedDescription);
          setMaxLevel(skill.maxLevel);
          setUnlockRank(skill.unlockRank);
          const iconPath = `ui\\campaign ui\\skills\\${skill.iconPath}`;
          setSelectedIcon({ value: iconPath, label: skill.iconPath });
        }
      }
    };

    const handleSubmit = () => {
      if (mode === "existing") {
        if (!selectedSkill) return;
        const skill = skillsData?.allSkills?.find((s) => s.key === selectedSkill.value);
        if (!skill) return;
        const skillEffects: Effect[] = skill.effects.map((e) => ({
          key: "",
          effectKey: e.effectKey,
          effectScope: e.effectScope,
          level: e.level,
          value: e.value,
          icon: e.icon,
          iconData: e.icon ? skillsData?.icons[`ui\\campaign ui\\effect_bundles\\${e.icon}`] || "" : "",
          priority: e.priority,
        }));
        onAdd({
          name: name.trim() || skill.localizedName,
          description: description.trim(),
          row,
          column,
          effects: skillEffects,
          maxLevel,
          unlockRank,
          existingSkillKey: selectedSkill.value,
          imgPath: selectedIcon?.value,
        });
      } else {
        if (!name.trim()) return;
        onAdd({
          name: name.trim(),
          description: description.trim(),
          row,
          column,
          effects: selectedEffects.map((opt) => ({ ...opt.effect, value: effectValues[opt.value] ?? "0" })),
          maxLevel,
          unlockRank,
          imgPath: selectedIcon?.value,
        });
      }
    };

    const isSubmitDisabled = mode === "custom" ? !name.trim() : !selectedSkill;

    return (
      <Modal
        show={isOpen}
        onClose={onClose}
        size="3xl"
        explicitClasses={[
          "first-child-div-second-child-div-flex-grow",
          "!h-[94vh]",
          "first-child-div-flex-col",
        ]}
      >
        <Modal.Header>
          {editingData ? localized.editNode || "Edit Node" : localized.addNode || "Add Node"}
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-0 rounded-lg overflow-hidden border-2 dark:border-gray-600">
              <button
                className={`flex-1 px-4 py-2 text-sm font-medium ${
                  mode === "custom"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                }`}
                onClick={() => setMode("custom")}
              >
                {localized.customSkill || "Custom Skill"}
              </button>
              <button
                className={`flex-1 px-4 py-2 text-sm font-medium ${
                  mode === "existing"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                }`}
                onClick={() => setMode("existing")}
              >
                {localized.existingSkill || "Existing Skill"}
              </button>
            </div>

            {mode === "existing" ? (
              <>
                {/* Existing skill picker */}
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                    {localized.selectSkill || "Select Skill"}
                  </label>
                  <WindowedSelect
                    filterOption={createFilter({ ignoreAccents: false, matchFrom: "start" })}
                    options={skillOptions}
                    value={selectedSkill}
                    // @ts-expect-error
                    onChange={(newValue: SkillOption | null) => handleSkillSelect(newValue)}
                    styles={selectStyle}
                    placeholder={localized.searchSkills || "Search skills..."}
                    isClearable
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    formatOptionLabel={(option: SkillOption) => (
                      <>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-gray-300 mt-1">
                          {option.value} — {option.effectsCount} effect
                          {option.effectsCount !== 1 ? "s" : ""}
                        </div>
                      </>
                    )}
                  />
                </div>

                {/* Show selected skill's effects as read-only */}
                {selectedSkill &&
                  (() => {
                    const skill = skillsData?.allSkills?.find((s) => s.key === selectedSkill.value);
                    if (!skill || skill.effects.length === 0) return null;
                    return (
                      <div>
                        <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                          {localized.effects || "Effects"}
                        </label>
                        <div className="max-h-32 overflow-y-auto bg-gray-50 dark:bg-gray-700 rounded-lg p-2 space-y-1">
                          {skill.effects.map((e, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                            >
                              {e.icon && skillsData?.icons[`ui\\campaign ui\\effect_bundles\\${e.icon}`] && (
                                <img
                                  className="h-4 w-4"
                                  src={`data:image/png;base64,${skillsData.icons[`ui\\campaign ui\\effect_bundles\\${e.icon}`]}`}
                                  alt=""
                                />
                              )}
                              <span>{e.effectKey}</span>
                              <span className="text-gray-400">({e.value})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
              </>
            ) : (
              <>
                {/* Custom skill form */}
                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                    {localized.name || "Name"}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={localized.enterSkillName || "Enter skill name"}
                    className={inputClass}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                    {localized.description || "Description"}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={localized.enterDescription || "Enter description"}
                    className={inputClass}
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                    {localized.icon || "Icon"}
                  </label>
                  <WindowedSelect
                    options={iconOptions}
                    value={selectedIcon}
                    // @ts-expect-error
                    onChange={(newValue: IconOption | null) => setSelectedIcon(newValue)}
                    styles={selectStyle}
                    placeholder={localized.selectIcon || "Select icon..."}
                    isClearable
                    filterOption={createFilter({ ignoreAccents: false })}
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    formatOptionLabel={(option: IconOption) => (
                      <div className="flex items-center gap-2">
                        {skillsData?.icons[option.value] && (
                          <img
                            className="h-12 w-12 object-contain"
                            src={`data:image/png;base64,${skillsData.icons[option.value]}`}
                            alt=""
                          />
                        )}
                        <span>{option.label}</span>
                      </div>
                    )}
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                  {localized.row || "Row"}
                </label>
                <input
                  type="number"
                  value={row}
                  onChange={(e) => setRow(Number(e.target.value))}
                  min={0}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                  {localized.column || "Column"}
                </label>
                <input
                  type="number"
                  value={column}
                  onChange={(e) => setColumn(Number(e.target.value))}
                  min={0}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                  {localized.maxLevel || "Max Level"}
                </label>
                <input
                  type="number"
                  value={maxLevel}
                  onChange={(e) => setMaxLevel(Number(e.target.value))}
                  min={1}
                  max={10}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                  {localized.unlockRank || "Unlock Rank"}
                </label>
                <input
                  type="number"
                  value={unlockRank}
                  onChange={(e) => setUnlockRank(Number(e.target.value))}
                  min={0}
                  className={inputClass}
                />
              </div>
            </div>

            {mode === "custom" && (
              <div>
                <label className="block mb-1 text-sm font-medium text-gray-900 dark:text-white">
                  {localized.effects || "Effects"}
                </label>
                <WindowedSelect
                  isMulti
                  options={effectOptions}
                  value={selectedEffects}
                  filterOption={createFilter({ ignoreAccents: false })}
                  // @ts-expect-error
                  onChange={(newValue) => setSelectedEffects([...newValue])}
                  styles={selectStyle}
                  placeholder={localized.searchEffects || "Search effects..."}
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  formatOptionLabel={(option: EffectOption) => (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {option.effect.iconData && (
                          <img
                            className="h-5 w-5"
                            src={`data:image/png;base64,${option.effect.iconData}`}
                            alt=""
                          />
                        )}
                        <span>{option.label}</span>
                      </div>
                      <span>{option.value}</span>
                    </div>
                  )}
                />
                {selectedEffects.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {selectedEffects.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        {opt.effect.iconData && (
                          <img
                            className="h-5 w-5"
                            src={`data:image/png;base64,${opt.effect.iconData}`}
                            alt=""
                          />
                        )}
                        <span className="text-sm text-gray-300 flex-1 truncate">{opt.label}</span>
                        <input
                          type="number"
                          value={effectValues[opt.value] ?? "0"}
                          onChange={(e) =>
                            setEffectValues((prev) => ({ ...prev, [opt.value]: e.target.value }))
                          }
                          className={inputClass + " !w-24"}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <div className="flex gap-2 justify-end w-full">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-lg text-sm"
            >
              {localized.cancel || "Cancel"}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitDisabled}
              className="px-4 py-2 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
            >
              {editingData ? localized.save || "Save" : localized.add || "Add"}
            </button>
          </div>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default AddNodeModal;
