/**
 * Flow option placeholders are substituted per top-level string field of a node's data, but the deep
 * clone node keeps its values nested inside columnOverrides and variantAxes. This walks those two
 * structures so "{{myOption}}" works in an override value as well.
 *
 * Both execution paths call it with their own replacer: the editor's manual run and the automatic run
 * at game launch substitute placeholders differently, but the shape of the data is the same.
 */
export const substituteDeepCloneOptionValues = (
  nodeData: Record<string, unknown>,
  replace: (value: string) => string,
): boolean => {
  let modified = false;

  const replaceOverrides = (overrides: unknown): unknown => {
    if (!Array.isArray(overrides)) return overrides;

    return overrides.map((override) => {
      if (!override || typeof override !== "object") return override;
      const value = (override as Record<string, unknown>).value;
      if (typeof value !== "string" || !value) return override;

      const nextValue = replace(value);
      if (nextValue === value) return override;

      modified = true;
      return { ...(override as Record<string, unknown>), value: nextValue };
    });
  };

  if (Array.isArray(nodeData.columnOverrides)) {
    nodeData.columnOverrides = replaceOverrides(nodeData.columnOverrides);
  }

  if (Array.isArray(nodeData.variantAxes)) {
    nodeData.variantAxes = nodeData.variantAxes.map((axis) => {
      if (!axis || typeof axis !== "object") return axis;
      const axisRecord = axis as Record<string, unknown>;
      const nextAxis: Record<string, unknown> = { ...axisRecord };

      // A range axis carries its bounds as strings so an end user can choose how many clones to make.
      for (const fieldName of ["rangeStart", "rangeEnd", "rangeStep", "rangeSuffix"]) {
        const value = nextAxis[fieldName];
        if (typeof value !== "string" || !value) continue;
        const nextValue = replace(value);
        if (nextValue === value) continue;
        nextAxis[fieldName] = nextValue;
        modified = true;
      }
      nextAxis.rangeOverrides = replaceOverrides(axisRecord.rangeOverrides);

      const values = axisRecord.values;
      if (Array.isArray(values)) {
        nextAxis.values = values.map((axisValue) => {
          if (!axisValue || typeof axisValue !== "object") return axisValue;
          return {
            ...(axisValue as Record<string, unknown>),
            overrides: replaceOverrides((axisValue as Record<string, unknown>).overrides),
          };
        });
      }

      return nextAxis;
    });
  }

  return modified;
};

/**
 * Substitutes placeholders into the filter node's rows, whose values are nested inside `filters` and
 * so are skipped by the top-level field substitution. This is what lets a filter match against a
 * multiline option: "{{myUnits}}" becomes the newline-separated list, which the filter reads as a set.
 */
export const substituteFilterOptionValues = (
  nodeData: Record<string, unknown>,
  replace: (value: string) => string,
): boolean => {
  if (!Array.isArray(nodeData.filters)) return false;

  let modified = false;
  nodeData.filters = nodeData.filters.map((filterRow) => {
    if (!filterRow || typeof filterRow !== "object") return filterRow;
    const value = (filterRow as Record<string, unknown>).value;
    if (typeof value !== "string" || !value) return filterRow;

    const nextValue = replace(value);
    if (nextValue === value) return filterRow;

    modified = true;
    return { ...(filterRow as Record<string, unknown>), value: nextValue };
  });

  return modified;
};

/** Fields of a loc rule that accept a flow option placeholder. */
const locRuleOptionFields = ["keyPrefix", "find", "replaceWith", "prepend", "append"] as const;

/**
 * Substitutes placeholders into the loc rules, which are nested inside `locRules` and so are skipped
 * by the top-level field substitution. Lets the wording of an appended suffix be a user-set option.
 */
export const substituteLocRuleValues = (
  nodeData: Record<string, unknown>,
  replace: (value: string) => string,
): boolean => {
  if (!Array.isArray(nodeData.locRules)) return false;

  let modified = false;
  nodeData.locRules = nodeData.locRules.map((rule) => {
    if (!rule || typeof rule !== "object") return rule;
    const nextRule = { ...(rule as Record<string, unknown>) };
    for (const fieldName of locRuleOptionFields) {
      const value = nextRule[fieldName];
      if (typeof value !== "string" || !value) continue;
      const nextValue = replace(value);
      if (nextValue === value) continue;
      nextRule[fieldName] = nextValue;
      modified = true;
    }
    return nextRule;
  });

  return modified;
};
