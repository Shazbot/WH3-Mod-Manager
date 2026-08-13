import type { NodeTypeSection } from "./nodeRegistry";

/** Adds a node type to the favorites, or removes it if it is already there. */
export const toggleFavoriteNodeType = (favorites: FlowNodeType[], nodeType: FlowNodeType): FlowNodeType[] =>
  favorites.includes(nodeType) ? favorites.filter((favorite) => favorite !== nodeType) : [...favorites, nodeType];

/**
 * Moves a favorite to where it was dropped, keeping the rest in order.
 *
 * Insertion is direction-aware, which is what makes a drag land where the user let go: dragging an
 * entry down puts it after the one it was dropped on, dragging up puts it before.
 */
export const moveFavoriteNodeType = (
  favorites: FlowNodeType[],
  dragged: FlowNodeType,
  target: FlowNodeType,
): FlowNodeType[] => {
  if (dragged === target) return favorites;

  const fromIndex = favorites.indexOf(dragged);
  const toIndex = favorites.indexOf(target);
  if (fromIndex === -1 || toIndex === -1) return favorites;

  const withoutDragged = favorites.filter((favorite) => favorite !== dragged);
  const targetIndex = withoutDragged.indexOf(target);
  withoutDragged.splice(fromIndex < toIndex ? targetIndex + 1 : targetIndex, 0, dragged);

  return withoutDragged;
};

/**
 * Puts a Favorites section in front of the usual ones, in the user's own order.
 *
 * Returns the sections untouched when nothing is favorited, so the section only exists once it has
 * something in it. A favorite whose node type no longer exists is skipped rather than shown broken.
 */
export const withFavoritesSection = (
  sections: NodeTypeSection[],
  favorites: FlowNodeType[],
  favoritesTitle: string,
): NodeTypeSection[] => {
  if (favorites.length === 0) return sections;

  const nodeTypesByType = new Map(sections.flatMap((section) => section.nodes).map((node) => [node.type, node]));
  const favoriteNodes = favorites
    .map((favorite) => nodeTypesByType.get(favorite))
    .filter((node): node is NodeTypeSection["nodes"][number] => node !== undefined);

  if (favoriteNodes.length === 0) return sections;

  return [{ title: favoritesTitle, nodes: favoriteNodes }, ...sections];
};
