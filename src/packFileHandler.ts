import BinaryFile from "binary-file";
import { isLoadOrderRulesPackedFilePath } from "./utility/loadOrderRulesFile";
import { hasPackedFileNameHash, readPackedFileIndexEntry } from "./utility/packFileIndex";

const isStartposPackedFile = (packedFileName: string) => {
  const normalizedName = packedFileName.replaceAll("/", "\\").toLowerCase();
  return normalizedName === "startpos.esf" || normalizedName.endsWith("\\startpos.esf");
};

export interface PackedFileIndexScan {
  hasStartpos: boolean;
  hasLoadOrderRules: boolean;
  /**
   * The rules file's name exactly as the pack stores it.
   *
   * Reading one file back out of a pack finds it by binary search under a case-sensitive collator,
   * so looking it up by the canonical lowercase spelling would silently miss a pack that wrote the
   * path in any other casing.
   */
  loadOrderRulesFileName?: string;
}

/**
 * One pass over the packed file index, answering everything the header read needs to know about
 * which files a pack contains.
 *
 * This walk already happened for startpos, so noticing the load order rules file here costs an extra
 * string comparison per entry and saves opening the pack a second time just to ask.
 */
export const scanPackedFileIndex = (
  packedFileIndex: Buffer,
  packFileCount: number,
  hasCompressionFlag: boolean,
  hasFileNameHash = false,
): PackedFileIndexScan => {
  const scan: PackedFileIndexScan = { hasStartpos: false, hasLoadOrderRules: false };
  let position = 0;

  for (let index = 0; index < packFileCount; index++) {
    const entry = readPackedFileIndexEntry(packedFileIndex, position, hasCompressionFlag, hasFileNameHash);
    if (!entry) return scan;

    const { name } = entry;
    if (!scan.hasStartpos && isStartposPackedFile(name)) scan.hasStartpos = true;
    if (!scan.hasLoadOrderRules && isLoadOrderRulesPackedFilePath(name)) {
      scan.hasLoadOrderRules = true;
      scan.loadOrderRulesFileName = name;
    }
    if (scan.hasStartpos && scan.hasLoadOrderRules) return scan;

    position = entry.nextPosition;
  }

  return scan;
};

export const packedFileIndexHasStartpos = (
  packedFileIndex: Buffer,
  packFileCount: number,
  hasCompressionFlag: boolean,
  hasFileNameHash = false,
) => scanPackedFileIndex(packedFileIndex, packFileCount, hasCompressionFlag, hasFileNameHash).hasStartpos;

export const readPackHeader = async (path: string, hasCompressionFlag = true): Promise<PackHeaderData> => {
  let file: BinaryFile | undefined;
  let isMovie = false;
  let hasStartpos = false;
  let hasLoadOrderRules = false;
  let loadOrderRulesFileName: string | undefined;
  const dependencyPacks: string[] = [];

  try {
    file = new BinaryFile(path, "r", true);
    await file.open();

    // console.log(`${path} file opened`);

    await file.seek(4); // skip header
    const byteMask = await file.readInt32();
    // console.log(`byteMask is ${byteMask}`);

    isMovie = byteMask === 4;

    await file.seek(12); // skip to dependency pack index size
    const pack_file_index_size = await file.readInt32();
    const pack_file_count = await file.readInt32();
    const packed_file_index_size = await file.readInt32();

    await file.seek(28); // skip to after header_buffer

    if (pack_file_index_size > 0) {
      const packIndexBuffer = await file.read(pack_file_index_size);
      let start = 0;

      for (let i = 0; i < pack_file_index_size; i++) {
        if (packIndexBuffer[i] === 0) {
          const name = packIndexBuffer.toString("utf8", start, i);
          dependencyPacks.push(name);
          start = i + 1;
        }
      }
    }

    if (packed_file_index_size > 0 && pack_file_count > 0) {
      const packedFileIndex = await file.read(packed_file_index_size);
      const scan = scanPackedFileIndex(
        packedFileIndex,
        pack_file_count,
        hasCompressionFlag,
        hasPackedFileNameHash(byteMask),
      );
      hasStartpos = scan.hasStartpos;
      hasLoadOrderRules = scan.hasLoadOrderRules;
      loadOrderRulesFileName = scan.loadOrderRulesFileName;
    }
  } catch (e) {
    console.log(e);
  } finally {
    if (file) file.close();
  }

  return { path, isMovie, hasStartpos, hasLoadOrderRules, loadOrderRulesFileName, dependencyPacks };
};
