import { describe, expect, it } from "vitest";

import appReducer, { toggleIgnoredMissingReqMods } from "../src/appSlice";
import initialState from "../src/initialAppState";
import { splitIgnoredMissingModDependencies } from "../src/utility/frontend/missingModDependencies";

const mod = (name: string) => ({ name, humanName: name }) as Mod;

describe("splitIgnoredMissingModDependencies", () => {
  const alpha: [Mod, [string, string][]] = [mod("alpha.pack"), [["1", "Alpha Patch"]]];
  const beta: [Mod, [string, string][]] = [mod("beta.pack"), [["2", "Beta Patch"]]];

  it("keeps everything active when nothing is ignored", () => {
    expect(splitIgnoredMissingModDependencies([alpha, beta], [])).toEqual({ active: [alpha, beta], ignored: [] });
  });

  it("moves ignored parents out of the active list and keeps their order", () => {
    expect(splitIgnoredMissingModDependencies([alpha, beta], ["alpha.pack"])).toEqual({
      active: [beta],
      ignored: [alpha],
    });
  });

  it("ignores names that no longer have missing requirements", () => {
    expect(splitIgnoredMissingModDependencies([alpha], ["gone.pack"])).toEqual({ active: [alpha], ignored: [] });
  });
});

describe("toggleIgnoredMissingReqMods", () => {
  it("adds and then removes a parent mod name", () => {
    const ignored = appReducer(initialState as AppState, toggleIgnoredMissingReqMods(["alpha.pack"]));
    expect(ignored.ignoredMissingReqModNames).toEqual(["alpha.pack"]);

    const unignored = appReducer(ignored, toggleIgnoredMissingReqMods(["alpha.pack"]));
    expect(unignored.ignoredMissingReqModNames).toEqual([]);
  });
});
