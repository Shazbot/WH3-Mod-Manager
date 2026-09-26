import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BuildingsFilters from "../src/components/buildings/BuildingsFilters";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";
import type { BuildingsCatalog, BuildingsRegionQuery } from "../src/buildingsData/types";

const catalog = {
  campaigns: [{ key: "camp", localizedName: "Campaign" }],
  regions: [{ key: "region", localizedName: "Region", campaigns: ["camp"] }],
  cultures: [
    { key: "kho", localizedName: "Khorne" },
    { key: "emp", localizedName: "Empire" },
  ],
  subcultures: [
    { key: "kho_sub", localizedName: "Khornates", culture: "kho" },
    { key: "emp_sub", localizedName: "Empire folk", culture: "emp" },
  ],
  factions: [],
  settlementTypes: [],
  foreignSlotTypes: [
    {
      key: "CULT",
      localizedName: "CULT",
      slotTemplates: ["tmpl_cult"],
      cultures: ["kho"],
      subcultures: ["kho_sub"],
      factions: [],
    },
  ],
} as unknown as BuildingsCatalog;

const renderFilters = (query: Partial<BuildingsRegionQuery>, culturesWithoutChains: string[] = []) => {
  const onQueryChange = vi.fn();
  const rendered = render(
    <localizationContext.Provider value={enTranslation}>
      <BuildingsFilters
        catalog={catalog}
        query={{ mode: "normal", campaign: "camp", region: "region", ...query }}
        culturesWithoutChains={culturesWithoutChains}
        settlementTypeOptions={[]}
        settlementTypeDisabled={false}
        zoom={1}
        onQueryChange={onQueryChange}
        onZoomChange={vi.fn()}
        onOpenMap={vi.fn()}
      />
    </localizationContext.Provider>,
  );
  return { ...rendered, onQueryChange };
};

/** react-select opens its menu on ArrowDown, and renders every option once it is open. */
const openMenu = (label: string) => {
  const input = screen.getByLabelText(label, { selector: "input" });
  fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  return input;
};

describe("BuildingsFilters board modes", () => {
  it("drops the region, the map button and the settlement type outside a region board", () => {
    for (const mode of ["undercity", "horde"] as const) {
      const { unmount } = renderFilters({ mode, foreignSlotType: mode === "undercity" ? "CULT" : undefined });

      expect(screen.queryByLabelText("Region", { selector: "input" })).toBeNull();
      expect(screen.queryByLabelText("Choose region on map")).toBeNull();
      expect(screen.queryByLabelText("Settlement type", { selector: "input" })).toBeNull();
      // The filters every mode keeps.
      expect(screen.getByLabelText("Campaign", { selector: "input" })).toBeInTheDocument();
      expect(screen.getByLabelText("Culture", { selector: "input" })).toBeInTheDocument();
      unmount();
    }
  });

  it("offers the foreign slot type only on an undercity board", () => {
    const { unmount } = renderFilters({ mode: "undercity", foreignSlotType: "CULT" });
    expect(screen.getByLabelText("Foreign slot type", { selector: "input" })).toBeInTheDocument();
    unmount();

    for (const mode of ["normal", "horde"] as const) {
      const rendered = renderFilters({ mode });
      expect(screen.queryByLabelText("Foreign slot type", { selector: "input" })).toBeNull();
      rendered.unmount();
    }
  });

  it("says a horde's buildings travel with the army", () => {
    renderFilters({ mode: "horde" });

    expect(screen.getByText(/Horde slots come with a military force type/)).toBeInTheDocument();
    expect(screen.queryByText(/not by a region/)).toBeNull();
  });

  it("switches into a mode with the filters it does not draw cleared", () => {
    const { onQueryChange } = renderFilters({ settlementType: "capital" });

    openMenu("Mode");
    fireEvent.click(screen.getByText("Horde"));

    expect(onQueryChange).toHaveBeenCalledWith({
      mode: "horde",
      foreignSlotType: undefined,
      settlementType: undefined,
    });
  });
});

describe("BuildingsFilters foreign slot types", () => {
  it("says the buildings are not tied to a region", () => {
    renderFilters({ mode: "undercity", foreignSlotType: "CULT" });

    expect(screen.getByText(/CULT slots are granted by a slot set, not by a region/)).toBeInTheDocument();
  });

  it("offers only the cultures and subcultures the type's buildings name", () => {
    renderFilters({ mode: "undercity", foreignSlotType: "CULT" });

    openMenu("Culture");
    expect(screen.getByText("Khorne")).toBeInTheDocument();
    expect(screen.queryByText("Empire")).toBeNull();

    openMenu("Subculture");
    expect(screen.getByText("Khornates")).toBeInTheDocument();
    expect(screen.queryByText("Empire folk")).toBeNull();
  });

  it("keeps every culture on a region board", () => {
    renderFilters({});

    expect(screen.queryByText(/not by a region/)).toBeNull();
    expect(screen.getByLabelText("Region", { selector: "input" })).not.toBeDisabled();
    openMenu("Culture");
    expect(screen.getByText("Khorne")).toBeInTheDocument();
    expect(screen.getByText("Empire")).toBeInTheDocument();
  });

  it("drops filters the newly selected type never mentions", () => {
    const { onQueryChange } = renderFilters({ mode: "undercity", culture: "emp", subculture: "emp_sub" });

    openMenu("Foreign slot type");
    fireEvent.click(screen.getByText("CULT"));

    expect(onQueryChange).toHaveBeenCalledWith({
      foreignSlotType: "CULT",
      settlementType: undefined,
      culture: undefined,
      subculture: undefined,
      faction: undefined,
    });
  });
});

describe("BuildingsFilters cultures with no chains", () => {
  /** react-select renders menu options in order, so the rendered names are the order. */
  const cultureNamesInMenu = () => {
    openMenu("Culture");
    return screen
      .getAllByText(/^(Khorne|Empire)$/)
      .map((element) => element.textContent)
      .filter((text): text is string => !!text);
  };

  it("leaves the order alone when every culture has chains", () => {
    renderFilters({ mode: "horde" });
    expect(cultureNamesInMenu()).toEqual(["Empire", "Khorne"]);
  });

  it("sorts a culture the board draws nothing for below the ones it does", () => {
    renderFilters({ mode: "horde" }, ["emp"]);
    expect(cultureNamesInMenu()).toEqual(["Khorne", "Empire"]);
  });

  it("marks it in yellow, in the menu and in the closed control", () => {
    renderFilters({ mode: "horde", culture: "emp" }, ["emp"]);

    openMenu("Culture");
    const menuEntry = screen.getAllByText("Empire").find((element) => element.className.includes("truncate"));
    expect(menuEntry?.className).toContain("text-yellow-300");
    expect(screen.getByText("Khorne").className).not.toContain("text-yellow-300");

    // The control draws the `Name — key` label rather than the two-line menu row.
    expect(screen.getByText("Empire — emp").className).toContain("text-yellow-300");
  });
});
