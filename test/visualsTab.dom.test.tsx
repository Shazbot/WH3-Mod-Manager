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

const previewProps = vi.hoisted(() => ({ current: {} as Record<string, any> }));
vi.mock("../src/components/VisualsModelPreview", () => ({
  default: (props: Record<string, unknown>) => {
    previewProps.current = props;
    return <div data-testid="visuals-model-preview" />;
  },
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
const getVisualsUnitParts = vi.fn();
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
    getVisualsUnitParts.mockReset().mockResolvedValue({ success: true, units: {} });
    readVariantMeshDefinition.mockReset();
    putPathInClipboard.mockReset();
    selectDirectory.mockReset().mockResolvedValue("/tmp/visuals-extract");
    extractVisualsFilesToDirectory.mockReset().mockResolvedValue({ success: true, writtenCount: 1, skipped: [] });
    window.api = {
      ...window.api,
      getVisualsUnitsData,
      getVisualsUnitParts,
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

  it("lists mount variants under a selected hero and switches visual parts", async () => {
    const hero = (unitKey: string, vmd: string) => ({
      ...units[0],
      unitKey,
      localizedName: `Hero ${unitKey}`,
      variantMeshPath: vmd,
      caste: "hero",
    });
    getVisualsUnitsData.mockResolvedValue({
      success: true,
      sessionId: "visuals-session",
      units: [
        hero("karl_0", "variantmeshes\\foot.variantmeshdefinition"),
        hero("karl_1", "variantmeshes\\mounted.variantmeshdefinition"),
        hero("karl_2", "variantmeshes\\mounted.variantmeshdefinition"),
      ],
    });
    const rider = {
      role: "rider",
      label: "Rider",
      variantMeshPath: "variantmeshes\\mounted.variantmeshdefinition",
      animationProfile: "rider",
    };
    const mount = {
      role: "mount",
      label: "Mount",
      variantMeshPath: "variantmeshes\\horse.variantmeshdefinition",
      animationProfile: "ground",
    };
    getVisualsUnitParts.mockResolvedValue({
      success: true,
      units: {
        karl_0: { mountGroup: "karl_0", parts: [] },
        karl_1: { mountName: "Horse", mountGroup: "karl_0", parts: [rider, mount] },
        karl_2: {
          mountName: "Pegasus",
          mountGroup: "karl_0",
          parts: [rider, { ...mount, variantMeshPath: "variantmeshes\\pegasus.variantmeshdefinition" }],
        },
      },
    });
    readVariantMeshDefinition.mockResolvedValue({ success: true, text: "<xml/>", resolved: {} });
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          isFeaturesForModdersEnabled: true,
          isVisualsHideDuplicatesEnabled: true,
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

    await screen.findByRole("button", { name: "Human (3)" }).catch(() => undefined);
    fireEvent.change(await screen.findByLabelText("Unit filter (regex)"), { target: { value: "Hero" } });
    fireEvent.click(await screen.findByText("Hero karl_1"));

    expect(await screen.findByText("Horse")).toBeInTheDocument();
    expect(screen.getByText("Pegasus")).toBeInTheDocument();
    const select = await screen.findByLabelText("Visual part");
    fireEvent.change(select, { target: { value: "variantmeshes\\horse.variantmeshdefinition" } });
    await waitFor(() =>
      expect(readVariantMeshDefinition).toHaveBeenLastCalledWith(
        "visuals-session",
        "variantmeshes\\horse.variantmeshdefinition",
      ),
    );
    await waitFor(() => expect(previewProps.current.animationProfile).toBe("ground"));

    // A mount sub-row opens the mount itself, and the part select follows it.
    fireEvent.click(screen.getByText("Pegasus"));
    await waitFor(() =>
      expect(readVariantMeshDefinition).toHaveBeenLastCalledWith(
        "visuals-session",
        "variantmeshes\\pegasus.variantmeshdefinition",
      ),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Visual part") as HTMLSelectElement).value).toBe(
        "variantmeshes\\pegasus.variantmeshdefinition",
      ),
    );
  });

  it("lists the visual parts of a selected regular unit as sub-rows", async () => {
    getVisualsUnitsData.mockResolvedValue({
      success: true,
      sessionId: "visuals-session",
      units: [
        {
          ...units[0],
          unitKey: "cannon",
          localizedName: "Great Cannon",
          variantMeshPath: "variantmeshes\\crew.variantmeshdefinition",
          caste: "war_machine",
        },
      ],
    });
    getVisualsUnitParts.mockResolvedValue({
      success: true,
      units: {
        cannon: {
          parts: [
            {
              role: "crew",
              label: "Crew",
              variantMeshPath: "variantmeshes\\crew.variantmeshdefinition",
              animationProfile: "ground",
            },
            {
              role: "engine",
              label: "Engine",
              variantMeshPath: "variantmeshes\\cannon.variantmeshdefinition",
              animationProfile: "ground",
            },
          ],
        },
      },
    });
    readVariantMeshDefinition.mockResolvedValue({ success: true, text: "<xml/>", resolved: {} });
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

    fireEvent.change(await screen.findByLabelText("Unit filter (regex)"), { target: { value: "Cannon" } });
    fireEvent.click(await screen.findByText("Great Cannon"));

    // The part select carries the same labels, so only the list's sub-rows are matched.
    const subRow = (name: string) =>
      screen.getAllByRole("option", { name }).find((element) => element.tagName !== "OPTION")!;
    await waitFor(() => expect(subRow("Engine")).toBeDefined());
    expect(subRow("Crew")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(subRow("Engine"));
    await waitFor(() =>
      expect(readVariantMeshDefinition).toHaveBeenLastCalledWith(
        "visuals-session",
        "variantmeshes\\cannon.variantmeshdefinition",
      ),
    );
    await waitFor(() => expect(subRow("Engine")).toHaveAttribute("aria-selected", "true"));
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

  it("keeps source tabs across main-tab switches while unloading the preview", async () => {
    const modelPath = "models\\example.wsmodel";
    const sourceText = `<model mesh="models\\example.rigid_model_v2" />`;
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

    const rendered = render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <div>
            <VisualsTab isActive />
          </div>
        </localizationContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));
    const modelRow = await screen.findByText(modelPath);
    fireEvent.doubleClick(modelRow);
    await waitFor(() => expect(readVariantMeshDefinition).toHaveBeenCalledWith("visuals-session", modelPath));
    await waitFor(() => expect(document.querySelector("pre")?.textContent).toContain(sourceText));

    expect(screen.getByTestId("visuals-model-preview")).toBeInTheDocument();
    const preview = screen.getByTestId("visuals-model-preview");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    // Source mode only hides the preview, so switching back reuses the loaded model.
    expect(screen.getByTestId("visuals-model-preview")).toBe(preview);
    expect(preview.parentElement).toHaveClass("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("visuals-model-preview")).toBe(preview);
    expect(preview.parentElement).not.toHaveClass("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));

    rendered.rerender(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <div className="hidden">
            <VisualsTab isActive={false} />
          </div>
        </localizationContext.Provider>
      </Provider>,
    );
    expect(document.querySelector("pre")?.textContent).toContain(sourceText);

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
    expect(document.querySelector("pre")?.textContent).toContain(sourceText);
    expect(screen.getByTestId("visuals-model-preview").parentElement).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("visuals-model-preview").parentElement).not.toHaveClass("hidden");
  });

  it("shows a slot tree beside the preview and hides components from the eye toggles", async () => {
    const modelPath = "models\\example.wsmodel";
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 1,
      results: [{ path: modelPath, ext: "wsmodel" }],
    });
    readVariantMeshDefinition.mockResolvedValue({
      success: true,
      text: "<model />",
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
          <VisualsTab isActive />
        </localizationContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Human (1)" })).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Show all visual files"));
    fireEvent.doubleClick(await screen.findByText(modelPath));
    await waitFor(() => expect(readVariantMeshDefinition).toHaveBeenCalledWith("visuals-session", modelPath));

    fireEvent.click(screen.getByRole("button", { name: "Preview + Tree" }));
    expect(screen.getByText("Loading slots…")).toBeInTheDocument();
    const slot = (
      path: string,
      name: string,
      labels: string[],
      parent?: { slotPath: string; choiceIndex: number },
    ) => ({
      slotPath: path,
      name,
      label: name,
      defaultChoiceIndex: 0,
      parent,
      choices: labels.map((label, index) => ({ index, key: `${path}/choice[${index}]`, label, kind: "inline" })),
    });
    act(() => {
      previewProps.current.onVariantStateChange({
        catalog: {
          assetPath: modelPath,
          combinationCount: 2,
          combinationCountCapped: false,
          diagnostics: [],
          slots: [slot("root/slot[0]", "helmet", ["Plain", "Crested"]), slot("root/slot[1]", "cape", ["Red", "Blue"])],
        },
        selections: {},
        renderedChoiceKeys: ["root/slot[0]/choice[0]", "root/slot[1]/choice[0]"],
      });
    });
    expect(screen.getByRole("separator", { name: "Resize preview and tree" })).toBeInTheDocument();
    expect(previewProps.current.hiddenComponentBindings).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Hide 1 · Plain" }));
    expect(previewProps.current.hiddenComponentBindings).toEqual(["root/slot[0]/choice[0]"]);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 · Plain" }));
    expect(previewProps.current.hiddenComponentBindings).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Hide 2 · Crested" }), { ctrlKey: true });
    expect(previewProps.current.hiddenComponentBindings).toEqual([
      "root/slot[0]/choice[0]",
      "root/slot[1]",
      "root/slot[1]/choice[0]",
      "root/slot[1]/choice[1]",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Hide 2 · Crested" }), { ctrlKey: true });
    expect(previewProps.current.hiddenComponentBindings).toEqual([]);

    fireEvent.click(screen.getByTitle(/^Crested - not shown in preview/));
    expect(previewProps.current.variantSelectionRequest.selections).toEqual([
      { slotPath: "root/slot[0]", choiceIndex: 1 },
    ]);
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

describe("VisualsTab tab navigation", () => {
  const pathA = "materials\\a.xml.material";
  const pathB = "materials\\b.xml.material";
  const pathC = "materials\\c.xml.material";
  const texts: Record<string, string> = {
    [pathA]: `<m path="${pathB}" />`,
    [pathB]: `<m path="${pathC}" />`,
    [pathC]: `<t path="textures\\c_diffuse.dds" />`,
  };

  const renderTab = async () => {
    getVisualsUnitsData.mockReset().mockResolvedValue({ success: true, sessionId: "visuals-session", units });
    searchVisualsFiles.mockReset().mockResolvedValue({
      success: true,
      total: 2,
      results: [
        { path: pathA, ext: "xml.material" },
        { path: pathC, ext: "xml.material" },
      ],
    });
    readVariantMeshDefinition.mockReset().mockImplementation(async (_session: string, path: string) => ({
      success: true,
      text: texts[path],
      resolved: { packPath: "/mods/example.pack", fileName: path },
    }));
    window.api = {
      ...window.api,
      getVisualsUnitsData,
      searchVisualsFiles,
      readVariantMeshDefinition,
    } as NonNullable<Window["api"]>;

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
  };

  const listRow = (path: string) =>
    screen.queryAllByText(path).find((element) => element.closest('[title^="Click to open"]')) ?? null;

  const openFromList = async (path: string) => {
    await waitFor(() => expect(listRow(path)).toBeTruthy());
    fireEvent.doubleClick(listRow(path)!);
    await waitFor(() => expect(readVariantMeshDefinition).toHaveBeenCalledWith("visuals-session", path));
  };

  const tabLabel = (name: string) => screen.getByText(name, { selector: "span" });
  const tabLabelsPresent = () =>
    ["a.xml.material", "b.xml.material", "c.xml.material"].filter((name) =>
      screen.queryByText(name, { selector: "span" }),
    );

  it("navigates links in place, shows breadcrumbs, and middle-click opens a new tab", async () => {
    await renderTab();
    await openFromList(pathA);

    fireEvent.click(await screen.findByRole("button", { name: pathB }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["b.xml.material"]));
    expect(screen.getByRole("button", { name: "a.xml.material" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "a.xml.material" }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["a.xml.material"]));

    fireEvent.mouseDown(await screen.findByRole("button", { name: pathB }), { button: 1 });
    fireEvent(
      await screen.findByRole("button", { name: pathB }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["a.xml.material", "b.xml.material"]));
  });

  it("goes back and forward with mouse buttons 3 and 4 within and across tabs", async () => {
    await renderTab();
    await openFromList(pathA);
    fireEvent.click(await screen.findByRole("button", { name: pathB }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["b.xml.material"]));

    const target = screen.getByRole("button", { name: pathC });
    fireEvent.mouseDown(target, { button: 3 });
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["a.xml.material"]));
    fireEvent.mouseDown(screen.getByRole("button", { name: pathB }), { button: 4 });
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["b.xml.material"]));

    await openFromList(pathC);
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["b.xml.material", "c.xml.material"]));
    fireEvent.mouseDown(document.querySelector("pre")!, { button: 3 });
    await waitFor(() => expect(tabLabel("b.xml.material")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: pathC })).toBeInTheDocument();
  });

  it("closes tabs with middle-click and the tab context menu", async () => {
    await renderTab();
    await openFromList(pathA);
    await openFromList(pathC);
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["a.xml.material", "c.xml.material"]));

    fireEvent.contextMenu(tabLabel("a.xml.material"));
    expect(screen.getByRole("button", { name: "Close all to the left" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close all to the right" }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["a.xml.material"]));

    fireEvent.contextMenu(tabLabel("a.xml.material"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual([]));

    await openFromList(pathA);
    fireEvent.mouseDown(tabLabel("a.xml.material"), { button: 1 });
    fireEvent(tabLabel("a.xml.material"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual([]));
  });

  it("carries the opener's trail into a middle-clicked tab and switches back to the opener", async () => {
    await renderTab();
    await openFromList(pathA);

    const pathBLink = await screen.findByRole("button", { name: pathB });
    fireEvent.mouseDown(pathBLink, { button: 1 });
    fireEvent(pathBLink, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["a.xml.material", "b.xml.material"]));

    const originCrumb = await screen.findByTitle(/switch to the tab this was opened from/);
    expect(originCrumb).toHaveTextContent("a.xml.material");
    fireEvent.click(originCrumb);
    await waitFor(() => expect(screen.queryByLabelText("Tab history")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: pathB })).toBeInTheDocument();

    fireEvent.click(tabLabel("b.xml.material"));
    expect(await screen.findByTitle(/switch to the tab this was opened from/)).toBeInTheDocument();
    fireEvent.mouseDown(tabLabel("a.xml.material"), { button: 1 });
    fireEvent(tabLabel("a.xml.material"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    const closedCrumb = await screen.findByTitle(/the tab this was opened from is closed/);
    expect(closedCrumb).toBeDisabled();
  });

  it("previews a hovered DDS path from the source", async () => {
    await renderTab();
    await openFromList(pathC);

    const ddsPath = await screen.findByText("textures\\c_diffuse.dds", { selector: "span" });
    fireEvent.mouseEnter(ddsPath);
    const preview = await screen.findByRole("tooltip", { name: "Preview of textures\\c_diffuse.dds" });
    const image = preview.querySelector("img");
    expect(image?.getAttribute("src")).toBe(
      `whmm://visuals-dds/visuals-session/${encodeURIComponent("textures\\c_diffuse.dds")}?pack=${encodeURIComponent("/mods/example.pack")}`,
    );
    fireEvent.mouseLeave(ddsPath);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("clears the tab's breadcrumbs when a list click replaces its file", async () => {
    await renderTab();
    await openFromList(pathA);

    fireEvent.click(await screen.findByRole("button", { name: pathB }));
    expect(await screen.findByLabelText("Tab history")).toBeInTheDocument();

    fireEvent.click(listRow(pathC)!);
    await waitFor(() => expect(tabLabelsPresent()).toEqual(["c.xml.material"]));
    expect(screen.queryByLabelText("Tab history")).not.toBeInTheDocument();
  });
});
