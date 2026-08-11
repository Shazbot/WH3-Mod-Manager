import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import UnitViewerTab from "../src/components/UnitViewerTab";
import { buildUnitViewerData, type UnitViewerTableRows } from "../src/unitViewer/data";

vi.mock("react-virtualized", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 320, height: 600 }),
  List: ({ rowCount, rowRenderer }: { rowCount: number; rowRenderer: (props: { index: number; key: string; style: React.CSSProperties }) => React.ReactNode }) => (
    <div>{Array.from({ length: rowCount }, (_, index) => rowRenderer({ index, key: `${index}`, style: {} }))}</div>
  ),
}));

const tables: UnitViewerTableRows = {
  main_units_tables: [
    { unit: "unit_a", land_unit: "land_a", caste: "hero", num_men: "10", recruitment_cost: "100", multiplayer_cost: "120" },
    { unit: "unit_b", land_unit: "land_b", caste: "lord", num_men: "10", recruitment_cost: "150", multiplayer_cost: "170" },
  ],
  land_units_tables: [
    { key: "land_a", man_entity: "entity", primary_melee_weapon: "weapon", melee_attack: "20", attribute_group: "group_a" },
    { key: "land_b", man_entity: "entity", primary_melee_weapon: "weapon", melee_attack: "30" },
  ],
  battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "50", run_speed: "3", charge_speed: "4" }],
  melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5", melee_attack_interval: "4" }],
  factions_tables: [{ key: "faction", subculture: "culture" }],
  units_custom_battle_permissions_tables: [
    { unit: "unit_a", faction: "faction" },
    { unit: "unit_b", faction: "faction" },
  ],
  land_units_to_unit_abilites_junctions_tables: [{ land_unit: "land_a", ability: "ability_without_special" }],
  unit_abilities_tables: [{ key: "ability_without_special", icon_name: "ability_icon", type: "active", source_type: "unit" }],
  special_ability_to_special_ability_phase_junctions_tables: [
    { special_ability: "ability_without_special", phase: "ability_phase" },
  ],
  special_ability_phases_tables: [{ id: "ability_phase", fatigue_change_ratio: "-0.1" }],
  special_ability_phase_stat_effects_tables: [
    { phase: "ability_phase", stat: "stat_melee_attack", value: "1.25", how: "mult" },
  ],
  unit_abilities_to_additional_ui_effects_juncs_tables: [
    { ability: "ability_without_special", effect: "test_effect" },
  ],
  unit_abilities_additional_ui_effects_tables: [
    { key: "test_effect", sort_order: "1", effect_state: "positive" },
  ],
  unit_attributes_to_groups_junctions_tables: [{ attribute_group: "group_a", attribute: "attribute_a" }],
  ui_unit_stats_tables: [
    { key: "stat_health", icon: "ui/skins/default/icon_stat_health.png" },
    { key: "stat_melee_attack", icon: "ui/skins/default/icon_stat_melee_attack.png" },
  ],
};

const built = buildUnitViewerData(tables, (key) => ({
  land_units_onscreen_name_land_a: "Alpha",
  land_units_onscreen_name_land_b: "Beta",
  cultures_subcultures_name_culture: "Culture",
  unit_abilities_onscreen_name_ability_without_special: "Test Ability",
  unit_abilities_tooltip_text_ability_without_special: "Ability description",
  unit_stat_localisations_onscreen_name_stat_melee_attack: "Melee Attack",
  random_localisation_strings_string_fatigue: "Vigour per second",
  unit_abilities_additional_ui_effects_localised_text_test_effect: "Test active effect",
  unit_attributes_bullet_text_attribute_a: "Test Attribute||Attribute description",
})[key]);

const renderViewer = () => {
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: {
        ...initialState,
        currentGame: "wh3" as const,
        currentPreset: { ...initialState.currentPreset, mods: [] },
      },
    },
  });
  return render(<Provider store={store}><UnitViewerTab /></Provider>);
};

describe("Unit Viewer UI", () => {
  beforeEach(() => {
    window.api = {
      ...window.api,
      getUnitViewerCatalog: vi.fn().mockResolvedValue({
        success: true,
        sessionId: "session",
        groups: built.groups,
        constants: built.constants,
        statIcons: {
          "ui\\skins\\default\\icon_stat_health.png": "health-icon-data",
          "ui\\skins\\default\\icon_stat_melee_attack.png": "melee-attack-icon-data",
        },
      }),
      getUnitViewerDetails: vi.fn().mockImplementation(async (_sessionId: string, unitKey: string) => ({
        success: true,
        unit: built.units.get(unitKey),
        icons: unitKey === "unit_a" ? {
          "ui\\battle ui\\ability_icons\\ability_icon.png": "ability-icon-data",
          "ui\\battle ui\\ability_icons\\attribute_a.png": "attribute-icon-data",
        } : {},
      })),
      getUnitViewerAsset: vi.fn().mockResolvedValue({ success: false }),
    } as NonNullable<Window["api"]>;
  });

  it("selects multiple units without duplicates and exposes the shared comparison controls", async () => {
    renderViewer();
    await screen.findByText("Culture");
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Culture"));
    expect(screen.getByTitle("Lord")).toHaveTextContent("L");
    expect(screen.getByTitle("Hero")).toHaveTextContent("H");
    const rosterButtons = screen.getAllByRole("button").filter((button) => button.title.startsWith("unit_"));
    expect(rosterButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Beta", "Alpha"]);

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    await waitFor(() => expect(window.api?.getUnitViewerDetails).toHaveBeenCalledWith("session", "unit_a"));

    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    const comparison = screen.getByLabelText("Comparison");
    expect(comparison).toHaveValue("first");
    expect(within(comparison).getByRole("option", { name: "Compare to Alpha" })).toBeInTheDocument();
    expect(within(comparison).getByRole("option", { name: "Compare to Beta" })).toBeInTheDocument();
    expect(within(comparison).getByRole("option", { name: "Compare to left position" })).toBeInTheDocument();

    fireEvent.change(comparison, { target: { value: "left" } });
    expect(comparison).toHaveValue("left");

    fireEvent.click(await screen.findByRole("button", { name: "Move Beta left" }));
    const cards = document.querySelectorAll("article");
    expect(within(cards[0] as HTMLElement).getByText("Beta")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText("Alpha")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Unit Size"), { target: { value: "small" } });
    fireEvent.change(screen.getByLabelText("Rank"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Vigour"), { target: { value: "threshold_tired" } });
    expect(screen.getByLabelText("Unit Size")).toHaveValue("small");
    expect(screen.getByLabelText("Rank")).toHaveValue("3");
    expect(screen.getByLabelText("Vigour")).toHaveValue("threshold_tired");

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it("renders attribute icons and unclipped viewport tooltips for abilities without special rows", async () => {
    renderViewer();
    await screen.findByText("Culture");
    fireEvent.click(screen.getByText("Culture"));
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));

    const abilityButton = await screen.findByRole("button", { name: "Test Ability" });
    const attribute = await screen.findByText("Test Attribute");
    const attributeIcon = attribute.parentElement?.querySelector("img");
    expect(attributeIcon).toHaveAttribute("src", "data:image/png;base64,attribute-icon-data");
    const healthIcon = screen.getByText("Health").parentElement?.querySelector("img");
    expect(healthIcon).toHaveAttribute("src", "data:image/png;base64,health-icon-data");

    fireEvent.mouseEnter(abilityButton);
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText("Ability description")).toBeInTheDocument();
    const meleeAttackEffect = within(tooltip).getByText(/Melee Attack: \+25%/);
    expect(meleeAttackEffect).toBeInTheDocument();
    expect(within(tooltip).getByText(/Vigour per second: -10%/)).toBeInTheDocument();
    expect(within(tooltip).getByText(/Test active effect/)).toBeInTheDocument();
    expect(meleeAttackEffect.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,melee-attack-icon-data",
    );
    expect(tooltip).toHaveClass("fixed");
    expect(tooltip.closest("article")).toBeNull();
  });

  it("rebuilds an expired main-process session and retries selected units", async () => {
    const getCatalog = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        sessionId: "expired-session",
        groups: built.groups,
        constants: built.constants,
        statIcons: {},
      })
      .mockResolvedValue({
        success: true,
        sessionId: "replacement-session",
        groups: built.groups,
        constants: built.constants,
        statIcons: {},
      });
    const getDetails = vi.fn().mockImplementation(async (session: string, unitKey: string) =>
      session === "expired-session"
        ? { success: false, error: "Unit Viewer session expired" }
        : { success: true, unit: built.units.get(unitKey), icons: {} },
    );
    window.api!.getUnitViewerCatalog = getCatalog;
    window.api!.getUnitViewerDetails = getDetails;

    renderViewer();
    await screen.findByText("Culture");
    fireEvent.click(screen.getByText("Culture"));
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));

    await waitFor(() => expect(getCatalog).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getDetails).toHaveBeenCalledWith("replacement-session", "unit_a"));
    expect(screen.queryByText("Unit Viewer session expired")).not.toBeInTheDocument();
    expect(await screen.findByText("Test Attribute")).toBeInTheDocument();
  });
});
