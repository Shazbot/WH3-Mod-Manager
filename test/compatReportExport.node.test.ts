import { describe, expect, it } from "vitest";
import { load } from "cheerio";

import {
  canonicaliseForDiff,
  countCompatFindings,
  formatCompatReport,
  formatCompatReportHtml,
} from "../src/modCompat/compatReportExport";
import type { PackCollisions } from "../src/packFileTypes";

const emptyCollisions = (): PackCollisions => ({
  packFileCollisions: [],
  packTableCollisions: [],
  missingTableReferences: {},
  uniqueIdsCollisions: {},
  scriptListenerCollisions: {},
  packFileAnalysisErrors: {},
  missingFileRefs: {},
});

describe("canonical form for diffing", () => {
  it("sorts object keys", () => {
    expect(JSON.stringify(canonicaliseForDiff({ b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });

  it("sorts arrays, so discovery order does not show up as a difference", () => {
    // The whole point: two builds finding the same conflicts in a different order must match.
    const first = canonicaliseForDiff([{ value: "b" }, { value: "a" }]);
    const second = canonicaliseForDiff([{ value: "a" }, { value: "b" }]);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("sorts nested structures all the way down", () => {
    const first = { packs: { z: [{ b: 1, a: 2 }], a: [{ d: 4, c: 3 }] } };
    const second = { packs: { a: [{ c: 3, d: 4 }], z: [{ a: 2, b: 1 }] } };

    expect(JSON.stringify(canonicaliseForDiff(first))).toBe(JSON.stringify(canonicaliseForDiff(second)));
  });

  it("still reports a genuine difference", () => {
    // Sorting must not be so aggressive that it hides a real change.
    const before = canonicaliseForDiff([{ value: "a" }, { value: "b" }]);
    const after = canonicaliseForDiff([{ value: "a" }, { value: "c" }]);

    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
  });

  it("notices a missing entry rather than sorting it away", () => {
    const before = canonicaliseForDiff([{ value: "a" }, { value: "b" }]);
    const after = canonicaliseForDiff([{ value: "a" }]);

    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
  });

  it("keeps duplicates, which are not the same as one entry", () => {
    expect(JSON.stringify(canonicaliseForDiff(["a", "a"]))).toBe('["a","a"]');
  });

  it("leaves primitives, null and undefined alone", () => {
    expect(canonicaliseForDiff(5)).toBe(5);
    expect(canonicaliseForDiff("x")).toBe("x");
    expect(canonicaliseForDiff(null)).toBe(null);
    expect(canonicaliseForDiff(undefined)).toBe(undefined);
  });
});

describe("compat finding counts", () => {
  it("counts the findings, not the packs holding them", () => {
    // A pack losing one of several missing references is exactly the regression being hunted, and a
    // count of top-level keys would not move.
    const collisions = emptyCollisions();
    collisions.missingTableReferences = {
      "a.pack": [{} as never, {} as never],
      "b.pack": [{} as never],
    };
    collisions.missingFileRefs = { "a.pack": { "file.xml": [{} as never, {} as never] } };

    const counts = countCompatFindings(collisions);
    expect(counts.missingTableReferences).toBe(3);
    expect(counts.missingFileRefs).toBe(2);
  });

  it("counts nothing for an empty report", () => {
    expect(countCompatFindings(emptyCollisions())).toEqual({
      packFileCollisions: 0,
      packTableCollisions: 0,
      missingTableReferences: 0,
      uniqueIdsCollisions: 0,
      scriptListenerCollisions: 0,
      packFileAnalysisErrors: 0,
      missingFileRefs: 0,
    });
  });
});

describe("compat report", () => {
  const mods = [
    { name: "b.pack", isEnabled: true, loadOrder: 2 },
    { name: "a.pack", isEnabled: true, loadOrder: 1 },
  ];

  it("is identical for the same findings discovered in a different order", () => {
    const first = emptyCollisions();
    first.missingTableReferences = { "a.pack": [{ value: "x" } as never, { value: "y" } as never] };
    const second = emptyCollisions();
    second.missingTableReferences = { "a.pack": [{ value: "y" } as never, { value: "x" } as never] };

    expect(formatCompatReport(first, mods)).toBe(formatCompatReport(second, [...mods].reverse()));
  });

  it("records the mod set, so two runs can be shown to be comparable", () => {
    const report = JSON.parse(formatCompatReport(emptyCollisions(), mods)) as {
      mods: Array<{ name: string }>;
    };

    expect(report.mods.map((mod) => mod.name)).toEqual(["a.pack", "b.pack"]);
  });

  it("differs when the mod set differs, even with identical findings", () => {
    const withExtra = [...mods, { name: "c.pack", isEnabled: false, loadOrder: 3 }];

    expect(formatCompatReport(emptyCollisions(), mods)).not.toBe(
      formatCompatReport(emptyCollisions(), withExtra),
    );
  });

  it("ends with a newline, so the file diffs cleanly", () => {
    expect(formatCompatReport(emptyCollisions(), mods).endsWith("}\n")).toBe(true);
  });
});

describe("HTML compat report", () => {
  it("creates a self-contained, searchable report with summary and detail sections", () => {
    const collisions = emptyCollisions();
    collisions.packFileCollisions = [
      {
        firstPackName: "first.pack",
        secondPackName: "second.pack",
        fileName: "script\\example.lua",
        areSameSize: false,
      },
    ];

    const html = formatCompatReportHtml(
      collisions,
      [{ name: "first.pack", isEnabled: true, loadOrder: 0 }],
      { generatedAt: new Date("2026-08-11T10:00:00.000Z"), scopeLabel: "Enabled mods only" },
    );

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Compatibility Report");
    expect(html).toContain("Enabled mods only");
    expect(html).toContain('id="report-search"');
    expect(html).toContain("Expand all");
    expect(html).toContain("File collisions");
    expect(html).toContain("Database key collisions");
    expect(html).toContain("script\\example.lua");
    expect(html).toContain("2026-08-11T10:00:00.000Z");
    expect(html.endsWith("</html>\n")).toBe(true);

    const report = load(html);
    expect(report("details.report-section")).toHaveLength(7);
    expect(report("[data-finding]")).toHaveLength(1);
    expect(report('script[src], link[rel="stylesheet"]')).toHaveLength(0);
  });

  it("escapes pack-provided text before placing it in HTML", () => {
    const collisions = emptyCollisions();
    collisions.packFileCollisions = [
      {
        firstPackName: '<img src=x onerror="alert(1)">.pack',
        secondPackName: "safe.pack",
        fileName: "<script>bad()</script>",
      },
    ];

    const html = formatCompatReportHtml(collisions, [], {
      generatedAt: new Date("2026-08-11T10:00:00.000Z"),
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;.pack");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">.pack');
  });

  it("lists mods in load order", () => {
    const html = formatCompatReportHtml(
      emptyCollisions(),
      [
        { name: "late.pack", isEnabled: true, loadOrder: 5 },
        { name: "early.pack", isEnabled: true, loadOrder: 1 },
      ],
      { generatedAt: new Date("2026-08-11T10:00:00.000Z") },
    );

    expect(html.indexOf("early.pack")).toBeLessThan(html.indexOf("late.pack"));
  });
});
