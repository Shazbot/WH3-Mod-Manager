class FileTrie<T> implements ITrie<T> {
  private trie: Trie<Trie<T>>;

  constructor() {
    this.trie = new Trie<Trie<T>>("\\");
  }

  get(key: string): T | undefined {
    const withoutSuffix = key.split("\\").slice(0, -1);
    const suffix = key.split("\\").slice(-1);
    console.log("withoutSuffix", withoutSuffix);
    if (withoutSuffix.length == 0) return;
    console.log("suffix", suffix);
    if (suffix.length == 0) return;
    const subTrie = this.trie.get(withoutSuffix.join("\\"));
    if (!subTrie) return;
    return subTrie.get(suffix.join());
  }

  add(key: string, value: T) {
    const withoutSuffix = key.split("\\").slice(0, -1);
    if (withoutSuffix.length == 0) return;
    const suffix = key.split("\\").slice(-1);
    console.log("suffix", suffix);

    const existing = this.trie.get(withoutSuffix.join("\\"));
    if (existing) {
      existing.add(suffix.join(), value);
    } else {
      const newTrie = new Trie<T>("_");
      this.trie.add(withoutSuffix.join("\\"), newTrie);
      newTrie.add(suffix.join(), value);
    }
  }
}
