import BinaryFile from "binary-file";

export const readPackHeader = async (path: string): Promise<PackHeaderData> => {
  let file: BinaryFile | undefined;
  let isMovie = false;
  const dependencyPacks: string[] = [];

  try {
    file = new BinaryFile(path, "r", true);
    await file.open();

    // console.log(`${path} file opened`);

    await file.seek(4); // skip header
    const byteMask = await file.readInt32();
    // console.log(`byteMask is ${byteMask}`);

    isMovie = byteMask === 4;

    await file.seek(12); // skip to pack_file_index_size
    const pack_file_index_size = await file.readInt32();

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
  } catch (e) {
    console.log(e);
  } finally {
    if (file) file.close();
  }

  return { path, isMovie, dependencyPacks };
};
