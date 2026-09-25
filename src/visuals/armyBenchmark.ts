export const ARMY_BENCHMARK_FILE_KIND = "whmm-atlas-army-benchmark" as const;
export const ARMY_BENCHMARK_FILE_VERSION = 1 as const;

export const ARMY_BENCHMARK_TEMPLATE = {
  Lord: 1,
  Hero: 2,
  InfantryMissile: 9,
  CavalryChariot: 4,
  MonsterBeast: 3,
  ArtilleryWarMachine: 2,
} as const;

export type ArmyBenchmarkCategory = keyof typeof ARMY_BENCHMARK_TEMPLATE;

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
  uiGroupKey?: string;
};

export type ArmyBenchmarkRosterUnit = {
  slot: number;
  category: ArmyBenchmarkCategory;
  unitKey: string;
  faction: string;
  name: string;
  assetPath: string;
  entities: number;
  cultureKey?: string;
  originPackPath?: string;
};

export type ArmyBenchmarkRosterFile = {
  kind: typeof ARMY_BENCHMARK_FILE_KIND;
  version: typeof ARMY_BENCHMARK_FILE_VERSION;
  generatedAt: string;
  sourcePackPath?: string;
  cultureKey?: string;
  template: Record<ArmyBenchmarkCategory, number>;
  units: ArmyBenchmarkRosterUnit[];
};

const TEMPLATE_CATEGORIES = Object.keys(ARMY_BENCHMARK_TEMPLATE) as ArmyBenchmarkCategory[];
const normalizePath = (value: string) => value.replace(/\//g, "\\").toLowerCase();
const normalizeKey = (value?: string) => (value || "").trim().toLowerCase();

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
): ArmyBenchmarkRosterFile => {
  const eligible = candidates.filter(
    (candidate) => !!candidate.variantMeshPath?.trim() && !!getArmyBenchmarkCategory(candidate),
  );
  if (eligible.length === 0) throw new Error("No benchmarkable units have a variantmeshdefinition and army category.");

  const sourceKey = sourcePackPath ? normalizePath(sourcePackPath) : "";
  const sourceCandidates = sourceKey
    ? eligible.filter((candidate) => normalizePath(candidate.originPackPath) === sourceKey)
    : eligible;
  const preferredCandidates = sourceCandidates.length > 0 ? sourceCandidates : eligible;
  const cultureKey = chooseCulture(preferredCandidates, random);
  const cultureCandidates = cultureKey
    ? preferredCandidates.filter((candidate) => candidateCultureKeys(candidate).includes(cultureKey))
    : preferredCandidates;

  const culturePools = buildPools(cultureCandidates);
  const sourcePools = buildPools(preferredCandidates);
  const globalPools = buildPools(eligible);
  const bags = new Map<ArmyBenchmarkCategory, ArmyBenchmarkCandidate[]>();
  const rosterUnits: ArmyBenchmarkRosterUnit[] = [];

  for (const category of TEMPLATE_CATEGORIES) {
    const pool = culturePools.get(category)!.length > 0
      ? culturePools.get(category)!
      : sourcePools.get(category)!.length > 0
        ? sourcePools.get(category)!
        : globalPools.get(category)!;
    if (pool.length === 0) {
      throw new Error(`No benchmarkable ${category} unit is available for the army template.`);
    }

    for (let slot = 0; slot < ARMY_BENCHMARK_TEMPLATE[category]; slot += 1) {
      let bag = bags.get(category) || [];
      if (bag.length === 0) {
        bag = shuffled(pool, random);
        bags.set(category, bag);
      }
      const candidate = bag.pop()!;
      const assetPath = candidate.variantMeshPath!.trim();
      const numMen = Number(candidate.numMen);
      rosterUnits.push({
        slot: rosterUnits.length,
        category,
        unitKey: candidate.unitKey,
        faction: candidate.faction,
        name: candidate.localizedName,
        assetPath,
        entities: Number.isFinite(numMen) && numMen > 0 ? Math.max(1, Math.round(numMen)) : 1,
        ...(cultureKey ? { cultureKey } : {}),
        ...(candidate.originPackPath ? { originPackPath: candidate.originPackPath } : {}),
      });
    }
  }

  return {
    kind: ARMY_BENCHMARK_FILE_KIND,
    version: ARMY_BENCHMARK_FILE_VERSION,
    generatedAt: new Date().toISOString(),
    ...(sourcePackPath ? { sourcePackPath } : {}),
    ...(cultureKey ? { cultureKey } : {}),
    template: { ...ARMY_BENCHMARK_TEMPLATE },
    units: rosterUnits,
  };
};

const isCategory = (value: unknown): value is ArmyBenchmarkCategory =>
  typeof value === "string" && TEMPLATE_CATEGORIES.includes(value as ArmyBenchmarkCategory);

const requireString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Army benchmark ${label} is missing.`);
  return value;
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
  if (file.version !== ARMY_BENCHMARK_FILE_VERSION) {
    throw new Error(`Unsupported army benchmark file version: ${String(file.version)}.`);
  }
  if (!Array.isArray(file.units) || file.units.length === 0) throw new Error("Army benchmark file has no units.");

  const units = file.units.map((unitValue, index): ArmyBenchmarkRosterUnit => {
    if (!unitValue || typeof unitValue !== "object") throw new Error(`Army benchmark unit ${index + 1} is invalid.`);
    const unit = unitValue as Record<string, unknown>;
    if (!isCategory(unit.category)) throw new Error(`Army benchmark unit ${index + 1} has an invalid category.`);
    const entities = Number(unit.entities);
    if (!Number.isSafeInteger(entities) || entities < 1) {
      throw new Error(`Army benchmark unit ${index + 1} has an invalid entity count.`);
    }
    const assetPath = requireString(unit.assetPath, `unit ${index + 1} assetPath`);
    if (!assetPath.toLowerCase().endsWith(".variantmeshdefinition")) {
      throw new Error(`Army benchmark unit ${index + 1} must reference a .variantmeshdefinition.`);
    }
    return {
      slot: Number.isSafeInteger(Number(unit.slot)) ? Number(unit.slot) : index,
      category: unit.category,
      unitKey: requireString(unit.unitKey, `unit ${index + 1} unitKey`),
      faction: typeof unit.faction === "string" ? unit.faction : "",
      name: requireString(unit.name, `unit ${index + 1} name`),
      assetPath,
      entities,
      ...(typeof unit.cultureKey === "string" && unit.cultureKey ? { cultureKey: unit.cultureKey } : {}),
      ...(typeof unit.originPackPath === "string" && unit.originPackPath
        ? { originPackPath: unit.originPackPath }
        : {}),
    };
  });

  const template = { ...ARMY_BENCHMARK_TEMPLATE } as Record<ArmyBenchmarkCategory, number>;
  if (file.template && typeof file.template === "object") {
    for (const category of TEMPLATE_CATEGORIES) {
      const count = Number((file.template as Record<string, unknown>)[category]);
      if (Number.isSafeInteger(count) && count >= 0) template[category] = count;
    }
  }

  return {
    kind: ARMY_BENCHMARK_FILE_KIND,
    version: ARMY_BENCHMARK_FILE_VERSION,
    generatedAt: typeof file.generatedAt === "string" ? file.generatedAt : new Date().toISOString(),
    ...(typeof file.sourcePackPath === "string" && file.sourcePackPath ? { sourcePackPath: file.sourcePackPath } : {}),
    ...(typeof file.cultureKey === "string" && file.cultureKey ? { cultureKey: file.cultureKey } : {}),
    template,
    units,
  };
};

export const serializeArmyBenchmarkRoster = (roster: ArmyBenchmarkRosterFile) => JSON.stringify(roster, null, 2);
