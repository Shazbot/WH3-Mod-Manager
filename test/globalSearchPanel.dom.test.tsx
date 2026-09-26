import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// The windowed list has nothing to do with what this panel decides; render every row so the
// assertions can see result lines.
vi.mock("react-virtualized", () => ({
  AutoSizer: ({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) =>
    children({ width: 900, height: 600 }),
  List: ({ rowCount, rowRenderer }: { rowCount: number; rowRenderer: (props: never) => React.ReactNode }) => (
    <div>
      {Array.from({ length: rowCount }, (_unused, index) =>
        rowRenderer({ index, key: String(index), style: {} } as never),
      )}
    </div>
  ),
}));

import GlobalSearchPanel from "../src/components/viewer/GlobalSearchPanel";
import LocalizationContext from "../src/localizationContext";
import type { GlobalSearchRequest, GlobalSearchResponse, GlobalSearchResult } from "../src/globalSearch/types";

const dbResult: GlobalSearchResult = {
  kind: "db",
  packPath: "C:\\game\\data\\db.pack",
  packLabel: "db.pack",
  packedFilePath: "db\\land_units_tables\\data__",
  dbName: "land_units_tables",
  dbSubname: "data__",
  columnName: "key",
  rowIndex: 4021,
  value: "chaos_warriors_01",
  matchStart: 0,
  matchEnd: 14,
};

const textResult: GlobalSearchResult = {
  kind: "text",
  packPath: "C:\\mods\\mymod.pack",
  packLabel: "mymod.pack",
  filePath: "script\\campaign\\units.lua",
  line: 88,
  column: 12,
  offset: 2100,
  excerpt: 'local u = "chaos_warriors"',
  matchStartInExcerpt: 11,
  matchEndInExcerpt: 25,
};

const rigidResult: GlobalSearchResult = {
  kind: "rigidModel",
  packPath: "C:\\game\\data\\data.pack",
  packLabel: "data.pack",
  filePath: "variantmeshes\\_variantmodels\\man.rigid_model_v2",
  offset: 512,
  encoding: "utf16le",
  excerpt: "chaos_warriors_body",
  matchStartInExcerpt: 0,
  matchEndInExcerpt: 14,
};

const locResult: GlobalSearchResult = {
  kind: "loc",
  packPath: "C:\\game\\data\\local_en.pack",
  packLabel: "local_en.pack",
  filePath: "text\\db\\local.loc",
  key: "unit_name_chaos_warriors",
  value: "Chaos Warriors",
  matchedIn: "value",
  matchStart: 0,
  matchEnd: 14,
};

const emptyResponse = (searchId: string, results: GlobalSearchResult[] = []): GlobalSearchResponse => ({
  success: true,
  searchId,
  canceled: false,
  truncated: false,
  results,
  counts: { db: 0, loc: 0, text: 0, rigidModel: 0 },
  targetsSearched: 1,
  filesScanned: 0,
  skippedFiles: [],
  warnings: [],
  elapsedMs: 5,
});

const setupApi = (
  runGlobalSearch: (request: GlobalSearchRequest) => Promise<GlobalSearchResponse>,
  packs: Array<{ path: string; name: string; isEnabled: boolean; isInData: boolean }> = [],
) => {
  const cancelGlobalSearch = vi.fn();
  window.api = {
    getViewerPackCatalog: vi.fn().mockResolvedValue({ success: true, packs }),
    runGlobalSearch: vi.fn(runGlobalSearch),
    cancelGlobalSearch,
    onGlobalSearchProgress: vi.fn(() => vi.fn()),
    onGlobalSearchResults: vi.fn(() => vi.fn()),
  } as never;
  return { cancelGlobalSearch };
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof GlobalSearchPanel>> = {}) => {
  const onOpenDbResult = vi.fn();
  const onOpenFileResult = vi.fn();
  const onClose = vi.fn();
  const props: React.ComponentProps<typeof GlobalSearchPanel> = {
    isOpen: true,
    openPacks: [{ packPath: "C:\\mods\\mymod.pack", label: "mymod.pack" }],
    onOpenDbResult,
    onOpenFileResult,
    onClose,
    ...overrides,
  };
  const { rerender } = render(<GlobalSearchPanel {...props} />);
  /** The dock hides the panel rather than unmounting it, so closing it is a prop change. */
  const rerenderPanel = (next: Partial<React.ComponentProps<typeof GlobalSearchPanel>> = {}) =>
    rerender(<GlobalSearchPanel {...props} {...next} />);
  return { onOpenDbResult, onOpenFileResult, onClose, rerenderPanel };
};

const searchButton = () => screen.getByRole("button", { name: "Search" });

describe("GlobalSearchPanel", () => {
  beforeEach(() => {
    setupApi(async (request) => emptyResponse(request.searchId));
  });

  it("starts with every kind but rigid models enabled, and vanilla as the source", () => {
    renderPanel();

    expect(screen.getByRole("checkbox", { name: /DB tables/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Loc tables/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Text files/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Rigid models/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Vanilla packs/ })).toBeChecked();
  });

  it("uses localized result-kind labels from the viewer context", () => {
    render(
      <LocalizationContext.Provider
        value={{
          globalSearchDbTables: "Localized DB tables",
          globalSearchLocTables: "Localized loc tables",
          globalSearchTextFiles: "Localized text files",
          globalSearchRigidModels: "Localized rigid models",
        }}
      >
        <GlobalSearchPanel
          isOpen
          openPacks={[]}
          onOpenDbResult={vi.fn()}
          onOpenFileResult={vi.fn()}
          onClose={vi.fn()}
        />
      </LocalizationContext.Provider>,
    );

    expect(screen.getByRole("checkbox", { name: /Localized DB tables/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Localized loc tables/ })).toBeChecked();
  });

  it("keeps its query and results when it is closed and reopened", async () => {
    setupApi(async (request) => emptyResponse(request.searchId, [dbResult]));
    const { rerenderPanel } = renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());
    await waitFor(() => expect(screen.getByText(/row 4021/)).toBeInTheDocument());

    rerenderPanel({ isOpen: false });
    rerenderPanel({ isOpen: true });

    expect(screen.getByLabelText("Global search")).toHaveValue("chaos");
    expect(screen.getByText(/row 4021/)).toBeInTheDocument();
  });

  it("puts the caret back in the box every time it is opened", () => {
    const { rerenderPanel } = renderPanel();
    const input = screen.getByLabelText("Global search");
    expect(input).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    expect(input).not.toHaveFocus();

    rerenderPanel({ isOpen: false });
    rerenderPanel({ isOpen: true });
    expect(input).toHaveFocus();
  });

  it("puts the controls in a sidebar beside the results rather than stacked above them", () => {
    renderPanel();

    const panel = screen.getByTestId("global-search-panel");
    const results = screen.getByTestId("global-search-results");
    const controls = screen.getByTestId("global-search-controls");

    // Siblings under the panel, results first, so the controls occupy the width the short result
    // lines leave over instead of eating the dock's height.
    expect(results.parentElement).toBe(panel);
    expect(controls.parentElement).toBe(panel);
    expect(results.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Every control belongs to the sidebar, not to the results column.
    expect(controls).toContainElement(screen.getByLabelText("Global search"));
    expect(controls).toContainElement(searchButton());
    expect(controls).toContainElement(screen.getByRole("checkbox", { name: /Vanilla packs/ }));
    expect(results).not.toContainElement(searchButton());
  });

  it("keeps Search disabled until there is something to search for", async () => {
    renderPanel();
    expect(searchButton()).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    expect(searchButton()).toBeEnabled();
  });

  it("refuses to run an uncompilable regex instead of searching for it literally", async () => {
    renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos(");
    expect(searchButton()).toBeEnabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "Regex" }));
    expect(screen.getByText("Not a valid regular expression yet.")).toBeInTheDocument();
    expect(searchButton()).toBeDisabled();
  });

  it("disables Search when no kind is selected", async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText("Global search"), "chaos");

    for (const name of [/DB tables/, /Loc tables/, /Text files/]) {
      await userEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(searchButton()).toBeDisabled();
  });

  it("disables Search when no source is selected", async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText("Global search"), "chaos");

    await userEvent.click(screen.getByRole("checkbox", { name: /Vanilla packs/ }));
    expect(searchButton()).toBeDisabled();
  });

  it("sends the options and sources the user picked", async () => {
    const requests: GlobalSearchRequest[] = [];
    setupApi(async (request) => {
      requests.push(request);
      return emptyResponse(request.searchId);
    });
    renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(screen.getByRole("checkbox", { name: "Case sensitive" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Rigid models/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "mymod.pack" }));
    await userEvent.click(searchButton());

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      query: "chaos",
      caseSensitive: true,
      regex: false,
      kinds: { db: true, loc: true, text: true, rigidModel: true },
    });
    expect(requests[0].sources).toEqual([{ kind: "pack", path: "C:\\mods\\mymod.pack" }, { kind: "vanilla" }]);
  });

  it("collapses 'enabled mods' into 'all mods' rather than sending both", async () => {
    const requests: GlobalSearchRequest[] = [];
    setupApi(async (request) => {
      requests.push(request);
      return emptyResponse(request.searchId);
    });
    renderPanel({ openPacks: [] });

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(screen.getByRole("checkbox", { name: /Enabled mods/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /All mods/ }));
    await userEvent.click(searchButton());

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].sources).toEqual([{ kind: "allMods" }, { kind: "vanilla" }]);
  });

  it("opens a DB result through the table handler and a text result through the file handler", async () => {
    setupApi(async (request) => emptyResponse(request.searchId, [dbResult, textResult]));
    const { onOpenDbResult, onOpenFileResult } = renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    await waitFor(() => expect(screen.getByText(/row 4021/)).toBeInTheDocument());

    await userEvent.click(screen.getByText(/row 4021/));
    expect(onOpenDbResult).toHaveBeenCalledWith(dbResult);

    await userEvent.click(screen.getByText(":88"));
    expect(onOpenFileResult).toHaveBeenCalledWith(textResult);
  });

  it("does not offer to open a rigid model, which has no viewer", async () => {
    setupApi(async (request) => emptyResponse(request.searchId, [rigidResult]));
    const { onOpenFileResult } = renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    await waitFor(() => expect(screen.getByText(/@512/)).toBeInTheDocument());
    const row = screen.getByText(/@512/).closest("button");
    expect(row).toBeDisabled();

    await userEvent.click(row as HTMLButtonElement);
    expect(onOpenFileResult).not.toHaveBeenCalled();
  });

  it("opens a loc result through the table handler", async () => {
    setupApi(async (request) => emptyResponse(request.searchId, [locResult]));
    const { onOpenDbResult, onOpenFileResult } = renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    const row = await screen.findByText("Chaos Warriors");
    expect(row.closest("button")).toBeEnabled();

    await userEvent.click(row.closest("button") as HTMLButtonElement);
    expect(onOpenDbResult).toHaveBeenCalledWith(locResult);
    expect(onOpenFileResult).not.toHaveBeenCalled();
  });

  it("groups results under their pack and file", async () => {
    setupApi(async (request) => emptyResponse(request.searchId, [dbResult, textResult]));
    // No open packs, so the only thing carrying a pack path as a title is the result tree.
    renderPanel({ openPacks: [] });

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    await waitFor(() => expect(screen.getByTitle("C:\\game\\data\\db.pack")).toBeInTheDocument());
    expect(screen.getByTitle("db\\land_units_tables\\data__")).toBeInTheDocument();
    expect(screen.getByTitle("C:\\mods\\mymod.pack")).toBeInTheDocument();
    expect(screen.getByTitle("script\\campaign\\units.lua")).toBeInTheDocument();
  });

  it("names a DB result group by its table, not by its data__ file", async () => {
    setupApi(async (request) => emptyResponse(request.searchId, [dbResult]));
    renderPanel({ openPacks: [] });

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    const fileRow = await screen.findByTitle("db\\land_units_tables\\data__");
    // The table is what identifies the group; every DB file in a pack is called data__.
    expect(fileRow).toHaveTextContent("land_units_tables");
    expect(fileRow).toHaveTextContent("data__");
  });

  it("explains itself when the main-process handler is not registered", async () => {
    setupApi(async () => {
      throw new Error("Error invoking remote method 'runGlobalSearch': No handler registered for 'runGlobalSearch'");
    });
    renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    await waitFor(() => expect(screen.getByText(/the main-process handler is not registered yet/)).toBeInTheDocument());
  });

  it("surfaces a failure the backend reports", async () => {
    setupApi(async (request) => ({ ...emptyResponse(request.searchId), success: false, error: "cache unavailable" }));
    renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    await waitFor(() => expect(screen.getByText("cache unavailable")).toBeInTheDocument());
  });

  it("cancels through the backend when Stop is pressed", async () => {
    let release: (response: GlobalSearchResponse) => void = () => undefined;
    const { cancelGlobalSearch } = setupApi(
      (request) =>
        new Promise<GlobalSearchResponse>((resolve) => {
          release = resolve;
          void request;
        }),
    );
    renderPanel();

    await userEvent.type(screen.getByLabelText("Global search"), "chaos");
    await userEvent.click(searchButton());

    const stop = await screen.findByRole("button", { name: "Stop" });
    await userEvent.click(stop);
    expect(cancelGlobalSearch).toHaveBeenCalledTimes(1);

    release(emptyResponse("ignored", []));
  });
});
