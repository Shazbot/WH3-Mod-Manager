import fs from "node:fs";
import path from "node:path";

const SOURCE_LANG = "en";
const TARGET_LANGS = ["de", "es", "fr", "ja", "ko", "pl", "pt", "ru", "tr", "zh"];

const repoRoot = process.cwd();
const localesDir = path.join(repoRoot, "locales");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const translateViaGoogle = async ({ text, targetLang }) => {
  const { protectedText, tokens } = protectPlaceholders(text);
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${encodeURIComponent(SOURCE_LANG)}` +
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
  const translated = chunks.map((c) => c?.[0]).filter(Boolean).join("");
  if (!translated) return text;
  return restorePlaceholders(translated, tokens);
};

const loadJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const saveJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");

const run = async () => {
  const enPath = path.join(localesDir, "en", "translation.json");
  const en = loadJson(enPath);
  const nodeEditorKeys = Object.keys(en).filter((k) => k.startsWith("nodeEditor"));
  if (nodeEditorKeys.length === 0) {
    console.error("No nodeEditor keys found in locales/en/translation.json");
    process.exitCode = 1;
    return;
  }

  console.log(`Found ${nodeEditorKeys.length} nodeEditor keys in ${enPath}`);

  for (const lang of TARGET_LANGS) {
    const outPath = path.join(localesDir, lang, "translation.json");
    const target = loadJson(outPath);

    const keysToTranslate = nodeEditorKeys.filter((k) => target[k] === en[k]);
    const uniqueTexts = [...new Set(keysToTranslate.map((k) => en[k]))];
    const cache = new Map();

    console.log(`\n[${lang}] keys to translate: ${keysToTranslate.length} (unique strings: ${uniqueTexts.length})`);

    let translatedCount = 0;
    for (let i = 0; i < uniqueTexts.length; i++) {
      const text = uniqueTexts[i];
      // Skip empty strings (some description keys might be empty placeholders)
      if (!text) {
        cache.set(text, text);
        continue;
      }

      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const translated = await translateViaGoogle({ text, targetLang: lang });
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

    for (const k of keysToTranslate) {
      target[k] = cache.get(en[k]) ?? target[k];
    }

    saveJson(outPath, target);
    console.log(`[${lang}] wrote ${outPath} (translated unique: ${translatedCount})`);
  }

  console.log("\nDone.");
};

await run();
