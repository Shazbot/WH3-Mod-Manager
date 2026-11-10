import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { isBarePackName } from "../../src/automation/packNames";
import { writeRawPack } from "../../src/packCore";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};

/** Fake Steam library: steamapps/common/Game/data and steamapps/workshop/content/1142710. */
const steamLayout = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-packnames-"));
  roots.push(root);
  const data = path.join(root, "steamapps", "common", "Game", "data");
  const workshop = path.join(root, "steamapps", "workshop", "content", "1142710");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "manifest.txt"), "");
  for (const id of ["111", "222"]) fs.mkdirSync(path.join(workshop, id), { recursive: true });
  return { root, data, workshop };
};
const pack = (file: string, names: string[] = ["script\\a.lua"]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return writeRawPack(file, names.map((name) => ({ name, buffer: Buffer.from(`-- ${name}`) })), metadata);
};

describe("bare pack names", () => {
  it("recognises only plain .pack file names", () => {
    expect(isBarePackName("pj_console.pack")).toBe(true);
    expect(isBarePackName("PJ.PACK")).toBe(true);
    for (const value of ["dir/x.pack", "dir\\x.pack", "/abs/x.pack", "C:x.pack", "x.lua", ".pack"])
      expect(isBarePackName(value)).toBe(false);
  });

  it("prefers the data folder, falls back to workshop, and reports the resolution", async () => {
    const { data, workshop } = steamLayout();
    await pack(path.join(data, "both_zz.pack"));
    await pack(path.join(workshop, "111", "both_zz.pack"));
    await pack(path.join(workshop, "222", "ws_only_zz.pack"));
    vi.stubEnv("WHMM_GAME_DATA_PATH", data);

    const inData = await executeAutomationRequest({ operation: "pack_info", packPath: "both_zz.pack" });
    expect(inData).toMatchObject({ ok: true, data: { path: path.join(data, "both_zz.pack") } });
    expect(inData.ok && inData.diagnostics[0]).toMatchObject({ code: "PACK_NAME_RESOLVED", severity: "info" });

    const inWorkshop = await executeAutomationRequest({ operation: "pack_info", packPath: "ws_only_zz.pack" });
    expect(inWorkshop).toMatchObject({ ok: true, data: { path: path.join(workshop, "222", "ws_only_zz.pack") } });

    const diff = await executeAutomationRequest({
      operation: "pack_diff",
      beforePath: "both_zz.pack",
      afterPath: "ws_only_zz.pack",
    });
    expect(diff.ok).toBe(true);
  });

  it("uses an explicit gameDataPath and fails clearly on ambiguous or missing names", async () => {
    const { data, workshop } = steamLayout();
    await pack(path.join(workshop, "111", "dup_zz.pack"));
    await pack(path.join(workshop, "222", "dup_zz.pack"));
    vi.stubEnv("WHMM_GAME_DATA_PATH", path.join(data, "missing"));

    const ambiguous = await executeAutomationRequest({
      operation: "pack_validate",
      packPath: "dup_zz.pack",
      gameDataPath: data,
    });
    expect(ambiguous).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const missing = await executeAutomationRequest({
      operation: "pack_validate",
      packPath: "nope_zz.pack",
      gameDataPath: data,
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("uses the workshop folder saved in WHMM settings and respects read roots", async () => {
    const { root, data } = steamLayout();
    const custom = path.join(root, "elsewhere");
    await pack(path.join(custom, "333", "saved_zz.pack"));
    const config = path.join(root, "config");
    fs.mkdirSync(path.join(config, "wh3mm"), { recursive: true });
    fs.writeFileSync(
      path.join(config, "wh3mm", "config.json"),
      JSON.stringify({ gameFolderPaths: { wh3: { dataFolder: data, contentFolder: custom } } }),
    );
    vi.stubEnv("WHMM_GAME_DATA_PATH", "");
    vi.stubEnv("APPDATA", config);
    vi.stubEnv("XDG_CONFIG_HOME", config);
    if (process.platform === "darwin") return;

    const found = await executeAutomationRequest({ operation: "pack_info", packPath: "saved_zz.pack" });
    expect(found).toMatchObject({ ok: true, data: { path: path.join(custom, "333", "saved_zz.pack") } });

    const restricted = await executeAutomationRequest(
      { operation: "pack_info", packPath: "saved_zz.pack" },
      createAutomationContext({ readRoots: [config, data], writeRoots: [] }),
    );
    expect(restricted).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
});

describe("pack read globs", () => {
  it("reads a single glob match and rejects none or several", async () => {
    const { root } = steamLayout();
    const file = path.join(root, "mod.pack");
    await pack(file, ["script\\campaign\\mod\\one.lua", "script\\two.lua", "ui\\two.lua", "text\\[x].txt"]);

    const one = await executeAutomationRequest({ operation: "pack_read_file", packPath: file, filePath: "**/ONE.lua" });
    expect(one).toMatchObject({ ok: true, data: { filePath: "script\\campaign\\mod\\one.lua", content: "-- script\\campaign\\mod\\one.lua" } });

    const exact = await executeAutomationRequest({ operation: "pack_read_file", packPath: file, filePath: "text/[x].txt" });
    expect(exact).toMatchObject({ ok: true, data: { filePath: "text\\[x].txt" } });

    const none = await executeAutomationRequest({ operation: "pack_read_file", packPath: file, filePath: "**/three.lua" });
    expect(none).toMatchObject({ ok: false, error: { code: "VALIDATION" } });

    const several = await executeAutomationRequest({ operation: "pack_read_file", packPath: file, filePath: "**/two.lua" });
    expect(several).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", details: { matches: ["script\\two.lua", "ui\\two.lua"] } },
    });
  });
});
