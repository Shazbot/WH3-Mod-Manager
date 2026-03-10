//  node scripts/translate-missing-locale-keys.mjs --langs de --dry-run

//  run for all languages:
//  node scripts/translate-missing-locale-keys.mjs
//  That targets all non-English locales by default: de, es, fr, ja, ko, pl, pt, ru, tr, zh.

//  If you want to preview without writing changes:
//  node scripts/translate-missing-locale-keys.mjs --dry-run

import fs from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE_LANG = "en";
const DEFAULT_TARGET_LANGS = ["de", "es", "fr", "ja", "ko", "pl", "pt", "ru", "tr", "zh"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const usage = () => {
  console.log(
    [
      "Usage:",
      "  node scripts/translate-missing-locale-keys.mjs [--langs de,es,...] [--dry-run]",
      "",
      "Compares locales/<lang>/translation.json against locales/en/translation.json.",
      "For each missing key in each target locale, translates the English value with Google Translate",
      "and writes it into that locale file. Non-string values are copied as-is when missing.",
      "",
      `Defaults: --langs ${DEFAULT_TARGET_LANGS.join(",")}`,
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    langs: DEFAULT_TARGET_LANGS,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--langs") {
      opts.langs = String(args[++i])
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${arg}`);
      usage();
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

  const patterns = [/\{\{[^}]+\}\}/g, /\{[0-9]+\}/g, /\\n/g, /\\t/g, /\\r/g];

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
      "User-Agent": "whmm-missing-locales-translator/1.0",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();

  const chunks = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = chunks
    .map((chunk) => chunk?.[0])
    .filter(Boolean)
    .join("");

  if (!translated) return text;
  return restorePlaceholders(translated, tokens);
};

const loadJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const saveJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");

const run = async () => {
  const opts = parseArgs();
  const repoRoot = process.cwd();
  const localesDir = path.join(repoRoot, "locales");
  const enPath = path.join(localesDir, DEFAULT_SOURCE_LANG, "translation.json");

  if (!fs.existsSync(enPath)) {
    console.error(`Source locale file not found: ${enPath}`);
    process.exit(1);
  }

  const en = loadJson(enPath);
  console.log(
    `Loaded ${DEFAULT_SOURCE_LANG} source with ${Object.keys(en).length} keys${opts.dryRun ? " (dry run)" : ""}.`,
  );

  for (const lang of opts.langs) {
    if (lang === DEFAULT_SOURCE_LANG) {
      console.log(`[${lang}] skipping source language.`);
      continue;
    }

    const outPath = path.join(localesDir, lang, "translation.json");
    if (!fs.existsSync(outPath)) {
      console.warn(`[${lang}] locale file not found, skipping: ${outPath}`);
      continue;
    }

    const target = loadJson(outPath);
    const missingKeys = Object.keys(en).filter((key) => !(key in target));
    const uniqueTexts = [
      ...new Set(missingKeys.map((key) => en[key]).filter((value) => typeof value === "string")),
    ];
    const cache = new Map();

    console.log(
      `\n[${lang}] missing keys: ${missingKeys.length} (unique strings to translate: ${uniqueTexts.length})`,
    );

    let translatedCount = 0;
    for (const text of uniqueTexts) {
      if (!text) {
        cache.set(text, text);
        continue;
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const translated = await translateViaGoogle({
            text,
            sourceLang: DEFAULT_SOURCE_LANG,
            targetLang: lang,
          });
          cache.set(text, translated);
          translatedCount++;
          if (translatedCount % 25 === 0) {
            console.log(`[${lang}] translated ${translatedCount}/${uniqueTexts.length}...`);
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

      await sleep(80);
    }

    for (const key of missingKeys) {
      const sourceValue = en[key];
      if (typeof sourceValue === "string") {
        target[key] = cache.get(sourceValue) ?? sourceValue;
      } else {
        target[key] = sourceValue;
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
