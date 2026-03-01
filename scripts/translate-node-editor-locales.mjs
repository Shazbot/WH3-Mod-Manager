// use like
// node scripts/translate-node-editor-locales.mjs --start 569 --end 570
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_LANG = "en";
const DEFAULT_TARGET_LANGS = ["de", "es", "fr", "ja", "ko", "pl", "pt", "ru", "tr", "zh"];
const DEFAULT_PREFIX = "nodeEditor";

const repoRoot = process.cwd();
const localesDir = path.join(repoRoot, "locales");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const usage = () => {
  // Keep this minimal and CLI-friendly (no extra deps).
  console.log(
    [
      "Usage:",
      "  node scripts/translate-node-editor-locales.mjs --start <line> --end <line> [--langs de,es,...] [--dry-run]",
      "  node scripts/translate-node-editor-locales.mjs --prefix <keyPrefix> [--langs de,es,...] [--dry-run]",
      "",
      "Defaults:",
      `  --prefix ${DEFAULT_PREFIX}`,
      `  --langs ${DEFAULT_TARGET_LANGS.join(",")}`,
      "",
      "Notes:",
      "  - The --start/--end range is 1-based and inclusive, and is applied to locales/en/translation.json.",
      "  - Only updates a target locale if the key is missing or its value is still identical to English.",
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    start: undefined,
    end: undefined,
    prefix: undefined,
    langs: DEFAULT_TARGET_LANGS,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--start") opts.start = Number(args[++i]);
    else if (a === "--end") opts.end = Number(args[++i]);
    else if (a === "--prefix") opts.prefix = String(args[++i]);
    else if (a === "--langs")
      opts.langs = String(args[++i])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      usage();
      process.exit(1);
    }
  }

  const hasRange = opts.start !== undefined || opts.end !== undefined;
  if (hasRange) {
    if (!Number.isInteger(opts.start) || !Number.isInteger(opts.end) || opts.start < 1 || opts.end < 1) {
      console.error("--start and --end must be positive integers (1-based).");
      process.exit(1);
    }
    if (opts.end < opts.start) {
      console.error("--end must be >= --start.");
      process.exit(1);
    }
  }

  if (opts.langs.length === 0) {
    console.error("--langs cannot be empty.");
    process.exit(1);
  }

  return opts;
};

const protectPlaceholders = (text) => {
  const tokens = [];
  let protectedText = text;

  const patterns = [
    /\{\{[^}]+\}\}/g, // {{count}}
    /\{[0-9]+\}/g, // {0}
    /\\n/g, // literal backslash-n sequence
    /\\t/g,
    /\\r/g,
  ];

  for (const pattern of patterns) {
    protectedText = protectedText.replace(pattern, (match) => {
      const token = `__PH_${tokens.length}__`;
      tokens.push(match);
      return token;
    });
  }

  return { protectedText, tokens };
};

const restorePlaceholders = (text, tokens) => {
  let restored = text;
  for (let i = 0; i < tokens.length; i++) {
    restored = restored.replaceAll(`__PH_${i}__`, tokens[i]);
  }
  return restored;
};

const translateViaGoogle = async ({ text, sourceLang, targetLang }) => {
  const { protectedText, tokens } = protectPlaceholders(text);
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${encodeURIComponent(sourceLang)}` +
    `&tl=${encodeURIComponent(targetLang)}` +
    `&dt=t&q=${encodeURIComponent(protectedText)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "whmm-locales-translator/1.0",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();

  const chunks = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = chunks
    .map((c) => c?.[0])
    .filter(Boolean)
    .join("");
  if (!translated) return text;
  return restorePlaceholders(translated, tokens);
};

const loadJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const saveJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");

const getKeysInLineRange = (filePath, startLine, endLine) => {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const startIdx = Math.max(0, startLine - 1);
  const endIdx = Math.min(lines.length - 1, endLine - 1);
  const keys = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const m = lines[i].match(/^\s*"([^"]+)"\s*:/);
    if (m?.[1]) keys.push(m[1]);
  }

  return [...new Set(keys)];
};

const run = async () => {
  const opts = parseArgs();
  const sourceLang = DEFAULT_SOURCE_LANG;

  const enPath = path.join(localesDir, "en", "translation.json");
  const en = loadJson(enPath);

  const keysToProcess =
    opts.start !== undefined && opts.end !== undefined
      ? getKeysInLineRange(enPath, opts.start, opts.end)
      : Object.keys(en).filter((k) => k.startsWith(opts.prefix ?? DEFAULT_PREFIX));

  if (keysToProcess.length === 0) {
    console.error("No keys matched the selection.");
    process.exitCode = 1;
    return;
  }

  const missingInEn = keysToProcess.filter((k) => !(k in en));
  if (missingInEn.length > 0) {
    console.warn(
      `Warning: ${missingInEn.length} selected keys are not present in ${enPath} (skipping them).`,
    );
  }

  const selectedKeys = keysToProcess.filter((k) => k in en);
  console.log(`Selected ${selectedKeys.length} keys from ${enPath}${opts.dryRun ? " (dry run)" : ""}`);

  for (const lang of opts.langs) {
    const outPath = path.join(localesDir, lang, "translation.json");
    const target = loadJson(outPath);

    const keysNeedingUpdate = selectedKeys.filter((k) => !(k in target) || target[k] === en[k]);
    const uniqueTexts = [
      ...new Set(keysNeedingUpdate.map((k) => en[k]).filter((v) => typeof v === "string")),
    ];
    const cache = new Map();

    console.log(
      `\n[${lang}] keys needing update: ${keysNeedingUpdate.length} (unique strings to translate: ${uniqueTexts.length})`,
    );

    let translatedCount = 0;
    for (let i = 0; i < uniqueTexts.length; i++) {
      const text = uniqueTexts[i];
      // Skip empty strings
      if (!text) {
        cache.set(text, text);
        continue;
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const translated = await translateViaGoogle({ text, sourceLang, targetLang: lang });
          cache.set(text, translated);
          translatedCount++;
          if ((translatedCount + 1) % 25 === 0) {
            console.log(`[${lang}] translated ${translatedCount}/${uniqueTexts.length}…`);
          }
          break;
        } catch (err) {
          const backoffMs = 400 * Math.pow(2, attempt);
          if (attempt === 3) {
            console.warn(`[${lang}] failed to translate after retries:`, JSON.stringify(text), String(err));
            cache.set(text, text);
          } else {
            await sleep(backoffMs);
          }
        }
      }

      // Gentle throttle to avoid rate limiting
      await sleep(80);
    }

    for (const k of keysNeedingUpdate) {
      const sourceValue = en[k];
      if (typeof sourceValue === "string") {
        target[k] = cache.get(sourceValue) ?? target[k];
      } else if (!(k in target)) {
        // Non-string values: copy only if missing.
        target[k] = sourceValue;
      }
    }

    if (opts.dryRun) {
      console.log(
        `[${lang}] dry-run: would write ${outPath} (translated unique strings: ${translatedCount})`,
      );
    } else {
      saveJson(outPath, target);
      console.log(`[${lang}] wrote ${outPath} (translated unique strings: ${translatedCount})`);
    }
  }

  console.log("\nDone.");
};

await run();
