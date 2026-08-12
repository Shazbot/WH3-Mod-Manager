import { EsfDocument, RegionSummary } from "../esf/EsfTypes";

const BANNED_TOKENS = new Set([
  "ability",
  "agent",
  "art",
  "army",
  "audio",
  "banner",
  "battle",
  "building",
  "cav",
  "character",
  "climate",
  "corruption",
  "culture",
  "description",
  "dilemmas",
  "effect",
  "event",
  "faction",
  "flags",
  "hero",
  "horde",
  "incident",
  "inf",
  "lord",
  "mission",
  "mon",
  "name",
  "names",
  "objective",
  "party",
  "political",
  "religion",
  "resource",
  "ritual",
  "script",
  "skill",
  "special",
  "start",
  "subculture",
  "technology",
  "tech",
  "text",
  "title",
  "trait",
  "ui",
  "veh",
  "victory",
  "video",
  "vo",
  "weapon",
  "wizard",
]);

const RACE_CODE_TOKENS = new Set([
  "beastmen",
  "brt",
  "bst",
  "chs",
  "cst",
  "cth",
  "def",
  "dwf",
  "emp",
  "grn",
  "hef",
  "kho",
  "ksl",
  "lzd",
  "nor",
  "nur",
  "ogr",
  "skv",
  "sla",
  "teb",
  "tmb",
  "tze",
  "vmp",
  "wef",
]);

function isRegionLikeKey(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return false;
  }

  if (!(normalized.startsWith("wh_") || normalized.startsWith("wh2_") || normalized.startsWith("wh3_"))) {
    return false;
  }

  const tokens = normalized.split("_");
  if (tokens.length < 4 || tokens.length > 12) {
    return false;
  }

  if (tokens[2] && RACE_CODE_TOKENS.has(tokens[2])) {
    return false;
  }

  for (const token of tokens) {
    if (BANNED_TOKENS.has(token)) {
      return false;
    }

    if (/^qb\d*$/.test(token) || /^ror\d*$/.test(token) || /^dil\d*$/.test(token)) {
      return false;
    }
  }

  return true;
}

export function extractRegions(document: EsfDocument): RegionSummary[] {
  const resultsByKey = new Map<string, RegionSummary>();

  document.stringTable.forEach((entry, index) => {
    if (entry.table === "record_name") {
      return;
    }

    if (!isRegionLikeKey(entry.text)) {
      return;
    }

    const existing = resultsByKey.get(entry.text);
    if (!existing || (existing.id ?? Number.MAX_SAFE_INTEGER) > entry.id) {
      resultsByKey.set(entry.text, {
        key: entry.text,
        id: entry.id,
        path: `/ESF/STRING_TABLE[${index}]`,
      });
    }
  });

  return [...resultsByKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
