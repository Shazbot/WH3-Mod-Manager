import React from "react";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDeferredWhileInactive } from "../src/components/useDeferredWhileInactive";

/** Renders a probe so the hook can be driven through tab changes and value changes. */
const createProbe = () => {
  const renders: string[] = [];
  const Probe: React.FC<{ isActive: boolean; value: string }> = ({ isActive, value }) => {
    const deferred = useDeferredWhileInactive(isActive, value);
    renders.push(deferred);
    return <div data-testid="state">{deferred}</div>;
  };
  return { Probe, renders };
};

describe("useDeferredWhileInactive", () => {
  it("passes changes straight through while the tab is active", () => {
    const probe = createProbe();
    const view = render(<probe.Probe isActive value="mods_a" />);
    expect(view.getByTestId("state").textContent).toBe("mods_a");

    view.rerender(<probe.Probe isActive value="mods_b" />);
    expect(view.getByTestId("state").textContent).toBe("mods_b");
  });

  it("holds back changes made while the tab is hidden", () => {
    const probe = createProbe();
    const view = render(<probe.Probe isActive value="mods_a" />);

    view.rerender(<probe.Probe isActive={false} value="mods_a" />);
    // Enabling a mod on another tab must not make the hidden tab rebuild.
    view.rerender(<probe.Probe isActive={false} value="mods_b" />);
    expect(view.getByTestId("state").textContent).toBe("mods_a");

    view.rerender(<probe.Probe isActive={false} value="mods_c" />);
    expect(view.getByTestId("state").textContent).toBe("mods_a");
  });

  it("catches up to the latest value when the tab is shown again", () => {
    const probe = createProbe();
    const view = render(<probe.Probe isActive value="mods_a" />);
    view.rerender(<probe.Probe isActive={false} value="mods_b" />);
    view.rerender(<probe.Probe isActive={false} value="mods_c" />);

    view.rerender(<probe.Probe isActive value="mods_c" />);
    // Several hidden changes collapse into a single rebuild on the way back.
    expect(view.getByTestId("state").textContent).toBe("mods_c");
    expect(probe.renders.filter((rendered) => rendered === "mods_b")).toHaveLength(0);
  });

  it("stays caught up after coming back, so the tab does not rebuild again on the next hide", () => {
    const probe = createProbe();
    const view = render(<probe.Probe isActive value="mods_a" />);
    view.rerender(<probe.Probe isActive={false} value="mods_b" />);
    view.rerender(<probe.Probe isActive value="mods_b" />);

    view.rerender(<probe.Probe isActive={false} value="mods_b" />);
    expect(view.getByTestId("state").textContent).toBe("mods_b");
  });
});
