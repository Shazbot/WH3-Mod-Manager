import { describe, expect, it } from "vitest";

import { createFlowExecutionContext, resolveFlowSourcePackPath } from "../../src/flowExecutionSupport";
import {
  PackFileOperationRule,
  planPackCopy,
  planPackFileOperations,
  resolvePackFileDestination,
} from "../../src/nodeGraph/packFileOperations";

const rule = (overrides: Partial<PackFileOperationRule>): PackFileOperationRule => ({
  id: "r1",
  operation: "copy",
  targetMatch: "name",
  target: "",
  ...overrides,
});

const files = [
  "script\\campaign\\mod\\alpha.lua",
  "script\\campaign\\mod\\beta.lua",
  "ui\\units\\icons\\emp_spearmen.png",
];

describe("resolvePackFileDestination", () => {
  const source = "script\\campaign\\mod\\alpha.lua";

  it("takes a whole path for move and copy", () => {
    const destination = "script\\other\\gamma.lua";
    expect(resolvePackFileDestination(source, rule({ operation: "copy", destination }))).toBe(destination);
    expect(resolvePackFileDestination(source, rule({ operation: "move", destination }))).toBe(destination);
  });

  it("keeps the folder for a rename, which is what separates it from a move", () => {
    expect(resolvePackFileDestination(source, rule({ operation: "rename", destination: "gamma.lua" }))).toBe(
      "script\\campaign\\mod\\gamma.lua",
    );
    // Even given a path, rename only takes the file name from it.
    expect(
      resolvePackFileDestination(source, rule({ operation: "rename", destination: "a\\b\\gamma.lua" })),
    ).toBe("script\\campaign\\mod\\gamma.lua");
  });

  it("substitutes the source's own name and folder", () => {
    expect(
      resolvePackFileDestination(source, rule({ operation: "copy", destination: "backup\\{name}" })),
    ).toBe("backup\\alpha.lua");
    expect(
      resolvePackFileDestination(source, rule({ operation: "copy", destination: "{dir}\\copy_{name}" })),
    ).toBe("script\\campaign\\mod\\copy_alpha.lua");
  });

  it("substitutes regex captures, so one rule can rewrite a set of files", () => {
    const resolved = resolvePackFileDestination(
      source,
      rule({
        operation: "move",
        targetMatch: "regex",
        target: "script\\\\campaign\\\\mod\\\\(\\w+)\\.lua",
        destination: "script\\campaign\\other\\$1_renamed.lua",
      }),
    );

    expect(resolved).toBe("script\\campaign\\other\\alpha_renamed.lua");
  });

  it("accepts a destination written with either slash", () => {
    expect(resolvePackFileDestination(source, rule({ operation: "copy", destination: "a/b/c.lua" }))).toBe(
      "a\\b\\c.lua",
    );
  });

  it("has no destination without one configured", () => {
    expect(resolvePackFileDestination(source, rule({ operation: "copy", destination: "  " }))).toBeUndefined();
  });
});

describe("planPackFileOperations", () => {
  it("copies a file, keeping the original", () => {
    const plan = planPackFileOperations(files, [
      rule({ target: "alpha.lua", operation: "copy", destination: "script\\copy\\alpha.lua" }),
    ]);

    expect(plan.entries.map((entry) => entry.targetPath)).toEqual(["script\\copy\\alpha.lua"]);
    expect(plan.removedPaths.size).toBe(0);
  });

  it("moves a file, taking the original away", () => {
    const plan = planPackFileOperations(files, [
      rule({ target: "alpha.lua", operation: "move", destination: "script\\moved\\alpha.lua" }),
    ]);

    expect(plan.entries[0].targetPath).toBe("script\\moved\\alpha.lua");
    expect([...plan.removedPaths]).toEqual(["script\\campaign\\mod\\alpha.lua"]);
  });

  it("renames within the folder", () => {
    const plan = planPackFileOperations(files, [
      rule({ target: "alpha.lua", operation: "rename", destination: "renamed.lua" }),
    ]);

    expect(plan.entries[0].targetPath).toBe("script\\campaign\\mod\\renamed.lua");
    expect(plan.removedPaths.has("script\\campaign\\mod\\alpha.lua")).toBe(true);
  });

  it("deletes without producing a file", () => {
    const plan = planPackFileOperations(files, [rule({ target: "alpha.lua", operation: "delete" })]);

    expect(plan.entries).toEqual([]);
    expect(plan.removedPaths.has("script\\campaign\\mod\\alpha.lua")).toBe(true);
    expect(plan.matchCountByRuleId.r1).toBe(1);
  });

  it("applies one rule to every file a regex matches", () => {
    const plan = planPackFileOperations(files, [
      rule({
        targetMatch: "regex",
        target: "\\\\(\\w+)\\.lua$",
        operation: "copy",
        destination: "backup\\$1.lua",
      }),
    ]);

    expect(plan.entries.map((entry) => entry.targetPath).toSorted()).toEqual([
      "backup\\alpha.lua",
      "backup\\beta.lua",
    ]);
    expect(plan.matchCountByRuleId.r1).toBe(2);
  });

  it("lets a copy land on top of an existing file", () => {
    const plan = planPackFileOperations(files, [
      rule({ target: "alpha.lua", operation: "copy", destination: "script\\campaign\\mod\\beta.lua" }),
    ]);

    expect(plan.entries[0].targetPath).toBe("script\\campaign\\mod\\beta.lua");
    expect(plan.skippedOverwrites).toEqual([]);
  });

  it("steps aside instead when the rule says not to overwrite", () => {
    const plan = planPackFileOperations(files, [
      rule({
        target: "alpha.lua",
        operation: "copy",
        destination: "script\\campaign\\mod\\beta.lua",
        overwrite: false,
      }),
    ]);

    expect(plan.entries).toEqual([]);
    expect(plan.skippedOverwrites).toEqual(["script\\campaign\\mod\\beta.lua"]);
  });

  it("lets a later rule replace an earlier rule's destination", () => {
    const plan = planPackFileOperations(files, [
      rule({ id: "a", target: "alpha.lua", operation: "copy", destination: "out.lua" }),
      rule({ id: "b", target: "beta.lua", operation: "copy", destination: "out.lua" }),
    ]);

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].sourcePath).toBe("script\\campaign\\mod\\beta.lua");
  });

  it("does not treat a move onto a path it just vacated as an overwrite", () => {
    const plan = planPackFileOperations(files, [
      rule({ id: "a", target: "alpha.lua", operation: "move", destination: "script\\campaign\\mod\\tmp.lua" }),
      rule({
        id: "b",
        target: "beta.lua",
        operation: "move",
        destination: "script\\campaign\\mod\\alpha.lua",
        overwrite: false,
      }),
    ]);

    expect(plan.entries.map((entry) => entry.targetPath).toSorted()).toEqual([
      "script\\campaign\\mod\\alpha.lua",
      "script\\campaign\\mod\\tmp.lua",
    ]);
    expect(plan.skippedOverwrites).toEqual([]);
  });

  it("drops a file an earlier rule produced when a later rule deletes it", () => {
    const plan = planPackFileOperations(files, [
      rule({ id: "a", target: "alpha.lua", operation: "copy", destination: "out.lua" }),
      rule({ id: "b", targetMatch: "path", target: "out.lua", operation: "delete" }),
    ]);

    expect(plan.entries).toEqual([]);
  });

  it("counts a rule that matched nothing", () => {
    const plan = planPackFileOperations(files, [
      rule({ target: "missing.lua", operation: "copy", destination: "x.lua" }),
    ]);

    expect(plan.matchCountByRuleId.r1).toBe(0);
    expect(plan.entries).toEqual([]);
  });

  it("ignores a rule with no destination rather than writing to an empty path", () => {
    const plan = planPackFileOperations(files, [rule({ target: "alpha.lua", operation: "copy" })]);

    expect(plan.entries).toEqual([]);
  });
});

describe("planPackCopy", () => {
  const copyOf = (rules: PackFileOperationRule[]) => planPackCopy(files, planPackFileOperations(files, rules));

  it("carries the untouched files across, so the output is a whole pack and not a fragment", () => {
    const copy = copyOf([rule({ target: "alpha.lua", operation: "copy", destination: "backup\\alpha.lua" })]);

    expect(copy.map((entry) => entry.targetPath).toSorted()).toEqual([
      "backup\\alpha.lua",
      ...files.toSorted(),
    ]);
    // The new file takes its bytes from the file it was copied from.
    expect(copy.find((entry) => entry.targetPath === "backup\\alpha.lua")?.sourcePath).toBe(
      "script\\campaign\\mod\\alpha.lua",
    );
  });

  it("leaves a deleted file out of the copy, which is the only way a delete can bite", () => {
    const copy = copyOf([rule({ target: "alpha.lua", operation: "delete" })]);

    expect(copy.map((entry) => entry.targetPath).toSorted()).toEqual([
      "script\\campaign\\mod\\beta.lua",
      "ui\\units\\icons\\emp_spearmen.png",
    ]);
  });

  it("moves a file by dropping the old path and adding the new one", () => {
    const copy = copyOf([
      rule({ target: "alpha.lua", operation: "move", destination: "script\\moved\\alpha.lua" }),
    ]);

    expect(copy.map((entry) => entry.targetPath)).not.toContain("script\\campaign\\mod\\alpha.lua");
    expect(copy.find((entry) => entry.targetPath === "script\\moved\\alpha.lua")?.sourcePath).toBe(
      "script\\campaign\\mod\\alpha.lua",
    );
    expect(copy).toHaveLength(files.length);
  });

  it("gives an overwriting copy the new bytes rather than listing the path twice", () => {
    const copy = copyOf([
      rule({ target: "alpha.lua", operation: "copy", destination: "script\\campaign\\mod\\beta.lua" }),
    ]);

    const beta = copy.filter((entry) => entry.targetPath === "script\\campaign\\mod\\beta.lua");
    expect(beta).toHaveLength(1);
    expect(beta[0].sourcePath).toBe("script\\campaign\\mod\\alpha.lua");
    expect(copy).toHaveLength(files.length);
  });

  it("reproduces the pack as it was when the rules changed nothing", () => {
    const copy = copyOf([rule({ target: "missing.lua", operation: "delete" })]);

    expect(copy).toEqual(files.map((name) => ({ targetPath: name, sourcePath: name })));
  });
});

describe("resolveFlowSourcePackPath", () => {
  const original = "C:\\game\\data\\my_mod.pack";
  const overwriteCopy = "C:\\game\\whmm_overwrites\\my_mod.pack";

  it("reads the overwrite copy, so a pack copy keeps the user's data edits", () => {
    const executionContext = createFlowExecutionContext();
    executionContext.packPathSubstitutes.set(original, overwriteCopy);

    expect(resolveFlowSourcePackPath(original, executionContext)).toBe(overwriteCopy);
  });

  it("reads the pack itself when it has no overwrites, and on a manual run with no context", () => {
    const executionContext = createFlowExecutionContext();
    executionContext.packPathSubstitutes.set(original, overwriteCopy);

    expect(resolveFlowSourcePackPath("C:\\game\\data\\other.pack", executionContext)).toBe(
      "C:\\game\\data\\other.pack",
    );
    expect(resolveFlowSourcePackPath(original, undefined)).toBe(original);
  });
});
