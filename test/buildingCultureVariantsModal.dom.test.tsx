import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

type TestOption = { value: string; label: string };

// A native select makes the dependent culture/subculture/faction choices straightforward to test.
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
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import BuildingCultureVariantsModal from "../src/components/buildings/BuildingCultureVariantsModal";
import { emptyBuildingsEditState } from "../src/buildingsData/edits";
import type { BuildingsCatalog, BuildingsTile } from "../src/buildingsData/types";

const catalog: BuildingsCatalog = {
  campaigns: [],
  regions: [],
  cultures: [
    { key: "culture_a", localizedName: "Culture A" },
    { key: "culture_b", localizedName: "Culture B" },
  ],
  subcultures: [
    { key: "sub_a", localizedName: "Subculture A", culture: "culture_a" },
    { key: "sub_b", localizedName: "Subculture B", culture: "culture_b" },
  ],
  factions: [
    {
      key: "faction_a",
      localizedName: "Faction A",
      subculture: "sub_a",
      culture: "culture_a",
      militaryGroup: "",
      isQuestFaction: false,
      isRebel: false,
    },
  ],
  settlementTypes: [],
  units: [],
  unitGroups: [],
  unitGroupsByUnit: {},
  cultureVariantsByBuilding: {
    building_a: [
      {
        building: "building_a",
        culture: "culture_a",
        subculture: "",
        faction: "",
        icon: "old_icon",
        disables: false,
        displayTooltip: true,
        specificity: 1,
        rawValues: {
          building: "building_a",
          culture: "culture_a",
          subculture: "",
          faction: "",
          icon: "old_icon",
          disables: "false",
          display_tooltip: "true",
          description: "existing_description",
        },
      },
    ],
  },
  effects: [],
  effectScopes: [],
  chainKeys: [],
  dbPackPath: "",
  tableSchemas: {},
  moddersPrefix: "",
  nextNumericIds: {},
};

const tile = { levelKey: "building_a", title: "Building A" } as BuildingsTile;

describe("BuildingCultureVariantsModal", () => {
  it("overrides existing rows and adds a selected culture permutation", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(
      <BuildingCultureVariantsModal
        tile={tile}
        catalog={catalog}
        edits={emptyBuildingsEditState()}
        onClose={vi.fn()}
        dispatch={dispatch}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Disable culture_a / (any) / (any)" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "addRows",
      rows: [
        {
          table: "building_culture_variants_tables",
          origin: "manual",
          values: expect.objectContaining({
            building: "building_a",
            culture: "culture_a",
            description: "existing_description",
            disables: "true",
          }),
        },
      ],
    });

    const existingIcon = screen.getByRole("textbox", { name: "Icon for culture_a / (any) / (any)" });
    await user.clear(existingIcon);
    await user.type(existingIcon, "changed_icon");
    await user.tab();
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "addRows",
      rows: [
        {
          table: "building_culture_variants_tables",
          origin: "manual",
          values: expect.objectContaining({ icon: "changed_icon", description: "existing_description" }),
        },
      ],
    });

    await user.selectOptions(screen.getByLabelText("Culture"), "culture_a");
    await user.selectOptions(screen.getByLabelText("Subculture"), "sub_a");
    await user.selectOptions(screen.getByLabelText("Faction"), "faction_a");
    await user.type(screen.getByLabelText("Icon"), "new_icon");
    await user.click(screen.getByRole("button", { name: "Add variant row" }));

    expect(dispatch).toHaveBeenLastCalledWith({
      type: "addRows",
      rows: [
        {
          table: "building_culture_variants_tables",
          origin: "manual",
          values: {
            building: "building_a",
            culture: "culture_a",
            subculture: "sub_a",
            faction: "faction_a",
            icon: "new_icon",
            disables: "false",
            display_tooltip: "true",
          },
        },
      ],
    });
  });
});
