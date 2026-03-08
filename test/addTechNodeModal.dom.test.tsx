import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AddTechNodeModal from "../src/components/techTrees/AddTechNodeModal";

describe("AddTechNodeModal", () => {
  it("submits faction and campaign keys for new nodes", () => {
    const onAdd = vi.fn();

    render(
      <AddTechNodeModal
        tier={1}
        indent={2}
        onAdd={onAdd}
        onClose={() => undefined}
        allTechnologies={[]}
        allTechnologyIcons={[
          {
            path: "ui\\campaign ui\\technologies\\test_icon.png",
            name: "test_icon",
            iconData: "ZmFrZQ==",
          },
        ]}
        allEffects={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Technology Key *"), { target: { value: "wh_test_tech_01" } });
    fireEvent.change(screen.getByLabelText("Display Name *"), { target: { value: "Test Tech" } });
    fireEvent.change(screen.getByLabelText("Campaign Key"), { target: { value: "main_warhammer" } });
    fireEvent.change(screen.getByLabelText("Faction Key"), { target: { value: "wh_main_emp_empire" } });
    fireEvent.click(screen.getByRole("button", { name: "Browse Icons..." }));
    fireEvent.click(screen.getByTitle("test_icon"));

    fireEvent.click(screen.getByRole("button", { name: "Add Node" }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        technologyKey: "wh_test_tech_01",
        displayName: "Test Tech",
        campaignKey: "main_warhammer",
        factionKey: "wh_main_emp_empire",
        iconPath: "ui\\campaign ui\\technologies\\test_icon.png",
        iconData: "ZmFrZQ==",
      }),
    );
  });

  it("prefills and saves faction and campaign keys for edited nodes", () => {
    const onEdit = vi.fn();

    render(
      <AddTechNodeModal
        tier={1}
        indent={2}
        onAdd={() => undefined}
        onClose={() => undefined}
        allTechnologies={[]}
        allTechnologyIcons={[]}
        allEffects={[]}
        existingNode={{
          nodeKey: "node_1",
          technologyKey: "wh_test_tech_01",
          displayName: "Test Tech",
          requiredParents: 0,
          researchPointsRequired: 100,
          campaignKey: "main_warhammer",
          factionKey: "wh_main_emp_empire",
          isHidden: false,
          pixelOffsetX: 0,
          pixelOffsetY: 0,
          iconPath: "ui\\campaign ui\\technologies\\old_icon.png",
          effects: [],
        }}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByLabelText("Campaign Key")).toHaveValue("main_warhammer");
    expect(screen.getByLabelText("Faction Key")).toHaveValue("wh_main_emp_empire");

    fireEvent.change(screen.getByLabelText("Campaign Key"), { target: { value: "wh3_main_chaos" } });
    fireEvent.change(screen.getByLabelText("Faction Key"), { target: { value: "wh_main_chs_chaos" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(onEdit).toHaveBeenCalledWith(
      "node_1",
      expect.objectContaining({
        campaignKey: "wh3_main_chaos",
        factionKey: "wh_main_chs_chaos",
      }),
    );
  });
});
