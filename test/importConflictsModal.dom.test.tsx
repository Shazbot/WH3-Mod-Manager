import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ImportConflictsModal from "../src/components/viewer/ImportConflictsModal";
import LocalizationContext from "../src/localizationContext";

describe("ImportConflictsModal", () => {
  it("checks conflicts by default and imports only the selected files", () => {
    const onImport = vi.fn();
    const request: PackImportConflictRequest = {
      packPath: "K:\\mods\\example.pack",
      plan: {
        items: [
          { diskPath: "/tmp/new.txt", packFilePath: "new.txt", isRpfmTsv: false },
          { diskPath: "/tmp/old.txt", packFilePath: "old.txt", isRpfmTsv: false, conflictsWith: "pack" },
          { diskPath: "/tmp/unsaved.txt", packFilePath: "unsaved.txt", isRpfmTsv: false, conflictsWith: "unsaved" },
        ],
        errors: [],
      },
    };

    render(<ImportConflictsModal request={request} onCancel={vi.fn()} onImport={onImport} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));

    expect(onImport).toHaveBeenCalledWith([request.plan.items[0], request.plan.items[2]]);
  });

  it("uses localized labels supplied by the viewer context", () => {
    const request: PackImportConflictRequest = {
      packPath: "K:\\mods\\example.pack",
      plan: {
        items: [{ diskPath: "/tmp/old.txt", packFilePath: "old.txt", isRpfmTsv: false, conflictsWith: "pack" }],
        errors: [],
      },
    };

    render(
      <LocalizationContext.Provider
        value={{
          viewerImportConflicts: "Localized import conflicts",
          viewerSelectAll: "Localized select all",
          viewerImport: "Localized import",
        }}
      >
        <ImportConflictsModal request={request} onCancel={vi.fn()} onImport={vi.fn()} />
      </LocalizationContext.Provider>,
    );

    expect(screen.getByText("Localized import conflicts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Localized select all", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Localized import", exact: true })).toBeInTheDocument();
  });
});
