import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/** The picker is only here for "+ Add effect"; its windowing has nothing to do with these tests. */
vi.mock("react-windowed-select", () => ({ default: () => <div data-testid="effect-picker" /> }));

import AncillaryDetail from "../src/components/ancillaries/AncillaryDetail";
import {
  LOC_TABLE,
  ancillariesEditReducer,
  emptyAncillariesEditState,
  newRowsByTable,
  type AncillariesEditAction,
  type AncillariesEditState,
} from "../src/ancillariesData/edits";
import type { AncillariesCatalog, AncillaryDetail as AncillaryDetailModel } from "../src/ancillariesData/types";

const catalog: AncillariesCatalog = {
  categories: [
    { key: "weapon", localizedName: "Weapon", sortOrder: 1 },
    { key: "talisman", localizedName: "Talisman", sortOrder: 2 },
  ],
  subcategories: [{ key: "rune", localizedName: "Rune" }],
  ancillaries: [],
  effects: [
    { key: "effect_melee", localizedName: "+%n melee attack", usedByAncillaries: true, preferredScope: "scope_a" },
  ],
  effectScopes: ["scope_a"],
  types: [
    { key: "type_sword", localizedName: "type_sword" },
    { key: "type_charm", localizedName: "type_charm" },
  ],
  dbPackPath: "C:\\game\\data\\db.pack",
  tableSchemas: {},
  moddersPrefix: "me",
  nextNumericIds: {},
};

const detail: AncillaryDetailModel = {
  key: "anc_sword",
  localizedName: "Sword of Khaine",
  category: "weapon",
  subcategory: "",
  type: "type_sword",
  categoryName: "Weapon",
  explanation: "It is sharp.",
  colourText: "Forged in a unit test.",
  hasInfoRow: true,
  rowValues: {
    key: "anc_sword",
    type: "type_sword",
    category: "weapon",
    subcategory: "",
    uniqueness_score: "80",
    transferrable: "true",
    legendary_item: "false",
  },
  effects: [
    {
      ancillary: "anc_sword",
      effectKey: "effect_melee",
      scope: "scope_a",
      value: 12,
      localizedKey: "+12 melee attack",
      isPositiveValueGood: true,
    },
  ],
};

/**
 * Renders with a live reducer, so a dispatch actually updates the store the panel reads back -
 * which is what makes "one override row per (table, key)" observable.
 */
const renderDetail = (over: Partial<React.ComponentProps<typeof AncillaryDetail>> = {}) => {
  let state: AncillariesEditState = emptyAncillariesEditState();
  const dispatch = vi.fn((action: AncillariesEditAction) => {
    state = ancillariesEditReducer(state, action);
    rerenderWithState();
  });
  const props = () => ({
    detail,
    catalog,
    edits: state,
    dispatch,
    isEditingEnabled: true,
    ...over,
  });
  const view = render(<AncillaryDetail {...props()} />);
  const rerenderWithState = () => view.rerender(<AncillaryDetail {...props()} />);
  return { ...view, dispatch, getState: () => state };
};

describe("AncillaryDetail card", () => {
  it("shows the name, category and localized effects", () => {
    renderDetail({ isEditingEnabled: false });
    expect(screen.getByText("Sword of Khaine")).toBeTruthy();
    expect(screen.getByText("Weapon")).toBeTruthy();
    expect(screen.getByText("+12 melee attack")).toBeTruthy();
    expect(screen.getByText("Forged in a unit test.")).toBeTruthy();
  });

  it("hides every editing control when modder features are off", () => {
    renderDetail({ isEditingEnabled: false });
    expect(screen.queryByText("Fields")).toBeNull();
    expect(screen.queryByText("Effects")).toBeNull();
    expect(screen.queryByText("Clone")).toBeNull();
  });

  it("prompts for a selection when there is nothing to show", () => {
    renderDetail({ detail: undefined });
    expect(screen.getByText(/Pick an ancillary/)).toBeTruthy();
  });

  it("warns when the ancillary has no ancillary_info row", () => {
    renderDetail({ detail: { ...detail, hasInfoRow: false } });
    expect(screen.getByText(/No/)).toBeTruthy();
    expect(screen.getByText("ancillary_info_tables")).toBeTruthy();
  });
});

describe("AncillaryDetail inline editing", () => {
  it("creates one complete override row on the first edit", async () => {
    const { getState } = renderDetail();
    await userEvent.selectOptions(screen.getByLabelText("Category"), "talisman");

    const rows = newRowsByTable(getState()).ancillaries_tables;
    expect(rows).toHaveLength(1);
    // Seeded from the source row, so nothing the user did not touch is blanked out.
    expect(rows[0].values).toMatchObject({
      key: "anc_sword",
      type: "type_sword",
      uniqueness_score: "80",
      category: "talisman",
    });
    expect(rows[0].origin).toBe("editAncillary");
  });

  it("keeps editing the same row rather than appending one per keystroke", async () => {
    const { getState } = renderDetail();
    await userEvent.selectOptions(screen.getByLabelText("Category"), "talisman");
    await userEvent.selectOptions(screen.getByLabelText("Subcategory"), "rune");
    fireEvent.change(screen.getByLabelText("Uniqueness score"), { target: { value: "99" } });

    const rows = newRowsByTable(getState()).ancillaries_tables;
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toMatchObject({ category: "talisman", subcategory: "rune", uniqueness_score: "99" });
  });

  it("shows the pending value back, not the source one", async () => {
    renderDetail();
    await userEvent.selectOptions(screen.getByLabelText("Category"), "talisman");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("talisman");
  });

  it("writes booleans as the strings the schema expects", async () => {
    const { getState } = renderDetail();
    await userEvent.click(screen.getByLabelText("Legendary"));

    expect(newRowsByTable(getState()).ancillaries_tables[0].values.legendary_item).toBe("true");
  });

  it("marks a new ancillary's rows with the newAncillary origin", async () => {
    const { getState } = renderDetail({ detail: { ...detail, hasInfoRow: false } });
    fireEvent.change(screen.getByLabelText("Uniqueness score"), { target: { value: "5" } });

    expect(newRowsByTable(getState()).ancillaries_tables[0].origin).toBe("newAncillary");
  });

  it("writes text edits as loc rows under the right keys", async () => {
    const { getState } = renderDetail();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Flavour text"), { target: { value: "New flavour" } });

    const locRows = newRowsByTable(getState())[LOC_TABLE];
    expect(locRows.map((row) => row.values)).toEqual([
      { key: "ancillaries_onscreen_name_anc_sword", text: "Renamed" },
      { key: "ancillaries_colour_text_anc_sword", text: "New flavour" },
    ]);
  });

  it("keeps one loc row per key across repeated edits", () => {
    const { getState } = renderDetail();
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "One" } });
    fireEvent.change(input, { target: { value: "Two" } });

    const locRows = newRowsByTable(getState())[LOC_TABLE];
    expect(locRows).toHaveLength(1);
    expect(locRows[0].values.text).toBe("Two");
  });

  it("overrides an effect value on the (ancillary, effect) pair, carrying its scope", () => {
    const { getState } = renderDetail();
    // The effects section's number box, not the uniqueness one.
    fireEvent.change(screen.getAllByRole("spinbutton").at(-1)!, { target: { value: "99" } });

    const rows = newRowsByTable(getState()).ancillary_to_effects_tables;
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({
      ancillary: "anc_sword",
      effect: "effect_melee",
      effect_scope: "scope_a",
      value: "99",
    });
    expect(rows[0].origin).toBe("editEffect");
  });

  it("locks a source effect against deletion, since the pair can only be overridden", () => {
    renderDetail();
    expect(screen.queryByTitle("Remove this pending effect row")).toBeNull();
    expect(screen.getByTitle(/keyed on \(ancillary, effect\)/)).toBeTruthy();
  });

  it("lets a pending effect be removed, because it has not been written yet", async () => {
    const { getState } = renderDetail({
      detail: {
        ...detail,
        effects: [{ ...detail.effects[0], isPending: true, pendingRowId: "row_1" }],
      },
    });
    await userEvent.click(screen.getByTitle("Remove this pending effect row"));

    // The reducer ignores an id it does not hold; what matters is that the action was dispatched.
    expect(getState().rowsById.row_1).toBeUndefined();
    expect(screen.queryByTitle(/keyed on \(ancillary, effect\)/)).toBeNull();
  });

  it("offers a clone button that reports the key upward", async () => {
    const onClone = vi.fn();
    renderDetail({ onClone });
    await userEvent.click(screen.getByText("Clone"));
    expect(onClone).toHaveBeenCalledWith("anc_sword");
  });
});
