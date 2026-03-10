// node scripts/diff-locale-keys.mjs --base en --compare de --out temp/de-missing-from-en.json
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_LANG = "en";
const DEFAULT_COMPARE_LANG = "de";
const DEFAULT_OUTPUT = "temp/de-missing-from-en.json";

const usage = () => {
  console.log(
    [
      "Usage:",
      "  node scripts/diff-locale-keys.mjs [--base en] [--compare de] [--out temp/de-missing-from-en.json]",
      "",
      "Writes a JSON object containing keys present in the base locale but missing in the compare locale.",
      "Each output value comes from the base locale.",
    ].join("\n"),
  );
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    base: DEFAULT_BASE_LANG,
    compare: DEFAULT_COMPARE_LANG,
    out: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base") opts.base = String(args[++i]);
    else if (arg === "--compare") opts.compare = String(args[++i]);
    else if (arg === "--out") opts.out = String(args[++i]);
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${arg}`);
      usage();
      process.exit(1);
    }
  }

  return opts;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const run = () => {
  const opts = parseArgs();
  const repoRoot = process.cwd();
  const basePath = path.join(repoRoot, "locales", opts.base, "translation.json");
  const comparePath = path.join(repoRoot, "locales", opts.compare, "translation.json");
  const outputPath = path.isAbsolute(opts.out) ? opts.out : path.join(repoRoot, opts.out);

  if (!fs.existsSync(basePath)) {
    console.error(`Base locale file not found: ${basePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(comparePath)) {
    console.error(`Compare locale file not found: ${comparePath}`);
    process.exit(1);
  }

  const baseLocale = readJson(basePath);
  const compareLocale = readJson(comparePath);
  const missingEntries = {};

  for (const key of Object.keys(baseLocale)) {
    if (!(key in compareLocale)) {
      missingEntries[key] = baseLocale[key];
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(missingEntries, null, 2) + "\n");

  const extraInCompare = Object.keys(compareLocale).filter((key) => !(key in baseLocale));
  console.log(`Base locale: ${opts.base} (${Object.keys(baseLocale).length} keys)`);
  console.log(`Compare locale: ${opts.compare} (${Object.keys(compareLocale).length} keys)`);
  console.log(`Missing in ${opts.compare}: ${Object.keys(missingEntries).length}`);
  console.log(`Extra in ${opts.compare}: ${extraInCompare.length}`);
  console.log(`Wrote ${outputPath}`);
};

run();
