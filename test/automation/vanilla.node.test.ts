import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutomationContext, executeAutomationRequest } from "../../src/automation/registry";
import { discoverGameDataPath } from "../../src/automation/vanilla";
import { prepareReferenceEnvironment, resolveReferenceAsset } from "../../src/automation/references";
import { writeRawPack } from "../../src/packCore";
import { main } from "../../src/cli/main";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "whmm-vanilla-"));
  roots.push(root);
  return root;
};
const metadata = {
  game: "wh3" as const,
  byteMask: 3,
  refFileCount: 0,
  headerBuffer: Buffer.from([255, 255, 255, 127]),
  dependencies: [] as string[],
};

describe("base game pack discovery", () => {
  it("uses environment discovery, preserves explicit overrides, and resolves mods above vanilla", async () => {
    const root = workspace();
    const base = path.join(root, "base.pack");
    const extra = path.join(root, "extra.pack");
    const mod = path.join(root, "mod.pack");
    for (const pack of [base, extra, mod])
      await writeRawPack(pack, [{ name: "textures\\shared.dds", buffer: Buffer.from(pack) }], metadata);
    fs.writeFileSync(path.join(root, "manifest.txt"), "base.pack\t123\n");
    vi.stubEnv("WHMM_GAME_DATA_PATH", root);
    const context = createAutomationContext({ readRoots: [root], writeRoots: [] });
    const env = await prepareReferenceEnvironment(context, [mod], [extra], undefined, true);
    expect(env.providers.map((p) => p.pack.path)).toEqual([extra, base, mod]);
    expect(resolveReferenceAsset(env, "textures/shared.dds").winner?.provider.pack.path).toBe(mod);
    vi.stubEnv("WHMM_GAME_DATA_PATH", path.join(root, "invalid"));
    const explicit = await prepareReferenceEnvironment(context, [mod], [], root, true);
    expect(explicit.providers.map((p) => p.pack.path)).toEqual([base, mod]);
    const restricted = await executeAutomationRequest(
      { operation: "pack_validate", packPath: mod, withVanilla: true, gameDataPath: root },
      createAutomationContext({ readRoots: [mod], writeRoots: [] }),
    );
    expect(restricted).toMatchObject({ ok: false, error: { code: "IO_ACCESS" } });
  });

  it("reads the WH3 saved path without loading Electron", async () => {
    const root = workspace();
    vi.stubEnv("WHMM_GAME_DATA_PATH", "");
    vi.stubEnv("APPDATA", root);
    vi.stubEnv("XDG_CONFIG_HOME", root);
    // On macOS the configuration lives in Application Support instead.
    const configPath =
      process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "wh3mm", "config.json")
        : path.join(root, "wh3mm", "config.json");
    if (process.platform === "darwin") return;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ gameFolderPaths: { wh3: { dataFolder: root } } }));
    expect(await discoverGameDataPath(createAutomationContext({ readRoots: [root] }))).toBe(root);
    fs.writeFileSync(configPath, "{}");
    await expect(discoverGameDataPath(createAutomationContext({ readRoots: [root] }))).rejects.toThrow("--game-data");
  });

  it("rejects unsafe or empty manifests and irrelevant CLI flags", async () => {
    const root = workspace();
    const mod = path.join(root, "mod.pack");
    await writeRawPack(mod, [], metadata);
    for (const manifest of ["../outside.pack\n", ""]) {
      fs.writeFileSync(path.join(root, "manifest.txt"), manifest);
      expect(
        await executeAutomationRequest({
          operation: "pack_validate",
          packPath: mod,
          gameDataPath: root,
          withVanilla: true,
        }),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    const output: string[] = [];
    expect(
      await main(["pack", "info", mod, "--with-vanilla", "--format", "json"], {
        stdout: (v) => output.push(v),
        stderr: () => undefined,
      }),
    ).not.toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
});
