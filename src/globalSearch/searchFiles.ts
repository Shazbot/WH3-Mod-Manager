import { decodePackedTextBuffer, isTextPackedFilePath } from "../utility/packFileViewing";
import type { PackedFile } from "../packFileTypes";
import { scanBytesForMatches } from "./byteScan";
import type { SearchEngineContext } from "./engineTypes";
import { scanTextForMatches } from "./textScan";
import type { GlobalSearchRigidModelResult, GlobalSearchTextResult } from "./types";

export type PackedFileBufferVisitor = (
  packPath: string,
  wanted: (name: string) => boolean,
  visit: (packedFile: PackedFile, buffer: Buffer) => Promise<void | false> | void | false,
  options: {
    maxFileBytes?: number;
    onSkipped?: (packedFile: PackedFile, reason: "tooLarge" | "unreadable") => void;
  },
) => Promise<void>;

const isRigidModelPath = (name: string): boolean => name.replace(/\//g, "\\").toLowerCase().endsWith(".rigid_model_v2");

export const searchPackFiles = async (
  packPath: string,
  context: SearchEngineContext,
  forEachPackedFileBuffer: PackedFileBufferVisitor,
): Promise<"canceled" | "complete" | "stopped"> => {
  const wantsText = context.request.kinds.text;
  const wantsRigid = context.request.kinds.rigidModel;
  let stopped = false;
  await forEachPackedFileBuffer(
    packPath,
    (name) => {
      const lowerName = name.replace(/\//g, "\\").toLowerCase();
      return (wantsText && isTextPackedFilePath(lowerName)) || (wantsRigid && isRigidModelPath(lowerName));
    },
    async (packedFile, buffer) => {
      if (context.isCanceled()) return false;
      context.markFile(packPath, packedFile.name);
      const lowerName = packedFile.name.replace(/\//g, "\\").toLowerCase();
      const isRigid = isRigidModelPath(lowerName);
      if (isRigid) {
        const scan = scanBytesForMatches(buffer, context.matcher, { maxMatches: context.maxResultsPerFile });
        if (scan.truncated) context.markTruncated();
        for (const match of scan) {
          const result: GlobalSearchRigidModelResult = {
            kind: "rigidModel",
            packPath,
            packLabel: context.packLabel,
            filePath: packedFile.name,
            offset: match.offset,
            encoding: match.encoding,
            excerpt: match.excerpt,
            matchStartInExcerpt: match.matchStartInExcerpt,
            matchEndInExcerpt: match.matchEndInExcerpt,
          };
          const outcome = context.addResult(result);
          if (outcome === "stopTarget") {
            stopped = true;
            return false;
          }
          if (outcome === "stopFile") break;
        }
      } else {
        const scan = scanTextForMatches(decodePackedTextBuffer(buffer), context.matcher, {
          maxMatches: context.maxResultsPerFile,
        });
        if (scan.truncated) context.markTruncated();
        for (const match of scan) {
          const result: GlobalSearchTextResult = {
            kind: "text",
            packPath,
            packLabel: context.packLabel,
            filePath: packedFile.name,
            line: match.line,
            column: match.column,
            offset: match.offset,
            excerpt: match.excerpt,
            matchStartInExcerpt: match.matchStartInExcerpt,
            matchEndInExcerpt: match.matchEndInExcerpt,
          };
          const outcome = context.addResult(result);
          if (outcome === "stopTarget") {
            stopped = true;
            return false;
          }
          if (outcome === "stopFile") break;
        }
      }
      return context.isCanceled() ? false : undefined;
    },
    {
      maxFileBytes: context.request.maxFileBytes,
      onSkipped: (packedFile, reason) => context.addSkipped({ packPath, filePath: packedFile.name, reason }),
    },
  );
  if (context.isCanceled()) return "canceled";
  return stopped ? "stopped" : "complete";
};
