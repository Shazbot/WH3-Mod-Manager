import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BuildingsTablesTab from "../src/components/buildings/BuildingsTablesTab";
import { buildingsEditReducer, emptyBuildingsEditState, type BuildingsEditState } from "../src/buildingsData/edits";
import type { BuildingsRowIssue } from "../src/buildingsData/validate";
import type { DBField, DBVersion, SCHEMA_FIELD_TYPE } from "../src/packFileTypes";

const field = (name: string, field_type: SCHEMA_FIELD_TYPE, default_value = ""): DBField => ({
  name,
  field_type,
  is_key: name === "level_name",
  default_value,
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const LEVELS_SCHEMA: DBVersion = {
  version: 8,
  fields: [
    field("level_name", "StringU8"),
    field("chain", "StringU8"),
    field("create_cost", "I32", "0"),
    field("visible_in_ui", "Boolean", "true"),
  ],
};

const tableSchemas = { building_levels_tables: LEVELS_SCHEMA };

const stateWithTwoRows = (): BuildingsEditState =>
  buildingsEditReducer(emptyBuildingsEditState(), {
    type: "addRows",
    rows: [
      {
        table: "building_levels_tables",
        origin: "addBuilding",
        values: { level_name: "custom_a_2", chain: "chain_a", create_cost: "500", visible_in_ui: "true" },
      },
      {
        table: "building_levels_tables",
        origin: "addBuilding",
        values: { level_name: "custom_a_3", chain: "chain_a", create_cost: "900", visible_in_ui: "true" },
      },
    ],
  });

const renderTab = (state: BuildingsEditState, rowIssues?: BuildingsRowIssue[]) => {
  const dispatch = vi.fn();
  const onClearAll = vi.fn();
  render(
    <BuildingsTablesTab
      state={state}
      dispatch={dispatch}
      onClearAll={onClearAll}
      tableSchemas={tableSchemas}
      rowIssues={rowIssues}
    />,
  );
  return { dispatch, onClearAll };
};

/** Enters edit mode on a cell, replaces its text and commits, the way a user does. */
const editCell = async (user: ReturnType<typeof userEvent.setup>, currentText: string, nextText: string) => {
  const cell = screen.getByText(currentText);
  await user.dblClick(cell);
  const input = await screen.findByRole("textbox");
  await user.clear(input);
  await user.type(input, `${nextText}{Enter}`);
};

describe("BuildingsTablesTab", () => {
  it("says there is nothing to show before anything has been added", () => {
    renderTab(emptyBuildingsEditState());
    expect(screen.getByText(/No new rows yet/)).toBeInTheDocument();
  });

  it("lists each table with its row count and shows that table's rows", async () => {
    renderTab(stateWithTwoRows());

    const select = screen.getByRole("combobox");
    expect(within(select).getByRole("option", { name: "building_levels_tables (2)" })).toBeInTheDocument();

    expect(await screen.findByText("custom_a_2")).toBeInTheDocument();
    expect(screen.getByText("custom_a_3")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
  });

  it("dispatches setCell for the edited row and column", async () => {
    const user = userEvent.setup();
    const state = stateWithTwoRows();
    const { dispatch } = renderTab(state);

    await screen.findByText("500");
    await editCell(user, "500", "750");

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "setCell",
        id: state.order[0],
        column: "create_cost",
        value: "750",
      }),
    );
  });

  it("refuses a value the field's type cannot hold rather than coercing it", async () => {
    const user = userEvent.setup();
    const { dispatch } = renderTab(stateWithTwoRows());

    await screen.findByText("500");
    await editCell(user, "500", "not a number");

    // The grid put the old value back and the store never heard about the edit.
    await waitFor(() => expect(screen.getByText("500")).toBeInTheDocument());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("adds a blank row filled from the schema's defaults", async () => {
    const user = userEvent.setup();
    const { dispatch } = renderTab(stateWithTwoRows());

    await user.click(screen.getByRole("button", { name: "Add blank row" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "addRows",
      rows: [
        {
          table: "building_levels_tables",
          origin: "manual",
          values: { level_name: "", chain: "", create_cost: "0", visible_in_ui: "true" },
        },
      ],
    });
  });

  it("clears every pending edit through the tab-level action", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderTab(stateWithTwoRows());

    await user.click(screen.getByRole("button", { name: "Clear all pending edits" }));

    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("shows each row's issues and counts them across every table", async () => {
    const state = stateWithTwoRows();
    renderTab(state, [
      {
        rowId: state.order[1],
        table: "building_levels_tables",
        column: "chain",
        kind: "danglingReference",
        message: "No chain named chain_a.",
      },
    ]);

    expect(await screen.findByText("No chain named chain_a.")).toBeInTheDocument();
    expect(screen.getByText("1 issue across all tables")).toBeInTheDocument();
  });

  it("warns rather than silently dropping a table it has no schema for", async () => {
    const state = buildingsEditReducer(emptyBuildingsEditState(), {
      type: "addRows",
      rows: [{ table: "building_mystery_tables", origin: "manual", values: { key: "x" } }],
    });
    renderTab(state);

    expect(await screen.findByText(/No schema for building_mystery_tables/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add blank row" })).toBeDisabled();
  });
});
