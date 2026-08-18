import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BuildingsTab from "../src/components/buildings/BuildingsTab";
import type { BuildingsCatalog } from "../src/buildingsData/types";

const appState = {
  currentGame: "wh3",
  currentPreset: { mods: [] },
  mapSelectedRegion: undefined,
  moddersPrefix: "me",
  isFeaturesForModdersEnabled: false,
  packsData: {},
  deepCloneTarget: undefined,
};

vi.mock("../src/hooks", () => ({
  useAppSelector: (selector: (state: { app: typeof appState }) => unknown) => selector({ app: appState }),
  useAppDispatch: () => vi.fn(),
}));

vi.mock("../src/components/buildings/BuildingsFilters", () => ({ default: () => <div /> }));

const catalog: BuildingsCatalog = {
  campaigns: [],
  regions: [],
  cultures: [],
  subcultures: [],
  factions: [],
  settlementTypes: [],
  units: [],
  unitGroups: [],
  unitGroupsByUnit: {},
  cultureVariantsByBuilding: {},
  buildingIcons: [],
  effects: [],
  effectScopes: [],
  chainKeys: [],
  dbPackPath: "",
  tableSchemas: {},
  moddersPrefix: "me",
  nextNumericIds: {},
};

const renderTab = (isFeaturesForModdersEnabled: boolean) => {
  appState.isFeaturesForModdersEnabled = isFeaturesForModdersEnabled;
  window.api = {
    getBuildingsCatalog: vi.fn().mockResolvedValue({ success: true, catalog }),
  } as never;
  return render(<BuildingsTab />);
};

describe("BuildingsTab modder gate", () => {
  it("shows the editing sub-tab when modder features are enabled", async () => {
    renderTab(true);
    await waitFor(() => expect(screen.getByText("New rows")).toBeInTheDocument());
  });

  it("keeps the Buildings tab read-only without the option", async () => {
    renderTab(false);
    await waitFor(() => expect(window.api!.getBuildingsCatalog).toHaveBeenCalled());

    expect(screen.queryByText("New rows")).not.toBeInTheDocument();
    expect(screen.queryByText("Save to pack")).not.toBeInTheDocument();
  });
});
