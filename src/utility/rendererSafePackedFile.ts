import type { PackedFile } from "../packFileTypes";

/**
 * Electron carries Buffers across IPC as typed arrays, which Redux correctly flags as non-serializable.
 * Keep the byte content as ordinary arrays in renderer state; the pack serializer accepts this form
 * when a memory table is later edited and staged again.
 */
export const toRendererSafePackedFile = (packedFile: PackedFile): PackedFile => {
  const { buffer: _buffer, ...withoutFileBuffer } = packedFile;
  return {
    ...withoutFileBuffer,
    schemaFields: packedFile.schemaFields?.map((schemaField) => ({
      ...schemaField,
      fields: schemaField.fields.map((field) => ({
        ...field,
        val: field.val instanceof Uint8Array ? Array.from(field.val) : field.val,
      })),
    })),
  };
};
