import React, { useState, useEffect } from "react";

interface FlowWithOptions {
  flowName: string;
  isGraphEnabled: boolean;
  graphStartsEnabled: boolean;
  options: FlowOption[];
}

const UserFlowOptionsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  mod: Mod;
}> = ({ isOpen, onClose, mod }) => {
  const [flows, setFlows] = useState<FlowWithOptions[]>([]);
  const [userValues, setUserValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (isOpen && mod) {
      loadFlowOptions();
    }
  }, [isOpen, mod]);

  const loadFlowOptions = async () => {
    try {
      // Get all flow files from the pack
      const result = await window.api?.getFlowFilesFromPack(mod.path);
      if (!result) return;

      const loadedFlows: FlowWithOptions[] = [];

      for (const flowFile of result.flowFiles) {
        try {
          // Parse the flow file JSON
          const flowData = JSON.parse(flowFile.content);

          // Extract options from the serialized graph
          // Note: Flow options should be stored in the serialized graph metadata
          const options = flowData.options || [];
          const isGraphEnabled = flowData.isGraphEnabled || false;
          const graphStartsEnabled = flowData.graphStartsEnabled !== false;

          loadedFlows.push({
            flowName: flowFile.name,
            isGraphEnabled,
            graphStartsEnabled,
            options,
          });
        } catch (e) {
          console.error(`Failed to parse flow file ${flowFile.name}:`, e);
        }
      }

      setFlows(loadedFlows);
    } catch (error) {
      console.error("Error loading flow options:", error);
    }
  };

  const handleOptionValueChange = (flowName: string, optionId: string, value: any) => {
    setUserValues((prev) => ({
      ...prev,
      [`${flowName}_${optionId}`]: value,
    }));
  };

  const handleGraphToggle = (flowName: string, enabled: boolean) => {
    setUserValues((prev) => ({
      ...prev,
      [`${flowName}_graphEnabled`]: enabled,
    }));
  };

  const getUserValue = (flowName: string, optionId: string, defaultValue: any) => {
    const key = `${flowName}_${optionId}`;
    return userValues[key] !== undefined ? userValues[key] : defaultValue;
  };

  const getGraphEnabled = (flowName: string, defaultValue: boolean) => {
    const key = `${flowName}_graphEnabled`;
    return userValues[key] !== undefined ? userValues[key] : defaultValue;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Flow Options - {mod.humanName || mod.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
            ×
          </button>
        </div>

        {flows.length === 0 ? (
          <p className="text-gray-400">No flow options available for this mod.</p>
        ) : (
          <div className="space-y-6">
            {flows.map((flow) => (
              <div key={flow.flowName} className="bg-gray-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-3">
                  {flow.flowName.replace("whmmflows\\", "").replace(".json", "")}
                </h3>

                {/* Graph toggle for this flow */}
                {flow.isGraphEnabled && (
                  <div className="mb-4 p-3 bg-gray-600 rounded border border-indigo-500">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={getGraphEnabled(flow.flowName, flow.graphStartsEnabled)}
                        onChange={(e) => handleGraphToggle(flow.flowName, e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-white font-medium">Enable this flow</span>
                    </label>
                  </div>
                )}

                {/* Flow options */}
                {flow.options.length === 0 ? (
                  <p className="text-gray-400 text-sm">No configurable options for this flow.</p>
                ) : (
                  <div className="space-y-3">
                    {flow.options.map((option: FlowOption) => (
                      <div key={option.id} className="bg-gray-600 rounded p-3">
                        <div className="mb-2">
                          <h4 className="text-white font-medium">{option.name}</h4>
                          {option.description && (
                            <p className="text-gray-300 text-sm">{option.description}</p>
                          )}
                        </div>

                        {/* Render based on option type */}
                        {option.type === "textbox" && (
                          <input
                            type="text"
                            value={getUserValue(flow.flowName, option.id, option.value)}
                            onChange={(e) =>
                              handleOptionValueChange(flow.flowName, option.id, e.target.value)
                            }
                            placeholder={option.placeholder}
                            className="w-full p-2 bg-gray-700 text-white rounded text-sm"
                          />
                        )}

                        {option.type === "range" && (
                          <div>
                            <input
                              type="range"
                              min={option.min}
                              max={option.max}
                              step={option.step}
                              value={getUserValue(flow.flowName, option.id, option.value)}
                              onChange={(e) =>
                                handleOptionValueChange(flow.flowName, option.id, Number(e.target.value))
                              }
                              className="w-full"
                            />
                            <div className="flex justify-between text-xs text-gray-300 mt-1">
                              <span>{option.min}</span>
                              <span className="font-medium">
                                {getUserValue(flow.flowName, option.id, option.value)}
                              </span>
                              <span>{option.max}</span>
                            </div>
                          </div>
                        )}

                        {option.type === "checkbox" && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={getUserValue(flow.flowName, option.id, option.value)}
                              onChange={(e) =>
                                handleOptionValueChange(flow.flowName, option.id, e.target.checked)
                              }
                              className="w-4 h-4"
                            />
                            <span className="text-sm text-gray-300">
                              {getUserValue(flow.flowName, option.id, option.value) ? "Checked" : "Unchecked"}
                            </span>
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
          >
            Close
          </button>
          <button
            onClick={() => {
              // TODO: Save user values
              console.log("User values:", userValues);
              onClose();
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserFlowOptionsModal;
