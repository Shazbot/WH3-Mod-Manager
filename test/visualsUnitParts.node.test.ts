import { describe, expect, it } from "vitest";
import {
  getMountVariantMembers,
  getMountVariantOpenPath,
  getVisualsPartOptions,
  type VisualsUnitPartsInfo,
} from "../src/visuals/unitParts";

const part = (
  role: "crew" | "rider" | "mount" | "engine",
  label: string,
  path: string,
  profile = "ground" as const,
) => ({
  role,
  label,
  variantMeshPath: path,
  animationProfile: profile,
});

describe("getVisualsPartOptions", () => {
  it("lists own VMD first, then mount and engine parts", () => {
    const info: VisualsUnitPartsInfo = {
      parts: [part("rider", "Rider", "a\\own.vmd", "rider"), part("mount", "Mount", "a\\horse.vmd")],
    };
    expect(getVisualsPartOptions("a/own.vmd", info)).toEqual([
      { label: "Rider", variantMeshPath: "a/own.vmd", animationProfile: "rider" },
      { label: "Mount", variantMeshPath: "a\\horse.vmd", animationProfile: "ground" },
    ]);
  });

  it("defaults the own label and profile, and adds seat crew when it differs", () => {
    const options = getVisualsPartOptions("own.vmd", {
      parts: [part("engine", "Engine", "engine.vmd"), part("crew", "Crew", "seat.vmd", "ground")],
    });
    expect(options.map((o) => o.label)).toEqual(["Crew", "Engine", "Seat crew"]);
    expect(getVisualsPartOptions("own.vmd", undefined)).toHaveLength(1);
  });

  it("dedupes by normalized path and returns fewer than two for a single part", () => {
    const info: VisualsUnitPartsInfo = {
      parts: [part("mount", "Mount", " OWN.vmd "), part("crew", "Crew", "own.vmd")],
    };
    expect(getVisualsPartOptions("own.vmd", info)).toHaveLength(1);
  });
});

describe("getMountVariantMembers", () => {
  const entry = (unitKey: string, vmd: string, faction = "f") => ({ unitKey, faction, variantMeshPath: vmd });
  const info = (mountName: string | undefined, hasMount: boolean): VisualsUnitPartsInfo => ({
    mountName,
    mountGroup: "k0",
    parts: hasMount ? [part("rider", "Rider", "m.vmd"), part("mount", "Mount", "h.vmd")] : [],
  });
  const partsByKey = {
    k0: info(undefined, false),
    k1: info("Horse", true),
    k2: info("Pegasus", true),
    k3: info(undefined, true),
    other: { mountGroup: "zz", parts: [] },
  };

  it("returns same-VMD group members, base first, with labels and faction preference", () => {
    const entries = [
      entry("k2", "m.vmd", "a"),
      entry("k1", "M.vmd", "a"),
      entry("k1", "m.vmd", "b"),
      entry("k3", "m.vmd", "b"),
      entry("k0", "foot.vmd"),
      entry("other", "m.vmd"),
    ];
    const members = getMountVariantMembers(entries[2], entries, partsByKey);
    expect(members.map((m) => [m.entry.unitKey, m.entry.faction, m.label])).toEqual([
      ["k1", "b", "Horse"],
      ["k2", "a", "Pegasus"],
      ["k3", "b", "k3"],
    ]);
  });

  it("puts the base unit first and labels it On foot", () => {
    const entries = [entry("k1", "x.vmd"), entry("k0", "x.vmd")];
    const members = getMountVariantMembers(entries[0], entries, partsByKey);
    expect(members.map((m) => m.label)).toEqual(["On foot", "Horse"]);
  });

  it("returns nothing below two members or without a group", () => {
    const entries = [entry("k1", "m.vmd")];
    expect(getMountVariantMembers(entries[0], entries, partsByKey)).toEqual([]);
    expect(getMountVariantMembers(entries[0], entries, null)).toEqual([]);
    expect(getMountVariantMembers(undefined, entries, partsByKey)).toEqual([]);
  });
});

describe("getMountVariantOpenPath", () => {
  const part = (role: "rider" | "mount" | "engine", path: string) => ({
    role,
    label: role,
    variantMeshPath: path,
    animationProfile: "ground" as const,
  });

  it("prefers the mount, then the engine, then the unit's own VMD", () => {
    expect(getMountVariantOpenPath("own", { parts: [part("rider", "own"), part("mount", "horse")] })).toBe("horse");
    expect(getMountVariantOpenPath("own", { parts: [part("engine", "chariot")] })).toBe("chariot");
    expect(getMountVariantOpenPath("own", { parts: [part("rider", "own")] })).toBe("own");
    expect(getMountVariantOpenPath("own", undefined)).toBe("own");
  });
});
