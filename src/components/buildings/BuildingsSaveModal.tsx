import React, { memo, useEffect, useMemo, useState } from "react";
import { Modal } from "../../flowbite";
import { useAppSelector } from "../../hooks";
import { useLocalizations } from "../../localizationContext";
import { vanillaPackNames } from "../../supportedGames";
import { buildBuildingsFileName, buildPackedFilesFromNewRows } from "../../buildingsData/save";
import { LOC_TABLE, newRowsByTable, type BuildingsEditState } from "../../buildingsData/edits";
import { getPackNameFromPath } from "../../utility/packFileHelpers";
import type { PackRowsByTable } from "../../utility/packRowsForSave";
import type { DBVersion } from "../../packFileTypes";

export type BuildingsSaveModalProps = {
  state: BuildingsEditState;
  tableSchemas: Record<string, DBVersion>;
  moddersPrefix: string;
  onClose: () => void;
  onSaved: (packPath: string) => void;
};

type Result = { kind: "ok"; message: string } | { kind: "error"; message: string };

const BuildingsSaveModal = memo(({ state, tableSchemas, moddersPrefix, onClose, onSaved }: BuildingsSaveModalProps) => {
  const localized = useLocalizations();
  const mods = useAppSelector((appState) => appState.app.currentPreset.mods);
  const unsavedPacksData = useAppSelector((appState) => appState.app.unsavedPacksData);

  const targetPacks = useMemo(
    () => mods.filter((mod) => !vanillaPackNames.includes(getPackNameFromPath(mod.path) ?? "")),
    [mods],
  );

  const [target, setTarget] = useState<"existing" | "new">("new");
  const [skipDuplicateRows, setSkipDuplicateRows] = useState(true);
  const [packPath, setPackPath] = useState(targetPacks[0]?.path ?? "");
  const [newPackName, setNewPackName] = useState(() => {
    // The modder's prefix, the way the written file name uses it, so a new pack sorts with the
    // author's other packs instead of under "buildings".
    const prefix = moddersPrefix.trim().replace(/_+$/, "");
    return prefix ? `${prefix}_buildings_edits` : "buildings_edits";
  });
  const [newPackDirectory, setNewPackDirectory] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<Result | undefined>();

  // Match the Mods Viewer save-as flow: the game data folder is where a newly created pack is
  // useful by default. Do not overwrite a directory the user typed while this request was pending.
  useEffect(() => {
    let isCurrent = true;
    window.api?.getDataFolder().then((dataFolder) => {
      if (isCurrent && dataFolder) setNewPackDirectory((current) => current || dataFolder);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const rowsByTable = useMemo(() => newRowsByTable(state), [state]);
  const rowCount = state.order.length;

  const save = async () => {
    setIsSaving(true);
    setResult(undefined);
    try {
      const isNew = target === "new";
      const destination = isNew ? `memory://${newPackName.trim()}` : packPath;
      if (!isNew && !destination) {
        setResult({ kind: "error", message: localized.buildingsSavePickPack || "Pick a pack to save into." });
        return;
      }
      if (isNew && !newPackName.trim()) {
        setResult({ kind: "error", message: localized.buildingsSaveNameNewPack || "Give the new pack a name." });
        return;
      }

      let resolvedNewPackDirectory = newPackDirectory.trim();
      if (isNew && !resolvedNewPackDirectory) {
        resolvedNewPackDirectory = (await window.api?.getDataFolder()) ?? "";
        if (!resolvedNewPackDirectory) {
          setResult({ kind: "error", message: localized.buildingsSavePickFolder || "Pick a folder for the new pack." });
          return;
        }
      }

      let existingFileNames: string[] = [];
      let existingRowsByTable: PackRowsByTable | undefined;
      if (!isNew) {
        if (skipDuplicateRows) {
          const packData = await window.api?.getPackRowsForSave(
            destination,
            Object.keys(rowsByTable).filter((table) => table !== LOC_TABLE),
            Boolean(rowsByTable[LOC_TABLE]),
          );
          if (!packData) {
            setResult({
              kind: "error",
              message: localized.buildingsSaveInspectFailed || "Could not inspect the target pack before saving.",
            });
            return;
          }
          existingFileNames = packData.fileNames;
          existingRowsByTable = packData.rowsByTable;
        } else {
          // The target can be in the preset without ever having been opened in the renderer. Inspect
          // the pack on disk instead of treating a missing packsData entry as an empty pack, and also
          // include files another editor has staged but not written yet.
          const diskFileNames = await window.api?.getPackFilesList(destination);
          if (!diskFileNames) {
            setResult({
              kind: "error",
              message: localized.buildingsSaveInspectFailed || "Could not inspect the target pack before saving.",
            });
            return;
          }
          existingFileNames = [...diskFileNames, ...(unsavedPacksData[destination] ?? []).map((file) => file.name)];
        }
      }
      const { files, skippedTables } = buildPackedFilesFromNewRows({
        state,
        tableSchemas,
        fileName: buildBuildingsFileName(moddersPrefix, existingFileNames),
        existingRowsByTable: skipDuplicateRows ? existingRowsByTable : undefined,
      });
      if (files.length === 0) {
        setResult({ kind: "error", message: localized.buildingsSaveNothing || "Nothing to save." });
        return;
      }

      for (const file of files) {
        const staged = await window.api?.saveDBTableEdits(destination, file);
        if (staged && !staged.success) {
          setResult({
            kind: "error",
            message:
              staged.error ||
              (localized.buildingsSaveStageFailed || "Could not stage {{file}}.").replace("{{file}}", file.name),
          });
          return;
        }
      }

      const written = isNew
        ? await window.api?.savePackAsWithUnsavedFiles(destination, newPackName.trim(), resolvedNewPackDirectory)
        : await window.api?.savePackWithUnsavedFiles(destination);

      if (!written?.success) {
        setResult({
          kind: "error",
          message: written?.error || localized.buildingsSaveWriteFailed || "The pack could not be written.",
        });
        return;
      }

      const skipped =
        skippedTables.length > 0
          ? ` ${localized.buildingsSaveSkipped || "Skipped (no schema):"} ${skippedTables.join(", ")}.`
          : "";
      const warning = written.warning ? ` ${written.warning}` : "";
      setResult({
        kind: "ok",
        message:
          (localized.buildingsSaveWrote || "Wrote {{count}} table file(s) to {{path}}.")
            .replace("{{count}}", `${files.length}`)
            .replace("file(s)", files.length === 1 ? "file" : "files")
            .replace("{{path}}", `${written.savedPath ?? destination}`) +
          warning +
          skipped,
      });
      onSaved(written.savedPath ?? destination);
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} show size="lg" position="center">
      <Modal.Header>{localized.buildingsSaveTitle || "Save buildings"}</Modal.Header>
      <Modal.Body>
        <div className="space-y-4 text-sm text-gray-200">
          <p className="text-xs text-gray-400">
            {(
              localized.buildingsSaveSummary ||
              "{{rows}} new row(s) across {{tables}} table(s). Only these rows are written; everything else in the pack is left alone."
            )
              .replace("{{rows}}", `${rowCount}`)
              .replace("row(s)", rowCount === 1 ? "row" : "rows")
              .replace("{{tables}}", `${Object.keys(rowsByTable).length}`)
              .replace("table(s)", Object.keys(rowsByTable).length === 1 ? "table" : "tables")}
          </p>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={target === "existing"}
              disabled={targetPacks.length === 0}
              onChange={() => setTarget("existing")}
            />
            {localized.buildingsSaveExistingPack || "Existing mod pack"}
          </label>
          {target === "existing" && (
            <>
              <select
                value={packPath}
                onChange={(event) => setPackPath(event.target.value)}
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1"
              >
                {targetPacks.length === 0 && (
                  <option value="">{localized.buildingsSaveNoModPacks || "No mod packs found"}</option>
                )}
                {targetPacks.map((mod) => (
                  <option key={mod.path} value={mod.path}>
                    {mod.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skipDuplicateRows}
                  onChange={(event) => setSkipDuplicateRows(event.target.checked)}
                />
                {localized.buildingsSaveSkipDuplicates || "Don't save duplicate rows"}
              </label>
            </>
          )}

          <label className="flex items-center gap-2">
            <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />
            {localized.buildingsSaveNewPack || "New pack"}
          </label>
          {target === "new" && (
            <div className="space-y-2">
              <input
                value={newPackName}
                onChange={(event) => setNewPackName(event.target.value)}
                placeholder={localized.buildingsSavePackNamePlaceholder || "Pack name (without .pack)"}
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1"
              />
              <input
                value={newPackDirectory}
                onChange={(event) => setNewPackDirectory(event.target.value)}
                placeholder={localized.buildingsSaveFolderPlaceholder || "Folder (defaults to the game's data folder)"}
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1"
              />
            </div>
          )}

          <div className="max-h-40 overflow-y-auto rounded border border-gray-700 p-2 text-xs text-gray-400">
            {Object.entries(rowsByTable).map(([table, rows]) => (
              <div key={table}>
                {table}: {rows.length}
              </div>
            ))}
          </div>

          {result && (
            <p className={result.kind === "ok" ? "text-xs text-emerald-400" : "text-xs text-red-400"}>
              {result.message}
            </p>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-500"
        >
          {localized.buildingsClose || "Close"}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || rowCount === 0}
          className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? localized.buildingsSaving || "Saving..." : localized.buildingsSave || "Save"}
        </button>
      </Modal.Footer>
    </Modal>
  );
});

export default BuildingsSaveModal;
