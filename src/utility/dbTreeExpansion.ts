import type { INode } from "react-accessible-treeview";

/**
 * Expand every table group on open while the list is short enough to take in at a glance. Past this
 * an all-expanded tree is longer than the panel and harder to scan than the collapsed one.
 */
export const MAX_AUTO_EXPANDED_DB_TABLES = 10;

/**
 * The one table inside a group, when that is all the group holds.
 *
 * Expanding such a group is only ever a step towards opening its table, so the caller can skip the
 * second click. Undefined for anything else - several children, or a single child that is itself a
 * group and so has nothing to open.
 */
export const getLoneTableToOpen = (
  element: Pick<INode, "children">,
  nodeById: Map<INode["id"], INode>,
): INode | undefined => {
  if (element.children.length !== 1) return undefined;

  const onlyChild = nodeById.get(element.children[0]);
  if (!onlyChild || onlyChild.children.length > 0) return undefined;
  return onlyChild;
};

/** Table groups to expand on open, or none when there are too many to be worth it. */
export const getAutoExpandedDBGroupIds = (data: INode[]) => {
  // flattenTree puts the synthetic root first; its children are the table groups.
  const groupIds = data
    .filter((node) => node.parent === data[0]?.id && node.children.length > 0)
    .map((node) => node.id);
  return groupIds.length <= MAX_AUTO_EXPANDED_DB_TABLES ? groupIds : [];
};
