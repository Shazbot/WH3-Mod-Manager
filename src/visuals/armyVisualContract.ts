export const ARMY_VISUAL_CONTRACT_KIND = "wh3-army-visual-contract" as const;
export const ARMY_VISUAL_CONTRACT_VERSION = 1 as const;

export const ARMY_VISUAL_SCENARIO_CATEGORIES = [
  "Lord",
  "Hero",
  "InfantryMissile",
  "CavalryChariot",
  "MonsterBeast",
  "ArtilleryWarMachine",
] as const;

export const ARMY_VISUAL_UNIT_CATEGORIES = [
  "Unknown",
  ...ARMY_VISUAL_SCENARIO_CATEGORIES,
] as const;

export const ARMY_VISUAL_ROLES = ["men", "mounts", "engines", "crew", "asset"] as const;
export const ARMY_VISUAL_STATES = ["live", "destroyed", "destruct"] as const;
export const ARMY_VISUAL_ASSET_TYPES = [
  "variantmeshdefinition",
  "wsmodel",
  "rigid_model_v2",
  "other",
] as const;
export const ARMY_VISUAL_ROUNDING_POLICIES = ["ceil", "round", "floor"] as const;
export const ARMY_VISUAL_ROSTER_SCOPE_KINDS = [
  "all",
  "culture",
  "faction",
  "mod",
  "optimized-assets",
] as const;

export type ArmyVisualScenarioCategory = typeof ARMY_VISUAL_SCENARIO_CATEGORIES[number];
export type ArmyVisualContractUnitCategory = typeof ARMY_VISUAL_UNIT_CATEGORIES[number];
export type ArmyVisualContractRole = typeof ARMY_VISUAL_ROLES[number];
export type ArmyVisualContractState = typeof ARMY_VISUAL_STATES[number];
export type ArmyVisualContractAssetType = typeof ARMY_VISUAL_ASSET_TYPES[number];
export type ArmyVisualContractRoundingPolicy = typeof ARMY_VISUAL_ROUNDING_POLICIES[number];
export type ArmyVisualContractRosterScopeKind = typeof ARMY_VISUAL_ROSTER_SCOPE_KINDS[number];

export type ArmyVisualContractRosterScope = {
  kind: ArmyVisualContractRosterScopeKind;
  key?: string;
};

export type ArmyVisualScenarioContract = {
  unitSizeScale: number;
  crewScale: number;
  engineRoundingPolicy: ArmyVisualContractRoundingPolicy;
  lodDistribution: Record<string, number>;
  destructionProbability: number;
  destructTransitionProbability: number;
  armySlotTemplate: Record<ArmyVisualScenarioCategory, number>;
  rosterScope: ArmyVisualContractRosterScope;
};

export type ArmyVisualContractCounts = {
  men: number;
  mounts: number;
  engines: number;
  crew: number;
};

export type ArmyVisualContractComponent = {
  role: ArmyVisualContractRole;
  assetPath: string;
  assetType: ArmyVisualContractAssetType;
  state: ArmyVisualContractState;
  lod: number;
  probability: number;
  entities: number;
};

export type ArmyVisualContractUnit = {
  identity: string;
  mainUnitKey: string;
  landUnitKey: string;
  category: ArmyVisualContractUnitCategory;
  factionKeys: string[];
  subcultureKeys: string[];
  cultureKeys: string[];
  counts: ArmyVisualContractCounts;
  components: ArmyVisualContractComponent[];
};

export type ArmyVisualContractDocument = {
  kind: typeof ARMY_VISUAL_CONTRACT_KIND;
  contractVersion: typeof ARMY_VISUAL_CONTRACT_VERSION;
  scenario: ArmyVisualScenarioContract;
  units: ArmyVisualContractUnit[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isOneOf = <T extends readonly string[]>(value: unknown, values: T): value is T[number] =>
  typeof value === "string" && values.includes(value as T[number]);

const requireString = (value: unknown, label: string, allowEmpty = false) => {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`Army visual contract ${label} is invalid.`);
  }
  return value;
};

const requireNumber = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Army visual contract ${label} is invalid.`);
  return number;
};

const requireProbability = (value: unknown, label: string) => {
  const number = requireNumber(value, label);
  if (number < 0 || number > 1) throw new Error(`Army visual contract ${label} is invalid.`);
  return number;
};

const requireNonNegativeInteger = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Army visual contract ${label} is invalid.`);
  }
  return number;
};

const requirePositiveInteger = (value: unknown, label: string) => {
  const number = requireNonNegativeInteger(value, label);
  if (number < 1) throw new Error(`Army visual contract ${label} must be positive.`);
  return number;
};

const requireStringArray = (value: unknown, label: string) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Army visual contract ${label} is invalid.`);
  }
  return [...new Set(value as string[])];
};

const parseScenario = (value: unknown): ArmyVisualScenarioContract => {
  if (!isRecord(value)) throw new Error("Army visual contract scenario is missing.");

  const unitSizeScale = requireNumber(value.unitSizeScale, "scenario.unitSizeScale");
  const crewScale = requireNumber(value.crewScale, "scenario.crewScale");
  if (unitSizeScale <= 0 || crewScale <= 0) {
    throw new Error("Army visual contract scenario scales must be positive.");
  }

  if (!isOneOf(value.engineRoundingPolicy, ARMY_VISUAL_ROUNDING_POLICIES)) {
    throw new Error("Army visual contract scenario.engineRoundingPolicy is invalid.");
  }

  if (!isRecord(value.lodDistribution)) {
    throw new Error("Army visual contract scenario.lodDistribution is invalid.");
  }
  const lodDistribution: Record<string, number> = {};
  for (const [lod, rawProbability] of Object.entries(value.lodDistribution)) {
    if (!/^\d+$/.test(lod)) {
      throw new Error("Army visual contract scenario.lodDistribution has an invalid LOD key.");
    }
    lodDistribution[lod] = requireProbability(
      rawProbability,
      `scenario.lodDistribution.${lod}`,
    );
  }
  if (Object.keys(lodDistribution).length === 0) {
    throw new Error("Army visual contract scenario.lodDistribution is empty.");
  }

  const destructionProbability = requireProbability(
    value.destructionProbability,
    "scenario.destructionProbability",
  );
  const destructTransitionProbability = requireProbability(
    value.destructTransitionProbability,
    "scenario.destructTransitionProbability",
  );
  if (destructionProbability + destructTransitionProbability > 1.000001) {
    throw new Error("Army visual contract lifecycle probabilities exceed one visual state.");
  }

  if (!isRecord(value.armySlotTemplate)) {
    throw new Error("Army visual contract scenario.armySlotTemplate is invalid.");
  }
  const armySlotTemplate = {} as Record<ArmyVisualScenarioCategory, number>;
  for (const category of ARMY_VISUAL_SCENARIO_CATEGORIES) {
    armySlotTemplate[category] = requireNonNegativeInteger(
      value.armySlotTemplate[category],
      `scenario.armySlotTemplate.${category}`,
    );
  }
  for (const category of Object.keys(value.armySlotTemplate)) {
    if (!isOneOf(category, ARMY_VISUAL_SCENARIO_CATEGORIES)) {
      throw new Error(`Army visual contract scenario.armySlotTemplate has unknown category ${category}.`);
    }
  }

  if (!isRecord(value.rosterScope) ||
      !isOneOf(value.rosterScope.kind, ARMY_VISUAL_ROSTER_SCOPE_KINDS)) {
    throw new Error("Army visual contract scenario.rosterScope is invalid.");
  }
  const scopeKey = typeof value.rosterScope.key === "string" && value.rosterScope.key.trim()
    ? value.rosterScope.key
    : undefined;
  if ((value.rosterScope.kind === "culture" || value.rosterScope.kind === "faction") && !scopeKey) {
    throw new Error("Army visual contract faction/culture roster scopes require a key.");
  }

  return {
    unitSizeScale,
    crewScale,
    engineRoundingPolicy: value.engineRoundingPolicy,
    lodDistribution,
    destructionProbability,
    destructTransitionProbability,
    armySlotTemplate,
    rosterScope: {
      kind: value.rosterScope.kind,
      ...(scopeKey ? { key: scopeKey } : {}),
    },
  };
};

const parseCounts = (value: unknown, unitIndex: number): ArmyVisualContractCounts => {
  if (!isRecord(value)) throw new Error(`Army visual contract unit ${unitIndex + 1} counts are invalid.`);
  return {
    men: requireNonNegativeInteger(value.men, `unit ${unitIndex + 1} counts.men`),
    mounts: requireNonNegativeInteger(value.mounts, `unit ${unitIndex + 1} counts.mounts`),
    engines: requireNonNegativeInteger(value.engines, `unit ${unitIndex + 1} counts.engines`),
    crew: requireNonNegativeInteger(value.crew, `unit ${unitIndex + 1} counts.crew`),
  };
};

const parseComponent = (
  value: unknown,
  unitIndex: number,
  componentIndex: number,
): ArmyVisualContractComponent => {
  if (!isRecord(value)) {
    throw new Error(`Army visual contract unit ${unitIndex + 1} component ${componentIndex + 1} is invalid.`);
  }
  if (!isOneOf(value.role, ARMY_VISUAL_ROLES)) {
    throw new Error(`Army visual contract unit ${unitIndex + 1} component role is invalid.`);
  }
  if (!isOneOf(value.assetType, ARMY_VISUAL_ASSET_TYPES)) {
    throw new Error(`Army visual contract unit ${unitIndex + 1} component asset type is invalid.`);
  }
  if (!isOneOf(value.state, ARMY_VISUAL_STATES)) {
    throw new Error(`Army visual contract unit ${unitIndex + 1} component state is invalid.`);
  }
  return {
    role: value.role,
    assetPath: requireString(
      value.assetPath,
      `unit ${unitIndex + 1} component ${componentIndex + 1} assetPath`,
    ),
    assetType: value.assetType,
    state: value.state,
    lod: requireNonNegativeInteger(
      value.lod,
      `unit ${unitIndex + 1} component ${componentIndex + 1} lod`,
    ),
    probability: requireProbability(
      value.probability,
      `unit ${unitIndex + 1} component ${componentIndex + 1} probability`,
    ),
    entities: requirePositiveInteger(
      value.entities,
      `unit ${unitIndex + 1} component ${componentIndex + 1} entities`,
    ),
  };
};

const parseUnit = (value: unknown, index: number): ArmyVisualContractUnit => {
  if (!isRecord(value)) throw new Error(`Army visual contract unit ${index + 1} is invalid.`);
  if (!isOneOf(value.category, ARMY_VISUAL_UNIT_CATEGORIES)) {
    throw new Error(`Army visual contract unit ${index + 1} category is invalid.`);
  }
  if (!Array.isArray(value.components)) {
    throw new Error(`Army visual contract unit ${index + 1} components are invalid.`);
  }

  return {
    identity: requireString(value.identity, `unit ${index + 1} identity`),
    mainUnitKey: requireString(value.mainUnitKey, `unit ${index + 1} mainUnitKey`, true),
    landUnitKey: requireString(value.landUnitKey, `unit ${index + 1} landUnitKey`),
    category: value.category,
    factionKeys: requireStringArray(value.factionKeys, `unit ${index + 1} factionKeys`),
    subcultureKeys: requireStringArray(value.subcultureKeys, `unit ${index + 1} subcultureKeys`),
    cultureKeys: requireStringArray(value.cultureKeys, `unit ${index + 1} cultureKeys`),
    counts: parseCounts(value.counts, index),
    components: value.components.map((component, componentIndex) =>
      parseComponent(component, index, componentIndex)),
  };
};

export const parseArmyVisualContract = (json: string): ArmyVisualContractDocument => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Army visual contract is not valid JSON.");
  }
  if (!isRecord(value)) throw new Error("Army visual contract must contain an object.");
  if (value.kind !== ARMY_VISUAL_CONTRACT_KIND) {
    throw new Error("This is not a WH3 army visual contract.");
  }
  if (value.contractVersion !== ARMY_VISUAL_CONTRACT_VERSION) {
    throw new Error(`Unsupported army visual contract version: ${String(value.contractVersion)}.`);
  }
  if (!Array.isArray(value.units)) throw new Error("Army visual contract units are missing.");

  return {
    kind: ARMY_VISUAL_CONTRACT_KIND,
    contractVersion: ARMY_VISUAL_CONTRACT_VERSION,
    scenario: parseScenario(value.scenario),
    units: value.units.map(parseUnit),
  };
};

export const serializeArmyVisualContract = (document: ArmyVisualContractDocument) =>
  JSON.stringify(parseArmyVisualContract(JSON.stringify(document)), null, 2);
