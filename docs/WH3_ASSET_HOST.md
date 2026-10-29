# WH3AssetHost

`WH3AssetHost.exe` is a headless .NET helper that WHMM bundles. WHMM uses it for model previews, unit-painter exports, mod optimization, and the visual asset check. It is built from the AssetEditor fork, not from this repository.

This document describes the contract between WHMM and the host. It covers both sides, so you can change either one without reverse-engineering the other.

| Side                       | Where                                                                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WHMM client, pipe mode     | `src/wh3AssetHostProtocol.ts` (framing), `src/wh3AssetHostClient.ts` (client), `src/wh3AssetHostIpc.ts` (lifecycle and Electron IPC), `src/wh3AssetHostPacks.ts`, `src/wh3AssetHostVanillaCache.ts`                                |
| WHMM client, one-shot mode | `src/workshopModOptimizer/hostRunner.ts` (process runner, stdout parser), `optimizer.ts` (optimize), `visualCheck.ts` (check)                                                                                                      |
| Host                       | `K:\projects\assedFork`, folder `Tools/WH3AssetHost/`: `Program.cs`, `AssetHostPipeServer.cs`, `AssetHostProtocol.cs`, `NamedPipeFrameProtocol.cs`, `HostMissingSkeletonDecision.cs`, `PaintedVariantExporter.cs`, `Optimize/*.cs` |
| Bundled build              | `tools/WH3AssetHost/WH3AssetHost.exe` plus `host-build.txt` (commit, version, size, sha256)                                                                                                                                        |

The host source is on the fork's `feature/pack-optimizer-host` branch. To find the exact source of the bundled exe, read the commit in `host-build.txt`: `git -C <assedFork> show <commit>:Tools/WH3AssetHost/<file>`.

## Modes

| Command line                                                       | Used for                                                | Transport                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------- |
| `WH3AssetHost serve --pipe <name> [--parent-pid <pid>]`            | Model previews, animation catalogs, unit painter        | Named pipe, length-prefixed JSON frames       |
| `WH3AssetHost optimize --request <file.json> [--parent-pid <pid>]` | Workshop mod optimization and consumer probes           | Request file in; JSON lines on stdout         |
| `WH3AssetHost check --request <file.json> [--parent-pid <pid>]`    | Visual asset check of one pack                          | Request file in; JSON lines on stdout         |
| `WH3AssetHost optimize --check-dds`                                | Proves the native DirectXTex shim loads                 | One stdout `result` line with status `dds-ok` |
| `WH3AssetHost --version` (also `optimize --version`)               | Capability versions for cache keys                      | One plain text line                           |
| `WH3AssetHost export --pack ... --asset ... --output ...`          | Legacy single-export command line; WHMM does not use it | stdout JSON                                   |

Every mode writes a log under `%LOCALAPPDATA%\WH3AssetHost\Logs\WH3AssetHost-<date>.log`. The logs roll daily and at 10 MiB, and the last 7 are kept. Set `WH3ASSETHOST_LOG_LEVEL=Debug` to get per-request timing.

## Finding and updating the executable

`resolveWh3AssetHostExecutablePath()` in `src/wh3AssetHostIpc.ts` finds the exe:

- **Packaged builds** use only `<resources>/WH3AssetHost/WH3AssetHost.exe`. Electron Forge copies `tools/WH3AssetHost` there through `extraResource` in `package.json`.
- **Development** uses the first of these that exists:
  1. `WH3_ASSET_HOST_PATH`
  2. `tools/WH3AssetHost/WH3AssetHost.exe`
  3. a sibling `../assedFork/Tools/WH3AssetHost/bin/{Debug,Release}/net10.0-windows[/win-x64[/publish]]/WH3AssetHost.exe`

To update the bundled host, run `scripts/update-wh3-asset-host.ps1 [-AssetEditorPath <checkout>]`. It runs `dotnet publish` (Release, win-x64, single file), copies the exe, and rewrites `host-build.txt`. It warns if the AssetEditor checkout has uncommitted changes, because the recorded commit would then not match the exe. Commit the exe and `host-build.txt` together.

`yarn package`, `yarn make` and `yarn publish` run `scripts/verify-wh3-asset-host.cjs` first. That script checks only that the exe (and `WH3NativePatchHelper.exe`) exists and is not empty. It does not compare against `host-build.txt`.

## Pipe mode (`serve`)

### Transport

- WHMM spawns `serve --pipe wh3mm-asset-host-<pid>-<uuid> --parent-pid <WHMM pid>`. stdin and stdout are ignored. WHMM keeps the last 32 KiB of stderr and adds it to "process exited" errors.
- The host creates `\\.\pipe\<name>` as a byte-mode server that accepts **one client** (`maxNumberOfServerInstances: 1`). It points its own stdout at null so nothing can corrupt a caller's capture.
- WHMM retries the connection every 50 ms for up to 5 s (`connectTimeoutMs`, `connectRetryDelayMs`). If the host process errors or exits during that time, the start fails immediately.
- The host exits when the client disconnects, after `shutdown`, or when the `--parent-pid` process exits.

### Framing

Each message is one frame: a **u32 little-endian payload length** followed by that many bytes of **strict UTF-8 JSON**. Both sides enforce the same limits (`WH3_ASSET_HOST_MAX_FRAME_BYTES` / `AssetHostProtocol.MaxFramePayloadBytes`):

| Rule                                                                           | Error code                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| Payload must be at least 1 byte                                                | `EmptyFrame`                                     |
| Payload must be at most 8 MiB (raised from 1 MiB for large animation catalogs) | `FrameTooLarge`                                  |
| Pipe must not end in the middle of a frame                                     | `TruncatedFrame`                                 |
| Payload must be valid UTF-8                                                    | `InvalidUtf8` (WHMM) / `MalformedRequest` (host) |
| Payload must parse as JSON                                                     | `MalformedJson`                                  |

On the host, `EmptyFrame` and `FrameTooLarge` get one error response, then the connection closes; a truncated frame closes it without a response. Bad UTF-8 or bad JSON inside a valid frame only fails that request; the connection stays open. On WHMM, any framing error fails the connection and rejects every pending request.

### Envelope

Request:

```json
{ "protocolVersion": 1, "requestId": "7", "command": "exportModel", "...": "command fields at top level" }
```

Response:

```json
{ "protocolVersion": 1, "requestId": "7", "success": true, "command": "exportModel", "result": {}, "error": null }
```

- `requestId` is a non-empty string. WHMM uses an incrementing counter.
- A response whose `requestId` matches no pending request is ignored.
- On failure, `error` is `{ code, message, details? }`. For `exportModel` and `exportPaintedVariant`, `result` still carries the full result object, so warnings are not lost.
- The host checks `protocolVersion` before anything else. A mismatch returns `ProtocolVersionMismatch`.

### Concurrency

The host runs **one serial read → dispatch → write loop**, and dispatch is synchronous. So `initialize`, exports and `shutdown` never overlap; a second request waits until the first one's response is written.

WHMM adds its own ordering on top. Every pack-dependent call (`exportVisualsModel`, `exportVisualsModelBatch`, `exportVisualsModelAnimations`, `getVisualsModelAnimationCatalog`, `exportUnitPainterTextures`) goes through one promise queue (`exportVisualsModel()` in `wh3AssetHostIpc.ts`). This keeps `initialize(A)` + `export(A)` atomic: a mod-list change cannot slip `initialize(B)` in between. Keep new pack-dependent calls on that queue. The missing-skeleton exchange below relies on it too.

### Session lifecycle

1. **`start()`**: spawn the host and connect.
2. **`hello`**: WHMM requires `protocolVersion === 1` and a capability list that contains every entry in `REQUIRED_CAPABILITIES` (`wh3AssetHostClient.ts`). Otherwise it fails with `ProtocolVersionMismatch`, `MalformedHello`, or `MissingCapabilities`.
3. **Warm the vanilla index.** `ensureWh3AssetHostVanillaCache()` builds any missing or stale vanilla pack indexes into `vanillaPackFilesCache` and flushes once, so the host never reads a half-written cache. The host is already running during this step.
4. **`initialize`**: sent lazily before the first operation, then again whenever the pack list, the output root, or the cache path changes. `Wh3AssetHostPackInitializer` keys these on case-insensitive Windows paths.
5. **Operations**: `getAnimationCatalog`, `exportModel`, `exportModelBatch`, `exportAnimations`, `exportPaintedVariant`.
6. **`shutdown`** or dispose. The renderer calls IPC `startWh3AssetHost` and `stopWh3AssetHost` when the Visuals tab becomes active or inactive. App exit (`before-quit` and `exit`) disposes the host.

Each start/stop bumps a lifecycle generation. A request from an older generation never tears down a newer host. If a transport or process failure happens during an operation, WHMM disposes that host and sends `wh3AssetHostReset` to the renderer. The next operation starts a fresh host.

### Commands

`*` marks a required field. All file paths in requests are **relative to `outputRoot`**. The host resolves them, normalises `/` and `\`, and rejects anything rooted, anything containing NUL, and anything that leaves the root.

#### `hello`

No fields. Result: `{ hostVersion, protocolVersion, capabilities: string[], maxFrameBytes }`.

The host advertises: `hello`, `initialize`, `getAnimationCatalog`, `getVariantMeshComposition`, `exportModel`, `exportModel.ddsTextures`, `exportModelBatch`, `exportAnimations`, `exportPaintedVariant`, `paintedVariantRgba`, `paintedVariantSourceOverride`, `variantMeshSelections`, `missingSkeletonDecision`, `shutdown`.

Some entries are **feature flags, not commands**: `paintedVariantRgba`, `paintedVariantSourceOverride`, `variantMeshSelections`, `missingSkeletonDecision`. WHMM requires every entry except `getVariantMeshComposition`, `variantMeshSelections` and `exportModel.ddsTextures`. The client records the advertised list after `hello` (`hasCapability`), and WHMM sends `ddsTextures` only to hosts that advertise `exportModel.ddsTextures`, so an older bundled host keeps working.

#### `initialize`

| Field                       | Type     | Notes                                                                                                                                                                                                                                               |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packPaths`*                | string[] | Absolute paths, **lowest priority first**. When two packs contain the same file, the last pack wins. WHMM sends every vanilla pack in manifest order, then enabled mods in load order, with duplicates removed (the highest-priority copy is kept). |
| `outputRoot`*               | string   | Absolute path. WHMM uses `<userData>/model-previews`, which it deletes and recreates once per app run.                                                                                                                                              |
| `vanillaPackFilesCachePath` | string   | WHMM's `vanilla-pack-files-cache.bin` (format `WVFC`). The host reads vanilla indexes from it instead of reopening every pack.                                                                                                                      |

Result: `{ outputRoot, packPaths }`.

The host builds the new runtime **before** it disposes the old one. If a corrupt pack makes `initialize` fail, the previous runtime stays usable. Errors: `InvalidInitialization` (empty `packPaths`), `InvalidOutputRoot`, `InitializationFailed` (exception).

#### `getAnimationCatalog`

Fields: `assetPath`* (virtual path).

Result: `{ success, assetPath, skeletonName?, hasSkeletonFile, animations: [{ path, packIndex?, fragmentPath?, metadataPath? }], animationDefaults?: { ground?, rider?, flying?, riderFlying? } (each { path, slot }), diagnostics: string[] }`.

Errors: `NotInitialized`, `MissingAssetPath`, `AnimationCatalogFailed`.

#### `exportModel`

| Field                                              | Type                                                   | Notes                                                                                |
| -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `assetPath`*                                       | string                                                 | Virtual path of the `.rigid_model_v2`, `.wsmodel` or `.variantmeshdefinition`        |
| `outputPath`*                                      | string                                                 | Must end in `.glb` or `.gltf`. WHMM uses `<previewId>\model.glb`.                    |
| `animationPaths`                                   | string[]                                               | Ignored when `animationSelections` is non-empty                                      |
| `animationSelections`                              | `{ path, packIndex?, fragmentPath?, metadataPath? }[]` | Takes precedence; its `path`s become the animation list                              |
| `variantSelections`                                | `{ slotPath, choiceIndex }[]`                          | Explicit choices for VMD slots                                                       |
| `exportMaterials`, `includeSkeleton`, `mirrorMesh` | bool                                                   | Default `true`. The host also accepts the aliases `materials`, `skeleton`, `mirror`. |
| `ddsTextures`                                      | bool                                                   | Default `false`. Capability `exportModel.ddsTextures`; see below.                    |

Result (`ExportResult`): `{ success, primaryFile, auxiliaryFiles: string[], warnings: [{ code, message }], errors: [{ code, message, details? }] }`. `primaryFile` is an absolute path.

**DDS textures (`ddsTextures: true`).** Normal, material-map and default-channel textures that are BC1/2/3/4/5/7, 2D and a multiple of 4 in size are written unchanged from the pack as `<stem>[_sha10].dds` next to the GLB. Anything else falls back, per texture, to the RGBA8 KTX2. Masks are skipped. The GLB lists `MSFT_texture_dds` in `extensionsUsed`; each such glTF texture has `extensions.MSFT_texture_dds.source` pointing at the `.dds` image, while the core `source` is a shared 1x1 placeholder PNG. The `.dds` images carry `extras`: `wh3SourceVirtualPath`, `wh3GeneratedFileName`, `wh3Channel` and `wh3TextureEncoding` (`normal-dxt5nm`, `material-map-wh3` or `direct`). `exportModelBatch` takes the same field.

The renderer asks for it only when the WebGL context has `WEBGL_compressed_texture_s3tc` and `WEBGL_compressed_texture_s3tc_srgb` (`Wh3DdsLoader.canRequestDdsTextures`). Debug switch: set `localStorage["whmm:previewDdsTextures"] = "0"` to force the KTX2 path. In the renderer, `Wh3DdsLoader` (registered as a GLTFLoader plugin for `MSFT_texture_dds`) uploads the blocks with all mips; colour space follows `wh3Channel` (BaseColor/Emissive/SpecularColor are sRGB, everything else linear), never the DX10 sRGB tag. BC4/5/7 without RGTC/BPTC are decoded on the CPU to an RGBA8 DataTexture. `src/visuals/wh3TextureEncodingShader.ts` patches the material shader for `normal-dxt5nm` (X = R*A, Y = G, Z rebuilt) and `material-map-wh3` (metalness from R); it is re-evaluated from the textures currently assigned, so the unit painter's editable standard-form textures (decoded on the CPU from mip 0 and, for packed normals, converted like the host does) run unpatched and the patch returns when the originals are restored. The timing log line gains `ddsTextures`, `rawDds`, `rawDdsWall`, `rawDdsBytes`, `ddsUploadCpu` and `ddsCpuDecoded`.

WHMM registers `primaryFile` with the `whmm://model-preview/<previewId>` protocol handler. The renderer loads the GLB from there with three.js `GLTFLoader` plus `Wh3Ktx2Loader`. IPC `releaseVisualsModelPreview` deletes the preview folder.

Errors: `NotInitialized`, `MissingAssetPath`, `InvalidOutputPath`, `InvalidAnimationPaths`, `InvalidAnimationSelections`, `InvalidVariantMeshSelections`, `InvalidExportOptions`. If the export itself fails, the error code is the first `errors[].code`, or `ExportFailed`.

#### `exportModelBatch`

Same fields as `exportModel`, except `outputPath` and `variantSelections` move into `items`* (1–100 entries of `{ outputPath*, variantSelections? }`). The asset, animations and options are shared by all items. The Visuals comparison view uses this.

Result: `{ exports: ExportResult[] }`, in item order. The response is `success: true` even if individual items failed, so check each `exports[i].success`. WHMM treats the batch as failed if any item failed or if the result count does not match.

Additional errors: `InvalidBatchItems`, `BatchTooLarge`.

#### `exportAnimations`

Writes a GLB with only the model's skeleton nodes and the requested clips: no meshes, skins, materials, images or KTX2 work. It is the same exporter as `exportModel` (same shared-skeleton choice, node names, hierarchy, `mirrorMesh` flipping and SuperView metadata), so the clips bind by node name to a scene loaded from `exportModel`. WHMM uses it to cache the clips of a model and switch animations locally.

| Field                  | Type                                                   | Notes                                                                  |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `assetPath`*           | string                                                 | Same as `exportModel`                                                  |
| `outputPath`*          | string                                                 | Must end in `.glb` or `.gltf`. WHMM uses `<previewId>\animations.glb`. |
| `animationSelections`* | `{ path, packIndex?, fragmentPath?, metadataPath? }[]` | 1-200 clips                                                            |
| `variantSelections`    | `{ slotPath, choiceIndex }[]`                          | Only used to resolve the skeleton of a VMD                             |
| `mirrorMesh`           | bool                                                   | Default `true`; must match the model export                            |

Result: `ExportResult`. The glTF animation for `animationSelections[i]` is named `clip<i>`. One bad clip does not fail the request: it is left out of the GLB and reported in `warnings` as `{ code: "AnimationFailed" | "AnimationNotFound", message: "clip<i>|<path>|<reason>" }`. Measured on a vanilla humanoid (Karl Franz, 4041-clip catalog): 1 clip ~35-50 ms, 10 clips ~290 ms, 30 clips ~730 ms, 200 clips ~3.5 s (57 MB), versus ~1.9 s for a full `exportModel` of one clip.

Errors: those of `exportModel`, plus `InvalidAnimationSelections` when the list is empty or longer than 200. The export fails (`ExportFailed`) if no skeleton can be resolved.

#### Animation clip cache

`src/visuals/animationClipCache.ts` keeps the clips of the loaded model. `VisualsModelPreview` seeds it with the clip that arrives with the model, then prefetches the rest of the catalog after the scene is ready, 20 clips per `exportVisualsModelAnimations` call, capped at 200 cached clips (least recently used goes first). A selected clip that is not cached is fetched alone, ahead of the queue. A cached clip switches with no IPC. The cache is keyed by `animationCatalogKey` (asset, profile, mods, animation table), so a different model or mod set disposes it, drops queued work and ignores in-flight results.

#### `exportPaintedVariant`

| Field               | Type                                                   | Notes                                                                                                                               |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `assetPath`*        | string                                                 | The model or VMD being repainted                                                                                                    |
| `outputDirectory`*  | string                                                 | Relative directory for the generated files                                                                                          |
| `variantName`*      | string                                                 | Namespace for the new variant. WHMM builds it from the pack and asset names.                                                        |
| `textures`*         | `{ sourceVirtualPath*, rgbaPath*, width*, height* }[]` | 1–64 entries. `rgbaPath` is a relative `.rgba` file holding exactly `width*height*4` bytes (max 64 MiB). Each side must be 1–16384. |
| `variantSelections` | `{ slotPath, choiceIndex }[]`                          |                                                                                                                                     |

Result: `{ success, variantMeshVirtualPath?, files: string[], warnings: string[], errors: [{ code, message, details? }] }`.

WHMM side (`exportUnitPainterVariantNow`):

1. Write each painted texture's raw RGBA to `<outputRoot>/unit-painter-<uuid>/` and send its relative path.
2. Read the host's generated files.
3. Package them with `buildUnitPainterPackFiles` and `buildUnitPainterProjectPackFiles`.
4. Write the pack with `packFileSerializer.writePack`.
5. Delete the staging folder.

WHMM's own limits: 64 textures, 64 MiB per texture, 256 MiB in total. This command's client timeout is 10 minutes, not 2.

Errors: `NotInitialized`, `InvalidPaintedVariantRequest`, `InvalidOutputDirectory`, `InvalidVariantMeshSelections`, `InvalidPaintedTextures`, `InvalidPaintedTexture`, `TooManyPaintedTextures`. If the export itself fails, the code is the first `errors[].code`, or `PaintedVariantExportFailed`.

#### `getVariantMeshComposition` (host only, unused by WHMM)

Fields: `assetPath`*, `variantSelections`.

Result: `{ success, assetPath, sharedSkeletonName?, components: [{ bindingId, sourceModelPath, attachmentPoint, skeletonName?, meshCount, hasWeights }], diagnostics }`. `bindingId` is structural, e.g. `root/slot[0]/choice[1]`, and matches metadata on the exported glTF nodes.

Errors: `NotInitialized`, `MissingAssetPath`, `InvalidVariantMeshSelections`, `CompositionFailed`.

#### `shutdown`

Result: `{ shuttingDown: true }`. The host disposes its runtime, ends the loop and exits. WHMM then closes its end and rejects anything still pending with `Shutdown`.

### Host-initiated `decisionRequest` (missing skeleton)

During an export, the host can find that a model's skeleton is missing. When that happens it pauses the export **in the middle of the request** and sends:

```json
{
  "protocolVersion": 1,
  "requestId": "decision-<guid>",
  "command": "decisionRequest",
  "decisionType": "missingSkeleton",
  "skeletonName": "...",
  "message": "..."
}
```

WHMM's reply carries the same `requestId`:

```json
{
  "protocolVersion": 1,
  "requestId": "decision-<guid>",
  "command": "decisionResponse",
  "success": true,
  "action": "continueWithoutSkeleton"
}
```

`action` is `continueWithoutSkeleton` or `cancelExport`. In WHMM:

1. The client calls `onDecisionRequest`.
2. `wh3AssetHostIpc.ts` sends `wh3AssetHostDecisionRequest` to the main window, which shows `Wh3AssetHostDecisionModal`.
3. The renderer answers through IPC `respondWh3AssetHostDecision`.
4. If there is no window, no answer within 110 s, a malformed reply, or a host reset, WHMM sends `cancelExport`.

The 110 s limit is deliberately shorter than the 120 s request timeout, so the export can still answer in time.

On the host side, `HostMissingSkeletonDecision` reads frames until it finds the matching reply. Any **other** frame that arrives meanwhile is read and **discarded**. A disconnect, a framing error or a JSON error counts as `cancelExport`. The host also accepts `missingSkeletonDecisionResponse` as the command name, the keys `selectedAction`/`decision` or a nested `result.action`, and booleans for the action. WHMM sends only the form shown above.

Because of the discard rule, **never send a new request while an export can be waiting on a decision.** WHMM's queue guarantees this.

### WHMM client errors

These are `Wh3AssetHostClientError` codes, raised by the client rather than the host: `ConnectionFailed`, `ProcessError`, `ProcessExited` (includes the stderr tail), `NotConnected`, `WriteFailed`, `RequestTimeout` (120 s default), `PipeError`, `Disconnected`, `MalformedResponse`, `MalformedDecisionRequest`, `ProtocolVersionMismatch`, `MalformedHello`, `MissingCapabilities`, `Shutdown`, `Disposed`.

Host `success: false` responses arrive as `Wh3AssetHostRemoteError`. It carries `code`, `details`, `requestId`, `command` and `result`.

Generic host codes: `MalformedJson`, `MalformedRequest`, `ProtocolVersionMismatch`, `MissingRequestId`, `MissingCommand`, `UnknownCommand`, `RequestFailed`.

## One-shot modes (`optimize`, `check`)

These modes never start the pipe server. Each run handles one job:

- **stdin**: ignored.
- **stdout**: carries only UTF-8 JSON lines. The host sends library console output to stderr so stdout stays parseable.
- **stderr and the log file**: diagnostics.

`--parent-pid` cancels the run when WHMM exits. Ctrl+C and SIGTERM also cancel it.

### Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | Succeeded (includes `--version` and `--check-dds`) |
| 1    | Failed                                             |
| 2    | Invalid arguments or request                       |
| 3    | Cancelled                                          |

`runHost()` in `hostRunner.ts` maps a run to one outcome:

- **`canceled`**: exit code 3, a `status: "cancelled"` result or check line, or an abort from WHMM. An abort kills the process.
- **On exit 0**, the first match wins:
  1. `check` if there was a check line
  2. `probe` if there was a probe line
  3. `result` if there was a result line
  4. `version` if there was non-JSON text
  5. `ok`
- **`failed`** in every other case. The message comes from the `error` line, or else from the last 3 lines of stderr.

Background runs set below-normal process priority.

### stdout lines

| `type`     | When                                                                                          | Fields                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress` | During a run, at most every 100 ms per stage, plus on every stage change and stage completion | `stage, item?, current, total`                                                                                                                                                                                                                                            |
| `result`   | Final line of `optimize` (succeeded or cancelled)                                             | `status, outputPackPath, reportPath, vmdCount, atlasedMeshCount, generatedTextureCount, removedFileCount, skippedMeshCount, elapsedSeconds, warnings?, consumerPackCount, externallyUsedFileCount, frozenFileCount, hostVersion, consumerPacks?, outputVersion, summary?` |
| `probe`    | Only line of `optimize` with `probeOnly`                                                      | `hostVersion, consumers[], elapsedSeconds, outputVersion, scanVersion, sources?, packsScanned, scanCacheHits, scanSeconds`                                                                                                                                                |
| `check`    | Final line of `check` (succeeded or cancelled)                                                | `status, hostVersion, findings[], summary, reportPath, elapsedSeconds, vmdCount, wsModelCount, rigidCount, materialCount`                                                                                                                                                 |
| `error`    | Final line of a failed run                                                                    | `message, exceptionType`                                                                                                                                                                                                                                                  |

The nested objects:

- **`summary`**: `{ sourceBytes, outputBytes, textureBytesSaved, drawCallsEliminated, mergedModelsGenerated }`.
- **A consumer**: `{ path, relevant, reasons: { frozenFiles, usedFiles, dbMentions, undecodableTables, vanillaOverridesReached, resolutionProvider } }`. Any non-zero reason makes it relevant.
- **A finding**: `{ severity: "error"|"warning"|"info", code, category, message, path, relatedPaths (capped), relatedCount, details?, usedByGame: bool|null }`.

`parseHostLine()` ignores lines that do not start with `{`, and lines whose `type` it does not recognise. It also normalises missing fields in `check` lines.

### `optimize` request file

The file is camelCase JSON; comments and trailing commas are allowed. Fields:

| Field                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`*                 | Must be `1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `gameDirectory`*                 | The folder that holds `manifest.txt`, or the install folder that has a `data` subfolder                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `vanillaFileIndexPath`*          | WHMM's `vanilla-pack-files-cache.bin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sourcePackPath`*                | The pack to optimize. For a batch probe, use the first source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `outputPackPath`_, `reportPath`_ | Not needed with `probeOnly`. The output must end in `.pack` and must differ from the source and from the report.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `options`*                       | Not needed with `probeOnly`. Booleans: `mergeCompatibleMeshes`, `shareAtlasesAcrossVmds`, `optimizeGeometry`, `atlasAllVmds`, `scoreAllGameUnits`, `lodAwareAtlasPlanning`, `crossRigidOnly`, `crossRigidMerges`, `buildAtlases`, `downscaleTextures`, `sharedTextureRepack`, `compactTextures`, `dropUnreadAlpha`, `remakeEditorLods`, `pruneDeadFiles`, `switchOpaqueAlphaShaders`, `compressRigidModels`, `reportDiagnostics`. Strings: `armyScope` (`subculture`/`culture`), `siblingScope` (`model`/`pack`). An omitted field keeps the optimizer's default. |
| `consumerPackPaths`              | The other enabled mods, in load order, first loads first. The source and the output must not be listed, and neither may any pack named like an optimizer output of this source. All are read-only.                                                                                                                                                                                                                                                                                                                                                                |
| `sourceLoadOrderIndex`           | Required when there are consumers: how many consumers load before the source (0..count)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dependencyPackPaths`            | Consumers that have a declared dependency with the source, in either direction. A file the source references but does not contain is looked up here before the game packs.                                                                                                                                                                                                                                                                                                                                                                                        |
| `cacheDirectory`                 | The optimizer's vanilla consumer cache and `probe-scan` cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `dbSchemaPath`                   | RPFM schema, e.g. WHMM's bundled `schema_wh3.json.zst`. A game patch that changes table versions then needs only a WHMM schema update, not a new host.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `probeOnly`                      | Report only which consumers matter; nothing is optimized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `probeSources`                   | With `probeOnly`: probe several sources in one run. `consumerPackPaths` must then list the whole load order, sources included, with no duplicates.                                                                                                                                                                                                                                                                                                                                                                                                                |

The host writes `<output>.optimizing` and `<report>.optimizing` first, then moves them into place. On cancel it deletes the temp files. On failure it deletes the temp output but keeps the report next to the target.

The options WHMM sends come from `WORKSHOP_OPTIMIZER_HOST_OPTIONS` in `hostRunner.ts`:

- `buildAtlases: false`. The fork's `ASSET_HOST_EXTRACTION_PLAN.md` keeps atlas building an experimental option in the Asset Editor only, citing its net memory cost.
- `compressRigidModels` follows the user's rigid compression setting.
- `pruneDeadFiles` and `switchOpaqueAlphaShaders` (host output 33+) remove source files nothing reaches or names, and move alpha-tested character materials with an opaque base colour to the non-alpha shader. Older hosts ignore them.

Texture atlas consolidation and cross-rigid merging are implemented in `Editors.PackOptimizer.Core` in the fork. WHMM only passes these flags and reads the results.

### `check` request file

| Field                                                        | Notes                                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`*                                             | `1`                                                                                                                                           |
| `gameDirectory`_, `vanillaFileIndexPath`_, `sourcePackPath`* | As for `optimize`                                                                                                                             |
| `reportPath`                                                 | Optional text report, written via `<report>.checking`                                                                                         |
| `cacheDirectory`                                             | Shared with the optimizer                                                                                                                     |
| `dbSchemaPath`                                               | Enables `usedByGame`. A finding reachable only from unused variant meshes drops one severity level. Without a schema, `usedByGame` is `null`. |
| `dependencyPackPaths`                                        | Other enabled mods, in load order. A reference one of them provides is not reported as missing.                                               |

`check` writes nothing except the optional report.

### How WHMM drives `optimize`

`WorkshopOptimizer` in `src/workshopModOptimizer/optimizer.ts` does the following:

1. **Probe the host once per run** with `optimize --check-dds` and `--version`. If either fails, or the version line is missing `output=`/`scan=`, the run falls back to plain copies and shows a warning.
2. **Batch probe** (`probeOnly` + `probeSources`) for every mod with visual assets and no cached answer. This finds which consumers are relevant, so the cache key can ignore unrelated mods.
3. **One `optimize` per eligible mod, one host process at a time.** Results are cached under `whmm_optimized_mods`. A background job (`background.ts`) can be joined by a launch that needs the same key, or preempted by one that needs a different key.

Request files go in the optimizer cache's temp folder and are deleted after the run.

## Versioning

There are three version signals. Each has its own rule.

1. **`protocolVersion`** (currently `1`) covers the pipe envelope and framing. Bump it on both sides only for incompatible envelope or framing changes. WHMM rejects a mismatched `hello` and mismatched responses; the host rejects mismatched requests.
2. **Capabilities** (`hello`) are for adding pipe features. Add a capability string on the host. Add it to WHMM's `REQUIRED_CAPABILITIES` only once WHMM depends on it, because an older host then fails with `MissingCapabilities` rather than with an obscure export error. Prefer new optional fields with defaults over new commands.
3. **`--version`** prints `<hostVersion> output=<n> scan=<n> check=<n>`, e.g. `0.6.0+20a0bc5ba446 output=3 scan=2 check=2`. `parseHostVersionLine()` reads it.
   - `outputVersion` and `scanVersion` are part of the optimizer cache key, so bumping either one in `PackOptimizerVersions` invalidates cached optimized packs.
   - `check=` is optional for older hosts.
   - `WORKSHOP_OPTIMIZER_PROFILE_ID` (`wh3-visual-v1`) is WHMM's own key for its option set. Bump it when WHMM changes the options or what a result means.

Request files carry their own `schemaVersion` (1 for both `optimize` and `check`). The host rejects any other value with exit code 2.

## Changing the contract

1. Change the host in the fork (`Tools/WH3AssetHost/`). For pipe mode, keep `AssetHostProtocol.cs` and `src/wh3AssetHostClient.ts` types in sync. For one-shot mode, keep `Optimize/OptimizeRequest.cs`/`CheckRequest.cs` and `hostRunner.ts`/`visualCheck.ts` in sync.
2. Decide which version signal changes (see above).
3. Run `scripts/update-wh3-asset-host.ps1` and commit the exe together with `host-build.txt`.
4. Run the targeted WHMM tests:
   - pipe mode: `test/wh3AssetHostProtocol.node.test.ts`, `test/wh3AssetHostClient.node.test.ts`, `test/wh3AssetHostPacks.node.test.ts`, `test/wh3AssetHostDecisionModal.dom.test.tsx`
   - one-shot mode: `test/workshopModOptimizer.node.test.ts`, with fixture `test/fixtures/optimizerHostStdout.jsonl`

   Both clients take injectable `spawnProcess`/`connectPipe` (pipe) or `spawnProcess`/`runHost` (one-shot), so these tests do not need the real exe.

5. Update this document.
