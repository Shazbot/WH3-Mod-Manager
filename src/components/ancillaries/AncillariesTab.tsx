import React, { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Modal } from "../../flowbite";
import { useAppSelector } from "../../hooks";
import { useLocalizations } from "../../localizationContext";
import { useDeferredWhileInactive } from "../useDeferredWhileInactive";
import { useBuildingsDeepClone } from "../buildings/useBuildingsDeepClone";
import { dbClonePackedFilesToBuildingsRows } from "../../buildingsData/dbCloneRows";
import DBDuplication from "../viewer/DBDuplication";
import AncillariesBrowser from "./AncillariesBrowser";
import AncillaryDetail from "./AncillaryDetail";
import AncillariesTablesTab from "./AncillariesTablesTab";
import AncillariesSaveModal from "./AncillariesSaveModal";
import {
  LOC_TABLE,
  ancillariesEditReducer,
  emptyAncillariesEditState,
  type AncillariesNewRow,
} from "../../ancillariesData/edits";
import { ancillaryColourTextLocKey, ancillaryExplanationLocKey, ancillaryNameLocKey } from "../../ancillariesData/data";
import type { AncillariesRowIssue } from "../../ancillariesData/validate";
import type { AncillariesCatalog, AncillaryDetail as AncillaryDetailModel } from "../../ancillariesData/types";
import type { DBVersion, PackedFile } from "../../packFileTypes";

export type AncillariesTabProps = { isActive?: boolean };

const AncillariesTab = memo(({ isActive = true }: AncillariesTabProps) => {
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const moddersPrefix = useAppSelector((state) => state.app.moddersPrefix);
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);
  const localized = useLocalizations();

  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const enabledModsSignature = useMemo(
    () =>
      enabledMods
        .map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}:${mod.lastChanged ?? ""}`)
        .join("|"),
    [enabledMods],
  );
  // While hidden this stays at the signature the tab last saw, so enabling a mod elsewhere queues
  // the rebuild instead of running it; switching back releases the current signature.
  const signatureToRequest = useDeferredWhileInactive(isActive, enabledModsSignature);
  const enabledModsRef = useRef(enabledMods);
  enabledModsRef.current = enabledMods;

  const [catalog, setCatalog] = useState<AncillariesCatalog>();
  const [detail, setDetail] = useState<AncillaryDetailModel>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [rowIssues, setRowIssues] = useState<AncillariesRowIssue[]>();
  const [subTab, setSubTab] = useState<"browser" | "tables">("browser");
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [edits, dispatchEdit] = useReducer(ancillariesEditReducer, undefined, () => emptyAncillariesEditState());
  const [cloneTableSchemas, setCloneTableSchemas] = useState<Record<string, DBVersion>>({});

  const deepClone = useBuildingsDeepClone(catalog?.dbPackPath);
  const closeDeepClone = deepClone.close;

  const modOptions = useMemo(
    () =>
      enabledMods.map((mod) => ({
        path: mod.path,
        label: mod.humanName?.trim() || mod.name.replace(/\.pack$/i, ""),
      })),
    [enabledMods],
  );

  const tableSchemas = useMemo(
    () => ({ ...(catalog?.tableSchemas ?? {}), ...cloneTableSchemas }),
    [catalog?.tableSchemas, cloneTableSchemas],
  );

  // The catalog: rebuilt whenever the enabled mod set changes, or after pending rows are cleared.
  useEffect(() => {
    if (currentGame !== "wh3") return;
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);
    window.api
      ?.getAncillariesCatalog(enabledModsRef.current)
      .then((result) => {
        if (cancelled) return;
        if (!result?.success || !result.catalog) {
          setError(result?.error || localized.ancillariesLoadFailed || "Failed to load Ancillaries");
          setCatalog(undefined);
          return;
        }
        setCatalog(result.catalog);
        dispatchEdit({ type: "seedNumericIdCursors", numericIdCursors: result.catalog.nextNumericIds });
        // A selection the new catalog no longer has would leave the panel showing a stale card.
        setSelectedKey((current) =>
          current && result.catalog!.ancillaries.some((ancillary) => ancillary.key === current) ? current : undefined,
        );
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : localized.ancillariesLoadFailed || "Failed to load Ancillaries",
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `signatureToRequest` already encodes every enabled mod's path, load order and change stamps,
    // so it is the dependency that matters; depending on `enabledMods` too would rebuild every time
    // pack reading handed Redux a fresh array.
  }, [currentGame, localized.ancillariesLoadFailed, reloadNonce, signatureToRequest]);

  /**
   * The pending rows, settled.
   *
   * Every keystroke in a text field dispatches, and each refetch re-derives the whole dataset in the
   * main process - ~2.7k ancillaries and ~4.4k effect rows. Typing a name would otherwise fire one
   * full rebuild per character. The panel keeps showing the pending value throughout, because it
   * reads that out of `edits` directly rather than waiting for the response.
   */
  const [settledEdits, setSettledEdits] = useState(edits);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledEdits(edits), 250);
    return () => window.clearTimeout(timer);
  }, [edits]);

  // The detail card: refetched when the selection changes, and once the pending rows settle, so the
  // card and the New rows grid never disagree about what the effective row is.
  useEffect(() => {
    if (!selectedKey || currentGame !== "wh3") {
      setDetail(undefined);
      return;
    }
    let cancelled = false;
    window.api
      ?.getAncillariesDetail(enabledModsRef.current, selectedKey, settledEdits)
      .then((result) => {
        if (cancelled) return;
        if (!result?.success) {
          setError(result?.error || `${localized.ancillariesDetailLoadFailed || "Failed to load"} ${selectedKey}`);
          return;
        }
        setDetail(result.detail);
        setRowIssues(result.rowIssues);
        if (result.catalog) setCatalog(result.catalog);
        setError(undefined);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : `${localized.ancillariesDetailLoadFailed || "Failed to load"} ${selectedKey}`,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [currentGame, localized.ancillariesDetailLoadFailed, selectedKey, settledEdits]);

  const openCloneFor = useCallback(
    (key: string) => {
      deepClone.openDeepCloneFor({
        tableName: "ancillaries_tables",
        keyColumn: "key",
        keyValue: key,
        label: key,
      });
    },
    [deepClone],
  );

  const saveCloneToAncillaries = useCallback(
    (packedFiles: PackedFile[]) => {
      // The clone output is already generic over table name; only the origin literal is shared.
      const cloneOutput = dbClonePackedFilesToBuildingsRows(packedFiles);
      if (cloneOutput.rows.length === 0) {
        setError(localized.ancillariesCloneNoRows || "DB Clone did not generate any rows.");
        return;
      }
      dispatchEdit({ type: "addRows", rows: cloneOutput.rows });
      setCloneTableSchemas((current) => ({ ...current, ...cloneOutput.tableSchemas }));
      setError(undefined);
      setSubTab("tables");
      closeDeepClone();
    },
    [closeDeepClone, localized.ancillariesCloneNoRows],
  );

  /**
   * A brand new ancillary.
   *
   * Five rows in one group so undo removes them together: the `ancillaries_tables` row, the
   * `ancillary_info_tables` row its key references, and one loc row per text field.
   */
  const addAncillary = useCallback(() => {
    const prefix = moddersPrefix.trim().replace(/_+$/, "") || "custom";
    const key = `${prefix}_anc_${Date.now().toString(36)}`;
    const schema = tableSchemas.ancillaries_tables;
    const values: Record<string, string> = {};
    for (const field of schema?.fields ?? []) values[field.name] = field.default_value ?? "";
    values.key = key;
    values.category = catalog?.categories[0]?.key ?? "";
    values.type = catalog?.types[0]?.key ?? "";

    const rows: Array<Omit<AncillariesNewRow, "id" | "groupId">> = [
      { table: "ancillaries_tables", origin: "newAncillary", values },
      { table: "ancillary_info_tables", origin: "newAncillary", values: { ancillary: key } },
      {
        table: LOC_TABLE,
        origin: "newAncillary",
        values: { key: ancillaryNameLocKey(key), text: localized.ancillariesNewAncillaryName || "New Ancillary" },
      },
      { table: LOC_TABLE, origin: "newAncillary", values: { key: ancillaryExplanationLocKey(key), text: "" } },
      { table: LOC_TABLE, origin: "newAncillary", values: { key: ancillaryColourTextLocKey(key), text: "" } },
    ];
    dispatchEdit({ type: "addRows", rows });
    setSelectedKey(key);
    setSubTab("browser");
  }, [catalog, localized.ancillariesNewAncillaryName, moddersPrefix, tableSchemas]);

  const clearPendingEdits = useCallback(() => {
    dispatchEdit({ type: "reset" });
    setCloneTableSchemas({});
    setRowIssues(undefined);
    setError(undefined);
    // Pending rows may have added catalog options and ancillaries. Reload the base catalog so those
    // disappear at the same time as the rows.
    setReloadNonce((previous) => previous + 1);
  }, []);

  if (currentGame !== "wh3") {
    return (
      <div className="p-6 text-sm text-gray-400">
        {localized.ancillariesWh3Only || "Ancillaries are available only for Warhammer 3."}
      </div>
    );
  }

  const pendingRowCount = edits.order.length;
  // Everything that writes rows is modder-only, and so is the grid that lists them: without the
  // option the tab is a read-only browser, whichever sub-tab was left selected.
  const activeSubTab = isFeaturesForModdersEnabled ? subTab : "browser";

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col text-gray-100">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-700 bg-gray-900 px-4 py-2">
        {isFeaturesForModdersEnabled && (
          <>
            <div className="flex overflow-hidden rounded border border-gray-700">
              {(["browser", "tables"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSubTab(tab)}
                  className={`px-3 py-1 text-sm ${
                    subTab === tab ? "bg-amber-700 text-white" : "bg-gray-900 text-gray-400 hover:text-white"
                  }`}
                >
                  {tab === "browser"
                    ? localized.ancillariesBrowserTab || "Browser"
                    : `${localized.ancillariesNewRowsTab || "New rows"}${
                        pendingRowCount > 0 ? ` (${pendingRowCount})` : ""
                      }`}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={addAncillary}
              className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600"
            >
              {localized.ancillariesNewAncillary || "New ancillary"}
            </button>
            <button
              type="button"
              onClick={() => setIsSaveOpen(true)}
              disabled={pendingRowCount === 0}
              className="rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {localized.ancillariesSaveToPack || "Save to pack"}
            </button>
          </>
        )}

        {rowIssues && rowIssues.length > 0 && (
          <span className="text-xs text-amber-400">
            {rowIssues.length === 1
              ? localized.ancillariesRowIssueOne || "1 issue in the new rows"
              : (localized.ancillariesRowIssuesOther || "{{count}} issues in the new rows").replace(
                  "{{count}}",
                  `${rowIssues.length}`,
                )}
          </span>
        )}
        {error && <span className="ml-auto truncate text-xs text-red-400">{error}</span>}
      </div>

      {activeSubTab === "browser" ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-gray-700 bg-gray-900">
            <AncillariesBrowser
              catalog={catalog}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onContextMenu={
                isFeaturesForModdersEnabled
                  ? (ancillary, event) => {
                      event.preventDefault();
                      openCloneFor(ancillary.key);
                    }
                  : undefined
              }
              mods={modOptions}
              isLoading={isLoading}
              error={error}
            />
          </aside>
          <main className="min-w-0 flex-1 bg-gray-950">
            <AncillaryDetail
              detail={detail}
              catalog={catalog}
              edits={edits}
              dispatch={dispatchEdit}
              isEditingEnabled={isFeaturesForModdersEnabled}
              onClone={openCloneFor}
              isCloning={deepClone.isResolving}
            />
          </main>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <AncillariesTablesTab
            state={edits}
            dispatch={dispatchEdit}
            onClearAll={clearPendingEdits}
            tableSchemas={tableSchemas}
            rowIssues={rowIssues}
          />
        </div>
      )}

      {isSaveOpen && isFeaturesForModdersEnabled && (
        <AncillariesSaveModal
          state={edits}
          tableSchemas={tableSchemas}
          moddersPrefix={moddersPrefix}
          onClose={() => setIsSaveOpen(false)}
          onSaved={() => setIsSaveOpen(false)}
        />
      )}

      {deepClone.isResolving && (
        <div className="fixed bottom-4 right-4 z-[80] rounded bg-gray-800 px-3 py-2 text-xs text-gray-200 shadow-lg">
          {localized.ancillariesReadingTableFor || "Reading the table for"} {deepClone.resolvingLabel}...
        </div>
      )}

      {deepClone.error && (
        <Modal onClose={deepClone.dismissError} show size="md" position="center">
          <Modal.Header>{localized.ancillariesDeepClone || "Deep clone"}</Modal.Header>
          <Modal.Body>
            <p className="text-sm text-gray-300">{deepClone.error}</p>
          </Modal.Body>
        </Modal>
      )}

      {deepClone.isDialogOpen && (
        <Modal
          onClose={deepClone.close}
          show
          size="6xl"
          position="top-center"
          explicitClasses={["mt-8", "!max-w-7xl", "md:!h-full", "overflow-hidden", "modalDontOverflowWindowHeight"]}
        >
          <Modal.Header>{localized.ancillariesDeepCloning || "Deep Cloning..."}</Modal.Header>
          <Modal.Body>
            <div className="mt-8 text-center">
              <DBDuplication launchSource="ancillaries" onSaveToBuildings={saveCloneToAncillaries} />
            </div>
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
});

export default AncillariesTab;
