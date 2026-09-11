import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PackFileRenameModal from "../src/components/viewer/PackFileRenameModal";

describe("PackFileRenameModal", () => {
  it("uses the pack folder tree for the default move mode", async () => {
    const onApply = vi.fn();
    render(
      <PackFileRenameModal
        show
        mode="move"
        paths={["scripts\\hello.lua"]}
        existingPaths={{ pack: ["scripts\\hello.lua", "assets\\base.txt"], unsaved: [] }}
        onClose={() => undefined}
        onApply={onApply}
      />,
    );

    expect(screen.getByTestId("move-destination-picker")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Find" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("assets"));

    await waitFor(() => expect(screen.getByTestId("rename-preview")).toHaveTextContent("assets\\hello.lua"));
    fireEvent.click(screen.getByRole("button", { name: "Apply", exact: true }));

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith([{ originalPath: "scripts\\hello.lua", newPath: "assets\\hello.lua" }]),
    );
  });

  it("creates folders below whichever destination is selected", async () => {
    render(
      <PackFileRenameModal
        show
        mode="move"
        paths={["scripts\\hello.lua"]}
        existingPaths={{ pack: ["scripts\\hello.lua"], unsaved: [] }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New folder", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), { target: { value: "generated" } });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));

    expect(screen.getByText("generated")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("rename-preview")).toHaveTextContent("scripts\\generated\\hello.lua"),
    );

    fireEvent.click(screen.getByRole("button", { name: "New folder", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), { target: { value: "nested" } });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));

    await waitFor(() =>
      expect(screen.getByTestId("rename-preview")).toHaveTextContent("scripts\\generated\\nested\\hello.lua"),
    );
  });

  it("keeps pattern-based moving available as an option", async () => {
    render(
      <PackFileRenameModal
        show
        mode="move"
        paths={["scripts\\hello.lua"]}
        existingPaths={{ pack: ["scripts\\hello.lua"], unsaved: [] }}
        onClose={() => undefined}
        onApply={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Use pattern-based move" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "scripts" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "overrides" } });

    await waitFor(() => expect(screen.getByTestId("rename-preview")).toHaveTextContent("overrides\\hello.lua"));
  });

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
    expect(screen.getByRole("radio", { name: "Replace whole file name" })).toBeChecked();
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
    expect(screen.getByRole("radio", { name: "Partial matching" })).toBeChecked();
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
