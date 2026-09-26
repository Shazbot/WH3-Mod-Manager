import type { SearchMatcher } from "./matcher";
import type { GlobalSearchRequest, GlobalSearchResult, GlobalSearchSkippedFile } from "./types";

export type SearchAddOutcome = "continue" | "stopFile" | "stopTarget";

export interface SearchEngineContext {
  readonly request: GlobalSearchRequest;
  readonly matcher: SearchMatcher;
  readonly packLabel: string;
  readonly maxResultsPerFile: number;
  isCanceled(): boolean;
  addResult(result: GlobalSearchResult): SearchAddOutcome;
  markFile(packPath: string, filePath: string): void;
  markTruncated(): void;
  addWarning(warning: string): void;
  addSkipped(file: GlobalSearchSkippedFile): void;
  yieldToEventLoop?: () => Promise<void>;
}
