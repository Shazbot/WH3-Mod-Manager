import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const buildOptions = {
  entryPoints: {
    "cli/main": path.join(projectRoot, "src/cli/main.ts"),
    "mcp/server": path.join(projectRoot, "src/mcp/server.ts"),
  },
  outdir: outputDirectory,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  tsconfig: path.join(projectRoot, "tsconfig.tools.json"),
  packages: "external",
  sourcemap: true,
  external: ["@mongodb-js/zstd", "lz4-napi", "@modelcontextprotocol/*"],
};

const copySchemas = async () => {
  const schemaDirectory = path.join(outputDirectory, "schema");
  await fs.mkdir(schemaDirectory, { recursive: true });
  const schema = await fs.readFile(path.join(projectRoot, "schema/schema_wh3.json.zst"));
  await fs.writeFile(path.join(schemaDirectory, "schema_wh3.json.zst"), schema);
};

if (process.argv.includes("--watch")) {
  const buildContext = await context(buildOptions);
  await buildContext.watch();
  await copySchemas();
} else {
  await build(buildOptions);
  await copySchemas();
}
