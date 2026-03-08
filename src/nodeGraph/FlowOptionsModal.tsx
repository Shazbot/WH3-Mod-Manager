import React, { useState } from "react";

import { addToast } from "../appSlice";
import { useAppDispatch } from "../hooks";
import { useLocalizations } from "../localizationContext";
import { stopWheelPropagation } from "./nodes/shared";
import { FlowOption } from "./types";

export const FlowOptionsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  options: FlowOption[];
  onOptionsChange: (options: FlowOption[]) => void;
  isGraphEnabled: boolean;
  onGraphEnabledChange: (enabled: boolean) => void;
  graphStartsEnabled: boolean;
  onGraphStartsEnabledChange: (enabled: boolean) => void;
}> = ({
  isOpen,
  onClose,
  options,
  onOptionsChange,
  isGraphEnabled,
  onGraphEnabledChange,
  graphStartsEnabled,
  onGraphStartsEnabledChange,
}) => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const [editingOption, setEditingOption] = useState<FlowOption | null>(null);
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [newOptionType, setNewOptionType] = useState<"textbox" | "range" | "checkbox">("textbox");

  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    value: "",
    placeholder: "",
    min: 0,
    max: 100,
    step: 1,
    checked: false,
  });

  const resetForm = () => {
    setFormData({
      id: "",
      name: "",
      description: "",
      value: "",
      placeholder: "",
      min: 0,
      max: 100,
      step: 1,
      checked: false,
    });
    setEditingOption(null);
    setIsAddingOption(false);
  };

  const handleAddOption = () => {
    if (!formData.id.trim() || !formData.name.trim()) return;

    if (options.some((opt) => opt.id === formData.id.trim())) {
      dispatch(
        addToast({
          type: "warning",
          messages: [
            (
              localized.nodeEditorOptionIdAlreadyExists ||
              'Option ID "{{id}}" already exists. Please use a unique ID.'
            ).replace("{{id}}", formData.id),
          ],
          startTime: Date.now(),
        }),
      );
      return;
    }

    const newOption: FlowOption =
      newOptionType === "textbox"
        ? {
            id: formData.id.trim(),
            type: "textbox",
            name: formData.name,
            description: formData.description || undefined,
            value: formData.value,
            placeholder: formData.placeholder || undefined,
          }
        : newOptionType === "range"
          ? {
              id: formData.id.trim(),
              type: "range",
              name: formData.name,
              description: formData.description || undefined,
              value: Number(formData.value) || formData.min,
              min: formData.min,
              max: formData.max,
              step: formData.step,
            }
          : {
              id: formData.id.trim(),
              type: "checkbox",
              name: formData.name,
              description: formData.description || undefined,
              value: formData.checked,
            };

    onOptionsChange([...options, newOption]);
    resetForm();
  };

  const handleEditOption = (option: FlowOption) => {
    setEditingOption(option);
    setFormData({
      id: option.id,
      name: option.name,
      description: option.description || "",
      value:
        option.type === "textbox" ? option.value : option.type === "range" ? option.value.toString() : "",
      placeholder: option.type === "textbox" ? option.placeholder || "" : "",
      min: option.type === "range" ? option.min : 0,
      max: option.type === "range" ? option.max : 100,
      step: option.type === "range" ? option.step : 1,
      checked: option.type === "checkbox" ? option.value : false,
    });
    setNewOptionType(option.type);
  };

  const handleUpdateOption = () => {
    if (!editingOption || !formData.id.trim() || !formData.name.trim()) return;

    if (formData.id.trim() !== editingOption.id && options.some((opt) => opt.id === formData.id.trim())) {
      dispatch(
        addToast({
          type: "warning",
          messages: [
            (
              localized.nodeEditorOptionIdAlreadyExists ||
              'Option ID "{{id}}" already exists. Please use a unique ID.'
            ).replace("{{id}}", formData.id),
          ],
          startTime: Date.now(),
        }),
      );
      return;
    }

    const updatedOption: FlowOption =
      editingOption.type === "textbox"
        ? {
            ...editingOption,
            id: formData.id.trim(),
            name: formData.name,
            description: formData.description || undefined,
            value: formData.value,
            placeholder: formData.placeholder || undefined,
          }
        : editingOption.type === "range"
          ? {
              ...editingOption,
              id: formData.id.trim(),
              name: formData.name,
              description: formData.description || undefined,
              value: Number(formData.value) || editingOption.min,
              min: formData.min,
              max: formData.max,
              step: formData.step,
            }
          : {
              ...editingOption,
              id: formData.id.trim(),
              name: formData.name,
              description: formData.description || undefined,
              value: formData.checked,
            };

    onOptionsChange(options.map((opt) => (opt.id === editingOption.id ? updatedOption : opt)));
    resetForm();
  };

  const handleDeleteOption = (optionId: string) => {
    onOptionsChange(options.filter((opt) => opt.id !== optionId));
  };

  const handleOptionValueChange = (optionId: string, newValue: string | number | boolean) => {
    onOptionsChange(
      options.map((opt) => (opt.id === optionId ? ({ ...opt, value: newValue } as FlowOption) : opt)),
    );
  };

  if (!isOpen) return null;

  const getOptionTypeLabel = (type: FlowOption["type"]) => {
    if (type === "textbox") return localized.nodeEditorOptionTypeTextbox || "Textbox";
    if (type === "range") return localized.nodeEditorOptionTypeRangeSlider || "Range Slider";
    return localized.nodeEditorOptionTypeCheckbox || "Checkbox";
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto scrollable-node-content"
        onWheel={stopWheelPropagation}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">
            {localized.nodeEditorFlowOptions || "Flow Options"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
            ×
          </button>
        </div>

        <div className="mb-6 p-4 bg-gray-700 rounded-lg border-2 border-indigo-500">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isGraphEnabled}
              onChange={(e) => onGraphEnabledChange(e.target.checked)}
              className="w-5 h-5"
            />
            <div>
              <span className="text-white font-semibold text-lg">
                {localized.nodeEditorUserCanDisableFlow || "User Can Disable Flow"}
              </span>
              <p className="text-gray-300 text-sm">
                {localized.nodeEditorUserCanDisableFlowDescription ||
                  "If enabled the user options will have a checkbox that disables or enables the whole flow."}
              </p>
            </div>
          </label>

          {isGraphEnabled && (
            <div className="mt-3 ml-8 pl-4 border-l-2 border-indigo-400">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={graphStartsEnabled}
                  onChange={(e) => onGraphStartsEnabledChange(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-gray-300 text-sm">
                  {localized.nodeEditorFlowStartsEnabledByDefault || "Flow starts enabled by default"}
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">
            {localized.nodeEditorCurrentOptions || "Current Options"}
          </h3>
          {options.length === 0 ? (
            <p className="text-gray-400 text-sm">
              {localized.nodeEditorNoOptionsConfiguredYet || "No options configured yet."}
            </p>
          ) : (
            <div className="space-y-3">
              {options.map((option) => (
                <div key={option.id} className="bg-gray-700 rounded p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="text-white font-medium">{option.name}</h4>
                      <p className="text-blue-300 text-xs font-mono mt-1">{`{{${option.id}}}`}</p>
                      {option.description && (
                        <p className="text-gray-300 text-sm mt-1">{option.description}</p>
                      )}
                      <span className="inline-block bg-gray-600 text-xs px-2 py-1 rounded mt-1">
                        {getOptionTypeLabel(option.type)}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditOption(option)}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        {localized.edit || "Edit"}
                      </button>
                      <button
                        onClick={() => handleDeleteOption(option.id)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        {localized.delete || "Delete"}
                      </button>
                    </div>
                  </div>

                  {option.type === "textbox" ? (
                    <input
                      type="text"
                      value={option.value}
                      onChange={(e) => handleOptionValueChange(option.id, e.target.value)}
                      placeholder={option.placeholder}
                      className="w-full p-2 bg-gray-600 text-white rounded text-sm"
                    />
                  ) : option.type === "range" ? (
                    <div>
                      <input
                        type="range"
                        min={option.min}
                        max={option.max}
                        step={option.step}
                        value={option.value}
                        onChange={(e) => handleOptionValueChange(option.id, Number(e.target.value))}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-gray-300 mt-1">
                        <span>{option.min}</span>
                        <span className="font-medium">{option.value}</span>
                        <span>{option.max}</span>
                      </div>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={option.value}
                        onChange={(e) => handleOptionValueChange(option.id, e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-300">
                        {option.value
                          ? localized.nodeEditorChecked || "Checked"
                          : localized.nodeEditorUnchecked || "Unchecked"}
                      </span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {(isAddingOption || editingOption) && (
          <div className="mb-6 bg-gray-700 rounded p-4">
            <h3 className="text-lg font-semibold text-white mb-3">
              {editingOption
                ? localized.nodeEditorEditOption || "Edit Option"
                : localized.nodeEditorAddNewOption || "Add New Option"}
            </h3>

            {!editingOption && (
              <div className="mb-4">
                <label className="block text-white text-sm font-medium mb-2">
                  {localized.nodeEditorOptionType || "Option Type"}
                </label>
                <select
                  value={newOptionType}
                  onChange={(e) => setNewOptionType(e.target.value as "textbox" | "range" | "checkbox")}
                  className="w-full p-2 bg-gray-600 text-white rounded"
                >
                  <option value="textbox">{localized.nodeEditorOptionTypeTextbox || "Textbox"}</option>
                  <option value="range">{localized.nodeEditorOptionTypeRangeSlider || "Range Slider"}</option>
                  <option value="checkbox">{localized.nodeEditorOptionTypeCheckbox || "Checkbox"}</option>
                </select>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-white text-sm font-medium mb-2">
                {localized.nodeEditorIdRequired || "ID *"}{" "}
                <span className="text-gray-400 text-xs">
                  ({localized.nodeEditorUseInNodesAs || "use in nodes as"} {`{{id}}`})
                </span>
              </label>
              <input
                type="text"
                value={formData.id}
                onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                className="w-full p-2 bg-gray-600 text-white rounded"
                placeholder={localized.nodeEditorOptionIdExamplePlaceholder || "e.g. damageMultiplier"}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  {localized.nodeEditorDisplayNameRequired || "Display Name *"}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2 bg-gray-600 text-white rounded"
                  placeholder={localized.nodeEditorDisplayNameExamplePlaceholder || "Damage Multiplier"}
                />
              </div>
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  {localized.description || "Description"}
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full p-2 bg-gray-600 text-white rounded"
                  placeholder={localized.nodeEditorOptionalDescriptionPlaceholder || "Optional description"}
                />
              </div>
            </div>

            {newOptionType === "textbox" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    {localized.nodeEditorDefaultValue || "Default Value"}
                  </label>
                  <input
                    type="text"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    {localized.nodeEditorPlaceholder || "Placeholder"}
                  </label>
                  <input
                    type="text"
                    value={formData.placeholder}
                    onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
              </div>
            ) : newOptionType === "range" ? (
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    {localized.nodeEditorMin || "Min"}
                  </label>
                  <input
                    type="number"
                    value={formData.min}
                    onChange={(e) => setFormData({ ...formData, min: Number(e.target.value) })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    {localized.nodeEditorMax || "Max"}
                  </label>
                  <input
                    type="number"
                    value={formData.max}
                    onChange={(e) => setFormData({ ...formData, max: Number(e.target.value) })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    {localized.nodeEditorStep || "Step"}
                  </label>
                  <input
                    type="number"
                    value={formData.step}
                    onChange={(e) => setFormData({ ...formData, step: Number(e.target.value) })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                    step="0.1"
                    min="0.1"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-2">
                    {localized.nodeEditorDefault || "Default"}
                  </label>
                  <input
                    type="number"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    className="w-full p-2 bg-gray-600 text-white rounded"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.checked}
                    onChange={(e) => setFormData({ ...formData, checked: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-white text-sm font-medium">
                    {localized.nodeEditorDefaultColon || "Default:"}{" "}
                    {formData.checked
                      ? localized.nodeEditorChecked || "Checked"
                      : localized.nodeEditorUnchecked || "Unchecked"}
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={editingOption ? handleUpdateOption : handleAddOption}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                {editingOption ? localized.update || "Update" : localized.add || "Add"}{" "}
                {localized.nodeEditorOption || "Option"}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
              >
                {localized.cancel || "Cancel"}
              </button>
            </div>
          </div>
        )}

        {!isAddingOption && !editingOption && (
          <button
            onClick={() => setIsAddingOption(true)}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded font-medium"
          >
            {localized.nodeEditorAddNewOption || "Add New Option"}
          </button>
        )}
      </div>
    </div>
  );
};
