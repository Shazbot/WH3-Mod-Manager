import * as fs from "node:fs";
import * as path from "node:path";
import { openEsfBuffer } from "../esf/compressed";
import { readCaabHeader, parseCaabStringTables, parseCbabStringTables } from "../esf/codecs/caabBinary";
import { buildCaabTree } from "../esf/codecs/caabTree";
import { writeCaabBuffer } from "../esf/codecs/caabWriter";
import { repackAndVerify } from "../esf/recompress";
import { removeFactions } from "../edit/removeFactions";
import { verify } from "./removeFaction";

async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) { if (!["--file", "--out", "--keys", "--transfers", "--report"].includes(args[i]) || !args[i + 1]) throw new Error(`Invalid argument ${args[i]}.`); flags.set(args[i], args[i + 1]); }
  const file = flags.get("--file"), out = flags.get("--out"), keysPath = flags.get("--keys");
  if (!file || !out || !keysPath) throw new Error("Required: --file <startpos> --out <new-startpos> --keys <JSON-array> [--transfers <JSON-object>] [--report <JSON>].");
  if (path.resolve(file) === path.resolve(out)) throw new Error("Input and output paths must differ.");
  const keys: unknown = JSON.parse(fs.readFileSync(keysPath, "utf8"));
  if (!Array.isArray(keys) || !keys.length || !keys.every(k => typeof k === "string" && k.length)) throw new Error("Keys must be a nonempty JSON string array.");
  const transfers = flags.has("--transfers") ? JSON.parse(fs.readFileSync(flags.get("--transfers")!, "utf8")) : {};
  if (!transfers || Array.isArray(transfers) || typeof transfers !== "object" || !Object.values(transfers).every(x => typeof x === "string")) throw new Error("Transfers must map faction keys to recipient keys.");
  console.log(`Opening ${file}; ${keys.length} requested faction keys.`);
  const outer = fs.readFileSync(file), opened = openEsfBuffer(outer), source = opened.buffer, header = readCaabHeader(source), tables = (header.codecId === 0xabcb ? parseCbabStringTables : parseCaabStringTables)(source, header.recordNamesOffset);
  console.log("Building editable tree.");
  const root = buildCaabTree(source, header, tables);
  console.log("Removing faction batch and remapping surviving IDs.");
  const report = removeFactions(source, header, tables, root, keys, transfers);
  console.log(`Writing and validating ${report.factionsBefore} -> ${report.factionsAfter} factions.`);
  const inner = writeCaabBuffer({ header, tables, root, source });
  verify(inner, keys, report.factionsAfter);
  console.log("Structural validation passed; recompressing and checking stream equality.");
  const packed = opened.wasCompressed ? (await repackAndVerify(outer, inner)).buffer : inner;
  fs.writeFileSync(out, packed);
  if (flags.has("--report")) fs.writeFileSync(flags.get("--report")!, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${out}; removed ${report.removedKeys.length}, absent ${report.absentKeys.length}. Campaign behavior requires a game test.`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
