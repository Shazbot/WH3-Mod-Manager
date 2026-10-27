# Headless pack tools

The headless tools read and write WH3 pack files without starting Electron. The shared core owns the existing pack index, payload and DB/LOC codecs, supported visual-reference extraction, and a Node-only RMV2 codec for versions 6–8 and registered layouts. Automation operations add explicit filesystem policy, schema context, and atomic publication; CLI and MCP are thin adapters over the same validated operation registry. The GUI serializer and index APIs remain compatibility wrappers around the extracted logic. The headless path does not import Electron, React, IPC, or GUI application data, and native codecs load only when needed. Unknown RMV2 versions or layouts remain explicitly unsupported rather than guessed.

Requires Node.js `>=24.14.0 <25`.

## Build and run the CLI

```sh
yarn install
yarn build:tools
node dist/cli/main.js --help
node dist/cli/main.js pack info /absolute/path/to/example.pack --format json
node dist/cli/main.js pack list /absolute/path/to/example.pack --path-prefix db/ --limit 100 --format json
node dist/cli/main.js pack list /absolute/path/to/example.pack --glob '**/*.dds' --format json
node dist/cli/main.js pack read /absolute/path/to/example.pack scripts/example.lua --output /absolute/path/to/example.lua
```

Globs match complete internal paths. `*.dds` matches only root-level files; use `**/*.dds` to find DDS files in nested folders too. Quote glob patterns so your shell passes them to the CLI unchanged. Use forward slashes in patterns even when the returned pack paths contain backslashes.

Use `--with-vanilla` on commands that resolve supporting assets: `pack validate`, `pack subset`, `pack textures`, `pack diff --affected-units`, `asset users`, `asset resolve`, `asset references`, `asset materials`, `loc lookup`, and `unit resolve`. For example, validate a mod whose textures are supplied by the base game without writing an input JSON file:

```sh
node dist/cli/main.js pack validate /mods/example.pack --with-vanilla --format json
node dist/cli/main.js pack validate /mods/example.pack --with-vanilla --game-data '/games/Total War WARHAMMER III/data' --format json
```

Game data discovery checks, in order, explicit `--game-data` (`gameDataPath` in JSON/MCP), `WHMM_GAME_DATA_PATH`, native WHMM settings (`wh3mm/config.json`), Windows WHMM settings under WSL, then Steam libraries. Under WSL, saved Windows paths are converted to WSL paths automatically. Steam discovery reads library metadata and `appmanifest_1142710.acf` to find the game install directory. Explicit overrides are authoritative; unavailable automatic candidates are skipped. If discovery cannot find readable data, pass `--game-data <directory>` or set `WHMM_GAME_DATA_PATH`.

Only packs listed in that directory's `manifest.txt` are included, in manifest order; unrelated mod packs in the data directory are excluded. Missing or empty manifests fail explicitly. Explicit `vanillaPackPaths` precede the manifest packs, supporting mods take priority over vanilla, and the target pack is highest. For affected diffs, the before and after target packs are loaded in separate environments. MCP and JSON requests use `"withVanilla": true` with the same discovery and filesystem permissions; configured read roots must allow the settings/config metadata, manifest, and base game packs. The flag adds resolution providers; subset copying still requires `--include-vanilla` in `selfContained` mode. Other command-specific fields still use `--input` as before.

The CLI defaults to readable text. Use `--format json` for the full `{ ok, data, diagnostics }` or `{ ok: false, error }` envelope; result data goes to stdout and diagnostics go to stderr. `pack diff --affected-units --format checklist` prints compact review rows. Progress is enabled on interactive stderr; use `--progress` in scripts or `--no-progress` to suppress it. Throttled messages identify loading, comparison, indexing, traversal, and enrichment phases and leave JSON stdout unchanged. Exit codes are `0` success, `1` unexpected error, `2` invalid arguments, `3` I/O or access failure, `4` unsupported operation/format, `5` validation or conflict, and `130` cancellation.

Use `--input <json-file>` for complex requests. The file contains operation fields; the command supplies the operation name and positional pack/table paths. Use it with `pack validate` to supply supporting `packPaths` and `vanillaPackPaths`, or use `--with-vanilla` to include base game packs automatically. For example, `pack table query` accepts:

```json
{
  "filters": [{ "field": "unit", "op": "eq", "value": "wh_main_emp_inf_swordsmen" }],
  "sort": [{ "field": "unit", "direction": "asc" }],
  "columns": ["unit", "category"],
  "offset": 0,
  "limit": 100
}
```

`pack table patch`, `pack write`, `pack create`, `pack subset`, and the `asset` commands also accept JSON operation fields. Inspect `node dist/cli/main.js --help` for all commands and flags. Outputs use copy-on-write publication, and existing destinations are rejected by default; pass `--overwrite` to replace an output atomically.

## Automation caches

The CLI and MCP server keep a 128 MiB retained-memory cache by default, with at most eight open cache readers. Set `--cache-memory-mib` to an integer from 1 through 1024. The reported memory limit bounds the cache's conservative retained-size estimate; it does not measure total Node.js heap use.

CLI disk caching is enabled by default under `%LOCALAPPDATA%\wh3mm` on Windows, `$XDG_CACHE_HOME/wh3mm` (or `~/.cache/wh3mm`) on Linux, and `~/Library/Caches/wh3mm` on macOS. Managed files live in that root's `headless/` namespace. `--cache-dir` overrides the root; unavailable default persistence falls back to memory with a notice. MCP keeps a bounded memory cache across requests and requires an explicit, policy-authorized `--cache-dir` for persistence. It does not select a disk directory outside its configured roots. `--whmm-cache-dir` points to the WHMM app's user data folder (`%APPDATA%\wh3mm` on Windows; see `docs/CACHES.md`) and remains read-only. It can reuse proven v4 exact-source DB/LOC caches and the GUI's v7 `visuals/vanilla.bin` / `visuals/mods.bin` unit/variant catalog. Catalog reuse checks source identity, schema hash, table version and row count; ambiguous subfile contributions fall back to source DB rows. Older, mismatched, unsupported, or corrupt caches are misses.

Visual reference metadata is stored in `headless/visuals/references/<pack-path-hash>.bin` under `--cache-dir`, with the shared format in `src/visuals/referenceCache.ts`. Each pack is independent: changing one mod preserves unchanged vanilla and other-mod metadata. The key includes canonical source identity (including ctime/device/inode), parser revision, and logical-payload limit. Stored data contains raw XML references and RMV2 material/texture slots, without geometry or payload buffers. Ownership, dependency graphs, unit matches, and load-order winners are rebuilt for each request, so reordering packs does not reuse a stale resolved answer. Source snapshots are checked before returning success. `--cache-stats` includes a `visuals` section with catalog hits, reference hits/misses, source parses, and persistent writes.

For repeated unit-impact queries, use both cache flags:

```sh
node dist/cli/main.js asset users /mods/example.pack textures/unit.dds --with-vanilla --format json \
  --cache-dir /tmp/whmm-headless-cache --whmm-cache-dir /path/to/wh3mm --cache-stats
```

```sh
node dist/cli/main.js pack table query /absolute/path/to/mod.pack db/main_units_tables/data --input query.json --format json \
  --cache-dir /absolute/path/to/whmm-cache --cache-memory-mib 256 --cache-stats
node dist/cli/main.js unit resolve --input unit.json --format json --whmm-cache-dir /absolute/path/to/wh3mm-user-data
node dist/cli/main.js unit resolve --input unit.json --format json --no-cache
```

`--no-cache` disables memory and disk caches, even if other cache flags are present. `--cache-stats` writes a JSON snapshot to stderr at CLI completion and after each MCP request. Cache status never changes operation JSON or diagnostics. Cache directories do not grant permission to read packs or write outputs: MCP still enforces its configured roots. MCP requires `--whmm-cache-dir` under a read root; `--cache-dir` must be under a read root, and persistence also requires it to be under a write root. A cache directory outside its required read roots is a startup configuration error. If the managed cache directory is readable but has no matching write root, the server can still use memory and readonly caches and reports the disabled persistence once on stderr.

For MCP, point the cache options at paths visible to the same Node runtime as the server. A Windows configuration can use:

```json
"args": [
  "C:\\Users\\Example\\src\\whmm\\dist\\mcp\\server.js",
  "--read-root", "D:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\data",
  "--read-root", "C:\\Users\\Example\\AppData\\Roaming\\wh3mm",
  "--read-root", "C:\\Users\\Example\\AppData\\Local\\WHMM\\headless-cache",
  "--write-root", "C:\\Users\\Example\\Documents\\WH3ModOutput",
  "--write-root", "C:\\Users\\Example\\AppData\\Local\\WHMM\\headless-cache",
  "--cache-dir", "C:\\Users\\Example\\AppData\\Local\\WHMM\\headless-cache",
  "--whmm-cache-dir", "C:\\Users\\Example\\AppData\\Roaming\\wh3mm",
  "--cache-stats"
]
```

Under WSL, use Linux paths and keep cache roots within the configured read/write roots:

```sh
node dist/mcp/server.js \
  --read-root "/mnt/c/Program Files (x86)/Steam/steamapps/common/Total War WARHAMMER III/data" \
  --read-root /mnt/c/Users/Example/AppData/Roaming/wh3mm \
  --read-root /mnt/k/wh3mods/output \
  --write-root /mnt/k/wh3mods/output \
  --cache-dir /mnt/k/wh3mods/output/headless-cache \
  --whmm-cache-dir /mnt/c/Users/Example/AppData/Roaming/wh3mm --cache-stats
```

Readonly queries, unit/localization lookups, and reference traversal can use typed cached rows. Byte-sensitive operations such as patch, write, create, clone, diff hashing, validate, and subset continue to use original pack payloads. `pack diff --affected-units` may reuse source-identity-checked DB/LOC rows and raw reference metadata for its unit analysis; both target states keep fresh indexes and separate environments. Graph results, merged winners, and rendered localization are not retained in the cache.

Fresh immutable pack indexes may be shared within a request after reauthorizing and checking the current file identity. This avoids duplicating vanilla indexes between diff states; affected diffs do not use retained indexes from earlier requests. Localization cache hydration opens only packs contributing LOC files.

For example, create a pack with a text file and a source file using `create.json`:

```json
{
  "packType": "mod",
  "dependencies": ["example_dependency.pack"],
  "files": [
    { "path": "text/intro.txt", "text": "A new pack file" },
    { "path": "scripts/setup.lua", "sourcePath": "/absolute/path/to/setup.lua" }
  ]
}
```

```sh
node dist/cli/main.js pack create /absolute/path/to/new.pack --input create.json --format json
```

Add or replace files with `write.json`; each change must specify exactly one of `text` and `sourcePath` (remove needs neither):

```json
{
  "files": [
    { "op": "add", "path": "text/notes.txt", "text": "Added" },
    { "op": "replace", "path": "scripts/setup.lua", "sourcePath": "/absolute/path/to/setup.lua" },
    { "op": "remove", "path": "obsolete/file.bin" }
  ]
}
```

```sh
node dist/cli/main.js pack write /absolute/path/to/source.pack --output /absolute/path/to/edited.pack --input write.json --format json
```

Patch a table by selecting exactly one row and setting typed fields. For example, `patch.json` can contain:

```json
{
  "patches": [{ "op": "update", "where": [{ "field": "key", "op": "eq", "value": "probe" }], "set": { "value": 85 } }]
}
```

```sh
node dist/cli/main.js pack table patch /absolute/path/to/source.pack db/_kv_rules_tables/data___rlqre5 --output /absolute/path/to/patched.pack --input patch.json --format json
```

## Run the MCP server

Build before launching. The MCP script runs the already-built server directly so its stdout remains reserved for the stdio protocol:

```sh
yarn build:tools
node dist/mcp/server.js --read-root /absolute/path/to/packs --write-root /absolute/path/to/output
```

At least one existing `--read-root` is required. Add multiple roots by repeating the flag. Reads must remain within those roots. Writes are denied unless one or more `--write-root` directories are supplied. The server cannot expand its roots after startup. `--max-response-bytes` accepts `1024` through `1048576` and defaults to 1 MiB. `--help` prints startup usage. MCP uses JSON-RPC over stdin/stdout; startup and transport diagnostics are written to stderr.

Example MCP launch configuration for Windows (replace the user and directory names):

```json
{
  "mcpServers": {
    "wh3mm-packs": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\Example\\src\\whmm\\dist\\mcp\\server.js",
        "--read-root",
        "D:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\data",
        "--read-root",
        "C:\\Users\\Example\\AppData\\Roaming\\The Creative Assembly\\Warhammer3\\scripts",
        "--write-root",
        "C:\\Users\\Example\\Documents\\WH3ModOutput"
      ],
      "cwd": "C:\\Users\\Example\\src\\whmm"
    }
  }
}
```

Example MCP launch configuration under WSL (use the Linux Node installation and Linux paths):

```json
{
  "mcpServers": {
    "wh3mm-packs": {
      "command": "/usr/bin/node",
      "args": [
        "/mnt/k/projects/whmm/dist/mcp/server.js",
        "--read-root",
        "/mnt/c/Program Files (x86)/Steam/steamapps/common/Total War WARHAMMER III/data",
        "--write-root",
        "/mnt/k/wh3mods/output"
      ],
      "cwd": "/mnt/k/projects/whmm"
    }
  }
}
```

Point `cwd` at the project containing the built `dist` output. Build native codec dependencies for the same Node platform used to run the server.

## Results and safety

Paged operations return a preview with `offset`, `limit`, `total`, `nextOffset`, and `hasMore`. Pages default to 100 records and allow at most 1000. Use `reportPath` (CLI `--report`) to write the complete JSON result when available; reports are explicit outputs and are never created automatically. MCP responses are capped by the configured byte limit. If a report was written, an oversized result returns a bounded summary and its path. Without a report, the tool returns an actionable error; a completed write includes completion information to avoid retrying it by mistake.

Writes validate staged output before atomic publication, default to no-overwrite, and reject output aliases of source files. Path policies resolve symlinks/junctions and enforce roots for pack files, source files, reports, and manifest-discovered packs. MCP calls run serially; cancellation is checked during scans and before publication, and temporary output is cleaned if a write is canceled.

## RMV2 inspection, comparison, validation, and patching

`rigid inspect` reads RMV2 versions 6, 7, and 8 using registered material and vertex layouts. It reports the skeleton, LOD distances, part counts and formats, bounding boxes, UV channel ranges, material and alpha metadata, texture slots, and supported parameters. Unknown versions are unsupported; unknown material or vertex layouts remain visible with incomplete coverage. `--texture-slots-only` skips UV, geometry, index, and parameter inspection while preserving material and texture-slot evidence.

```sh
node dist/cli/main.js rigid inspect /absolute/path/to/models.pack 'variantmeshes/models/unit.rigid_model_v2' --format json
node dist/cli/main.js rigid inspect /absolute/path/to/models.pack 'variantmeshes/models/unit.rigid_model_v2' --texture-slots-only --format json
```

`asset materials --input materials.json` reports declared material bindings per loading context and LOD/part. Supply ordered `packPaths` and optional `vanillaPackPaths`, plus exactly one of `assetPaths` (RMV2, WSModel, or VMD paths) or `unitKey` (an exact unit key). For example:

```json
{
  "packPaths": ["/absolute/path/to/mod.pack"],
  "vanillaPackPaths": ["/absolute/path/to/variants.pack", "/absolute/path/to/textures.pack"],
  "assetPaths": ["variantmeshes/models/unit.variantmeshdefinition"]
}
```

Direct loads use embedded RMV2 materials; WSModel loads use their explicit LOD/part XML material bindings. A same-named WSModel is never selected implicitly. `effectiveTextures` contains the selected material's declared slots; `embeddedTextures` remains separate evidence on WSModel loads. Shader sampling and implicit engine defaults are not inferred. Conditional branches and unit/engine provenance are retained, and unresolved or ambiguous bindings make coverage incomplete. Results support `--offset`, `--limit`, and `--report`.

`asset resolve` traverses supported embedded texture slots and labels incoming RMV2 edges with `loadMode: direct` or `wsmodel`. Engine references include the animation-to-LOD row chain. `asset references` groups direct loaders before WSModel bindings and reports target-specific loader counts. Supported rigid dependencies also participate in subset closure.

`pack diff` detects exact logical-content moves by comparing size and SHA-256 after path matches. It pairs duplicate candidates by sorted path; pairs from a duplicate group carry `ambiguous: true`. Moved entries use `status: "moved"` with `from` and `to`; `summary.movedCount` reports them, and they are excluded from `summary.added` and `summary.removed`. Set `detectMoves: false` in JSON/MCP or pass `--no-moves` to retain separate additions and removals.

Add `--affected-units` (or set `affectedUnits: true`) to trace changed visual files through before/after unit roots and correlate full DB/LOC row deltas with unit evidence. Supply ordered support mods with `packPaths`, plus `vanillaPackPaths` or `--with-vanilla` when needed; each state uses its own target pack as highest priority. Added, removed, changed, and moved files contribute both relevant paths. The result unions before/after unit states with path reasons, then groups the checklist by faction and evidence source: explicit custom-battle permission, visual fallback, unscoped, or unknown. Unsupported changed types and bounded incomplete analysis are reported in `affectedUnits.analysis`. Affected-unit paging uses `--semantic-offset` and `--semantic-limit` (or `semanticOffset` and `semanticLimit`); file-result paging uses the separate `--offset` and `--limit`. The full affected set is built before paging, and `--report` contains all affected units. An unchanged diff returns an empty complete affected-unit result without scanning unit roots.

Visual impact now starts from the changed paths. A request-local incoming-reference index joins effective XML/model references to lightweight unit roots, then enriches matched units. Before/after ownership stays separate. A cold index must still inspect relevant source files; warm runs reuse raw per-pack visual metadata. Queries for model/VMD/wsmodel changes skip RMV2 texture-slot scans, while texture changes require them. DB/LOC changes still evaluate full unit source evidence before pagination. Indexing has separate source/edge limits, so unrelated graph edges do not consume the changed-path traversal budget.

Use `--max-depth`, `--max-nodes`, `--max-edges`, and `--max-roots` with affected diffs; CLI values override `affectedMaxDepth`, `affectedMaxNodes`, `affectedMaxEdges`, and `affectedMaxRoots` in JSON. Diff defaults are 32 depth, 100,000 nodes, 500,000 traversal edges, and 100,000 roots. The maximum traversal edge budget is 5,000,000. `--max-scan-sources` and `--max-index-edges` control indexing (`affectedMaxScanSources` / `affectedMaxIndexEdges`, each defaulting to 1,000,000 with a 5,000,000 maximum). Limits and unreadable sources leave explicit incomplete coverage. Proven partial users remain in the result; `changedPathCoverage`, `unresolvedPaths`, and `limitReasons` identify follow-up work. A zero count with incomplete coverage does not establish that nothing is affected.

`--format checklist` prints one row per affected unit with its key, name, role, explicit custom-battle factions, and changed files. Rows are ranked by aggregate unique changed-path bytes, using the larger before/after logical size for each path. This measures review priority, not measured performance impact. JSON keeps `checklist.units` and full evidence. Unmapped assets remain visible for review; campaign hints are candidates, and `campaignOnly` is not asserted from a filename or missing battle permission alone.

```sh
node dist/cli/main.js pack diff /mods/before.pack /mods/after.pack --affected-units --with-vanilla \
  --format checklist --progress --max-edges 1000000 --report /tmp/unit-impact.json
```

Put ordered support packs and explicit vanilla packs in a JSON input when needed:

```json
{
  "packPaths": ["/mods/base.pack", "/mods/override.pack"],
  "vanillaPackPaths": ["/game/data/variants.pack", "/game/data/textures.pack"]
}
```

```sh
node dist/cli/main.js pack diff /mods/before.pack /mods/after.pack --affected-units --input diff-load-order.json --limit 25 --semantic-limit 25 --report /tmp/affected-units.json --format json
```

With `--details`, changed DDS paths include header field changes and per-surface, per-mip RGBA error statistics. `maxError` and `rmse` are in 8-bit channel byte units; sRGB values are compared as decoded samples without linearization. Same-format block compressed images also report byte-identical 4x4 blocks, including edge blocks. Pixel comparisons support BC1, BC2, BC3, and BC7 when dimensions and surface counts match. Different dimensions produce a header-only comparison. Unsupported layouts, volume textures, and truncated data include a diagnostic and do not claim a complete pixel result. Mips above the shared 16,777,216-pixel limit are skipped while smaller mips continue; the semantic record is marked incomplete. DDS mip comparisons use the existing `--semantic-offset`, `--semantic-limit`, and `--report` paging. Diff still hashes every selected logical payload; DDS decoding is limited to changed DDS paths and runs only with `--details`, so detailed comparisons can add substantial CPU and memory cost on large texture packs.

`pack diff --details` also includes bounded RMV2 semantic records for LODs, parts, material types, geometry, textures, and parameters. The geometry counters report changed vertices, positions, UV vertex/channel pairs, and indices. Texture records pair by numeric slot ID and occurrence, with before/after array indexes retained as evidence; additions and removals are paged with the other semantic records. Use `--semantic-offset`, `--semantic-limit`, or `--report` for additional records.

`pack validate` always parses RMV2 structure, even when `--full-payloads` is omitted. Malformed structure is an error; unsupported models or parts are warnings and make `validationComplete` false. `unresolvedRigidTextureCount` counts missing or ambiguous embedded texture paths. To resolve those paths against the base game, use `--with-vanilla` (optionally `--game-data <directory>`). For an explicit load order, pass a JSON input containing `vanillaPackPaths` and `packPaths`; each list is ordered from lower to higher priority, supporting packs take priority over vanilla packs, and the validated target pack is highest. Duplicate provider paths retain their last occurrence and highest role. A warning that WS material bindings are unused is emitted only when a direct loader and a valid explicit WS geometry/LOD/part/material binding both point to the same RMV2 model; matching filenames alone do not establish a binding.

Pass `--baseline <pack>` (or `baselinePackPath` in JSON/MCP) to compare diagnostics from the validated target against another pack. Both packs use the same validation and load-order options, and both are treated as the highest-priority target in turn. Diagnostics match as a duplicate-aware multiset of code, severity, path, and message; moved paths are not remapped. The result pages `baselineComparison.added` and `.resolved` independently using `--offset` and `--limit`, reports `unchanged`, per-code before/after/delta counts, and sets `regressed` when any new warning or error appears. In baseline mode the regular diagnostics array contains only the added diagnostic page, while `valid` and `validationComplete` still describe the complete target validation. `--report` writes all target diagnostics and the unpaged comparison. Existing target errors continue to make CLI exit with code 5 and MCP report an error even when the added page is empty.

```json
{
  "baselinePackPath": "/absolute/path/to/base.pack",
  "vanillaPackPaths": ["/absolute/path/to/data.pack", "/absolute/path/to/variantmeshes.pack"],
  "packPaths": ["/absolute/path/to/base_mod.pack", "/absolute/path/to/texture_override.pack"]
}
```

```sh
node dist/cli/main.js pack validate /absolute/path/to/edited.pack --baseline /absolute/path/to/base.pack --with-vanilla --format json
node dist/cli/main.js pack diff /absolute/path/to/base.pack /absolute/path/to/edited.pack --details --semantic-limit 100 --format json
```

Missing or ambiguous embedded textures are warnings and are counted in `unresolvedRigidTextureCount`; `valid` describes structural validity. Require that counter to be zero when checking complete texture resolution. A bounded loader scan that cannot finish makes `validationComplete` false. Invalid embedded loader paths (including leftover absolute developer paths in base game WSModels) produce `INVALID_RIGID_LOADER_REFERENCE` warnings and incomplete loader coverage rather than aborting validation. Reference graph operations retain such paths as unsupported evidence with `INVALID_ASSET_REFERENCE` diagnostics; explicit user-supplied roots remain strictly validated.

`rigid patch` accepts an `edits` array. A selector may specify `lodIndex` and `partIndex`; omitted selectors apply to all matching parts. Texture `type` accepts a registered name or numeric ID, and `path: null` removes an existing slot. Custom terrain exposes its dedicated path as `TerrainTexturePath`; clearing it stores an empty path. Material changes must stay within the same registered layout family. `alphaMode` (`opaque` or `transparent`) edits or adds weighted-material integer parameter `0`; duplicate alpha records and layouts without encoded alpha are rejected. Paths must be valid UTF-8, contain no NUL, and fit within 255 encoded bytes. Overlapping edits are rejected. Every change is reparsed and checked before publication, with geometry and untouched bytes preserved. The output is a new single-model MOD pack at the source model's internal path; referenced textures remain external.

```json
{
  "edits": [
    {
      "lodIndex": 0,
      "partIndex": 1,
      "textures": [
        { "type": "Gloss", "path": null },
        { "type": "BaseColour", "path": "textures/unit_base_colour.dds" }
      ],
      "materialType": "weighted_skin",
      "alphaMode": "transparent"
    }
  ]
}
```

```sh
node dist/cli/main.js rigid patch /absolute/path/to/source.pack 'variantmeshes/models/unit.rigid_model_v2' --output /absolute/path/to/unit-patch.pack --input rigid-patch.json --format json
```

The MCP tools include `rigid_inspect`, `asset_materials`, `pack_validate`, `pack_diff`, `pack_textures`, `asset_users`, `unit_resolve`, `pack_search`, and `rigid_patch` with the same operation fields. `rigid_patch` requires an allowed write root and creates no output when validation or cancellation fails.

## DDS inventories and mip previews

`pack textures` inventories target-pack DDS files by default. `--effective` inventories the effective DDS providers across the target, ordered support packs, and vanilla providers; specifying support or vanilla packs, `gameDataPath`, or `--with-vanilla` also selects effective mode. The target remains highest priority. Use `--glob`, `--offset`, `--limit`, and `--report` to filter and page results; totals and format, dimension, and power-of-two breakdowns always cover the full selected set. Records include dimensions, format, declared/effective mip count, array/depth/cubemap details, stored and logical sizes, and estimated DDS payload bytes. The payload value is a layout estimate, not measured VRAM. Invalid or unsupported DDS files remain visible with diagnostics; unknown estimates are `null`.

```sh
node dist/cli/main.js pack textures /mods/example.pack --glob '**/*.dds' --limit 50 --report /tmp/textures.json --format json
node dist/cli/main.js pack textures /mods/example.pack --with-vanilla --format json
```

The MCP tool is `pack_textures` with the same filters, provider lists, paging, and report fields.

`pack texture inspect` reads one DDS header and optionally exports a mip preview:

```sh
node dist/cli/main.js pack texture inspect /absolute/path/to/example.pack 'textures/unit_diffuse.dds' --format json
node dist/cli/main.js pack texture inspect /absolute/path/to/example.pack 'textures/unit_diffuse.dds' --mip 2 --output /absolute/path/to/mip2.png --format json
```

The MCP equivalent is `pack_texture_inspect` with `packPath`, `filePath`, optional `mipLevel`, optional `surface`, and optional `outputPath`. `--report` / `reportPath` writes a metadata report. Inspection alone creates no files.

The result includes DDS/DXGI format, dimensions, declared/effective mip count, array/cubemap/volume information, and per-mip dimensions, offsets, byte sizes, and payload presence. Mip levels and surfaces are zero-based. Mip byte ranges describe surface zero; `selectedMip` adjusts the offset for `--surface` (default zero). A declared mip count of zero means one base level. Truncated chains are reported with `complete: false` and diagnostics; a missing selected payload cannot be exported.

Preview exports decode the actual stored mip, without resizing or generating mipmaps. PNG preview supports the existing BC1/DXT1, BC2/DXT3, BC3/DXT5, and DX10 BC7 decoders. sRGB data retains its stored channel values. Other formats still report header metadata; known BC4/BC5/BC6H and tightly packed common RGB layouts also expose mip byte ranges, while unsupported decoders return an explicit error on export. Padded RGB layouts and unknown formats do not claim verified offsets or chain completeness. Volume preview is unsupported. Preview size is capped at 16,777,216 pixels; choose a smaller mip for large textures.

Preview writes use the same allowed roots, source protection, atomic publication, and no-overwrite default as other outputs. Pass `--overwrite` to replace an existing PNG. `pack read` continues to extract the original DDS bytes without converting them.

## Localization and unit resolution

`localization_lookup` looks up visible translated text, exact localization keys, or DB keys. It returns the effective translation, raw localization text, source pack/file/row, and verified DB references with key fields. It uses the schema's localized fields and key ordering; composite keys retain every matching row rather than guessing which row a translated name identifies. GUI text replacements and display markup handling are shared with the headless path.

For example, save this as `lookup.json` (use packs for the language you want):

```json
{
  "packPaths": ["/absolute/path/to/mod.pack"],
  "vanillaPackPaths": ["/absolute/path/to/db.pack", "/absolute/path/to/local_en.pack"],
  "query": "Swordsmen",
  "searchBy": "text",
  "match": "contains",
  "tables": ["land_units_tables"],
  "limit": 20
}
```

```sh
node dist/cli/main.js loc lookup --input lookup.json --format json
```

Set `searchBy` to `dbKey` and `query` to a DB key to get its translations, or use `locKey` to look up a localization ID. Matching defaults to case-insensitive `exact`; `contains` is optional. `tables` narrows DB correlation, while unmatched localization IDs remain visible with an empty `dbReferences` array. `translationFound: false` distinguishes missing translations from existing empty text. Per-result DB references default to 100 (`referenceLimit`, maximum 1000); counts and truncation flags remain available. Explicit reports include all matching references.

`unit_resolve` accepts the same pack lists, query, matching, pagination, and report fields. `searchBy` is `key` (main-unit or land-unit key, default), `text` (translated land-unit name), `variant` (variant name), or `mesh` (normalized VMD, wsmodel, or rigid-model path). Mesh lookups follow incoming references to the relevant unit roots; they do not require a manual VMD search. `match` defaults to exact and can be set to `contains` for a basename or partial path. For example:

```sh
node dist/cli/main.js unit resolve --input unit.json --report /absolute/path/to/unit-report.json --format json
node dist/cli/main.js unit resolve /mods/example.pack wh_main_emp_inf_swordsmen --search-by key --match exact --format json
node dist/cli/main.js unit resolve /mods/example.pack visual_swordsmen --search-by variant --match contains --format json
node dist/cli/main.js unit resolve /mods/example.pack 'variantmeshes/variantmeshdefinitions/units/swordsmen.variantmeshdefinition' --search-by mesh --match contains --format json
```

The unit result includes:

- Main/land unit rows and localized names, with source evidence and effective DB precedence.
- Custom-battle faction permissions and their culture/subculture names. Faction-specific visual variants provide fallback scope only when explicit permission rows are absent; generic visuals do not widen explicit permissions.
- Campaign building recruitment rows, building culture variants, exclusive faction allow/deny rows, mercenary groups, and matching unit-set selector rules. Conditions, disabled flags, exclusions, and source rows are retained.
- Unit variants and VMD resolution, mounts, primary/extra engines, character subtypes and subculture overrides, faction-agent permissions, candidate character art sets, and uniforms.
- Optimizer army category (using the host resolver's UI-group/caste/category order), raw men/mount/engine counts, missing-reference issues, table coverage, and missing table names.

Campaign data is **rule evidence**, not a guarantee that a faction can recruit the unit in the current campaign. Scripts, alliances, unlocks, current buildings, and campaign state are not evaluated. Conditional character-art rows are candidates, not a claim of authoritative art selection. Native host scenario scaling, live/dead presence, rigid internals, geometry, LOD, texture, atlas, and performance checks are not run by this operation.

Nested unit details default to 100 (`detailLimit`, maximum 1000) with totals and truncation flags. JSON reports retain all matching units and nested details. Supply the relevant vanilla DB and localization packs for useful coverage; missing tables or unresolved unit visuals make the report incomplete. Use `--with-vanilla` to discover the saved WH3 game data path and include manifest packs. No language selection is inferred.

Both operations are also registered as MCP tools with the same typed inputs and filesystem restrictions.

## Tables, references, and subsets

DB and LOC queries use the bundled schema and exact typed values. I64 values are decimal strings. Filters in one query are combined with AND. An explicit table version must match a known schema version; an unknown schema/version is reported as unsupported. Table patches reject unknown schemas, invalid field types, ambiguous row selectors, and duplicate resulting keys. LOC identity uses only its key column.

`pack search` checks filenames and supported text payloads, and also searches typed DB field values by default. DB hits have `kind: "db"` and include the file, table, row identity/index, field, and typed value. Unsupported or malformed DB tables are skipped with diagnostics. Use `--no-content` (or `content: false`) to search filenames only; this skips text and DB values.

`asset_resolve_references` and `asset_find_references` accept explicit ordered pack lists. Mod packs are ordered lowest priority to highest priority; for asset paths the last matching mod pack wins, and vanilla packs are lower priority than mods. Use `withVanilla: true` or CLI `--with-vanilla` for saved-path discovery. A `gameDataPath` may be used to read its `manifest.txt`; manifest paths are confined to that directory. Graph traversal is bounded to depth 32, 10,000 nodes, and 50,000 edges. Results mark incomplete or unsupported coverage rather than treating unknown references as missing or resolved.

`asset users <targetPack> <assetPath>` (MCP `asset_users`) returns units that use the requested asset through supported incoming dependency chains. It includes variant, mount, engine, extra-engine, and character-uniform candidates, with chain paths, provider ownership, main/land keys, localized names, faction and custom-battle evidence, campaign rules, and conditional character-art candidates. `packPaths` supplies ordered support mods; vanilla options follow the same precedence rules, and the target is highest. Provider rows identify target/support ownership and effective, shadowed, or ambiguous files. The traversal is bounded and returns incomplete diagnostics when roots, indexing, traversal work, or chain walks exceed their limits.

Use repeatable `--unit <key>` options to select exact main-unit or land-unit keys (case-insensitive), and `--root-glob <pattern>` to select roots by a case-insensitive glob over the normalized full internal path. These filters can be combined. Unit filtering happens before per-unit joins; the root glob is applied after root discovery. The JSON result reports both filters, the target/support/vanilla pack scope, and total/selected/scanned unit and root counts. Filtered results describe only that requested scope; an unfiltered search still covers only the packs listed in the result, not every installed mod or game pack.

Batch lookups share pack loading and incoming-reference indexing. JSON/MCP `asset_users` accepts `targetPaths` instead of `targetPath`; `unit_resolve` accepts `queries` instead of `query`. Each list accepts 1–1000 entries and keeps results associated with its input. Existing single-input response shapes remain available. On the CLI, use `--paths-from <file>` with a pack positional argument and no single query/path. The UTF-8 file may contain blank lines and CRLF line endings, is limited to 1 MiB and 1000 nonblank lines, and is checked through the filesystem policy. Combine JSON load-order options with the list file, but omit JSON query/path fields. `--max-scan-sources` / `--max-index-edges` map to `maxScanSources` / `maxIndexEdges` on asset and unit queries.

```sh
node dist/cli/main.js asset users /mods/example.pack --paths-from assets.txt --with-vanilla --format json
node dist/cli/main.js unit resolve /mods/example.pack --paths-from models.txt --search-by mesh --format json
node dist/cli/main.js unit resolve /mods/example.pack ak_teb_guard_kossars_head_03 --search-by mesh --match contains --format json
```

`pack_search` accepts either `query` or `queries` (1–1000 strings) in JSON/MCP and scans each file once, associating matches with the matching queries. `regex: true` applies regular expressions; CLI `--regex` supports alternatives such as `'head_03|body_01'`. Filter before reading contents with `--glob '**/*.variantmeshdefinition'` or its search alias `--file-glob`; conflicting aliases are rejected. `--no-content` searches filenames only.

The graph budgets can be raised or narrowed directly on the CLI: `--max-depth` (0–32, default 32), `--max-nodes` (1–10,000, default 10,000), `--max-edges` (1–50,000, default 50,000), `--max-roots` (1–10,000, default 10,000), `--max-work-nodes` (1–1,000,000, default 100,000), and `--max-work-edges` (1–5,000,000, default 500,000). CLI values override the same fields in `--input` JSON. Roots are deduplicated, filtered, and ranked before `maxRoots`: the exact requested path comes first, then roots whose effective provider is the target pack, other mod roots, and vanilla roots. Equal-rank roots retain discovery order.

`usageComplete` reports whether root discovery and dependency traversal covered the requested unit/root and pack scope. `metadataComplete` reports whether rich roster, localization, recruitment, and character-art details for matched users are complete; `metadataCoverage` lists missing tables and diagnostics. The existing `complete` field is their conjunction. Missing `main_units`, `land_units`, or `unit_variants` data leaves usage incomplete because those tables define the unit/root mapping. Missing optional mount, engine, variant, or model references leave usage incomplete when a selected unit actually references unresolved data. Missing optional roster or recruitment tables can leave metadata incomplete without making the visual-user traversal incomplete.

Root discovery reuses eligible GUI visuals catalog contributions and lightweight source joins. Full localization, recruitment, and source-row reports are built only for matched units; a catalog match must be confirmed by the source evidence. With `--cache-dir`, subsequent requests reuse parsed dependencies from unchanged packs instead of reading all model/XML payloads again. Cold requests still parse missing metadata, and fresh pack indexing plus graph assembly still have a cost on a large vanilla load list.

Unit scans keep sparse visual/DB/LOC path maps instead of duplicating every unrelated game-file entry. Explicit paths outside those types retain accurate provider lookup through on-demand indexing.

```sh
node dist/cli/main.js asset users /mods/example.pack textures/unit_diffuse.dds --with-vanilla --limit 100 --format json
```

An explicit DB file or row root uses the rows from that file's effective same-path pack provider, even when another table subfile wins cross-subfile row precedence. Outbound DB references use the effective cross-subfile rows selected by the shared normalized-filename precedence rule, matching GUI behavior.

Subset requests select files and/or DB rows from `sourcePackPaths`. Optional `packPaths` is the complete ordered mod load list and must include every source pack; when omitted, source order is used. The CLI's `pack subset source.pack --include 'variantmeshes/**' --output subset.pack` is a simple selection form. Complex selections can use JSON fields for paths, prefixes, globs, table names, asset roots, or row filters.

`closure` defaults to `none`; `direct` adds one layer and `transitive` walks supported dependencies. `mode` defaults to `external`, which records dependencies supplied by other packs without copying them. `selfContained` mode may copy external mod dependencies. Vanilla files remain external unless `includeVanilla` is explicitly true. `strict` defaults to false; use `--strict` or `"strict": true` to reject incomplete requested closure. A result reports `selfContained: true` only when the selected transitive closure has no known external or unsupported references. The manifest records selected roots, included files/rows, copied dependencies, and external, unresolved, unsupported, conflict, and coverage information.

## Limits and unsupported formats

- Logical payloads are limited to 256 MiB and pack indexes to 128 MiB. Table queries and supported text reads are paginated; a text preview is at most 64 KiB.
- Search defaults to at most 1,000 results. Diff semantic previews default to 100 rows and cap at 1,000.
- Visual-reference parsing covers supported WSModel, VMD, material, texture, and registered RMV2 relationships. Unknown rigid versions/layouts and unknown file types leave dependency closure incomplete; they do not establish a complete/self-contained graph. UV image preview/export is not implemented.
- DB/LOC operations need a matching bundled schema. Unknown table schemas can be retained as opaque data by unrelated pack copies, but cannot be queried or patched as typed rows.
- ZSTD decoding uses Node's bounded decoder. LZ4 decoding requires the native `lz4-napi` binding for the current platform; the available binding does not expose a pre-decode output-size cap, so the core applies its logical payload cap after decoding.

Validation reports distinguish malformed data from unsupported coverage. Inspect diagnostics and completion fields before treating a graph or subset as complete.
