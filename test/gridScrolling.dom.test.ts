import { AllCommunityModule, createGrid, ModuleRegistry, type GridApi } from "ag-grid-community";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGridViewport, scrollGridBy } from "../src/components/viewer/gridScrolling";

ModuleRegistry.registerModules([AllCommunityModule]);

describe("table scrolling with AG Grid's rendered DOM", () => {
  let root: HTMLDivElement;
  let api: GridApi;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
    api = createGrid(root, {
      theme: "legacy",
      columnDefs: [{ field: "key", pinned: "left" }, { field: "value" }],
      rowData: [{ key: "long key", value: "value" }],
    });
  });

  afterEach(() => {
    api.destroy();
    root.remove();
  });

  it("scrolls both axes of the viewport containing pinned and unpinned cells", async () => {
    await vi.waitFor(() => expect(root.querySelector(".ag-cell")).not.toBeNull());
    const viewport = getGridViewport(root)!;
    expect(viewport).not.toBeNull();
    expect(viewport.querySelector(".ag-grid-scrolling-rows .ag-grid-pinned-left-cells .ag-cell")).not.toBeNull();
    expect(viewport.querySelector(".ag-grid-scrolling-cells .ag-cell")).not.toBeNull();
    // jsdom has no layout; supply the dimensions a large table would have.
    Object.defineProperties(viewport, {
      scrollWidth: { value: 1200 },
      clientWidth: { value: 400 },
      scrollHeight: { value: 2000 },
      clientHeight: { value: 300 },
    });

    expect(scrollGridBy(root, 120, 80)).toBe(true);
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([120, 80]);
    expect(scrollGridBy(root, 10000, 10000)).toBe(true);
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([800, 1700]);
    expect(scrollGridBy(root, 20, 20)).toBe(false);
    expect(scrollGridBy(root, -10000, -10000)).toBe(true);
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([0, 0]);
    expect(scrollGridBy(root, -20, -20)).toBe(false);
  });
});
