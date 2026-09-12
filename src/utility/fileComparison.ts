import { Buffer } from "node:buffer";
import fs, { type FileHandle } from "node:fs/promises";

const COMPARISON_CHUNK_SIZE = 1024 * 1024;

const readChunk = async (handle: FileHandle, buffer: Buffer, position: number, length: number): Promise<number> => {
  let totalBytesRead = 0;

  while (totalBytesRead < length) {
    const { bytesRead } = await handle.read(buffer, totalBytesRead, length - totalBytesRead, position + totalBytesRead);
    if (bytesRead === 0) break;
    totalBytesRead += bytesRead;
  }

  return totalBytesRead;
};

export const compareFilesByteForByte = async (firstPath: string, secondPath: string): Promise<boolean> => {
  const [firstStat, secondStat] = await Promise.all([fs.stat(firstPath), fs.stat(secondPath)]);
  if (!firstStat.isFile() || !secondStat.isFile()) throw new Error("Both comparison paths must be files.");
  if (firstStat.size !== secondStat.size) return false;
  if (firstStat.size === 0) return true;

  const firstHandle = await fs.open(firstPath, "r");
  try {
    const secondHandle = await fs.open(secondPath, "r");
    try {
      const bufferLength = Math.min(COMPARISON_CHUNK_SIZE, firstStat.size);
      const firstBuffer = Buffer.allocUnsafe(bufferLength);
      const secondBuffer = Buffer.allocUnsafe(bufferLength);

      for (let position = 0; position < firstStat.size; position += bufferLength) {
        const length = Math.min(bufferLength, firstStat.size - position);
        const [firstBytesRead, secondBytesRead] = await Promise.all([
          readChunk(firstHandle, firstBuffer, position, length),
          readChunk(secondHandle, secondBuffer, position, length),
        ]);

        if (firstBytesRead !== length || secondBytesRead !== length) return false;
        if (!firstBuffer.subarray(0, length).equals(secondBuffer.subarray(0, length))) return false;
      }

      return true;
    } finally {
      await secondHandle.close();
    }
  } finally {
    await firstHandle.close();
  }
};
