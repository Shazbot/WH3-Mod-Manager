import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import DBCloneRenameInput from "../src/components/viewer/DBCloneRenameInput";

describe("DB Clone rename input", () => {
  it("keeps typing and pointer events out of the surrounding tree", async () => {
    const user = userEvent.setup();
    const onTreeKeyDown = vi.fn();
    const onTreeClick = vi.fn();
    const onTreeMouseDown = vi.fn();

    const Harness = () => {
      const [value, setValue] = useState("original");
      return (
        <div onKeyDown={onTreeKeyDown} onClick={onTreeClick} onMouseDown={onTreeMouseDown}>
          <DBCloneRenameInput id="rename" value={value} disabled={false} hasWarning={false} onChange={setValue} />
        </div>
      );
    };

    render(<Harness />);
    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.clear(input);
    await user.type(input, "clone name");

    expect(input).toHaveValue("clone name");
    expect(input).toHaveFocus();
    expect(onTreeKeyDown).not.toHaveBeenCalled();
    expect(onTreeClick).not.toHaveBeenCalled();
    expect(onTreeMouseDown).not.toHaveBeenCalled();
  });
});
