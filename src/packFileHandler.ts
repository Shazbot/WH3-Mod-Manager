import BinaryFile from "binary-file";

export const readPackHeader = async (path: string): Promise<PackHeaderData> => {
  let file: BinaryFile;
  let isMovie = false;

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
  } catch (e) {
    console.log(e);
  } finally {
    if (file) file.close();
  }

  return { path, isMovie };
};
