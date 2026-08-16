/**
 * Works out which buildings a region offers, for one set of filters.
 *
 * Pure and side-effect free so both processes can run it: the main process serves the first view,
 * and the renderer re-runs it after every edit without a round trip.
 *
 * The game's real rules are not published, so the two places this guesses are called out in the
 * comments at their branch and are both deliberately permissive - a chain shown that the game would
 * hide is visible and reportable, one hidden that the game shows is not.
 */
import type {
  AvailabilityRow,
  BuildingVariantRow,
  BuildingsChainColumn,
  BuildingsOption,
  BuildingsRegionQuery,
  BuildingsRegionView,
  BuildingsSetBand,
  BuildingsTile,
  BuildingsUpgradeEdge,
  BuiltBuildingsData,
} from "./types";
import { HIDDEN_BUILDING_CHAIN_PREFIX, variantLocKey } from "./data";

/** Bucket for levels no building set claims, rendered last. */
export const NO_SET_KEY = "__no_set__";

const ROMAN_NUMERALS: Array<[number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Levels are numbered from 0 in the DB but shown as I upwards, so callers pass `level + 1`. */
export const toRoman = (value: number): string => {
  if (!Number.isFinite(value) || value < 1) return "";
  let remaining = Math.floor(value);
  let out = "";
  for (const [amount, numeral] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      out += numeral;
      remaining -= amount;
    }
  }
  return out;
};

/**
 * Every chain a chain set resolves to, following `parent_set` upwards.
 *
 * A set inherits its parent's items and may override them: the child's `remove` rows win, so the
 * parent is expanded first and the child applied on top.
 */
export const expandChainSet = (data: BuiltBuildingsData, setKey: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(setKey)) return new Set();
  seen.add(setKey);

  const parent = data.chainSetParents[setKey];
  const chains = parent ? expandChainSet(data, parent, seen) : new Set<string>();

  for (const item of data.chainSetItems[setKey] ?? []) {
    const itemChains = item.chain ? [item.chain] : item.superChain ? (data.superChains[item.superChain] ?? []) : [];
    for (const chain of itemChains) {
      if (item.remove) chains.delete(chain);
      else chains.add(chain);
    }
  }
  return chains;
};

/**
 * Does one availability row let this query through?
 *
 * A column the row leaves empty is unconstrained. A column the query leaves undefined ("none" in the
 * UI) is also treated as unconstrained, except that a subculture or faction the row names still has
 * to belong to the culture the query does name - otherwise picking Empire would show every faction's
 * chains. See the ambiguity note in the plan: the alternative reading is "only rows with an empty
 * value", which would hide most content behind a culture-only filter.
 */
const availabilityMatches = (
  row: AvailabilityRow,
  query: BuildingsRegionQuery,
  cultureOfSubculture: (subculture: string) => string | undefined,
  cultureOfFaction: (faction: string) => string | undefined,
): boolean => {
  if (row.campaign !== "" && row.campaign !== query.campaign) return false;
  if (row.culture !== "" && query.culture && row.culture !== query.culture) return false;

  if (row.subCulture !== "") {
    if (query.subculture) {
      if (row.subCulture !== query.subculture) return false;
    } else if (query.culture && cultureOfSubculture(row.subCulture) !== query.culture) {
      return false;
    }
  }

  if (row.faction !== "") {
    if (query.faction) {
      if (row.faction !== query.faction) return false;
    } else if (query.culture && cultureOfFaction(row.faction) !== query.culture) {
      return false;
    }
  }
  return true;
};

/**
 * Picks the culture variant the game would draw, or reports the one that disables the building.
 *
 * Candidates are the rows whose non-empty columns are consistent with the query, and the displayed
 * one is the most specific of those that do not disable - a disabling row carries no icon or text to
 * show anyway.
 *
 * `disables` is deliberately stricter than candidacy: it only bites when every column the row pins
 * is one the query pinned to the same value. Vanilla relies on this. `wh_main_emp_worship_1` has a
 * plain Empire variant plus disabling rows for Middenland and Talabecland; treating any disabling
 * candidate as fatal would hide the building from every Empire faction, where the game hides it only
 * from those two. A row that could bite under a narrower filter is still reported, as
 * `conditionalDisabledBy`, so the UI can say so rather than silently ignoring it.
 */
export const pickCultureVariant = (
  data: BuiltBuildingsData,
  levelKey: string,
  query: BuildingsRegionQuery,
  cultureOfSubculture: (subculture: string) => string | undefined,
  cultureOfFaction: (faction: string) => string | undefined,
): {
  variant?: BuildingVariantRow;
  disabledBy?: BuildingVariantRow;
  conditionalDisabledBy?: BuildingVariantRow;
  candidateCount: number;
} => {
  const candidates: BuildingVariantRow[] = [];
  for (const variant of data.variantsByLevel[levelKey] ?? []) {
    if (variant.culture !== "" && query.culture && variant.culture !== query.culture) continue;
    if (variant.subculture !== "") {
      if (query.subculture) {
        if (variant.subculture !== query.subculture) continue;
      } else if (query.culture && cultureOfSubculture(variant.subculture) !== query.culture) {
        continue;
      }
    }
    if (variant.faction !== "") {
      if (query.faction) {
        if (variant.faction !== query.faction) continue;
      } else if (query.culture && cultureOfFaction(variant.faction) !== query.culture) {
        continue;
      }
    }
    candidates.push(variant);
  }

  /** Every column this row pins was pinned to the same value by the query. */
  const appliesExactly = (variant: BuildingVariantRow) =>
    (variant.culture === "" || variant.culture === query.culture) &&
    (variant.subculture === "" || variant.subculture === query.subculture) &&
    (variant.faction === "" || variant.faction === query.faction);

  const disablingCandidates = candidates.filter((variant) => variant.disables);
  const disabledBy = disablingCandidates.find(appliesExactly);
  if (disabledBy) return { disabledBy, candidateCount: candidates.length };

  let best: BuildingVariantRow | undefined;
  for (const candidate of candidates) {
    if (candidate.disables) continue;
    // Ties go to the later candidate: rows arrive vanilla-first, so that is the overriding pack.
    if (!best || candidate.specificity >= best.specificity) best = candidate;
  }
  return { variant: best, conditionalDisabledBy: disablingCandidates[0], candidateCount: candidates.length };
};

/**
 * The band a level is drawn in.
 *
 * The chain's binding wins, and a level's own binding is only used when its chain has none. That is
 * the opposite of "most specific wins", and it is what the game does: every `wh_main_emp_forges_*`
 * and `wh_main_emp_stables_*` level is bound to `wh3_dlc25_set_emp_military_support`, a set flagged
 * `show_in_ui = false`, while their chains are bound to the visible
 * `wh_main_set_empire_military_support` - which is the band the game draws them in. Likewise the
 * College of Magic's levels are bound to `wh_main_set_empire_wizards` but the game shows the chain's
 * `wh2_main_set_landmark`. Preferring the level binding hides all of them.
 *
 * An `exclude` row removes that set at either granularity.
 */
const resolveSetsForLevel = (data: BuiltBuildingsData, levelKey: string, chainKey: string): string[] => {
  const levelSets = new Set<string>();
  const chainSets = new Set<string>();
  const excluded = new Set<string>();

  for (const binding of data.setBindings) {
    const matchesLevel = binding.level != undefined && binding.level === levelKey;
    const matchesChain = binding.chain != undefined && binding.chain === chainKey;
    if (!matchesLevel && !matchesChain) continue;
    if (binding.exclude) excluded.add(binding.set);
    else if (matchesChain) chainSets.add(binding.set);
    else levelSets.add(binding.set);
  }

  const chosen = chainSets.size > 0 ? chainSets : levelSets;
  return [...chosen].filter((set) => !excluded.has(set));
};

/**
 * Whether the chain belongs to a culture other than the one being asked about.
 *
 * A chain whose levels between them name cultures, none of which is this one, is somebody else's
 * building - `wh_main_horde_chaos_trolls` is bound to a Chaos band and its level 2 variant is
 * `wh_main_chs_chaos`, so it has no business in an Empire panel even though the generic secondary
 * chain set permits it.
 *
 * A chain that names no culture at all is left alone: `wh_main_emp_resource_pottery` and
 * `wh2_main_special_altdorf_imperial_palace` are culture-agnostic and the game does draw them.
 * Checked against the in-game panel for Altdorf: this hides no chain the game shows.
 */
const isChainForAnotherCulture = (data: BuiltBuildingsData, chainKey: string, culture: string | undefined): boolean => {
  if (!culture) return false;
  let namesAnyCulture = false;
  for (const levelKey of data.levelKeysByChain[chainKey] ?? []) {
    for (const variant of data.variantsByLevel[levelKey] ?? []) {
      if (!variant.culture) continue;
      if (variant.culture === culture) return false;
      namesAnyCulture = true;
    }
  }
  return namesAnyCulture;
};

/**
 * The board row a level sits on, 0 at the bottom.
 *
 * The settlement and port chains *are* the y-axis, so they are placed by their own level with their
 * first tier on row 0 - level 0 is their ruin, which only appears with the toggle on and shares row
 * 0 rather than going negative. Everything else is placed by the primary tier it requires, so a
 * barracks needing settlement level 2 lines up with settlement level 2 whatever its own level is.
 *
 * Guarded against a non-finite requirement: a `BuiltBuildingsData` restored from a disk cache written
 * before this field existed has it undefined, and an undefined row silently becomes a NaN grid row,
 * which CSS drops into auto-placement and piles every tile into one cell.
 */
const tierRowOf = (level: { level: number; primarySlotLevelRequirement: number }, isSettlementOrPort: boolean) => {
  if (isSettlementOrPort) return Math.max(0, level.level - 1);
  const requirement = Number(level.primarySlotLevelRequirement);
  return Number.isFinite(requirement) ? Math.max(0, requirement - 1) : 0;
};

export const resolveRegionBuildings = (data: BuiltBuildingsData, query: BuildingsRegionQuery): BuildingsRegionView => {
  const cultureBySubculture = new Map(data.subcultures.map((entry) => [entry.key, entry.culture]));
  const cultureByFaction = new Map(data.factions.map((entry) => [entry.key, entry.culture]));
  const cultureOfSubculture = (subculture: string) => cultureBySubculture.get(subculture);
  const cultureOfFaction = (faction: string) => cultureByFaction.get(faction);

  // --- 1. region -> slot templates ------------------------------------------
  const regionSlotTemplates = data.regionSlotTemplates[`${query.campaign}|${query.region}`] ?? [];
  const foreignSlotTemplates = query.faction
    ? (data.foreignRegionSlotTemplates[`${query.campaign}|${query.region}|${query.faction}`] ?? [])
    : [];
  const slotTemplates = [...regionSlotTemplates, ...foreignSlotTemplates];

  // --- 2. slot templates -> candidate chains --------------------------------
  const candidateChains = new Set<string>();
  const sourcesByChain = new Map<string, string[]>();
  /** Which slot types offered each chain, which is what marks its level 0 as a ruin. */
  const slotTypesByChain = new Map<string, Set<string>>();
  const foreignSlotChains = new Set<string>();
  const addChain = (chain: string, source: string, slotType: string, isForeignSlot: boolean) => {
    // Legacy pre-rework horde chains remain in broad vanilla chain sets but are not region buildings.
    if (chain.startsWith(HIDDEN_BUILDING_CHAIN_PREFIX)) return;
    if (!data.chains[chain]) return;
    candidateChains.add(chain);
    const sources = sourcesByChain.get(chain) ?? [];
    if (!sources.includes(source)) sources.push(source);
    sourcesByChain.set(chain, sources);
    const slotTypes = slotTypesByChain.get(chain) ?? new Set<string>();
    slotTypes.add(slotType);
    slotTypesByChain.set(chain, slotTypes);
    if (isForeignSlot) foreignSlotChains.add(chain);
  };
  const removeChain = (chain: string) => {
    candidateChains.delete(chain);
    sourcesByChain.delete(chain);
    slotTypesByChain.delete(chain);
    foreignSlotChains.delete(chain);
  };

  const removals: Array<{ chains: string[] }> = [];
  for (const slot of slotTemplates) {
    const template = slot.slotTemplate;
    for (const row of data.permittedByTemplate[template] ?? []) {
      const chains = row.chain
        ? [row.chain]
        : row.superChain
          ? (data.superChains[row.superChain] ?? [])
          : row.chainSet
            ? [...expandChainSet(data, row.chainSet)]
            : [];
      if (row.remove) {
        removals.push({ chains });
        continue;
      }
      const via = row.chainSet
        ? `slot_template:${template} via chain_set:${row.chainSet}`
        : row.superChain
          ? `slot_template:${template} via super_chain:${row.superChain}`
          : `slot_template:${template}`;
      for (const chain of chains) addChain(chain, via, slot.slotType, !!slot.isForeignSlot);
    }
    for (const superChain of data.superChainsByTemplate[template] ?? []) {
      for (const chain of data.superChains[superChain] ?? []) {
        addChain(
          chain,
          `slot_template:${template} via superchain junction:${superChain}`,
          slot.slotType,
          !!slot.isForeignSlot,
        );
      }
    }
  }
  // Adds first, then removes, so a remove row is not undone by a later add. See the plan's note:
  // the game may instead evaluate strictly in table order.
  for (const removal of removals) for (const chain of removal.chains) removeChain(chain);

  // --- 3. availability -------------------------------------------------------
  const availableChains: string[] = [];
  for (const chain of candidateChains) {
    const setIds = data.availabilitySetsByChain[chain];
    if (!setIds || setIds.length === 0) {
      availableChains.push(chain);
      continue;
    }
    const matched = setIds.some((setId) =>
      (data.availabilitiesBySetId[setId] ?? []).some((row) =>
        availabilityMatches(row, query, cultureOfSubculture, cultureOfFaction),
      ),
    );
    if (matched) availableChains.push(chain);
  }

  // --- 4. settlement type ----------------------------------------------------
  const settlementTypeKeys = new Set<string>();
  for (const chain of availableChains) {
    for (const binding of data.settlementTypeBindings[chain] ?? []) settlementTypeKeys.add(binding.settlementType);
  }
  const regionSettlements = data.startPosSettlements[`${query.campaign}|${query.region}`] ?? [];
  for (const settlement of regionSettlements) {
    if (settlement.settlementType) settlementTypeKeys.add(settlement.settlementType);
  }
  const settlementTypeNames = new Map(data.settlementTypes.map((option) => [option.key, option.localizedName]));
  const settlementTypeOptions: BuildingsOption[] = [...settlementTypeKeys]
    .map((key) => ({ key, localizedName: settlementTypeNames.get(key) ?? key }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const selectedSettlementType = query.settlementType;
  const visibleChains = availableChains
    .filter((chain) => {
      const bindings = data.settlementTypeBindings[chain];
      if (!selectedSettlementType) return true;
      if (!bindings || bindings.length === 0) return false;
      if (bindings.some((binding) => binding.settlementType === selectedSettlementType && binding.exclude))
        return false;
      return bindings.some((binding) => binding.settlementType === selectedSettlementType && !binding.exclude);
    })
    .filter((chain) => query.includeOtherCultureChains || !isChainForAnotherCulture(data, chain, query.culture));

  // --- 5-9. levels, variants, sets ------------------------------------------
  const existingBuildings = [...new Set(regionSettlements.flatMap((settlement) => settlement.buildings))];
  const existingSet = new Set(existingBuildings);
  const disabledLevels: BuildingsRegionView["disabledLevels"] = [];
  /** setKey -> chainKey -> tiles */
  const bandBuckets = new Map<string, Map<string, BuildingsTile[]>>();
  const visibleLevelKeys = new Set<string>();

  for (const chainKey of visibleChains) {
    const chain = data.chains[chainKey];
    // A chain offered only by a primary or port slot is the settlement or port itself, and its
    // level 0 is the razed state - the game's browser starts such a chain at level 1. Ordinary
    // buildings come from secondary slots and legitimately start at level 0
    // (wh_main_emp_barracks_1, wh_main_emp_resource_pottery_1), so this must not apply to them.
    const slotTypes = slotTypesByChain.get(chainKey);
    const isSettlementOrPortChain = !!slotTypes && slotTypes.size > 0 && !slotTypes.has("secondary");
    // `building_units_allowed` often repeats an unlock on every higher level that retains it. The
    // panel describes what each level newly adds, so remember units already introduced lower down
    // this chain. This is deliberately reset per chain: the same unit can be a new unlock elsewhere.
    const recruitmentAlreadyUnlocked = new Set<string>();

    for (const levelKey of data.levelKeysByChain[chainKey] ?? []) {
      const level = data.levelsByKey[levelKey];
      if (!level) continue;
      if (!level.visibleInUi && !query.includeHiddenInUi) continue;

      const isRuin = isSettlementOrPortChain && level.level === 0;
      if (isRuin && !query.includeRuinLevels) continue;

      const { variant, disabledBy, candidateCount } = pickCultureVariant(
        data,
        levelKey,
        query,
        cultureOfSubculture,
        cultureOfFaction,
      );
      if (disabledBy) {
        disabledLevels.push({ levelKey, variant: disabledBy });
        continue;
      }
      const hasNoVariant = !variant;
      if (hasNoVariant && !query.includeLevelsWithoutVariant) continue;

      // The panel is built out of set bands, so a level in no set has nowhere to be drawn and the
      // game leaves it out - which is what the five `greenskin_vandalisation` chains and
      // `wh2_dlc12_dummy_nuclear_ruins` were doing in an Empire panel. Every one of the 17 chains
      // the game does show for Altdorf has a binding, so this hides nothing real. Kept behind a
      // toggle because a modder who has just written a level and not yet bound it would otherwise
      // see nothing at all and have no way to tell why.
      const setKeys = resolveSetsForLevel(data, levelKey, chainKey);
      if (setKeys.length === 0 && !query.includeUnbandedLevels) continue;
      const targetSets = setKeys.length > 0 ? setKeys : [NO_SET_KEY];
      const loc = variant
        ? data.variantLoc[variantLocKey(levelKey, variant.culture, variant.subculture, variant.faction)]
        : undefined;
      const recruitable = (data.recruitableByLevel[levelKey] ?? []).filter(
        (unit) => !unit.faction || !query.faction || unit.faction === query.faction,
      );
      const newlyRecruitable = recruitable.filter((unit) => {
        if (recruitmentAlreadyUnlocked.has(unit.unitKey)) return false;
        recruitmentAlreadyUnlocked.add(unit.unitKey);
        return true;
      });

      for (const setKey of targetSets) {
        const tile: BuildingsTile = {
          levelKey,
          chainKey,
          setKey,
          level: level.level,
          romanNumeral: toRoman(isSettlementOrPortChain ? level.level : level.level + 1),
          createTime: level.createTime,
          createCost: level.createCost,
          upkeepCost: level.upkeepCost,
          foodCost: level.foodCost,
          developmentPointCost: level.developmentPointCost,
          onlyInCapital: level.onlyInCapital,
          factionUnique: level.factionUnique,
          visibleInUi: level.visibleInUi,
          instanceKey: level.instanceKey,
          instanceLimit: level.instanceKey ? data.instances[level.instanceKey] : undefined,
          title: loc?.name || levelKey,
          shortDescription: loc?.short,
          longDescription: loc?.long,
          iconPath: variant?.icon,
          variant,
          variantCount: candidateCount,
          effects: data.effectsByLevel[levelKey] ?? [],
          garrison: data.garrisonByLevel[levelKey] ?? [],
          recruitable: newlyRecruitable,
          tierRow: tierRowOf(level, isSettlementOrPortChain),
          isExistingInRegion: existingSet.has(levelKey),
          hasNoVariant,
          isRuin,
          isSettlementOrPort: isSettlementOrPortChain,
          isDuplicatedAcrossSets: targetSets.length > 1,
          isForeignSlot: foreignSlotChains.has(chainKey) || (chain?.isForeignSlotChain ?? false),
        };
        const chainBuckets = bandBuckets.get(setKey) ?? new Map<string, BuildingsTile[]>();
        const tiles = chainBuckets.get(chainKey) ?? [];
        tiles.push(tile);
        chainBuckets.set(chainKey, tiles);
        bandBuckets.set(setKey, chainBuckets);
      }
      visibleLevelKeys.add(levelKey);
    }
  }

  const bands: BuildingsSetBand[] = [...bandBuckets.entries()]
    .map(([setKey, chainBuckets]) => {
      const set = data.sets[setKey];
      const columns: BuildingsChainColumn[] = [...chainBuckets.entries()]
        .map(([chainKey, tiles]) => ({
          chainKey,
          localizedName: data.chains[chainKey]?.localizedName ?? chainKey,
          sortOrder: data.chains[chainKey]?.sortOrder ?? 0,
          tiles: tiles.sort((first, second) => first.level - second.level),
          sources: sourcesByChain.get(chainKey) ?? [],
        }))
        .sort((first, second) => first.sortOrder - second.sortOrder || first.chainKey.localeCompare(second.chainKey));
      return {
        setKey,
        localizedName: set?.localizedName ?? (setKey === NO_SET_KEY ? "Unassigned" : setKey),
        colourR: set?.colourR ?? 90,
        colourG: set?.colourG ?? 90,
        colourB: set?.colourB ?? 90,
        // The unassigned bucket has no row to sort on and belongs last.
        sortOrder: set?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        showInUi: set?.showInUi ?? true,
        columns,
      };
    })
    .filter((band) => band.showInUi || query.includeHiddenSets)
    .sort((first, second) => first.sortOrder - second.sortOrder || first.setKey.localeCompare(second.setKey));

  // --- 8. upgrade edges ------------------------------------------------------
  const edges: BuildingsUpgradeEdge[] = [];
  const explicitPairs = new Set<string>();
  for (const upgrade of data.upgrades) {
    if (!visibleLevelKeys.has(upgrade.from) || !visibleLevelKeys.has(upgrade.to)) continue;
    const fromLevel = data.levelsByKey[upgrade.from]?.level ?? 0;
    const toLevel = data.levelsByKey[upgrade.to]?.level ?? 0;
    // `building_upgrades_junction_tables` runs lower level to higher throughout vanilla, so this
    // normalisation is a no-op there; it is kept so a mod that inverts a row still draws a sane
    // arrow. `raw` keeps the original pair for a flip toggle.
    const [lower, higher] = fromLevel <= toLevel ? [upgrade.from, upgrade.to] : [upgrade.to, upgrade.from];
    const pair = `${lower}->${higher}`;
    if (explicitPairs.has(pair)) continue;
    explicitPairs.add(pair);
    edges.push({ fromLevelKey: lower, toLevelKey: higher, raw: upgrade, isImplicit: false });
  }
  for (const chainKey of visibleChains) {
    const levelKeys = (data.levelKeysByChain[chainKey] ?? []).filter((levelKey) => visibleLevelKeys.has(levelKey));
    for (let index = 0; index + 1 < levelKeys.length; index++) {
      const pair = `${levelKeys[index]}->${levelKeys[index + 1]}`;
      if (explicitPairs.has(pair)) continue;
      explicitPairs.add(pair);
      edges.push({ fromLevelKey: levelKeys[index], toLevelKey: levelKeys[index + 1], isImplicit: true });
    }
  }

  return {
    query,
    bands,
    edges,
    settlementTypeOptions,
    disabledLevels,
    existingBuildings,
    slotTemplates,
  };
};
