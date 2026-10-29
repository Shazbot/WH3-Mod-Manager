import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { decompress } from "@mongodb-js/zstd";
import { describe, expect, it } from "vitest";
import {
  findOnnxForwardPaths,
  findOnnxShortestForwardPaths,
  getOnnxColumnBindingOptions,
  inferOnnxInputBinding,
} from "../../src/nodeGraph/onnxFlow";
import type { DBVersion } from "../../src/packFileTypes";

describe("ONNX schema inspection responsiveness", () => {
  it("lists mapping choices across the WH3 schema without blocking on unrelated reference branches", async () => {
    const schema = JSON.parse((await decompress(fs.readFileSync("schema/schema_wh3.json.zst"))).toString())
      .definitions as Record<string, DBVersion[]>;
    for (const versions of Object.values(schema)) {
      versions.sort((a, b) => b.version - a.version);
      for (const version of versions)
        for (const field of version.fields) {
          if (field.is_reference?.length) field.is_reference[0] += "_tables";
        }
    }
    const start = performance.now();
    const columns = getOnnxColumnBindingOptions("main_units_tables", schema, "any");
    const references = inferOnnxInputBinding({ name: "is_ranged", type: "float32" }, "main_units_tables", schema);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(columns.length).toBeGreaterThan(1000);
    expect(references.options.length).toBeGreaterThan(0);
    const projectiles = findOnnxShortestForwardPaths("main_units_tables", "projectiles_tables", schema);
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0].map((step) => step.column)).toEqual([
      "land_unit",
      "primary_missile_weapon",
      "default_projectile",
    ]);
    expect(columns.some((column) => column.tableName === "main_units_tables" && column.column === "tier")).toBe(true);
    expect(findOnnxForwardPaths("main_units_tables", "land_units_tables", schema).length).toBeGreaterThan(0);
  });
});
