import { describe, expect, it } from "vitest";

import {
  moveFavoriteNodeType,
  toggleFavoriteNodeType,
  withFavoritesSection,
} from "../../src/nodeGraph/favorites";
import type { NodeTypeSection } from "../../src/nodeGraph/nodeRegistry";

const createNode = (type: string) =>
  ({ type, label: type, description: `${type} description` }) as NodeTypeSection["nodes"][number];

const sections: NodeTypeSection[] = [
  { title: "Pack Files", nodes: [createNode("allenabledmods"), createNode("packedfiles")] },
  { title: "Table Operations", nodes: [createNode("deepclone"), createNode("removetables")] },
];

describe("toggleFavoriteNodeType", () => {
  it("adds a node type at the end", () => {
    expect(toggleFavoriteNodeType(["deepclone" as never], "filter" as never)).toEqual([
      "deepclone",
      "filter",
    ]);
  });

  it("removes one that is already favorited", () => {
    expect(toggleFavoriteNodeType(["deepclone", "filter"] as never[], "deepclone" as never)).toEqual([
      "filter",
    ]);
  });

  it("does not mutate the list it was given", () => {
    const favorites = ["deepclone"] as never[];
    toggleFavoriteNodeType(favorites, "filter" as never);
    expect(favorites).toEqual(["deepclone"]);
  });
});

describe("moveFavoriteNodeType", () => {
  const favorites = ["a", "b", "c", "d"] as never[];

  it("moves an entry down to where it was dropped", () => {
    // Removing the dragged entry first is what makes this land on c rather than one slot short.
    expect(moveFavoriteNodeType(favorites, "a" as never, "c" as never)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an entry up to where it was dropped", () => {
    expect(moveFavoriteNodeType(favorites, "d" as never, "b" as never)).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the order alone when dropped on itself", () => {
    expect(moveFavoriteNodeType(favorites, "b" as never, "b" as never)).toEqual(favorites);
  });

  it("ignores a drag or target that is not in the list", () => {
    expect(moveFavoriteNodeType(favorites, "z" as never, "b" as never)).toEqual(favorites);
    expect(moveFavoriteNodeType(favorites, "a" as never, "z" as never)).toEqual(favorites);
  });

  it("does not mutate the list it was given", () => {
    const original = [...favorites];
    moveFavoriteNodeType(favorites, "a" as never, "c" as never);
    expect(favorites).toEqual(original);
  });
});

describe("withFavoritesSection", () => {
  it("adds nothing while there are no favorites", () => {
    expect(withFavoritesSection(sections, [], "Favorites")).toBe(sections);
  });

  it("puts the favorites section first", () => {
    const result = withFavoritesSection(sections, ["deepclone"] as never[], "Favorites");

    expect(result[0].title).toBe("Favorites");
    expect(result[0].nodes.map((node) => node.type)).toEqual(["deepclone"]);
  });

  it("keeps the user's order rather than the registry's", () => {
    const result = withFavoritesSection(
      sections,
      ["removetables", "allenabledmods"] as never[],
      "Favorites",
    );

    expect(result[0].nodes.map((node) => node.type)).toEqual(["removetables", "allenabledmods"]);
  });

  it("leaves the original sections in place below", () => {
    const result = withFavoritesSection(sections, ["deepclone"] as never[], "Favorites");

    expect(result.slice(1)).toEqual(sections);
  });

  it("skips a favorite whose node type no longer exists", () => {
    const result = withFavoritesSection(sections, ["deepclone", "removed_node"] as never[], "Favorites");

    expect(result[0].nodes.map((node) => node.type)).toEqual(["deepclone"]);
  });

  it("adds no section when every favorite has gone", () => {
    expect(withFavoritesSection(sections, ["removed_node"] as never[], "Favorites")).toBe(sections);
  });
});
