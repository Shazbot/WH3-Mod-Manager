import type { INode } from "react-accessible-treeview";

/**
 * Expand every table group on open while the list is short enough to take in at a glance. Past this
 * an all-expanded tree is longer than the panel and harder to scan than the collapsed one.
 */
export const MAX_AUTO_EXPANDED_DB_TABLES = 10;

/**
 * Branches on a path where every node has exactly one child.
 *
 * The clicked element is expanded by the tree itself. The returned ids are the branch children
 * that can be expanded without making a choice between siblings. A branch with several children
 * is left collapsed so the user can choose where to go next.
 */
export const getSingleChildBranchIds = (
  element: Pick<INode, "id" | "children">,
  nodeById: Map<INode["id"], INode>,
): INode["id"][] => {
  const branchIds: INode["id"][] = [];
  const visitedIds = new Set<INode["id"]>([element.id]);
  let currentNode: Pick<INode, "id" | "children"> = element;

  while (currentNode.children.length === 1) {
    const child = nodeById.get(currentNode.children[0]);
    if (!child || visitedIds.has(child.id) || child.children.length !== 1) break;

    branchIds.push(child.id);
    visitedIds.add(child.id);
    currentNode = child;
  }

  return branchIds;
};

/**
 * The table at the end of a single-child path, when that is all the group holds.
 *
 * Expanding such a group is only ever a step towards opening its table, so the caller can skip the
 * second click. Undefined for anything else - several children, or a path that ends at another
 * branch rather than a table.
 */
export const getLoneTableToOpen = (
  element: Pick<INode, "children">,
  nodeById: Map<INode["id"], INode>,
): INode | undefined => {
  let currentNode = element;
  let finalNode: INode | undefined;
  const visitedIds = new Set<INode["id"]>();

  while (currentNode.children.length === 1) {
    const onlyChild = nodeById.get(currentNode.children[0]);
    if (!onlyChild || visitedIds.has(onlyChild.id)) return undefined;
    visitedIds.add(onlyChild.id);
    finalNode = onlyChild;
    currentNode = onlyChild;
  }

  return finalNode?.children.length === 0 ? finalNode : undefined;
};

/** Table groups to expand on open, or none when there are too many to be worth it. */
export const getAutoExpandedDBGroupIds = (data: INode[]) => {
  // flattenTree puts the synthetic root first; its children are the table groups.
  const groupIds = data
    .filter((node) => node.parent === data[0]?.id && node.children.length > 0)
    .map((node) => node.id);
  return groupIds.length <= MAX_AUTO_EXPANDED_DB_TABLES ? groupIds : [];
};
