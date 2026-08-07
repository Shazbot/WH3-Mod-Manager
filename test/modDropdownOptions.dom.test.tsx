import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import appReducer from "../src/appSlice";
import ModDropdownOptions from "../src/components/ModDropdownOptions";
import initialState from "../src/initialAppState";
import localizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";

vi.mock("../src/components/RenameModal", () => ({
  default: () => null,
}));

vi.mock("flowbite-react", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const createMod = (overrides: Partial<Mod>): Mod => ({
  name: "example.pack",
  humanName: "Example Mod",
  path: "/workshop/123/example.pack",
  imgPath: "",
  workshopId: "123",
  isEnabled: true,
  modDirectory: "/workshop/123",
  isInData: false,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
  ...overrides,
});

describe("ModDropdownOptions", () => {
  it("resubscribes the matching Workshop mod when opened for a data copy", () => {
    const workshopMod = createMod({});
    const dataMod = createMod({
      path: "/game/data/example.pack",
      modDirectory: "/game/data",
      isInData: true,
      sourceId: "data",
      sourceKind: "data",
    });
    const forceResubscribeMods = vi.fn();
    window.api = {
      ...window.api,
      forceResubscribeMods,
    } as NonNullable<Window["api"]>;
    const store = configureStore({
      reducer: { app: appReducer },
      preloadedState: {
        app: {
          ...initialState,
          allMods: [dataMod, workshopMod],
        },
      },
    });

    render(
      <Provider store={store}>
        <localizationContext.Provider value={enTranslation}>
          <ModDropdownOptions mod={dataMod} mods={[dataMod, workshopMod]} />
        </localizationContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getByText(enTranslation.forceResubscribe));

    expect(forceResubscribeMods).toHaveBeenCalledWith([workshopMod]);
  });
});
