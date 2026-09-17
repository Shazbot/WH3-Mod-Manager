import { Duplex, PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  Wh3AssetHostClient,
  Wh3AssetHostClientError,
  Wh3AssetHostRemoteError,
  wh3AssetHostPipePath,
} from "../src/wh3AssetHostClient";
import {
  Wh3AssetHostFrameDecoder,
  Wh3AssetHostProtocolError,
  encodeWh3AssetHostFrame,
} from "../src/wh3AssetHostProtocol";

const createMockChild = () => {
  const stderr = new PassThrough();
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const child = {
    stderr,
    exitCode: null as number | null,
    kill: vi.fn(() => true),
    once(event: string, listener: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return child;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return child;
};

class MemoryDuplex extends Duplex {
  peer: MemoryDuplex | null = null;

  _read() {}

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.peer?.push(Buffer.from(chunk));
    callback();
  }

  _final(callback: (error?: Error | null) => void) {
    this.peer?.push(null);
    callback();
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.peer?.push(null);
    callback(error);
  }
}

const createDuplexPair = () => {
  const client = new MemoryDuplex();
  const server = new MemoryDuplex();
  client.peer = server;
  server.peer = client;
  return { client, server };
};

const installServerResponder = (server: Duplex, handle: (request: any) => any) => {
  const decoder = new Wh3AssetHostFrameDecoder();
  server.on("data", (chunk) => {
    for (const request of decoder.push(chunk)) {
      const response = handle(request as any);
      if (response !== undefined) server.write(encodeWh3AssetHostFrame(response));
    }
  });
};

describe("WH3AssetHostClient", () => {
  it("builds the expected Windows named-pipe path", () => {
    expect(wh3AssetHostPipePath("wh3mm-test")).toBe("\\\\.\\pipe\\wh3mm-test");
  });

  it("spawns serve mode, retries the pipe, and performs hello", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    const spawnProcess = vi.fn(() => child as never);
    const connectPipe = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValueOnce(client);
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: true,
      command: request.command,
      result: {
        hostVersion: "test-host",
        protocolVersion: 1,
        capabilities: ["hello", "initialize", "getAnimationCatalog", "exportModel", "shutdown"],
        maxFrameBytes: 1024 * 1024,
      },
      error: null,
    }));

    const assetHost = new Wh3AssetHostClient({
      executablePath: "C:\\test\\WH3AssetHost.exe",
      pipeName: "wh3mm-test",
      parentProcessId: 4321,
      connectTimeoutMs: 100,
      connectRetryDelayMs: 1,
      spawnProcess,
      connectPipe,
    });

    await assetHost.start();
    expect(spawnProcess).toHaveBeenCalledWith("C:\\test\\WH3AssetHost.exe", [
      "serve",
      "--pipe",
      "wh3mm-test",
      "--parent-pid",
      "4321",
    ]);
    expect(connectPipe).toHaveBeenCalledWith("\\\\.\\pipe\\wh3mm-test");
    expect(await assetHost.hello()).toMatchObject({ hostVersion: "test-host", protocolVersion: 1 });
    assetHost.dispose();
  });

  it("correlates concurrent responses by requestId even when they arrive out of order", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    const requests: any[] = [];
    const decoder = new Wh3AssetHostFrameDecoder();
    server.on("data", (chunk) => {
      for (const request of decoder.push(chunk)) {
        requests.push(request);
        if (requests.length === 2) {
          for (const queued of [...requests].reverse()) {
            server.write(
              encodeWh3AssetHostFrame({
                protocolVersion: 1,
                requestId: queued.requestId,
                success: true,
                command: queued.command,
                result: { value: queued.command },
                error: null,
              }),
            );
          }
        }
      }
    });

    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();

    const first = (assetHost as any).request("first");
    const second = (assetHost as any).request("second");
    await expect(first).resolves.toEqual({ value: "first" });
    await expect(second).resolves.toEqual({ value: "second" });
    assetHost.dispose();
  });

  it("sends initialize and exportModel with canonical fields/defaults", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    const seen: any[] = [];
    installServerResponder(server, (request) => {
      seen.push(request);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        success: true,
        command: request.command,
        result:
          request.command === "initialize"
            ? { outputRoot: request.outputRoot, packPaths: request.packPaths }
            : request.command === "getAnimationCatalog"
              ? {
                  success: true,
                  assetPath: request.assetPath,
                  skeletonName: "human",
                  hasSkeletonFile: true,
                  animations: [{ path: "animations\\battle\\human\\stand_idle.anim" }],
                  diagnostics: [],
                }
              : {
                  success: true,
                  primaryFile: "C:\\cache\\preview\\model.glb",
                  auxiliaryFiles: [],
                  warnings: [],
                  errors: [],
                },
        error: null,
      };
    });

    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();

    await assetHost.initialize({ packPaths: ["a.pack", "b.pack"], outputRoot: "C:\\cache" });
    await expect(assetHost.getAnimationCatalog("variantmeshes\\foo.variantmeshdefinition")).resolves.toMatchObject({
      skeletonName: "human",
      animations: [{ path: "animations\\battle\\human\\stand_idle.anim" }],
    });
    await assetHost.exportModel({ assetPath: "variantmeshes\\foo.variantmeshdefinition", outputPath: "p\\model.glb" });

    expect(seen[0]).toMatchObject({
      protocolVersion: 1,
      command: "initialize",
      packPaths: ["a.pack", "b.pack"],
      outputRoot: "C:\\cache",
    });
    expect(seen[1]).toMatchObject({
      protocolVersion: 1,
      command: "getAnimationCatalog",
      assetPath: "variantmeshes\\foo.variantmeshdefinition",
    });
    expect(seen[2]).toMatchObject({
      protocolVersion: 1,
      command: "exportModel",
      assetPath: "variantmeshes\\foo.variantmeshdefinition",
      outputPath: "p\\model.glb",
      animationPaths: [],
      exportMaterials: true,
      includeSkeleton: true,
      mirrorMesh: true,
    });
    assetHost.dispose();
  });

  it("preserves host error code, details, and result", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: false,
      command: request.command,
      result: { errors: [{ code: "AssetNotFound" }] },
      error: { code: "AssetNotFound", message: "missing", details: "detail" },
    }));

    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();

    await expect(assetHost.exportModel({ assetPath: "missing", outputPath: "x.glb" })).rejects.toMatchObject({
      name: "Wh3AssetHostRemoteError",
      code: "AssetNotFound",
      details: "detail",
      result: { errors: [{ code: "AssetNotFound" }] },
    } satisfies Partial<Wh3AssetHostRemoteError>);
    assetHost.dispose();
  });

  it("rejects hello when the host reports an incompatible protocol", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: true,
      command: request.command,
      result: {
        hostVersion: "wrong",
        protocolVersion: 2,
        capabilities: ["hello", "initialize", "getAnimationCatalog", "exportModel", "shutdown"],
        maxFrameBytes: 1024 * 1024,
      },
      error: null,
    }));

    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();

    await expect(assetHost.hello()).rejects.toMatchObject({ code: "ProtocolVersionMismatch" });
    assetHost.dispose();
  });

  it("rejects pending requests when the pipe closes", async () => {
    const child = createMockChild();
    const { client } = createDuplexPair();
    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      requestTimeoutMs: 1000,
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();

    const request = assetHost.hello();
    client.emit("close");
    await expect(request).rejects.toMatchObject({ code: "Disconnected" });
    assetHost.dispose();
  });

  it("surfaces unexpected process exit with captured stderr", async () => {
    const child = createMockChild();
    const connectPipe = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      connectTimeoutMs: 100,
      connectRetryDelayMs: 1,
      spawnProcess: () => child as never,
      connectPipe,
    });

    const startup = assetHost.start();
    child.stderr.write("fatal startup error");
    child.emit("exit", 3, null);
    await expect(startup).rejects.toMatchObject({ code: "ProcessExited" });
    expect(assetHost.capturedStderr).toContain("fatal startup error");
  });

  it("times out unanswered requests", async () => {
    vi.useFakeTimers();
    try {
      const child = createMockChild();
      const { client } = createDuplexPair();
      const assetHost = new Wh3AssetHostClient({
        executablePath: "host.exe",
        requestTimeoutMs: 25,
        spawnProcess: () => child as never,
        connectPipe: async () => client,
      });
      await assetHost.start();

      // Attach the rejection assertion before advancing fake time so Vitest never
      // observes the intentional timeout as an unhandled rejection.
      const expectation = expect(assetHost.hello()).rejects.toMatchObject({ code: "RequestTimeout" });
      await vi.advanceTimersByTimeAsync(25);
      await expectation;
      assetHost.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends shutdown and ignores the host's expected process exit afterwards", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: true,
      command: request.command,
      result: { shuttingDown: true },
      error: null,
    }));

    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();
    await assetHost.shutdown();
    child.emit("exit", 0, null);

    expect(assetHost.isConnected).toBe(false);
    expect(assetHost.capturedStderr).toBe("");
  });

  it("reports protocol framing failures as client failures", async () => {
    const child = createMockChild();
    const { client } = createDuplexPair();
    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
    });
    await assetHost.start();

    const request = assetHost.hello();
    client.emit("data", Buffer.alloc(4));
    await expect(request).rejects.toBeInstanceOf(Wh3AssetHostProtocolError);
    assetHost.dispose();
  });

  it("rejects use before start", async () => {
    const assetHost = new Wh3AssetHostClient({ executablePath: "host.exe" });
    await expect(assetHost.hello()).rejects.toMatchObject({
      code: "NotConnected",
    } satisfies Partial<Wh3AssetHostClientError>);
  });
});
