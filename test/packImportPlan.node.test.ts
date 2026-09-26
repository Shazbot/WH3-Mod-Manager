import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { planPackImport } from "../src/utility/packImportPlan";

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const readDir = async (directoryPath: string) => {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(directoryPath, { withFileTypes: true })).map((entry) => ({
    name: entry.name,
    kind: entry.isDirectory() ? ("folder" as const) : ("file" as const),
  }));
};

describe("pack import planning", () => {
  it("maps picked files and folder contents, including TSV metadata overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-import-plan-"));
    temporaryFolders.push(root);
    const looseRoot = await mkdtemp(path.join(tmpdir(), "whmm-import-loose-"));
    temporaryFolders.push(looseRoot);
    await mkdir(path.join(root, "db", "example_tables"), { recursive: true });
    await writeFile(
      path.join(root, "db", "example_tables", "data__.tsv"),
      "key\n#example_tables;3;db/example_tables/data__\n",
    );
    const looseFile = path.join(looseRoot, "loose.png");
    await writeFile(looseFile, "png");

    const plan = await planPackImport({
      sources: [
        { path: root, kind: "folder" },
        { path: looseFile, kind: "file" },
      ],
      targetFolder: "ui\\skins",
      existingPackFilePaths: { pack: [], unsaved: [] },
      readDir,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.items.map((item) => [item.diskPath, item.packFilePath, item.isRpfmTsv])).toEqual([
      [path.join(root, "db", "example_tables", "data__.tsv"), "db\\example_tables\\data__", true],
      [looseFile, "ui\\skins\\loose.png", false],
    ]);
  });

  it("reports case-insensitive conflicts, duplicate destinations, and traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-import-plan-"));
    temporaryFolders.push(root);
    const first = path.join(root, "first.png");
    const second = path.join(root, "second.png");
    await writeFile(first, "1");
    await writeFile(second, "2");

    const conflictPlan = await planPackImport({
      sources: [{ path: first, kind: "file" }],
      targetFolder: "UI",
      existingPackFilePaths: { pack: ["ui\\first.png"], unsaved: [] },
      readDir,
    });
    expect(conflictPlan.items[0]?.conflictsWith).toBe("pack");

    const duplicatePlan = await planPackImport({
      sources: [
        { path: first, kind: "file" },
        { path: second, kind: "file" },
      ],
      targetFolder: "../ui",
      existingPackFilePaths: { pack: [], unsaved: [] },
      readDir,
    });
    expect(duplicatePlan.items).toEqual([]);
    expect(duplicatePlan.errors).toHaveLength(2);
  });
});
