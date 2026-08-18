import React, { memo, useEffect, useMemo, useState } from "react";
import { Modal } from "../../flowbite";
import { useAppSelector } from "../../hooks";
import { useLocalizations } from "../../localizationContext";
import { vanillaPackNames } from "../../supportedGames";
import { buildAncillariesFileName, buildPackedFilesFromNewRows } from "../../ancillariesData/save";
import { newRowsByTable, type AncillariesEditState } from "../../ancillariesData/edits";
import { getPackNameFromPath } from "../../utility/packFileHelpers";
import type { DBVersion } from "../../packFileTypes";

export type AncillariesSaveModalProps = {
  state: AncillariesEditState;
  tableSchemas: Record<string, DBVersion>;
  moddersPrefix: string;
  onClose: () => void;
  onSaved: (packPath: string) => void;
};

type Result = { kind: "ok"; message: string } | { kind: "error"; message: string };

const AncillariesSaveModal = memo(
  ({ state, tableSchemas, moddersPrefix, onClose, onSaved }: AncillariesSaveModalProps) => {
    const localized = useLocalizations();
    const mods = useAppSelector((appState) => appState.app.currentPreset.mods);
    const unsavedPacksData = useAppSelector((appState) => appState.app.unsavedPacksData);

    const targetPacks = useMemo(
      () => mods.filter((mod) => !vanillaPackNames.includes(getPackNameFromPath(mod.path) ?? "")),
      [mods],
    );

    const [target, setTarget] = useState<"existing" | "new">(targetPacks.length > 0 ? "existing" : "new");
    const [packPath, setPackPath] = useState(targetPacks[0]?.path ?? "");
    const [newPackName, setNewPackName] = useState(() => {
      // The modder's prefix, the way the written file name uses it, so a new pack sorts with the
      // author's other packs instead of under "ancillaries".
      const prefix = moddersPrefix.trim().replace(/_+$/, "");
      return prefix ? `${prefix}_ancillaries_edits` : "ancillaries_edits";
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
          setResult({ kind: "error", message: localized.ancillariesSavePickPack || "Pick a pack to save into." });
          return;
        }
        if (isNew && !newPackName.trim()) {
          setResult({ kind: "error", message: localized.ancillariesSaveNameNewPack || "Give the new pack a name." });
          return;
        }

        let resolvedNewPackDirectory = newPackDirectory.trim();
        if (isNew && !resolvedNewPackDirectory) {
          resolvedNewPackDirectory = (await window.api?.getDataFolder()) ?? "";
          if (!resolvedNewPackDirectory) {
            setResult({
              kind: "error",
              message: localized.ancillariesSavePickFolder || "Pick a folder for the new pack.",
            });
            return;
          }
        }

        let existingFileNames: string[] = [];
        if (!isNew) {
          // The target can be in the preset without ever having been opened in the renderer. Inspect
          // the pack on disk instead of treating a missing packsData entry as an empty pack, and also
          // include files another editor has staged but not written yet.
          const diskFileNames = await window.api?.getPackFilesList(destination);
          if (!diskFileNames) {
            setResult({
              kind: "error",
              message: localized.ancillariesSaveInspectFailed || "Could not inspect the target pack before saving.",
            });
            return;
          }
          existingFileNames = [...diskFileNames, ...(unsavedPacksData[destination] ?? []).map((file) => file.name)];
        }
        const { files, skippedTables } = buildPackedFilesFromNewRows({
          state,
          tableSchemas,
          fileName: buildAncillariesFileName(moddersPrefix, existingFileNames),
        });
        if (files.length === 0) {
          setResult({ kind: "error", message: localized.ancillariesSaveNothing || "Nothing to save." });
          return;
        }

        for (const file of files) {
          const staged = await window.api?.saveDBTableEdits(destination, file);
          if (staged && !staged.success) {
            setResult({ kind: "error", message: staged.error || `Could not stage ${file.name}.` });
            return;
          }
        }

        const written = isNew
          ? await window.api?.savePackAsWithUnsavedFiles(destination, newPackName.trim(), resolvedNewPackDirectory)
          : await window.api?.savePackWithUnsavedFiles(destination);

        if (!written?.success) {
          setResult({
            kind: "error",
            message: written?.error || localized.ancillariesSaveWriteFailed || "The pack could not be written.",
          });
          return;
        }

        const skipped =
          skippedTables.length > 0
            ? ` ${localized.ancillariesSaveSkipped || "Skipped (no schema):"} ${skippedTables.join(", ")}.`
            : "";
        const warning = written.warning ? ` ${written.warning}` : "";
        setResult({
          kind: "ok",
          message: `${(localized.ancillariesSaveWrote || "Wrote {{count}} table file(s) to {{path}}.")
            .replace("{{count}}", `${files.length}`)
            .replace("{{path}}", `${written.savedPath ?? destination}`)}${warning}${skipped}`,
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
        <Modal.Header>{localized.ancillariesSaveTitle || "Save ancillaries"}</Modal.Header>
        <Modal.Body>
          <div className="space-y-4 text-sm text-gray-200">
            <p className="text-xs text-gray-400">
              {(
                localized.ancillariesSaveSummary ||
                "{{rows}} new row(s) across {{tables}} table(s). Only these rows are written; everything else in the pack is left alone."
              )
                .replace("{{rows}}", `${rowCount}`)
                .replace("{{tables}}", `${Object.keys(rowsByTable).length}`)}
            </p>

            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={target === "existing"}
                disabled={targetPacks.length === 0}
                onChange={() => setTarget("existing")}
              />
              {localized.ancillariesSaveExistingPack || "Existing mod pack"}
            </label>
            {target === "existing" && (
              <select
                value={packPath}
                onChange={(event) => setPackPath(event.target.value)}
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1"
              >
                {targetPacks.length === 0 && (
                  <option value="">{localized.ancillariesSaveNoModPacks || "No mod packs found"}</option>
                )}
                {targetPacks.map((mod) => (
                  <option key={mod.path} value={mod.path}>
                    {mod.name}
                  </option>
                ))}
              </select>
            )}

            <label className="flex items-center gap-2">
              <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />
              {localized.ancillariesSaveNewPack || "New pack"}
            </label>
            {target === "new" && (
              <div className="space-y-2">
                <input
                  value={newPackName}
                  onChange={(event) => setNewPackName(event.target.value)}
                  placeholder={localized.ancillariesSavePackNamePlaceholder || "Pack name (without .pack)"}
                  className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1"
                />
                <input
                  value={newPackDirectory}
                  onChange={(event) => setNewPackDirectory(event.target.value)}
                  placeholder={
                    localized.ancillariesSaveFolderPlaceholder || "Folder (defaults to the game's data folder)"
                  }
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
            {localized.ancillariesClose || "Close"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isSaving || rowCount === 0}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? localized.ancillariesSaving || "Saving..." : localized.ancillariesSave || "Save"}
          </button>
        </Modal.Footer>
      </Modal>
    );
  },
);

export default AncillariesSaveModal;
