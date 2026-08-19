import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AncillariesTablesTab from "../src/components/ancillaries/AncillariesTablesTab";
import {
  ancillariesEditReducer,
  emptyAncillariesEditState,
  type AncillariesEditState,
} from "../src/ancillariesData/edits";
import type { AncillariesRowIssue } from "../src/ancillariesData/validate";
import type { DBField, DBVersion, SCHEMA_FIELD_TYPE } from "../src/packFileTypes";

const field = (name: string, field_type: SCHEMA_FIELD_TYPE, default_value = ""): DBField => ({
  name,
  field_type,
  is_key: name === "key",
  default_value,
  is_filename: false,
  is_reference: [],
  description: "",
  ca_order: 0,
  is_bitwise: 0,
  enum_values: {},
});

const schema: DBVersion = {
  version: 1,
  fields: [field("key", "StringU8"), field("type", "StringU8")],
};

const stateWithRow = (): AncillariesEditState =>
  ancillariesEditReducer(emptyAncillariesEditState(), {
    type: "addRows",
    rows: [{ table: "ancillaries_tables", origin: "manual", values: { key: "anc_a", type: "type_a" } }],
  });

describe("AncillariesTablesTab", () => {
  it("colors a table option yellow when one of its rows has an issue", () => {
    const state = stateWithRow();
    const rowIssues: AncillariesRowIssue[] = [
      {
        rowId: state.order[0],
        table: "ancillaries_tables",
        column: "type",
        kind: "danglingReference",
        message: "No type named type_a.",
      },
    ];

    render(
      <AncillariesTablesTab
        state={state}
        dispatch={vi.fn()}
        onClearAll={vi.fn()}
        tableSchemas={{ ancillaries_tables: schema }}
        rowIssues={rowIssues}
      />,
    );

    expect(within(screen.getByRole("combobox")).getByRole("option", { name: "ancillaries_tables (1)" })).toHaveClass(
      "text-yellow-400",
    );
  });
});
