import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BuildingCultureVariantsModal from "../src/components/buildings/BuildingCultureVariantsModal";
import { emptyBuildingsEditState } from "../src/buildingsData/edits";
import type { BuildingsCatalog, BuildingsTile } from "../src/buildingsData/types";

type TestOption = { value: string; label: string };

// A native select makes the dependent culture/subculture/faction choices straightforward to test.
vi.mock("react-windowed-select", () => ({
  default: ({
    options,
    value,
    onChange,
    "aria-label": ariaLabel,
  }: {
    options: TestOption[];
    value: TestOption | null;
    onChange: (option: TestOption | null) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
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
  buildingIcons: [
    {
      name: "building_icon_a",
      path: "ui\\buildings\\icons\\building_icon_a.png",
      iconUrl: "whmm://icon/test/building_icon_a",
    },
    {
      name: "building_icon_b",
      path: "ui\\buildings\\icons\\building_icon_b.png",
      iconUrl: "whmm://icon/test/building_icon_b",
    },
  ],
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

    const existingIcon = screen.getByRole("combobox", { name: "Icon for culture_a / (any) / (any)" });
    await user.selectOptions(existingIcon, "building_icon_b");
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "addRows",
      rows: [
        {
          table: "building_culture_variants_tables",
          origin: "manual",
          values: expect.objectContaining({ icon: "building_icon_b", description: "existing_description" }),
        },
      ],
    });

    await user.selectOptions(screen.getByLabelText("Culture"), "culture_a");
    await user.selectOptions(screen.getByLabelText("Subculture"), "sub_a");
    await user.selectOptions(screen.getByLabelText("Faction"), "faction_a");
    await user.selectOptions(screen.getByRole("combobox", { name: "Icon" }), "building_icon_a");
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
            icon: "building_icon_a",
            disables: "false",
            display_tooltip: "true",
          },
        },
      ],
    });
  });

  it("opens the large browser and applies the selected image", async () => {
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

    await user.click(screen.getAllByRole("button", { name: "Browse icons" })[0]);
    expect(screen.getByText("Browse building icons")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select icon building_icon_b" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addRows",
        rows: [expect.objectContaining({ values: expect.objectContaining({ icon: "building_icon_b" }) })],
      }),
    );
  });
});
