import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mongodb-js/zstd", () => ({
  compress: async (value: Uint8Array) => value,
  decompress: async (value: Uint8Array) => value,
}));

import { readPack, writePack } from "../src/packFileSerializer";

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const makeFiles = () => [
  { name: "keep.bin", buffer: Buffer.from("keep bytes"), file_size: 10 },
  { name: "remove.bin", buffer: Buffer.from("remove bytes"), file_size: 12 },
];

const makeHashedPFH5Pack = () => {
  const entries = [
    { name: "compressed.bin", fileSize: 3, isCompressed: true },
    { name: "plain.bin", fileSize: 4, isCompressed: false },
  ];
  const packedFileIndex = Buffer.concat(
    entries.map(({ name, fileSize, isCompressed }) => {
      const metadata = Buffer.alloc(9);
      metadata.writeInt32LE(fileSize, 0);
      metadata.writeUInt32LE(0x6a53eb17, 4);
      metadata.writeUInt8(isCompressed ? 1 : 0, 8);
      return Buffer.concat([metadata, Buffer.from(name, "utf8"), Buffer.from([0])]);
    }),
  );
  const header = Buffer.alloc(28);
  header.write("PFH5", 0, "ascii");
  header.writeInt32LE(0x41, 4);
  header.writeInt32LE(0, 8);
  header.writeInt32LE(0, 12);
  header.writeInt32LE(entries.length, 16);
  header.writeInt32LE(packedFileIndex.length, 20);
  return Buffer.concat([header, packedFileIndex, Buffer.alloc(7)]);
};

describe("staged packed-file removals during save", () => {
  it("removes an entry while preserving survivor bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-delete-save-"));
    temporaryFolders.push(root);
    const packPath = path.join(root, "source.pack");
    const files = makeFiles();
    await writePack(files, packPath);

    const original = await readPack(packPath, { skipParsingTables: true });
    await writePack([], packPath, original, true, [], ["remove.bin"]);

    const saved = await readPack(packPath, { skipParsingTables: true, filesToRead: ["keep.bin"] });
    expect(saved.packedFiles.map((file) => file.name)).toEqual(["keep.bin"]);
    expect(saved.packedFiles[0]?.buffer).toEqual(files[0].buffer);
  });

  it("writes a valid pack for a delete-only operation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-delete-only-"));
    temporaryFolders.push(root);
    const packPath = path.join(root, "delete-only.pack");
    await writePack(makeFiles(), packPath);

    const original = await readPack(packPath, { skipParsingTables: true });
    await writePack([], packPath, original, true, [], ["keep.bin", "remove.bin"]);

    const saved = await readPack(packPath, { skipParsingTables: true });
    expect(saved.packedFiles).toEqual([]);
  });

  it("reads hashed PFH5 entries through the full pack reader", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "whmm-hashed-pack-read-"));
    temporaryFolders.push(root);
    const packPath = path.join(root, "hashed.pack");
    await writeFile(packPath, makeHashedPFH5Pack());

    const pack = await readPack(packPath, { skipParsingTables: true, skipSorting: true });

    expect(pack.packedFiles.map(({ name, file_size, is_compressed }) => ({ name, file_size, is_compressed }))).toEqual([
      { name: "compressed.bin", file_size: 3, is_compressed: true },
      { name: "plain.bin", file_size: 4, is_compressed: false },
    ]);
  });
});
