import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CompatCollapsibleSection from "../src/components/CompatCollapsibleSection";

describe("CompatCollapsibleSection", () => {
  it("starts collapsed and can be opened", () => {
    render(
      <CompatCollapsibleSection title="example.pack">
        <span>diagnostic result</span>
      </CompatCollapsibleSection>,
    );

    const details = screen.getByText("example.pack").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.queryByText("diagnostic result")).not.toBeVisible();

    fireEvent.click(screen.getByText("example.pack"));

    expect(details.open).toBe(true);
    expect(screen.getByText("diagnostic result")).toBeVisible();
  });
});
