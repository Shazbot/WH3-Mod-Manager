import { afterEach, describe, expect, it, vi } from "vitest";
import appData from "../src/appData";
import {
  Wh3AssetHostPackInitializer,
  Wh3AssetHostPackStateError,
  buildWh3AssetHostPackPaths,
  deduplicateWh3AssetHostPackPaths,
  initializeWh3AssetHostForCurrentPackState,
} from "../src/wh3AssetHostPacks";

vi.mock("../src/utility/vanillaPackPaths", () => ({
  getVanillaPackPathsInLoadOrder: vi.fn(() => ["C:\\game\\data\\data.pack", "C:\\game\\data\\variants.pack"]),
}));

vi.mock("../src/appData", () => ({
  default: {
    enabledMods: [
      { name: "b.pack", path: "C:\\mods\\b.pack" },
      { name: "a.pack", path: "C:\\mods\\a.pack" },
    ],
  },
}));

const initialEnabledMods = [
  { name: "b.pack", path: "C:\\mods\\b.pack" },
  { name: "a.pack", path: "C:\\mods\\a.pack" },
] as Mod[];

const mod = (name: string, path: string, loadOrder?: number): Mod => ({ name, path, loadOrder }) as Mod;

afterEach(() => {
  appData.enabledMods = initialEnabledMods.map((entry) => ({ ...entry })) as Mod[];
});

describe("WH3AssetHost pack state", () => {
  it("keeps vanilla manifest order below enabled mods sorted by the manager's effective order", () => {
    const result = buildWh3AssetHostPackPaths(
      ["C:\\game\\data\\data.pack", "C:\\game\\data\\data_bl.pack"],
      [mod("z.pack", "C:\\mods\\z.pack"), mod("a.pack", "C:\\mods\\a.pack")],
    );

    expect(result).toEqual([
      "C:\\game\\data\\data.pack",
      "C:\\game\\data\\data_bl.pack",
      "C:\\mods\\a.pack",
      "C:\\mods\\z.pack",
    ]);
  });

  it("honors pinned loadOrder positions using the existing manager sorting rules", () => {
    const result = buildWh3AssetHostPackPaths(
      ["C:\\game\\data\\data.pack"],
      [
        mod("c.pack", "C:\\mods\\c.pack"),
        mod("a.pack", "C:\\mods\\a.pack", 2),
        mod("b.pack", "C:\\mods\\b.pack"),
      ],
    );

    expect(result).toEqual([
      "C:\\game\\data\\data.pack",
      "C:\\mods\\b.pack",
      "C:\\mods\\c.pack",
      "C:\\mods\\a.pack",
    ]);
  });

  it("deduplicates paths case-insensitively and preserves the highest-priority occurrence", () => {
    expect(
      deduplicateWh3AssetHostPackPaths([
        "C:\\Game\\Data\\data.pack",
        "C:\\mods\\same.pack",
        "c:/MODS/same.pack",
        "C:\\mods\\winner.pack",
      ]),
    ).toEqual(["C:\\Game\\Data\\data.pack", "c:/MODS/same.pack", "C:\\mods\\winner.pack"]);
  });

  it("lets a mod duplicate of a vanilla physical path keep the later mod occurrence", () => {
    const result = buildWh3AssetHostPackPaths(
      ["C:\\game\\data\\data.pack", "C:\\game\\data\\shared.pack"],
      [mod("shared.pack", "c:/GAME/data/shared.pack")],
    );

    expect(result).toEqual(["C:\\game\\data\\data.pack", "c:/GAME/data/shared.pack"]);
  });

  it("rejects initialization when the current game exposes no vanilla pack universe", () => {
    expect(() => buildWh3AssetHostPackPaths([], [mod("a.pack", "C:\\mods\\a.pack")])).toThrowError(
      expect.objectContaining<Partial<Wh3AssetHostPackStateError>>({ code: "MissingVanillaPacks" }),
    );
  });

  it("initializes a connected host with the current vanilla plus enabled-mod pack state", async () => {
    const initialize = vi.fn(async (request) => ({ ...request }));

    const result = await initializeWh3AssetHostForCurrentPackState({ initialize }, "C:\\cache\\model-previews");

    expect(initialize).toHaveBeenCalledWith({
      packPaths: [
        "C:\\game\\data\\data.pack",
        "C:\\game\\data\\variants.pack",
        "C:\\mods\\a.pack",
        "C:\\mods\\b.pack",
      ],
      outputRoot: "C:\\cache\\model-previews",
    });
    expect(result.outputRoot).toBe("C:\\cache\\model-previews");
  });

  it("does not reinitialize for repeated exports while the effective pack state is unchanged", async () => {
    const initialize = vi.fn(async (request) => ({ ...request }));
    const initializer = new Wh3AssetHostPackInitializer({ initialize });

    const first = await initializer.ensureInitialized("C:\\cache\\model-previews");
    const second = await initializer.ensureInitialized("c:/CACHE/model-previews");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("reinitializes after the enabled-mod universe changes", async () => {
    const initialize = vi.fn(async (request) => ({ ...request }));
    const initializer = new Wh3AssetHostPackInitializer({ initialize });

    await initializer.ensureInitialized("C:\\cache\\model-previews");
    appData.enabledMods = [mod("c.pack", "C:\\mods\\c.pack")];
    await initializer.ensureInitialized("C:\\cache\\model-previews");

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize.mock.calls[1][0].packPaths).toEqual([
      "C:\\game\\data\\data.pack",
      "C:\\game\\data\\variants.pack",
      "C:\\mods\\c.pack",
    ]);
  });

  it("retries initialization after a failed host swap instead of caching the failed state", async () => {
    const initialize = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad pack"))
      .mockImplementationOnce(async (request) => ({ ...request }));
    const initializer = new Wh3AssetHostPackInitializer({ initialize });

    await expect(initializer.ensureInitialized("C:\\cache\\model-previews")).rejects.toThrow("bad pack");
    await expect(initializer.ensureInitialized("C:\\cache\\model-previews")).resolves.not.toBeNull();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("can be reset after a host restart so an unchanged universe is initialized again", async () => {
    const initialize = vi.fn(async (request) => ({ ...request }));
    const initializer = new Wh3AssetHostPackInitializer({ initialize });

    await initializer.ensureInitialized("C:\\cache\\model-previews");
    initializer.reset();
    await initializer.ensureInitialized("C:\\cache\\model-previews");

    expect(initialize).toHaveBeenCalledTimes(2);
  });
});
