import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** The tab reads Redux only for the flags below; a fake state keeps the real selectors honest. */
const appState = {
  currentGame: "wh3",
  currentPreset: { mods: [] },
  moddersPrefix: "me",
  isFeaturesForModdersEnabled: false,
};
vi.mock("../src/hooks", () => ({
  useAppSelector: (selector: (state: { app: typeof appState }) => unknown) => selector({ app: appState }),
  useAppDispatch: () => vi.fn(),
}));

// Neither the virtualized list nor the deep-clone dialog has anything to do with the modder gate.
vi.mock("react-virtualized", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 320, height: 600 }),
  List: () => <div />,
}));
vi.mock("../src/components/viewer/DBDuplication", () => ({ default: () => <div /> }));

import AncillariesTab from "../src/components/ancillaries/AncillariesTab";
import type { AncillariesCatalog } from "../src/ancillariesData/types";

const catalog: AncillariesCatalog = {
  categories: [{ key: "weapon", localizedName: "Weapon", sortOrder: 1 }],
  subcategories: [],
  ancillaries: [{ key: "anc_sword", localizedName: "Sword", category: "weapon", subcategory: "", type: "type_sword" }],
  effects: [],
  effectScopes: [],
  types: [],
  icons: [],
  dbPackPath: "C:\\game\\data\\db.pack",
  tableSchemas: {},
  moddersPrefix: "me",
  nextNumericIds: {},
};

const renderTab = (isFeaturesForModdersEnabled: boolean) => {
  appState.isFeaturesForModdersEnabled = isFeaturesForModdersEnabled;
  window.api = { getAncillariesCatalog: vi.fn().mockResolvedValue({ success: true, catalog }) } as never;
  return render(<AncillariesTab />);
};

describe("AncillariesTab modder gate", () => {
  it("offers the row editor and the writing actions to modders", async () => {
    renderTab(true);
    await waitFor(() => expect(screen.getByText("New ancillary")).toBeTruthy());
    expect(screen.getByText("Save to pack")).toBeTruthy();
    expect(screen.getByText("New rows")).toBeTruthy();
  });

  it("is a read-only browser without the option", async () => {
    renderTab(false);
    // The catalog request is the same either way; wait for it before asserting what is missing.
    await waitFor(() => expect(window.api!.getAncillariesCatalog).toHaveBeenCalled());

    expect(screen.queryByText("New ancillary")).toBeNull();
    expect(screen.queryByText("Save to pack")).toBeNull();
    expect(screen.queryByText("New rows")).toBeNull();
    expect(screen.queryByText("Browser")).toBeNull();
  });
});
