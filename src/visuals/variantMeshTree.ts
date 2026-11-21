import type { VariantMeshCatalog, VariantMeshChoice, VariantMeshSelection, VariantMeshSlot } from "./variantMesh";

export interface VariantTreeChoiceNode {
  kind: "choice";
  /** The choice key, which is also the structural binding path of the component. */
  id: string;
  slotPath: string;
  choiceIndex: number;
  label: string;
  targetPath?: string;
  /** The choice points at a nested .variantmeshdefinition. */
  isReference: boolean;
  children: VariantTreeSlotNode[];
}

export interface VariantTreeSlotNode {
  kind: "slot";
  /** The slot's structural path. */
  id: string;
  label: string;
  choices: VariantTreeChoiceNode[];
}

export type VariantTreeNode = VariantTreeSlotNode | VariantTreeChoiceNode;

const isReferenceChoice = (choice: VariantMeshChoice) =>
  !!choice.targetPath?.toLowerCase().endsWith(".variantmeshdefinition");

/** Builds the slot -> choice -> nested slot tree from the flat catalog. */
export const buildVariantMeshTree = (catalog: VariantMeshCatalog): VariantTreeSlotNode[] => {
  const childrenByParent = new Map<string, VariantMeshSlot[]>();
  const roots: VariantMeshSlot[] = [];
  for (const slot of catalog.slots) {
    if (!slot.parent) {
      roots.push(slot);
      continue;
    }
    const key = `${slot.parent.slotPath}\n${slot.parent.choiceIndex}`;
    const list = childrenByParent.get(key);
    if (list) list.push(slot);
    else childrenByParent.set(key, [slot]);
  }
  const buildSlot = (slot: VariantMeshSlot): VariantTreeSlotNode => ({
    kind: "slot",
    id: slot.slotPath,
    label: slot.label || slot.name,
    choices: slot.choices.map((choice) => ({
      kind: "choice",
      id: choice.key,
      slotPath: slot.slotPath,
      choiceIndex: choice.index,
      label: choice.label,
      targetPath: choice.targetPath,
      isReference: isReferenceChoice(choice),
      children: (childrenByParent.get(`${slot.slotPath}\n${choice.index}`) ?? []).map(buildSlot),
    })),
  });
  return roots.map(buildSlot);
};

/** True when a component binding is the hidden id or sits below it. */
export const isBindingHidden = (binding: string, hiddenIds: readonly string[]): boolean =>
  hiddenIds.some((id) => binding === id || binding.startsWith(`${id}/`));

const walk = (nodes: readonly VariantTreeNode[], visit: (node: VariantTreeNode, ancestors: string[]) => void) => {
  const recurse = (node: VariantTreeNode, ancestors: string[]) => {
    visit(node, ancestors);
    const next = [...ancestors, node.id];
    if (node.kind === "slot") node.choices.forEach((choice) => recurse(choice, next));
    else node.children.forEach((slot) => recurse(slot, next));
  };
  nodes.forEach((node) => recurse(node, []));
};

/**
 * Ids to hide so only `id`, its ancestors and its descendants stay visible. When the current hidden set is already
 * that solo set, returns an empty set so a second solo click restores everything.
 */
export const soloTreeItem = (
  tree: readonly VariantTreeSlotNode[],
  id: string,
  currentHidden: readonly string[] = [],
): string[] => {
  const keep = new Set<string>();
  const all: string[] = [];
  walk(tree, (node, ancestors) => {
    all.push(node.id);
    if (node.id === id) {
      keep.add(node.id);
      ancestors.forEach((ancestor) => keep.add(ancestor));
    } else if (ancestors.includes(id)) keep.add(node.id);
  });
  if (!keep.has(id)) return [...currentHidden];
  const solo = all.filter((nodeId) => !keep.has(nodeId));
  const current = new Set(currentHidden);
  const same = solo.length === current.size && solo.every((nodeId) => current.has(nodeId));
  return same ? [] : solo;
};

const childrenOf = (node: VariantTreeNode): VariantTreeNode[] =>
  node.kind === "slot" ? node.choices : node.children;

/**
 * Ids to hide after showing `id`. Hidden ancestors are unhidden too, and their other children are hidden instead,
 * so only the clicked branch reappears.
 */
export const showTreeItem = (
  tree: readonly VariantTreeSlotNode[],
  id: string,
  currentHidden: readonly string[],
): string[] => {
  let path: VariantTreeNode[] | undefined;
  const find = (nodes: readonly VariantTreeNode[], trail: VariantTreeNode[]): boolean =>
    nodes.some((node) => {
      const next = [...trail, node];
      if (node.id === id) path = next;
      return node.id === id || find(childrenOf(node), next);
    });
  find(tree, []);
  const hidden = new Set(currentHidden);
  if (path) {
    const pathIds = new Set(path.map((node) => node.id));
    for (const ancestor of path.slice(0, -1)) {
      if (!hidden.delete(ancestor.id)) continue;
      for (const child of childrenOf(ancestor)) if (!pathIds.has(child.id)) hidden.add(child.id);
    }
  }
  hidden.delete(id);
  return [...hidden];
};

/** The selections that make a choice render: the choice itself plus every ancestor choice. */
export const getSelectionChainForChoice = (catalog: VariantMeshCatalog, choiceKey: string): VariantMeshSelection[] => {
  const slotsByPath = new Map(catalog.slots.map((slot) => [slot.slotPath, slot]));
  const owner = catalog.slots.find((slot) => slot.choices.some((choice) => choice.key === choiceKey));
  const choice = owner?.choices.find((candidate) => candidate.key === choiceKey);
  if (!owner || !choice) return [];
  const chain: VariantMeshSelection[] = [{ slotPath: owner.slotPath, choiceIndex: choice.index }];
  const seen = new Set([owner.slotPath]);
  let parent = owner.parent;
  while (parent && !seen.has(parent.slotPath)) {
    seen.add(parent.slotPath);
    chain.unshift({ slotPath: parent.slotPath, choiceIndex: parent.choiceIndex });
    parent = slotsByPath.get(parent.slotPath)?.parent;
  }
  return chain;
};
