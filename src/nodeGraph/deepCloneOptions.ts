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
      const values = (axis as Record<string, unknown>).values;
      if (!Array.isArray(values)) return axis;

      return {
        ...(axis as Record<string, unknown>),
        values: values.map((axisValue) => {
          if (!axisValue || typeof axisValue !== "object") return axisValue;
          return {
            ...(axisValue as Record<string, unknown>),
            overrides: replaceOverrides((axisValue as Record<string, unknown>).overrides),
          };
        }),
      };
    });
  }

  return modified;
};
