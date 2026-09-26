const NON_MODDER_STUMP_WARNING = "No candidate could be resolved for slot 'stumps' in root.";

export const filterVisualsModelPreviewWarnings = (
  warnings: readonly string[],
  isFeaturesForModdersEnabled: boolean,
): string[] =>
  isFeaturesForModdersEnabled
    ? [...warnings]
    : warnings.filter((warning) => warning !== NON_MODDER_STUMP_WARNING);
