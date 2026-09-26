import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InteractiveNodeBoundary } from "../../src/nodeGraph/InteractiveNodeBoundary";

describe("interactive node boundary", () => {
  it("keeps mouse drags on text controls from reaching the node wrapper", () => {
    const nodeDragStart = vi.fn();
    render(
      <div data-testid="node-wrapper">
        <InteractiveNodeBoundary>
          <div data-testid="node-title">Edit Text File</div>
          <input aria-label="rule text" defaultValue="select this text" />
          <textarea aria-label="replacement text" defaultValue="and this text" />
        </InteractiveNodeBoundary>
      </div>,
    );
    screen.getByTestId("node-wrapper").addEventListener("mousedown", nodeDragStart);

    fireEvent.mouseDown(screen.getByLabelText("rule text"));
    fireEvent.mouseDown(screen.getByLabelText("replacement text"));
    expect(nodeDragStart).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("node-title"));
    expect(nodeDragStart).toHaveBeenCalledOnce();
  });

  it("also protects controls mounted after the boundary", () => {
    const nodeDragStart = vi.fn();
    const { rerender } = render(
      <div data-testid="dynamic-node-wrapper">
        <InteractiveNodeBoundary>
          <div>Node title</div>
        </InteractiveNodeBoundary>
      </div>,
    );
    screen.getByTestId("dynamic-node-wrapper").addEventListener("mousedown", nodeDragStart);

    rerender(
      <div data-testid="dynamic-node-wrapper">
        <InteractiveNodeBoundary>
          <input aria-label="dynamic text" defaultValue="dynamic" />
        </InteractiveNodeBoundary>
      </div>,
    );
    fireEvent.mouseDown(screen.getByLabelText("dynamic text"));

    expect(nodeDragStart).not.toHaveBeenCalled();
  });
});
