import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { useLocalizations } from "../../localizationContext";
import { selectDBTable, setDeepCloneTarget } from "../../appSlice";
import { chunkTableIntoRows } from "../viewer/viewerHelpers";

/** What a right-click asked to clone: a table, the column holding its key, and the key itself. */
export interface BuildingsCloneTarget {
  tableName: string;
  keyColumn: string;
  keyValue: string;
  /** Shown while the table loads, so the dialog's subject is obvious. */
  label: string;
  /** The enabled mod or vanilla pack that actually supplied the effective source row. */
  sourcePackPath?: string;
}

/** The table has to arrive from the main process before its row index can be resolved. */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Opens the existing deep-clone dialog on a building.
 *
 * `DBDuplication` is driven by `currentDBTableSelection` plus a `{row, col}` into the **renderer's**
 * copy of that table (it indexes `rows[row][col]` directly), so a key is not enough - the row index
 * has to be resolved here first. `buildDBReferenceTree` does accept `{row: -1, col: -1}` and match on
 * a key, but taking that path also flips its `isStartingSearchIndirect` branch on, which changes the
 * traversal. Resolving the index in the renderer leaves `src/DBClone.ts` untouched.
 */
export const useBuildingsDeepClone = (dbPackPath: string | undefined) => {
  const dispatch = useAppDispatch();
  const localized = useLocalizations();
  const packsData = useAppSelector((state) => state.app.packsData);
  const deepCloneTarget = useAppSelector((state) => state.app.deepCloneTarget);

  const [pending, setPending] = useState<BuildingsCloneTarget | undefined>();
  const [error, setError] = useState<string | undefined>();
  const timeoutRef = useRef<number | undefined>();

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  const openDeepCloneFor = useCallback(
    (target: BuildingsCloneTarget) => {
      if (!dbPackPath) {
        setError(localized.buildingsDatabasePackNotLoaded || "The game's database pack is not loaded yet.");
        return;
      }
      const sourcePackPath = target.sourcePackPath || dbPackPath;
      setError(undefined);
      setPending(target);
      dispatch(selectDBTable({ packPath: sourcePackPath, dbName: target.tableName, dbSubname: "" }));
      window.api?.getPackData(sourcePackPath, { dbName: target.tableName, dbSubname: "" });

      clearTimer();
      timeoutRef.current = window.setTimeout(() => {
        setPending((current) => {
          if (!current) return current;
          setError(
            (localized.buildingsCloneTimeout || "Timed out reading {{table}} out of the selected source pack.").replace(
              "{{table}}",
              target.tableName,
            ),
          );
          return undefined;
        });
      }, LOAD_TIMEOUT_MS);
    },
    [clearTimer, dbPackPath, dispatch, localized.buildingsCloneTimeout, localized.buildingsDatabasePackNotLoaded],
  );

  const close = useCallback(() => {
    clearTimer();
    setPending(undefined);
    setError(undefined);
    dispatch(setDeepCloneTarget(undefined));
  }, [clearTimer, dispatch]);

  useEffect(() => clearTimer, [clearTimer]);

  // Resolve the row and column once the requested table has actually landed in packsData.
  useEffect(() => {
    if (!pending || !dbPackPath) return;
    const sourcePackPath = pending.sourcePackPath || dbPackPath;
    const packData = packsData[sourcePackPath];
    if (!packData) return;

    // `getLoadedPackViewData` only sends packed files that already carry both, so waiting for them
    // is waiting for the table to arrive rather than for a schema lookup this window cannot do -
    // the main window never subscribes to `setDBNameToDBVersions`.
    const prefix = `db\\${pending.tableName}\\`;
    const packedFile = Object.values(packData.packedFiles).find(
      (candidate) => candidate.name.startsWith(prefix) && candidate.schemaFields && candidate.tableSchema,
    );
    const schema = packedFile?.tableSchema;
    if (!packedFile?.schemaFields || !schema) return;

    const columnIndex = schema.fields.findIndex((field) => field.name === pending.keyColumn);
    if (columnIndex < 0) {
      clearTimer();
      setError(
        (localized.buildingsCloneMissingColumn || "{{table}} has no {{column}} column.")
          .replace("{{table}}", pending.tableName)
          .replace("{{column}}", pending.keyColumn),
      );
      setPending(undefined);
      return;
    }

    const rows = chunkTableIntoRows(packedFile.schemaFields, schema);
    const rowIndex = rows.findIndex((row) => row[columnIndex]?.resolvedKeyValue === pending.keyValue);
    clearTimer();
    if (rowIndex < 0) {
      setError(
        (
          localized.buildingsCloneMissingRow ||
          "{{key}} was not found in the selected {{table}}; it may be a modded row."
        )
          .replace("{{key}}", pending.keyValue)
          .replace("{{table}}", pending.tableName),
      );
      setPending(undefined);
      return;
    }

    setPending(undefined);
    dispatch(setDeepCloneTarget({ row: rowIndex, col: columnIndex }));
  }, [
    clearTimer,
    dbPackPath,
    dispatch,
    localized.buildingsCloneMissingColumn,
    localized.buildingsCloneMissingRow,
    packsData,
    pending,
  ]);

  return {
    openDeepCloneFor,
    close,
    /** True while the table is being fetched, before the dialog can open. */
    isResolving: !!pending,
    resolvingLabel: pending?.label,
    isDialogOpen: !!deepCloneTarget,
    error,
    dismissError: useCallback(() => setError(undefined), []),
  };
};
