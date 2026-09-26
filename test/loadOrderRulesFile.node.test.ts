import { describe, expect, it } from "vitest";

import {
  isLoadOrderRulesPackedFilePath,
  LOAD_ORDER_RULES_PACKED_FILE_PATH,
  loadOrderRulesToRows,
  loadOrderRuleRowsToRules,
  parseLoadOrderRulesFile,
  parseLoadOrderRulesRows,
  serializeLoadOrderRuleRows,
  type LoadOrderRuleRow,
} from "../src/utility/loadOrderRulesFile";

describe("isLoadOrderRulesPackedFilePath", () => {
  it("accepts the path however it is written", () => {
    expect(isLoadOrderRulesPackedFilePath(LOAD_ORDER_RULES_PACKED_FILE_PATH)).toBe(true);
    expect(isLoadOrderRulesPackedFilePath("whmm/load_order.whmm")).toBe(true);
    expect(isLoadOrderRulesPackedFilePath("WHMM\\LOAD_ORDER.WHMM")).toBe(true);
  });

  it("rejects anything else, including a lookalike elsewhere in the pack", () => {
    expect(isLoadOrderRulesPackedFilePath("whmmflows\\thing.json")).toBe(false);
    expect(isLoadOrderRulesPackedFilePath("db\\whmm\\load_order.whmm")).toBe(false);
    expect(isLoadOrderRulesPackedFilePath("whmm\\other.whmm")).toBe(false);
  });
});

describe("parseLoadOrderRulesRows", () => {
  it("reads tab separated rows", () => {
    const { rows, errors } = parseLoadOrderRulesRows("BEFORE\tone.pack\nAFTER\ttwo.pack");

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { relation: "BEFORE", packName: "one.pack" },
      { relation: "AFTER", packName: "two.pack" },
    ]);
  });

  it("skips blank lines and comments, and tolerates CRLF, spaces and casing", () => {
    const text = "# a comment\r\n\r\n  before   spaced.pack  \r\nAfTeR\t\tother\r\n";
    const { rows, errors } = parseLoadOrderRulesRows(text);

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { relation: "BEFORE", packName: "spaced.pack" },
      { relation: "AFTER", packName: "other.pack" },
    ]);
  });

  it("reports a bad relation on the right line and keeps the good rows", () => {
    const { rows, errors } = parseLoadOrderRulesRows("BEFORE\tgood.pack\nSIDEWAYS\tbad.pack");

    expect(rows).toEqual([{ relation: "BEFORE", packName: "good.pack" }]);
    expect(errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining("SIDEWAYS") })]);
  });

  it("reports a row with the wrong number of columns", () => {
    const { rows, errors } = parseLoadOrderRulesRows("BEFORE\nAFTER\ta.pack\tb.pack");

    expect(rows).toEqual([]);
    expect(errors.map((error) => error.line)).toEqual([1, 2]);
  });
});

describe("loadOrderRuleRowsToRules", () => {
  it("reads the rows as being about the pack that holds them", () => {
    const rows: LoadOrderRuleRow[] = [
      { relation: "BEFORE", packName: "later.pack" },
      { relation: "AFTER", packName: "earlier.pack" },
    ];

    // A pack's file only ever positions that pack, whichever way round the row reads.
    expect(loadOrderRuleRowsToRules(rows, "mine.pack")).toEqual([
      { before: "mine.pack", after: "later.pack", sourcePackName: "mine.pack", subjectPackName: "mine.pack" },
      { before: "earlier.pack", after: "mine.pack", sourcePackName: "mine.pack", subjectPackName: "mine.pack" },
    ]);
  });

  it("drops a row naming the pack's own name, which could only be a mistake", () => {
    const rows: LoadOrderRuleRow[] = [{ relation: "BEFORE", packName: "MINE.pack" }];
    expect(loadOrderRuleRowsToRules(rows, "mine.pack")).toEqual([]);
  });
});

describe("round trip", () => {
  it("survives serialize then parse", () => {
    const rows: LoadOrderRuleRow[] = [
      { relation: "BEFORE", packName: "one.pack" },
      { relation: "AFTER", packName: "two.pack" },
    ];

    expect(parseLoadOrderRulesRows(serializeLoadOrderRuleRows(rows)).rows).toEqual(rows);
  });

  it("writes a file a fresh parse reads as the same rules", () => {
    const rows: LoadOrderRuleRow[] = [{ relation: "AFTER", packName: "other.pack" }];
    const text = serializeLoadOrderRuleRows(rows);

    expect(parseLoadOrderRulesFile(text, "mine.pack").rules).toEqual([
      { before: "other.pack", after: "mine.pack", sourcePackName: "mine.pack", subjectPackName: "mine.pack" },
    ]);
  });

  it("writes an empty file that parses back to nothing", () => {
    expect(parseLoadOrderRulesRows(serializeLoadOrderRuleRows([])).rows).toEqual([]);
  });

  it("turns rules back into the rows the pack would store", () => {
    const rules = loadOrderRuleRowsToRules(
      [
        { relation: "BEFORE", packName: "one.pack" },
        { relation: "AFTER", packName: "two.pack" },
      ],
      "mine.pack",
    );

    expect(loadOrderRulesToRows(rules, "mine.pack")).toEqual([
      { relation: "BEFORE", packName: "one.pack" },
      { relation: "AFTER", packName: "two.pack" },
    ]);
  });
});
