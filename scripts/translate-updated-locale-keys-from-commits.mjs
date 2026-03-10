import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LOCALE_FILE = "locales/en/translation.json";
const DEFAULT_SOURCE_LANG = "en";
const DEFAULT_TARGET_LANGS = ["de", "es", "fr", "ja", "ko", "pl", "pt", "ru", "tr", "zh"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const todayDateString = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const usage = () => {
  const today = todayDateString();
  console.log(
    [
      "Usage:",
      "  node scripts/translate-updated-locale-keys-from-commits.mjs [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--langs de,es,...] [--dry-run]",
      "",
      "Finds commits touching locales/en/translation.json in the given date range.",
      "Only keys whose English value changed while the key already existed are selected.",
      "Those keys are then translated from the current committed English locale into each target locale.",
      "",
      `Defaults: --since ${today} --until ${today} --langs ${DEFAULT_TARGET_LANGS.join(",")}`,
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const today = todayDateString();
  const opts = {
    since: today,
    until: today,
    langs: DEFAULT_TARGET_LANGS,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--since") {
      opts.since = String(args[++i]);
    } else if (arg === "--until") {
      opts.until = String(args[++i]);
    } else if (arg === "--langs") {
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

const git = (args) =>
  execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();

const loadJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const saveJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");

const getCommits = ({ since, until }) => {
  const output = git([
    "log",
    "--since",
    `${since} 00:00`,
    "--until",
    `${until} 23:59:59`,
    "--format=%H",
    "--",
    LOCALE_FILE,
  ]);

  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
};

const readJsonAtCommit = (revision) => JSON.parse(git(["show", `${revision}:${LOCALE_FILE}`]));

const getChangedExistingKeys = (commits) => {
  const changedKeys = new Set();

  for (const commit of commits) {
    let parent;
    try {
      parent = git(["rev-parse", `${commit}^`]);
    } catch {
      continue;
    }

    const previous = readJsonAtCommit(parent);
    const next = readJsonAtCommit(commit);

    for (const key of Object.keys(next)) {
      if (key in previous && previous[key] !== next[key]) {
        changedKeys.add(key);
      }
    }
  }

  return [...changedKeys];
};

const protectPlaceholders = (text) => {
  const tokens = [];
  let protectedText = text;

  const patterns = [
    /\{\{[^}]+\}\}/g,
    /\{[0-9]+\}/g,
    /\\n/g,
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
      "User-Agent": "whmm-updated-locales-translator/1.0",
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

const run = async () => {
  const opts = parseArgs();
  const commits = getCommits(opts);

  if (commits.length === 0) {
    console.log(`No commits found for ${LOCALE_FILE} between ${opts.since} and ${opts.until}.`);
    return;
  }

  const changedKeys = getChangedExistingKeys(commits);
  if (changedKeys.length === 0) {
    console.log(`No existing-key value changes found in ${LOCALE_FILE} between ${opts.since} and ${opts.until}.`);
    return;
  }

  const repoRoot = process.cwd();
  const localesDir = path.join(repoRoot, "locales");
  const source = readJsonAtCommit("HEAD");

  console.log(
    `Found ${changedKeys.length} changed existing keys in ${LOCALE_FILE} from ${commits.length} commit(s)${opts.dryRun ? " (dry run)" : ""}.`,
  );
  console.log(changedKeys.join("\n"));

  for (const lang of opts.langs) {
    if (lang === DEFAULT_SOURCE_LANG) continue;

    const localePath = path.join(localesDir, lang, "translation.json");
    if (!fs.existsSync(localePath)) {
      console.warn(`[${lang}] locale file not found, skipping: ${localePath}`);
      continue;
    }

    const target = loadJson(localePath);
    const uniqueTexts = [
      ...new Set(changedKeys.map((key) => source[key]).filter((value) => typeof value === "string")),
    ];
    const cache = new Map();

    console.log(
      `\n[${lang}] updating ${changedKeys.length} keys (unique strings to translate: ${uniqueTexts.length})`,
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

    if (uniqueTexts.length > 0 && translatedCount % 25 !== 0) {
      console.log(`[${lang}] translated ${translatedCount}/${uniqueTexts.length}...`);
    }

    for (const key of changedKeys) {
      const sourceValue = source[key];
      if (typeof sourceValue === "string") {
        target[key] = cache.get(sourceValue) ?? sourceValue;
      } else {
        target[key] = sourceValue;
      }
    }

    if (opts.dryRun) {
      console.log(`[${lang}] dry-run: would write ${localePath} (translated unique strings: ${translatedCount})`);
    } else {
      saveJson(localePath, target);
      console.log(`[${lang}] wrote ${localePath} (translated unique strings: ${translatedCount})`);
    }
  }

  console.log("\nDone.");
};

await run();
