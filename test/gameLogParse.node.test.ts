import { describe, expect, it } from "vitest";

import {
  OTHER_TAG,
  compileQuery,
  countTags,
  filterLines,
  isCompileError,
  isErrorLine,
  parseLine,
  stripPrefix,
} from "../src/gameLog/parse";
import { parseGameLogEnvironment, parseScriptLogTimestamp } from "../src/utility/logPaths";

const prefixed = "[out] <150.8s>     \t\tdoing a thing";

describe("game log parsing", () => {
  it("parses tag, time and body, keeping the script's TABs", () => {
    expect(parseLine(prefixed)).toEqual({ tag: "out", time: "150.8", body: "\t\tdoing a thing" });
    expect(parseLine("****")).toEqual({ body: "****" });
  });

  it("strips the prefix per mode and keeps leading TABs", () => {
    expect(stripPrefix(prefixed, "full")).toBe(prefixed);
    expect(stripPrefix(prefixed, "hideTagAndTimestamp")).toBe("\t\tdoing a thing");
    expect(stripPrefix(prefixed, "hideTimestamp")).toBe("[out] \t\tdoing a thing");
    expect(stripPrefix("creating logfile", "hideTagAndTimestamp")).toBe("creating logfile");
  });

  it("counts unprefixed lines under (other)", () => {
    const counts = countTags([prefixed, "[ui] <1.0s>    x", "", "****"]);
    expect(counts.get("out")).toBe(1);
    expect(counts.get("ui")).toBe(1);
    expect(counts.get(OTHER_TAG)).toBe(2);
  });

  it("flags script errors but not precondition noise", () => {
    expect(isErrorLine("SCRIPT ERROR: bad")).toBe(true);
    expect(isErrorLine("foo.lua:12: attempt to index a nil value")).toBe(true);
    expect(isErrorLine("[out] <1.0s>    precondition check failed")).toBe(false);
    expect(isErrorLine("pj_error_wrapping")).toBe(false);
  });

  it("reports an invalid regex instead of throwing", () => {
    const compiled = compileQuery("(", { isRegex: true, caseSensitive: false });
    expect(isCompileError(compiled)).toBe(true);
    expect(compileQuery("", { isRegex: true, caseSensitive: false })).toBeUndefined();
    expect(compileQuery("a.b", { isRegex: false, caseSensitive: false })).toEqual(/a\.b/i);
  });

  it("filters with include, exclude, hidden tags and merged context", () => {
    const lines = ["a", "b match", "c", "d", "e", "f", "g match", "h", "i match", "j", "k", "l"];
    const indexes = (rows: ReturnType<typeof filterLines>) =>
      rows.map((row) => (row.kind === "line" ? row.index : "|"));

    expect(indexes(filterLines(lines, { include: /match/ }))).toEqual([1, "|", 6, "|", 8]);
    expect(indexes(filterLines(lines, { include: /match/, context: 1 }))).toEqual([0, 1, 2, "|", 5, 6, 7, 8, 9]);
    expect(indexes(filterLines(lines, { include: /match/, exclude: /^h$/, context: 1 }))).toEqual([
      0, 1, 2, "|", 5, 6, 8, 9,
    ]);
    expect(filterLines(["[ui] <1s>    a", "[out] <1s>    b", "c"], { hiddenTags: new Set(["ui", OTHER_TAG]) })).toEqual([
      { kind: "line", index: 1 },
    ]);
  });

  it("parses the timestamp in script log file names", () => {
    const parsed = parseScriptLogTimestamp("script_log_171126_2208.txt");
    expect(parsed).toBe(new Date(2026, 10, 17, 22, 8).getTime());
    expect(parseScriptLogTimestamp("lua_mod_log.txt")).toBeUndefined();
    expect(parseScriptLogTimestamp("script_log_991399_2599.txt")).toBeUndefined();
  });

  it("reads the script environment from a log's lib_header line", () => {
    const line = (environment: string) =>
      `[out] <0.6s>     lib_header.lua :: script libraries reloaded in ${environment} configuration\n`;
    expect(parseGameLogEnvironment(line("frontend"))).toBe("frontend");
    expect(parseGameLogEnvironment("\n\n" + line("campaign"))).toBe("campaign");
    expect(parseGameLogEnvironment(line("battle"))).toBe("battle");
    expect(parseGameLogEnvironment("creating logfile script_log_171126_2217.txt")).toBeUndefined();
  });
});
