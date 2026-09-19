/**
 * The read half of a trie.
 *
 * Loc consumers only ever look keys up, so they are typed against this rather than the trie itself.
 * That is what lets the vanilla loc cache's reader stand in for a trie without holding one.
 */
export interface KeyedLookup<T> {
  get(key: string): T | undefined;
}

export interface ITrie<T> extends KeyedLookup<T> {
  add(key: string, value: T): void;
}

export default class Trie<T> implements ITrie<T>, Iterable<T> {
  readonly splitter: string;
  constructor(splitter: string) {
    this.splitter = splitter;
    this.root = {
      children: [],
    };
  }

  private *iterate(node: TreeNode<T> | RootNode<T>, path?: string): Generator<T, void, unknown> {
    if ("key" in node) {
      path = path ? `${path}${this.splitter}${node.key}` : `${node.key}`;
    }
    if (node.value) yield node.value;
    for (const child of node.children) {
      yield* this.iterate(child, path);
    }
  }

  getEntries() {
    const getEntriesIter = (node: TreeNode<T> | RootNode<T>, acc: Record<string, string>, path?: string) => {
      if ("key" in node) {
        path = path ? `${path}${this.splitter}${node.key}` : `${node.key}`;
      }
      if (node.value && path) acc[path] = node.value.toString();
      for (const child of node.children) {
        getEntriesIter(child, acc, path);
      }
      return acc;
    };
    return getEntriesIter(this.root, {});
  }

  private *getPathsIter(node: TreeNode<T> | RootNode<T>, path?: string): Generator<string, void, unknown> {
    if ("key" in node) {
      path = path ? `${path}${this.splitter}${node.key}` : `${node.key}`;
    }
    if (path && node.value) yield path;
    for (const child of node.children) {
      yield* this.getPathsIter(child, path);
    }
  }

  *getPaths() {
    yield* this.getPathsIter(this.root);
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.iterate(this.root);
  }

  private root: RootNode<T>;
  private addToNode(node: TreeNode<T> | RootNode<T>, subKeys: string[], value: T) {
    if (subKeys.length == 0) {
      node.value = value;
      return;
    }

    let leaf = node.children.find((child) => child.key == subKeys[0]);
    if (!leaf) {
      leaf = {
        children: [],
        key: subKeys[0],
      };
      node.children.push(leaf);
    }
    this.addToNode(leaf, subKeys.slice(1), value);
  }

  add(key: string, value: T) {
    const subKeys = key.split(this.splitter);
    this.addToNode(this.root, subKeys, value);
  }

  private getTreeNode(leaf: TreeNode<T> | RootNode<T> | RootNode<T>, locs: string[]): TreeNode<T> | undefined {
    if (locs.length == 0) return;
    for (const child of leaf.children) {
      if (child.key == locs[0]) {
        if (locs.length == 1) {
          return child;
        }
        return this.getTreeNode(child, locs.slice(1));
      }
    }
  }

  get = (key: string) => {
    const node = this.getTreeNode(this.root, key.split(this.splitter));
    if (node) return node.value;
  };
}
