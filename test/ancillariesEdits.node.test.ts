import { describe, expect, it } from "vitest";

import { ANCILLARY_TABLES, buildAncillariesData } from "../src/ancillariesData/data";
import {
  LOC_TABLE,
  ancillariesEditReducer,
  ancillaryRenameActions,
  applyNewRowsToAncillariesData,
  emptyAncillariesEditState,
  findKeyCollisions,
  findPendingRow,
  newRowsByTable,
  takeNumericId,
  type AncillariesEditState,
} from "../src/ancillariesData/edits";
import { validateNewRows } from "../src/ancillariesData/validate";
import type { AncillariesTableRows } from "../src/ancillariesData/types";

const noLoc = () => undefined;

const emptyTables = (): AncillariesTableRows =>
  Object.fromEntries(ANCILLARY_TABLES.map((table) => [table, []])) as AncillariesTableRows;

const baseTables = (): AncillariesTableRows => {
  const tables = emptyTables();
  tables.ancillaries_categories_tables = [{ category: "weapon", icon_name: "w", sort_order: "1" }];
  tables.ancillaries_subcategories_tables = [{ subcategory: "rune" }];
  tables.ancillary_types_tables = [{ type: "type_sword", ui_icon: "ui/x.png" }];
  tables.ancillaries_tables = [{ key: "anc_sword", type: "type_sword", category: "weapon", subcategory: "" }];
  tables.ancillary_info_tables = [{ ancillary: "anc_sword" }];
  tables.effects_tables = [{ effect: "effect_melee", icon: "", is_positive_value_good: "true" }];
  tables.ancillary_to_effects_tables = [
    { ancillary: "anc_sword", effect: "effect_melee", effect_scope: "scope_a", value: "12" },
  ];
  return tables;
};

const withRows = (rows: Parameters<typeof ancillariesEditReducer>[1] extends { rows: infer R } ? R : never) =>
  ancillariesEditReducer(emptyAncillariesEditState(), { type: "addRows", rows });

describe("ancillariesEditReducer", () => {
  it("assigns ids and a shared group so one action can be undone as a unit", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_new" } },
      { table: "ancillary_info_tables", origin: "newAncillary", values: { ancillary: "anc_new" } },
    ]);

    expect(state.order).toHaveLength(2);
    const [first, second] = state.order.map((id) => state.rowsById[id]);
    expect(first.groupId).toBe(second.groupId);

    const afterUndo = ancillariesEditReducer(state, { type: "removeGroup", groupId: first.groupId });
    expect(afterUndo.order).toHaveLength(0);
  });

  it("copies the values it is given so a later mutation cannot reach into the store", () => {
    const values = { key: "anc_new" };
    const state = withRows([{ table: "ancillaries_tables", origin: "newAncillary", values }]);
    values.key = "changed";
    expect(state.rowsById[state.order[0]].values.key).toBe("anc_new");
  });

  it("sets a single cell without disturbing the rest of the row", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "editAncillary", values: { key: "anc_sword", category: "weapon" } },
    ]);
    const id = state.order[0];
    const next = ancillariesEditReducer(state, { type: "setCell", id, column: "category", value: "talisman" });

    expect(next.rowsById[id].values).toEqual({ key: "anc_sword", category: "talisman" });
  });

  it("ignores setCell and removeRow for an id it does not have", () => {
    const state = withRows([{ table: "ancillaries_tables", origin: "manual", values: { key: "a" } }]);
    expect(ancillariesEditReducer(state, { type: "setCell", id: "nope", column: "key", value: "x" })).toBe(state);
    expect(ancillariesEditReducer(state, { type: "removeRow", id: "nope" })).toBe(state);
  });

  it("does not renumber ids once rows exist", () => {
    const state = withRows([{ table: "ancillaries_tables", origin: "manual", values: { key: "a" } }]);
    const seeded = ancillariesEditReducer(state, {
      type: "seedNumericIdCursors",
      numericIdCursors: { some_table: 50 },
    });
    expect(seeded).toBe(state);
  });

  it("allocates numeric ids from a cursor map it mutates", () => {
    const cursors: Record<string, number> = { some_table: 7 };
    expect(takeNumericId(cursors, "some_table")).toBe("7");
    expect(takeNumericId(cursors, "some_table")).toBe("8");
    expect(takeNumericId(cursors, "other_table")).toBe("0");
  });

  it("groups new rows by table in insertion order", () => {
    const state = withRows([
      { table: "ancillary_to_effects_tables", origin: "addEffect", values: { ancillary: "a", effect: "e1" } },
      { table: "ancillaries_tables", origin: "manual", values: { key: "a" } },
      { table: "ancillary_to_effects_tables", origin: "addEffect", values: { ancillary: "a", effect: "e2" } },
    ]);
    const byTable = newRowsByTable(state);
    expect(byTable.ancillary_to_effects_tables.map((row) => row.values.effect)).toEqual(["e1", "e2"]);
    expect(byTable.ancillaries_tables).toHaveLength(1);
  });
});

describe("findPendingRow", () => {
  it("finds an override by its composite key so repeat edits stay idempotent", () => {
    const state = withRows([
      {
        table: "ancillary_to_effects_tables",
        origin: "editEffect",
        values: { ancillary: "anc_sword", effect: "effect_melee", value: "1" },
      },
    ]);

    const found = findPendingRow(state, "ancillary_to_effects_tables", {
      ancillary: "anc_sword",
      effect: "effect_melee",
    });
    expect(found?.values.value).toBe("1");
    // A different effect on the same ancillary is a different row.
    expect(
      findPendingRow(state, "ancillary_to_effects_tables", { ancillary: "anc_sword", effect: "other" }),
    ).toBeUndefined();
  });

  it("keys the loc pseudo-table on its key column", () => {
    const state = withRows([
      { table: LOC_TABLE, origin: "editAncillary", values: { key: "ancillaries_onscreen_name_a", text: "A" } },
    ]);
    expect(findPendingRow(state, LOC_TABLE, { key: "ancillaries_onscreen_name_a" })?.values.text).toBe("A");
  });
});

describe("applyNewRowsToAncillariesData", () => {
  const rebuild = (tables: AncillariesTableRows) => buildAncillariesData(tables, noLoc);

  it("appends pending rows so they override by key", () => {
    const state = withRows([
      {
        table: "ancillaries_tables",
        origin: "editAncillary",
        values: { key: "anc_sword", type: "type_sword", category: "weapon", subcategory: "rune" },
      },
    ]);
    const data = applyNewRowsToAncillariesData(baseTables(), state, rebuild);

    expect(data.ancillaries.find((ancillary) => ancillary.key === "anc_sword")?.subcategory).toBe("rune");
  });

  it("replaces an (ancillary, effect) pair rather than appending a second one", () => {
    const state = withRows([
      {
        table: "ancillary_to_effects_tables",
        origin: "editEffect",
        values: { ancillary: "anc_sword", effect: "effect_melee", effect_scope: "scope_a", value: "99" },
      },
    ]);
    const data = applyNewRowsToAncillariesData(baseTables(), state, rebuild);

    const effects = data.effectsByAncillary.anc_sword;
    expect(effects).toHaveLength(1);
    expect(effects[0].value).toBe(99);
  });

  it("adds a new effect alongside the existing one", () => {
    const tables = baseTables();
    tables.effects_tables.push({ effect: "effect_leadership", icon: "", is_positive_value_good: "true" });
    const state = withRows([
      {
        table: "ancillary_to_effects_tables",
        origin: "addEffect",
        values: { ancillary: "anc_sword", effect: "effect_leadership", effect_scope: "scope_a", value: "5" },
      },
    ]);
    const data = applyNewRowsToAncillariesData(tables, state, rebuild);

    expect(data.effectsByAncillary.anc_sword).toHaveLength(2);
  });

  it("leaves loc rows out of the table set; they are not a db table", () => {
    const state = withRows([{ table: LOC_TABLE, origin: "editAncillary", values: { key: "k", text: "t" } }]);
    const tables = baseTables();
    const data = applyNewRowsToAncillariesData(tables, state, (merged) => {
      expect(merged[LOC_TABLE]).toBeUndefined();
      return rebuild(merged);
    });
    expect(data.ancillaries).toHaveLength(1);
  });

  it("does not mutate the base tables it was handed", () => {
    const tables = baseTables();
    const state = withRows([{ table: "ancillaries_tables", origin: "manual", values: { key: "anc_new" } }]);
    applyNewRowsToAncillariesData(tables, state, rebuild);
    expect(tables.ancillaries_tables).toHaveLength(1);
  });
});

describe("findKeyCollisions", () => {
  it("flags a new row whose key the base data already has", () => {
    const state = withRows([{ table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_sword" } }]);
    expect(findKeyCollisions(baseTables(), state)).toEqual([
      { id: state.order[0], table: "ancillaries_tables", key: "anc_sword" },
    ]);
  });

  it("says nothing about a genuinely new key", () => {
    const state = withRows([{ table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_fresh" } }]);
    expect(findKeyCollisions(baseTables(), state)).toEqual([]);
  });
});

describe("validateNewRows", () => {
  const base = () => buildAncillariesData(baseTables(), noLoc);

  it("reports a new ancillary with no ancillary_info row", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_fresh", category: "weapon" } },
    ]);
    const issues = validateNewRows(base(), state);
    expect(issues.some((issue) => issue.kind === "missingInfoRow")).toBe(true);
  });

  it("accepts a new ancillary that brings its own info row", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_fresh", category: "weapon" } },
      { table: "ancillary_info_tables", origin: "newAncillary", values: { ancillary: "anc_fresh" } },
    ]);
    expect(validateNewRows(base(), state).some((issue) => issue.kind === "missingInfoRow")).toBe(false);
  });

  it("reports a category nothing defines", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_fresh", category: "nope" } },
      { table: "ancillary_info_tables", origin: "newAncillary", values: { ancillary: "anc_fresh" } },
    ]);
    const issues = validateNewRows(base(), state);
    expect(issues.some((issue) => issue.kind === "danglingReference" && issue.column === "category")).toBe(true);
  });

  it("stays quiet about an edit to an existing ancillary, which is an override by design", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "editAncillary", values: { key: "anc_sword", category: "weapon" } },
    ]);
    expect(validateNewRows(base(), state).some((issue) => issue.kind === "overridesExisting")).toBe(false);
  });

  it("still warns when a *new* ancillary silently replaces a vanilla one", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_sword", category: "weapon" } },
    ]);
    expect(validateNewRows(base(), state).some((issue) => issue.kind === "overridesExisting")).toBe(true);
  });

  it("never reports an effect override, the only way to change a value", () => {
    const state = withRows([
      {
        table: "ancillary_to_effects_tables",
        origin: "editEffect",
        values: { ancillary: "anc_sword", effect: "effect_melee", effect_scope: "scope_a", value: "99" },
      },
    ]);
    expect(validateNewRows(base(), state).some((issue) => issue.kind === "overridesExisting")).toBe(false);
  });

  it("reports two new rows that share a key, since only the last survives", () => {
    const state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_dup" } },
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "anc_dup" } },
    ]);
    expect(validateNewRows(base(), state).some((issue) => issue.kind === "duplicateKey")).toBe(true);
  });

  it("reports an empty identity key", () => {
    const state: AncillariesEditState = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "" } },
    ]);
    expect(validateNewRows(base(), state).some((issue) => issue.kind === "missingKey")).toBe(true);
  });
});

describe("ancillaryRenameActions", () => {
  /** What "New ancillary" creates, plus an effect added to it afterwards. */
  const newAncillaryState = () => {
    let state = withRows([
      { table: "ancillaries_tables", origin: "newAncillary", values: { key: "me_anc_1", category: "weapon" } },
      { table: "ancillary_info_tables", origin: "newAncillary", values: { ancillary: "me_anc_1" } },
      { table: LOC_TABLE, origin: "newAncillary", values: { key: "ancillaries_onscreen_name_me_anc_1", text: "New" } },
      { table: LOC_TABLE, origin: "newAncillary", values: { key: "ancillaries_colour_text_me_anc_1", text: "" } },
      { table: LOC_TABLE, origin: "newAncillary", values: { key: "ancillaries_explanation_text_me_anc_1", text: "" } },
    ]);
    state = ancillariesEditReducer(state, {
      type: "addRows",
      rows: [
        {
          table: "ancillary_to_effects_tables",
          origin: "addEffect",
          values: { ancillary: "me_anc_1", effect: "effect_melee", value: "5" },
        },
      ],
    });
    return state;
  };

  it("renames every row that carries the key, loc rows included", () => {
    const state = newAncillaryState();
    const renamed = ancillaryRenameActions(state, "me_anc_1", "me_sword").reduce(ancillariesEditReducer, state);
    const byTable = newRowsByTable(renamed);

    expect(byTable.ancillaries_tables[0].values.key).toBe("me_sword");
    expect(byTable.ancillary_info_tables[0].values.ancillary).toBe("me_sword");
    expect(byTable.ancillary_to_effects_tables[0].values.ancillary).toBe("me_sword");
    expect(byTable[LOC_TABLE].map((row) => row.values.key)).toEqual([
      "ancillaries_onscreen_name_me_sword",
      "ancillaries_colour_text_me_sword",
      "ancillaries_explanation_text_me_sword",
    ]);
    // The text the user already typed rides along with its row.
    expect(byTable[LOC_TABLE][0].values.text).toBe("New");
  });

  it("leaves rows belonging to another ancillary alone", () => {
    let state = newAncillaryState();
    state = ancillariesEditReducer(state, {
      type: "addRows",
      rows: [{ table: "ancillaries_tables", origin: "newAncillary", values: { key: "me_anc_2" } }],
    });
    const renamed = ancillaryRenameActions(state, "me_anc_1", "me_sword").reduce(ancillariesEditReducer, state);

    expect(newRowsByTable(renamed).ancillaries_tables.map((row) => row.values.key)).toEqual(["me_sword", "me_anc_2"]);
  });

  it("is a no-op for an unchanged or empty key", () => {
    const state = newAncillaryState();
    expect(ancillaryRenameActions(state, "me_anc_1", "me_anc_1")).toEqual([]);
    expect(ancillaryRenameActions(state, "me_anc_1", "")).toEqual([]);
  });
});
