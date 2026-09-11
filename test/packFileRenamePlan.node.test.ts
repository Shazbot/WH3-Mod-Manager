import { describe, expect, it } from "vitest";

import { planPackFileMove, planPackFileRename } from "../src/utility/packFileRenamePlan";

const existing = { pack: [], unsaved: [] };

describe("pack file rename planning", () => {
  it("moves selected files into a parent folder while keeping their names", () => {
    expect(
      planPackFileMove(["scripts\\hello.lua", "scripts\\nested\\goodbye.lua"], "overrides\\scripts", {
        pack: ["scripts\\hello.lua", "scripts\\nested\\goodbye.lua"],
        unsaved: [],
      }),
    ).toMatchObject({
      entries: [
        { originalPath: "scripts\\hello.lua", newPath: "overrides\\scripts\\hello.lua" },
        { originalPath: "scripts\\nested\\goodbye.lua", newPath: "overrides\\scripts\\goodbye.lua" },
      ],
      errors: [],
      conflicts: [],
    });
  });

  it("reports destination conflicts for a parent-folder move", () => {
    const plan = planPackFileMove(["scripts\\hello.lua"], "overrides", {
      pack: ["scripts\\hello.lua", "overrides\\hello.lua"],
      unsaved: [],
    });

    expect(plan.conflicts).toContainEqual({ newPath: "overrides\\hello.lua", with: "pack" });
  });

  it("supports literal replacement and {x} in both find and replace", () => {
    expect(
      planPackFileRename(
        {
          paths: ["ui\\data_data.txt"],
          find: "data",
          replace: "{x}_v2",
          useRegex: false,
          scope: "name",
        },
        existing,
      ).entries,
    ).toEqual([{ originalPath: "ui\\data_data.txt", newPath: "ui\\data_v2_data_v2.txt" }]);

    expect(
      planPackFileRename(
        {
          paths: ["ui\\custom\\file.txt"],
          find: "{x}",
          replace: "content\\overrides",
          useRegex: false,
          scope: "folder",
        },
        existing,
      ).entries,
    ).toEqual([{ originalPath: "ui\\custom\\file.txt", newPath: "content\\overrides\\file.txt" }]);
  });

  it("replaces the whole file name when requested", () => {
    expect(
      planPackFileRename(
        {
          paths: ["ui\\data.txt"],
          find: "data",
          replace: "renamed_{x}.txt",
          useRegex: false,
          scope: "name",
          replaceWholeName: true,
        },
        existing,
      ).entries,
    ).toEqual([{ originalPath: "ui\\data.txt", newPath: "ui\\renamed_{x}.txt" }]);
  });

  it("applies regexes to the selected name, folder, or full path", () => {
    expect(
      planPackFileRename(
        {
          paths: ["ui\\data_old.txt"],
          find: "^data_(.*)$",
          replace: "mod_$1",
          useRegex: true,
          scope: "name",
        },
        existing,
      ).entries[0]?.newPath,
    ).toBe("ui\\mod_old.txt");
    expect(
      planPackFileRename(
        {
          paths: ["ui_old\\file.txt"],
          find: "^ui_(.*)$",
          replace: "mod_$1",
          useRegex: true,
          scope: "folder",
        },
        existing,
      ).entries[0]?.newPath,
    ).toBe("mod_old\\file.txt");
    expect(
      planPackFileRename(
        {
          paths: ["data\\file.txt"],
          find: "^data\\\\(.*)$",
          replace: "mod\\\\$1",
          useRegex: true,
          scope: "full",
        },
        existing,
      ).entries[0]?.newPath,
    ).toBe("mod\\file.txt");
  });

  it("rejects separators in a rename and parent traversal", () => {
    const separatorPlan = planPackFileRename(
      {
        paths: ["ui\\file.txt"],
        find: "file",
        replace: "new\\file",
        useRegex: false,
        scope: "name",
      },
      existing,
    );
    expect(separatorPlan.errors[0]?.message).toMatch(/separator/);

    const emptyNamePlan = planPackFileRename(
      {
        paths: ["ui\\file.txt"],
        find: "file.txt",
        replace: "",
        useRegex: false,
        scope: "name",
      },
      existing,
    );
    expect(emptyNamePlan.errors[0]?.message).toContain("empty");

    const traversalPlan = planPackFileRename(
      {
        paths: ["ui\\file.txt"],
        find: "ui",
        replace: "..\\outside",
        useRegex: false,
        scope: "folder",
      },
      existing,
    );
    expect(traversalPlan.errors[0]?.message).toContain(".. ".trim());
  });

  it("reports existing and selection conflicts", () => {
    const plan = planPackFileRename(
      {
        paths: ["a.txt", "b.txt"],
        find: "a.txt",
        replace: "taken.txt",
        useRegex: false,
        scope: "name",
      },
      { pack: ["taken.txt"], unsaved: [] },
    );
    expect(plan.conflicts).toContainEqual({ newPath: "taken.txt", with: "pack" });

    const selectionPlan = planPackFileRename(
      {
        paths: ["a.txt", "b.txt"],
        find: "{x}",
        replace: "same.txt",
        useRegex: false,
        scope: "name",
      },
      existing,
    );
    expect(selectionPlan.conflicts).toContainEqual({ newPath: "same.txt", with: "selection" });
  });

  it("reports invalid regular expressions", () => {
    const plan = planPackFileRename(
      {
        paths: ["file.txt"],
        find: "[",
        replace: "x",
        useRegex: true,
        scope: "name",
      },
      existing,
    );
    expect(plan.invalidRegex).toBeTruthy();
    expect(plan.entries).toEqual([]);
  });
});
