import { PackedFile } from "../packFileTypes";

/**
 * How much unwanted data is worth reading through to avoid a second read.
 *
 * A read costs a syscall and an allocation, so splitting a run to skip a few kilobytes loses. Past
 * this the skipped bytes cost more than the extra read.
 */
export const READ_RUN_MAX_GAP_BYTES = 256 * 1024;

export interface PackedFileReadRun {
  startPos: number;
  endPos: number;
  packedFiles: PackedFile[];
}

/**
 * Groups packed files into the contiguous spans that should be read off disk.
 *
 * Packed files are ordered by name, not by position, so a requested subset is scattered through the
 * pack. Reading one span across all of them pulls in everything that happens to lie between; reading
 * each file separately costs a syscall each. This splits only where the gap between two files is
 * large enough to be worth the extra read.
 */
export const groupPackedFilesIntoReadRuns = (
  packedFiles: PackedFile[],
  maxGapBytes = READ_RUN_MAX_GAP_BYTES,
): PackedFileReadRun[] => {
  if (packedFiles.length === 0) return [];

  const byPosition = packedFiles.toSorted((first, second) => first.start_pos - second.start_pos);
  const runs: PackedFileReadRun[] = [];

  for (const packedFile of byPosition) {
    const fileEnd = packedFile.start_pos + packedFile.file_size;
    const currentRun = runs[runs.length - 1];

    // Files can overlap into a run that already reaches past them, so the gap is measured against
    // the run's furthest point rather than the previous file's.
    if (currentRun && packedFile.start_pos - currentRun.endPos <= maxGapBytes) {
      currentRun.packedFiles.push(packedFile);
      if (fileEnd > currentRun.endPos) currentRun.endPos = fileEnd;
      continue;
    }

    runs.push({ startPos: packedFile.start_pos, endPos: fileEnd, packedFiles: [packedFile] });
  }

  return runs;
};
