import BinaryFile from "binary-file";

export const readPackHeader = async (path: string): Promise<PackHeaderData> => {
  let file: BinaryFile | undefined;
  let isMovie = false;
  const dependencyPacks: string[] = [];

  try {
    file = new BinaryFile(path, "r", true);
    await file.open();

    // console.log(`${path} file opened`);

    const header = await file.read(4);
    if (header === null) throw new Error("header missing");
    // console.log(`header is ${header}`);

    const byteMask = await file.readInt32();
    // console.log(`byteMask is ${byteMask}`);

    isMovie = byteMask === 4;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const refFileCount = await file.readInt32();
    const pack_file_index_size = await file.readInt32();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const pack_file_count = await file.readInt32();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const packed_file_index_size = await file.readInt32();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const header_buffer = await file.read(4);

    if (pack_file_index_size > 0) {
      let chunk;
      let bufPos = 0;
      let lastDependencyStart = 0;
      const packIndexBuffer = await file.read(pack_file_index_size);

      while (null !== (chunk = packIndexBuffer.readInt8(bufPos))) {
        bufPos += 1;
        if (chunk == 0) {
          const name = packIndexBuffer.toString("utf8", lastDependencyStart, bufPos - 1);
          dependencyPacks.push(name);
          lastDependencyStart = bufPos;
          // console.log(`found dep pack ${name} in ${path}`);
          if (bufPos >= pack_file_index_size) {
            break;
          }
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
