/**
 * Returns the value that follows a value-taking flag, failing loudly when it is
 * missing. Without this, a trailing `--file` (or a typo'd flag) silently keeps
 * the previous default and the CLI reads the wrong input.
 */
export function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

/** Parses an integer flag value, rejecting anything non-numeric or below `min`. */
export function requireInt(flag: string, value: string | undefined, min: number): number {
  const parsed = Number.parseInt(requireValue(flag, value), 10);
  if (Number.isNaN(parsed) || parsed < min) {
    throw new Error(`Invalid value for ${flag}: expected an integer >= ${min}.`);
  }
  return parsed;
}
