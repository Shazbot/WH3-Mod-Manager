import type { INode } from "react-accessible-treeview";

/**
 * Expand every table group on open while the list is short enough to take in at a glance. Past this
 * an all-expanded tree is longer than the panel and harder to scan than the collapsed one.
 */
export const MAX_AUTO_EXPANDED_DB_TABLES = 10;

/** Table groups to expand on open, or none when there are too many to be worth it. */
export const getAutoExpandedDBGroupIds = (data: INode[]) => {
  // flattenTree puts the synthetic root first; its children are the table groups.
  const groupIds = data
    .filter((node) => node.parent === data[0]?.id && node.children.length > 0)
    .map((node) => node.id);
  return groupIds.length <= MAX_AUTO_EXPANDED_DB_TABLES ? groupIds : [];
};
