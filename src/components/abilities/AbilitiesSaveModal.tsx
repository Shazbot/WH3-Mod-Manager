import React, { memo, useEffect, useMemo, useState } from "react";
import { Modal } from "../../flowbite";
import { useAppSelector } from "../../hooks";
import { vanillaPackNames } from "../../supportedGames";
import { getPackNameFromPath } from "../../utility/packFileHelpers";
import type { PackRowsByTable } from "../../utility/packRowsForSave";
import type { DBVersion } from "../../packFileTypes";
import { ABILITIES_LOC_TABLE, abilityNewRowsByTable, type AbilityEditState } from "../../abilitiesData/edits";
import { buildAbilityFileName, buildAbilityPackedFiles } from "../../abilitiesData/save";

type Props = {
  state: AbilityEditState;
  tableSchemas: Record<string, DBVersion>;
  moddersPrefix: string;
  onClose: () => void;
  onSaved: (packPath: string) => void;
};

type Result = { kind: "ok" | "error"; message: string };

const AbilitiesSaveModal = memo(({ state, tableSchemas, moddersPrefix, onClose, onSaved }: Props) => {
  const mods = useAppSelector((s) => s.app.currentPreset.mods);
  const unsavedPacksData = useAppSelector((s) => s.app.unsavedPacksData);
  const targetPacks = useMemo(
    () => mods.filter((mod) => !vanillaPackNames.includes(getPackNameFromPath(mod.path) ?? "")),
    [mods],
  );
  const [target, setTarget] = useState<"existing" | "new">("new");
  const [packPath, setPackPath] = useState(targetPacks[0]?.path ?? "");
  const [skipDuplicateRows, setSkipDuplicateRows] = useState(true);
  const [newPackName, setNewPackName] = useState(() => {
    const prefix = moddersPrefix.trim().replace(/_+$/, "");
    return prefix ? `${prefix}_abilities_edits` : "abilities_edits";
  });
  const [newPackDirectory, setNewPackDirectory] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<Result>();

  useEffect(() => {
    let current = true;
    window.api?.getDataFolder().then((folder) => {
      if (current && folder) setNewPackDirectory((existing) => existing || folder);
    });
    return () => {
      current = false;
    };
  }, []);

  const rowsByTable = useMemo(() => abilityNewRowsByTable(state), [state]);

  const save = async () => {
    setIsSaving(true);
    setResult(undefined);
    try {
      const isNew = target === "new";
      const destination = isNew ? `memory://${newPackName.trim()}` : packPath;
      if (!isNew && !destination) return setResult({ kind: "error", message: "Pick a pack to save into." });
      if (isNew && !newPackName.trim()) return setResult({ kind: "error", message: "Give the new pack a name." });

      let directory = newPackDirectory.trim();
      if (isNew && !directory) directory = (await window.api?.getDataFolder()) ?? "";
      if (isNew && !directory) return setResult({ kind: "error", message: "Pick a folder for the new pack." });

      let existingFileNames: string[] = [];
      let existingRowsByTable: PackRowsByTable | undefined;
      if (!isNew) {
        if (skipDuplicateRows) {
          const inspected = await window.api?.getPackRowsForSave(
            destination,
            Object.keys(rowsByTable).filter((table) => table !== ABILITIES_LOC_TABLE),
            Boolean(rowsByTable[ABILITIES_LOC_TABLE]),
          );
          if (!inspected) return setResult({ kind: "error", message: "Could not inspect the target pack." });
          existingFileNames = inspected.fileNames;
          existingRowsByTable = inspected.rowsByTable;
        } else {
          const names = await window.api?.getPackFilesList(destination);
          if (!names) return setResult({ kind: "error", message: "Could not inspect the target pack." });
          existingFileNames = [...names, ...(unsavedPacksData[destination] ?? []).map((file) => file.name)];
        }
      }

      const { files, skippedTables } = buildAbilityPackedFiles({
        state,
        tableSchemas,
        fileName: buildAbilityFileName(moddersPrefix, existingFileNames),
        existingRowsByTable: skipDuplicateRows ? existingRowsByTable : undefined,
      });
      if (!files.length) return setResult({ kind: "error", message: "Nothing to save." });

      for (const file of files) {
        const staged = await window.api?.saveDBTableEdits(destination, file);
        if (staged && !staged.success) return setResult({ kind: "error", message: staged.error || `Could not stage ${file.name}.` });
      }
      const written = isNew
        ? await window.api?.savePackAsWithUnsavedFiles(destination, newPackName.trim(), directory)
        : await window.api?.savePackWithUnsavedFiles(destination);
      if (!written?.success) return setResult({ kind: "error", message: written?.error || "The pack could not be written." });

      const skipped = skippedTables.length ? ` Skipped (no schema): ${skippedTables.join(", ")}.` : "";
      setResult({ kind: "ok", message: `Wrote ${files.length} table file(s) to ${written.savedPath ?? destination}.${skipped}` });
      await window.api?.invalidateAbilitiesCache?.();
      onSaved(written.savedPath ?? destination);
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} show size="lg" position="center">
      <Modal.Header>Save abilities</Modal.Header>
      <Modal.Body>
        <div className="space-y-4 text-sm text-gray-200">
          <p className="text-xs text-gray-400">
            {state.order.length} pending row(s) across {Object.keys(rowsByTable).length} table(s). Only pending rows are written.
          </p>
          <label className="flex items-center gap-2">
            <input type="radio" checked={target === "existing"} disabled={!targetPacks.length} onChange={() => setTarget("existing")} />
            Existing mod pack
          </label>
          {target === "existing" && (
            <>
              <select value={packPath} onChange={(event) => setPackPath(event.target.value)} className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1">
                {!targetPacks.length && <option value="">No mod packs found</option>}
                {targetPacks.map((mod) => <option key={mod.path} value={mod.path}>{mod.name}</option>)}
              </select>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={skipDuplicateRows} onChange={(event) => setSkipDuplicateRows(event.target.checked)} />
                Don't save rows that already exist identically in the target pack
              </label>
            </>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} /> New pack
          </label>
          {target === "new" && (
            <div className="space-y-2">
              <input value={newPackName} onChange={(event) => setNewPackName(event.target.value)} placeholder="Pack name (without .pack)" className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1" />
              <input value={newPackDirectory} onChange={(event) => setNewPackDirectory(event.target.value)} placeholder="Folder (defaults to the game data folder)" className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1" />
            </div>
          )}
          <div className="max-h-40 overflow-y-auto rounded border border-gray-700 p-2 text-xs text-gray-400">
            {Object.entries(rowsByTable).map(([table, entries]) => <div key={table}>{table}: {entries.length}</div>)}
          </div>
          {result && <p className={result.kind === "ok" ? "text-emerald-400" : "text-red-400"}>{result.message}</p>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button type="button" onClick={onClose} className="rounded bg-gray-600 px-4 py-2 text-sm text-white hover:bg-gray-500">Close</button>
        <button type="button" onClick={save} disabled={isSaving || !state.order.length} className="rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50">
          {isSaving ? "Saving..." : "Save"}
        </button>
      </Modal.Footer>
    </Modal>
  );
});

export default AbilitiesSaveModal;
