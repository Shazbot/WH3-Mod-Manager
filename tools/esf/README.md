# Standalone ESF Parser (WH3-focused)

This folder contains a standalone TypeScript parser for Total War ESF files, currently focused on WH3 ESF data (`0x0000ABCA` and `0x0000ABCB` codecs).

Current parser behavior:

- parses CAAB ESF header fields (`unknown_1`, `creation_date`, `record_names_offset`)
- parses CAAB string tables exactly (record names + indexed UTF-16/UTF-8 tables)
- walks CAAB nodes with RPFM-compatible marker handling (records, optimized ints, arrays, strings)
- extracts `REGION_KEYS` and `REGION_DATA` region-center points from the node tree
- decompresses the LZMA `COMPRESSED_DATA` block used by `startpos.esf`, and reads
  campaign regions from the `REGIONS_ARRAY` records inside it

This is intentionally outside the Electron app codepath for now.

`parseEsfDocument` returns the header, string table and codec metadata. Its
`root` node holds only `HEADER` and `STRING_TABLE` — the record tree is **not**
materialised into `EsfNode`s. Everything under `src/extract` instead streams
over the buffer with `walkCaabNodes`, which is the supported way to read node
data.

## Build

`dist/` is generated and git-ignored, so build before running any CLI:

```bash
yarn esf:build
```

Type-check without emitting:

```bash
yarn esf:typecheck
```

## Dump region data

All CLIs require an explicit input path — either the flag or the matching
environment variable. There are no built-in default paths.

```bash
node tools/esf/dist/cli/dumpRegions.js --file /path/to/campaigns/main_warhammer/startpos.esf --json --limit 50 --assert-min 1
```

Note that `dumpRegions` / `extractRegions` is a **heuristic** string-table scan: it
recognises keys by their `wh_` / `wh2_` / `wh3_` prefixes and a hand-maintained
stop-list. It will not find regions in non-Warhammer titles or in mods that use
other prefixes. For structured, prefix-independent results use
`extractMapPoints` or `extractRegionCenters`, which read the actual
`REGION_KEYS` / `REGION_DATA` records.
Region data is read from the actual `REGION_DATA` and `REGION_KEYS` records, so
results are structural rather than prefix-based and work for any title or mod.
The two sources are joined on the region key:

- `REGION_DATA` (via `extractRegionCenters`) is the complete list, giving the
  campaign `REGION_INDEX` and the region centre in region-area grid cells.
- `REGION_KEYS` (via `extractMapPoints`) adds world coordinates, but only covers
  regions belonging to a UI theatre, so it is a strict subset. Regions missing
  from it report `-` for world coordinates.

Optional:

- `--include-nonregion` keeps terrain and connectivity points instead of only `*_region_*` keys.
- `--limit <n>` caps how many rows are printed, `--assert-min <n>` fails if fewer than `n` regions were found.

Both a campaign map's `map_data.esf` and a `startpos.esf` are accepted. The
layout is detected from the records present, not from the filename, so a
decompressed startpos dump works too:

| input | source | fields |
| --- | --- | --- |
| `map_data.esf` | `REGION_DATA` + `REGION_KEYS` | region index, grid centre, world coordinates |
| `startpos.esf` | `REGIONS_ARRAY` | region index, owning faction, subculture, settlement key |

The two carry different data: a map holds region *geometry*, a startpos holds
campaign-start *ownership*. Fields that do not apply to the detected source are
reported as `-` (or `null` in `--json`).

## Compressed startpos files

A `startpos.esf` stores the whole campaign state as a single LZMA stream in a
`COMPRESSED_DATA` record (~9.5 MB compressed, ~111 MB decompressed for Immortal
Empires). The stream has no container header of its own: `COMPRESSED_DATA_INFO`
holds the uncompressed size and the 5 LZMA properties bytes separately, so
decoding rebuilds a standard "LZMA alone" header (5 properties bytes + the size
as a 64-bit little-endian value) before decompressing.

`openEsfBuffer` does this transparently and returns the input untouched for
files that are not wrapped this way, so it is safe to call on any ESF:

```ts
import { openEsfBuffer, parseEsfDocument } from "./tools/esf/src";

const opened = openEsfBuffer(fs.readFileSync(esfPath));
const document = parseEsfDocument(opened.buffer);
// opened.wasCompressed / opened.uncompressedSize describe what happened
```

Decompression uses `@napi-rs/lzma`, a devDependency with prebuilt binaries; it
is not pulled into the packaged Electron app.

## Run test script

```bash
yarn esf:test-regions /path/to/startpos.esf
yarn esf:test-regions /path/to/campaign_maps/wh3_main_combi_map_3/map_data.esf
yarn esf:test-regions /path/to/campaigns/wh3_main_combi/startpos.esf
```

You can also pass the ESF input file by environment variable:

```bash
ESF_FILE=/path/to/startpos.esf yarn esf:test-regions
```

For a map it checks that region centres are extracted, that every key looks like
a region key, and that `REGION_KEYS` holds no keys absent from `REGION_DATA`. For
a startpos it checks that region indices are unique and that every region has an
owning faction.

## Render map HTML (lookup-aware)

This generates a standalone HTML canvas visualization with region labels and highlighting.

By default it prefers `*_lookup_minimap.tga` / `*_lookup.tga` from the same campaign map folder (more accurate region shapes/positions). If no lookup file is found, it falls back to `REGION_AREAS` from `map_data.esf`.

```bash
node tools/esf/dist/cli/renderRegionMap.js --file /path/to/campaign_maps/wh3_main_combi_map_3/map_data.esf --out /path/to/map_regions.html --width 1400
```

Optional:

- `--include-nonregion` includes terrain and connectivity point types in addition to `*_region_*`.
- `--flip-y` flips point-marker Y mapping if label overlay appears vertically inverted.
- `--min-loop-area <n>` drops tiny polygon loops smaller than `n` cells.
- `--source lookup|region-areas|auto` chooses the grid source (default `auto`).
- `--lookup <path>` uses an explicit lookup TGA path.
- in lookup mode, region markers are projected from `THEATRES_AND_REGIONS_FOR_UI/THEATRE` bounds + `REGION_KEYS` points (this fixes missing/misaligned points like Altdorf); if theatre bounds are unavailable, it falls back to lookup-area centroids and optional pathfinding labels.
- `--pathfinding <path>` provides optional labels for that centroid fallback mode.
- `--display-flip-y` / `--display-no-flip-y` overrides vertical display flip.
- by default, marker partitioning is enabled for `region-areas` source and disabled for lookup source; use `--split` or `--no-split` to override.
- in the HTML viewer: click to highlight, drag to pan, and use `Ctrl + mouse wheel` (or `+/-` buttons) to zoom.

Only uncompressed colour-mapped TGAs (image type 1, 8- or 16-bit indices, colour
map starting at index 0) are supported; anything else fails with an explicit
error rather than rendering a wrong map.

## Dump real `REGION_AREAS` grid data

This extracts the decoded `HEX_MAP_DATA` token-grid directly from `map_data.esf` and writes JSON metadata plus optional raw grid payload.

```bash
node tools/esf/dist/cli/dumpRegionAreas.js --file /path/to/map_data.esf --out /path/to/region_areas.json --with-grid
```

Optional:

- `--class-limit <n>` controls how many top classes are shown when not writing `--out`.
- omit `--with-grid` to write metadata only (smaller JSON).
