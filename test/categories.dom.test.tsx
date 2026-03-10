import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import Categories from "../src/components/Categories";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";

vi.mock("../src/components/EditCategoriesModal", () => ({
  default: () => null,
}));

vi.mock("../src/components/ModDropdownOptions", () => ({
  default: () => null,
}));

vi.mock("flowbite-react", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("react-select/creatable", () => ({
  default: () => <div data-testid="category-creatable" />,
}));

const createMod = (overrides: Partial<Mod> & Pick<Mod, "name" | "path">): Mod => ({
  humanName: "",
  name: overrides.name,
  path: overrides.path,
  imgPath: "",
  workshopId: overrides.path,
  isEnabled: false,
  modDirectory: "",
  isInData: false,
  lastChanged: undefined,
  lastChangedLocal: undefined,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  dependencyPacks: undefined,
  reqModIdToName: undefined,
  size: 0,
  mergedModsData: undefined,
  subbedTime: undefined,
  isSymbolicLink: false,
  categories: [],
  tags: [],
  isInModding: false,
  ...overrides,
});

const renderCategories = (mods?: Mod[]) => {
  const defaultMods = [
    createMod({
      name: "mod-one.pack",
      path: "/mods/mod-one.pack",
      humanName: "Mod One",
      categories: ["Alpha"],
      isEnabled: false,
    }),
    createMod({
      name: "mod-two.pack",
      path: "/mods/mod-two.pack",
      humanName: "Mod Two",
      categories: ["Alpha"],
      isEnabled: false,
    }),
    createMod({
      name: "mod-three.pack",
      path: "/mods/mod-three.pack",
      humanName: "Mod Three",
      categories: ["Beta"],
      isEnabled: true,
    }),
  ];

  const allMods = mods ?? defaultMods;
  const categoryNames = Array.from(
    new Set(
      allMods.flatMap((mod) => {
        if (!mod.categories || mod.categories.length === 0) return ["Uncategorized"];
        return mod.categories;
      }),
    ),
  );
  const store = configureStore({
    reducer: {
      app: appReducer,
    },
    preloadedState: {
      app: {
        ...initialState,
        categories: categoryNames,
        categoryColors: {
          Alpha: "blue",
          Beta: "red",
        },
        currentPreset: {
          ...initialState.currentPreset,
          mods: allMods,
        },
      },
    },
  });

  render(
    <Provider store={store}>
      <localizationContext.Provider value={enTranslation}>
        <Categories />
      </localizationContext.Provider>
    </Provider>,
  );

  return { store };
};

const getRowOrder = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "");

describe("Categories", () => {
  it("renders grouped rows and collapses and expands categories", async () => {
    const user = userEvent.setup();
    renderCategories();

    expect(await screen.findByLabelText("Toggle category Alpha")).toBeInTheDocument();
    expect(screen.getByText("Mod One")).toBeInTheDocument();
    expect(screen.getByText("Mod Two")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse All Alpha" }));

    await waitFor(() => {
      expect(screen.queryByText("Mod One")).not.toBeInTheDocument();
      expect(screen.queryByText("Mod Two")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Expand All Alpha" }));

    expect(await screen.findByText("Mod One")).toBeInTheDocument();
    expect(screen.getByText("Mod Two")).toBeInTheDocument();
  });

  it("selects visible children from a category row and toggles them with space", async () => {
    const user = userEvent.setup();
    const { store } = renderCategories();

    const alphaRow = (await screen.findByLabelText("Toggle category Alpha")).closest('[role="row"]');
    expect(alphaRow).not.toBeNull();

    await user.click(within(alphaRow!).getByText("Alpha"));
    await user.keyboard(" ");

    await waitFor(() => {
      const mods = store.getState().app.currentPreset.mods;
      expect(mods.find((mod) => mod.name === "mod-one.pack")?.isEnabled).toBe(true);
      expect(mods.find((mod) => mod.name === "mod-two.pack")?.isEnabled).toBe(true);
      expect(mods.find((mod) => mod.name === "mod-three.pack")?.isEnabled).toBe(true);
    });
  });

  it("toggles all mods in a category from the category checkbox", async () => {
    const user = userEvent.setup();
    const { store } = renderCategories();

    await user.click(await screen.findByLabelText("Toggle category Alpha"));

    await waitFor(() => {
      const mods = store.getState().app.currentPreset.mods;
      expect(mods.find((mod) => mod.name === "mod-one.pack")?.isEnabled).toBe(true);
      expect(mods.find((mod) => mod.name === "mod-two.pack")?.isEnabled).toBe(true);
      expect(mods.find((mod) => mod.name === "mod-three.pack")?.isEnabled).toBe(true);
    });
  });

  it("removes a badge category from a mod row", async () => {
    const user = userEvent.setup();
    const { store } = renderCategories();

    const modOneRow = (await screen.findByText("Mod One")).closest('[role="row"]');
    expect(modOneRow).not.toBeNull();

    await user.click(within(modOneRow!).getByLabelText("Remove badge Alpha"));

    await waitFor(() => {
      const mod = store.getState().app.currentPreset.mods.find((iterMod) => iterMod.name === "mod-one.pack");
      expect(mod?.categories).toEqual([]);
    });
  });

  it("cycles enabled-column sorting within each category", async () => {
    const user = userEvent.setup();
    renderCategories([
      createMod({
        name: "alpha-mod.pack",
        path: "/mods/alpha-mod.pack",
        humanName: "Alpha Mod",
        categories: ["Alpha"],
        isEnabled: false,
      }),
      createMod({
        name: "beta-mod.pack",
        path: "/mods/beta-mod.pack",
        humanName: "Beta Mod",
        categories: ["Alpha"],
        isEnabled: true,
      }),
      createMod({
        name: "gamma-mod.pack",
        path: "/mods/gamma-mod.pack",
        humanName: "Gamma Mod",
        categories: ["Alpha"],
        isEnabled: false,
      }),
    ]);

    await screen.findByLabelText("Toggle category Alpha");

    expect(getRowOrder()).toEqual([
      "vAlpha",
      "Alpha ModAlpha",
      "Beta ModAlpha",
      "Gamma ModAlpha",
    ]);

    await user.click(screen.getByRole("button", { name: "Enabled" }));
    await waitFor(() => {
      expect(getRowOrder()).toEqual([
        "vAlpha",
        "Beta ModAlpha",
        "Alpha ModAlpha",
        "Gamma ModAlpha",
      ]);
    });

    await user.click(screen.getByRole("button", { name: "Enabled ↓" }));
    await waitFor(() => {
      expect(getRowOrder()).toEqual([
        "vAlpha",
        "Alpha ModAlpha",
        "Gamma ModAlpha",
        "Beta ModAlpha",
      ]);
    });

    await user.click(screen.getByRole("button", { name: "Enabled ↑" }));
    await waitFor(() => {
      expect(getRowOrder()).toEqual([
        "vAlpha",
        "Alpha ModAlpha",
        "Beta ModAlpha",
        "Gamma ModAlpha",
      ]);
    });
  });
});
