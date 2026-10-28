import { readFileSync } from "node:fs";

/** Small independent PFH5 reader that locates the file index by consuming the header's dependency count. */
export const readPfH5IndexByDependencyCount = (filePath: string) => {
  const bytes = readFileSync(filePath);
  if (bytes.length < 28 || bytes.toString("ascii", 0, 4) !== "PFH5") {
    throw new Error("Expected a complete PFH5 header");
  }

  const byteMask = bytes.readInt32LE(4);
  const dependencyCount = bytes.readInt32LE(8);
  const dependencyIndexSize = bytes.readInt32LE(12);
  const fileCount = bytes.readInt32LE(16);
  const fileIndexSize = bytes.readInt32LE(20);
  if (dependencyCount < 0 || dependencyIndexSize < 0 || fileCount < 0 || fileIndexSize < 0) {
    throw new Error("PFH5 header contains a negative count or size");
  }

  const dependencyIndexEnd = 28 + dependencyIndexSize;
  let position = 28;
  const dependencies: string[] = [];
  for (let index = 0; index < dependencyCount; index++) {
    const terminator = bytes.indexOf(0, position);
    if (terminator < position || terminator >= dependencyIndexEnd) {
      throw new Error(`PFH5 dependency ${index} is not null terminated within the dependency index`);
    }
    dependencies.push(bytes.toString("utf8", position, terminator));
    position = terminator + 1;
  }
  if (position !== dependencyIndexEnd) {
    throw new Error("PFH5 dependency count does not consume the dependency index");
  }

  const indexEnd = position + fileIndexSize;
  if (indexEnd > bytes.length) throw new Error("PFH5 file index extends beyond the file");
  const fileNames: string[] = [];
  for (let index = 0; index < fileCount; index++) {
    if (position + 4 > indexEnd) throw new Error(`PFH5 file index entry ${index} is truncated`);
    const payloadSize = bytes.readInt32LE(position);
    if (payloadSize < 0) throw new Error(`PFH5 file index entry ${index} has a negative payload size`);
    position += 4;
    if ((byteMask & 0x40) !== 0) position += 4;
    position += 1; // PFH5's compression flag.
    if (position > indexEnd) throw new Error(`PFH5 file index entry ${index} is truncated`);

    const terminator = bytes.indexOf(0, position);
    if (terminator < position || terminator >= indexEnd) {
      throw new Error(`PFH5 filename ${index} is not null terminated within the file index`);
    }
    fileNames.push(bytes.toString("utf8", position, terminator));
    position = terminator + 1;
  }
  if (position !== indexEnd) throw new Error("PFH5 file count does not consume the file index");

  return { dependencyCount, dependencies, fileNames };
};
