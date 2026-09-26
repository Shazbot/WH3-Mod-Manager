import { describe, expect, it } from "vitest";

import appReducer, {
  clearMapRegionSelection,
  openMapForRegion,
  selectMapRegion,
  setMapCampaignName,
} from "../src/appSlice";
import initialState from "../src/initialAppState";

describe("map region handoff", () => {
  it("opens the map with the Buildings campaign and region", () => {
    const state = appReducer(
      { ...initialState, currentGame: "wh3" },
      openMapForRegion({ campaign: "wh3_main_chaos", region: "wh3_main_chaos_region_1" }),
    );

    expect(state.currentTab).toBe("map");
    expect(state.mapCampaignName).toBe("wh3_main_chaos");
    expect(state.mapSelectedRegion).toEqual({
      campaign: "wh3_main_chaos",
      region: "wh3_main_chaos_region_1",
    });
  });

  it("publishes a map selection and clears it when the map campaign changes", () => {
    const selected = appReducer(
      initialState,
      selectMapRegion({ campaign: "wh3_main_combi", region: "wh3_main_combi_region_altdorf" }),
    );
    expect(selected.mapSelectedRegion?.region).toBe("wh3_main_combi_region_altdorf");

    const changedCampaign = appReducer(selected, setMapCampaignName("wh3_main_prologue"));
    expect(changedCampaign.mapCampaignName).toBe("wh3_main_prologue");
    expect(changedCampaign.mapSelectedRegion).toBeUndefined();

    const cleared = appReducer(changedCampaign, clearMapRegionSelection());
    expect(cleared.mapSelectedRegion).toBeUndefined();
  });
});
