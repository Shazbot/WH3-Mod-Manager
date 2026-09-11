import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PackFileRenameModal from "../src/components/viewer/PackFileRenameModal";

describe("PackFileRenameModal", () => {
  it("uses the primary field to replace the whole file name", async () => {
    render(
      <PackFileRenameModal
        show
        mode="rename"
        paths={["ui\\data.txt"]}
        existingPaths={{ pack: ["ui\\data.txt"], unsaved: [] }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "New file name" }), {
      target: { value: "renamed.txt" },
    });

    await waitFor(() => expect(screen.getByTestId("rename-preview")).toHaveTextContent("ui\\renamed.txt"), {
      timeout: 1000,
    });
    expect(screen.getByTestId("rename-preview")).not.toHaveTextContent("ui\\data.txt → ui\\renamed.txt");
    expect(screen.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  });

  it("updates its preview after the debounce", async () => {
    render(
      <PackFileRenameModal
        show
        mode="rename"
        paths={["ui\\data.txt"]}
        existingPaths={{ pack: ["ui\\data.txt"], unsaved: [] }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "data" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "mod" } });

    await waitFor(() => expect(screen.getByTestId("rename-preview")).toHaveTextContent("ui\\mod.txt"), {
      timeout: 1000,
    });
    expect(screen.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  });

  it("disables Apply for a conflict and invalid regular expression", async () => {
    const { rerender } = render(
      <PackFileRenameModal
        show
        mode="rename"
        paths={["ui\\data.txt"]}
        existingPaths={{ pack: ["ui\\data.txt", "ui\\mod.txt"], unsaved: [] }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "data" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "mod" } });
    await waitFor(() => expect(screen.getByTestId("rename-conflicts")).toBeInTheDocument(), { timeout: 1000 });
    expect(screen.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();

    rerender(
      <PackFileRenameModal
        show
        mode="rename"
        paths={["ui\\data.txt"]}
        existingPaths={{ pack: ["ui\\data.txt"], unsaved: [] }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Use regular expression" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "[" } });
    await waitFor(() => expect(screen.getByTestId("rename-invalid-regex")).toBeInTheDocument(), { timeout: 1000 });
    expect(screen.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  });
});
