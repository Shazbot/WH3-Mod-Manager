import React, { useContext, useState } from "react";
import type { ShowViewerDialog } from "./viewerDialogs";
import localizationContext from "../../localizationContext";
import ContextMenuSubmenu from "./ContextMenuSubmenu";

export type CopyIntoSubmenuProps = {
  sourcePackPath: string;
  otherOpenPacks?: Array<{ packPath: string; label: string }>;
  showDialog: ShowViewerDialog;
  label?: string;
  onSelectTarget: (targetPackPath: string, openAfterCopy: boolean) => void | Promise<void>;
};

type ViewerPackCatalogEntry = {
  path: string;
  name: string;
  humanName?: string;
  isEnabled: boolean;
  isInData: boolean;
};

const packPathKey = (value: string) => value.replaceAll("/", "\\").toLowerCase();

/** The shared target picker used by both the tree's Copy into action and table row copying. */
const CopyIntoSubmenu = ({
  sourcePackPath,
  otherOpenPacks,
  showDialog,
  label,
  onSelectTarget,
}: CopyIntoSubmenuProps) => {
  const localized: Record<string, string> = useContext(localizationContext);
  const displayLabel = label || localized.viewerCopyInto || "Copy into";
  const [isPackPickerOpen, setIsPackPickerOpen] = useState(false);
  const [isLoadingPackCatalog, setIsLoadingPackCatalog] = useState(false);
  const [packCatalog, setPackCatalog] = useState<ViewerPackCatalogEntry[]>([]);
  const [openCopiedPackAfterCopy, setOpenCopiedPackAfterCopy] = useState(true);

  const selectableOpenPacks = (otherOpenPacks || []).filter(
    (pack) => packPathKey(pack.packPath) !== packPathKey(sourcePackPath),
  );
  const selectablePackCatalog = packCatalog.filter((pack) => packPathKey(pack.path) !== packPathKey(sourcePackPath));
  const enabledPackCatalog = selectablePackCatalog.filter((pack) => pack.isEnabled);

  const handleLoadPackCatalog = async () => {
    if (isLoadingPackCatalog) return;
    setIsPackPickerOpen(true);
    if (packCatalog.length > 0) return;

    setIsLoadingPackCatalog(true);
    try {
      const result = await window.api?.getViewerPackCatalog();
      if (!result?.success) {
        throw new Error(result?.error || localized.viewerFailedToLoadModPacks || "Failed to load mod packs");
      }
      setPackCatalog(result.packs || []);
    } catch (error) {
      console.error("Error loading viewer pack catalog:", error);
      showDialog(
        (localized.viewerLoadModPacksError || "Failed to load mod packs: {{error}}").replace(
          "{{error}}",
          error instanceof Error ? error.message : localized.viewerUnknownError || "Unknown error",
        ),
        { title: localized.viewerPackSelectionFailed || "Pack Selection Failed" },
      );
      setIsPackPickerOpen(false);
    } finally {
      setIsLoadingPackCatalog(false);
    }
  };

  const selectTarget = (targetPackPath: string) => {
    if (packPathKey(targetPackPath) === packPathKey(sourcePackPath)) return;
    setIsPackPickerOpen(false);
    void onSelectTarget(targetPackPath, openCopiedPackAfterCopy);
  };

  return (
    <ContextMenuSubmenu label={displayLabel}>
      <button
        type="button"
        onClick={() => void handleLoadPackCatalog()}
        disabled={isLoadingPackCatalog}
        className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm disabled:opacity-50"
      >
        {isLoadingPackCatalog
          ? localized.viewerLoadingPacks || "Loading Packs..."
          : localized.viewerSelectPack || "Select Pack..."}
      </button>

      {isPackPickerOpen && (
        <div className="px-2 pb-2">
          {isLoadingPackCatalog ? (
            <div className="text-xs text-gray-400 px-1 pt-1">
              {localized.viewerLoadingAllMods || "Loading all mods..."}
            </div>
          ) : selectablePackCatalog.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs text-gray-300">
                <span className="mb-1 block">{localized.viewerEnabledMods || "Enabled mods"}</span>
                <select
                  aria-label={localized.viewerEnabledMods || "Enabled mods"}
                  defaultValue=""
                  onChange={(event) => selectTarget(event.target.value)}
                  className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white"
                >
                  <option value="" disabled>
                    {enabledPackCatalog.length > 0
                      ? localized.viewerChooseEnabledMod || "Choose an enabled mod..."
                      : localized.viewerNoOtherEnabledMods || "No other enabled mods"}
                  </option>
                  {enabledPackCatalog.map((pack) => (
                    <option key={pack.path} value={pack.path} title={pack.path}>
                      {pack.humanName?.trim() || pack.name}
                      {pack.humanName?.trim() && pack.name ? ` (${pack.name})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-gray-300">
                <span className="mb-1 block">{localized.allMods || "All mods"}</span>
                <select
                  aria-label={localized.allMods || "All mods"}
                  defaultValue=""
                  onChange={(event) => selectTarget(event.target.value)}
                  className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white"
                >
                  <option value="" disabled>
                    {localized.viewerChoosePack || "Choose a pack..."}
                  </option>
                  {selectablePackCatalog.map((pack) => (
                    <option key={pack.path} value={pack.path} title={pack.path}>
                      {pack.humanName?.trim() || pack.name}
                      {pack.humanName?.trim() && pack.name ? ` (${pack.name})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="text-xs text-gray-400 px-1 pt-1">
              {localized.viewerNoOtherMods || "No other mods found."}
            </div>
          )}
        </div>
      )}

      <div className="my-1 border-t border-gray-700" />
      {selectableOpenPacks.length > 0 ? (
        selectableOpenPacks.map((pack) => (
          <button
            key={pack.packPath}
            type="button"
            onClick={() => selectTarget(pack.packPath)}
            className="w-full text-left px-3 py-2 hover:bg-gray-700 text-white text-sm truncate"
            title={pack.label}
          >
            {pack.label}
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-xs text-gray-500">
          {localized.viewerNoOtherOpenPacks || "No other packs are open."}
        </div>
      )}

      <label className="mt-1 flex items-start gap-2 border-t border-gray-700 px-3 py-2 text-xs text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={openCopiedPackAfterCopy}
          onChange={(event) => setOpenCopiedPackAfterCopy(event.target.checked)}
          className="mt-0.5"
        />
        <span>{localized.viewerOpenCopiedPackAfterCopy || "Open pack and copied file after copying"}</span>
      </label>
    </ContextMenuSubmenu>
  );
};

export default CopyIntoSubmenu;
