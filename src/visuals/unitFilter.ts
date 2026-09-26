export type CompiledVisualsUnitFilter = {
  regex?: RegExp;
  error?: string;
};

export const compileVisualsUnitFilter = (pattern: string): CompiledVisualsUnitFilter => {
  const trimmed = pattern.trim();
  if (!trimmed) return {};
  try {
    return { regex: new RegExp(trimmed, "i") };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid regular expression",
    };
  }
};
