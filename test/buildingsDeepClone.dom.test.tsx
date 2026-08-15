import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { setPacksData } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { useBuildingsDeepClone } from "../src/components/buildings/useBuildingsDeepClone";

const DB_PACK = "C:\\data\\db.pack";
const TABLE = "building_culture_variants_tables";

/** Four columns, so `chunkTableIntoRows` slices the flat array into rows of four. */
const schema = {
  version: 5,
  fields: [{ name: "building" }, { name: "culture" }, { name: "subculture" }, { name: "faction" }],
};

/** Three rows; the one we want is second, so a row index of 0 would be a false pass. */
const rowValues = [
  ["wh_main_emp_barracks_1", "wh_main_emp_empire", "", ""],
  ["wh_main_emp_forges_1", "wh_main_emp_empire", "", ""],
  ["wh_main_emp_forges_2", "wh_main_emp_empire", "", ""],
];

const packedFile = {
  name: `db\\${TABLE}\\data__`,
  file_size: 0,
  start_pos: 0,
  tableSchema: schema,
  schemaFields: rowValues
    .flat()
    .map((value) => ({ type: "StringU8", fields: [{ type: "String", val: value }], resolvedKeyValue: value })),
};

const makeStore = () =>
  configureStore({
    reducer: { app: appReducer },
    preloadedState: { app: { ...initialState, currentGame: "wh3" as const } },
    // The fixtures carry buffers/plain objects the default checks would walk on every dispatch.
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
  });

const renderDeepClone = (store: ReturnType<typeof makeStore>) =>
  renderHook(() => useBuildingsDeepClone(DB_PACK), {
    wrapper: ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>,
  });

describe("useBuildingsDeepClone", () => {
  beforeEach(() => {
    (window as unknown as { api?: unknown }).api = { getPackData: vi.fn() };
  });

  it("asks the main process for the table it needs", () => {
    const store = makeStore();
    const { result } = renderDeepClone(store);

    act(() => {
      result.current.openDeepCloneFor({
        tableName: TABLE,
        keyColumn: "building",
        keyValue: "wh_main_emp_forges_1",
        label: "Forge",
      });
    });

    expect(window.api?.getPackData).toHaveBeenCalledWith(DB_PACK, { dbName: TABLE, dbSubname: "" });
    expect(store.getState().app.currentDBTableSelection).toMatchObject({ packPath: DB_PACK, dbName: TABLE });
    expect(result.current.isResolving).toBe(true);
    expect(store.getState().app.deepCloneTarget).toBeUndefined();
  });

  it("resolves the row and column once the table arrives", async () => {
    const store = makeStore();
    const { result } = renderDeepClone(store);

    act(() => {
      result.current.openDeepCloneFor({
        tableName: TABLE,
        keyColumn: "building",
        keyValue: "wh_main_emp_forges_1",
        label: "Forge",
      });
    });

    act(() => {
      store.dispatch(
        setPacksData([
          { packName: "db.pack", packPath: DB_PACK, tables: [TABLE], packedFiles: { [packedFile.name]: packedFile } },
        ] as never),
      );
    });

    // Second row, first column - the dialog indexes rows[row][col] in the renderer's own copy.
    await waitFor(() => expect(store.getState().app.deepCloneTarget).toEqual({ row: 1, col: 0 }));
    expect(result.current.isResolving).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("reports a key that is not in the vanilla table rather than opening on the wrong row", async () => {
    const store = makeStore();
    const { result } = renderDeepClone(store);

    act(() => {
      result.current.openDeepCloneFor({
        tableName: TABLE,
        keyColumn: "building",
        keyValue: "some_modded_building",
        label: "Modded",
      });
    });
    act(() => {
      store.dispatch(
        setPacksData([
          { packName: "db.pack", packPath: DB_PACK, tables: [TABLE], packedFiles: { [packedFile.name]: packedFile } },
        ] as never),
      );
    });

    await waitFor(() => expect(result.current.error).toContain("some_modded_building"));
    expect(store.getState().app.deepCloneTarget).toBeUndefined();
  });

  it("reports a column the table does not have", async () => {
    const store = makeStore();
    const { result } = renderDeepClone(store);

    act(() => {
      result.current.openDeepCloneFor({
        tableName: TABLE,
        keyColumn: "not_a_column",
        keyValue: "wh_main_emp_forges_1",
        label: "Forge",
      });
    });
    act(() => {
      store.dispatch(
        setPacksData([
          { packName: "db.pack", packPath: DB_PACK, tables: [TABLE], packedFiles: { [packedFile.name]: packedFile } },
        ] as never),
      );
    });

    await waitFor(() => expect(result.current.error).toContain("not_a_column"));
    expect(store.getState().app.deepCloneTarget).toBeUndefined();
  });

  it("does nothing without a db pack path", () => {
    const store = makeStore();
    const { result } = renderHook(() => useBuildingsDeepClone(undefined), {
      wrapper: ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>,
    });

    act(() => {
      result.current.openDeepCloneFor({ tableName: TABLE, keyColumn: "building", keyValue: "x", label: "x" });
    });

    expect(window.api?.getPackData).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it("clears the target when closed", async () => {
    const store = makeStore();
    const { result } = renderDeepClone(store);

    act(() => {
      result.current.openDeepCloneFor({
        tableName: TABLE,
        keyColumn: "building",
        keyValue: "wh_main_emp_forges_2",
        label: "Forge",
      });
    });
    act(() => {
      store.dispatch(
        setPacksData([
          { packName: "db.pack", packPath: DB_PACK, tables: [TABLE], packedFiles: { [packedFile.name]: packedFile } },
        ] as never),
      );
    });
    await waitFor(() => expect(store.getState().app.deepCloneTarget).toEqual({ row: 2, col: 0 }));

    act(() => result.current.close());
    expect(store.getState().app.deepCloneTarget).toBeUndefined();
  });
});
