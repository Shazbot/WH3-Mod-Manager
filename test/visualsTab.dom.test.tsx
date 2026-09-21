import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appReducer, { setIsModEnabled } from "../src/appSlice";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";
import VisualsTab from "../src/components/VisualsTab";

vi.mock("react-virtualized", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-virtualized")>();
  return {
    ...actual,
    AutoSizer: ({ children }: { children: (size: { height: number; width: number }) => React.ReactNode }) =>
      children({ height: 600, width: 400 }),
  };
});

vi.mock("re-resizable", () => ({
  Resizable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../src/components/VisualsModelPreview", () => ({
  default: () => <div data-testid="visuals-model-preview" />,
}));

const units = [
  {
    unitKey: "emp_lord",
    faction: "empire",
    localizedName: "Empire Lord",
    variantName: "default",
    variantMeshPath: "variantmeshes\\emp_lord.variantmeshdefinition",
    originPackPath: "/mods/example.pack",
    originLabel: "Example",
    cultureKey: "human",
    cultureName: "Human",
    caste: "lord",
  },
];

const searchVisualsFiles = vi.fn();
const getVisualsUnitsData = vi.fn();
const readVariantMeshDefinition = vi.fn();
const putPathInClipboard = vi.fn();
const selectDirectory = vi.fn();
const extractVisualsFilesToDirectory = vi.fn();

describe("VisualsTab filtering", () => {
  beforeEach(() => {
    getVisualsUnitsData.mockReset().mockResolvedValue({
      success: true,
      sessionId: "visuals-session",
      units,
    });
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 1,
      results: [{ path: "models\\example.wsmodel", ext: "wsmodel" }],
    });
    readVariantMeshDefinition.mockReset();
    putPathInClipboard.mockReset();
    selectDirectory.mockReset().mockResolvedValue("/tmp/visuals-extract");
    extractVisualsFilesToDirectory.mockReset().mockResolvedValue({ success: true, writtenCount: 1, skipped: [] });
    window.api = {
      ...window.api,
      getVisualsUnitsData,
      searchVisualsFiles,
      readVariantMeshDefinition,
      putPathInClipboard,
      selectDirectory,
      extractVisualsFilesToDirectory,
    } as NonNullable<Window["api"]>;
  });

  it("expands matching culture and caste groups while filtering", async () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    expect(screen.queryByText("Empire Lord")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Unit filter (regex)"), { target: { value: "Empire" } });

    await waitFor(() => expect(screen.getByText("Empire Lord")).toBeInTheDocument());
  });

  it("loads model files in 1000-item pages", async () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));

    await waitFor(() => expect(searchVisualsFiles).toHaveBeenCalledWith("visuals-session", "", 0, 1000));
    expect(screen.getByText("models\\example.wsmodel")).toBeInTheDocument();
  });

  it("opens material files in a new tab and offers copy actions without AssetEditor actions", async () => {
    const materialPath = "materials\\example.xml.material";
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 1,
      results: [{ path: materialPath, ext: "xml.material" }],
    });
    readVariantMeshDefinition.mockResolvedValue({
      success: true,
      text: "<material />",
      resolved: { packPath: "/mods/example.pack", fileName: materialPath },
    });

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));

    const materialRow = await screen.findByText(materialPath);
    fireEvent.doubleClick(materialRow);
    await waitFor(() => expect(readVariantMeshDefinition).toHaveBeenCalledWith("visuals-session", materialPath));

    fireEvent.contextMenu(materialRow);
    expect(screen.queryByRole("button", { name: "Open In New AssetEd Tab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open In Existing AssetEd Tab" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy Name to Clipboard" }));
    expect(putPathInClipboard).toHaveBeenCalledWith("example.xml.material");

    fireEvent.contextMenu(materialRow);
    fireEvent.click(screen.getByRole("button", { name: "Copy Full Path to Clipboard" }));
    expect(putPathInClipboard).toHaveBeenCalledWith(materialPath);
  });

  it("offers recursive isolated extraction only from unit rows", async () => {
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          isVisualsSortByCultureEnabled: false,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    const unitRow = await screen.findByText("Empire Lord");
    fireEvent.contextMenu(unitRow);

    expect(screen.getByRole("button", { name: "Extract isolated" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Extract isolated" }));

    await waitFor(() =>
      expect(extractVisualsFilesToDirectory).toHaveBeenCalledWith(
        "visuals-session",
        "/tmp/visuals-extract",
        ["variantmeshes\\emp_lord.variantmeshdefinition"],
        true,
        undefined,
        false,
        true,
      ),
    );
  });

  it("offers DDS copy and extraction actions without AssetEditor actions", async () => {
    const ddsPath = "textures\\example.dds";
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 1,
      results: [{ path: ddsPath, ext: "dds" }],
    });

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));
    const ddsRow = await screen.findByText(ddsPath);

    fireEvent.contextMenu(ddsRow);
    expect(screen.queryByRole("button", { name: "Open In New AssetEd Tab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Extract isolated" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extract (with folders)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy Full Path to Clipboard" }));
    expect(putPathInClipboard).toHaveBeenCalledWith(ddsPath);

    fireEvent.contextMenu(ddsRow);
    fireEvent.click(screen.getByRole("button", { name: "Extract (flat)" }));
    await waitFor(() =>
      expect(extractVisualsFilesToDirectory).toHaveBeenCalledWith(
        "visuals-session",
        "/tmp/visuals-extract",
        [ddsPath],
        false,
        undefined,
      ),
    );
  });

  it("extracts all actionable source links from the source editor context menu", async () => {
    const modelPath = "models\\example.wsmodel";
    const sourceText = [
      '<model mesh="models\\example.rigid_model_v2" />',
      '<texture path="textures\\example.dds" />',
      '<material path="materials\\example.xml.material" />',
    ].join("\n");
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 1,
      results: [{ path: modelPath, ext: "wsmodel" }],
    });
    readVariantMeshDefinition.mockResolvedValue({
      success: true,
      text: sourceText,
      resolved: { packPath: "/mods/example.pack", fileName: modelPath },
    });

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));
    const modelRow = await screen.findByText(modelPath);
    fireEvent.doubleClick(modelRow);
    await waitFor(() => expect(readVariantMeshDefinition).toHaveBeenCalledWith("visuals-session", modelPath));

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    const sourceEditor = document.querySelector("pre");
    expect(sourceEditor).not.toBeNull();
    fireEvent.contextMenu(sourceEditor!);
    fireEvent.click(screen.getByRole("button", { name: "Extract all (with folders)" }));

    await waitFor(() =>
      expect(extractVisualsFilesToDirectory).toHaveBeenCalledWith(
        "visuals-session",
        "/tmp/visuals-extract",
        ["models\\example.rigid_model_v2", "textures\\example.dds", "materials\\example.xml.material"],
        true,
        "/mods/example.pack",
      ),
    );
  });

  it("offers commontextures-free extraction variants when the source references commontextures", async () => {
    const modelPath = "models\\example.wsmodel";
    const commonTexturePath = "commontextures\\example.dds";
    readVariantMeshDefinition.mockResolvedValue({
      success: true,
      text: [`<model mesh="${modelPath}" />`, `<texture path="${commonTexturePath}" />`].join("\n"),
      resolved: { packPath: "/mods/example.pack", fileName: modelPath },
    });

    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          currentPreset: { ...initialState.currentPreset, mods: [] },
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <VisualsTab />
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));
    const modelRow = await screen.findByText(modelPath);
    fireEvent.doubleClick(modelRow);
    await waitFor(() => expect(readVariantMeshDefinition).toHaveBeenCalledWith("visuals-session", modelPath));

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    fireEvent.contextMenu(document.querySelector("pre")!);

    expect(screen.getByRole("button", { name: "Extract all (with folder, no commontextures)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extract all (flat, not commontextures)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Extract all (with folder, no commontextures)" }));
    await waitFor(() =>
      expect(extractVisualsFilesToDirectory).toHaveBeenCalledWith(
        "visuals-session",
        "/tmp/visuals-extract",
        [modelPath, commonTexturePath],
        true,
        "/mods/example.pack",
        true,
      ),
    );

    fireEvent.contextMenu(document.querySelector("pre")!);
    fireEvent.click(screen.getByRole("button", { name: "Extract all (flat, not commontextures)" }));
    await waitFor(() =>
      expect(extractVisualsFilesToDirectory).toHaveBeenCalledWith(
        "visuals-session",
        "/tmp/visuals-extract",
        [modelPath, commonTexturePath],
        false,
        "/mods/example.pack",
        true,
      ),
    );
  });

  it("defers hidden mod-data refreshes and remeasures when the tab becomes visible", async () => {
    const refreshedUnits = [{ ...units[0], localizedName: "Refreshed Lord" }];
    getVisualsUnitsData
      .mockReset()
      .mockResolvedValueOnce({ success: true, sessionId: "visuals-session", units })
      .mockResolvedValueOnce({ success: true, sessionId: "visuals-session", units: refreshedUnits });
    const mod = { name: "example.pack", path: "/mods/example.pack", isEnabled: true } as Mod;
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          isVisualsSortByCultureEnabled: false,
          currentPreset: { ...initialState.currentPreset, mods: [mod] },
        },
      },
    });

    const rendered = render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <div>
            <VisualsTab isActive />
          </div>
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(getVisualsUnitsData).toHaveBeenCalledTimes(1));
    rendered.rerender(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <div className="hidden">
            <VisualsTab isActive={false} />
          </div>
        </localizationContext.Provider>
      </Provider>,
    );
    act(() => store.dispatch(setIsModEnabled({ mod, isEnabled: false })));
    expect(getVisualsUnitsData).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <div>
            <VisualsTab isActive />
          </div>
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(getVisualsUnitsData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Refreshed Lord")).toBeInTheDocument());
  });
});
