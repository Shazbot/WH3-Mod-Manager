import * as fs from "node:fs";
import * as path from "node:path";
import { removeFactionsFromStartpos } from "../edit/removeFactionsFromStartpos";

async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  if (args.includes("--keep-region-owners")) { flags.set("--keep-region-owners", "1"); args.splice(args.indexOf("--keep-region-owners"), 1); }
  for (let i = 0; i < args.length; i += 2) { if (!["--file", "--out", "--keys", "--transfers", "--report"].includes(args[i]) || !args[i + 1]) throw new Error(`Invalid argument ${args[i]}.`); flags.set(args[i], args[i + 1]); }
  const file = flags.get("--file"), out = flags.get("--out"), keysPath = flags.get("--keys");
  if (!file || !out || !keysPath) throw new Error("Required: --file <startpos> --out <new-startpos> --keys <JSON-array> [--transfers <JSON-object>] [--report <JSON>].");
  if (path.resolve(file) === path.resolve(out)) throw new Error("Input and output paths must differ.");
  const keys: unknown = JSON.parse(fs.readFileSync(keysPath, "utf8"));
  if (!Array.isArray(keys) || !keys.length || !keys.every(k => typeof k === "string" && k.length)) throw new Error("Keys must be a nonempty JSON string array.");
  const transfers = flags.has("--transfers") ? JSON.parse(fs.readFileSync(flags.get("--transfers")!, "utf8")) : {};
  if (!transfers || Array.isArray(transfers) || typeof transfers !== "object" || !Object.values(transfers).every(x => typeof x === "string")) throw new Error("Transfers must map faction keys to recipient keys.");
  console.log(`Opening ${file}; ${keys.length} requested faction keys.`);
  const { buffer: packed, report } = await removeFactionsFromStartpos(fs.readFileSync(file), keys, { keepRegionOwners: flags.has("--keep-region-owners"), transfers, log: m => console.log(m) });
  fs.writeFileSync(out, packed);
  if (flags.has("--report")) fs.writeFileSync(flags.get("--report")!, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${out}; removed ${report.removedKeys.length}, absent ${report.absentKeys.length}. Campaign behavior requires a game test.`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
