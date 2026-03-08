import React from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { withNodeEditorActions } from "../../src/nodeGraph/editorState";

describe("node editor actions", () => {
  it("dispatches plain patch objects through the injected callback", async () => {
    const user = userEvent.setup();
    const updateNodeData = vi.fn();
    const [node] = withNodeEditorActions(
      [
        {
          id: "node_1",
          type: "packedfiles",
          position: { x: 0, y: 0 },
          data: { label: "Pack Files", type: "packedfiles" },
        } as any,
      ],
      { updateNodeData },
    );

    const ActionButton = () => (
      <button onClick={() => (node.data as any).onUpdateNodeData?.({ selectedPack: "mod_a.pack" })}>
        Update Node
      </button>
    );

    render(<ActionButton />);
    await user.click(screen.getByRole("button", { name: "Update Node" }));

    expect(updateNodeData).toHaveBeenCalledWith("node_1", { selectedPack: "mod_a.pack" });
  });
});
