import { z } from "zod";
import { toVariantMeshDefinitionPath } from "../visuals/paths";
import { yieldToEventLoop } from "./errors";
import {
  loadEffectiveDbRows,
  prepareReferenceEnvironment,
  resolveReferenceAsset,
  type EffectiveDbRow,
} from "./references";
import { finishLookup, loadLocalization, lookupInputs, matchesLookup, rowEvidence } from "./localization";
import type { AutomationContext } from "./operations";

export const unitResolveSchema = z
  .object({
    operation: z.literal("unit_resolve"),
    ...lookupInputs,
    searchBy: z.enum(["key", "text"]).default("key"),
    detailLimit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

const tables = [
  "main_units",
  "land_units",
  "unit_variants",
  "variants",
  "factions",
  "cultures_subcultures",
  "units_custom_battle_permissions",
  "units_to_exclusive_faction_permissions",
  "building_units_allowed",
  "building_culture_variants",
  "mercenary_unit_groups",
  "unit_set_to_unit_junctions",
  "mounts",
  "battlefield_engines",
  "warscape_animated",
  "warscape_animated_lod",
  "land_units_to_extra_engines",
  "ui_unit_groupings",
  "ui_unit_group_parents",
  "agent_subtypes",
  "agent_subtype_subculture_overrides",
  "faction_agent_permitted_subtypes",
  "campaign_character_art_sets",
  "campaign_character_arts",
  "agent_uniforms",
] as const;
type TableName = (typeof tables)[number];
const text = (item: EffectiveDbRow | undefined, field: string) => String(item?.row[field] ?? "");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

/** Port of Wh3UnitCategoryResolver.Classify: UI grouping first, then caste, then land category. */
export const classifyUnitForOptimization = (caste: string, category: string, uiGroup: string): string => {
  const groups: Record<string, string> = {
    commander: "Lord",
    heroes_agents: "Hero",
    infantry: "InfantryMissile",
    missile_infantry: "InfantryMissile",
    cavalry_chariots: "CavalryChariot",
    missile_cavalry_chariots: "CavalryChariot",
    monster_beasts: "MonsterBeast",
    missile_monster_beasts: "MonsterBeast",
    constructs: "MonsterBeast",
    flying_war_machine: "ArtilleryWarMachine",
    artillery_war_machines: "ArtilleryWarMachine",
  };
  const castes: Record<string, string> = {
    lord: "Lord",
    hero: "Hero",
    melee_infantry: "InfantryMissile",
    missile_infantry: "InfantryMissile",
    infantry: "InfantryMissile",
    melee_cavalry: "CavalryChariot",
    missile_cavalry: "CavalryChariot",
    cavalry: "CavalryChariot",
    chariot: "CavalryChariot",
    monster: "MonsterBeast",
    monstrous_infantry: "MonsterBeast",
    war_beast: "MonsterBeast",
    warmachine: "ArtilleryWarMachine",
    war_machine: "ArtilleryWarMachine",
    artillery: "ArtilleryWarMachine",
  };
  const categories: Record<string, string> = {
    inf_melee: "InfantryMissile",
    inf_ranged: "InfantryMissile",
    cavalry: "CavalryChariot",
    war_beast: "MonsterBeast",
    artillery: "ArtilleryWarMachine",
    war_machine: "ArtilleryWarMachine",
  };
  return (
    groups[uiGroup.trim().toLowerCase()] ??
    castes[caste.trim().toLowerCase()] ??
    categories[category.trim().toLowerCase()] ??
    "Unknown"
  );
};

export const runUnitResolve = async (request: z.output<typeof unitResolveSchema>, context: AutomationContext) => {
  const environment = await prepareReferenceEnvironment(
    context,
    request.packPaths,
    request.vanillaPackPaths,
    request.gameDataPath,
    request.withVanilla,
  );
  const locs = await loadLocalization(environment);
  const data = {} as Record<TableName, EffectiveDbRow[]>;
  for (const table of tables) {
    await yieldToEventLoop(context.signal);
    data[table] = await loadEffectiveDbRows(environment, `db\\${table}_tables`);
  }
  const optionalModelTables = new Set<TableName>(["warscape_animated", "warscape_animated_lod"]);
  const missingTables = tables.filter((table) => !optionalModelTables.has(table) && !environment.dbFiles.has(`db\\${table}_tables`));
  if (missingTables.length) environment.complete = false;
  if (missingTables.includes("main_units") || missingTables.includes("land_units")) {
    environment.complete = false;
    environment.diagnostics.push({
      code: "MISSING_UNIT_TABLES",
      message: "Both main_units_tables and land_units_tables are needed for complete unit resolution",
      severity: "warning",
    });
  }
  const indexes = new Map<string, Map<string, EffectiveDbRow[]>>();
  const filter = (table: TableName, field: string, value: string) => {
    const indexKey = `${table}.${field}`;
    let index = indexes.get(indexKey);
    if (!index) {
      index = new Map();
      for (const row of data[table]) {
        const key = text(row, field).toLowerCase();
        const group = index.get(key) ?? [];
        group.push(row);
        index.set(key, group);
      }
      indexes.set(indexKey, index);
    }
    return index.get(value.toLowerCase()) ?? [];
  };
  const find = (table: TableName, field: string, value: string) => filter(table, field, value)[0];
  const name = (key: string) => locs.get(key)?.text;
  const bounded = <T>(items: T[]) => ({ total: items.length, items, truncated: false });
  const previewDetails = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(previewDetails);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record.total === "number" && Array.isArray(record.items)) {
      return {
        ...record,
        items: record.items.slice(0, request.detailLimit).map(previewDetails),
        truncated: record.total > request.detailLimit,
      };
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, previewDetails(item)]));
  };
  const factionMetadata = (key: string) => {
    const faction = find("factions", "key", key);
    const subculture = text(faction, "subculture");
    const culture = text(find("cultures_subcultures", "subculture", subculture), "culture");
    return {
      key,
      name: name(`factions_screen_name_${key}`),
      subculture,
      subcultureName: name(`cultures_subcultures_name_${subculture}`),
      culture,
      cultureName: name(`cultures_name_${culture}`),
      ...(faction ? { evidence: rowEvidence(faction) } : { missing: true }),
    };
  };
  const variantsFor = (variantName: string) => {
    const variant = find("variants", "variant_name", variantName);
    const rawPath = text(variant, "variant_filename");
    const path = rawPath ? toVariantMeshDefinitionPath(rawPath) : "";
    const resolved = path ? resolveReferenceAsset(environment, path, true) : undefined;
    return {
      variantName,
      path,
      status: resolved?.status ?? "missingVariant",
      ...(resolved?.winner ? { packPath: resolved.winner.provider.pack.path } : {}),
      ...(variant ? { evidence: rowEvidence(variant) } : {}),
    };
  };
  const engineModelFor = (engine: EffectiveDbRow | undefined) => {
    const rawModel = text(engine, "model");
    if (!engine || !rawModel || rawModel === ".") return null;
    if (/\.(?:rigid_model_v2|wsmodel|variantmeshdefinition)$/i.test(rawModel)) {
      const resolved = resolveReferenceAsset(environment, rawModel, false);
      const loadMode = rawModel.toLowerCase().endsWith(".rigid_model_v2") ? "direct" as const
        : rawModel.toLowerCase().endsWith(".wsmodel") ? "wsmodel" as const
          : "assetReference" as const;
      return {
        loadMode,
        sourceField: "model",
        value: rawModel,
        path: resolved.path,
        status: resolved.status,
        ...(resolved.winner ? { packPath: resolved.winner.provider.pack.path } : {}),
        ...(resolved.shadowed?.length ? { shadowed: resolved.shadowed.map(({ provider, entry }) => ({ packPath: provider.pack.path, filePath: entry.name })) } : {}),
        evidence: rowEvidence(engine),
      };
    }
    const animated = find("warscape_animated", "key", rawModel);
    if (!animated) {
      return { loadMode: "battlefieldEngineModel" as const, sourceField: "model", value: rawModel, status: "missingAnimatedRow", evidence: rowEvidence(engine) };
    }
    const lodRows = filter("warscape_animated_lod", "animated", text(animated, "key"));
    const lods = lodRows.map((lod) => {
      const modelPath = text(lod, "filename");
      const resolved = modelPath ? resolveReferenceAsset(environment, modelPath, false) : undefined;
      return {
        range: lod.row.range,
        modelPath: resolved?.path ?? modelPath,
        status: resolved?.status ?? "missingFilename",
        ...(resolved?.winner ? { packPath: resolved.winner.provider.pack.path } : {}),
        evidence: rowEvidence(lod),
      };
    });
    return {
      loadMode: "battlefieldEngineModel" as const,
      sourceField: "model",
      value: rawModel,
      status: lods.length && lods.every((lod) => lod.status === "found") ? "found" as const : lods.length ? "incomplete" as const : "missingLodRows" as const,
      evidence: rowEvidence(engine),
      animated: rowEvidence(animated),
      lods,
    };
  };
  const items: unknown[] = [];
  for (const main of data.main_units) {
    await yieldToEventLoop(context.signal);
    const mainKey = text(main, "unit");
    const landKey = text(main, "land_unit");
    const land = find("land_units", "key", landKey);
    const locKey = `land_units_onscreen_name_${landKey}`;
    const localizedName = name(locKey);
    const candidates = request.searchBy === "text" ? [localizedName ?? ""] : [mainKey, landKey];
    if (!candidates.some((candidate) => matchesLookup(candidate, request.query, request.match, request.caseSensitive)))
      continue;
    const issues: Array<{ code: string; message: string }> = [];
    if (!land) issues.push({ code: "MISSING_LAND_UNIT", message: `Land unit ${landKey} was not resolved` });
    const permissions = filter("units_custom_battle_permissions", "unit", mainKey);
    const visualRows = filter("unit_variants", "unit", landKey);
    const scopeRows = permissions.length ? permissions : visualRows;
    const factions = unique(scopeRows.map((row) => text(row, "faction"))).map(factionMetadata);
    const caste = text(main, "caste");
    const landCategory = text(land, "category");
    const group = find("ui_unit_groupings", "key", text(main, "ui_unit_group_land"));
    const parent = text(group, "parent_group");
    const uiGroup = find("ui_unit_group_parents", "key", parent) ? parent : "";
    const category = classifyUnitForOptimization(caste, landCategory, uiGroup);
    const variants = visualRows.map((row) => ({
      faction: text(row, "faction"),
      name: text(row, "name"),
      unitCard: text(row, "unit_card"),
      ...variantsFor(text(row, "variant")),
      evidence: rowEvidence(row),
    }));
    for (const variant of variants)
      if (variant.status !== "found")
        issues.push({
          code: "UNRESOLVED_UNIT_VISUAL",
          message: `Variant ${variant.variantName} has status ${variant.status}`,
        });
    const rawMountKey = text(land, "mount");
    const mountKey = rawMountKey === "." ? "" : rawMountKey;
    const mount = mountKey ? find("mounts", "key", mountKey) : undefined;
    const rawEngineKey = text(land, "engine");
    const engineKey = rawEngineKey === "." ? "" : rawEngineKey;
    const engine = engineKey ? find("battlefield_engines", "key", engineKey) : undefined;
    const engineModel = engineModelFor(engine);
    if (mountKey && !mount) issues.push({ code: "MISSING_MOUNT", message: `Mount ${mountKey} was not resolved` });
    if (engineKey && !engine) issues.push({ code: "MISSING_ENGINE", message: `Engine ${engineKey} was not resolved` });
    if (engineModel && engineModel.status !== "found") issues.push({ code: "UNRESOLVED_ENGINE_MODEL", message: `Engine ${engineKey} model chain has status ${engineModel.status}` });
    const buildings = filter("building_units_allowed", "unit", mainKey).map((row) => ({
      ...rowEvidence(row),
      cultureVariants: bounded(filter("building_culture_variants", "building", text(row, "building")).map(rowEvidence)),
    }));
    const exclusivePermissions = filter("units_to_exclusive_faction_permissions", "key", mainKey);
    const unitSets = data.unit_set_to_unit_junctions.filter((row) => {
      const criteria = [
        ["unit_record", mainKey],
        ["unit_caste", caste],
        ["unit_category", landCategory],
        ["unit_class", text(land, "class")],
      ];
      return (
        criteria.some(([field]) => text(row, field)) &&
        criteria.every(([field, value]) => !text(row, field) || same(text(row, field), value))
      );
    });
    const subtypeRows = data.agent_subtypes.filter((row) => same(text(row, "associated_unit_override"), mainKey));
    const overrides = filter("agent_subtype_subculture_overrides", "associated_unit_override", mainKey);
    const subtypes = unique([
      ...subtypeRows.map((row) => text(row, "key")),
      ...overrides.map((row) => text(row, "subtype")),
    ]);
    const artSets = data.campaign_character_art_sets.filter((row) =>
      subtypes.some((key) => same(key, text(row, "agent_subtype"))),
    );
    const arts = data.campaign_character_arts.filter((row) =>
      artSets.some((set) => same(text(set, "art_set_id"), text(row, "art_set_id"))),
    );
    const uniformNames = unique([
      ...permissions.map((row) => text(row, "general_uniform")),
      ...arts.flatMap((row) => [text(row, "uniform"), text(row, "sea_uniform"), text(row, "navy_uniform")]),
    ]);
    const uniforms = uniformNames.map((key) => {
      const row = find("agent_uniforms", "uniform_name", key);
      const battle = text(row, "battle_filename");
      return {
        key,
        ...(row
          ? {
              evidence: rowEvidence(row),
              battleVariant: variantsFor(battle && battle !== "." ? battle : text(row, "filename")),
            }
          : { missing: true }),
      };
    });
    const extraEngines = filter("land_units_to_extra_engines", "land_unit", landKey).map((row) => {
      const extra = find("battlefield_engines", "key", text(row, "battle_engine"));
      const model = engineModelFor(extra);
      if (model && model.status !== "found") issues.push({ code: "UNRESOLVED_EXTRA_ENGINE_MODEL", message: `Extra engine ${text(row, "battle_engine")} model chain has status ${model.status}` });
      return { evidence: rowEvidence(row), ...(extra ? { engine: rowEvidence(extra), model } : { missing: true }) };
    });
    if (issues.length) environment.complete = false;
    items.push({
      mainUnitKey: mainKey,
      landUnitKey: landKey,
      localizedName,
      locKey,
      mainUnit: rowEvidence(main),
      landUnit: land ? rowEvidence(land) : null,
      roster: {
        scopeSource: permissions.length ? "customBattlePermissions" : "visualFallback",
        unscoped: scopeRows.some((row) => !text(row, "faction")),
        factions: bounded(factions),
        subcultures: unique(factions.map((faction) => faction.subculture)),
        cultures: unique(factions.map((faction) => faction.culture)),
        permissions: bounded(permissions.map(rowEvidence)),
      },
      campaignRecruitment: {
        status: "rulesOnly",
        buildings: bounded(buildings),
        exclusiveFactionPermissions: bounded(exclusivePermissions.map(rowEvidence)),
        mercenaryGroups: bounded(filter("mercenary_unit_groups", "unit_record", mainKey).map(rowEvidence)),
        unitSets: bounded(unitSets.map(rowEvidence)),
      },
      visuals: {
        variants: bounded(variants),
        mount: mount ? { ...rowEvidence(mount), variant: variantsFor(text(mount, "variant")) } : null,
        engine: engine ? { ...rowEvidence(engine), variant: variantsFor(text(engine, "variant")), model: engineModel } : null,
        extraEngines: bounded(extraEngines),
      },
      characters: {
        subtypes: bounded(subtypeRows.map(rowEvidence)),
        subcultureOverrides: bounded(overrides.map(rowEvidence)),
        factionPermissions: bounded(
          data.faction_agent_permitted_subtypes
            .filter((row) => subtypes.includes(text(row, "subtype")))
            .map(rowEvidence),
        ),
        artSets: bounded(artSets.map(rowEvidence)),
        arts: bounded(arts.map(rowEvidence)),
        uniforms: bounded(uniforms),
      },
      optimization: {
        category,
        caste,
        landCategory,
        uiGroup,
        rawCounts: {
          men: main.row.num_men ?? null,
          mounts: land?.row.num_mounts ?? null,
          engines: land?.row.num_engines ?? null,
        },
        issues,
      },
    });
  }
  // A land-only row is still discoverable even if no main unit refers to it.
  const referencedLandKeys = new Set(data.main_units.map((main) => text(main, "land_unit").toLowerCase()));
  for (const land of data.land_units) {
    const key = text(land, "key");
    if (referencedLandKeys.has(key.toLowerCase())) continue;
    const locKey = `land_units_onscreen_name_${key}`;
    const localizedName = name(locKey);
    if (
      matchesLookup(
        request.searchBy === "text" ? (localizedName ?? "") : key,
        request.query,
        request.match,
        request.caseSensitive,
      )
    ) {
      environment.complete = false;
      items.push({
        mainUnitKey: null,
        landUnitKey: key,
        localizedName,
        locKey,
        landUnit: rowEvidence(land),
        optimization: { issues: [{ code: "NO_MAIN_UNIT", message: "No main_units row references this land unit" }] },
      });
    }
  }
  return finishLookup(
    environment,
    request,
    items,
    {
      query: request.query,
      searchBy: request.searchBy,
      missingTables,
      coverage: {
        tables: Object.fromEntries(tables.map((table) => [`${table}_tables`, data[table].length])),
        campaignRecruitment:
          "DB rule evidence only; scripted unlocks, alliances, campaign state, and building availability are not evaluated. Custom-battle permissions are not campaign recruitment guarantees.",
        optimization:
          "Category and raw DB counts plus visual/character joins. Native host scenario scaling, live/dead presence, rigid internals, geometry, LOD, texture, atlas and performance checks are not run.",
        characterVisuals:
          "Candidate art/uniform rows retain faction/subculture/culture conditions; authoritative conditional character-art selection is not evaluated.",
      },
    },
    previewDetails,
  );
};
