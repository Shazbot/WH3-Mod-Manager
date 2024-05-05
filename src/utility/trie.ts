interface ITrie<T> {
  add(key: string, value: T): void;
  get(key: string): T | undefined;
}

class Trie<T> implements ITrie<T>, Iterable<T> {
  readonly splitter: string;
  constructor(splitter: string) {
    this.splitter = splitter;
    this.root = {
      children: [],
    };
  }

  private *iterate(node: TreeNode<T> | RootNode<T>, path: string): Generator<T, void, unknown> {
    if ("key" in node) {
      path = `${path}\\${node.key}`;
    }
    if (node.children.length == 0 && node.value) yield node.value;
    for (const child of node.children) {
      yield* this.iterate(child, path);
    }
  }

  private *getPathsIter(node: TreeNode<T> | RootNode<T>, path: string): Generator<string, void, unknown> {
    if ("key" in node) {
      console.log(node.key);
      path = `${path}\\${node.key}`;
    }
    console.log("children:", node.children.length);
    if (node.children.length == 0) yield path;
    for (const child of node.children) {
      console.log("path", path);
      yield* this.getPathsIter(child, path);
    }
  }

  *getPaths() {
    yield* this.getPathsIter(this.root, "");
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.iterate(this.root, "");
  }

  private root: RootNode<T>;
  private addToNode(node: TreeNode<T> | RootNode<T>, subKeys: string[], value: T) {
    if (subKeys.length == 0) {
      if ("key" in node) {
        console.log("added to", node.key);
      }
      node.value = value;
      return;
    }

    let leaf = node.children.find((child) => child.key == subKeys[0]);
    if (!leaf) {
      console.log("adding", subKeys[0], "to");
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

  private getTreeNode(
    leaf: TreeNode<T> | RootNode<T> | RootNode<T>,
    locs: string[]
  ): TreeNode<T> | undefined {
    if (locs.length == 0) return;
    console.log("finding", locs, "in", "key" in leaf ? leaf.key : "root");
    console.log(leaf.children);

    for (const child of leaf.children) {
      if (child.key == locs[0]) {
        if (locs.length == 1) {
          console.log("returning", "key" in child ? child.key : "root");
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
