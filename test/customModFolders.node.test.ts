import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getCustomMods } from "../src/modFunctions";

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("custom mod folder discovery", () => {
  it("loads root and immediate-child packs but not deeper packs", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "whmm-custom-mods-"));
    temporaryFolders.push(folder);
    const child = path.join(folder, "123");
    const grandchild = path.join(child, "nested");
    await mkdir(grandchild, { recursive: true });
    await writeFile(path.join(folder, "root.pack"), "root");
    await writeFile(path.join(child, "child.pack"), "child");
    await writeFile(path.join(grandchild, "deep.pack"), "deep");

    const mods = await getCustomMods({ id: "custom-test", path: folder }, () => undefined);

    expect(mods.map((mod) => mod.name).sort()).toEqual(["child.pack", "root.pack"]);
    expect(mods.every((mod) => mod.sourceId === "custom-test" && mod.sourceKind === "custom")).toBe(true);
  });

  it("uses a same-basename thumbnail when present", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "whmm-custom-mods-"));
    temporaryFolders.push(folder);
    await writeFile(path.join(folder, "visual.pack"), "pack");
    await writeFile(path.join(folder, "visual.png"), "image");

    const [mod] = await getCustomMods({ id: "custom-test", path: folder }, () => undefined);

    expect(mod.imgPath).toBe(path.join(folder, "visual.png"));
  });
});
