import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-virtualized", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 320, height: 600 }),
  List: ({
    rowCount,
    rowRenderer,
  }: {
    rowCount: number;
    rowRenderer: (props: { index: number; key: string; style: React.CSSProperties }) => React.ReactNode;
  }) => <div>{Array.from({ length: rowCount }, (_, index) => rowRenderer({ index, key: `${index}`, style: {} }))}</div>,
}));

import AncillariesBrowser from "../src/components/ancillaries/AncillariesBrowser";
import { createAncillaryFilter, matchesModFilter } from "../src/ancillariesData/filter";
import type { AncillariesCatalog, AncillarySummary } from "../src/ancillariesData/types";

const MOD_PACK = "C:\\mods\\extra_items.pack";

const ancillary = (over: Partial<AncillarySummary> & { key: string }): AncillarySummary => ({
  localizedName: over.key,
  category: "weapon",
  subcategory: "",
  type: "type_sword",
  ...over,
});

const catalog: AncillariesCatalog = {
  categories: [
    { key: "weapon", localizedName: "Weapon", sortOrder: 1 },
    { key: "talisman", localizedName: "Talisman", sortOrder: 2 },
  ],
  subcategories: [{ key: "rune", localizedName: "Rune" }],
  ancillaries: [
    ancillary({ key: "anc_sword", localizedName: "Sword of Khaine" }),
    ancillary({ key: "anc_blade", localizedName: "Blade of Realities" }),
    ancillary({ key: "anc_charm", localizedName: "Armour of Destiny", category: "talisman", subcategory: "rune" }),
    ancillary({ key: "anc_modded", localizedName: "Modded Trinket", originPackPath: MOD_PACK }),
  ],
  effects: [],
  effectScopes: [],
  types: [],
  icons: [],
  dbPackPath: "C:\\game\\data\\db.pack",
  tableSchemas: {},
  moddersPrefix: "me",
  nextNumericIds: {},
};

/** Weapon here holds two subcategories, so the subcategory rows survive. */
const mixedSubcategoryCatalog: AncillariesCatalog = {
  ...catalog,
  ancillaries: [
    ...catalog.ancillaries,
    ancillary({ key: "anc_runeblade", localizedName: "Runeblade", subcategory: "rune" }),
  ],
};

const mods = [{ path: MOD_PACK, label: "Extra Items" }];

const renderBrowser = (props: Partial<React.ComponentProps<typeof AncillariesBrowser>> = {}) =>
  render(<AncillariesBrowser catalog={catalog} onSelect={vi.fn()} mods={mods} {...props} />);

/** The list renders every row, so an ancillary is visible only when its category is expanded. */
const visibleAncillaryNames = () =>
  catalog.ancillaries.filter((row) => screen.queryByText(row.localizedName)).map((row) => row.localizedName);

describe("createAncillaryFilter", () => {
  it("matches on name, key, category and subcategory", () => {
    expect(createAncillaryFilter("khaine").matches(catalog.ancillaries[0])).toBe(true);
    expect(createAncillaryFilter("anc_sword").matches(catalog.ancillaries[0])).toBe(true);
    expect(createAncillaryFilter("talisman").matches(catalog.ancillaries[2])).toBe(true);
    expect(createAncillaryFilter("rune").matches(catalog.ancillaries[2])).toBe(true);
  });

  it("treats the pattern as a regex", () => {
    const filter = createAncillaryFilter("^Blade|^Sword");
    expect(filter.isValidRegex).toBe(true);
    expect(filter.matches(catalog.ancillaries[0])).toBe(true);
    expect(filter.matches(catalog.ancillaries[1])).toBe(true);
    expect(filter.matches(catalog.ancillaries[2])).toBe(false);
  });

  it("is case insensitive", () => {
    expect(createAncillaryFilter("SWORD OF KHAINE").matches(catalog.ancillaries[0])).toBe(true);
  });

  it("falls back to a substring match when the pattern does not compile", () => {
    // Every prefix of a real pattern gets typed at some point; "[" must not empty the list.
    const filter = createAncillaryFilter("[");
    expect(filter.isValidRegex).toBe(false);
    expect(filter.matches(ancillary({ key: "a", localizedName: "Item [Special]" }))).toBe(true);
    expect(filter.matches(catalog.ancillaries[0])).toBe(false);
  });

  it("reports an empty box so callers can skip filtering", () => {
    expect(createAncillaryFilter("   ").isEmpty).toBe(true);
    expect(createAncillaryFilter("a").isEmpty).toBe(false);
  });
});

describe("matchesModFilter", () => {
  it("passes everything on 'all'", () => {
    expect(catalog.ancillaries.every((row) => matchesModFilter(row, "all"))).toBe(true);
  });

  it("keeps only rows with no origin pack on 'vanilla'", () => {
    expect(matchesModFilter(catalog.ancillaries[0], "vanilla")).toBe(true);
    expect(matchesModFilter(catalog.ancillaries[3], "vanilla")).toBe(false);
  });

  it("keeps only that mod's rows when a pack path is selected", () => {
    expect(matchesModFilter(catalog.ancillaries[3], MOD_PACK)).toBe(true);
    expect(matchesModFilter(catalog.ancillaries[0], MOD_PACK)).toBe(false);
  });
});

describe("AncillariesBrowser", () => {
  it("starts with the categories collapsed", () => {
    renderBrowser();
    expect(screen.getByText("Weapon")).toBeTruthy();
    expect(screen.getByText("Talisman")).toBeTruthy();
    expect(visibleAncillaryNames()).toEqual([]);
  });

  it("expands a category when it is clicked", async () => {
    renderBrowser();
    await userEvent.click(screen.getByText("Weapon"));
    expect(visibleAncillaryNames()).toContain("Sword of Khaine");
    expect(visibleAncillaryNames()).not.toContain("Armour of Destiny");
  });

  it("expands everything while a filter is active, so matches are never hidden", async () => {
    renderBrowser();
    await userEvent.type(screen.getByLabelText("Filter ancillaries"), "Destiny");
    // Talisman was collapsed, but its match still shows.
    expect(visibleAncillaryNames()).toEqual(["Armour of Destiny"]);
  });

  it("narrows the list with a regex", async () => {
    renderBrowser();
    await userEvent.type(screen.getByLabelText("Filter ancillaries"), "^Blade");
    expect(visibleAncillaryNames()).toEqual(["Blade of Realities"]);
  });

  // `userEvent.type` reads "[" and "{" as key descriptors, so these drive the input directly.
  it("falls back to substring and says so when the regex is incomplete", () => {
    renderBrowser();
    fireEvent.change(screen.getByLabelText("Filter ancillaries"), { target: { value: "[" } });

    expect(screen.getByText(/Incomplete regex/)).toBeTruthy();
    // Not a crash: it matched as plain text, and nothing here contains a literal "[".
    expect(screen.getByText("No ancillaries match this filter.")).toBeTruthy();
  });

  it("recovers once the pattern compiles again", () => {
    renderBrowser();
    const input = screen.getByLabelText("Filter ancillaries");
    fireEvent.change(input, { target: { value: "[" } });
    fireEvent.change(input, { target: { value: "^(Blade|Sword)" } });

    expect(screen.queryByText(/Incomplete regex/)).toBeNull();
    expect(visibleAncillaryNames().sort()).toEqual(["Blade of Realities", "Sword of Khaine"]);
  });

  it("offers a mod option only for mods that contribute an ancillary", () => {
    renderBrowser({ mods: [...mods, { path: "C:\\mods\\unrelated.pack", label: "Unrelated" }] });
    const select = screen.getByLabelText("Filter by mod");
    expect(within(select).queryByText("Extra Items")).toBeTruthy();
    expect(within(select).queryByText("Unrelated")).toBeNull();
  });

  it("filters to one mod's ancillaries", async () => {
    renderBrowser();
    await userEvent.selectOptions(screen.getByLabelText("Filter by mod"), MOD_PACK);
    await userEvent.click(screen.getByText("Weapon"));

    expect(visibleAncillaryNames()).toEqual(["Modded Trinket"]);
  });

  it("filters to vanilla only", async () => {
    renderBrowser();
    await userEvent.selectOptions(screen.getByLabelText("Filter by mod"), "vanilla");
    await userEvent.click(screen.getByText("Weapon"));

    const visible = visibleAncillaryNames();
    expect(visible).toContain("Sword of Khaine");
    expect(visible).not.toContain("Modded Trinket");
  });

  it("files an empty subcategory under its own bucket", async () => {
    renderBrowser({ catalog: mixedSubcategoryCatalog });
    await userEvent.click(screen.getByText("Weapon"));

    expect(screen.getByText("(no subcategory)")).toBeTruthy();
    expect(screen.getByText("Rune")).toBeTruthy();
  });

  it("skips the subcategory row when a category has only one", async () => {
    renderBrowser();
    await userEvent.click(screen.getByText("Talisman"));
    expect(screen.queryByText("Rune")).toBeNull();
    expect(visibleAncillaryNames()).toEqual(["Armour of Destiny"]);

    await userEvent.click(screen.getByText("Weapon"));
    expect(screen.queryByText("(no subcategory)")).toBeNull();
    expect(visibleAncillaryNames()).toContain("Sword of Khaine");
  });

  it("reports the selection to its parent", async () => {
    const onSelect = vi.fn();
    renderBrowser({ onSelect });
    await userEvent.click(screen.getByText("Weapon"));
    await userEvent.click(screen.getByText("Sword of Khaine"));

    expect(onSelect).toHaveBeenCalledWith("anc_sword");
  });

  it("marks a modded ancillary so it is obvious where it came from", async () => {
    renderBrowser();
    await userEvent.click(screen.getByText("Weapon"));
    expect(screen.getAllByText("mod")).toHaveLength(1);
  });

  it("shows the error only when there is no catalog to fall back on", () => {
    renderBrowser({ catalog: undefined, error: "boom" });
    expect(screen.getByText("boom")).toBeTruthy();
  });
});
