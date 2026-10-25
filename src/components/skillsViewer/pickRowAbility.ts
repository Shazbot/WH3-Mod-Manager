const uniqueByKey = (abilities: AbilityTooltipData[]) => [
  ...new Map(abilities.map((ability) => [ability.key, ability])).values(),
];

/**
 * Picks the spell an effect row opens a tooltip for. The spell whose name the effect text contains wins, an upgraded
 * spell beating its base. Several unrelated matches, or no match and several candidates, are ambiguous and give none.
 * @param effectText The effect's localised text.
 * @param abilities The spells the effect is mapped to.
 * @param hiddenEffectAbilities The spells of the skill's hidden effects, which only count when the text names one.
 * @returns The spell, or undefined when none can be told apart.
 */
export function pickRowAbility(
  effectText: string | undefined,
  abilities: AbilityTooltipData[],
  hiddenEffectAbilities: AbilityTooltipData[],
): AbilityTooltipData | undefined {
  const own = uniqueByKey(abilities);
  const matching = (own.length > 0 ? own : uniqueByKey(hiddenEffectAbilities)).filter(
    (ability) => !!ability.name && !!effectText?.includes(ability.name),
  );
  // Variants of one spell share a name, and are told apart by nothing, so the first stands for them.
  const named = matching.filter(
    (ability, index) => matching.findIndex((other) => other.name === ability.name) === index,
  );
  const longest = named.filter(
    (ability) => !named.some((other) => other.name !== ability.name && other.name.includes(ability.name)),
  );
  if (longest.length === 1) return longest[0];
  if (longest.length > 1) return undefined;
  return own.length === 1 ? own[0] : undefined;
}
