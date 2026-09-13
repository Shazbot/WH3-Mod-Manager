import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import appReducer, { setDeletedPackFilePaths, setUnsavedPacksData } from "../src/appSlice";
import PackTablesTreeView from "../src/components/viewer/PackTablesTreeView";
import initialState from "../src/initialAppState";
import type { PackedFile } from "../src/packFileTypes";

describe("pack table tree interactions", () => {
  const renderPackTree = (
    tables: string[],
    preferredTab: "db" | "files" = "db",
    extraProps: Record<string, unknown> = {},
  ) => {
    const packPath = "K:\\mods\\menu.pack";
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          packsData: {
            [packPath]: {
              packName: "menu.pack",
              packPath,
              tables,
              packedFiles: {},
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab={preferredTab}
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
          {...extraProps}
        />
      </Provider>,
    );

    return screen.getByTestId("pack-tables-tree");
  };

  it("expands a group label without selecting it and selects a table label", () => {
    const packPath = "K:\\mods\\example.pack";
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          packsData: {
            [packPath]: {
              packName: "example.pack",
              packPath,
              tables: ["db\\units_tables\\first", "db\\units_tables\\second"],
              packedFiles: {},
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="db"
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    const groupLabel = screen.getByText("units_tables");
    const groupNode = groupLabel.closest("[role='treeitem']");
    expect(groupNode).toHaveAttribute("aria-selected", "false");
    const wasExpanded = groupNode?.getAttribute("aria-expanded");

    fireEvent.click(groupLabel);

    expect(groupNode).toHaveAttribute("aria-selected", "false");
    expect(groupNode?.getAttribute("aria-expanded")).not.toBe(wasExpanded);

    // Ensure the children are visible whichever default expansion state the library started with.
    if (!screen.queryByText("first")) fireEvent.click(groupLabel);
    const tableLabel = screen.getByText("first");
    fireEvent.click(tableLabel);

    expect(tableLabel.closest("[role='treeitem']")).toHaveAttribute("aria-selected", "true");
  });

  it("marks the node that opened the context menu", () => {
    renderPackTree(["scripts\\hello.lua"], "files");

    const folderLabel = screen.getByText("scripts");
    fireEvent.click(folderLabel);
    const fileLabel = screen.getByText("hello.lua");

    fireEvent.contextMenu(fileLabel);

    expect(fileLabel.closest("[role='treeitem']")).toHaveClass("bg-blue-700/60");
    expect(folderLabel.parentElement).not.toHaveClass("bg-blue-700/60");

    fireEvent.contextMenu(folderLabel);

    expect(folderLabel.parentElement).toHaveClass("bg-blue-700/60");
    expect(fileLabel.closest("[role='treeitem']")).not.toHaveClass("bg-blue-700/60");
  });

  it("expands a single-child folder chain from one click", () => {
    renderPackTree(["scripts\\nested\\hello.lua"], "files");

    fireEvent.click(screen.getByText("scripts"));

    expect(screen.getByText("nested")).toBeInTheDocument();
    expect(screen.getByText("hello.lua")).toBeInTheDocument();
  });

  it("shows folders before files at each tree level", () => {
    const tree = renderPackTree(
      ["root-file.lua", "folder\\z-file.lua", "folder\\a-folder\\nested.lua", "folder\\a-file.lua"],
      "files",
    );

    const labelsAtLevel = (level: string) =>
      Array.from(tree.querySelectorAll(`[role="treeitem"][aria-level="${level}"]`)).map((node) =>
        node.textContent?.trim(),
      );

    expect(labelsAtLevel("1")).toEqual(["folder", "root-file.lua"]);

    fireEvent.click(screen.getByText("folder"));

    expect(labelsAtLevel("2")).toEqual(["a-folder", "a-file.lua", "z-file.lua"]);
  });

  it("keeps collapsed DB groups collapsed after deleting a file", async () => {
    const user = userEvent.setup();
    const packPath = "K:\\mods\\menu.pack";
    const deletePackedFiles = vi.fn().mockResolvedValue({
      success: true,
      removedPaths: ["db\\first_tables\\data__"],
    });
    window.api = { deletePackedFiles } as unknown as NonNullable<Window["api"]>;
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          packsData: {
            [packPath]: {
              packName: "menu.pack",
              packPath,
              tables: ["db\\first_tables\\first", "db\\second_tables\\second"],
              packedFiles: {},
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="db"
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    const secondGroupLabel = screen.getByText("second_tables");
    const secondGroupNode = secondGroupLabel.closest("[role='treeitem']");
    expect(secondGroupNode).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(secondGroupLabel);
    expect(secondGroupNode).toHaveAttribute("aria-expanded", "false");

    fireEvent.contextMenu(screen.getByText("first"));
    fireEvent.click(screen.getByRole("button", { name: "Delete file", exact: true }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(deletePackedFiles).toHaveBeenCalledWith(packPath, ["db\\first_tables\\first"]));
    store.dispatch(
      setDeletedPackFilePaths({
        packPath,
        deletedFilePaths: ["db\\first_tables\\first"],
      }),
    );

    await waitFor(() => expect(screen.queryByText("first_tables")).not.toBeInTheDocument());
    expect(screen.getByText("second_tables").closest("[role='treeitem']")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps an expanded file folder open after importing another file", async () => {
    const packPath = "K:\\mods\\menu.pack";
    const selectImportFiles = vi.fn().mockResolvedValue(["C:\\imports\\added.lua"]);
    const planPackImportFromDisk = vi.fn().mockResolvedValue({
      items: [{ diskPath: "C:\\imports\\added.lua", packedPath: "scripts\\added.lua" }],
      errors: [],
    });
    const applyPackImportFromDisk = vi.fn().mockResolvedValue({ success: true, importedCount: 1, errors: [] });
    window.api = {
      selectImportFiles,
      planPackImportFromDisk,
      applyPackImportFromDisk,
    } as unknown as NonNullable<Window["api"]>;
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          packsData: {
            [packPath]: {
              packName: "menu.pack",
              packPath,
              tables: ["scripts\\hello.lua", "other\\base.lua"],
              packedFiles: {},
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="files"
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    const scriptsLabel = screen.getByText("scripts");
    fireEvent.click(scriptsLabel);
    expect(scriptsLabel.closest("[role='treeitem']")).toHaveAttribute("aria-expanded", "true");

    fireEvent.contextMenu(scriptsLabel);
    fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: /Import Files/ }));

    await waitFor(() => expect(applyPackImportFromDisk).toHaveBeenCalled());
    store.dispatch(
      setUnsavedPacksData({
        packPath,
        unsavedFileData: [{ name: "scripts\\added.lua" } as PackedFile],
      }),
    );

    await waitFor(() => expect(screen.getByText("added.lua")).toBeInTheDocument());
    expect(screen.getByText("scripts").closest("[role='treeitem']")).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the empty DB tab and offers both creation actions in Files", () => {
    const tree = renderPackTree(["variantmeshes\\variantmeshdefinitions\\unit.variantmeshdefinition"], "db");

    expect(screen.queryByRole("button", { name: "DB Tables", exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files", exact: true })).toBeInTheDocument();

    fireEvent.contextMenu(tree);

    expect(screen.getByRole("button", { name: "Add", exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New Table", exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(screen.getByRole("button", { name: "Add New Table", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add New Flow", exact: true })).toBeInTheDocument();
  });

  it("hides the empty Files tab and offers both creation actions in DB Tables", () => {
    const tree = renderPackTree(["db\\units_tables\\data__"], "files");

    expect(screen.getByRole("button", { name: "DB Tables", exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files", exact: true })).not.toBeInTheDocument();

    fireEvent.contextMenu(tree);

    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(screen.getByRole("button", { name: "Add New Table", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add New Flow", exact: true })).toBeInTheDocument();
  });

  it("hides both tabs and offers both creation actions on an empty pack", () => {
    const tree = renderPackTree([]);

    expect(screen.queryByRole("button", { name: "DB Tables", exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Files", exact: true })).not.toBeInTheDocument();

    fireEvent.contextMenu(tree);

    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(screen.getByRole("button", { name: "Add New Table", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add New Flow", exact: true })).toBeInTheDocument();
  });

  it("adds a new folder below the right-clicked folder", () => {
    renderPackTree(["scripts\\hello.lua"], "files");

    fireEvent.contextMenu(screen.getByText("scripts"));
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Add New Folder", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "generated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));

    expect(screen.getByText("generated")).toBeInTheDocument();
    expect(screen.getByText("generated").closest("[role='treeitem']")).toHaveAttribute("aria-level", "2");
  });

  it("adds a new folder at the pack root when the tree background is right-clicked", () => {
    const tree = renderPackTree([], "files");

    fireEvent.contextMenu(tree);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Add New Folder", exact: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "generated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));

    expect(screen.getByText("generated").closest("[role='treeitem']")).toHaveAttribute("aria-level", "1");
  });

  it("opens a newly created flow and reports a failed flow save", async () => {
    const saveNodeFlow = vi
      .fn()
      .mockResolvedValueOnce({ success: true, filePath: "whmmflows\\new_flow.json" })
      .mockResolvedValueOnce({ success: false, error: "disk full" });
    const onOpenFlowFile = vi.fn();
    const showDialog = vi.fn();
    window.api = { saveNodeFlow } as unknown as NonNullable<Window["api"]>;

    const tree = renderPackTree([], "files", { onOpenFlowFile, showDialog });
    fireEvent.contextMenu(tree);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Add New Flow", exact: true }));
    fireEvent.change(screen.getByPlaceholderText("Enter flow name..."), { target: { value: "new_flow.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));

    await waitFor(() => expect(saveNodeFlow).toHaveBeenCalled());
    expect(onOpenFlowFile).toHaveBeenCalledWith({
      flowFile: "whmmflows\\new_flow.json",
      packPath: "K:\\mods\\menu.pack",
    });

    fireEvent.contextMenu(tree);
    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Add New Flow", exact: true }));
    fireEvent.change(screen.getByPlaceholderText("Enter flow name..."), { target: { value: "broken.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Create", exact: true }));

    await waitFor(() =>
      expect(showDialog).toHaveBeenCalledWith(expect.stringContaining("disk full"), expect.anything()),
    );
  });

  it("offers active packs and a selectable mod catalog when copying a table", async () => {
    const copyInto = vi.fn();
    window.api = {
      getViewerPackCatalog: vi.fn().mockResolvedValue({
        success: true,
        packs: [
          {
            path: "K:\\mods\\menu.pack",
            name: "menu.pack",
            humanName: "Menu",
            isEnabled: true,
            isInData: false,
          },
          {
            path: "K:\\mods\\catalog.pack",
            name: "catalog.pack",
            humanName: "Catalog",
            isEnabled: false,
            isInData: false,
          },
          {
            path: "K:\\mods\\enabled.pack",
            name: "enabled.pack",
            humanName: "Enabled",
            isEnabled: true,
            isInData: false,
          },
        ],
      }),
    } as unknown as NonNullable<Window["api"]>;

    const tree = renderPackTree(["db\\units_tables\\data__"], "db", {
      otherOpenPacks: [{ packPath: "K:\\mods\\active.pack", label: "Active" }],
      onCopyInto: copyInto,
    });
    const tableLabel = screen.getByText("data__");

    fireEvent.contextMenu(tableLabel);
    fireEvent.click(screen.getByRole("button", { name: "Copy into", exact: true }));

    expect(screen.getByRole("button", { name: "Select Pack...", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /open pack and copied file/i })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Active", exact: true }));
    expect(copyInto).toHaveBeenCalledWith(
      {
        packPath: "K:\\mods\\menu.pack",
        filePath: "db\\units_tables\\data__",
        kind: "db",
        dbSelection: {
          packPath: "K:\\mods\\menu.pack",
          dbFolder: "db",
          dbName: "units_tables",
          dbSubname: "data__",
        },
      },
      "K:\\mods\\active.pack",
      true,
    );

    // The picker is loaded lazily and splits enabled mods from the complete mod-manager catalog.
    fireEvent.contextMenu(tableLabel);
    fireEvent.click(screen.getByRole("button", { name: "Copy into", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Select Pack...", exact: true }));
    const enabledPicker = await waitFor(() => screen.getByRole("combobox", { name: "Enabled mods" }));
    const allModsPicker = screen.getByRole("combobox", { name: "All mods" });
    expect(enabledPicker).toHaveTextContent("Enabled (enabled.pack)");
    expect(allModsPicker).toHaveTextContent("Catalog (catalog.pack)");
    expect(screen.getByRole("option", { name: "Catalog (catalog.pack)" })).toHaveAttribute(
      "title",
      "K:\\mods\\catalog.pack",
    );
    fireEvent.change(enabledPicker, { target: { value: "K:\\mods\\enabled.pack" } });
    expect(copyInto).toHaveBeenLastCalledWith(expect.anything(), "K:\\mods\\enabled.pack", true);

    fireEvent.contextMenu(tableLabel);
    fireEvent.click(screen.getByRole("button", { name: "Copy into", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Select Pack...", exact: true }));
    const reopenedAllModsPicker = await waitFor(() => screen.getByRole("combobox", { name: "All mods" }));
    fireEvent.change(reopenedAllModsPicker, { target: { value: "K:\\mods\\catalog.pack" } });
    expect(copyInto).toHaveBeenLastCalledWith(expect.anything(), "K:\\mods\\catalog.pack", true);

    expect(tree).toBeInTheDocument();
  });

  it("keeps the tree context menu content-sized so Copy into can open beside it", () => {
    const tree = renderPackTree(["db\\units_tables\\data__"], "db", {
      otherOpenPacks: [{ packPath: "K:\\mods\\active.pack", label: "Active" }],
      onCopyInto: vi.fn(),
    });

    fireEvent.contextMenu(screen.getByText("data__"));

    expect(screen.getByTestId("pack-tables-context-menu")).toHaveClass("w-max");
    expect(screen.getByRole("button", { name: "Copy into", exact: true })).toBeInTheDocument();
    expect(tree).toBeInTheDocument();
  });

  it("groups tree context actions into the requested submenu order", () => {
    const tree = renderPackTree(["scripts\\hello.lua"], "files", {
      otherOpenPacks: [{ packPath: "K:\\mods\\active.pack", label: "Active" }],
      onCopyInto: vi.fn(),
    });

    fireEvent.click(screen.getByText("scripts"));
    fireEvent.contextMenu(screen.getByText("hello.lua"));

    const contextMenu = screen.getByTestId("pack-tables-context-menu");
    const topLevelLabels = Array.from(contextMenu.children).map((child) => {
      const button = child.tagName === "BUTTON" ? child : child.querySelector("button");
      return button?.textContent?.replace("▶", "").trim() || "separator";
    });
    expect(topLevelLabels).toEqual([
      "Copy into",
      "Add",
      "separator",
      "Copy path",
      "separator",
      "Rename file…",
      "Move file…",
      "Delete file",
      "separator",
      "Import",
      "Export",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    expect(screen.getByRole("button", { name: "Add New Flow", exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
    expect(screen.getByRole("button", { name: "Import Files…", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Folders…", exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export", exact: true }));
    expect(screen.getByRole("button", { name: "Export Selection…", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Whole Pack…", exact: true })).toBeInTheDocument();
    expect(tree).toBeInTheDocument();
  });

  it("copies the selected packed-file path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const tree = renderPackTree(["scripts\\hello.lua"], "files");

    fireEvent.click(screen.getByText("scripts"));
    fireEvent.contextMenu(screen.getByText("hello.lua"));
    fireEvent.click(screen.getByRole("button", { name: "Copy path", exact: true }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("scripts\\hello.lua"));
    expect(screen.queryByTestId("pack-tables-context-menu")).not.toBeInTheDocument();
    expect(tree).toBeInTheDocument();
  });

  it("copies the clicked folder path instead of its descendant file paths", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const tree = renderPackTree(["scripts\\hello.lua"], "files");

    fireEvent.contextMenu(screen.getByText("scripts"));
    fireEvent.click(screen.getByRole("button", { name: "Copy path", exact: true }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("scripts"));
    expect(tree).toBeInTheDocument();
  });

  it("offers the same copy action for a packed file", () => {
    const copyInto = vi.fn();
    const tree = renderPackTree(["scripts\\hello.lua"], "files", {
      otherOpenPacks: [{ packPath: "K:\\mods\\active.pack", label: "Active" }],
      onCopyInto: copyInto,
    });

    fireEvent.click(screen.getByText("scripts"));
    fireEvent.contextMenu(screen.getByText("hello.lua"));
    fireEvent.click(screen.getByRole("button", { name: "Copy into", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Active", exact: true }));

    expect(copyInto).toHaveBeenCalledWith(
      {
        packPath: "K:\\mods\\menu.pack",
        filePath: "scripts\\hello.lua",
        kind: "file",
      },
      "K:\\mods\\active.pack",
      true,
    );
    expect(tree).toBeInTheDocument();
  });

  it("offers delete, rename, and move for a selected folder with plural labels", () => {
    renderPackTree(["scripts\\hello.lua", "scripts\\goodbye.lua"], "files");

    fireEvent.contextMenu(screen.getByText("scripts"));

    expect(screen.getByRole("button", { name: "Delete 2 files", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename 2 files…", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move 2 files…", exact: true })).toBeInTheDocument();
  });

  it("expands a DB table group for pack actions", () => {
    renderPackTree(["db\\units_tables\\first", "db\\units_tables\\second"], "db");

    fireEvent.contextMenu(screen.getByText("units_tables"));

    expect(screen.getByRole("button", { name: "Delete 2 files", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename 2 files…", exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move 2 files…", exact: true })).toBeInTheDocument();
  });

  it("hides delete, rename, and move for vanilla packs", () => {
    const packPath = "K:\\data.pack";
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          packsData: {
            [packPath]: {
              packName: "data.pack",
              packPath,
              tables: ["scripts\\hello.lua"],
              packedFiles: {},
            },
          },
        },
      },
    });

    render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="files"
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    fireEvent.contextMenu(screen.getByText("scripts"));
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move/ })).not.toBeInTheDocument();
  });

  it("shows the DB pack Files tab and loads vanilla folders on demand", async () => {
    const packPath = "K:\\game\\data\\db.pack";
    const getVanillaPackFileTree = vi
      .fn()
      .mockResolvedValueOnce({ success: true, children: [{ path: "animation", isBranch: true }] })
      .mockResolvedValueOnce({
        success: true,
        children: [
          { path: "animation\\campaign", isBranch: true },
          { path: "animation\\campaign\\dragon.anim", isBranch: false },
        ],
        totalChildren: 1002,
        hasMore: true,
        nextOffset: 2,
      });
    const previousApi = window.api;
    window.api = { getVanillaPackFileTree } as unknown as NonNullable<Window["api"]>;

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentGame: "wh3",
          packsData: {
            [packPath]: {
              packName: "db.pack",
              packPath,
              tables: ["db\\units_tables\\data__"],
              packedFiles: {},
            },
          },
        },
      },
    });

    const view = render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="files"
          tableFilter=""
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    try {
      expect(screen.getByRole("button", { name: "Files", exact: true })).toBeInTheDocument();
      await waitFor(() => expect(getVanillaPackFileTree).toHaveBeenCalledWith(packPath, ""));
      expect(screen.getByText("animation")).toBeInTheDocument();

      fireEvent.click(screen.getByText("animation"));

      await waitFor(() => expect(getVanillaPackFileTree).toHaveBeenCalledWith(packPath, "animation"));
      expect(screen.getByText("campaign")).toBeInTheDocument();
      const campaignNode = screen.getByText("campaign").closest('[role="treeitem"]');
      if (campaignNode?.getAttribute("aria-expanded") !== "true") fireEvent.click(screen.getByText("campaign"));
      expect(screen.getByText("dragon.anim")).toBeInTheDocument();
      expect(screen.getByText("Load more files… (1,000 remaining)")).toBeInTheDocument();
    } finally {
      view.unmount();
      window.api = previousApi;
    }
  });

  it("searches unloaded vanilla files through the index cache", async () => {
    const packPath = "K:\\game\\data\\db.pack";
    const getVanillaPackFileTree = vi.fn().mockResolvedValue({ success: true, children: [] });
    const searchVanillaPackFiles = vi.fn().mockResolvedValue({
      success: true,
      filePaths: ["audio\\wwise\\dragon.anim"],
      folderPaths: [],
      truncated: false,
    });
    const previousApi = window.api;
    window.api = { getVanillaPackFileTree, searchVanillaPackFiles } as unknown as NonNullable<Window["api"]>;

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          currentGame: "wh3",
          packsData: {
            [packPath]: {
              packName: "db.pack",
              packPath,
              tables: ["db\\units_tables\\data__"],
              packedFiles: {},
            },
          },
        },
      },
    });

    const view = render(
      <Provider store={store}>
        <PackTablesTreeView
          packPath={packPath}
          preferredTab="files"
          tableFilter="dragon"
          showDialog={vi.fn()}
          onOpenDBTable={vi.fn()}
          onOpenFlowFile={vi.fn()}
          onOpenPackedFile={vi.fn()}
        />
      </Provider>,
    );

    try {
      await waitFor(() => expect(searchVanillaPackFiles).toHaveBeenCalledWith(packPath, "dragon"));
      await waitFor(() => expect(screen.getByText("dragon.anim")).toBeInTheDocument());
      expect(screen.getByText("audio")).toBeInTheDocument();
      expect(screen.getByText("wwise")).toBeInTheDocument();
    } finally {
      view.unmount();
      window.api = previousApi;
    }
  });
});
