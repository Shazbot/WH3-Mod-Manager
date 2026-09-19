import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { type Duplex } from "node:stream";
import {
  WH3_ASSET_HOST_PROTOCOL_VERSION,
  Wh3AssetHostFrameDecoder,
  encodeWh3AssetHostFrame,
} from "./wh3AssetHostProtocol";
import type { VariantMeshSelection } from "./visuals/variantMesh";

const REQUIRED_CAPABILITIES = [
  "hello",
  "initialize",
  "getAnimationCatalog",
  "exportModel",
  "missingSkeletonDecision",
  "shutdown",
] as const;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 50;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_STDERR_TAIL_CHARS = 32 * 1024;

export interface Wh3AssetHostErrorPayload {
  code: string;
  message: string;
  details?: string | null;
}

export interface Wh3AssetHostResponse<TResult = unknown> {
  protocolVersion: number;
  requestId: string;
  success: boolean;
  command?: string | null;
  result?: TResult | null;
  error?: Wh3AssetHostErrorPayload | null;
}

export interface Wh3AssetHostHelloResult {
  hostVersion: string;
  protocolVersion: number;
  capabilities: string[];
  maxFrameBytes: number;
}

export type Wh3AssetHostDecisionAction = "continueWithoutSkeleton" | "cancelExport";

export interface Wh3AssetHostDecisionRequest {
  protocolVersion: number;
  requestId: string;
  command: "decisionRequest";
  decisionType: "missingSkeleton";
  skeletonName: string;
  message?: string | null;
}

export interface Wh3AssetHostInitializeRequest {
  packPaths: string[];
  outputRoot: string;
  /** Manager-owned expanded vanilla pack index cache, if available. */
  vanillaPackFilesCachePath?: string;
}

export interface Wh3AssetHostInitializeResult {
  outputRoot: string;
  packPaths: string[];
}

export interface Wh3AssetHostExportWarning {
  code: string;
  message: string;
}

export interface Wh3AssetHostExportError {
  code: string;
  message: string;
  details?: string | null;
}

export interface Wh3AssetHostExportResult {
  success: boolean;
  primaryFile: string | null;
  auxiliaryFiles: string[];
  warnings: Wh3AssetHostExportWarning[];
  errors: Wh3AssetHostExportError[];
}

export interface Wh3AssetHostExportModelRequest {
  assetPath: string;
  outputPath: string;
  animationPaths?: string[];
  /** Explicit choices for VMD slots; interpreted by the host when supported. */
  variantSelections?: readonly VariantMeshSelection[];
  exportMaterials?: boolean;
  includeSkeleton?: boolean;
  mirrorMesh?: boolean;
}

export interface Wh3AssetHostAnimationCatalog {
  success: boolean;
  assetPath: string;
  skeletonName?: string | null;
  hasSkeletonFile: boolean;
  animations: Array<{ path: string }>;
  diagnostics: string[];
}

export class Wh3AssetHostRemoteError extends Error {
  readonly code: string;
  readonly details?: string | null;
  readonly requestId: string;
  readonly command?: string | null;
  readonly result?: unknown;

  constructor(response: Wh3AssetHostResponse) {
    const error = response.error;
    super(error?.message ?? "WH3AssetHost request failed.");
    this.name = "Wh3AssetHostRemoteError";
    this.code = error?.code ?? "RequestFailed";
    this.details = error?.details;
    this.requestId = response.requestId;
    this.command = response.command;
    this.result = response.result;
  }
}

export class Wh3AssetHostClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Wh3AssetHostClientError";
    this.code = code;
  }
}

type SpawnAssetHostProcess = (executablePath: string, args: readonly string[]) => ChildProcess;
type ConnectAssetHostPipe = (pipePath: string) => Promise<Duplex>;

export interface Wh3AssetHostClientOptions {
  executablePath: string;
  parentProcessId?: number;
  pipeName?: string;
  connectTimeoutMs?: number;
  connectRetryDelayMs?: number;
  requestTimeoutMs?: number;
  onDecisionRequest?: (
    request: Wh3AssetHostDecisionRequest,
  ) => Wh3AssetHostDecisionAction | Promise<Wh3AssetHostDecisionAction>;
  spawnProcess?: SpawnAssetHostProcess;
  connectPipe?: ConnectAssetHostPipe;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

const defaultSpawnProcess: SpawnAssetHostProcess = (executablePath, args) =>
  spawn(executablePath, [...args], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });

const defaultConnectPipe: ConnectAssetHostPipe = (pipePath) =>
  new Promise((resolve, reject) => {
    const socket = createConnection(pipePath);
    const onConnect = () => {
      socket.off("error", onError);
      resolve(socket);
    };
    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      socket.destroy();
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

export const wh3AssetHostPipePath = (pipeName: string): string => `\\\\.\\pipe\\${pipeName}`;

export class Wh3AssetHostClient {
  private readonly options: Required<
    Pick<
      Wh3AssetHostClientOptions,
      | "executablePath"
      | "parentProcessId"
      | "pipeName"
      | "connectTimeoutMs"
      | "connectRetryDelayMs"
      | "requestTimeoutMs"
    >
  >;
  private readonly spawnProcess: SpawnAssetHostProcess;
  private readonly connectPipe: ConnectAssetHostPipe;
  private readonly onDecisionRequest?: Wh3AssetHostClientOptions["onDecisionRequest"];
  private readonly decoder = new Wh3AssetHostFrameDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private childProcess: ChildProcess | null = null;
  private connection: Duplex | null = null;
  private nextRequestId = 1;
  private stderrTail = "";
  private processFailure: Error | null = null;
  private shuttingDown = false;

  constructor(options: Wh3AssetHostClientOptions) {
    if (!options.executablePath) throw new Error("WH3AssetHost executablePath is required.");
    const parentProcessId = options.parentProcessId ?? process.pid;
    if (!Number.isInteger(parentProcessId) || parentProcessId <= 0) {
      throw new Error("WH3AssetHost parentProcessId must be a positive integer.");
    }

    this.options = {
      executablePath: options.executablePath,
      parentProcessId,
      pipeName: options.pipeName ?? `wh3mm-asset-host-${process.pid}-${randomUUID()}`,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      connectRetryDelayMs: options.connectRetryDelayMs ?? DEFAULT_CONNECT_RETRY_DELAY_MS,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.connectPipe = options.connectPipe ?? defaultConnectPipe;
    this.onDecisionRequest = options.onDecisionRequest;
  }

  get pipeName(): string {
    return this.options.pipeName;
  }

  get pipePath(): string {
    return wh3AssetHostPipePath(this.options.pipeName);
  }

  get isConnected(): boolean {
    return this.connection !== null && !this.connection.destroyed;
  }

  get capturedStderr(): string {
    return this.stderrTail;
  }

  async start(): Promise<void> {
    if (this.isConnected) return;
    if (this.childProcess && this.childProcess.exitCode === null) this.childProcess.kill();

    this.decoder.reset();
    this.processFailure = null;
    this.stderrTail = "";
    this.shuttingDown = false;

    const args = ["serve", "--pipe", this.options.pipeName, "--parent-pid", String(this.options.parentProcessId)];
    const child = this.spawnProcess(this.options.executablePath, args);
    this.childProcess = child;
    this.bindChildProcess(child);

    const deadline = Date.now() + this.options.connectTimeoutMs;
    let lastConnectionError: Error | null = null;
    while (Date.now() <= deadline) {
      if (this.processFailure) throw this.processFailure;
      try {
        const connection = await this.connectPipe(this.pipePath);
        if (this.processFailure) {
          connection.destroy();
          throw this.processFailure;
        }
        this.connection = connection;
        this.bindConnection(connection);
        return;
      } catch (error) {
        lastConnectionError = toError(error);
        if (this.processFailure) throw this.processFailure;
        if (Date.now() >= deadline) break;
        await delay(this.options.connectRetryDelayMs);
      }
    }

    this.childProcess?.kill();
    this.childProcess = null;
    throw new Wh3AssetHostClientError(
      "ConnectionFailed",
      `Unable to connect to WH3AssetHost pipe '${this.pipePath}'.${
        lastConnectionError ? ` ${lastConnectionError.message}` : ""
      }`,
      lastConnectionError ? { cause: lastConnectionError } : undefined,
    );
  }

  async hello(): Promise<Wh3AssetHostHelloResult> {
    const result = await this.request<Wh3AssetHostHelloResult>("hello");
    if (!isRecord(result) || result.protocolVersion !== WH3_ASSET_HOST_PROTOCOL_VERSION) {
      throw new Wh3AssetHostClientError(
        "ProtocolVersionMismatch",
        `WH3AssetHost did not report protocol version ${WH3_ASSET_HOST_PROTOCOL_VERSION}.`,
      );
    }
    if (!Array.isArray(result.capabilities)) {
      throw new Wh3AssetHostClientError("MalformedHello", "WH3AssetHost hello response has no capability list.");
    }
    const missing = REQUIRED_CAPABILITIES.filter((capability) => !result.capabilities.includes(capability));
    if (missing.length > 0) {
      throw new Wh3AssetHostClientError(
        "MissingCapabilities",
        `WH3AssetHost is missing required capabilities: ${missing.join(", ")}.`,
      );
    }
    return result as unknown as Wh3AssetHostHelloResult;
  }

  initialize(request: Wh3AssetHostInitializeRequest): Promise<Wh3AssetHostInitializeResult> {
    return this.request<Wh3AssetHostInitializeResult>("initialize", {
      packPaths: request.packPaths,
      outputRoot: request.outputRoot,
      ...(request.vanillaPackFilesCachePath ? { vanillaPackFilesCachePath: request.vanillaPackFilesCachePath } : {}),
    });
  }

  exportModel(request: Wh3AssetHostExportModelRequest): Promise<Wh3AssetHostExportResult> {
    return this.request<Wh3AssetHostExportResult>("exportModel", {
      assetPath: request.assetPath,
      outputPath: request.outputPath,
      animationPaths: request.animationPaths ?? [],
      variantSelections: request.variantSelections ?? [],
      exportMaterials: request.exportMaterials ?? true,
      includeSkeleton: request.includeSkeleton ?? true,
      mirrorMesh: request.mirrorMesh ?? true,
    });
  }

  getAnimationCatalog(assetPath: string): Promise<Wh3AssetHostAnimationCatalog> {
    return this.request<Wh3AssetHostAnimationCatalog>("getAnimationCatalog", { assetPath });
  }

  async shutdown(): Promise<void> {
    if (!this.isConnected) {
      this.dispose();
      return;
    }

    this.shuttingDown = true;
    try {
      await this.request("shutdown");
    } finally {
      const connection = this.connection;
      this.connection = null;
      connection?.end();
      this.rejectPending(new Wh3AssetHostClientError("Shutdown", "WH3AssetHost client shut down."));
      this.childProcess = null;
      this.decoder.reset();
      this.shuttingDown = false;
    }
  }

  dispose(): void {
    this.shuttingDown = true;
    const connection = this.connection;
    this.connection = null;
    connection?.destroy();
    const disposalError = new Wh3AssetHostClientError("Disposed", "WH3AssetHost client was disposed.");
    this.processFailure = disposalError;
    this.rejectPending(disposalError);

    const child = this.childProcess;
    this.childProcess = null;
    if (child && child.exitCode === null) child.kill();
    this.decoder.reset();
    this.shuttingDown = false;
  }

  private request<TResult>(command: string, fields: Record<string, unknown> = {}): Promise<TResult> {
    const connection = this.connection;
    if (!connection || connection.destroyed) {
      return Promise.reject(new Wh3AssetHostClientError("NotConnected", "WH3AssetHost is not connected."));
    }

    const requestId = String(this.nextRequestId++);
    const frame = encodeWh3AssetHostFrame({
      protocolVersion: WH3_ASSET_HOST_PROTOCOL_VERSION,
      requestId,
      command,
      ...fields,
    });

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Wh3AssetHostClientError(
            "RequestTimeout",
            `WH3AssetHost '${command}' request '${requestId}' timed out after ${this.options.requestTimeoutMs} ms.`,
          ),
        );
      }, this.options.requestTimeoutMs);

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      connection.write(frame, (error?: Error | null) => {
        if (!error) return;
        const pending = this.takePending(requestId);
        pending?.reject(
          new Wh3AssetHostClientError("WriteFailed", `Failed to send WH3AssetHost '${command}' request.`, {
            cause: error,
          }),
        );
      });
    });
  }

  private bindChildProcess(child: ChildProcess): void {
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrTail += chunk.toString();
      if (this.stderrTail.length > MAX_STDERR_TAIL_CHARS) {
        this.stderrTail = this.stderrTail.slice(-MAX_STDERR_TAIL_CHARS);
      }
    });

    child.once("error", (error) => {
      if (this.childProcess !== child) return;
      this.processFailure = new Wh3AssetHostClientError("ProcessError", "WH3AssetHost failed to start or run.", {
        cause: error,
      });
      if (!this.shuttingDown) this.failConnection(this.processFailure);
    });

    child.once("exit", (code, signal) => {
      if (this.childProcess !== child) return;
      this.childProcess = null;
      if (this.shuttingDown) return;
      const stderr = this.stderrTail.trim();
      this.processFailure = new Wh3AssetHostClientError(
        "ProcessExited",
        `WH3AssetHost exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "none"}).${
          stderr ? `\n${stderr}` : ""
        }`,
      );
      this.failConnection(this.processFailure);
    });
  }

  private bindConnection(connection: Duplex): void {
    connection.on("data", (chunk: Buffer | string) => {
      if (this.connection !== connection) return;
      try {
        const messages = this.decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        for (const message of messages) this.handleResponse(message);
      } catch (error) {
        this.failConnection(error);
      }
    });

    connection.once("end", () => {
      if (this.connection !== connection) return;
      try {
        this.decoder.finish();
      } catch (error) {
        this.failConnection(error);
        return;
      }
      if (!this.shuttingDown) {
        this.failConnection(new Wh3AssetHostClientError("Disconnected", "WH3AssetHost pipe ended."));
      }
    });

    connection.once("error", (error) => {
      if (this.connection !== connection || this.shuttingDown) return;
      this.failConnection(
        new Wh3AssetHostClientError("PipeError", `WH3AssetHost pipe failed: ${error.message}`, { cause: error }),
      );
    });

    connection.once("close", () => {
      if (this.connection !== connection || this.shuttingDown) return;
      this.failConnection(new Wh3AssetHostClientError("Disconnected", "WH3AssetHost pipe closed."));
    });
  }

  private handleResponse(message: unknown): void {
    if (!isRecord(message)) {
      this.failConnection(new Wh3AssetHostClientError("MalformedResponse", "WH3AssetHost response was not an object."));
      return;
    }

    if (message.command === "decisionRequest") {
      this.handleDecisionRequest(message);
      return;
    }

    const { protocolVersion, requestId, success } = message;
    if (typeof protocolVersion !== "number" || typeof requestId !== "string" || typeof success !== "boolean") {
      this.failConnection(
        new Wh3AssetHostClientError("MalformedResponse", "WH3AssetHost response was missing envelope fields."),
      );
      return;
    }

    const pending = this.takePending(requestId);
    if (!pending) return;

    if (protocolVersion !== WH3_ASSET_HOST_PROTOCOL_VERSION) {
      pending.reject(
        new Wh3AssetHostClientError(
          "ProtocolVersionMismatch",
          `WH3AssetHost response used protocol version ${protocolVersion}; expected ${WH3_ASSET_HOST_PROTOCOL_VERSION}.`,
        ),
      );
      return;
    }

    const response = message as unknown as Wh3AssetHostResponse;
    if (!success) {
      pending.reject(new Wh3AssetHostRemoteError(response));
      return;
    }
    pending.resolve(response.result);
  }

  private handleDecisionRequest(message: Record<string, unknown>): void {
    const { protocolVersion, requestId, decisionType, skeletonName } = message;
    if (
      protocolVersion !== WH3_ASSET_HOST_PROTOCOL_VERSION ||
      typeof requestId !== "string" ||
      !requestId ||
      decisionType !== "missingSkeleton" ||
      typeof skeletonName !== "string"
    ) {
      this.failConnection(
        new Wh3AssetHostClientError("MalformedDecisionRequest", "WH3AssetHost decision request was malformed."),
      );
      return;
    }

    const request: Wh3AssetHostDecisionRequest = {
      protocolVersion,
      requestId,
      command: "decisionRequest",
      decisionType,
      skeletonName,
      ...(typeof message.message === "string" ? { message: message.message } : {}),
    };

    Promise.resolve()
      .then(() => this.onDecisionRequest?.(request) ?? "cancelExport")
      .catch(() => "cancelExport" as const)
      .then((action) => this.sendDecisionResponse(requestId, action));
  }

  private sendDecisionResponse(requestId: string, action: unknown): void {
    const connection = this.connection;
    if (!connection || connection.destroyed) return;

    const normalizedAction: Wh3AssetHostDecisionAction = action === "continueWithoutSkeleton" ? action : "cancelExport";
    const frame = encodeWh3AssetHostFrame({
      protocolVersion: WH3_ASSET_HOST_PROTOCOL_VERSION,
      requestId,
      command: "decisionResponse",
      success: true,
      action: normalizedAction,
    });

    connection.write(frame, (error?: Error | null) => {
      if (!error) return;
      this.failConnection(
        new Wh3AssetHostClientError("WriteFailed", "Failed to send WH3AssetHost decision response.", {
          cause: error,
        }),
      );
    });
  }

  private takePending(requestId: string): PendingRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    return pending;
  }

  private failConnection(reason: unknown): void {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const connection = this.connection;
    this.connection = null;
    if (connection && !connection.destroyed) connection.destroy();
    this.decoder.reset();
    this.rejectPending(error);
  }

  private rejectPending(reason: Error): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }
  }
}
