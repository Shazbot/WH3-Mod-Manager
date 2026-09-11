import React, { useContext, useEffect, useMemo, useState } from "react";

import { Modal } from "../../flowbite";
import localizationContext from "../../localizationContext";
import {
  getViewerPackLabel,
  groupViewerPackCatalog,
  type ViewerPackCatalogEntry,
} from "../../utility/viewerPackCatalog";

type OpenPackDialogProps = {
  show: boolean;
  currentPackPath?: string | null;
  onClose: () => void;
  onOpenPack: (packPath: string) => void;
};

const packPathKey = (packPath: string) => packPath.replaceAll("/", "\\").toLowerCase();

const OpenPackDialog = ({ show, currentPackPath, onClose, onOpenPack }: OpenPackDialogProps) => {
  const localized: Record<string, string> = useContext(localizationContext);
  const [packCatalog, setPackCatalog] = useState<ViewerPackCatalogEntry[]>([]);
  const [selectedPackPath, setSelectedPackPath] = useState("");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [error, setError] = useState<string>();

  const enabledPackGroups = useMemo(() => groupViewerPackCatalog(packCatalog, true), [packCatalog]);
  const disabledPackGroups = useMemo(() => groupViewerPackCatalog(packCatalog, false), [packCatalog]);
  const selectedPack = useMemo(
    () => packCatalog.find((pack) => packPathKey(pack.path) === packPathKey(selectedPackPath)),
    [packCatalog, selectedPackPath],
  );

  useEffect(() => {
    if (!show) return;

    let cancelled = false;
    setPackCatalog([]);
    setSelectedPackPath("");
    setError(undefined);
    setIsLoadingCatalog(true);

    const loadCatalog = async () => {
      try {
        const result = await window.api?.getViewerPackCatalog();
        if (cancelled) return;
        if (!result?.success) {
          throw new Error(result?.error || localized.viewerFailedToLoadModPacks || "Failed to load mod packs");
        }

        const catalog = result.packs || [];
        setPackCatalog(catalog);
        const initialPack =
          catalog.find((pack) => packPathKey(pack.path) === packPathKey(currentPackPath || "")) || catalog[0];
        if (initialPack) setSelectedPackPath(initialPack.path);
      } catch (catalogError) {
        if (!cancelled) {
          setError(
            catalogError instanceof Error
              ? catalogError.message
              : localized.viewerFailedToLoadModPacks || "Failed to load mod packs",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingCatalog(false);
      }
    };

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [currentPackPath, localized.viewerFailedToLoadModPacks, show]);

  const browseForPack = async () => {
    const packPath = await window.api?.selectFlowPackFile();
    if (packPath) setSelectedPackPath(packPath);
  };

  const optionText = (pack: ViewerPackCatalogEntry, indentLevel: number) => {
    const indentation = indentLevel > 0 ? `${"\u00a0\u00a0".repeat(indentLevel)}↳ ` : "";
    return `${indentation}${getViewerPackLabel(pack)} — ${pack.path}`;
  };

  const renderPackGroups = (groups: ReturnType<typeof groupViewerPackCatalog>) =>
    groups.map((group) =>
      group.packs.map((pack, index) => (
        <option
          key={pack.path}
          value={pack.path}
          title={pack.path}
          className={pack.isInData ? "text-orange-500" : undefined}
        >
          {optionText(pack, index)}
        </option>
      )),
    );

  return (
    <Modal onClose={onClose} show={show} size="2xl" position="center">
      <Modal.Header>{localized.viewerOpenPack || "Open Pack"}</Modal.Header>
      <Modal.Body>
        <div className="space-y-4 text-gray-100">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="viewer-open-pack">
              {localized.viewerSelectPack || "Select Pack..."}
            </label>
            <div className="flex gap-2">
              <select
                id="viewer-open-pack"
                aria-label={localized.viewerSelectPack || "Select Pack..."}
                value={
                  packCatalog.some((pack) => packPathKey(pack.path) === packPathKey(selectedPackPath))
                    ? selectedPackPath
                    : ""
                }
                onChange={(event) => setSelectedPackPath(event.target.value)}
                disabled={isLoadingCatalog}
                className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-white"
              >
                <option value="">
                  {isLoadingCatalog
                    ? localized.viewerLoadingPacks || "Loading Packs..."
                    : localized.viewerChoosePack || "Choose a pack..."}
                </option>
                {enabledPackGroups.length > 0 && (
                  <optgroup label={localized.viewerEnabledMods || "Enabled mods"}>
                    {renderPackGroups(enabledPackGroups)}
                  </optgroup>
                )}
                {disabledPackGroups.length > 0 && (
                  <optgroup label={localized.viewerDisabledMods || "Disabled mods"}>
                    {renderPackGroups(disabledPackGroups)}
                  </optgroup>
                )}
              </select>
              <button
                type="button"
                onClick={() => void browseForPack()}
                className="rounded-lg bg-gray-600 px-4 py-2 font-medium text-white hover:bg-gray-500"
              >
                {localized.viewerBrowse || "Browse"}
              </button>
            </div>
            {selectedPackPath && (
              <div className="mt-2 break-all text-xs text-gray-400" title={selectedPackPath}>
                {selectedPack ? getViewerPackLabel(selectedPack) : localized.viewerPack || "Pack"}: {selectedPackPath}
              </div>
            )}
          </div>

          {error && <div className="rounded border border-red-700 bg-red-950 p-3 text-sm text-red-200">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-600 px-4 py-2 text-white hover:bg-gray-500"
            >
              {localized.cancel || "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!selectedPackPath) return;
                onOpenPack(selectedPackPath);
                onClose();
              }}
              disabled={!selectedPackPath || isLoadingCatalog}
              className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-600"
            >
              {localized.viewerOpenPack || "Open Pack"}
            </button>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default OpenPackDialog;
