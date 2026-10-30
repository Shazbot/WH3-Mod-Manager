import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss, { type Root } from "postcss";
import tailwind from "@tailwindcss/postcss";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let css: Root;
const declaration = (selector: string, property: string) => {
  const values: string[] = [];
  css.walkRules((rule) => {
    let resolved = rule.selector;
    let parent = rule.parent;
    while (resolved.includes("&") && parent) {
      if (parent.type === "rule") resolved = resolved.replaceAll("&", parent.selector);
      parent = parent.parent;
    }
    if (resolved === selector)
      rule.walkDecls(property, (decl) => {
        values.push(decl.value);
      });
  });
  return values.at(-1);
};

beforeAll(async () => {
  const input = path.join(projectRoot, "src/index.css");
  const result = await postcss([tailwind({ base: projectRoot })]).process(
    (await fs.readFile(input, "utf8")) + '\n@source inline("bg-background text-foreground");',
    { from: input },
  );
  css = result.root;
}, 15000);

describe("generated Tailwind styles", () => {
  it("preserves the existing Flowbite action and dark surface colors", () => {
    expect(declaration(".bg-blue-700", "background-color")?.toLowerCase()).toBe("#1a56db");
    expect(declaration(".bg-green-500", "background-color")?.toLowerCase()).toBe("#0e9f6e");
    expect(declaration(".bg-gray-700", "background-color")?.toLowerCase()).toBe("#374151");
  });

  it("resolves semantic colors and radii at the element using them", () => {
    expect(declaration(".bg-background", "background-color")).toBe("hsl(var(--background))");
    expect(declaration(".text-foreground", "color")).toBe("hsl(var(--foreground))");
    expect(declaration(".rounded-lg", "border-radius")).toBe("var(--radius)");
    expect(declaration(".rounded-sm", "border-radius")).toBe("calc(var(--radius) - 4px)");
  });

  it("generates translucent disabled controls and modal backdrops", () => {
    expect(declaration(".bg-green-500\\/50", "background-color")).toContain("50%");
    expect(declaration(".text-white\\/50", "color")).toContain("50%");
    expect(declaration(".bg-black\\/50", "background-color")).toContain("50%");
  });

  it("keeps scrollbar colors available to Chromium pseudo-elements", () => {
    expect(declaration(".scrollbar", "--scrollbar-thumb")).toBe("var(--tw-scrollbar-thumb)");
    expect(declaration(".scrollbar", "--scrollbar-track")).toBe("var(--tw-scrollbar-track)");
    expect(declaration(".scrollbar::-webkit-scrollbar", "width")).toBe("var(--scrollbar-width, 16px)");
  });
});
