import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Drawer from "../src/components/Drawer";

describe("Drawer", () => {
  it("closes when Escape is pressed while open", () => {
    const setIsOpen = vi.fn();

    render(
      <Drawer isOpen setIsOpen={setIsOpen}>
        <div>Drawer content</div>
      </Drawer>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});
