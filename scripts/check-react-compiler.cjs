// Compiles every renderer component with React Compiler and fails if it skips any function the allowlist in
// scripts/react-compiler.cjs does not account for. Run with `yarn check:react-compiler`; see docs/REACT_COMPILER.md.
const path = require("path");
const { execFileSync } = require("child_process");
const babel = require("@babel/core");
const { allowedSkips, describeSkip, isSkipEvent, repoRoot } = require("./react-compiler.cjs");

const files = execFileSync("git", ["ls-files", "src/*.tsx", "src/**/*.tsx"], { cwd: repoRoot, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

let compiledFunctions = 0;
const skippedByFile = new Map();
for (const file of files) {
  const events = [];
  babel.transformFileSync(path.join(repoRoot, file), {
    babelrc: false,
    configFile: false,
    code: false,
    plugins: [
      ["@babel/plugin-syntax-typescript", { isTSX: true }],
      ["babel-plugin-react-compiler", { target: "18", logger: { logEvent: (_filename, event) => events.push(event) } }],
    ],
  });
  compiledFunctions += events.filter((event) => event.kind === "CompileSuccess").length;
  // One entry per skipped function; the compiler can log several errors for the same one.
  const skipped = new Map();
  for (const event of events) {
    if (!isSkipEvent(event)) continue;
    const line = event.fnLoc?.start?.line ?? "?";
    if (!skipped.has(line)) skipped.set(line, describeSkip(event));
  }
  if (skipped.size > 0) skippedByFile.set(file, skipped);
}

const problems = [];
for (const [file, skipped] of skippedByFile) {
  const allowed = allowedSkips[file]?.count ?? 0;
  if (skipped.size <= allowed) continue;
  problems.push(`${file}: ${skipped.size} skipped, ${allowed} allowed`);
  for (const [line, reason] of skipped) problems.push(`  line ${line}: ${reason}`);
}
const stale = Object.entries(allowedSkips)
  .filter(([file, { count }]) => (skippedByFile.get(file)?.size ?? 0) < count)
  .map(([file, { count }]) => `${file}: allows ${count}, skipped ${skippedByFile.get(file)?.size ?? 0}`);

console.log(`React Compiler: ${compiledFunctions} functions compiled across ${files.length} files.`);
if (stale.length > 0) {
  console.log("Allowlist entries that skip less than allowed (lower them in scripts/react-compiler.cjs):");
  for (const line of stale) console.log(`  ${line}`);
}
if (problems.length > 0) {
  console.error("React Compiler skipped components that the allowlist does not cover:");
  for (const line of problems) console.error(line);
  process.exit(1);
}
if (stale.length > 0) process.exit(1);
console.log("No unexpected skips.");
