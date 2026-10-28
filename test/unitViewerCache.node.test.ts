import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearUnitViewerMemoryCache, loadUnitViewerDiskCache, saveUnitViewerDiskCache } from "../src/unitViewer/cache";
import { buildUnitViewerData, type UnitViewerTableRows } from "../src/unitViewer/data";
import type { UnitViewerPainterVariantContext } from "../src/unitViewer/types";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (input: Buffer) => input,
  decompress: async (input: Buffer) => input,
}));

const temporaryDirectories: string[] = [];
const cacheFile = (directory: string) => path.join(directory, "unit-viewer-data-cache.bin");

const makePainterContext = (
  factionColours?: NonNullable<UnitViewerPainterVariantContext["factionColours"]>,
): UnitViewerPainterVariantContext => ({
  unitKey: "land",
  faction: "same_faction",
  variantName: "variant",
  unitVariantName: "variant_name",
  unitCard: "unit_card",
  variantDetails: {
    techFolder: "",
    variantFilename: "variant.vmd",
    lowPolyFilename: "",
    mountScale: "1",
    scale: "1",
    scaleVariation: "0",
    superLowPolyFilename: "",
  },
  availableFactions: ["same_faction"],
  ...(factionColours === undefined ? {} : { factionColours }),
});

const makeData = () => {
  const tables: UnitViewerTableRows = {
    main_units_tables: [{ unit: "unit", land_unit: "land", num_men: "1" }],
    land_units_tables: [{ key: "land", man_entity: "entity", primary_melee_weapon: "weapon" }],
    battle_entities_tables: [{ key: "entity", type: "man", hit_points: "100", mass: "50" }],
    melee_weapons_tables: [{ key: "weapon", damage: "10", ap_damage: "5" }],
  };
  const data = buildUnitViewerData(tables, () => undefined);
  const baseUnit = data.units.get("unit")!;
  const repeatedColour = {
    faction: "same_faction",
    subculture: "subculture",
    primary: "#111111",
    secondary: "#222222",
    tertiary: "#333333",
  };
  const sameFactionDifferentColours = {
    faction: "same_faction",
    subculture: "subculture",
    primary: "#aaaaaa",
    secondary: "#bbbbbb",
    tertiary: "#cccccc",
  };
  const otherFaction = {
    faction: "other_faction",
    subculture: "other_subculture",
    primary: "#dddddd",
    secondary: "#eeeeee",
    tertiary: "#ffffff",
  };

  data.units.set("with-colours", {
    ...baseUnit,
    key: "with-colours",
    painterVariantContext: makePainterContext([repeatedColour, sameFactionDifferentColours, { ...repeatedColour }]),
  });
  data.units.set("with-colours-again", {
    ...baseUnit,
    key: "with-colours-again",
    painterVariantContext: makePainterContext([{ ...repeatedColour }, otherFaction]),
  });
  data.units.set("with-empty-colours", {
    ...baseUnit,
    key: "with-empty-colours",
    painterVariantContext: makePainterContext([]),
  });
  data.units.set("without-colours", {
    ...baseUnit,
    key: "without-colours",
    painterVariantContext: makePainterContext(),
  });

  return data;
};

const toComparableModel = (data: ReturnType<typeof buildUnitViewerData> | undefined) => {
  if (!data) return undefined;
  return JSON.parse(
    JSON.stringify({
      ...data,
      units: Array.from(data.units.entries()),
      iconPathsByUnit: Array.from(data.iconPathsByUnit.entries()),
    }),
  );
};

const readPayload = async (directory: string) =>
  JSON.parse(await fs.promises.readFile(cacheFile(directory), "utf8")) as any;

const writePayload = async (directory: string, payload: unknown) =>
  fs.promises.writeFile(cacheFile(directory), JSON.stringify(payload));

afterEach(async () => {
  clearUnitViewerMemoryCache();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("Unit Viewer disk cache", () => {
  it("round-trips data with pooled faction colours and rejects a stale signature", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-unit-viewer-"));
    temporaryDirectories.push(directory);
    const data = makeData();
    data.statIcons["ui\\skins\\default\\icon_stat_health.png"] = "cached-health-icon";
    const originalModel = toComparableModel(data);

    await saveUnitViewerDiskCache(directory, "current", data);
    expect(toComparableModel(data)).toEqual(originalModel);
    const serialized = await readPayload(directory);
    expect(serialized.version).toBe(32);
    expect(serialized.data.factionColourPool).toHaveLength(3);
    expect(
      serialized.data.units.find(([key]: [string]) => key === "with-colours")[1].painterVariantContext.factionColours,
    ).toEqual([0, 1, 0]);
    const savedMemoryHit = await loadUnitViewerDiskCache(directory, "current");
    expect(toComparableModel(savedMemoryHit)).toEqual(originalModel);
    clearUnitViewerMemoryCache();

    const restored = await loadUnitViewerDiskCache(directory, "current");
    expect(toComparableModel(restored)).toEqual(originalModel);
    expect(restored?.units.get("unit")?.baseEntity.hitPoints).toBe(100);
    expect(restored?.groups[0].name).toBe("Unassigned");
    expect(restored?.statIcons).toEqual({
      "ui\\skins\\default\\icon_stat_health.png": "cached-health-icon",
    });
    const colours = restored?.units.get("with-colours")?.painterVariantContext?.factionColours;
    const coloursAgain = restored?.units.get("with-colours-again")?.painterVariantContext?.factionColours;
    expect(colours?.map(({ primary }) => primary)).toEqual(["#111111", "#aaaaaa", "#111111"]);
    expect(coloursAgain?.map(({ primary }) => primary)).toEqual(["#111111", "#dddddd"]);
    expect(colours?.[0]).not.toBe(colours?.[1]);
    expect(colours?.[0]).not.toBe(colours?.[2]);
    expect(colours?.[0]).not.toBe(coloursAgain?.[0]);
    expect(restored?.units.get("with-empty-colours")?.painterVariantContext?.factionColours).toEqual([]);
    expect(restored?.units.get("without-colours")?.painterVariantContext).not.toHaveProperty("factionColours");

    colours![0].primary = "changed in returned model";
    const memoryHit = await loadUnitViewerDiskCache(directory, "current");
    expect(memoryHit?.units.get("with-colours")?.painterVariantContext?.factionColours?.[0].primary).toBe("#111111");
    expect(memoryHit?.units.get("with-colours")?.painterVariantContext?.factionColours?.[0]).not.toBe(colours?.[1]);
    expect(toComparableModel(memoryHit)).toEqual(originalModel);
    expect(toComparableModel(data)).toEqual(originalModel);

    clearUnitViewerMemoryCache();
    await expect(loadUnitViewerDiskCache(directory, "stale")).resolves.toBeUndefined();
  });

  it("deduplicates complete palettes within faction buckets and keeps caller and loaded colours independent", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-unit-viewer-"));
    temporaryDirectories.push(directory);
    const data = makeData();
    for (const key of ["with-colours", "with-colours-again", "with-empty-colours", "without-colours"]) {
      data.units.delete(key);
    }

    const commonColour = {
      faction: "same_faction",
      subculture: "same_subculture",
      primary: "primary",
      secondary: "secondary",
      tertiary: "tertiary",
    };
    const inputColours = [
      commonColour,
      { ...commonColour, subculture: "other_subculture" },
      { ...commonColour, primary: "other_primary" },
      { ...commonColour, secondary: "other_secondary" },
      { ...commonColour, tertiary: "other_tertiary" },
      { ...commonColour },
      { faction: "__proto__", subculture: "constructor", primary: "toString", secondary: "", tertiary: "雪" },
      { faction: "☃️/雪🧪", subculture: "", primary: "", secondary: "🔴", tertiary: "__proto__" },
      { faction: "", subculture: "constructor", primary: "toString", secondary: "💠", tertiary: "" },
    ];
    const baseUnit = data.units.get("unit")!;
    data.units.set("palette-variants", {
      ...baseUnit,
      key: "palette-variants",
      painterVariantContext: makePainterContext(inputColours),
    });

    await saveUnitViewerDiskCache(directory, "palette-signature", data);
    const serialized = await readPayload(directory);
    expect(serialized.version).toBe(32);
    expect(serialized.data.factionColourPool).toEqual([
      commonColour,
      { ...commonColour, subculture: "other_subculture" },
      { ...commonColour, primary: "other_primary" },
      { ...commonColour, secondary: "other_secondary" },
      { ...commonColour, tertiary: "other_tertiary" },
      { faction: "__proto__", subculture: "constructor", primary: "toString", secondary: "", tertiary: "雪" },
      { faction: "☃️/雪🧪", subculture: "", primary: "", secondary: "🔴", tertiary: "__proto__" },
      { faction: "", subculture: "constructor", primary: "toString", secondary: "💠", tertiary: "" },
    ]);
    expect(
      serialized.data.units.find(([key]: [string]) => key === "palette-variants")[1].painterVariantContext
        .factionColours,
    ).toEqual([0, 1, 2, 3, 4, 0, 5, 6, 7]);

    inputColours[0].primary = "caller mutation";
    inputColours[7].secondary = "caller mutation";
    const firstLoad = await loadUnitViewerDiskCache(directory, "palette-signature");
    const firstColours = firstLoad?.units.get("palette-variants")?.painterVariantContext?.factionColours;
    expect(firstColours?.[0].primary).toBe("primary");
    expect(firstColours?.[5].primary).toBe("primary");
    expect(firstColours?.[7].secondary).toBe("🔴");
    expect(firstColours?.[0]).not.toBe(inputColours[0]);
    expect(firstColours?.[0]).not.toBe(firstColours?.[5]);

    firstColours![0].primary = "returned mutation";
    const secondLoad = await loadUnitViewerDiskCache(directory, "palette-signature");
    const secondColours = secondLoad?.units.get("palette-variants")?.painterVariantContext?.factionColours;
    expect(secondColours?.[0].primary).toBe("primary");
    expect(secondColours?.[0]).not.toBe(firstColours?.[0]);
    expect(secondColours?.[0]).not.toBe(secondColours?.[5]);

    clearUnitViewerMemoryCache();
    const diskLoad = await loadUnitViewerDiskCache(directory, "palette-signature");
    const diskColours = diskLoad?.units.get("palette-variants")?.painterVariantContext?.factionColours;
    expect(diskColours?.[0].primary).toBe("primary");
    expect(diskColours?.[7].secondary).toBe("🔴");
    expect(diskColours?.[0]).not.toBe(diskColours?.[5]);
    expect(diskColours?.[0]).not.toBe(secondColours?.[0]);
  });

  it("rejects old versions and corrupted faction colour pools or references without caching them", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "whmm-unit-viewer-"));
    temporaryDirectories.push(directory);
    await saveUnitViewerDiskCache(directory, "current", makeData());
    const validPayload = await readPayload(directory);

    const corruptPayloads = [
      { ...validPayload, version: 31 },
      { ...validPayload, data: { ...validPayload.data, factionColourPool: {} } },
      {
        ...validPayload,
        data: { ...validPayload.data, factionColourPool: [{ ...validPayload.data.factionColourPool[0], tertiary: 1 }] },
      },
      ...[0.5, -1, validPayload.data.factionColourPool.length, "0"].map((reference) => {
        const data = structuredClone(validPayload.data);
        const entry = data.units.find(([key]: [string]) => key === "with-colours");
        entry[1].painterVariantContext.factionColours = [reference];
        return { ...validPayload, data };
      }),
    ];

    for (const corruptPayload of corruptPayloads) {
      clearUnitViewerMemoryCache();
      await writePayload(directory, corruptPayload);
      await expect(loadUnitViewerDiskCache(directory, "current")).resolves.toBeUndefined();

      await writePayload(directory, validPayload);
      await expect(loadUnitViewerDiskCache(directory, "current")).resolves.toBeDefined();
    }

    clearUnitViewerMemoryCache();
    await writePayload(directory, validPayload);
    await expect(loadUnitViewerDiskCache(directory, "stale")).resolves.toBeUndefined();
  });
});
