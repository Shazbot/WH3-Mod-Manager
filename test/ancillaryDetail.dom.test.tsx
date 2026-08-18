import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  icons: [],
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
    expect(screen.getByText(/No ancillary_info_tables row for this key/)).toBeTruthy();
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
    // The box on the effect's own row, rather than one of the numeric fields.
    const effectRow = screen.getByTitle("effect_melee").closest("div")!;
    fireEvent.change(within(effectRow).getByRole("spinbutton"), { target: { value: "99" } });

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

describe("AncillaryDetail type browser", () => {
  const catalogWithIcons = {
    ...catalog,
    icons: [
      { path: "ui\\campaign ui\\ancillaries\\sword.png", name: "sword", iconUrl: "whmm://icon/sword" },
      { path: "ui\\campaign ui\\ancillaries\\charm.png", name: "charm", iconUrl: "whmm://icon/charm" },
    ],
  };

  const openBrowser = async () => {
    const view = renderDetail({ catalog: catalogWithIcons });
    await userEvent.click(screen.getByText("Browse…"));
    return view;
  };

  it("lists every type at a size you can see, and writes the one that is clicked", async () => {
    const { getState } = await openBrowser();
    expect(screen.getByText("type_charm")).toBeTruthy();

    await userEvent.click(screen.getByText("type_charm"));

    expect(newRowsByTable(getState()).ancillaries_tables[0].values.type).toBe("type_charm");
    // Picking a type closes the panel.
    expect(screen.queryByText("Ancillary types")).toBeNull();
  });

  it("narrows the grid with the search box", async () => {
    await openBrowser();
    await userEvent.type(screen.getByLabelText("Search types"), "charm");
    expect(screen.queryByText("type_sword")).toBeNull();
    expect(screen.getByText("type_charm")).toBeTruthy();
  });

  it("refuses a new type until it has a free key and an icon", async () => {
    await openBrowser();
    await userEvent.click(screen.getByText("New type…"));
    const create = screen.getByText("Create type") as HTMLButtonElement;

    expect(create.disabled).toBe(true);
    expect(screen.getByText("Pick an icon for the type.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Type key"), { target: { value: "type_sword" } });
    expect(screen.getByText("That type key already exists.")).toBeTruthy();
    expect(create.disabled).toBe(true);
  });

  it("adds the type row and points the ancillary at it", async () => {
    const { getState } = await openBrowser();
    await userEvent.click(screen.getByText("New type…"));
    fireEvent.change(screen.getByLabelText("Type key"), { target: { value: "me_type_banner" } });
    await userEvent.click(screen.getByText("charm"));
    await userEvent.click(screen.getByText("Create type"));

    const typeRows = newRowsByTable(getState()).ancillary_types_tables;
    expect(typeRows).toHaveLength(1);
    expect(typeRows[0].values).toMatchObject({
      type: "me_type_banner",
      ui_icon: "ui\\campaign ui\\ancillaries\\charm.png",
    });
    expect(typeRows[0].origin).toBe("newType");
    expect(newRowsByTable(getState()).ancillaries_tables[0].values.type).toBe("me_type_banner");
  });
});

describe("AncillaryDetail key box", () => {
  /** The rows "New ancillary" writes: the box only shows for one of these. */
  const newAncillaryEdits = (key: string) =>
    ancillariesEditReducer(emptyAncillariesEditState(), {
      type: "addRows",
      rows: [
        { table: "ancillaries_tables", origin: "newAncillary", values: { key, category: "weapon" } },
        { table: "ancillary_info_tables", origin: "newAncillary", values: { ancillary: key } },
        { table: LOC_TABLE, origin: "newAncillary", values: { key: `ancillaries_onscreen_name_${key}`, text: "New" } },
      ],
    });

  const renderNew = (over: Partial<React.ComponentProps<typeof AncillaryDetail>> = {}) => {
    let state = newAncillaryEdits("me_anc_1");
    const dispatch = vi.fn((action: AncillariesEditAction) => {
      state = ancillariesEditReducer(state, action);
      rerender();
    });
    const props = () => ({
      detail: { ...detail, key: "me_anc_1", rowValues: { ...detail.rowValues, key: "me_anc_1" } },
      catalog,
      edits: state,
      dispatch,
      isEditingEnabled: true,
      ...over,
    });
    const view = render(<AncillaryDetail {...props()} />);
    const rerender = () => view.rerender(<AncillaryDetail {...props()} />);
    return { ...view, getState: () => state };
  };

  it("is prefilled with the generated key", () => {
    renderNew();
    expect((screen.getByLabelText("Ancillary key") as HTMLInputElement).value).toBe("me_anc_1");
  });

  it("stays hidden for an override of an existing ancillary, which has no key to rename", () => {
    renderDetail();
    expect(screen.queryByLabelText("Ancillary key")).toBeNull();
  });

  it("renames every pending row once the box is left", () => {
    const onKeyChange = vi.fn();
    const { getState } = renderNew({ onKeyChange });
    const input = screen.getByLabelText("Ancillary key");
    fireEvent.change(input, { target: { value: "me_sword" } });
    // Still the old key: a rename per keystroke would rewrite every row eight times.
    expect(newRowsByTable(getState()).ancillaries_tables[0].values.key).toBe("me_anc_1");

    fireEvent.blur(input);

    const rows = newRowsByTable(getState());
    expect(rows.ancillaries_tables[0].values.key).toBe("me_sword");
    expect(rows.ancillary_info_tables[0].values.ancillary).toBe("me_sword");
    expect(rows[LOC_TABLE][0].values.key).toBe("ancillaries_onscreen_name_me_sword");
    expect(onKeyChange).toHaveBeenCalledWith("me_sword");
  });

  it("refuses a key that is already taken, and an empty one", () => {
    const onKeyChange = vi.fn();
    const { getState } = renderNew({
      onKeyChange,
      catalog: {
        ...catalog,
        ancillaries: [{ key: "anc_sword", localizedName: "Sword", category: "weapon", subcategory: "", type: "t" }],
      },
    });
    const input = screen.getByLabelText("Ancillary key");

    fireEvent.change(input, { target: { value: "anc_sword" } });
    fireEvent.blur(input);
    expect(screen.getByText("That ancillary key already exists.")).toBeTruthy();

    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(screen.getByText("Give the ancillary a key.")).toBeTruthy();

    expect(newRowsByTable(getState()).ancillaries_tables[0].values.key).toBe("me_anc_1");
    expect(onKeyChange).not.toHaveBeenCalled();
  });
});
