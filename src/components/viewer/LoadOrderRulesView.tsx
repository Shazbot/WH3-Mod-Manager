import React, { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import Creatable from "react-select/creatable";

import { useAppSelector } from "@/src/hooks";
import { makeSelectCurrentPackData, makeSelectCurrentPackUnsavedFiles } from "./viewerSelectors";
import type { ShowViewerDialog } from "./viewerDialogs";
import { getPackNameFromPath } from "@/src/utility/packFileHelpers";
import { vanillaPackNames } from "@/src/supportedGames";
import localizationContext from "@/src/localizationContext";
import { decodePackedTextBuffer } from "@/src/utility/packFileViewing";
import {
  parseLoadOrderRulesRows,
  serializeLoadOrderRuleRows,
  type LoadOrderRuleRow,
  type LoadOrderRulesFileError,
} from "@/src/utility/loadOrderRulesFile";
import { normalizeLoadOrderPackName } from "@/src/loadOrderRules";
import selectStyle from "@/src/styles/selectStyle";

type PackNameOption = {
  value: string;
  label: string;
};

type ViewerPackCatalogEntry = {
  name: string;
};

type LoadOrderRulesViewProps = {
  packPath: string;
  filePath: string;
  showDialog: ShowViewerDialog;
};

/**
 * The two column editor for a pack's own whmm\load_order.whmm.
 *
 * Both columns are about the pack this file lives in, which is why one relation and one pack name is
 * the whole rule. The file itself stays plain text, so a bad hand-edit shows up as a listed error
 * rather than losing the rows that were fine.
 */
const LoadOrderRulesView = memo(({ packPath, filePath, showDialog }: LoadOrderRulesViewProps) => {
  const localized: Record<string, string> = useContext(localizationContext);
  const selectCurrentPackData = useMemo(makeSelectCurrentPackData, []);
  const selectCurrentPackUnsavedFiles = useMemo(makeSelectCurrentPackUnsavedFiles, []);
  const packData = useAppSelector((state) => selectCurrentPackData(state, packPath));
  const unsavedFiles = useAppSelector((state) => selectCurrentPackUnsavedFiles(state, packPath));
  const isFeaturesForModdersEnabled = useAppSelector((state) => state.app.isFeaturesForModdersEnabled);

  const [rows, setRows] = useState<LoadOrderRuleRow[]>([]);
  const [parseErrors, setParseErrors] = useState<LoadOrderRulesFileError[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [packCatalog, setPackCatalog] = useState<ViewerPackCatalogEntry[]>([]);
  const hydratedKeyRef = useRef<string | null>(null);

  const packName = getPackNameFromPath(packPath) ?? packPath;
  const canEdit = isFeaturesForModdersEnabled && !vanillaPackNames.includes(packName);
  const openedFileKey = `${packPath}|${filePath}`;

  const packedFile = useMemo(() => {
    const unsavedMatch = unsavedFiles.find((file) => file.name === filePath);
    if (unsavedMatch) return unsavedMatch;
    return packData?.packedFiles?.[filePath];
  }, [filePath, packData, unsavedFiles]);

  useEffect(() => {
    let isCancelled = false;

    const loadPackCatalog = async () => {
      try {
        const result = await window.api?.getViewerPackCatalog();
        if (isCancelled || !result?.success) return;
        setPackCatalog(result.packs ?? []);
      } catch (catalogError) {
        console.error("Load order rules: could not load the pack catalog:", catalogError);
      }
    };

    void loadPackCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    // Re-hydrating on every keystroke would fight the user, so the editor is filled once per file.
    if (hydratedKeyRef.current === openedFileKey) return;

    const applyText = (text: string) => {
      const parsed = parseLoadOrderRulesRows(text);
      hydratedKeyRef.current = openedFileKey;
      setRows(parsed.rows);
      setParseErrors(parsed.errors);
      setStatus("ready");
    };

    const load = async () => {
      if (packedFile?.text != null) {
        applyText(packedFile.text);
        return;
      }
      if (packedFile?.buffer) {
        applyText(decodePackedTextBuffer(packedFile.buffer));
        return;
      }

      setStatus("loading");
      const result = await window.api?.readFileFromPack(packPath, filePath);
      if (isCancelled) return;

      if (!result?.success) {
        const message = result?.error || localized.viewerFailedToReadFile || "Failed to read file from pack";
        setStatus("error");
        setError(message);
        return;
      }
      applyText(result.text ?? "");
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, [openedFileKey, packedFile, packPath, filePath, localized]);

  const persist = async (nextRows: LoadOrderRuleRow[]) => {
    setRows(nextRows);
    // Editing clears the parse errors: they describe lines that no longer exist once we rewrite.
    setParseErrors([]);

    const result = await window.api?.saveTextPackedFileEdits(packPath, filePath, serializeLoadOrderRuleRows(nextRows));
    if (!result?.success) {
      showDialog(result?.error || localized.viewerFailedToSaveFile || "Failed to save the load order rules.", {
        title: localized.viewerSaveFailed || "Save Failed",
      });
    }
  };

  const updateRow = (index: number, changes: Partial<LoadOrderRuleRow>) => {
    const currentRow = rows[index];
    if (!currentRow) return;

    const nextRow = { ...currentRow, ...changes };
    if (nextRow.relation === currentRow.relation && nextRow.packName === currentRow.packName) return;

    void persist(rows.map((row, rowIndex) => (rowIndex === index ? nextRow : row)));
  };

  const knownPackNames = useMemo(
    () =>
      [
        ...new Set(
          packCatalog.map((pack) => pack.name).filter((name) => name && name.toLowerCase() !== packName.toLowerCase()),
        ),
      ].sort((first, second) => first.localeCompare(second)),
    [packCatalog, packName],
  );
  const knownPackOptions = useMemo<PackNameOption[]>(
    () => knownPackNames.map((name) => ({ value: name, label: name })),
    [knownPackNames],
  );

  if (status === "loading") {
    return <div className="p-4 text-sm text-gray-400">{localized.viewerLoading || "Loading..."}</div>;
  }
  if (status === "error") {
    return <div className="p-4 text-sm text-red-400">{error}</div>;
  }

  return (
    <div className="flex h-full flex-col p-4 text-gray-100">
      <div className="mb-2 shrink-0">
        <div className="text-lg font-semibold text-white">
          {localized.viewerLoadOrderRulesTitle || "Load Order Rules"}
        </div>
        <div className="text-xs text-gray-400">
          {(
            localized.viewerLoadOrderRulesHint ||
            "Each rule is about {{pack}}. BEFORE means this pack appears higher in the visible mod list (with a lower load-order number) than the named pack, so it overrides the named pack when both contain the same file."
          ).replace("{{pack}}", packName)}
        </div>
      </div>

      {parseErrors.length > 0 && (
        <div className="mb-2 shrink-0 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-300">
          {parseErrors.map((parseError) => (
            <div key={`${parseError.line}-${parseError.message}`}>
              {`Line ${parseError.line}: ${parseError.message}`}
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-gray-700">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-800 text-left">
            <tr>
              <th className="w-40 px-3 py-2 font-semibold">
                {localized.viewerLoadOrderRulesRelation || "Before / After"}
              </th>
              <th className="px-3 py-2 font-semibold">{localized.viewerLoadOrderRulesPack || "Pack name"}</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-gray-500">
                  {localized.viewerLoadOrderRulesEmpty ||
                    "No rules yet. Add one to tell WHMM where this pack should load."}
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-gray-800">
                <td className="px-3 py-1.5">
                  <select
                    value={row.relation}
                    disabled={!canEdit}
                    onChange={(event) =>
                      updateRow(index, { relation: event.target.value as LoadOrderRuleRow["relation"] })
                    }
                    className="w-full rounded bg-gray-700 px-2 py-1 text-white disabled:opacity-50"
                  >
                    <option value="BEFORE">BEFORE</option>
                    <option value="AFTER">AFTER</option>
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <Creatable<PackNameOption>
                    inputId={`load-order-rules-pack-name-${index}`}
                    options={knownPackOptions}
                    value={row.packName ? { value: row.packName, label: row.packName } : null}
                    isDisabled={!canEdit}
                    isClearable
                    styles={selectStyle}
                    onChange={(selectedOption) =>
                      updateRow(index, { packName: normalizeLoadOrderPackName(selectedOption?.value ?? "") })
                    }
                    onCreateOption={(inputValue) =>
                      updateRow(index, { packName: normalizeLoadOrderPackName(inputValue) })
                    }
                    onBlur={(event) => {
                      // react-select clears its search input after a selection. The selection/create handlers
                      // already persist those changes; only commit a non-empty free-form value here.
                      if (event.currentTarget.value !== "") {
                        updateRow(index, { packName: normalizeLoadOrderPackName(event.currentTarget.value) });
                      }
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  {canEdit && (
                    <button
                      type="button"
                      title={localized.loadOrderRulesRemove || "Remove this rule"}
                      className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-white"
                      onClick={() => persist(rows.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="mt-2 shrink-0">
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            onClick={() => persist([...rows, { relation: "BEFORE", packName: "" }])}
          >
            {localized.viewerLoadOrderRulesAddRow || "Add rule"}
          </button>
        </div>
      )}
    </div>
  );
});

LoadOrderRulesView.displayName = "LoadOrderRulesView";

export default LoadOrderRulesView;
