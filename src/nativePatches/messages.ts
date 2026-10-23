import type { NativePatchIdentity } from "./manifest";

/** Keep helper diagnostics in the log; describe the outcome in launch notifications. */
export const nativePatchUserMessage = (
  packages: NativePatchIdentity[],
  outcome: "skipped" | "stopped" | "unknown",
): string => {
  const modNames = [
    ...new Set(
      packages
        .map(
          (item) => item.sourceModName?.trim() || item.sourcePackPath?.split(/[\\/]/).pop() || item.packageName?.trim(),
        )
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const subject = modNames.length ? modNames.map((name) => `“${name}”`).join(", ") : "A mod";
  if (outcome === "skipped") {
    return `${subject}: a game patch couldn't be applied. Continuing without this patch. Try updating the mod.`;
  }
  if (outcome === "unknown") {
    return `${subject}: game patching couldn't finish. Close the game if it is running, then update or disable the mod and try again.`;
  }
  return `${subject}: a game patch couldn't be applied. The game wasn't started. Update or disable the mod and try again.`;
};
