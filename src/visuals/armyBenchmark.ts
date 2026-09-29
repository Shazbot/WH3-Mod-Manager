export const ARMY_BENCHMARK_FILE_KIND = "whmm-atlas-army-benchmark" as const;
export const ARMY_BENCHMARK_FILE_VERSION = 2 as const;

export const ARMY_BENCHMARK_TEMPLATE = {
  Lord: 1,
  Hero: 2,
  InfantryMissile: 9,
  CavalryChariot: 4,
  MonsterBeast: 3,
  ArtilleryWarMachine: 2,
} as const;

export type ArmyBenchmarkCategory = keyof typeof ARMY_BENCHMARK_TEMPLATE;
export type ArmyBenchmarkVisualRole = "men" | "mounts" | "engines" | "crew" | "asset";
export type ArmyBenchmarkVisualState = "live" | "destroyed" | "destruct";
export type ArmyBenchmarkRoundingPolicy = "ceil" | "round" | "floor";
export type ArmyBenchmarkRosterScopeKind = "all" | "culture" | "faction" | "mod" | "optimized-assets";

export type ArmyBenchmarkRosterScope = {
  kind: ArmyBenchmarkRosterScopeKind;
  key?: string;
};

export type ArmyVisualScenario = {
  unitSizeScale: number;
  crewScale: number;
  engineRoundingPolicy: ArmyBenchmarkRoundingPolicy;
  lodDistribution: Record<string, number>;
  destructionProbability: number;
  destructTransitionProbability: number;
  armySlotTemplate: Record<ArmyBenchmarkCategory, number>;
  rosterScope: ArmyBenchmarkRosterScope;
};

export const DEFAULT_ARMY_VISUAL_SCENARIO: ArmyVisualScenario = {
  unitSizeScale: 0.75,
  crewScale: 0.5,
  engineRoundingPolicy: "ceil",
  lodDistribution: { "0": 1 },
  destructionProbability: 0,
  destructTransitionProbability: 0,
  armySlotTemplate: { ...ARMY_BENCHMARK_TEMPLATE },
  rosterScope: { kind: "all" },
};

export type ArmyBenchmarkCandidate = {
  unitKey: string;
  faction: string;
  localizedName: string;
  variantMeshPath?: string;
  originPackPath: string;
  cultureKey?: string;
  cultures?: Array<{ key: string; name: string }>;
  caste?: string;
  numMen?: number;
  numMounts?: number;
  numEngines?: number;
  mountVariantMeshPath?: string;
  engineVariantMeshPath?: string;
  engineType?: string;
  uiGroupKey?: string;
};

export type ArmyBenchmarkVisualAsset = {
  assetPath: string;
  entities: number;
  role: ArmyBenchmarkVisualRole;
  state: ArmyBenchmarkVisualState;
  lod: number;
  probability: number;
};

export type SingleUnitBenchmarkAsset = ArmyBenchmarkVisualAsset;

export const GENERIC_BENCHMARK_COUNTS = [1, 10, 25, 50, 100, 250] as const;
export const GENERIC_BENCHMARK_ENTITY_BUDGET = 250;

export type ArmyBenchmarkRosterUnit = {
  slot: number;
  category: ArmyBenchmarkCategory;
  unitKey: string;
  faction: string;
  name: string;
  /** Primary live asset retained as a compact display/back-compat field. */
  assetPath: string;
  /** Total live visual entities across all component assets. */
  entities: number;
  assets: ArmyBenchmarkVisualAsset[];
  cultureKey?: string;
  originPackPath?: string;
};

export type ArmyBenchmarkRosterFile = {
  kind: typeof ARMY_BENCHMARK_FILE_KIND;
  version: typeof ARMY_BENCHMARK_FILE_VERSION;
  generatedAt: string;
  sourcePackPath?: string;
  cultureKey?: string;
  scenario: ArmyVisualScenario;
  template: Record<ArmyBenchmarkCategory, number>;
  units: ArmyBenchmarkRosterUnit[];
};

export type ArmyBenchmarkAssetEntry = {
  assetPath: string;
  entities: number;
  names: string[];
  roles?: ArmyBenchmarkVisualRole[];
};

export type ArmyBenchmarkAssetLoadFailure = {
  entry: ArmyBenchmarkAssetEntry;
  error: string;
};

const TEMPLATE_CATEGORIES = Object.keys(ARMY_BENCHMARK_TEMPLATE) as ArmyBenchmarkCategory[];
const ROSTER_SCOPE_KINDS: readonly ArmyBenchmarkRosterScopeKind[] = [
  "all",
  "culture",
  "faction",
  "mod",
  "optimized-assets",
];
const normalizePath = (value: string) => value.replace(/\//g, "\\").toLowerCase();
const normalizeKey = (value?: string) => (value || "").trim().toLowerCase();

const positiveEntityCount = (value: unknown) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.max(1, Math.round(count)) : 0;
};

const clampProbability = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
};

const normalizeScale = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const scaleEntityCount = (
  rawCount: number,
  scale: number,
  roundingPolicy: ArmyBenchmarkRoundingPolicy,
) => {
  if (rawCount <= 0) return 0;
  const scaled = rawCount * scale;
  const rounded = roundingPolicy === "floor"
    ? Math.floor(scaled)
    : roundingPolicy === "round"
      ? Math.round(scaled)
      : Math.ceil(scaled);
  return Math.max(1, rounded);
};

const isCrewedEngine = (engineType?: string) => {
  const normalized = normalizeKey(engineType);
  return normalized.includes("crew") && !normalized.includes("no_crew");
};

export const normalizeArmyVisualScenario = (
  scenario?: Partial<ArmyVisualScenario>,
): ArmyVisualScenario => {
  const template = { ...ARMY_BENCHMARK_TEMPLATE } as Record<ArmyBenchmarkCategory, number>;
  for (const category of TEMPLATE_CATEGORIES) {
    const count = Number(scenario?.armySlotTemplate?.[category]);
    if (Number.isSafeInteger(count) && count >= 0) template[category] = count;
  }

  const rounding = scenario?.engineRoundingPolicy;
  const engineRoundingPolicy: ArmyBenchmarkRoundingPolicy =
    rounding === "floor" || rounding === "round" || rounding === "ceil" ? rounding : "ceil";

  const lodDistribution: Record<string, number> = {};
  for (const [lod, probability] of Object.entries(scenario?.lodDistribution || { "0": 1 })) {
    const parsedLod = Number(lod);
    const parsedProbability = Number(probability);
    if (Number.isInteger(parsedLod) && parsedLod >= 0 && Number.isFinite(parsedProbability) && parsedProbability > 0) {
      lodDistribution[String(parsedLod)] = parsedProbability;
    }
  }
  const lodTotal = Object.values(lodDistribution).reduce((sum, probability) => sum + probability, 0);
  if (lodTotal <= 0) lodDistribution["0"] = 1;
  else {
    for (const lod of Object.keys(lodDistribution)) lodDistribution[lod] /= lodTotal;
  }

  const requestedScope = scenario?.rosterScope;
  const scopeKind = requestedScope && ROSTER_SCOPE_KINDS.includes(requestedScope.kind)
    ? requestedScope.kind
    : "all";

  return {
    unitSizeScale: normalizeScale(scenario?.unitSizeScale, DEFAULT_ARMY_VISUAL_SCENARIO.unitSizeScale),
    crewScale: normalizeScale(scenario?.crewScale, DEFAULT_ARMY_VISUAL_SCENARIO.crewScale),
    engineRoundingPolicy,
    lodDistribution,
    destructionProbability: clampProbability(
      scenario?.destructionProbability,
      DEFAULT_ARMY_VISUAL_SCENARIO.destructionProbability,
    ),
    destructTransitionProbability: clampProbability(
      scenario?.destructTransitionProbability,
      DEFAULT_ARMY_VISUAL_SCENARIO.destructTransitionProbability,
    ),
    armySlotTemplate: template,
    rosterScope: {
      kind: scopeKind,
      ...(requestedScope?.key?.trim() ? { key: requestedScope.key.trim() } : {}),
    },
  };
};

/**
 * Expands one unit record into explicit visual components. The formulas intentionally
 * match Asset Editor's WH3 unit resolver: large-unit scaling applies to riders/engines,
 * crew uses its own scale, and land_units.num_mounts is mounts per carrier.
 */
export const getSingleUnitBenchmarkAssets = (
  candidate: Pick<
    ArmyBenchmarkCandidate,
    | "variantMeshPath"
    | "numMen"
    | "mountVariantMeshPath"
    | "numMounts"
    | "engineVariantMeshPath"
    | "numEngines"
    | "engineType"
  >,
  scenarioValue: Partial<ArmyVisualScenario> = DEFAULT_ARMY_VISUAL_SCENARIO,
): SingleUnitBenchmarkAsset[] => {
  const primaryPath = candidate.variantMeshPath?.trim();
  if (!primaryPath) return [];

  const scenario = normalizeArmyVisualScenario(scenarioValue);
  const rawMen = positiveEntityCount(candidate.numMen) || 1;
  const enginePath = candidate.engineVariantMeshPath?.trim();
  const hasEngine = !!enginePath;
  const rawEngines = hasEngine ? (positiveEntityCount(candidate.numEngines) || 1) : 0;
  const engines = hasEngine
    ? scaleEntityCount(rawEngines, scenario.unitSizeScale, scenario.engineRoundingPolicy)
    : 0;
  const crewedEngine = hasEngine && isCrewedEngine(candidate.engineType);
  const riders = crewedEngine
    ? 0
    : scaleEntityCount(rawMen, scenario.unitSizeScale, scenario.engineRoundingPolicy);
  const crew = crewedEngine
    ? scaleEntityCount(rawMen, scenario.crewScale, scenario.engineRoundingPolicy)
    : 0;

  const assets: SingleUnitBenchmarkAsset[] = [{
    assetPath: primaryPath,
    entities: crewedEngine ? crew : riders,
    role: crewedEngine ? "crew" : "men",
    state: "live",
    lod: 0,
    probability: 1,
  }];

  const mountPath = candidate.mountVariantMeshPath?.trim();
  if (mountPath) {
    const mountsPerCarrier = positiveEntityCount(candidate.numMounts) || 1;
    const carrierCount = engines > 0 ? engines : Math.max(1, riders);
    assets.push({
      assetPath: mountPath,
      entities: carrierCount * mountsPerCarrier,
      role: "mounts",
      state: "live",
      lod: 0,
      probability: 1,
    });
  }

  if (enginePath && engines > 0) {
    assets.push({
      assetPath: enginePath,
      entities: engines,
      role: "engines",
      state: "live",
      lod: 0,
      probability: 1,
    });
  }
  return assets.filter((asset) => asset.entities > 0);
};

export const getSingleUnitBenchmarkEntityCount = (
  candidate: Pick<
    ArmyBenchmarkCandidate,
    | "variantMeshPath"
    | "numMen"
    | "mountVariantMeshPath"
    | "numMounts"
    | "engineVariantMeshPath"
    | "numEngines"
    | "engineType"
  >,
  scenario: Partial<ArmyVisualScenario> = DEFAULT_ARMY_VISUAL_SCENARIO,
) => getSingleUnitBenchmarkAssets(candidate, scenario)
  .filter((asset) => asset.state === "live")
  .reduce((total, asset) => total + asset.entities * asset.probability, 0);

/**
 * Keeps generic asset benchmarks within a comparable rendered-entity budget when
 * the asset belongs to a known unit. Unknown assets retain the legacy counts.
 */
export const getGenericBenchmarkInstanceCounts = (unitEntityCount?: number): number[] => {
  const normalizedEntityCount = positiveEntityCount(unitEntityCount);
  if (normalizedEntityCount === 0) return [...GENERIC_BENCHMARK_COUNTS];

  const maxInstances = Math.max(1, Math.floor(GENERIC_BENCHMARK_ENTITY_BUDGET / normalizedEntityCount));
  const counts = GENERIC_BENCHMARK_COUNTS.map((count) => Math.min(count, maxInstances));
  return counts.filter((count, index) => index === 0 || count !== counts[index - 1]);
};

const CATEGORY_BY_UI_GROUP: Record<string, ArmyBenchmarkCategory> = {
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

export const getArmyBenchmarkCategory = (
  candidate: Pick<ArmyBenchmarkCandidate, "caste" | "uiGroupKey">,
): ArmyBenchmarkCategory | undefined => {
  const caste = normalizeKey(candidate.caste);
  if (caste === "lord") return "Lord";
  if (caste === "hero") return "Hero";
  return CATEGORY_BY_UI_GROUP[normalizeKey(candidate.uiGroupKey)];
};

const candidateCultureKeys = (candidate: ArmyBenchmarkCandidate) =>
  Array.from(
    new Set(
      (candidate.cultures?.length
        ? candidate.cultures.map((culture) => culture.key)
        : [candidate.cultureKey || ""])
        .map(normalizeKey)
        .filter((key) => key && key !== "__unassigned"),
    ),
  );

const randomIndex = (length: number, random: () => number) => {
  if (length <= 1) return 0;
  const value = random();
  return Math.min(length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * length)));
};

const chooseCulture = (candidates: readonly ArmyBenchmarkCandidate[], random: () => number) => {
  const byCulture = new Map<string, ArmyBenchmarkCandidate[]>();
  for (const candidate of candidates) {
    for (const key of candidateCultureKeys(candidate)) {
      const group = byCulture.get(key) || [];
      group.push(candidate);
      byCulture.set(key, group);
    }
  }
  if (byCulture.size === 0) return undefined;

  let bestCoverage = -1;
  let bestSize = -1;
  const bestKeys: string[] = [];
  for (const [key, group] of byCulture) {
    const categories = new Set(group.map(getArmyBenchmarkCategory).filter(Boolean));
    const coverage = TEMPLATE_CATEGORIES.filter((category) => categories.has(category)).length;
    if (coverage > bestCoverage || (coverage === bestCoverage && group.length > bestSize)) {
      bestCoverage = coverage;
      bestSize = group.length;
      bestKeys.splice(0, bestKeys.length, key);
    } else if (coverage === bestCoverage && group.length === bestSize) {
      bestKeys.push(key);
    }
  }
  return bestKeys[randomIndex(bestKeys.length, random)];
};

const buildPools = (candidates: readonly ArmyBenchmarkCandidate[]) => {
  const pools = new Map<ArmyBenchmarkCategory, ArmyBenchmarkCandidate[]>();
  for (const category of TEMPLATE_CATEGORIES) pools.set(category, []);
  for (const candidate of candidates) {
    const category = getArmyBenchmarkCategory(candidate);
    if (category) pools.get(category)!.push(candidate);
  }
  return pools;
};

const filterForRosterScope = (
  candidates: readonly ArmyBenchmarkCandidate[],
  scope: ArmyBenchmarkRosterScope,
  sourcePackPath?: string,
) => {
  const key = normalizeKey(scope.key);
  switch (scope.kind) {
    case "culture":
      return key ? candidates.filter((candidate) => candidateCultureKeys(candidate).includes(key)) : [...candidates];
    case "faction":
      return key ? candidates.filter((candidate) => normalizeKey(candidate.faction) === key) : [...candidates];
    case "mod":
    case "optimized-assets": {
      const path = scope.key || sourcePackPath;
      if (!path) return [...candidates];
      const normalized = normalizePath(path);
      return candidates.filter((candidate) => normalizePath(candidate.originPackPath) === normalized);
    }
    default:
      return [...candidates];
  }
};

/**
 * Loads army assets independently so one broken VMD does not abort the complete benchmark.
 * The caller decides how to surface failures and how to dispose successfully loaded values.
 */
export const loadArmyBenchmarkAssets = async <T>(
  entries: readonly ArmyBenchmarkAssetEntry[],
  load: (entry: ArmyBenchmarkAssetEntry) => Promise<T>,
): Promise<{
  loaded: Array<{ entry: ArmyBenchmarkAssetEntry; value: T }>;
  failures: ArmyBenchmarkAssetLoadFailure[];
}> => {
  const loaded: Array<{ entry: ArmyBenchmarkAssetEntry; value: T }> = [];
  const failures: ArmyBenchmarkAssetLoadFailure[] = [];
  for (const entry of entries) {
    try {
      loaded.push({ entry, value: await load(entry) });
    } catch (error) {
      failures.push({
        entry,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { loaded, failures };
};

const shuffled = <T,>(values: readonly T[], random: () => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = randomIndex(index + 1, random);
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
};

export const generateArmyBenchmarkRoster = (
  candidates: readonly ArmyBenchmarkCandidate[],
  sourcePackPath?: string,
  random: () => number = Math.random,
  scenarioValue: Partial<ArmyVisualScenario> = DEFAULT_ARMY_VISUAL_SCENARIO,
): ArmyBenchmarkRosterFile => {
  let scenario = normalizeArmyVisualScenario(scenarioValue);
  const eligible = candidates.filter(
    (candidate) => !!candidate.variantMeshPath?.trim() && !!getArmyBenchmarkCategory(candidate),
  );
  if (eligible.length === 0) throw new Error("No benchmarkable units have a variantmeshdefinition and army category.");

  let scoped = filterForRosterScope(eligible, scenario.rosterScope, sourcePackPath);
  if (scoped.length === 0) {
    throw new Error(`No benchmarkable units match the ${scenario.rosterScope.kind} roster scope.`);
  }

  const sourceKey = sourcePackPath ? normalizePath(sourcePackPath) : "";
  const sourceCandidates = sourceKey
    ? scoped.filter((candidate) => normalizePath(candidate.originPackPath) === sourceKey)
    : scoped;
  const preferredCandidates = sourceCandidates.length > 0 ? sourceCandidates : scoped;

  let cultureKey = scenario.rosterScope.kind === "culture" && scenario.rosterScope.key
    ? normalizeKey(scenario.rosterScope.key)
    : chooseCulture(preferredCandidates, random);
  const cultureCandidates = cultureKey
    ? preferredCandidates.filter((candidate) => candidateCultureKeys(candidate).includes(cultureKey!))
    : preferredCandidates;

  // Preserve the existing "same pack where possible" behavior for the default all-units
  // scope, while explicit scopes are strict and never pull unrelated fallback units.
  const strictScope = scenario.rosterScope.kind !== "all";
  const scopedPools = buildPools(scoped);
  const culturePools = buildPools(cultureCandidates);
  const sourcePools = buildPools(preferredCandidates);
  const globalPools = buildPools(eligible);
  const bags = new Map<ArmyBenchmarkCategory, ArmyBenchmarkCandidate[]>();
  const rosterUnits: ArmyBenchmarkRosterUnit[] = [];

  for (const category of TEMPLATE_CATEGORIES) {
    const requestedSlots = scenario.armySlotTemplate[category];
    const pool = culturePools.get(category)!.length > 0
      ? culturePools.get(category)!
      : sourcePools.get(category)!.length > 0
        ? sourcePools.get(category)!
        : scopedPools.get(category)!.length > 0
          ? scopedPools.get(category)!
          : strictScope
            ? []
            : globalPools.get(category)!;
    if (requestedSlots > 0 && pool.length === 0) {
      throw new Error(`No benchmarkable ${category} unit is available for the ${scenario.rosterScope.kind} roster scope.`);
    }

    for (let slot = 0; slot < requestedSlots; slot += 1) {
      let bag = bags.get(category) || [];
      if (bag.length === 0) {
        bag = shuffled(pool, random);
        bags.set(category, bag);
      }
      const candidate = bag.pop()!;
      const assets = getSingleUnitBenchmarkAssets(candidate, scenario);
      if (assets.length === 0) {
        throw new Error(`No renderable component assets were resolved for ${candidate.localizedName}.`);
      }
      const primary = assets.find((asset) => asset.role === "men" || asset.role === "crew") ?? assets[0];
      const liveEntities = assets
        .filter((asset) => asset.state === "live")
        .reduce((sum, asset) => sum + asset.entities * asset.probability, 0);
      rosterUnits.push({
        slot: rosterUnits.length,
        category,
        unitKey: candidate.unitKey,
        faction: candidate.faction,
        name: candidate.localizedName,
        assetPath: primary.assetPath,
        entities: Math.max(1, Math.round(liveEntities)),
        assets,
        ...(cultureKey ? { cultureKey } : {}),
        ...(candidate.originPackPath ? { originPackPath: candidate.originPackPath } : {}),
      });
    }
  }

  if (scenario.rosterScope.kind === "culture" && !scenario.rosterScope.key && cultureKey) {
    scenario = {
      ...scenario,
      rosterScope: { kind: "culture", key: cultureKey },
    };
  }

  return {
    kind: ARMY_BENCHMARK_FILE_KIND,
    version: ARMY_BENCHMARK_FILE_VERSION,
    generatedAt: new Date().toISOString(),
    ...(sourcePackPath ? { sourcePackPath } : {}),
    ...(cultureKey ? { cultureKey } : {}),
    scenario,
    template: { ...scenario.armySlotTemplate },
    units: rosterUnits,
  };
};

const isCategory = (value: unknown): value is ArmyBenchmarkCategory =>
  typeof value === "string" && TEMPLATE_CATEGORIES.includes(value as ArmyBenchmarkCategory);

const isRole = (value: unknown): value is ArmyBenchmarkVisualRole =>
  value === "men" || value === "mounts" || value === "engines" || value === "crew" || value === "asset";

const isState = (value: unknown): value is ArmyBenchmarkVisualState =>
  value === "live" || value === "destroyed" || value === "destruct";

const requireString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Army benchmark ${label} is missing.`);
  return value;
};

const parseVisualAsset = (
  value: unknown,
  unitIndex: number,
  assetIndex: number,
): ArmyBenchmarkVisualAsset => {
  if (!value || typeof value !== "object") {
    throw new Error(`Army benchmark unit ${unitIndex + 1} asset ${assetIndex + 1} is invalid.`);
  }
  const asset = value as Record<string, unknown>;
  const assetPath = requireString(asset.assetPath, `unit ${unitIndex + 1} asset ${assetIndex + 1} assetPath`);
  if (!assetPath.toLowerCase().endsWith(".variantmeshdefinition")) {
    throw new Error(`Army benchmark unit ${unitIndex + 1} asset ${assetIndex + 1} must reference a .variantmeshdefinition.`);
  }
  const entities = Number(asset.entities);
  if (!Number.isSafeInteger(entities) || entities < 1) {
    throw new Error(`Army benchmark unit ${unitIndex + 1} asset ${assetIndex + 1} has an invalid entity count.`);
  }
  const role = isRole(asset.role) ? asset.role : "asset";
  const state = isState(asset.state) ? asset.state : "live";
  const lod = Number(asset.lod);
  const probability = Number(asset.probability);
  return {
    assetPath,
    entities,
    role,
    state,
    lod: Number.isSafeInteger(lod) && lod >= 0 ? lod : 0,
    probability: Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 1,
  };
};

export const parseArmyBenchmarkRoster = (json: string): ArmyBenchmarkRosterFile => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Army benchmark file is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("Army benchmark file must contain an object.");
  const file = value as Record<string, unknown>;
  if (file.kind !== ARMY_BENCHMARK_FILE_KIND) throw new Error("This is not a WHMM atlas army benchmark file.");

  const version = Number(file.version);
  if (version !== 1 && version !== ARMY_BENCHMARK_FILE_VERSION) {
    throw new Error(`Unsupported army benchmark file version: ${String(file.version)}.`);
  }
  if (!Array.isArray(file.units) || file.units.length === 0) throw new Error("Army benchmark file has no units.");

  const legacyTemplate = { ...ARMY_BENCHMARK_TEMPLATE } as Record<ArmyBenchmarkCategory, number>;
  if (file.template && typeof file.template === "object") {
    for (const category of TEMPLATE_CATEGORIES) {
      const count = Number((file.template as Record<string, unknown>)[category]);
      if (Number.isSafeInteger(count) && count >= 0) legacyTemplate[category] = count;
    }
  }
  const scenario = normalizeArmyVisualScenario(
    version === 1
      ? { armySlotTemplate: legacyTemplate }
      : (file.scenario && typeof file.scenario === "object"
          ? file.scenario as Partial<ArmyVisualScenario>
          : { armySlotTemplate: legacyTemplate }),
  );

  const units = file.units.map((unitValue, index): ArmyBenchmarkRosterUnit => {
    if (!unitValue || typeof unitValue !== "object") throw new Error(`Army benchmark unit ${index + 1} is invalid.`);
    const unit = unitValue as Record<string, unknown>;
    if (!isCategory(unit.category)) throw new Error(`Army benchmark unit ${index + 1} has an invalid category.`);

    let assets: ArmyBenchmarkVisualAsset[];
    if (version === 1) {
      const assetPath = requireString(unit.assetPath, `unit ${index + 1} assetPath`);
      const entities = Number(unit.entities);
      if (!Number.isSafeInteger(entities) || entities < 1) {
        throw new Error(`Army benchmark unit ${index + 1} has an invalid entity count.`);
      }
      assets = [parseVisualAsset({
        assetPath,
        entities,
        role: "men",
        state: "live",
        lod: 0,
        probability: 1,
      }, index, 0)];
    } else {
      if (!Array.isArray(unit.assets) || unit.assets.length === 0) {
        throw new Error(`Army benchmark unit ${index + 1} has no component assets.`);
      }
      assets = unit.assets.map((asset, assetIndex) => parseVisualAsset(asset, index, assetIndex));
    }

    const primary = assets.find((asset) => asset.role === "men" || asset.role === "crew") ?? assets[0];
    const entities = assets
      .filter((asset) => asset.state === "live")
      .reduce((sum, asset) => sum + asset.entities * asset.probability, 0);
    return {
      slot: Number.isSafeInteger(Number(unit.slot)) ? Number(unit.slot) : index,
      category: unit.category,
      unitKey: requireString(unit.unitKey, `unit ${index + 1} unitKey`),
      faction: typeof unit.faction === "string" ? unit.faction : "",
      name: requireString(unit.name, `unit ${index + 1} name`),
      assetPath: primary.assetPath,
      entities: Math.max(1, Math.round(entities)),
      assets,
      ...(typeof unit.cultureKey === "string" && unit.cultureKey ? { cultureKey: unit.cultureKey } : {}),
      ...(typeof unit.originPackPath === "string" && unit.originPackPath
        ? { originPackPath: unit.originPackPath }
        : {}),
    };
  });

  return {
    kind: ARMY_BENCHMARK_FILE_KIND,
    version: ARMY_BENCHMARK_FILE_VERSION,
    generatedAt: typeof file.generatedAt === "string" ? file.generatedAt : new Date().toISOString(),
    ...(typeof file.sourcePackPath === "string" && file.sourcePackPath ? { sourcePackPath: file.sourcePackPath } : {}),
    ...(typeof file.cultureKey === "string" && file.cultureKey ? { cultureKey: file.cultureKey } : {}),
    scenario,
    template: { ...scenario.armySlotTemplate },
    units,
  };
};

export const serializeArmyBenchmarkRoster = (roster: ArmyBenchmarkRosterFile) => JSON.stringify(roster, null, 2);
