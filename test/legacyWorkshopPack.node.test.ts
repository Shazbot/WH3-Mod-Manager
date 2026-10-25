import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ensureLegacyWorkshopPack,
  isLegacyWorkshopBin,
  resolveLegacyPackName,
} from "../src/utility/legacyWorkshopPack";

const respond = (filename: unknown) => async () => ({
  ok: true,
  json: async () => ({ response: { publishedfiledetails: [{ filename }] } }),
});

describe("resolveLegacyPackName", () => {
  it("parses the pack name", async () => {
    expect(await resolveLegacyPackName("100460420", respond("mods/darthmod_shogun_sw.pack"))).toBe(
      "darthmod_shogun_sw.pack",
    );
    expect(await resolveLegacyPackName("1", respond("mods\\a.pack"))).toBe("a.pack");
  });
  it("falls back on bad names and errors", async () => {
    expect(await resolveLegacyPackName("100460420", respond("mods/readme.txt"))).toBe("100460420.pack");
    expect(await resolveLegacyPackName("100460420", respond(""))).toBe("100460420.pack");
    expect(await resolveLegacyPackName("100460420", respond(undefined))).toBe("100460420.pack");
    expect(
      await resolveLegacyPackName("100460420", async () => {
        throw new Error("offline");
      }),
    ).toBe("100460420.pack");
  });
  it("detects legacy bins", () => {
    expect(isLegacyWorkshopBin("123_legacy.bin")).toBe(true);
    expect(isLegacyWorkshopBin("a.pack")).toBe(false);
  });
});

describe("ensureLegacyWorkshopPack", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates a pack with the same bytes, once for concurrent calls", async () => {
    fs.writeFileSync(path.join(dir, "99_legacy.bin"), "PFH2data");
    const logs: string[] = [];
    const f = respond("mods/x.pack");
    const results = await Promise.all([
      ensureLegacyWorkshopPack(dir, "100", (m) => logs.push(m), f),
      ensureLegacyWorkshopPack(dir, "100", (m) => logs.push(m), f),
    ]);
    expect(results).toEqual(["x.pack", "x.pack"]);
    expect(fs.readFileSync(path.join(dir, "x.pack"), "utf8")).toBe("PFH2data");
    expect(logs).toHaveLength(1);
  });
  it("does nothing when a pack exists or no bin exists", async () => {
    fs.writeFileSync(path.join(dir, "99_legacy.bin"), "a");
    fs.writeFileSync(path.join(dir, "real.pack"), "b");
    expect(await ensureLegacyWorkshopPack(dir, "100", () => {}, respond("mods/x.pack"))).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "x.pack"))).toBe(false);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-"));
    expect(await ensureLegacyWorkshopPack(empty, "100", () => {})).toBeUndefined();
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
