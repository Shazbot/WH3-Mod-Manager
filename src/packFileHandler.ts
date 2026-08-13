import BinaryFile from "binary-file";

const isStartposPackedFile = (packedFileName: string) => {
  const normalizedName = packedFileName.replaceAll("/", "\\").toLowerCase();
  return normalizedName === "startpos.esf" || normalizedName.endsWith("\\startpos.esf");
};

export const packedFileIndexHasStartpos = (
  packedFileIndex: Buffer,
  packFileCount: number,
  hasCompressionFlag: boolean,
) => {
  let position = 0;
  for (let index = 0; index < packFileCount; index++) {
    const metadataSize = 4 + (hasCompressionFlag ? 1 : 0);
    if (position + metadataSize > packedFileIndex.length) return false;
    position += metadataSize;

    const nameEnd = packedFileIndex.indexOf(0, position);
    if (nameEnd === -1) return false;
    if (isStartposPackedFile(packedFileIndex.toString("utf8", position, nameEnd))) return true;
    position = nameEnd + 1;
  }
  return false;
};

export const readPackHeader = async (path: string, hasCompressionFlag = true): Promise<PackHeaderData> => {
  let file: BinaryFile | undefined;
  let isMovie = false;
  let hasStartpos = false;
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
      hasStartpos = packedFileIndexHasStartpos(packedFileIndex, pack_file_count, hasCompressionFlag);
    }
  } catch (e) {
    console.log(e);
  } finally {
    if (file) file.close();
  }

  return { path, isMovie, hasStartpos, dependencyPacks };
};
