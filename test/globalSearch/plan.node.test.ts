import { describe, expect, it } from "vitest";

import { resolveSearchTargets } from "../../src/globalSearch/plan";
import type { GlobalSearchRequest } from "../../src/globalSearch/types";

const request = (sources: GlobalSearchRequest["sources"]): GlobalSearchRequest => ({
  searchId: "test",
  query: "needle",
  caseSensitive: false,
  regex: false,
  kinds: { db: true, loc: false, text: true, rigidModel: false },
  sources,
});

describe("global search target planner", () => {
  it("preserves source order and deduplicates a pack selected twice", () => {
    const targets = resolveSearchTargets(
      request([{ kind: "pack", path: "./mods/a.pack" }, { kind: "enabledMods" }, { kind: "vanilla" }]),
      {
        enabledMods: [
          { path: "mods/a.pack", name: "A" },
          { path: "mods/b.pack", name: "B" },
        ],
      },
    );

    expect(targets.map((target) => target.path ?? target.kind)).toEqual(["./mods/a.pack", "mods/b.pack", "vanilla"]);
  });

  it("groups all selected kinds on each target", () => {
    const [target] = resolveSearchTargets(request([{ kind: "pack", path: "a.pack" }]), {});
    expect(target.kinds).toEqual(["db", "text"]);
  });
});
