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
  BuildingsBoardMode,
  BuildingsChainColumn,
  BuildingsForeignSlotTypeOption,
  BuildingsOption,
  BuildingsRegionQuery,
  BuildingsRegionView,
  BuildingsSetBand,
  BuildingsTile,
  BuildingsUpgradeEdge,
  BuiltBuildingsData,
  RegionSlot,
} from "./types";
import { HIDDEN_BUILDING_CHAIN_PREFIX, variantLocKey } from "./data";

/** Bucket for levels no building set claims, rendered last. */
export const NO_SET_KEY = "__no_set__";

/**
 * Which slot family the query is browsing.
 *
 * `mode` is authoritative; a query written before it existed said "browse foreign slots" simply by
 * naming a type, so that still resolves to `undercity`.
 */
export const boardModeOf = (query: BuildingsRegionQuery): BuildingsBoardMode =>
  query.mode ?? (query.foreignSlotType ? "undercity" : "normal");

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

/**
 * Every slot template one `slot_sets_tables.type` offers, shaped like a region slot.
 *
 * A foreign slot belongs to a slot set, not to a region, so there is no region to name: the campaign
 * is carried through because availability rows still filter on it, and the region is left empty.
 */
export const foreignSlotTemplatesForType = (
  data: BuiltBuildingsData,
  foreignSlotType: string,
  campaign = "",
): RegionSlot[] =>
  (data.foreignSlotTemplatesByType?.[foreignSlotType] ?? []).map((entry) => ({
    campaign,
    region: "",
    slotTemplate: entry.slotTemplate,
    slotType: entry.slotType,
    id: entry.id,
    isForeignSlot: true,
    slotSet: entry.slotSet,
  }));

/**
 * Every horde slot template, shaped like a region slot.
 *
 * A horde carries its slots with its army rather than being granted them by a region or a slot set,
 * so there is no region to name. The campaign is carried through because availability rows still
 * filter on it. `isForeignSlot` stays unset: a horde slot is the army's own, not somebody else's.
 */
export const hordeSlotTemplatesFor = (data: BuiltBuildingsData, campaign = ""): RegionSlot[] =>
  (data.hordeSlotTemplates ?? []).map((entry) => ({
    campaign,
    region: "",
    slotTemplate: entry.slotTemplate,
    slotType: entry.slotType,
    id: entry.id,
  }));

interface SlotTemplateChains {
  candidateChains: Set<string>;
  sourcesByChain: Map<string, string[]>;
  /** Which slot types offered each chain, which is what marks its level 0 as a ruin. */
  slotTypesByChain: Map<string, Set<string>>;
  foreignSlotChains: Set<string>;
}

/**
 * Every chain a set of slot templates permits, before availability is considered.
 *
 * Shared by the region board and by the foreign slot type summary, so both read the same
 * `slot_template_permitted_building_chains` rules - chain, chain set, super chain and the superchain
 * junction table - rather than one of them growing its own approximation.
 */
const collectChainsForSlotTemplates = (
  data: BuiltBuildingsData,
  slotTemplates: RegionSlot[],
  /**
   * Lifts the legacy `wh_main_horde_*` ban, which exists only because those chains leak into broad
   * vanilla chain sets a *region* reaches. The horde chain sets name them deliberately, so on a
   * horde board they are the content.
   */
  allowHordeChains = false,
): SlotTemplateChains => {
  const candidateChains = new Set<string>();
  const sourcesByChain = new Map<string, string[]>();
  const slotTypesByChain = new Map<string, Set<string>>();
  const foreignSlotChains = new Set<string>();
  const addChain = (chain: string, source: string, slotType: string, isForeignSlot: boolean) => {
    // Legacy pre-rework horde chains remain in broad vanilla chain sets but are not region buildings.
    if (!allowHordeChains && chain.startsWith(HIDDEN_BUILDING_CHAIN_PREFIX)) return;
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

  return { candidateChains, sourcesByChain, slotTypesByChain, foreignSlotChains };
};

interface RegionChainContext {
  cultureOfSubculture: (subculture: string) => string | undefined;
  cultureOfFaction: (faction: string) => string | undefined;
  slotTemplates: RegionSlot[];
  availableChains: string[];
  sourcesByChain: Map<string, string[]>;
  slotTypesByChain: Map<string, Set<string>>;
  foreignSlotChains: Set<string>;
  cultureChains: string[];
  settlementTypeOptions: BuildingsOption[];
  settlementTypeDisabled: boolean;
}

/**
 * Resolves the inexpensive part of a region's building board: its slot templates, candidate
 * chains, availability, and settlement types. The map tab uses this without constructing every
 * building tile for every region on the campaign map.
 */
const resolveRegionChainContext = (data: BuiltBuildingsData, query: BuildingsRegionQuery): RegionChainContext => {
  const cultureBySubculture = new Map(data.subcultures.map((entry) => [entry.key, entry.culture]));
  const cultureByFaction = new Map(data.factions.map((entry) => [entry.key, entry.culture]));
  const cultureOfSubculture = (subculture: string) => cultureBySubculture.get(subculture);
  const cultureOfFaction = (faction: string) => cultureByFaction.get(faction);

  // --- 1. region -> slot templates ------------------------------------------
  // A foreign slot type or a horde replaces the region entirely: those slots are granted by a slot
  // set or carried by an army, and can turn up under any region or none, so mixing them with one
  // region's own slots would be a view of something the game never shows together.
  const mode = boardModeOf(query);
  const regionSlotTemplates =
    mode === "normal" ? (data.regionSlotTemplates[`${query.campaign}|${query.region}`] ?? []) : [];
  const foreignSlotTemplates =
    mode === "undercity"
      ? query.foreignSlotType
        ? foreignSlotTemplatesForType(data, query.foreignSlotType, query.campaign)
        : []
      : mode === "normal" && query.faction
        ? (data.foreignRegionSlotTemplates[`${query.campaign}|${query.region}|${query.faction}`] ?? [])
        : [];
  const hordeSlotTemplates = mode === "horde" ? hordeSlotTemplatesFor(data, query.campaign) : [];
  const slotTemplates = [...regionSlotTemplates, ...foreignSlotTemplates, ...hordeSlotTemplates];

  // --- 2. slot templates -> candidate chains --------------------------------
  const { candidateChains, sourcesByChain, slotTypesByChain, foreignSlotChains } = collectChainsForSlotTemplates(
    data,
    slotTemplates,
    mode === "horde",
  );

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
  // A settlement type describes the settlement a slot belongs to. Neither a foreign slot nor a horde
  // slot has a settlement of its own - one is granted inside whatever settlement the host region
  // has, the other travels with an army - so browsing either leaves the dropdown empty and section 5
  // skips the filter rather than hiding the ~50 of vanilla's 53 foreign chains that also name one of
  // the Chaos Dwarf, daemon or Norsca settlement types.
  const settlementTypeKeys = new Set<string>();
  if (mode === "normal") {
    for (const chain of availableChains) {
      for (const binding of data.settlementTypeBindings[chain] ?? []) settlementTypeKeys.add(binding.settlementType);
    }
  }
  const regionSettlements =
    mode === "normal" ? (data.startPosSettlements[`${query.campaign}|${query.region}`] ?? []) : [];
  for (const settlement of regionSettlements) {
    if (settlement.settlementType) settlementTypeKeys.add(settlement.settlementType);
  }
  const settlementTypeNames = new Map(data.settlementTypes.map((option) => [option.key, option.localizedName]));
  const settlementTypeOptions: BuildingsOption[] = [...settlementTypeKeys]
    .map((key) => ({ key, localizedName: settlementTypeNames.get(key) ?? key }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const cultureChains = availableChains.filter((chain) => !isChainForAnotherCulture(data, chain, query.culture));
  const settlementTypeDisabled =
    mode !== "normal" || !cultureChains.some((chain) => (data.settlementTypeBindings[chain] ?? []).length > 0);

  return {
    cultureOfSubculture,
    cultureOfFaction,
    slotTemplates,
    availableChains,
    sourcesByChain,
    slotTypesByChain,
    foreignSlotChains,
    cultureChains,
    settlementTypeOptions,
    settlementTypeDisabled,
  };
};

/**
 * The foreign slot types the panel can browse, each with the filter values its buildings name.
 *
 * The culture, subculture and faction dropdowns are narrowed to these while a type is selected: only
 * values some chain of the type actually mentions - through a culture variant or through an
 * availability row - can change what the board shows, and listing the game's ~900 factions when nine
 * of them matter buries the ones that do.
 */
export const resolveForeignSlotTypes = (data: BuiltBuildingsData): BuildingsForeignSlotTypeOption[] =>
  Object.keys(data.foreignSlotTemplatesByType ?? {})
    .sort((first, second) => first.localeCompare(second))
    .map((type) => {
      const slots = foreignSlotTemplatesForType(data, type);
      const { candidateChains } = collectChainsForSlotTemplates(data, slots);
      const cultures = new Set<string>();
      const subcultures = new Set<string>();
      const factions = new Set<string>();
      for (const chain of candidateChains) {
        for (const levelKey of data.levelKeysByChain[chain] ?? []) {
          for (const variant of data.variantsByLevel[levelKey] ?? []) {
            if (variant.culture) cultures.add(variant.culture);
            if (variant.subculture) subcultures.add(variant.subculture);
            if (variant.faction) factions.add(variant.faction);
          }
        }
        for (const setId of data.availabilitySetsByChain[chain] ?? []) {
          for (const row of data.availabilitiesBySetId[setId] ?? []) {
            if (row.culture) cultures.add(row.culture);
            if (row.subCulture) subcultures.add(row.subCulture);
            if (row.faction) factions.add(row.faction);
          }
        }
      }
      return {
        key: type,
        // `slot_sets_tables.type` points at `slot_set_types`, which carries no localised name.
        localizedName: type,
        slotTemplates: [...new Set(slots.map((slot) => slot.slotTemplate))].sort(),
        cultures: [...cultures].sort(),
        subcultures: [...subcultures].sort(),
        factions: [...factions].sort(),
      };
    });

/**
 * Returns the total active settlement slots for the imported primary building. The table is keyed
 * by the primary chain and its numeric level, so a secondary building must never influence this
 * value even if it happens to be the one currently selected in the editor.
 */
export const resolveMaxBuildingSlotCount = (data: BuiltBuildingsData, primaryBuilding?: string): number | undefined => {
  if (!primaryBuilding) return undefined;
  const level = data.levelsByKey[primaryBuilding];
  if (!level) return undefined;
  return data.campaignBuildingChainSlotUnlocksByChain?.[level.chain]?.find((row) => row.level === level.level)
    ?.activeSlotCount;
};

/**
 * The cultures this query would leave with an empty board.
 *
 * Horde boards only. Most of the game's cultures have no horde at all - 17 of vanilla's 27 draw
 * nothing - and nothing on a board distinguishes "this culture has no horde" from "these filters
 * happen to exclude everything". A region board has a chain for every culture somewhere, and the
 * undercity picker is already narrowed to the cultures its slot type names, so neither needs it.
 *
 * Derived by running the query once per culture rather than approximated: a culture affects which
 * chains survive availability, which of them are somebody else's, and which levels have a variant to
 * draw, so only the real derivation answers it. The full sweep against the largest board - horde,
 * 124 chains - measures at ~25ms against ~2ms for the view itself.
 *
 * The candidate query mirrors what picking a culture actually does (see the picker's own `onSelect`):
 * choosing one clears the subculture, faction and settlement type that hang off it.
 */
export const resolveCulturesWithoutChains = (data: BuiltBuildingsData, query: BuildingsRegionQuery): string[] => {
  if (boardModeOf(query) !== "horde") return [];
  return data.cultures
    .filter(
      (culture) =>
        resolveRegionBuildings(data, {
          ...query,
          culture: culture.key,
          subculture: undefined,
          faction: undefined,
          settlementType: undefined,
        }).bands.length === 0,
    )
    .map((culture) => culture.key);
};

export const resolveRegionSettlementTypes = (data: BuiltBuildingsData, query: BuildingsRegionQuery): string[] => {
  const { cultureChains } = resolveRegionChainContext(data, query);
  const settlementTypeKeys = new Set<string>();
  for (const chain of cultureChains) {
    const bindings = data.settlementTypeBindings[chain] ?? [];
    const excluded = new Set(bindings.filter((binding) => binding.exclude).map((binding) => binding.settlementType));
    for (const binding of bindings) {
      if (!binding.exclude && !excluded.has(binding.settlementType)) settlementTypeKeys.add(binding.settlementType);
    }
  }
  for (const settlement of data.startPosSettlements[`${query.campaign}|${query.region}`] ?? []) {
    if (settlement.settlementType) settlementTypeKeys.add(settlement.settlementType);
  }
  return [...settlementTypeKeys].sort((first, second) => first.localeCompare(second));
};

export const resolveRegionBuildings = (data: BuiltBuildingsData, query: BuildingsRegionQuery): BuildingsRegionView => {
  const {
    cultureOfSubculture,
    cultureOfFaction,
    slotTemplates,
    availableChains,
    sourcesByChain,
    slotTypesByChain,
    foreignSlotChains,
    settlementTypeOptions,
    settlementTypeDisabled,
  } = resolveRegionChainContext(data, query);

  // Nothing about a foreign or horde slot is regional: no start pos settlement places its buildings,
  // so no tile can be "already built in this region" either.
  const mode = boardModeOf(query);
  const regionSettlements =
    mode === "normal" ? (data.startPosSettlements[`${query.campaign}|${query.region}`] ?? []) : [];
  const selectedSettlementType = mode === "normal" ? query.settlementType : undefined;
  const visibleChains = availableChains
    .filter((chain) => {
      if (mode !== "normal") return true;
      const bindings = data.settlementTypeBindings[chain];
      if (!selectedSettlementType) return !bindings || bindings.length === 0;
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
    // Foreign slots are ordinary in exactly the same way: every vanilla foreign chain starts at
    // level 0 and none of them is a settlement, so a `foreign` slot type must not make one look razed.
    const slotTypes = slotTypesByChain.get(chainKey);
    // A horde board's slots are all `horde_primary`/`horde_secondary`, which would otherwise pass
    // the test above and make every horde building look like a settlement: level 0 hidden as a ruin
    // and every tier numbered one too low. Its own numbering is handled below instead.
    const isSettlementOrPortChain =
      mode !== "horde" && !!slotTypes && slotTypes.size > 0 && !slotTypes.has("secondary") && !slotTypes.has("foreign");
    const isHordePrimaryChain = mode === "horde" && !!slotTypes?.has("horde_primary");
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

      // Horde slots number their tiers from 0, unlike a region's 1-based settlement levels: a horde
      // primary chain *is* its board's y-axis and is placed by its own level, and a secondary's
      // `primary_slot_building_building_level_requirement` is already the row index rather than one
      // past it - `wh2_dlc11_vampirecoast_ship_hull` requires ship tiers 0, 2 and 4. Feeding either
      // through `tierRowOf` would collapse the bottom two rows into one.
      const hordeTierRow =
        mode !== "horde"
          ? undefined
          : isHordePrimaryChain
            ? level.level
            : Math.max(0, Number(level.primarySlotLevelRequirement) || 0);

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
      const recruitableRows = (data.recruitableByLevel[levelKey] ?? []).filter(
        (unit) => !unit.faction || !query.faction || unit.faction === query.faction,
      );
      const newlyRecruitable = recruitableRows.filter((unit) => {
        if (recruitmentAlreadyUnlocked.has(unit.unitKey)) return false;
        recruitmentAlreadyUnlocked.add(unit.unitKey);
        return true;
      });

      for (const setKey of targetSets) {
        const tile: BuildingsTile = {
          levelKey,
          chainKey,
          superChainKey: chain?.superChain || undefined,
          setKey,
          level: level.level,
          // Horde chains are numbered from 0 throughout, so their first tier is already `I`.
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
          recruitableRows,
          levelRowValues: level.rawValues,
          tierRow: hordeTierRow ?? tierRowOf(level, isSettlementOrPortChain),
          isExistingInRegion: existingSet.has(levelKey),
          hasNoVariant,
          isRuin,
          isSettlementOrPort: isSettlementOrPortChain,
          isDuplicatedAcrossSets: targetSets.length > 1,
          isForeignSlot: foreignSlotChains.has(chainKey) || (chain?.isForeignSlotChain ?? false),
          slotTypes: slotTypes ? [...slotTypes].sort() : [],
          slotTemplates: [
            ...new Set(
              (sourcesByChain.get(chainKey) ?? [])
                .filter((source) => source.startsWith("slot_template:"))
                .map((source) => source.slice("slot_template:".length).split(" via ")[0]),
            ),
          ].sort(),
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
  // An implicit edge fills in a chain the upgrade junction says nothing about, by assuming each
  // level upgrades into the next one listed. A branching chain breaks that assumption twice over, so
  // the guess stands down wherever the junction table has already spoken for either end:
  // `wh3_main_underdeep_dwf_grudges` lists `_2` and `_2_a` as two alternatives on one tier - joining
  // them would draw a sideways arrow between siblings - and `_2_a` is a dead end whose successor
  // `_3` is already reached explicitly from `_2`.
  const explicitSources = new Set(edges.map((edge) => edge.fromLevelKey));
  const explicitTargets = new Set(edges.map((edge) => edge.toLevelKey));
  for (const chainKey of visibleChains) {
    const levelKeys = (data.levelKeysByChain[chainKey] ?? []).filter((levelKey) => visibleLevelKeys.has(levelKey));
    for (let index = 0; index + 1 < levelKeys.length; index++) {
      const [from, to] = [levelKeys[index], levelKeys[index + 1]];
      const pair = `${from}->${to}`;
      if (explicitPairs.has(pair)) continue;
      // Two levels the DB gives the same level number are alternatives, not a sequence.
      if ((data.levelsByKey[from]?.level ?? 0) === (data.levelsByKey[to]?.level ?? 0)) continue;
      if (explicitSources.has(from) || explicitTargets.has(to)) continue;
      explicitPairs.add(pair);
      edges.push({ fromLevelKey: from, toLevelKey: to, isImplicit: true });
    }
  }

  const maxSlotCount = resolveMaxBuildingSlotCount(data, query.primaryBuilding);
  return {
    query,
    bands,
    edges,
    settlementTypeOptions,
    settlementTypeDisabled,
    disabledLevels,
    existingBuildings,
    slotTemplates,
    ...(maxSlotCount === undefined ? {} : { maxSlotCount }),
  };
};
