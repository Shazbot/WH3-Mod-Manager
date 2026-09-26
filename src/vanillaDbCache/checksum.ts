/**
 * Small, deterministic checksum for independently-read cache blocks.
 *
 * FNV-1a is not intended as a security primitive; it is enough to catch accidental truncation or
 * corruption without forcing the lazy reader to hash the entire cache before serving one table.
 */
export const checksumBytes = (bytes: Uint8Array): number => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};
