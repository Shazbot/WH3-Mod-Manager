import React from "react";

import { configureStore } from "@reduxjs/toolkit";
import { act, render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { initialState } from "../../src/appSlice";
import NodeEditor from "../../src/components/NodeEditor";

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const packedFlow = (textValue: string) =>
  JSON.stringify({
    version: "1.0",
    timestamp: 1,
    nodes: [
      {
        id: "node_0",
        type: "packedfiles",
        position: { x: 0, y: 0 },
        data: {
          label: "Pack Files",
          type: "packedfiles",
          textValue,
          outputType: "PackFiles",
        },
      },
    ],
    connections: [],
    metadata: { nodeCount: 1, connectionCount: 0 },
    options: [],
    isGraphEnabled: true,
    graphStartsEnabled: true,
  });

const renderEditor = (currentFile: string) =>
  render(
    <Provider
      store={configureStore({
        reducer: { app: appReducer },
        preloadedState: { app: initialState },
      })}
    >
      <NodeEditor currentFile={currentFile} currentPack="K:\\mods\\flows.pack" />
    </Provider>,
  );

describe("packed flow loading", () => {
  const originalApi = window.api;
  const readFileFromPack = vi.fn();
  const getDBNameToDBVersions = vi.fn();
  const getDefaultTableVersions = vi.fn();

  beforeEach(() => {
    readFileFromPack.mockReset();
    getDBNameToDBVersions.mockReset();
    getDefaultTableVersions.mockReset();
    window.api = {
      ...originalApi,
      readFileFromPack,
      getDBNameToDBVersions,
      getDefaultTableVersions,
    } as NonNullable<Window["api"]>;
  });

  afterEach(() => {
    window.api = originalApi;
  });

  it("waits for both schema requests and reads a selected flow only once", async () => {
    const schemas = deferred<Record<string, never[]>>();
    const defaults = deferred<Record<string, number>>();
    getDBNameToDBVersions.mockReturnValue(schemas.promise);
    getDefaultTableVersions.mockReturnValue(defaults.promise);
    readFileFromPack.mockResolvedValue({ success: true, text: packedFlow("loaded once") });

    renderEditor("whmmflows\\one.json");
    expect(readFileFromPack).not.toHaveBeenCalled();

    await act(async () => {
      schemas.resolve({});
      defaults.resolve({});
      await Promise.all([schemas.promise, defaults.promise]);
    });

    await waitFor(() => expect(readFileFromPack).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.querySelector("textarea")).toHaveValue("loaded once"));
  });

  it("does not let an older read replace a newly selected flow", async () => {
    getDBNameToDBVersions.mockResolvedValue({});
    getDefaultTableVersions.mockResolvedValue({});
    const firstRead = deferred<{ success: true; text: string }>();
    const secondRead = deferred<{ success: true; text: string }>();
    readFileFromPack.mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise);

    const editor = renderEditor("whmmflows\\first.json");
    await waitFor(() => expect(readFileFromPack).toHaveBeenCalledOnce());
    editor.rerender(
      <Provider
        store={configureStore({
          reducer: { app: appReducer },
          preloadedState: { app: initialState },
        })}
      >
        <NodeEditor currentFile="whmmflows\\second.json" currentPack="K:\\mods\\flows.pack" />
      </Provider>,
    );
    await waitFor(() => expect(readFileFromPack).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondRead.resolve({ success: true, text: packedFlow("second flow") });
      await secondRead.promise;
    });
    await waitFor(() => expect(document.querySelector("textarea")).toHaveValue("second flow"));

    await act(async () => {
      firstRead.resolve({ success: true, text: packedFlow("stale first flow") });
      await firstRead.promise;
    });
    expect(document.querySelector("textarea")).toHaveValue("second flow");
  });
});
