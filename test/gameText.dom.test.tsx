import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GameText, { parseGameText } from "../src/components/skillsViewer/GameText";

describe("game text markup", () => {
  it("styles nested bold, italic and colour tags", () => {
    expect(parseGameText("a [[b]]b [[col:yellow]]c[[/col]][[/b]] [[i]]d[[/i]]")).toEqual([
      { text: "a " },
      { text: "b ", bold: true, italic: false, colour: undefined },
      { text: "c", bold: true, italic: false, colour: "#FFB900" },
      { text: " " },
      { text: "d", bold: false, italic: true, colour: undefined },
    ]);
  });

  it("turns both an escaped and a real newline into a line break", () => {
    expect(parseGameText("a\\nb\nc")).toEqual([
      { text: "a" },
      { isBreak: true },
      { text: "b" },
      { isBreak: true },
      { text: "c" },
    ]);
  });

  it("keeps an image's tag and drops any text inside it", () => {
    expect(parseGameText("[[img:icon_hero]]x[[/img]]Hero")).toEqual([{ image: "icon_hero" }, { text: "Hero" }]);
  });

  it("keeps the text of unknown tags and ignores a stray closing tag", () => {
    expect(parseGameText("[[col:red]]a[[/b]]b[[/col]][[foo]]c[[/foo]]")).toEqual([
      { text: "a", bold: false, italic: false, colour: "#FF2D2D" },
      { text: "b", bold: false, italic: false, colour: "#FF2D2D" },
      { text: "c" },
    ]);
  });

  it("draws an inline icon only when its tag has a loaded image", () => {
    const { container } = render(
      <GameText
        text="[[img:icon_hero]][[/img]] and [[img:icon_missing]][[/img]]"
        taggedImages={{ icon_hero: "ui\\hero.png" }}
        icons={{ "ui\\hero.png": "hero-url" }}
      />,
    );

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("hero-url");
    expect(container.textContent).toBe(" and ");
  });
});
