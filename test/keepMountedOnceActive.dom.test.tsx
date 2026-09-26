import React from "react";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useKeepMountedOnceActive } from "../src/components/useKeepMountedOnceActive";

/** Renders a probe so the hook can be driven through tab changes. */
const createProbe = () => {
  const renders: boolean[] = [];
  const Probe: React.FC<{ isActive: boolean }> = ({ isActive }) => {
    const isMounted = useKeepMountedOnceActive(isActive);
    renders.push(isMounted);
    return <div data-testid="state">{String(isMounted)}</div>;
  };
  return { Probe, renders };
};

describe("useKeepMountedOnceActive", () => {
  it("stays out of the tree until the tab is first opened", () => {
    const { Probe } = createProbe();
    const { getByTestId } = render(<Probe isActive={false} />);

    // A tab the user never opens must cost nothing.
    expect(getByTestId("state").textContent).toBe("false");
  });

  it("mounts on the very first render when the tab starts active", () => {
    const { Probe, renders } = createProbe();
    render(<Probe isActive />);

    // No flash of an unmounted editor when the app opens straight onto the tab.
    expect(renders[0]).toBe(true);
  });

  it("keeps the tab mounted after switching away", () => {
    const probe = createProbe();
    const view = render(<probe.Probe isActive={false} />);
    expect(view.getByTestId("state").textContent).toBe("false");

    view.rerender(<probe.Probe isActive />);
    expect(view.getByTestId("state").textContent).toBe("true");

    // The point of the hook: leaving the tab must not discard the editor's work.
    view.rerender(<probe.Probe isActive={false} />);
    expect(view.getByTestId("state").textContent).toBe("true");

    view.rerender(<probe.Probe isActive />);
    expect(view.getByTestId("state").textContent).toBe("true");
  });

  it("settles instead of re-rendering forever", () => {
    const probe = createProbe();
    const view = render(<probe.Probe isActive={false} />);
    view.rerender(<probe.Probe isActive />);
    const rendersAfterOpening = probe.renders.length;

    view.rerender(<probe.Probe isActive={false} />);
    view.rerender(<probe.Probe isActive={false} />);

    // The effect only sets state on the transition, so repeated renders add nothing.
    expect(probe.renders.length).toBeLessThanOrEqual(rendersAfterOpening + 2);
  });
});
