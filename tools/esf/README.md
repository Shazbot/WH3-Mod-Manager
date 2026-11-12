# Standalone ESF Parser (WH3-focused)

This folder contains a standalone TypeScript parser for Total War ESF files, currently focused on WH3 ESF data (`0x0000ABCA` and `0x0000ABCB` codecs).

Current parser behavior:

- parses CAAB ESF header fields (`unknown_1`, `creation_date`, `record_names_offset`)
- parses CAAB string tables exactly (record names + indexed UTF-16/UTF-8 tables)
- walks CAAB nodes with RPFM-compatible marker handling (records, optimized ints, arrays, strings)
- extracts `REGION_KEYS` and `REGION_DATA` region-center points from the node tree
- decompresses the LZMA `COMPRESSED_DATA` block used by `startpos.esf`, and reads
  campaign regions from the `REGIONS_ARRAY` records inside it
- reconstructs the `campaigns_tables` fields persisted across the startpos
  campaign setup and map-data records

The parser is also consumed by the Electron app's campaign-map tab; the CLI
below remains useful for inspecting and validating files.

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

| input          | source                        | fields                                                   |
| -------------- | ----------------------------- | -------------------------------------------------------- |
| `map_data.esf` | `REGION_DATA` + `REGION_KEYS` | region index, grid centre, world coordinates             |
| `startpos.esf` | `REGIONS_ARRAY`               | region index, owning faction, subculture, settlement key |

The two carry different data: a map holds region _geometry_, a startpos holds
campaign-start _ownership_. Fields that do not apply to the detected source are
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

Decompression uses `@napi-rs/lzma`, which is a runtime dependency because the
in-app map tab reads compressed startpos data.

## Run test script

```bash
yarn esf:test-regions /path/to/campaign_maps/wh3_main_combi_map_3/map_data.esf
yarn esf:test-regions /path/to/campaigns/wh3_main_combi/startpos.esf
```

You can also pass the ESF input file by environment variable:

```bash
ESF_FILE=/path/to/startpos.esf yarn esf:test-regions
```

## Dump campaigns table metadata

The fields from `campaigns_tables` which are persisted in a startpos can be
written as a 14-column, schema-ordered TSV. Repeat `--file` to combine several
campaigns, and use `--validate` to compare the ESF-backed columns with an
existing table dump:

```bash
yarn esf:dump-campaigns \
  --file /path/to/campaigns/wh3_main_chaos/startpos.esf \
  --file /path/to/campaigns/wh3_main_combi/startpos.esf \
  --out /path/to/campaigns_tables.tsv \
  --validate /path/to/reference_campaigns_tables.tsv
```

If only `campaign_name` and `map_name` are needed, `--identity-only` reads them
from the uncompressed outer wrapper. It is faster and still works when the
inner compressed campaign state is damaged:

```bash
yarn esf:dump-campaigns --identity-only \
  --file /path/to/campaigns/wh3_main_chaos/startpos.esf \
  --file /path/to/campaigns/wh3_main_combi/startpos.esf \
  --file /path/to/campaigns/wh3_main_prologue/startpos.esf
```

`--json` includes source paths and lists the columns unavailable from a
startpos. Those unavailable fields are left empty in TSV output: the localised
`onscreen_name`, `description` and `bullet_list`, plus the DB-only `exportable`,
`mask`, `mp_sort_order` and `game`. Validation skips those seven fields.

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


## Startpos edit prototype: remove a faction

The mutation prototype removes a faction by key and compacts explicit faction IDs in the
faction records, diplomacy, AI rows, and the validated faction-indexed threat, favour,
target, and plague records. CAI character-post groups are removed by their `OWNED_DIRECT` faction owner. Numeric
post keys, campaign unit IDs, and CAI component IDs belong to different domains and
must not be matched interchangeably. Historical influence-map deletion also updates
the explicit serialized map count, preserving the count when it shares a raw span
with the first map key. Removed mobiles are also removed from the known theatre and
region reference arrays, their military-strength beliefs, and their paired basic/extended
resource influence maps (including the explicit resource count). Dependent analyser
and faction-manager arrays are trimmed as complete pairs; diplomatic analysis uses
individual faction-reference lists. It updates the known
faction-indexed arrays and refuses to write if ASCII references to the removed key remain.
This is an initial format model; unknown numeric faction-ID fields may still require
additional handling.
It writes to a separate output path and never edits the input. If the faction key appears
inside `REGIONS_ARRAY`, pass an existing faction with `--transfer-to`; otherwise the tool
refuses to leave region references to a deleted faction.

```bash
yarn esf:remove-faction --file /path/to/startpos.esf --faction faction_key --out /path/to/startpos.edited.esf
# If it owns regions:
yarn esf:remove-faction --file /path/to/startpos.esf --faction faction_key --transfer-to other_faction --out /path/to/startpos.edited.esf
```

For a Mixer-style pack, the pack wrapper uses WHMM's CLI to extract the selected campaign
startpos, build a one-file subset from the source pack, replace that startpos, and validate
the resulting override pack. The source pack is left untouched:

```bash
yarn esf:remove-faction-pack \
  --pack '/path/to/!b_mixer.pack' \
  --campaign wh3_main_combi \
  --faction ovn_alb_host_ravenqueen \
  --out-pack '/path/to/!!b_mixer_ravenqueen_removed.pack'
```

The campaign value is the directory beneath `campaigns/`. Pass `--transfer-to <faction>`
when removing a faction that owns regions, or `--overwrite` to replace an existing output.
The pack wrapper requires both `yarn build:tools` and `yarn esf:build`; its package script
runs both builds before creating the pack.

The command reparses the result, checks faction keys, contiguous faction IDs, diplomacy
rows, known indexed-ID records, and that no ASCII faction-key references remain. It also
round-trips the compressed stream. The no-edit writer roundtrip loaded successfully in the current campaign test.
On 2026-11-10 the user confirmed that the corrected Mixer Ravenqueen-removal
output (v48) loaded into the campaign. Native debugging identified the stale map
counters and dangling CAI references fixed above. This validates that specific
campaign-load case; save/reload, end-turn behavior, and other faction removals have
not been established. After `yarn esf:build`, regression tests are available as
`node tools/esf/dist/edit/removeFactionOwnership.test.js`,
`node tools/esf/dist/edit/removeFactionInfluenceMap.test.js`,
`node tools/esf/dist/edit/caiMobileReferences.test.js`, and
`node tools/esf/dist/edit/caiMobileDependents.test.js`. The editor UI is not part of this
prototype.


### Batch removal

To remove many keys in one parse/edit/write cycle, put the requested keys in a JSON
string array. Keys absent from FACTION_ARRAY are reported separately. Region
references require a JSON mapping from each removed key to a surviving recipient:

```bash
node tools/esf/dist/cli/removeFactions.js \
  --file original-startpos.esf --out bulk-removed-startpos.esf \
  --keys faction-keys.json --transfers transfers.json --report removal-report.json
```

The batch editor compacts surviving IDs once, trims the known indexed lists and
CAI dependencies, and uses the same output verification as single removal. Its
Ravenqueen/Truthsayers output was compared byte-for-byte (decompressed) with the
user-confirmed sequential two-faction output. Reference-array edits are collected
and applied together; source records already deleted from the tree are skipped.

After `yarn esf:build`, run `node tools/esf/dist/edit/removeFactions.test.js` for
batch ID compaction and row-metadata cases. The existing reference-array tests
also check skipped edits in a deleted parent. These tests and structural checks
do not establish game behavior for arbitrary larger removal sets.


Numeric ownership: REGION v3 direct scalar4 is a faction ID and must be compacted
for all surviving owners, with removed owners transferred to the recipient's
compacted ID. The single and batch commands share this remapping and reject
unsupported region layouts. Output validation checks the owner-ID range.
`node tools/esf/dist/edit/regionFactionIds.test.js` covers this contract.
The two-faction byte-parity result above predates this correction; earlier map
loads alone did not validate territory ownership.


Province and sea references also carry campaign faction IDs: the second scalar
of FACTION_PROVINCE_MANAGER v1 and FACTION_SEA_REGION_MANAGER v0, plus owner keys
in the supported province-level recruitment/persistent-resource rows. Their
manager UIDs are preserved. `provinceFactionIds.ts` shares this remapping between
single and batch removal and rejects duplicate transferred manager owners.
Run `node tools/esf/dist/edit/provinceFactionIds.test.js` for those regressions.


Sparse faction tables use an explicit name/version allowlist in
`factionKeyedRows.ts`. Removed owner rows are deleted; surviving first direct
faction IDs compact while other payload bytes and nested records are preserved.
The shared verifier checks these IDs as well as territory owner IDs. Cooking v3
has child records before its first direct scalar; row position is not its owner.

Unsigned 24-bit ESF IDs use big-endian bytes; 16-/32-bit IDs use little endian.
The binary walker, mutation helpers and supported AI reference arrays share the
native numeric representation. This prevents cross-width aliases and ensures
that a removed 16-bit component ID matches its wider 24-bit reference encoding.
Both removal CLIs reject unresolved mobile references in CAI_THEATRE array0 and
CAI_REGION array4. `unsigned24Ids.test.ts` and `caiMobileReferences.test.ts` cover
native byte fixtures, width boundaries and missing components. Full-batch native
captures and independent owner/payload audits are under the game directory's
`startpos_all_mixer_factions/`; runtime validation remains separate.
