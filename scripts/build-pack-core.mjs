import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(projectRoot, "src/packCore/index.ts")],
  outfile: path.join(projectRoot, "tools/packCore/dist/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  sourcemap: true,
  external: ["@mongodb-js/zstd", "lz4-napi"],
});
