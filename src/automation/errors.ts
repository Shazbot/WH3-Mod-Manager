export type AutomationErrorCode = "INVALID_ARGUMENT" | "IO_ACCESS" | "UNSUPPORTED" | "VALIDATION" | "CONFLICT" | "CANCELLED" | "INTERNAL";

export interface AutomationErrorData {
  code: AutomationErrorCode;
  message: string;
  details?: unknown;
}

export interface AutomationDiagnostic {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  path?: string;
}

export type AutomationResponse<T = unknown> =
  | { ok: true; data: T; diagnostics: AutomationDiagnostic[] }
  | { ok: false; error: AutomationErrorData };

export class AutomationError extends Error {
  readonly code: AutomationErrorCode;
  readonly details?: unknown;

  constructor(code: AutomationErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AutomationError";
    this.code = code;
    this.details = details;
  }
}

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new AutomationError("CANCELLED", "Operation was cancelled");
};

export const yieldToEventLoop = async (signal?: AbortSignal): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  throwIfAborted(signal);
};

export const getExitCodeForAutomationError = (code: AutomationErrorCode): number => {
  switch (code) {
    case "INVALID_ARGUMENT":
      return 2;
    case "IO_ACCESS":
      return 3;
    case "UNSUPPORTED":
      return 4;
    case "VALIDATION":
    case "CONFLICT":
      return 5;
    case "CANCELLED":
      return 130;
    case "INTERNAL":
      return 1;
  }
};

export const automationErrorFromUnknown = (error: unknown): AutomationError => {
  if (error instanceof AutomationError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  if (code?.startsWith("ERR_PARSE_ARGS_")) {
    return new AutomationError("INVALID_ARGUMENT", error instanceof Error ? error.message : code);
  }
  if (code === "ABORT_ERR" || (error instanceof Error && error.name === "AbortError")) {
    return new AutomationError("CANCELLED", "Operation was cancelled");
  }
  if (error instanceof Error && "issues" in error) {
    return new AutomationError("INVALID_ARGUMENT", error.message, (error as Error & { issues?: unknown }).issues);
  }
  if (code === "EEXIST") return new AutomationError("CONFLICT", (error as Error).message);
  if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOTDIR") {
    return new AutomationError("IO_ACCESS", (error as Error).message);
  }
  if (code === "UNSUPPORTED_CODEC" || code === "ENOTSUP" || code === "ERR_ZSTD_INVALID_DATA" || code === "ZSTD_DECODER_ERROR") {
    return new AutomationError("UNSUPPORTED", (error as Error).message);
  }
  return new AutomationError("INTERNAL", error instanceof Error ? error.message : String(error));
};

export const failedResponse = (error: unknown): AutomationResponse<never> => {
  const normalized = automationErrorFromUnknown(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
  };
};
