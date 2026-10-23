/** Stable pack-format context shared by the application and standalone tooling. */
export const packGames = [
  "wh3",
  "wh2",
  "threeKingdoms",
  "attila",
  "troy",
  "pharaoh",
  "dynasties",
  "rome2",
  "shogun2",
] as const;

export type PackGame = (typeof packGames)[number];

export const packGameToHeader: Record<PackGame, string> = {
  wh2: "PFH5",
  wh3: "PFH5",
  threeKingdoms: "PFH5",
  attila: "PFH4",
  troy: "PFH5",
  pharaoh: "PFH5",
  dynasties: "PFH5",
  rome2: "PFH4",
  shogun2: "PFH3",
};

export const packGameSupportsCompression: Record<PackGame, boolean> = {
  wh2: true,
  wh3: true,
  threeKingdoms: true,
  attila: false,
  troy: true,
  pharaoh: true,
  dynasties: true,
  rome2: false,
  shogun2: false,
};
