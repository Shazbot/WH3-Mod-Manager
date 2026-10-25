import { z } from "zod";
import { AutomationError, failedResponse, throwIfAborted, type AutomationDiagnostic, type AutomationResponse } from "./errors";
import {
  defaultAutomationContext,
  operationRegistry,
  type AutomationContext,
  type OperationName,
} from "./operations";

export { operationRegistry, operationSchemas } from "./operations";
export type { AutomationContext, OperationName } from "./operations";
export type AutomationRequest = { [K in OperationName]: z.input<(typeof operationRegistry)[K]["schema"]> }[OperationName];
export * from "./errors";
export { FilesystemPolicy, normalizeInternalPackPath } from "./filesystem";
export { createAutomationCacheService } from "./cacheService";
export type { AutomationCacheService, AutomationCacheRequestScope, AutomationCacheStats, ReadonlyTableData, RawLocalizationLookup, RawLocalizationLookupLease } from "./cacheService";
export { createAutomationContext, defaultAutomationContext } from "./operations";

const operationNameSchema = z.object({ operation: z.string().min(1) }).passthrough();
const bypassAutomationCaches = new Set<OperationName>([
  "pack_create",
  "pack_write_files",
  "pack_patch_table",
  "pack_subset",
  "pack_clone",
  "pack_diff",
  "pack_validate",
  "rigid_patch",
]);

/** Shared validated operation entry point used by the CLI now and MCP in the next stage. */
export const executeAutomationRequest = async (
  request: unknown,
  context: AutomationContext = defaultAutomationContext(),
): Promise<AutomationResponse> => {
  const operationResult = operationNameSchema.safeParse(request);
  if (!operationResult.success) {
    return failedResponse(new AutomationError("INVALID_ARGUMENT", "Request must include an operation name", operationResult.error.issues));
  }
  const operationName = operationResult.data.operation as OperationName;
  if (!Object.hasOwn(operationRegistry, operationName)) {
    return failedResponse(new AutomationError("INVALID_ARGUMENT", `Unknown operation: ${operationResult.data.operation}`));
  }
  const definition = operationRegistry[operationName];

  const parsed = definition.schema.safeParse(request);
  if (!parsed.success) {
    return failedResponse(new AutomationError("INVALID_ARGUMENT", "Request validation failed", parsed.error.issues));
  }
  let cacheRequest: AutomationContext["cacheRequest"];
  try {
    throwIfAborted(context.signal);
    const bypassCache = bypassAutomationCaches.has(operationName);
    if (context.cache && !bypassCache) {
      cacheRequest = context.cache.beginRequest({
        policy: context.policy,
        signal: context.signal,
        schemaProvider: context.schemaProvider,
        maxLogicalPayloadBytes: context.maxLogicalPayloadBytes,
        useIndexCache: !bypassCache,
        useTypedCache: !bypassCache,
      });
    }
    const requestContext: AutomationContext = bypassCache
      ? { ...context, cache: undefined, cacheRequest: undefined }
      : { ...context, ...(cacheRequest ? { cacheRequest } : {}) };
    const data = parsed.data as Record<string, unknown>;
    const outputs = [data.outputPath, data.extractTo, data.reportPath, data.manifestPath].filter((value): value is string => typeof value === "string");
    await context.policy.assertOutputsDistinct(outputs);
    const execute = definition.execute as (input: unknown, context: AutomationContext) => Promise<{ data: unknown; diagnostics: AutomationDiagnostic[] }>;
    const result = await execute(parsed.data, requestContext);
    if (context.cache) for (const outputPath of outputs) context.cache.invalidatePath(outputPath);
    return { ok: true, data: result.data, diagnostics: result.diagnostics };
  } catch (error) {
    return failedResponse(error);
  } finally {
    cacheRequest?.close();
  }
};
