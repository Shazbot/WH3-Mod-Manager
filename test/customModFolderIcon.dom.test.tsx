import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CustomModFolderIcon from "../src/components/CustomModFolderIcon";

describe("CustomModFolderIcon", () => {
  it("uses a dark arrowless tooltip for custom folder paths", () => {
    render(<CustomModFolderIcon folderPath={"C:\\Pinned Mods"} />);

    expect(screen.getByLabelText("Custom folder: C:\\Pinned Mods")).toBeInTheDocument();
    expect(screen.getByTestId("flowbite-tooltip")).toHaveClass("!bg-transparent", "!p-0", "!z-[100]");
    expect(screen.getByText("Custom folder")).toHaveClass("text-purple-300");
    expect(screen.getByText("C:\\Pinned Mods")).toHaveClass("font-mono", "font-normal");
    expect(screen.getByTestId("flowbite-tooltip-arrow")).toBeInTheDocument();
  });
});
