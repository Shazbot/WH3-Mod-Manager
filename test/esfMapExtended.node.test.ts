import { describe, expect, it } from "vitest";

import {
  applyExtendedMapEdit,
  buildExtendedMapExport,
  buildExtendedMapDelta,
  createExtendedMapEditState,
  fillExtendedBuildingSlots,
  formatExtendedMapExportJson,
  formatExtendedMapJson,
  groupExtendedUnitOptionsByCaste,
  parseMapFile,
  resolveExtendedBuildingOptions,
  resolveExtendedUnitOptions,
  type ExtendedMapDocument,
} from "../src/esfMap/extended";
import type { BuiltBuildingsData } from "../src/buildingsData/types";

const document: ExtendedMapDocument = {
  regions: [
    {
      region: "region_a",
      faction: "faction_a",
      buildings: [{ building: "building_a", type: "primary", template: "primary" }],
    },
  ],
  faction_to_chars: [
    {
      faction: "faction_a",
      chars: [
        {
          x: 10,
          y: 20,
          subtype: "lord_a",
          id: 4,
          rank: 2,
          units: [{ id: 8, unit_key: "lord_unit", xp: 0, health: 100 }],
        },
      ],
    },
  ],
};

describe("extended map files", () => {
  it("auto-detects legacy ownership and extended map_out3 documents", () => {
    expect(parseMapFile('{"region_a":"faction_a","region_b":null}')).toEqual({
      format: "legacy",
      ownership: { region_a: "faction_a", region_b: null },
    });
    expect(parseMapFile('{"regions":"faction_a"}')).toEqual({
      format: "legacy",
      ownership: { regions: "faction_a" },
    });
    expect(parseMapFile('{"regions":"faction_a","faction_to_chars":null}')).toEqual({
      format: "legacy",
      ownership: { regions: "faction_a", faction_to_chars: null },
    });
    expect(parseMapFile('{" region_a ":" faction_a "}')).toEqual({
      format: "legacy",
      ownership: { region_a: "faction_a" },
    });
    const parsed = parseMapFile(formatExtendedMapJson(document));
    expect(parsed).toEqual({ format: "extended", document });
    const abandoned = parseMapFile(
      JSON.stringify({ regions: [{ region: "abandoned", faction: null }], faction_to_chars: [] }),
    );
    expect(abandoned).toEqual({
      format: "extended",
      document: { regions: [{ region: "abandoned", faction: null, buildings: null }], faction_to_chars: [] },
    });
  });

  it("rejects invalid ranges, obsolete unit shapes, and duplicate ids", () => {
    expect(
      parseMapFile(
        JSON.stringify({
          regions: [],
          faction_to_chars: [{ faction: "f", chars: [{ x: 0, y: 0, subtype: "s", id: 1, rank: 51 }] }],
        }),
      ),
    ).toMatchObject({ error: expect.stringContaining("at most 50") });
    expect(
      parseMapFile(
        JSON.stringify({
          regions: [],
          faction_to_chars: [
            { faction: "f", chars: [{ x: 0, y: 0, subtype: "s", id: 1, rank: 1, units: ["unit_key"] }] },
          ],
        }),
      ),
    ).toMatchObject({ error: expect.stringContaining("unit object") });
    expect(
      parseMapFile(
        JSON.stringify({
          regions: [],
          faction_to_chars: [
            { faction: "a", chars: [{ x: 0, y: 0, subtype: "s", id: 1, rank: 1 }] },
            { faction: "b", chars: [{ x: 0, y: 0, subtype: "s", id: 1, rank: 1 }] },
          ],
        }),
      ),
    ).toMatchObject({ error: expect.stringContaining("Duplicate character") });
    expect(
      parseMapFile(
        JSON.stringify({
          regions: [],
          faction_to_chars: [
            {
              faction: "f",
              chars: [
                {
                  x: 0,
                  y: 0,
                  subtype: "s",
                  id: Number.MAX_SAFE_INTEGER + 1,
                  rank: 1,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({ error: expect.stringContaining("integer") });
  });

  it("accepts the fractional health values emitted by map_out3", () => {
    const parsed = parseMapFile(
      JSON.stringify({
        regions: [],
        faction_to_chars: [
          {
            faction: "f",
            chars: [
              {
                x: 0,
                y: 0,
                subtype: "s",
                id: 1,
                rank: 1,
                units: [{ id: 2, xp: 0, health: 77.777778625488, unit_key: "u" }],
              },
            ],
          },
        ],
      }),
    );
    expect("error" in parsed ? parsed : parsed.document.faction_to_chars[0].chars[0].units?.[0].health).toBe(
      77.777778625488,
    );
  });

  it("edits rank and health and emits before/after fields", () => {
    let state = createExtendedMapEditState(document);
    state = applyExtendedMapEdit(state, {
      type: "update_character",
      faction: "faction_a",
      characterId: 4,
      changes: { rank: 7 },
    });
    state = applyExtendedMapEdit(state, {
      type: "update_unit",
      faction: "faction_a",
      characterId: 4,
      unitId: 8,
      changes: { health: 63, xp: 4 },
    });
    const delta = buildExtendedMapDelta(state.baseline, state.document);
    expect(delta.actions).toEqual([
      { type: "update_character", faction: "faction_a", characterId: 4, changes: { rank: { before: 2, after: 7 } } },
      {
        type: "update_unit",
        faction: "faction_a",
        characterId: 4,
        unitId: 8,
        index: 0,
        changes: { xp: { before: 0, after: 4 }, health: { before: 100, after: 63 } },
      },
    ]);
  });

  it("exports complete ownership with only extended-map delta actions", () => {
    let state = createExtendedMapEditState(document);
    state = applyExtendedMapEdit(state, {
      type: "set_building",
      region: "region_a",
      slotIndex: 0,
      building: { building: "building_b", type: "primary", template: "primary" },
    });
    state = applyExtendedMapEdit(state, {
      type: "update_character",
      faction: "faction_a",
      characterId: 4,
      changes: { rank: 3 },
    });

    const exported = buildExtendedMapExport(
      { region_a: "faction_b", region_b: null },
      buildExtendedMapDelta(state.baseline, state.document),
    );

    expect(exported.regions).toEqual([
      { region: "region_a", faction: "faction_b" },
      { region: "region_b", faction: null },
    ]);
    expect(exported.actions).toEqual([
      { type: "update_character", faction: "faction_a", characterId: 4, changes: { rank: { before: 2, after: 3 } } },
      {
        type: "set_building",
        region: "region_a",
        slotIndex: 0,
        before: document.regions[0].buildings![0],
        after: { building: "building_b", type: "primary", template: "primary" },
      },
    ]);
    expect(exported).not.toHaveProperty("faction_to_chars");
    expect(exported.regions[0]).not.toHaveProperty("buildings");
    expect(JSON.parse(formatExtendedMapExportJson(exported))).toEqual(exported);
  });

  it("allocates unit ids above the imported maximum and drops reverted changes", () => {
    let state = createExtendedMapEditState(document);
    state = applyExtendedMapEdit(state, {
      type: "add_unit",
      faction: "faction_a",
      characterId: 4,
      unit: { unit_key: "new_unit" },
    });
    expect(state.document.faction_to_chars[0].chars[0].units?.at(-1)?.id).toBe(9);
    state = applyExtendedMapEdit(state, { type: "remove_unit", faction: "faction_a", characterId: 4, unitId: 9 });
    expect(buildExtendedMapDelta(state.baseline, state.document)).toEqual({ version: 1, actions: [] });
  });

  it("removes characters and emits the complete character in the delta", () => {
    let state = createExtendedMapEditState(document);
    state = applyExtendedMapEdit(state, {
      type: "remove_character",
      faction: "faction_a",
      characterId: 4,
    });

    expect(state.document.faction_to_chars[0].chars).toEqual([]);
    expect(buildExtendedMapDelta(state.baseline, state.document)).toEqual({
      version: 1,
      actions: [
        {
          type: "remove_character",
          faction: "faction_a",
          characterId: 4,
          index: 0,
          character: document.faction_to_chars[0].chars[0],
        },
      ],
    });
  });

  it("rejects malformed edit payloads without changing the state", () => {
    const state = createExtendedMapEditState(document);
    expect(() =>
      applyExtendedMapEdit(state, {
        type: "set_building",
        region: "region_a",
        slotIndex: 0,
        building: { building: "", type: null as never, template: "primary" },
      }),
    ).toThrow("slot type");
    expect(() =>
      applyExtendedMapEdit(state, {
        type: "add_unit",
        faction: "faction_a",
        characterId: 4,
        unit: { unit_key: "   " },
      }),
    ).toThrow("unit key");
    expect(state.document).toEqual(document);
  });

  it("fills virtual slots from normal templates and records appended edits", () => {
    const templates = [
      { campaign: "campaign", region: "region_a", slotTemplate: "primary", slotType: "primary", id: "0" },
      { campaign: "campaign", region: "region_a", slotTemplate: "secondary", slotType: "secondary", id: "1" },
      {
        campaign: "campaign",
        region: "region_a",
        slotTemplate: "foreign",
        slotType: "foreign",
        id: "2",
        isForeignSlot: true,
      },
    ];
    const slots = fillExtendedBuildingSlots(document.regions[0].buildings!, templates, 2);
    expect(slots).toEqual([
      ...document.regions[0].buildings!,
      { building: "", type: "secondary", template: "secondary" },
    ]);

    let state = createExtendedMapEditState(document);
    state = applyExtendedMapEdit(state, {
      type: "add_building_slot",
      region: "region_a",
      slotIndex: 1,
      building: slots[1],
    });
    state = applyExtendedMapEdit(state, {
      type: "set_building",
      region: "region_a",
      slotIndex: 1,
      building: { ...slots[1], building: "building_b" },
    });
    expect(buildExtendedMapDelta(state.baseline, state.document).actions).toEqual([
      {
        type: "add_building_slot",
        region: "region_a",
        slotIndex: 1,
        building: { building: "building_b", type: "secondary", template: "secondary" },
      },
    ]);
  });

  it("filters leader and retinue choices by caste and subculture", () => {
    const units = [
      { key: "lord", name: "Lord", caste: "lord", category: "", subcultureKeys: ["sc_a"], uiGroupKey: "" },
      { key: "hero", name: "Hero", caste: "hero", category: "", subcultureKeys: ["sc_a"], uiGroupKey: "" },
      { key: "other", name: "Other", caste: "infantry", category: "", subcultureKeys: ["sc_b"], uiGroupKey: "" },
    ];
    expect(resolveExtendedUnitOptions(units, "sc_a", true).map((unit) => unit.key)).toEqual(["lord"]);
    expect(resolveExtendedUnitOptions(units, "sc_a").map((unit) => unit.key)).toEqual(["hero"]);
  });

  it("groups editing unit choices by caste in Unit Viewer order", () => {
    const options = [
      { key: "spear", name: "Spearmen", caste: "melee_infantry", isLord: false },
      { key: "hero_b", name: "B Hero", caste: "hero", isLord: false },
      { key: "lord", name: "Lord", caste: "lord", isLord: true },
      { key: "hero_a", name: "A Hero", caste: "hero", isLord: false },
      { key: "unknown", name: "Unknown", caste: "", isLord: false },
    ];

    expect(groupExtendedUnitOptionsByCaste(options)).toEqual([
      {
        key: "lord",
        name: "Lord",
        options: [options[2]],
      },
      {
        key: "hero",
        name: "Hero",
        options: [options[3], options[1]],
      },
      {
        key: "melee_infantry",
        name: "Melee Infantry",
        options: [options[0]],
      },
      {
        key: "__unknown",
        name: "Unknown caste",
        options: [options[4]],
      },
    ]);
  });

  it("resolves building choices from the selected slot template and faction availability", () => {
    const data = {
      permittedByTemplate: {
        primary_template: [{ slotTemplate: "primary_template", chain: "chain_a", remove: false }],
      },
      superChainsByTemplate: {},
      superChains: {},
      chainSetItems: {},
      factions: [{ key: "faction_a", culture: "culture_a", subculture: "sc_a" }],
      subcultures: [{ key: "sc_a", culture: "culture_a" }],
      levelsByKey: { building_a: { levelKey: "building_a", chain: "chain_a", level: 1, visibleInUi: true } },
      levelKeysByChain: { chain_a: ["building_a"] },
      variantsByLevel: {
        building_a: [
          {
            building: "building_a",
            culture: "culture_a",
            subculture: "",
            faction: "",
            disables: false,
            displayTooltip: true,
            specificity: 1,
          },
        ],
      },
      availabilitySetsByChain: {},
      availabilitiesBySetId: {},
      variantLoc: {},
    } as unknown as BuiltBuildingsData;
    expect(
      resolveExtendedBuildingOptions(data, {
        campaign: "campaign",
        region: "region",
        faction: "faction_a",
        slot: { slotTemplate: "primary_template", slotType: "primary" },
      }).map((option) => option.building),
    ).toEqual(["building_a"]);
    expect(
      resolveExtendedBuildingOptions(data, {
        campaign: "campaign",
        region: "region",
        faction: "faction_a",
        slot: { slotTemplate: "secondary_template", slotType: "secondary" },
      }),
    ).toEqual([]);
  });
});
