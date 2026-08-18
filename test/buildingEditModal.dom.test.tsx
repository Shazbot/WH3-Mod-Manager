import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BuildingEditModal from "../src/components/buildings/BuildingEditModal";
import type { BuildingsCatalog, BuildingsTile } from "../src/buildingsData/types";

type TestOption = { value: string; label: string };

// A native select keeps this test focused on the dependent options rather than react-select's menu portal.
vi.mock("react-windowed-select", () => ({
  default: ({
    options,
    value,
    onChange,
  }: {
    options: TestOption[];
    value: TestOption | null;
    onChange: (option: TestOption | null) => void;
  }) => (
    <select
      value={value?.value ?? ""}
      onChange={(event) => onChange(options.find((option) => option.value === event.target.value) ?? null)}
    >
      <option value="">Choose...</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const catalog: BuildingsCatalog = {
  campaigns: [],
  regions: [],
  cultures: [],
  subcultures: [],
  factions: [],
  settlementTypes: [],
  units: [
    { key: "unit_a", localizedName: "Unit A" },
    { key: "unit_b", localizedName: "Unit B" },
  ],
  unitGroups: [
    { key: "group_a", localizedName: "Group A" },
    { key: "group_b", localizedName: "Group B" },
    { key: "group_shared", localizedName: "Shared Group" },
  ],
  unitGroupsByUnit: {
    unit_a: ["group_a", "group_shared"],
    unit_b: ["group_b"],
  },
  cultureVariantsByBuilding: {},
  buildingIcons: [],
  effects: [],
  effectScopes: [],
  chainKeys: [],
  dbPackPath: "",
  tableSchemas: {},
  moddersPrefix: "",
  nextNumericIds: {},
};

const tile = {
  levelKey: "building_a",
  chainKey: "chain_a",
  setKey: "set_a",
  title: "Building A",
  garrison: [],
  recruitable: [],
} as BuildingsTile;

describe("BuildingEditModal garrison unit filter", () => {
  it("limits unit groups to the groups containing the selected unit", async () => {
    const user = userEvent.setup();
    render(
      <BuildingEditModal
        tile={tile}
        catalog={catalog}
        numericIdCursors={{}}
        fetchCaiRows={vi.fn()}
        pendingEffects={{}}
        onClose={vi.fn()}
        dispatch={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Garrison" }));

    const unitGroupSelect = screen.getByLabelText("Unit group");
    expect(within(unitGroupSelect).getByRole("option", { name: /Group A/ })).toBeInTheDocument();
    expect(within(unitGroupSelect).getByRole("option", { name: /Group B/ })).toBeInTheDocument();
    expect(within(unitGroupSelect).getByRole("option", { name: /Shared Group/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Unit"), "unit_a");

    expect(within(unitGroupSelect).getByRole("option", { name: /Group A/ })).toBeInTheDocument();
    expect(within(unitGroupSelect).getByRole("option", { name: /Shared Group/ })).toBeInTheDocument();
    expect(within(unitGroupSelect).queryByRole("option", { name: /Group B/ })).toBeNull();
  });
});
