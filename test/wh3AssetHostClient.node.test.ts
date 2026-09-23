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
        capabilities: [
          "hello",
          "initialize",
          "getAnimationCatalog",
          "exportModel",
          "exportModelBatch",
          "exportPaintedVariant",
          "paintedVariantRgba",
          "paintedVariantSourceOverride",
          "missingSkeletonDecision",
          "shutdown",
        ],
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
    expect(child.kill).toHaveBeenCalled();
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
                  animationDefaults: {
                    ground: {
                      path: "animations\\battle\\human\\stand_idle.anim",
                      slot: "STAND_IDLE_1",
                    },
                  },
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
      animationDefaults: {
        ground: {
          path: "animations\\battle\\human\\stand_idle.anim",
          slot: "STAND_IDLE_1",
        },
      },
    });
    await assetHost.exportModel({
      assetPath: "variantmeshes\\foo.variantmeshdefinition",
      outputPath: "p\\model.glb",
      variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 1 }],
    });
    await assetHost.exportModel({
      assetPath: "variantmeshes\\foo.variantmeshdefinition",
      outputPath: "p\\model-with-context.glb",
      animationSelections: [
        {
          path: "animations\\battle\\human\\stand_idle.anim",
          packIndex: 2,
          fragmentPath: "animations\\fragments\\human.fragment",
          metadataPath: "animations\\metadata\\human.meta",
        },
      ],
    });

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
      variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 1 }],
      exportMaterials: true,
      includeSkeleton: true,
      mirrorMesh: true,
    });
    expect(seen[3]).toMatchObject({
      protocolVersion: 1,
      command: "exportModel",
      animationPaths: ["animations\\battle\\human\\stand_idle.anim"],
      animationSelections: [
        {
          path: "animations\\battle\\human\\stand_idle.anim",
          packIndex: 2,
          fragmentPath: "animations\\fragments\\human.fragment",
          metadataPath: "animations\\metadata\\human.meta",
        },
      ],
    });
    assetHost.dispose();
  });

  it("sends exportModelBatch with shared options and per-item selections", async () => {
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
        result: {
          exports: request.items.map((item: any) => ({
            success: true,
            primaryFile: item.outputPath,
            auxiliaryFiles: [],
            warnings: [],
            errors: [],
          })),
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

    await expect(
      assetHost.exportModels({
        assetPath: "variantmeshes\\foo.variantmeshdefinition",
        items: [
          { outputPath: "batch\\one.glb", variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 0 }] },
          { outputPath: "batch\\two.glb", variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 1 }] },
        ],
      }),
    ).resolves.toMatchObject({ exports: [{ success: true }, { success: true }] });

    expect(seen[0]).toMatchObject({
      command: "exportModelBatch",
      assetPath: "variantmeshes\\foo.variantmeshdefinition",
      animationPaths: [],
      exportMaterials: true,
      includeSkeleton: true,
      mirrorMesh: true,
      items: [
        { outputPath: "batch\\one.glb", variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 0 }] },
        { outputPath: "batch\\two.glb", variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 1 }] },
      ],
    });
    assetHost.dispose();
  });

  it("sends exportPaintedVariant with texture source paths and selected VMD choices", async () => {
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
        result: {
          success: true,
          variantMeshVirtualPath: "variantmeshes\\unit.variantmeshdefinition",
          files: ["variantmeshes\\whmm_unit_painter\\unit_painted\\textures\\body.dds"],
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

    await expect(
      assetHost.exportPaintedVariant({
        assetPath: "variantmeshes\\unit.variantmeshdefinition",
        outputDirectory: "painted\\generated",
        variantName: "unit_painted",
        textures: [
          {
            sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
            rgbaPath: "painted\\input\\body.rgba",
            width: 1024,
            height: 1024,
          },
        ],
        variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 2 }],
      }),
    ).resolves.toMatchObject({
      success: true,
      variantMeshVirtualPath: "variantmeshes\\unit.variantmeshdefinition",
    });

    expect(seen[0]).toMatchObject({
      protocolVersion: 1,
      command: "exportPaintedVariant",
      assetPath: "variantmeshes\\unit.variantmeshdefinition",
      outputDirectory: "painted\\generated",
      variantName: "unit_painted",
      textures: [
        {
          sourceVirtualPath: "variantmeshes\\unit\\body_base_colour.dds",
          rgbaPath: "painted\\input\\body.rgba",
          width: 1024,
          height: 1024,
        },
      ],
      variantSelections: [{ slotPath: "root/slot[0]", choiceIndex: 2 }],
    });
    assetHost.dispose();
  });

  it("handles a manager decision request while an export is in flight", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    const decoder = new Wh3AssetHostFrameDecoder();
    const onDecisionRequest = vi.fn(async () => "continueWithoutSkeleton" as const);
    let exportRequest: any;
    let decisionResponse: any;

    server.on("data", (chunk) => {
      for (const request of decoder.push(chunk)) {
        if (request.command === "exportModel") {
          exportRequest = request;
          server.write(
            encodeWh3AssetHostFrame({
              protocolVersion: 1,
              requestId: "decision-1",
              command: "decisionRequest",
              decisionType: "missingSkeleton",
              skeletonName: "missing_skeleton",
              message: "A skeleton is not present.",
            }),
          );
        } else if (request.command === "decisionResponse") {
          decisionResponse = request;
          server.write(
            encodeWh3AssetHostFrame({
              protocolVersion: 1,
              requestId: exportRequest.requestId,
              success: true,
              command: "exportModel",
              result: {
                success: true,
                primaryFile: "C:\\cache\\preview\\model.glb",
                auxiliaryFiles: [],
                warnings: [],
                errors: [],
              },
              error: null,
            }),
          );
        }
      }
    });

    const assetHost = new Wh3AssetHostClient({
      executablePath: "host.exe",
      spawnProcess: () => child as never,
      connectPipe: async () => client,
      onDecisionRequest,
    });
    await assetHost.start();

    await expect(
      assetHost.exportModel({ assetPath: "model.rigid_model_v2", outputPath: "model.glb" }),
    ).resolves.toMatchObject({
      success: true,
      primaryFile: "C:\\cache\\preview\\model.glb",
    });
    expect(onDecisionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "decision-1",
        decisionType: "missingSkeleton",
        skeletonName: "missing_skeleton",
      }),
    );
    expect(decisionResponse).toMatchObject({
      protocolVersion: 1,
      requestId: "decision-1",
      command: "decisionResponse",
      success: true,
      action: "continueWithoutSkeleton",
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

  it("rejects hello when the bundled host is missing a required capability", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: true,
      command: request.command,
      result: {
        hostVersion: "old-host",
        protocolVersion: 1,
        capabilities: ["hello", "initialize", "exportModel", "missingSkeletonDecision", "shutdown"],
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

    await expect(assetHost.hello()).rejects.toMatchObject({
      code: "MissingCapabilities",
      message: expect.stringContaining("getAnimationCatalog"),
    });
    assetHost.dispose();
  });

  it("rejects a pre-RGBA painted-variant host even when the older painter capability exists", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: true,
      command: request.command,
      result: {
        hostVersion: "pre-rgba-painter-host",
        protocolVersion: 1,
        capabilities: [
          "hello",
          "initialize",
          "getAnimationCatalog",
          "exportModel",
          "exportModelBatch",
          "exportPaintedVariant",
          "missingSkeletonDecision",
          "shutdown",
        ],
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

    await expect(assetHost.hello()).rejects.toMatchObject({
      code: "MissingCapabilities",
      message: expect.stringContaining("paintedVariantRgba"),
    });
    assetHost.dispose();
  });

  it("rejects a painter host that cannot override the source VMD path", async () => {
    const child = createMockChild();
    const { client, server } = createDuplexPair();
    installServerResponder(server, (request) => ({
      protocolVersion: 1,
      requestId: request.requestId,
      success: true,
      command: request.command,
      result: {
        hostVersion: "pre-source-override-host",
        protocolVersion: 1,
        capabilities: [
          "hello",
          "initialize",
          "getAnimationCatalog",
          "exportModel",
          "exportModelBatch",
          "exportPaintedVariant",
          "paintedVariantRgba",
          "missingSkeletonDecision",
          "shutdown",
        ],
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

    await expect(assetHost.hello()).rejects.toMatchObject({
      code: "MissingCapabilities",
      message: expect.stringContaining("paintedVariantSourceOverride"),
    });
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
        capabilities: [
          "hello",
          "initialize",
          "getAnimationCatalog",
          "exportModel",
          "missingSkeletonDecision",
          "shutdown",
        ],
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
