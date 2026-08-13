import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { addToast } from "../appSlice";
import { Modal } from "../flowbite";
import { useAppDispatch } from "../hooks";
import { useLocalizations } from "../localizationContext";
import { normalizePackedFlowName, type FlowPackCatalogEntry } from "../nodeGraph/flowPackOperations";

type FlowPackDialogMode = "load" | "save";

interface FlowPackDialogProps {
  show: boolean;
  mode: FlowPackDialogMode;
  currentFile?: string;
  currentPack?: string;
  getFlowData: () => string;
  onClose: () => void;
  /** `content` is the flow's text when it was read out of a pack, so the editor can load it in place. */
  onOpenFlow: (selection: { flowFile: string; packPath: string; content?: string }) => void;
}

const shortFlowName = (flowName: string) => flowName.replace(/^whmmflows[\\/]/i, "");
const packLabel = (pack: FlowPackCatalogEntry) => pack.humanName?.trim() || pack.name;

const FlowPackDialog: React.FC<FlowPackDialogProps> = ({
  show,
  mode,
  currentFile,
  currentPack,
  getFlowData,
  onClose,
  onOpenFlow,
}) => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const [packs, setPacks] = useState<FlowPackCatalogEntry[]>([]);
  const [selectedPackPath, setSelectedPackPath] = useState("");
  const [selectedPackLabel, setSelectedPackLabel] = useState("");
  const [flowFiles, setFlowFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [selectedFlowName, setSelectedFlowName] = useState("");
  const [newFlowName, setNewFlowName] = useState("");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isLoadingFlows, setIsLoadingFlows] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingOverwrite, setPendingOverwrite] = useState(false);
  const flowRequestId = useRef(0);
  const cancelPendingFlowLoad = useCallback(() => {
    flowRequestId.current++;
  }, []);

  const promotedPacks = useMemo(() => packs.filter((pack) => pack.isEnabled && pack.hasFlows), [packs]);
  const otherPacks = useMemo(() => packs.filter((pack) => !(pack.isEnabled && pack.hasFlows)), [packs]);

  const loadFlows = useCallback(async (packPath: string, tolerateMissing = false) => {
    const requestId = ++flowRequestId.current;
    setIsLoadingFlows(true);
    setError(undefined);
    setFlowFiles([]);
    setSelectedFlowName("");
    try {
      const result = await window.api?.getFlowFilesFromPack(packPath);
      if (requestId !== flowRequestId.current) return;
      if (!result?.success) {
        if (!tolerateMissing) setError(result?.error || "Failed to inspect the selected pack");
        return;
      }
      const nextFlows = (result.flowFiles || []).toSorted((first, second) => first.name.localeCompare(second.name));
      setFlowFiles(nextFlows);
      setSelectedFlowName(nextFlows[0]?.name || "");
    } catch (loadError) {
      if (requestId === flowRequestId.current && !tolerateMissing) {
        setError(loadError instanceof Error ? loadError.message : "Failed to inspect the selected pack");
      }
    } finally {
      if (requestId === flowRequestId.current) setIsLoadingFlows(false);
    }
  }, []);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setError(undefined);
    setPendingOverwrite(false);
    setFlowFiles([]);
    setSelectedFlowName("");
    setNewFlowName(shortFlowName(currentFile || "new_flow.json"));
    setIsLoadingCatalog(true);

    window.api
      ?.getFlowPackCatalog()
      .then((result) => {
        if (cancelled) return;
        const catalog = result?.packs || [];
        setPacks(catalog);
        const initialPack = catalog.find((pack) => pack.path === currentPack) || catalog[0];
        if (!initialPack) return;
        setSelectedPackPath(initialPack.path);
        setSelectedPackLabel(packLabel(initialPack));
        void loadFlows(initialPack.path);
      })
      .catch((catalogError) => {
        if (!cancelled) {
          setError(catalogError instanceof Error ? catalogError.message : "Failed to list mods");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCatalog(false);
      });

    return () => {
      cancelled = true;
      cancelPendingFlowLoad();
    };
  }, [cancelPendingFlowLoad, currentFile, currentPack, loadFlows, show]);

  const selectCatalogPack = (packPath: string) => {
    const selectedPack = packs.find((pack) => pack.path === packPath);
    setSelectedPackPath(packPath);
    setSelectedPackLabel(selectedPack ? packLabel(selectedPack) : packPath);
    setPendingOverwrite(false);
    void loadFlows(packPath);
  };

  const browseForPack = async () => {
    const packPath =
      mode === "load" ? await window.api?.selectFlowPackFile() : await window.api?.selectFlowPackSavePath("flows.pack");
    if (!packPath) return;
    setSelectedPackPath(packPath);
    setSelectedPackLabel(packPath);
    setPendingOverwrite(false);
    void loadFlows(packPath, mode === "save");
  };

  const openSelectedFlow = () => {
    if (!selectedPackPath || !selectedFlowName) return;
    const selectedFlow = flowFiles.find((flow) => flow.name === selectedFlowName);
    onOpenFlow({ packPath: selectedPackPath, flowFile: selectedFlowName, content: selectedFlow?.content });
    onClose();
  };

  const saveFlow = async (overwriteExisting = false) => {
    if (!selectedPackPath) {
      setError("Select a target pack first");
      return;
    }
    const normalizedFlowName = normalizePackedFlowName(newFlowName);
    if (!normalizedFlowName) {
      setError("Enter a valid flow name");
      return;
    }

    setIsSaving(true);
    setError(undefined);
    try {
      const result = await window.api?.saveFlowToPack(
        selectedPackPath,
        normalizedFlowName,
        getFlowData(),
        overwriteExisting,
      );
      if (result?.alreadyExists) {
        setPendingOverwrite(true);
        return;
      }
      if (!result?.success || !result.packPath || !result.flowName) {
        setError(result?.error || "Failed to save the flow");
        return;
      }

      dispatch(
        addToast({
          type: "success",
          messages: [`Saved ${shortFlowName(result.flowName)} to ${result.packPath}`],
          startTime: Date.now(),
        }),
      );
      window.api?.getPackData(result.packPath);
      onOpenFlow({ packPath: result.packPath, flowFile: result.flowName });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save the flow");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal onClose={onClose} show={show && !pendingOverwrite} size="2xl" position="center">
        <Modal.Header>
          {mode === "load"
            ? localized.nodeEditorLoadFlowFromPack || "Load Flow From Pack"
            : localized.nodeEditorSaveFlowToPack || "Save Flow To Pack"}
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4 text-gray-100">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor={`flow-pack-${mode}`}>
                Pack
              </label>
              <div className="flex gap-2">
                <select
                  id={`flow-pack-${mode}`}
                  value={packs.some((pack) => pack.path === selectedPackPath) ? selectedPackPath : ""}
                  onChange={(event) => selectCatalogPack(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white"
                  disabled={isLoadingCatalog}
                >
                  <option value="">{isLoadingCatalog ? "Loading mods…" : "Select a mod…"}</option>
                  {promotedPacks.length > 0 && (
                    <optgroup label={localized.nodeEditorEnabledModsWithFlows || "Enabled mods with flows"}>
                      {promotedPacks.map((pack) => (
                        <option value={pack.path} key={pack.path} className={pack.isInData ? "text-orange-500" : ""}>
                          {packLabel(pack)}
                          {pack.isInData ? " D" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherPacks.length > 0 && (
                    <optgroup label={localized.nodeEditorAllOtherMods || "All other mods"}>
                      {otherPacks.map((pack) => (
                        <option value={pack.path} key={pack.path} className={pack.isInData ? "text-orange-500" : ""}>
                          {packLabel(pack)}
                          {pack.isInData ? " D" : ""}
                          {pack.isEnabled ? " (enabled)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  type="button"
                  onClick={browseForPack}
                  className="rounded-lg bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-500"
                >
                  {mode === "load"
                    ? localized.nodeEditorBrowsePack || "Browse…"
                    : localized.nodeEditorNewPack || "New Pack…"}
                </button>
              </div>
              {selectedPackPath && (
                <div className="mt-2 break-all text-xs text-gray-400" title={selectedPackPath}>
                  {selectedPackLabel}: {selectedPackPath}
                </div>
              )}
            </div>

            {mode === "load" ? (
              <div>
                <div className="mb-2 text-sm font-medium">Flows</div>
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-2">
                  {isLoadingFlows ? (
                    <div className="p-3 text-sm text-gray-400">Loading flows…</div>
                  ) : flowFiles.length === 0 ? (
                    <div className="p-3 text-sm text-gray-400">
                      {localized.nodeEditorNoFlowsInPack || "No flows found in this pack."}
                    </div>
                  ) : (
                    flowFiles.map((flow) => (
                      <label
                        key={flow.name}
                        className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 hover:bg-gray-700"
                      >
                        <input
                          type="radio"
                          name="flow-pack-flow"
                          value={flow.name}
                          checked={selectedFlowName === flow.name}
                          onChange={() => setSelectedFlowName(flow.name)}
                        />
                        <span>{shortFlowName(flow.name)}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="flow-pack-new-name">
                  {localized.nodeEditorFlowNameInsidePack || "Flow name inside pack"}
                </label>
                <input
                  id="flow-pack-new-name"
                  value={newFlowName}
                  onChange={(event) => {
                    setNewFlowName(event.target.value);
                    setPendingOverwrite(false);
                  }}
                  placeholder="my_flow.json"
                  className="w-full rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white"
                />
                {flowFiles.some(
                  (flow) => flow.name.toLowerCase() === normalizePackedFlowName(newFlowName)?.toLowerCase(),
                ) && <div className="mt-2 text-sm text-amber-300">A flow with this name already exists.</div>}
              </div>
            )}

            {error && <div className="rounded border border-red-700 bg-red-950 p-3 text-sm text-red-200">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-gray-600 px-4 py-2 text-white hover:bg-gray-500"
              >
                Cancel
              </button>
              {mode === "load" ? (
                <button
                  type="button"
                  onClick={openSelectedFlow}
                  disabled={!selectedFlowName || isLoadingFlows}
                  className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-600"
                >
                  {localized.nodeEditorOpenFlow || "Open Flow"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void saveFlow(false)}
                  disabled={!selectedPackPath || !newFlowName.trim() || isSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-600"
                >
                  {isSaving ? "Saving…" : "Save To Pack"}
                </button>
              )}
            </div>
          </div>
        </Modal.Body>
      </Modal>

      <Modal onClose={() => setPendingOverwrite(false)} show={show && pendingOverwrite} size="md" position="center">
        <Modal.Header>{localized.nodeEditorOverwriteFlow || "Overwrite Flow?"}</Modal.Header>
        <Modal.Body>
          <div className="space-y-4 text-gray-100">
            <p>
              {shortFlowName(normalizePackedFlowName(newFlowName) || newFlowName)}:{" "}
              {localized.nodeEditorOverwriteFlowPrompt ||
                "A flow with this name already exists in the selected pack. Replace it?"}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingOverwrite(false)}
                className="rounded-lg bg-gray-600 px-4 py-2 text-white hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingOverwrite(false);
                  void saveFlow(true);
                }}
                disabled={isSaving}
                className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-600"
              >
                Overwrite
              </button>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default FlowPackDialog;
