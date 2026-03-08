import React, { useMemo, useState } from "react";
import { createFilter } from "react-select";
import WindowedSelect from "react-windowed-select";
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
  effects: TechEffect[];
  iconData?: string;
};

type AddTechNodeModalProps = {
  tier: number;
  indent: number;
  onAdd: (node: TechNodeFormData) => void;
  onClose: () => void;
  allTechnologies: TechnologyCatalogEntry[];
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

const inputClass = "w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100";

const AddTechNodeModal = ({
  tier,
  indent,
  onAdd,
  onClose,
  allTechnologies,
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
    inferredMode === "custom" ? (existingNode?.technologyKey ?? "") : "",
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

  const customTechnologyKeyTrimmed = customTechnologyKey.trim();
  const customKeyExists = existingTechnologyKeys.has(customTechnologyKeyTrimmed);

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
  };

  const handleSubmit = () => {
    const technologyKey = technologyMode === "existing" ? selectedTechnology?.value || "" : customTechnologyKeyTrimmed;
    if (!technologyKey || !displayName.trim()) return;
    if (technologyMode === "custom" && customKeyExists) return;

    const effects =
      technologyMode === "existing"
        ? selectedTechnology?.technology.effects || []
        : selectedEffects.map((option) => option.effect);
    const iconData = technologyMode === "existing" ? selectedTechnology?.technology.iconData : undefined;

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
              // @ts-ignore
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
                placeholder="e.g. wh3_dlc25_tech_cth_industry_01"
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
              onChange={(newValue) => setSelectedEffects([...(newValue as EffectOption[])])}
              styles={selectStyle}
              filterOption={createFilter({ ignoreAccents: false })}
              placeholder="Search effects..."
              // @ts-ignore
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
  );
};

export default AddTechNodeModal;
