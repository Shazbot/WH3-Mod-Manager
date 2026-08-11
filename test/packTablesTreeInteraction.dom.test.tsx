import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import PackTablesTreeView from "../src/components/viewer/PackTablesTreeView";
import initialState from "../src/initialAppState";

describe("pack table tree interactions", () => {
  it("expands a group label without selecting it and selects a table label", () => {
    const packPath = "K:\\mods\\example.pack";
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          packsData: {
            [packPath]: {
              packName: "example.pack",
              packPath,
              tables: ["db\\units_tables\\first", "db\\units_tables\\second"],
              packedFiles: {},
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="db"
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    const groupLabel = screen.getByText("units_tables");
    const groupNode = groupLabel.closest("[role='treeitem']");
    expect(groupNode).toHaveAttribute("aria-selected", "false");
    const wasExpanded = groupNode?.getAttribute("aria-expanded");

    fireEvent.click(groupLabel);

    expect(groupNode).toHaveAttribute("aria-selected", "false");
    expect(groupNode?.getAttribute("aria-expanded")).not.toBe(wasExpanded);

    // Ensure the children are visible whichever default expansion state the library started with.
    if (!screen.queryByText("first")) fireEvent.click(groupLabel);
    const tableLabel = screen.getByText("first");
    fireEvent.click(tableLabel);

    expect(tableLabel.closest("[role='treeitem']")).toHaveAttribute("aria-selected", "true");
  });
});
