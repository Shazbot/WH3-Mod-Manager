import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import appReducer from "../src/appSlice";
import initialState from "../src/initialAppState";
import LoadOrderRulesTab from "../src/components/loadOrderRules/LoadOrderRulesTab";
import LocalizationContext from "../src/localizationContext";
import enTranslation from "../locales/en/translation.json";
import type { LoadOrderRule } from "../src/loadOrderRules";

const createMod = (name: string, isEnabled: boolean): Mod => ({
  name: `${name}.pack`,
  humanName: `${name} human name`,
  path: `/mods/${name}.pack`,
  imgPath: "",
  workshopId: name,
  isEnabled,
  modDirectory: "/mods",
  isInData: true,
  loadOrder: undefined,
  author: "",
  isDeleted: false,
  isMovie: false,
  size: 1,
  isSymbolicLink: false,
  tags: [],
  reqModIdToName: [],
});

const renderTab = (mods: Mod[], loadOrderRules: LoadOrderRule[] = []) => {
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: {
        ...initialState,
        loadOrderRules,
        currentPreset: { ...initialState.currentPreset, mods },
      },
    },
  });

  return render(
    <LocalizationContext.Provider value={enTranslation}>
      <Provider store={store}>
        <LoadOrderRulesTab />
      </Provider>
    </LocalizationContext.Provider>,
  );
};

describe("load order rules panel", () => {
  it("puts enabled mods without rules before disabled mods without rules", () => {
    const { container } = renderTab([createMod("disabled-first", false), createMod("enabled-last", true)]);
    const aside = container.querySelector("aside");

    expect(aside).not.toBeNull();
    expect(Array.from(aside!.querySelectorAll(".sticky")).map((header) => header.textContent)).toEqual([
      "Enabled without rules (1)",
      "Disabled without rules (1)",
    ]);
    expect(
      Array.from(aside!.querySelectorAll<HTMLElement>('[id^="load-order-rules-mod-"]')).map((row) => row.id),
    ).toEqual(["load-order-rules-mod-enabled-last.pack", "load-order-rules-mod-disabled-first.pack"]);
  });

  it("describes overrides using load timing", () => {
    const { container } = renderTab(
      [createMod("before", true), createMod("after", true)],
      [{ before: "before.pack", after: "after.pack", subjectPackName: "before.pack" }],
    );

    fireEvent.click(container.ownerDocument.getElementById("load-order-rules-mod-before.pack") as HTMLElement);

    expect(
      screen.getByText(
        "This mod appears higher in the visible mod list (with a lower load-order number), so it overrides those mods.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Those mods appear higher in the visible mod list (with lower load-order numbers), so they override this mod.",
      ),
    ).toBeInTheDocument();
  });
});
