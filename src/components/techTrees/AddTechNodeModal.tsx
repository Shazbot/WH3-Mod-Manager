import React, { useMemo, useState } from "react";
import { createFilter } from "react-select";
import WindowedSelect from "react-windowed-select";
import { Modal } from "../../flowbite/components/Modal/index";
import selectStyle from "../../styles/selectStyle";

export type TechNodeFormData = {
  technologyMode: "existing" | "custom";
  technologyKey: string;
  displayName: string;
  requiredParents: number;
  researchPointsRequired: number;
  campaignKey?: string;
  factionKey?: string;
  isHidden: boolean;
  pixelOffsetX: number;
  pixelOffsetY: number;
  buildingLevel?: string;
  shortDescription?: string;
  longDescription?: string;
  iconPath?: string;
  effects: TechEffect[];
  iconData?: string;
};

type AddTechNodeModalProps = {
  tier: number;
  indent: number;
  onAdd: (node: TechNodeFormData) => void;
  onClose: () => void;
  defaultCustomTechnologyKey?: string;
  allTechnologies: TechnologyCatalogEntry[];
  allTechnologyIcons: TechnologyIconEntry[];
  allEffects: TechEffect[];
  existingNode?: Omit<TechNodeFormData, "technologyMode"> & { nodeKey: string };
  onEdit?: (nodeKey: string, changes: TechNodeFormData) => void;
};

type TechnologyOption = {
  value: string;
  label: string;
  technology: TechnologyCatalogEntry;
};

type EffectOption = {
  value: string;
  label: string;
  effect: TechEffect;
};

type TechnologyIconOption = {
  value: string;
  label: string;
  iconData: string;
};

const inputClass = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100";

const AddTechNodeModal = ({
  tier,
  indent,
  onAdd,
  onClose,
  defaultCustomTechnologyKey,
  allTechnologies,
  allTechnologyIcons,
  allEffects,
  existingNode,
  onEdit,
}: AddTechNodeModalProps) => {
  const isEditing = !!existingNode;
  const existingTechnologyKeys = useMemo(() => new Set(allTechnologies.map((technology) => technology.key)), [allTechnologies]);
  const inferredMode: "existing" | "custom" = useMemo(() => {
    if (!existingNode) return "custom";
    return existingTechnologyKeys.has(existingNode.technologyKey) ? "existing" : "custom";
  }, [existingNode, existingTechnologyKeys]);

  const technologyOptions = useMemo<TechnologyOption[]>(
    () =>
      allTechnologies.map((technology) => ({
        value: technology.key,
        label: technology.localizedName || technology.key,
        technology,
      })),
    [allTechnologies],
  );
  const technologyIconOptions = useMemo<TechnologyIconOption[]>(
    () =>
      allTechnologyIcons.map((icon) => ({
        value: icon.path,
        label: icon.name,
        iconData: icon.iconData,
      })),
    [allTechnologyIcons],
  );
  const effectOptions = useMemo<EffectOption[]>(
    () =>
      allEffects.map((effect) => ({
        value: effect.effectKey,
        label: effect.localizedKey || effect.effectKey,
        effect,
      })),
    [allEffects],
  );

  const [technologyMode, setTechnologyMode] = useState<"existing" | "custom">(inferredMode);
  const [selectedTechnology, setSelectedTechnology] = useState<TechnologyOption | null>(() => {
    if (!existingNode) return null;
    const matched = technologyOptions.find((option) => option.value === existingNode.technologyKey);
    return matched || null;
  });
  const [customTechnologyKey, setCustomTechnologyKey] = useState(
    inferredMode === "custom" ? (existingNode?.technologyKey ?? defaultCustomTechnologyKey ?? "") : "",
  );
  const [displayName, setDisplayName] = useState(existingNode?.displayName ?? "");
  const [requiredParents, setRequiredParents] = useState(existingNode?.requiredParents ?? 0);
  const [researchPointsRequired, setResearchPointsRequired] = useState(existingNode?.researchPointsRequired ?? 0);
  const [campaignKey, setCampaignKey] = useState(existingNode?.campaignKey ?? "");
  const [factionKey, setFactionKey] = useState(existingNode?.factionKey ?? "");
  const [isHidden, setIsHidden] = useState(existingNode?.isHidden ?? false);
  const [pixelOffsetX, setPixelOffsetX] = useState(existingNode?.pixelOffsetX ?? 0);
  const [pixelOffsetY, setPixelOffsetY] = useState(existingNode?.pixelOffsetY ?? 0);
  const [buildingLevel, setBuildingLevel] = useState(existingNode?.buildingLevel ?? "");
  const [shortDescription, setShortDescription] = useState(existingNode?.shortDescription ?? "");
  const [longDescription, setLongDescription] = useState(existingNode?.longDescription ?? "");
  const [selectedIcon, setSelectedIcon] = useState<TechnologyIconOption | null>(() => {
    if (!existingNode?.iconPath) return null;
    const matched = technologyIconOptions.find((option) => option.value === existingNode.iconPath);
    if (matched) return matched;
    return {
      value: existingNode.iconPath,
      label: existingNode.iconPath.replace("ui\\campaign ui\\technologies\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
      iconData: existingNode.iconData || "",
    };
  });
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [selectedEffects, setSelectedEffects] = useState<EffectOption[]>(() => {
    const existingEffects = existingNode?.effects || [];
    return existingEffects
      .map((effect) => {
        const knownEffect = allEffects.find((candidate) => candidate.effectKey === effect.effectKey);
        const mergedEffect = knownEffect ? { ...knownEffect, ...effect } : effect;
        return {
          value: mergedEffect.effectKey,
          label: mergedEffect.localizedKey || mergedEffect.effectKey,
          effect: mergedEffect,
        };
      })
      .filter((option) => !!option.value);
  });
  const [effectValues, setEffectValues] = useState<Record<string, string>>(() => {
    const initialValues: Record<string, string> = {};
    for (const effect of existingNode?.effects || []) {
      initialValues[effect.effectKey] = effect.value || "0";
    }
    return initialValues;
  });

  const customTechnologyKeyTrimmed = customTechnologyKey.trim();
  const customKeyExists = existingTechnologyKeys.has(customTechnologyKeyTrimmed);
  const filteredIcons = useMemo(() => {
    if (!iconSearch.trim()) return technologyIconOptions;
    const normalizedSearch = iconSearch.toLowerCase();
    return technologyIconOptions.filter((option) => option.label.toLowerCase().includes(normalizedSearch));
  }, [iconSearch, technologyIconOptions]);

  const handleExistingTechnologyChange = (option: TechnologyOption | null) => {
    setSelectedTechnology(option);
    if (!option) return;
    setDisplayName(option.technology.localizedName || option.technology.key);
    setResearchPointsRequired(option.technology.researchPointsRequired || 0);
    setIsHidden(!!option.technology.isHidden);
    setPixelOffsetX(existingNode?.pixelOffsetX ?? 0);
    setPixelOffsetY(existingNode?.pixelOffsetY ?? 0);
    setBuildingLevel(option.technology.buildingLevel || "");
    setShortDescription(option.technology.shortDescription || "");
    setLongDescription(option.technology.longDescription || "");
    if (option.technology.iconPath) {
      const matchedIcon = technologyIconOptions.find((icon) => icon.value === option.technology.iconPath);
      setSelectedIcon(
        matchedIcon || {
          value: option.technology.iconPath,
          label: option.technology.iconPath.replace("ui\\campaign ui\\technologies\\", "").replace(/\.(png|jpg|jpeg)$/i, ""),
          iconData: option.technology.iconData || "",
        },
      );
    }
  };

  const handleSubmit = () => {
    const technologyKey = technologyMode === "existing" ? selectedTechnology?.value || "" : customTechnologyKeyTrimmed;
    if (!technologyKey || !displayName.trim()) return;
    if (technologyMode === "custom" && customKeyExists) return;

    const effects =
      technologyMode === "existing"
        ? selectedTechnology?.technology.effects || []
        : selectedEffects.map((option) => ({
            ...option.effect,
            value: effectValues[option.value] ?? option.effect.value ?? "0",
          }));
    const iconData = technologyMode === "existing" ? selectedTechnology?.technology.iconData : selectedIcon?.iconData;
    const iconPath = technologyMode === "existing" ? selectedTechnology?.technology.iconPath : selectedIcon?.value;

    const formData: TechNodeFormData = {
      technologyMode,
      technologyKey,
      displayName: displayName.trim(),
      requiredParents,
      researchPointsRequired,
      campaignKey: campaignKey.trim(),
      factionKey: factionKey.trim(),
      isHidden,
      pixelOffsetX,
      pixelOffsetY,
      buildingLevel: buildingLevel.trim() || undefined,
      shortDescription: shortDescription.trim() || undefined,
      longDescription: longDescription.trim() || undefined,
      iconPath,
      effects,
      iconData,
    };
    if (isEditing && onEdit && existingNode) {
      onEdit(existingNode.nodeKey, formData);
      return;
    }
    onAdd(formData);
  };

  const submitDisabled =
    (technologyMode === "existing" && !selectedTechnology) ||
    (technologyMode === "custom" && (!customTechnologyKeyTrimmed || customKeyExists)) ||
    !displayName.trim();

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div
          className="bg-gray-900 border border-gray-700 rounded-lg p-5 w-[760px] max-w-[95vw] max-h-[90vh] overflow-y-auto space-y-4 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
        <div className="text-sm font-bold border-b border-gray-700 pb-2">
          {isEditing ? "Edit Technology Node" : `Add Technology Node — Tier ${tier}, Row ${indent}`}
        </div>

        <div className="flex gap-0 rounded-lg overflow-hidden border border-gray-700">
          <button
            type="button"
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              technologyMode === "custom" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
            onClick={() => setTechnologyMode("custom")}
          >
            New Technology
          </button>
          <button
            type="button"
            className={`flex-1 px-4 py-2 text-sm font-medium ${
              technologyMode === "existing"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
            onClick={() => setTechnologyMode("existing")}
          >
            Existing Technology
          </button>
        </div>

        {technologyMode === "existing" ? (
          <div className="space-y-2">
            <label className="block text-xs text-gray-400">Technology Key *</label>
            <WindowedSelect
              options={technologyOptions}
              value={selectedTechnology}
              // @ts-expect-error react-select type mismatch in current setup
              onChange={(newValue: TechnologyOption | null) => handleExistingTechnologyChange(newValue)}
              styles={selectStyle}
              isClearable
              filterOption={createFilter({ ignoreAccents: false })}
              placeholder="Search technologies..."
              // @ts-expect-error react-select option rendering types are narrower than the runtime shape here.
              formatOptionLabel={(option: TechnologyOption) => (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {option.technology.iconData && (
                      <img
                        className="h-6 w-6 object-contain"
                        src={`data:image/png;base64,${option.technology.iconData}`}
                        alt=""
                      />
                    )}
                    <span className="font-medium">{option.label}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {option.value} • {option.technology.effects.length} effect
                    {option.technology.effects.length === 1 ? "" : "s"}
                  </div>
                </div>
              )}
            />
            {selectedTechnology && selectedTechnology.technology.effects.length > 0 && (
              <div className="max-h-36 overflow-y-auto bg-gray-800 border border-gray-700 rounded p-2 space-y-1">
                {selectedTechnology.technology.effects.map((effect) => (
                  <div key={effect.effectKey} className="text-xs text-gray-300 flex items-center gap-2">
                    {effect.iconData && (
                      <img className="h-4 w-4 object-contain" src={`data:image/png;base64,${effect.iconData}`} alt="" />
                    )}
                    <span>{effect.localizedKey || effect.effectKey}</span>
                    <span className="text-gray-500">({effect.effectKey})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs space-y-1">
              <span className="text-gray-400">Technology Key *</span>
              <input
                type="text"
                value={customTechnologyKey}
                onChange={(event) => setCustomTechnologyKey(event.target.value)}
                className={inputClass}
                placeholder={defaultCustomTechnologyKey || "e.g. wh3_dlc25_tech_cth_industry_01"}
                autoFocus
              />
            </label>
            {customKeyExists && (
              <p className="text-xs text-red-400">
                This key already exists in `technologies_tables`. Switch to Existing Technology mode to reuse it.
              </p>
            )}
            <label className="block text-xs text-gray-400">Effects</label>
            <WindowedSelect
              isMulti
              options={effectOptions}
              value={selectedEffects}
              onChange={(newValue) => {
                const nextEffects = [...(newValue as EffectOption[])];
                setSelectedEffects(nextEffects);
                setEffectValues((prev) => {
                  const nextValues = { ...prev };
                  for (const option of nextEffects) {
                    if (nextValues[option.value] === undefined) {
                      nextValues[option.value] = option.effect.value || "0";
                    }
                  }
                  return nextValues;
                });
              }}
              styles={selectStyle}
              filterOption={createFilter({ ignoreAccents: false })}
              placeholder="Search effects..."
              // @ts-expect-error react-select option rendering types are narrower than the runtime shape here.
              formatOptionLabel={(option: EffectOption) => (
                <div className="flex items-center gap-2">
                  {option.effect.iconData && (
                    <img className="h-4 w-4 object-contain" src={`data:image/png;base64,${option.effect.iconData}`} alt="" />
                  )}
                  <span>{option.label}</span>
                  <span className="text-xs text-gray-400">({option.value})</span>
                </div>
              )}
            />
            {selectedEffects.length > 0 && (
              <div className="space-y-2 mt-2 rounded border border-gray-700 bg-gray-800/50 p-2">
                {selectedEffects.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    {option.effect.iconData && (
                      <img
                        className="h-5 w-5 object-contain"
                        src={`data:image/png;base64,${option.effect.iconData}`}
                        alt=""
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-200 truncate">{option.label}</div>
                      <div className="text-xs text-gray-500 truncate">{option.value}</div>
                    </div>
                    <input
                      type="text"
                      value={effectValues[option.value] ?? "0"}
                      onChange={(event) =>
                        setEffectValues((prev) => ({
                          ...prev,
                          [option.value]: event.target.value,
                        }))
                      }
                      className={`${inputClass} !w-32`}
                      placeholder="Value"
                    />
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Icon</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <WindowedSelect
                    options={technologyIconOptions}
                    value={selectedIcon}
                    // @ts-expect-error react-select type mismatch in current setup
                    onChange={(newValue: TechnologyIconOption | null) => setSelectedIcon(newValue)}
                    styles={selectStyle}
                    placeholder="Select icon..."
                    isClearable
                    filterOption={createFilter({ ignoreAccents: false })}
                    // @ts-expect-error react-select option rendering types are narrower than the runtime shape here.
                    formatOptionLabel={(option: TechnologyIconOption) => (
                      <div className="flex items-center gap-2">
                        {option.iconData && (
                          <img className="h-10 w-10 object-contain" src={`data:image/png;base64,${option.iconData}`} alt="" />
                        )}
                        <span>{option.label}</span>
                      </div>
                    )}
                  />
                </div>
                <button
                  type="button"
                  className="px-4 py-2 text-white bg-gray-700 hover:bg-gray-600 rounded text-sm whitespace-nowrap"
                  onClick={() => setIsIconPickerOpen(true)}
                >
                  Browse Icons...
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-300">Technology Data</div>

          <label className="block text-xs space-y-1">
            <span className="text-gray-400">Display Name *</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={inputClass}
              placeholder="e.g. Advanced Forging"
            />
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-gray-400">Required Parents</span>
            <input
              type="number"
              value={requiredParents}
              onChange={(event) => setRequiredParents(Math.max(0, Number(event.target.value) || 0))}
              className={inputClass}
              min={0}
            />
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-gray-400">Research Cost</span>
            <input
              type="number"
              value={researchPointsRequired}
              onChange={(event) => setResearchPointsRequired(Number(event.target.value) || 0)}
              className={inputClass}
              min={0}
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isHidden}
              onChange={(event) => setIsHidden(event.target.checked)}
            />
            <span>Initially hidden (`technologies_tables.is_hidden`)</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs space-y-1">
              <span className="text-gray-400">Campaign Key</span>
              <input
                type="text"
                value={campaignKey}
                onChange={(event) => setCampaignKey(event.target.value)}
                className={inputClass}
                placeholder="Optional campaign key"
              />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-gray-400">Faction Key</span>
              <input
                type="text"
                value={factionKey}
                onChange={(event) => setFactionKey(event.target.value)}
                className={inputClass}
                placeholder="Optional faction key"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs space-y-1">
              <span className="text-gray-400">Pixel Offset X</span>
              <input
                type="number"
                value={pixelOffsetX}
                onChange={(event) => setPixelOffsetX(Number(event.target.value) || 0)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-gray-400">Pixel Offset Y</span>
              <input
                type="number"
                value={pixelOffsetY}
                onChange={(event) => setPixelOffsetY(Number(event.target.value) || 0)}
                className={inputClass}
              />
            </label>
          </div>

          <label className="block text-xs space-y-1">
            <span className="text-gray-400">Building Requirement</span>
            <input
              type="text"
              value={buildingLevel}
              onChange={(event) => setBuildingLevel(event.target.value)}
              className={inputClass}
              placeholder="Optional building level key"
            />
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-gray-400">Short Description</span>
            <input
              type="text"
              value={shortDescription}
              onChange={(event) => setShortDescription(event.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block text-xs space-y-1">
            <span className="text-gray-400">Long Description</span>
            <textarea
              value={longDescription}
              onChange={(event) => setLongDescription(event.target.value)}
              className={`${inputClass} resize-y`}
              rows={3}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
          <button
            type="button"
            className="px-3 py-1 rounded bg-gray-700 border border-gray-600 text-xs hover:bg-gray-600"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1 rounded bg-green-700 border border-green-600 text-xs hover:bg-green-600 disabled:opacity-60"
            disabled={submitDisabled}
            onClick={handleSubmit}
          >
            {isEditing ? "Save Changes" : "Add Node"}
          </button>
        </div>
        </div>
      </div>
      <Modal
        show={isIconPickerOpen}
        onClose={() => setIsIconPickerOpen(false)}
        size="5xl"
        explicitClasses={["max-w-[90vw]", "first-child-div-second-child-div-flex-grow", "first-child-div-flex-col", "!h-[90vh]"]}
      >
        <Modal.Header>Select Icon</Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <input
              type="text"
              value={iconSearch}
              onChange={(event) => setIconSearch(event.target.value)}
              placeholder="Search icons..."
              className={inputClass}
            />
            <div className="grid grid-cols-6 gap-3 overflow-y-auto p-2">
              {filteredIcons.map((option) => (
                <div
                  key={option.value}
                  onClick={() => {
                    setSelectedIcon(option);
                    setIsIconPickerOpen(false);
                  }}
                  className={`cursor-pointer p-3 rounded border-2 transition-colors ${
                    selectedIcon?.value === option.value
                      ? "border-blue-500 bg-gray-700"
                      : "border-gray-600 hover:bg-gray-700 hover:border-gray-500"
                  }`}
                >
                  <img src={`data:image/png;base64,${option.iconData}`} className="w-20 h-20 object-contain mx-auto" alt={option.label} />
                  <div className="text-xs text-center mt-2 text-gray-300 truncate" title={option.label}>
                    {option.label}
                  </div>
                </div>
              ))}
            </div>
            {filteredIcons.length === 0 && <div className="text-center text-gray-400 py-8">No icons found</div>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <div className="flex gap-2 justify-end w-full">
            <button
              type="button"
              onClick={() => setIsIconPickerOpen(false)}
              className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Close
            </button>
          </div>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AddTechNodeModal;
