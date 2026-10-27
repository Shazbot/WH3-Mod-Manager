import * as fs from "node:fs/promises";
import { z } from "zod";
import { toVariantMeshDefinitionPath } from "../visuals/paths";
import { getSupportedVisualDependencyExtension } from "../visuals/dependencies";
import { AutomationError, throwIfAborted, yieldToEventLoop } from "./errors";
import {
  loadEffectiveDbRows,
  prepareReferenceEnvironment,
  resolveReferenceAsset,
  type EffectiveDbRow,
  type ReferenceEnvironment,
} from "./references";
import { finishLookup, loadLocalization, lookupInputs, matchesLookup, rowEvidence } from "./localization";
import { createIncomingVisualReferenceIndex, type VisualRootChain } from "./graphUsers";
import { collectUnitVisualRoots } from "./visualRoots";
import { normalizePackFilePathKey } from "../utility/packFilePathUtils";
import type { AutomationContext } from "./operations";

export const unitResolveSchema = z
  .object({
    operation: z.literal("unit_resolve"),
    ...lookupInputs,
    query: z.string().min(1).max(2048).optional(),
    queries: z.array(z.string().min(1).max(2048)).min(1).max(1000).optional(),
    searchBy: z.enum(["key", "text", "variant", "mesh"]).default("key"),
    detailLimit: z.number().int().min(1).max(1000).default(100),
    maxDepth: z.number().int().min(0).max(32).default(32),
    maxNodes: z.number().int().min(1).max(1000000).default(100000),
    maxEdges: z.number().int().min(1).max(5000000).default(500000),
    maxRoots: z.number().int().min(1).max(1000000).default(100000),
    maxScanSources: z.number().int().min(1).max(5000000).default(1000000),
    maxIndexEdges: z.number().int().min(1).max(5000000).default(1000000),
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

export interface UnitVisualRoot {
  path: string;
  unitKey: string;
  landUnitKey: string;
  localizedName?: string;
  locKey: string;
  rootKind: "variant" | "mount" | "engine" | "extraEngine" | "characterUniform";
  reason: string;
  scopeSource: "customBattlePermissions" | "visualFallback";
  unscoped: boolean;
  factions: Array<{ key: string; name?: string; subculture: string; culture: string; evidence?: unknown }>;
  customBattlePermissions: unknown[];
  campaignRules: unknown[];
  characterArtCandidates: unknown[];
  evidence: unknown[];
}

export interface UnitVisualRecord {
  unitKey: string;
  landUnitKey: string;
  localizedName?: string;
  locKey: string;
  locEvidence?: { packPath: string; filePath: string; rowIndex: number; key: string };
  scopeSource: "customBattlePermissions" | "visualFallback";
  unscoped: boolean;
  factions: UnitVisualRoot["factions"];
  customBattlePermissions: unknown[];
  campaignRules: unknown[];
  characterArtCandidates: unknown[];
  evidence: unknown[];
}
export interface UnitVisualIndex {
  roots: UnitVisualRoot[];
  units: UnitVisualRecord[];
  missingTables: string[];
}

/** Shared effective-DB joins used by unit resolution and asset-user indexing. */
export const collectUnitVisualIndex = async (environment: ReferenceEnvironment, unitKeys?: ReadonlySet<string>): Promise<UnitVisualIndex> => {
  const resolved = await resolveUnitRecords(environment, undefined, unitKeys);
  for (const table of resolved.missingTables) {
    const entry = {
      code: "UNIT_VISUAL_JOIN_TABLE_MISSING",
      message: `Unit visual joins are incomplete because db\\${table}_tables is unavailable`,
      severity: "warning" as const,
      path: `db\\${table}_tables`,
    };
    if (!environment.diagnostics.some((item) => item.code === entry.code && item.path === entry.path)) environment.diagnostics.push(entry);
  }
  for (const item of resolved.items as Array<Record<string, unknown>>) {
    const optimization = item.optimization && typeof item.optimization === "object" ? item.optimization as Record<string, unknown> : {};
    const issues = Array.isArray(optimization.issues) ? optimization.issues as Array<Record<string, unknown>> : [];
    for (const issue of issues) {
      const code = typeof issue.code === "string" ? issue.code : "UNIT_VISUAL_JOIN_INCOMPLETE";
      const message = typeof issue.message === "string" ? issue.message : "A unit visual join could not be resolved";
      const diagnostic = { code, message, severity: "warning" as const };
      if (!environment.diagnostics.some((current) => current.code === code && current.message === message)) environment.diagnostics.push(diagnostic);
    }
  }
  const units: UnitVisualRecord[] = [];
  const roots: UnitVisualRoot[] = [];
  const rootSeen = new Set<string>();
  const evidenceFrom = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value.flatMap(evidenceFrom);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (typeof record.filePath === "string" && typeof record.rowIndex === "number") return [record];
    return Object.values(record).flatMap(evidenceFrom);
  };
  const add = (item: Record<string, unknown>, rootKind: UnitVisualRoot["rootKind"], reason: string, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const visual = value as Record<string, unknown>;
    const assetPath = typeof visual.path === "string" ? visual.path : typeof visual.modelPath === "string" ? visual.modelPath : undefined;
    if (!assetPath) return;
    const unitKey = String(item.mainUnitKey ?? "");
    const landUnitKey = String(item.landUnitKey ?? "");
    const identity = JSON.stringify([normalizeRootPath(assetPath), unitKey, landUnitKey, rootKind, reason]);
    if (rootSeen.has(identity)) return;
    rootSeen.add(identity);
    const roster = item.roster && typeof item.roster === "object" ? item.roster as Record<string, unknown> : {};
    const permissions = roster.permissions && typeof roster.permissions === "object" ? (roster.permissions as { items?: unknown[] }).items ?? [] : [];
    const campaign = item.campaignRecruitment && typeof item.campaignRecruitment === "object" ? item.campaignRecruitment as Record<string, unknown> : {};
    const characters = item.characters && typeof item.characters === "object" ? item.characters as Record<string, unknown> : {};
    const campaignRules = [campaign.buildings, campaign.exclusiveFactionPermissions, campaign.mercenaryGroups, campaign.unitSets];
    const characterArtCandidates = [characters.subtypes, characters.subcultureOverrides, characters.factionPermissions, characters.artSets, characters.arts, characters.uniforms];
    const rootEvidence = [item.mainUnit, item.landUnit, roster.factions, permissions, campaignRules, characterArtCandidates, visual.evidence, visual];
    roots.push({
      path: assetPath,
      unitKey,
      landUnitKey,
      localizedName: typeof item.localizedName === "string" ? item.localizedName : undefined,
      locKey: String(item.locKey ?? ""),
      rootKind,
      reason,
      scopeSource: roster.scopeSource === "customBattlePermissions" ? "customBattlePermissions" : "visualFallback",
      unscoped: Boolean(roster.unscoped),
      factions: roster.factions && typeof roster.factions === "object" && Array.isArray((roster.factions as { items?: unknown[] }).items)
        ? (roster.factions as { items: UnitVisualRoot["factions"] }).items
        : [],
      customBattlePermissions: permissions,
      campaignRules,
      characterArtCandidates,
      evidence: evidenceFrom(rootEvidence),
    });
  };
  const resolvedUnits = resolved.items as Array<Record<string, unknown>>;
  environment.context.progress?.({ stage: "hydration", completed: 0, total: resolvedUnits.length, units: 0,
    message: "Hydrating unit evidence" });
  let hydratedUnits = 0;
  for (const value of resolvedUnits) {
    throwIfAborted(environment.context.signal);
    if ((hydratedUnits++ & 127) === 0) await yieldToEventLoop(environment.context.signal);
    if ((hydratedUnits & 255) === 0 || hydratedUnits === resolvedUnits.length) environment.context.progress?.({
      stage: "hydration", completed: hydratedUnits, total: resolvedUnits.length, units: hydratedUnits,
      message: `Hydrated ${hydratedUnits} of ${resolvedUnits.length} units`,
    });
    const unitKey = String(value.mainUnitKey ?? "");
    const landUnitKey = String(value.landUnitKey ?? "");
    const roster = value.roster && typeof value.roster === "object" ? value.roster as Record<string, unknown> : {};
    const permissions = roster.permissions && typeof roster.permissions === "object" ? (roster.permissions as { items?: unknown[] }).items ?? [] : [];
    const campaign = value.campaignRecruitment && typeof value.campaignRecruitment === "object" ? value.campaignRecruitment as Record<string, unknown> : {};
    const characters = value.characters && typeof value.characters === "object" ? value.characters as Record<string, unknown> : {};
    const campaignRules = [campaign.buildings, campaign.exclusiveFactionPermissions, campaign.mercenaryGroups, campaign.unitSets].flatMap(evidenceFrom);
    const characterArtCandidates = [characters.subtypes, characters.subcultureOverrides, characters.factionPermissions, characters.artSets, characters.arts, characters.uniforms].flatMap(evidenceFrom);
    const baseEvidence = [value.mainUnit, value.landUnit, roster.factions, permissions, campaignRules, characterArtCandidates, value.visuals].flatMap(evidenceFrom);
    units.push({
      unitKey,
      landUnitKey,
      localizedName: typeof value.localizedName === "string" ? value.localizedName : undefined,
      locKey: String(value.locKey ?? ""),
      ...(value.locEvidence && typeof value.locEvidence === "object" ? { locEvidence: value.locEvidence as UnitVisualRecord["locEvidence"] } : {}),
      scopeSource: roster.scopeSource === "customBattlePermissions" ? "customBattlePermissions" : "visualFallback",
      unscoped: Boolean(roster.unscoped),
      factions: roster.factions && typeof roster.factions === "object" && Array.isArray((roster.factions as { items?: unknown[] }).items)
        ? (roster.factions as { items: UnitVisualRoot["factions"] }).items
        : [],
      customBattlePermissions: permissions,
      campaignRules,
      characterArtCandidates,
      evidence: baseEvidence,
    });
    const visuals = value.visuals && typeof value.visuals === "object" ? value.visuals as Record<string, unknown> : {};
    const variants = visuals.variants && typeof visuals.variants === "object" ? (visuals.variants as { items?: unknown[] }).items ?? [] : [];
    for (const visual of variants) add(value, "variant", "unit variant", visual);
    const mount = visuals.mount && typeof visuals.mount === "object" ? visuals.mount as Record<string, unknown> : undefined;
    if (mount?.variant) add(value, "mount", "land unit mount", mount.variant);
    const engine = visuals.engine && typeof visuals.engine === "object" ? visuals.engine as Record<string, unknown> : undefined;
    if (engine?.variant) add(value, "engine", "land unit engine variant", engine.variant);
    if (engine?.model && typeof engine.model === "object") {
      const model = engine.model as Record<string, unknown>;
      add(value, "engine", "land unit engine model", model);
      for (const lod of (model.lods as unknown[] | undefined) ?? []) add(value, "engine", "land unit engine LOD", lod);
    }
    const extras = visuals.extraEngines && typeof visuals.extraEngines === "object" ? (visuals.extraEngines as { items?: unknown[] }).items ?? [] : [];
    for (const extra of extras) {
      if (!extra || typeof extra !== "object") continue;
      const item = extra as Record<string, unknown>;
      const model = item.model && typeof item.model === "object" ? item.model as Record<string, unknown> : undefined;
      if (model) {
        add(value, "extraEngine", "extra engine model", model);
        for (const lod of (model.lods as unknown[] | undefined) ?? []) add(value, "extraEngine", "extra engine LOD", lod);
      }
      const variant = item.variant;
      if (variant) add(value, "extraEngine", "extra engine variant", variant);
    }
    const uniforms = characters.uniforms && typeof characters.uniforms === "object" ? (characters.uniforms as { items?: unknown[] }).items ?? [] : [];
    for (const uniform of uniforms) {
      if (uniform && typeof uniform === "object") add(value, "characterUniform", "character uniform candidate", (uniform as Record<string, unknown>).battleVariant);
    }
  }
  if (hydratedUnits !== resolvedUnits.length) environment.context.progress?.({
    stage: "hydration", completed: hydratedUnits, total: resolvedUnits.length, units: hydratedUnits,
    message: `Hydrated ${hydratedUnits} of ${resolvedUnits.length} units`,
  });
  return { roots, units, missingTables: resolved.missingTables };
};
const normalizeRootPath = (value: string) => value.replace(/\\/g, "/").toLowerCase();

const resolveUnitRecords = async (
  environment: ReferenceEnvironment,
  request?: Pick<z.output<typeof unitResolveSchema>, "query" | "queries" | "searchBy" | "match" | "caseSensitive" | "detailLimit">,
  unitKeys?: ReadonlySet<string>,
) => {
  const context = environment.context;
  const locs = await loadLocalization(environment);
  const data = {} as Record<TableName, EffectiveDbRow[]>;
  for (const table of tables) {
    await yieldToEventLoop(context.signal);
    data[table] = await loadEffectiveDbRows(environment, `db\\${table}_tables`);
  }
  const optionalModelTables = new Set<TableName>(["warscape_animated", "warscape_animated_lod"]);
  const missingTables = tables.filter(
    (table) => !optionalModelTables.has(table) && !environment.dbFiles.has(`db\\${table}_tables`),
  );
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
  const rowOrder = new Map<TableName, Map<EffectiveDbRow, number>>();
  const matchingRows = (table: TableName, selectors: ReadonlyArray<readonly [string, string]>) => {
    const matches = new Set(selectors.flatMap(([field, value]) => filter(table, field, value)));
    if (matches.size < 2) return [...matches];
    let order = rowOrder.get(table);
    if (!order) {
      order = new Map(data[table].map((row, index) => [row, index]));
      rowOrder.set(table, order);
    }
    const positions = order;
    return [...matches].sort((a, b) => positions.get(a)! - positions.get(b)!);
  };
  const name = (key: string) => locs.get(key)?.text;
  const localizationEvidence = (key: string) => {
    const entry = locs.get(key);
    return entry ? { packPath: entry.packPath, filePath: entry.filePath, rowIndex: entry.rowIndex, key: entry.locKey } : undefined;
  };
  const bounded = <T>(items: T[]) => ({ total: items.length, items, truncated: false });
  const previewDetails = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(previewDetails);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (typeof record.total === "number" && Array.isArray(record.items)) {
      return {
        ...record,
          items: record.items.slice(0, request?.detailLimit ?? 100).map(previewDetails),
          truncated: record.total > (request?.detailLimit ?? 100),
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
      const loadMode = rawModel.toLowerCase().endsWith(".rigid_model_v2")
        ? ("direct" as const)
        : rawModel.toLowerCase().endsWith(".wsmodel")
          ? ("wsmodel" as const)
          : ("assetReference" as const);
      return {
        loadMode,
        sourceField: "model",
        value: rawModel,
        path: resolved.path,
        status: resolved.status,
        ...(resolved.winner ? { packPath: resolved.winner.provider.pack.path } : {}),
        ...(resolved.shadowed?.length
          ? {
              shadowed: resolved.shadowed.map(({ provider, entry }) => ({
                packPath: provider.pack.path,
                filePath: entry.name,
              })),
            }
          : {}),
        evidence: rowEvidence(engine),
      };
    }
    const animated = find("warscape_animated", "key", rawModel);
    if (!animated) {
      return {
        loadMode: "battlefieldEngineModel" as const,
        sourceField: "model",
        value: rawModel,
        status: "missingAnimatedRow",
        evidence: rowEvidence(engine),
      };
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
      status:
        lods.length && lods.every((lod) => lod.status === "found")
          ? ("found" as const)
          : lods.length
            ? ("incomplete" as const)
            : ("missingLodRows" as const),
      evidence: rowEvidence(engine),
      animated: rowEvidence(animated),
      lods,
    };
  };
  const items: unknown[] = [];
  const queryValues = request?.queries ?? (request?.query ? [request.query] : []);
  const itemsByQuery: unknown[][] = queryValues.map(() => []);
  for (const main of data.main_units) {
    if (unitKeys && !unitKeys.has(text(main, "unit"))) continue;
    await yieldToEventLoop(context.signal);
    const mainKey = text(main, "unit");
    const landKey = text(main, "land_unit");
    const land = find("land_units", "key", landKey);
    const locKey = `land_units_onscreen_name_${landKey}`;
    const localizedName = name(locKey);
    const visualRows = filter("unit_variants", "unit", landKey);
    const mountForSearch = find("mounts", "key", text(land, "mount"));
    const engineForSearch = find("battlefield_engines", "key", text(land, "engine"));
    const extraEngineRowsForSearch = filter("land_units_to_extra_engines", "land_unit", landKey)
      .map((row) => find("battlefield_engines", "key", text(row, "battle_engine")))
      .filter((row): row is EffectiveDbRow => Boolean(row));
    const variantNames = unique([
      ...visualRows.map((row) => text(row, "variant")),
      text(mountForSearch, "variant"),
      text(engineForSearch, "variant"),
      ...extraEngineRowsForSearch.map((row) => text(row, "variant")),
    ]);
    const meshPaths = unique(variantNames.map((variantName) => variantsFor(variantName).path));
    const searchBy = request?.searchBy ?? "key";
    const searchCandidates =
      searchBy === "text"
        ? [localizedName ?? ""]
        : searchBy === "variant"
          ? variantNames
          : searchBy === "mesh"
            ? meshPaths.map(normalizeRootPath)
            : [mainKey, landKey];
    const matchedQueryIndexes = request ? queryValues.flatMap((query, index) => {
      const normalizedQuery = searchBy === "mesh" ? normalizeRootPath(query) : query;
      return searchCandidates.some((candidate) => matchesLookup(candidate, normalizedQuery, request.match, request.caseSensitive)) ? [index] : [];
    }) : [];
    if (request && !matchedQueryIndexes.length) continue;
    const issues: Array<{ code: string; message: string }> = [];
    if (!land) issues.push({ code: "MISSING_LAND_UNIT", message: `Land unit ${landKey} was not resolved` });
    const permissions = filter("units_custom_battle_permissions", "unit", mainKey);
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
    const mountVariant = mount ? variantsFor(text(mount, "variant")) : undefined;
    const engineVariant = engine ? variantsFor(text(engine, "variant")) : undefined;
    const engineModel = engineModelFor(engine);
    if (mountKey && !mount) issues.push({ code: "MISSING_MOUNT", message: `Mount ${mountKey} was not resolved` });
    if (engineKey && !engine) issues.push({ code: "MISSING_ENGINE", message: `Engine ${engineKey} was not resolved` });
    if (engineModel && engineModel.status !== "found")
      issues.push({
        code: "UNRESOLVED_ENGINE_MODEL",
        message: `Engine ${engineKey} model chain has status ${engineModel.status}`,
      });
    const buildings = filter("building_units_allowed", "unit", mainKey).map((row) => ({
      ...rowEvidence(row),
      cultureVariants: bounded(filter("building_culture_variants", "building", text(row, "building")).map(rowEvidence)),
    }));
    const exclusivePermissions = filter("units_to_exclusive_faction_permissions", "key", mainKey);
    const criteria: Array<[string, string]> = [
      ["unit_record", mainKey],
      ["unit_caste", caste],
      ["unit_category", landCategory],
      ["unit_class", text(land, "class")],
    ];
    const unitSets = matchingRows("unit_set_to_unit_junctions", criteria.filter(([, value]) => value)).filter((row) => {
      return (
        criteria.some(([field]) => text(row, field)) &&
        criteria.every(([field, value]) => !text(row, field) || same(text(row, field), value))
      );
    });
    const subtypeRows = filter("agent_subtypes", "associated_unit_override", mainKey);
    const overrides = filter("agent_subtype_subculture_overrides", "associated_unit_override", mainKey);
    const subtypes = unique([
      ...subtypeRows.map((row) => text(row, "key")),
      ...overrides.map((row) => text(row, "subtype")),
    ]);
    const artSets = matchingRows("campaign_character_art_sets", subtypes.map((key) => ["agent_subtype", key]));
    const arts = matchingRows("campaign_character_arts", artSets.map((set) => ["art_set_id", text(set, "art_set_id")]));
    const uniformNames = unique([
      ...permissions.map((row) => text(row, "general_uniform")),
      ...arts.flatMap((row) => [text(row, "uniform"), text(row, "sea_uniform"), text(row, "navy_uniform")]),
    ]);
    const uniforms = uniformNames.map((key) => {
      const row = find("agent_uniforms", "uniform_name", key);
      const battle = text(row, "battle_filename");
      if (!row) issues.push({ code: "MISSING_AGENT_UNIFORM", message: `Agent uniform ${key} was not resolved` });
      const battleVariant = row ? variantsFor(battle && battle !== "." ? battle : text(row, "filename")) : undefined;
      if (battleVariant && battleVariant.status !== "found") {
        issues.push({ code: "UNRESOLVED_CHARACTER_UNIFORM", message: `Agent uniform ${key} variant has status ${battleVariant.status}` });
      }
      return {
        key,
        ...(row
          ? {
              evidence: rowEvidence(row),
              battleVariant,
            }
          : { missing: true }),
      };
    });
    const extraEngines = filter("land_units_to_extra_engines", "land_unit", landKey).map((row) => {
      const extra = find("battlefield_engines", "key", text(row, "battle_engine"));
      const model = engineModelFor(extra);
      if (!extra) issues.push({ code: "MISSING_EXTRA_ENGINE", message: `Extra engine ${text(row, "battle_engine")} was not resolved` });
      const variant = extra ? variantsFor(text(extra, "variant")) : undefined;
      if (variant && variant.status !== "found") issues.push({ code: "UNRESOLVED_EXTRA_ENGINE_VARIANT", message: `Extra engine ${text(row, "battle_engine")} variant has status ${variant.status}` });
      if (model && model.status !== "found")
        issues.push({
          code: "UNRESOLVED_EXTRA_ENGINE_MODEL",
          message: `Extra engine ${text(row, "battle_engine")} model chain has status ${model.status}`,
        });
      return {
        evidence: rowEvidence(row),
        ...(extra
          ? { engine: rowEvidence(extra), variant, model }
          : { missing: true }),
      };
    });
    if (mountVariant && mountVariant.status !== "found")
      issues.push({ code: "UNRESOLVED_MOUNT_VARIANT", message: `Mount ${mountKey} variant has status ${mountVariant.status}` });
    if (engineVariant && engineVariant.status !== "found")
      issues.push({ code: "UNRESOLVED_ENGINE_VARIANT", message: `Engine ${engineKey} variant has status ${engineVariant.status}` });
    if (issues.length) environment.complete = false;
    const unitItem = {
      mainUnitKey: mainKey,
      landUnitKey: landKey,
      localizedName,
      locKey,
      ...(localizationEvidence(locKey) ? { locEvidence: localizationEvidence(locKey) } : {}),
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
        mount: mount ? { ...rowEvidence(mount), variant: mountVariant } : null,
        engine: engine
          ? { ...rowEvidence(engine), variant: engineVariant, model: engineModel }
          : null,
        extraEngines: bounded(extraEngines),
      },
      characters: {
        subtypes: bounded(subtypeRows.map(rowEvidence)),
        subcultureOverrides: bounded(overrides.map(rowEvidence)),
        factionPermissions: bounded(
          matchingRows("faction_agent_permitted_subtypes", subtypes.map((key) => ["subtype", key]))
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
    };
    items.push(unitItem);
    for (const index of matchedQueryIndexes) itemsByQuery[index].push(unitItem);
  }
  // A land-only row is still discoverable even if no main unit refers to it.
  const referencedLandKeys = new Set(data.main_units.map((main) => text(main, "land_unit").toLowerCase()));
  for (const land of data.land_units) {
    if (unitKeys && !unitKeys.has(text(land, "key"))) continue;
    const key = text(land, "key");
    if (referencedLandKeys.has(key.toLowerCase())) continue;
    const locKey = `land_units_onscreen_name_${key}`;
    const localizedName = name(locKey);
    const matchedQueryIndexes = request ? queryValues.flatMap((query, index) =>
      matchesLookup(request.searchBy === "text" ? (localizedName ?? "") : key, query, request.match, request.caseSensitive) ? [index] : []) : [];
    if (!request || matchedQueryIndexes.length) {
      environment.complete = false;
      const unitItem = {
        mainUnitKey: null,
        landUnitKey: key,
        localizedName,
        locKey,
        ...(localizationEvidence(locKey) ? { locEvidence: localizationEvidence(locKey) } : {}),
        landUnit: rowEvidence(land),
        optimization: { issues: [{ code: "NO_MAIN_UNIT", message: "No main_units row references this land unit" }] },
      };
      items.push(unitItem);
      for (const index of matchedQueryIndexes) itemsByQuery[index].push(unitItem);
    }
  }
  return {
    items,
    itemsByQuery,
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
    previewDetails,
  };
};

export const runUnitResolve = async (request: z.output<typeof unitResolveSchema>, context: AutomationContext) => {
  if (Boolean(request.query) === Boolean(request.queries))
    throw new AutomationError("INVALID_ARGUMENT", "unit resolve requires exactly one of query or queries");
  const queryValues = request.queries ?? [request.query!];
  const environment = await prepareReferenceEnvironment(
    context,
    request.packPaths,
    request.vanillaPackPaths,
    request.gameDataPath,
    request.withVanilla,
    request.searchBy === "mesh",
  );
  if (request.searchBy === "mesh") {
    // Mesh queries can name a VMD, WSModel, or rigid model. Resolve matching supported
    // source paths first, then walk the shared incoming index back to source-proven roots.
    context.progress?.({ stage: "roots", completed: 0, total: queryValues.length, paths: queryValues.length, message: "Discovering unit visual roots" });
    const rootScan = await collectUnitVisualRoots(environment, false);
    const targetPackPath = request.packPaths.at(-1) ?? request.packPaths[0];
    const rankedRoots = rootScan.roots.map((root, index) => {
      const provider = resolveReferenceAsset(environment, root.path).winner?.provider;
      const rank = provider ? provider.pack.path === targetPackPath ? 0 : provider.kind === "mod" ? 1 : 2 : 3;
      return { root, index, rank };
    }).sort((left, right) => left.rank - right.rank || left.index - right.index);
    const selectedRoots = rankedRoots.slice(0, request.maxRoots).map(({ root }) => root);
    const rootLimitHit = rootScan.roots.length > request.maxRoots;
    const normalizedQueries = queryValues.map(normalizeRootPath);
    const targetsByQuery = queryValues.map(() => new Set<string>());
    const targetPathsByKey = new Map<string, string>();
    for (const key of environment.assetCandidates.keys()) {
      const extension = getSupportedVisualDependencyExtension(key);
      if (!extension) continue;
      const normalizedPath = normalizeRootPath(key);
      for (let queryIndex = 0; queryIndex < queryValues.length; queryIndex++) {
        if (matchesLookup(normalizedPath, normalizedQueries[queryIndex], request.match, request.caseSensitive)) {
          const candidates = environment.assetCandidates.get(key) ?? [];
          const entryPath = candidates.at(-1)?.entry.name ?? key;
          const targetKey = normalizePackFilePathKey(key);
          targetsByQuery[queryIndex].add(targetKey);
          targetPathsByKey.set(targetKey, entryPath);
        }
      }
    }
    for (let queryIndex = 0; queryIndex < queryValues.length; queryIndex++) {
      if (request.match !== "exact") continue;
      const resolution = resolveReferenceAsset(environment, queryValues[queryIndex], true);
      if (resolution.status === "found" && resolution.winner) {
        const key = normalizePackFilePathKey(resolution.key);
        targetsByQuery[queryIndex].add(key);
        targetPathsByKey.set(key, resolution.path);
      }
    }
    let candidateLimitHit = false;
    const targetKeys = [...targetPathsByKey.keys()];
    if (targetKeys.length > request.maxNodes) {
      targetKeys.length = request.maxNodes;
      candidateLimitHit = true;
      const allowed = new Set(targetKeys);
      for (const keys of targetsByQuery) for (const key of keys) if (!allowed.has(key)) keys.delete(key);
    }
    const effectiveTargets = targetKeys.map((key) => targetPathsByKey.get(key)!);
    const incoming = await createIncomingVisualReferenceIndex(environment, selectedRoots.length ? effectiveTargets : [], {
      maxSources: request.maxScanSources,
      maxIndexEdges: request.maxIndexEdges,
    });
    context.progress?.({ stage: "traversal", completed: 0, total: queryValues.length, paths: effectiveTargets.length,
      message: "Walking incoming visual references" });
    const traversal = await incoming.findMany(effectiveTargets, selectedRoots, {
      maxDepth: request.maxDepth,
      maxNodes: request.maxNodes,
      maxEdges: request.maxEdges,
    });
    const matchedByQuery = queryValues.map((_query, index) => {
      const matches = new Map<string, VisualRootChain & { queryPath: string }>();
      for (const targetKey of targetsByQuery[index]) {
        for (const match of traversal.matches.get(targetKey) ?? []) {
          const signature = JSON.stringify([match.root.unitKey, match.root.landUnitKey, match.root.path, targetPathsByKey.get(targetKey), match.chain]);
          matches.set(signature, { ...match, queryPath: targetPathsByKey.get(targetKey) ?? targetKey });
        }
      }
      return [...matches.values()].map((match) => ({
        unitKey: match.root.unitKey,
        landUnitKey: match.root.landUnitKey,
        rootPath: match.root.path,
        rootKind: match.root.rootKind,
        queryPath: match.queryPath,
        reason: match.root.reason,
        chain: match.chain,
      }));
    });
    const matchedKeys = new Set(matchedByQuery.flatMap((matches) => matches.map((match) => match.unitKey)).filter(Boolean));
    const resolved = matchedKeys.size ? await resolveUnitRecords(environment, undefined, matchedKeys) : {
      items: [], itemsByQuery: [], missingTables: [], coverage: { tables: {}, campaignRecruitment: "", optimization: "", characterVisuals: "" }, previewDetails: (item: unknown) => item,
    };
    const unitIdentity = (item: unknown) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return `${String(record.mainUnitKey ?? "")}\0${String(record.landUnitKey ?? "")}`;
    };
    if (rootLimitHit) environment.diagnostics.push({ code: "UNIT_MESH_ROOT_LIMIT", message: `Unit mesh lookup reached maxRoots (${request.maxRoots})`, severity: "warning" });
    if (candidateLimitHit) environment.diagnostics.push({ code: "UNIT_MESH_TARGET_LIMIT", message: `Unit mesh lookup reached maxNodes (${request.maxNodes}) while selecting matching asset paths`, severity: "warning" });
    environment.diagnostics.push(...incoming.diagnostics);
    const queryRecords = queryValues.map((query, index) => {
      const rootMatches = matchedByQuery[index];
      const identities = new Set(rootMatches.map((match) => `${match.unitKey}\0${match.landUnitKey}`));
      const items = resolved.items.filter((item) => identities.has(unitIdentity(item)));
      const pathKeys = [...targetsByQuery[index]];
      const pathCoverage = pathKeys.map((key) => traversal.coverageByPath.get(key));
      const complete = environment.complete && !rootLimitHit && !candidateLimitHit && incoming.complete &&
        pathCoverage.every((value) => value?.complete);
      return {
        query,
        searchBy: request.searchBy,
        match: request.match,
        complete,
        total: items.length,
        offset: request.offset,
        limit: request.limit,
        nextOffset: request.offset + request.limit < items.length ? request.offset + request.limit : null,
        hasMore: request.offset + request.limit < items.length,
        items: items.slice(request.offset, request.offset + request.limit).map(resolved.previewDetails),
        matchedMeshes: rootMatches,
        coverage: {
          candidatePaths: pathKeys.length,
          matchedRoots: rootMatches.length,
          reversePathWalks: pathCoverage.reduce((sum, value) => sum + (value?.walks ?? 0), 0),
          maxScanSources: request.maxScanSources,
          maxIndexEdges: request.maxIndexEdges,
          maxRoots: request.maxRoots,
          unresolvedPaths: pathKeys.filter((key) => !traversal.coverageByPath.get(key)?.complete),
        },
      };
    });
    if (rootLimitHit || candidateLimitHit || !incoming.complete || queryRecords.some((result) => !result.complete))
      environment.complete = false;
    if (queryValues.length === 1 && !request.queries) {
      return finishLookup(environment, request, resolved.items.filter((item) => {
        const identity = unitIdentity(item);
        return new Set(matchedByQuery[0].map((match) => `${match.unitKey}\0${match.landUnitKey}`)).has(identity);
      }), {
        query: queryValues[0],
        searchBy: request.searchBy,
        missingTables: resolved.missingTables,
        coverage: resolved.coverage,
        meshCoverage: queryRecords[0].coverage,
        matchedMeshes: queryRecords[0].matchedMeshes,
      }, resolved.previewDetails);
    }
    const fullResults = queryRecords.map((result, index) => ({ ...result,
      items: resolved.items.filter((item) => new Set(matchedByQuery[index].map((match) => `${match.unitKey}\0${match.landUnitKey}`)).has(unitIdentity(item))) }));
    const reportData = { searchBy: request.searchBy, queries: queryValues, results: fullResults,
      complete: environment.complete && queryRecords.every((result) => result.complete),
      missingTables: resolved.missingTables, coverage: resolved.coverage, diagnostics: environment.diagnostics };
    let reportPath: string | undefined;
    if (request.reportPath) reportPath = (await context.policy.withAtomicOutput({ outputPath: request.reportPath,
      sourcePaths: environment.sourcePaths,
      produce: (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(reportData, null, 2)}\n`),
    })).path;
    return { data: { ...reportData, results: queryRecords, ...(reportPath ? { reportPath } : {}) }, diagnostics: environment.diagnostics };
  }

  const resolved = await resolveUnitRecords(environment, { ...request, queries: queryValues });
  const metadata = { searchBy: request.searchBy, missingTables: resolved.missingTables, coverage: resolved.coverage };
  if (queryValues.length === 1 && !request.queries)
    return finishLookup(environment, request, resolved.itemsByQuery[0] ?? [], { ...metadata, query: queryValues[0] }, resolved.previewDetails);
  const results = queryValues.map((query, index) => {
    const items = resolved.itemsByQuery[index] ?? [];
    const pageItems = items.slice(request.offset, request.offset + request.limit).map(resolved.previewDetails);
    const hasMore = request.offset + pageItems.length < items.length;
    return { query, searchBy: request.searchBy, complete: environment.complete, total: items.length,
      offset: request.offset, limit: request.limit, hasMore, nextOffset: hasMore ? request.offset + pageItems.length : null, items: pageItems };
  });
  const fullResults = queryValues.map((query, index) => ({ ...results[index], items: resolved.itemsByQuery[index] ?? [] }));
  const reportData = { ...metadata, queries: queryValues, results: fullResults, complete: environment.complete,
    diagnostics: environment.diagnostics };
  let reportPath: string | undefined;
  if (request.reportPath) reportPath = (await context.policy.withAtomicOutput({ outputPath: request.reportPath,
    sourcePaths: environment.sourcePaths,
    produce: (temporaryPath) => fs.writeFile(temporaryPath, `${JSON.stringify(reportData, null, 2)}\n`),
  })).path;
  return { data: { ...reportData, results, ...(reportPath ? { reportPath } : {}) }, diagnostics: environment.diagnostics };
};
