# Caches

This is an inventory of what WHMM keeps on disk and in memory to avoid re-reading game packs. For each cache it gives the location, what the key covers, and what makes it rebuild.

Every cache here is **disposable**. A missing, corrupt or outdated file is treated as a miss and rebuilt from the packs. Nothing is migrated between versions. Deleting any of these files is always safe; the only cost is a slower next use.

## Locations

- **`<userData>`** is Electron's `app.getPath("userData")`. For the packaged app on Windows that is `%APPDATA%\wh3mm`; the folder name is the package name `wh3mm`. All app-level caches sit directly in it, beside `config.json` and its backups.
- **`<game>`** is the selected game's install folder (`gamePath`).
- **`<data>`** is its `data` folder.
- **`<cache-dir>`** is the CLI's managed cache root: `%LOCALAPPDATA%\wh3mm` on Windows, `$XDG_CACHE_HOME/wh3mm` or `~/.cache/wh3mm` on Linux, and `~/Library/Caches/wh3mm` on macOS. `--cache-dir` overrides it and `--no-cache` disables all caching. Default persistence failures fall back to memory. MCP defaults to bounded memory only and requires an explicit permitted disk root.

## Shared conventions

- **Format.** Most caches are zstd-compressed JSON written at level 1, through `src/utility/jsonDiskCache.ts` or the same pattern inline. The large vanilla caches have custom binary formats, each starting with a 4-byte magic and a version.
- **Keys.** A cache is keyed on the **identity of the files it was built from**, usually `size` + `mtime` per pack. The newest vanilla caches use a canonical identity: real path, size, nanosecond mtime and ctime, device and inode (`src/vanillaCacheIdentity.ts`), so a replaced file is detected even if its mtime is reused.
- **Versions.** Each cache carries a version constant. Bump it whenever the extraction rules or the stored shape change; every existing file then misses.
- **Writes.** The vanilla caches are written beside the target and renamed into place (`src/vanillaCacheFiles.ts` `publishCacheFiles`, and the aside-and-rename in `vanillaPackIndex/store.ts`), as is the optimizer store (`writeJsonAtomically`). The zstd JSON feature caches (`writeJsonDiskCache`, and the split caches' own writers) use a plain `writeFile`. That is safe only because a torn file fails to decompress or parse and is read as a miss.
- **Repeated failures.** If the vanilla DB cache keeps failing for the same identity, `vanillaDbCache/rebuildPolicy.ts` stops retrying it for the rest of the session.
- **Switching game.** `setCurrentGame` in `ipcMainListeners.ts` closes vanilla DB readers, drops registered icons, and clears the in-memory buildings, ancillaries, visuals and campaign-map caches.

## Vanilla game data

These caches depend only on the game's own files, not on the mod list. They are shared by several features, and also by WH3AssetHost and the headless tools.

| File in `<userData>`                                | Holds                                                                                                            | Key / rebuilt when                                                                                                                                                                                                                                                                                                                                       | Code                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `vanilla-pack-files-cache.bin`                      | Per vanilla pack: header, dependency packs, and every file's name, size, offset and compression. Never payloads. | Magic `WVFC`, `VANILLA_PACK_FILES_CACHE_VERSION` (4). Per pack: `size` + `lastChangedLocal`. Only packs named in the current game's manifest are kept. Writes are debounced.                                                                                                                                                                             | `src/vanillaPackFilesCache.ts`, `vanillaPackFilesCacheFormat.ts` |
| `vanilla-pack-index-<game>.bin`                     | Which vanilla pack wins for each of ~680k vanilla file paths, front-coded and binary-searchable                  | Magic `WVPI`, format version 2. Key: `manifest.txt` size + mtime (a game update rewrites it). Built lazily, in about 2 s.                                                                                                                                                                                                                                | `src/vanillaPackIndex/`                                          |
| `vanilla-db-cache-<game>.bin`                       | Every vanilla DB table, decoded and stored as columns (about 12–14 MB uncompressed for WH3)                      | Magic `WDBC`, `VANILLA_DB_CACHE_VERSION` (4). Key: canonical identity of `db.pack`, the **sha1 of the bundled schema** file, the source format and the decoder revision. Built lazily on first use; progress goes to `vanillaDbCacheBuildProgress`.                                                                                                      | `src/vanillaDbCache/` (`store.ts` holds the Electron side)       |
| `vanilla-loc-cache-<game>-<16 hex>.bin` + `.bin.id` | Vanilla localisation for one **set** of loc packs                                                                | `VANILLA_LOC_CACHE_VERSION` (4). The file name is a hash of the game and the pack paths. The `.id` file holds the full identity: canonical identity of each pack, **in order**, because later packs win. Different features read different pack sets, so there is one file per set; a game patch rewrites the same file. Mod locs are never cached here. | `src/vanillaLocCache/`                                           |
| `default-table-versions-cache.bin`                  | Each vanilla table's DB version                                                                                  | Per game: `db.pack` size + mtime                                                                                                                                                                                                                                                                                                                         | `getDefaultTableVersions` area of `ipcMainListeners.ts`          |

Other processes read some of these files:

- **WH3AssetHost** reads `vanilla-pack-files-cache.bin` in every mode; WHMM passes its path to the host. `ensureWh3AssetHostVanillaCache()` fills in every vanilla pack before starting the host, because the manager otherwise fills the cache only lazily.
- **The headless CLI and MCP server** can read `vanilla-db-cache-*.bin` and `vanilla-loc-cache-*` **read-only** through `--whmm-cache-dir <userData>`. Only proven v4 exact-source files are accepted. Their own cache is separate; see `docs/HEADLESS.md` ("Automation caches").

## Feature caches

| Location in `<userData>`                                 | Feature                                              | Key / rebuilt when                                                                                                                                                                                                                                                                                                                                                           | Code                                                                |
| -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `vanilla-skills-data-core-cache.bin`                     | Skills and tech trees: vanilla core data             | Version 7, game, `db.pack` size + mtime. Mods are overlaid live (`skillsData/overlay.ts`).                                                                                                                                                                                                                                                                                   | `src/skillsData/cache.ts`                                           |
| `buildings/vanilla.bin` + `buildings/mods.bin`           | Buildings tab                                        | **Split cache.** `vanilla.bin`: raw rows from `db.pack`, the UI frame pack, loc packs and startpos files, keyed on those files. `mods.bin`: one raw-row segment per mod pack, keyed on that pack's size + mtime, with LRU pruning past 100 segments. Version 4. The derived model is rebuilt in memory from the merged rows.                                                 | `src/buildingsData/cache.ts`                                        |
| `ancillaries/vanilla.bin` + `ancillaries/mods.bin`       | Ancillaries tab                                      | Split cache, same design: vanilla keyed on `db.pack` + loc packs, one segment per mod, LRU 100. Version 4. Toggling a mod rewrites only that mod's segment.                                                                                                                                                                                                                  | `src/ancillariesData/cache.ts`                                      |
| `visuals/vanilla.bin` + `visuals/mods.bin`               | Visuals tab (unit list, searchable asset paths, loc) | Split cache, LRU 100 mod segments, version 7. Vanilla half keyed on the vanilla pack identities it reads. No model or XML payloads are stored.                                                                                                                                                                                                                               | `src/visuals/cache.ts`                                              |
| `<cache-dir>/headless/visuals/references/<pack-path-hash>.bin` | Headless visual dependency metadata, shared format with Visuals | One independently reusable file per source pack, version 1. Key: canonical pack identity, parser revision, logical-payload cap. Raw XML references and RMV2 material/texture metadata only; providers and graphs are resolved per request. Uncompressed RMV2 metadata uses bounded range reads that skip geometry and section padding, with fixed per-part and cumulative read budgets; excess or unsupported metadata makes coverage incomplete. Compressed models retain bounded full-payload decompression. Raw extracted metadata stays query-independent, while DDS edges are filtered to requested targets during request-local indexing. Missing DDS targets do not trigger source scans. Atomic publication; invalid data is a miss. | `src/visuals/referenceCache.ts`, `src/automation/cacheService.ts` |
| `unit-viewer-data-cache.bin`                             | Unit Viewer catalog                                  | **One file, one signature.** sha256 of feature revision 19, game, visuals schema hash, and size + mtime of `db.pack`, the loc packs and **every enabled mod**. Enabling any mod rebuilds the whole thing. Version 32. Painter variant faction colours are pooled by their complete value; unit contexts store pool indexes, restored as independent colour objects.                                                                                                                                                        | `src/unitViewer/cache.ts`; signature built in `ipcMainListeners.ts` |
| `esf-map-data-cache.bin` + `esf-map-images/<sha256>.png` | Campaign map                                         | One signature: sha256 of feature revision 4, game, data folder, language, campaign, vanilla pack names, enabled mods (path, load order, `lastChangedLocal`), and identities of the vanilla packs, loc packs and startpos files. Version 14. Images are stored by content hash, reused across signatures, served as `whmm://map-cache/...`, and removed after 90 days unused. | `src/esfMap/cache.ts`                                               |

## Mod-list and launch caches

| Location                                  | Holds                                                                                                                                      | Key / rebuilt when                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<userData>/pack-headers-cache.bin`       | Per pack: `isMovie`, `hasStartpos`, dependency packs, and whether it has load order rules (plus the parsed rules), native patches or flows | Pack path → size + `lastChangedLocal`. An entry missing a newer field, written by an older version, forces a re-read.                                                                                                                                                                                                                                                        |
| `<userData>/customizable-mods-cache.json` | Which DB tables each pack contains, for the customizable-mods UI                                                                           | Pack path → size + `lastChangedLocal`. Plain JSON.                                                                                                                                                                                                                                                                                                                           |
| `<userData>/flow-execution-cache.bin`     | The previous launch's flow output, per game                                                                                                | Version 10. A hash of game, game path, every enabled mod (path, name, load order, size, mtime), every vanilla pack, the player's flow options and the pack data overwrites. Reused only if every output pack still exists in `<game>/whmm_flows` and the flows contributed no in-memory native patches. Not updated after a launch where a flow failed. See `docs/FLOWS.md`. |
| `<game>/whmm_optimized_mods/`             | Workshop optimizer results                                                                                                                 | See below                                                                                                                                                                                                                                                                                                                                                                    |
| In memory                                 | Compat check results (`compatCheckCache`)                                                                                                  | Hash of the mods (path, name, load order, size, mtime) and vanilla packs, version 1. Lasts for the session only.                                                                                                                                                                                                                                                             |

## Workshop optimizer store

`<game>/whmm_optimized_mods/` sits next to the staging folder `<game>/whmm_copied_mods/`, never inside it. So "Clean up after game exit" and "Clear copied mods" leave it alone. Layout (`src/workshopModOptimizer/cache.ts`):

```
entries/<key>.pack, entries/<key>.json    a finished result (restored by hard link, else copy)
entries/<key>.failed.json                 the host failed for this key; not retried
aliases/<exactKey>.txt                    exact key -> narrow key
reports/<pack>.report.txt                 latest host report per mod
tmp/   logs/   host-cache/                host output, failed-run logs, host probe-scan cache
```

Keys (`cacheKey.ts`) cover:

- the optimizer profile and options (`WORKSHOP_OPTIMIZER_PROFILE_ID`);
- the source pack's name, size and mtime;
- the host's **output version**, plus its scan version for aliases;
- a digest of the game's packs and of the DB schema.

There are two keys per result:

- The **exact key** covers every enabled mod.
- The **narrow key** covers only the mods the host's probe found relevant. That is why enabling an unrelated mod does not invalidate a result. The alias file maps one key to the other.

Housekeeping runs a little after startup (`housekeepingSchedule.ts`). The budget is 12 GiB, with at most 2 entries per source. Entries unused for 30 days, and failure markers that old, are removed.

The UI can clear this store with "Clear optimized mods cache" (IPC `clearWorkshopOptimizerCache`). Earlier versions kept this cache under `<userData>`; `runtime.ts` checks for that leftover and removes it, once per app run.

Related files in `<userData>`:

- `workshop-optimizer-last-run.json`: the last run's report.
- `visual-asset-checks/{reports,tmp,host-cache}`: output of the visual asset check.

## Generated folders that are not caches

These are rebuilt or cleared by design. Do not treat them as caches to key on:

| Folder                       | Lifetime                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `<game>/whmm_copied_mods/`   | Staged Workshop mods for a launch. Cleared on demand or after the game exits.                         |
| `<game>/whmm_flows/`         | Flow output packs. Cleared at the start of each launch that runs flows.                               |
| `<game>/whmm_overwrites/`    | Packs rewritten with the player's data overwrites, for a launch                                       |
| `<userData>/model-previews/` | WH3AssetHost GLB exports and unit-painter staging. Deleted once per app run, before the first export. |

## In-memory only

These live for one session and are not listed above:

- the parsed packs in `appData.packsData` and `packReadRegistry`;
- the open vanilla DB and loc readers;
- each feature's `cached*Data` object, which is checked against the same signature as its disk file;
- Unit Viewer localization lookups memoize only requested values and misses; every build creates a fresh lookup;
- Unit Viewer batch asset matching builds a temporary per-pack lookup containing only requested candidate paths; it is discarded after matching that batch;
- headless reference environments memoize effective DB rows and compact XML/RMV2 reference metadata for one request (`src/automation/references.ts`). The automation cache can retain/persist the raw per-pack metadata within its memory budget; `--whmm-cache-dir` also reuses eligible GUI visuals catalogs read-only. Source schema/identity and bounded DB preambles are checked before using catalog rows, and matched units are hydrated from source DB/LOC evidence. RMV2 payloads and geometry are not retained; before/after diff graphs remain separate;
- headless visual-user, mesh, and affected-diff queries build a bounded incoming-reference index per request from those raw references (`src/automation/graphUsers.ts`). It resolves effective providers for the current load order, shares indexing across batch seeds, and keeps before/after state separate. The resolved index is not persisted. Cold queries inspect eligible sources when a requested target can have an effective provider; missing DDS targets skip source scans, and warm queries reuse per-pack extractions. Uncompressed RMV2 metadata scans read headers and material records with bounded ranges, skipping vertices, indices, and section padding; compressed model entries still use the bounded full read/decompression parser. DDS edges are resolved and charged to the index budget only when they match requested DDS targets, while raw cached extraction remains independent of the query. Model/VMD/wsmodel seeds skip RMV2 texture-slot scans. Index scan limits and changed-path traversal limits are tracked separately, with partial coverage reported explicitly;
- the per-run `FlowExecutionContext`;
- the startpos region template cache in `esfMap/loader.ts`;
- the renderer's table-prep cache (`PackTablesTableView.tsx`).

Incoming-reference scans use one temporary, policy-authorized pack handle at a time. This is not a retained cache reader. Reads verify descriptor identity against the request snapshot, and finishing a pack scan reauthorizes its path and checks that the same source is still present. Completed packs are snapshot-checked and their raw metadata is flushed and released before the next pack; only the budgeted retained cache keeps eligible copies. Final request snapshot checks remain in place; cancellation and errors close the handle. This avoids repeating path resolution and file opens for every visual file without trusting a stale source path.

## Adding a cache

1. Key it on the identity of every input file: size + mtime at least, or `getCanonicalFileIdentity` for vanilla inputs. Include the game and any schema hash the output depends on.
2. Add a version constant and bump it whenever the extraction rules or the stored shape change.
3. If the data has a vanilla part and a per-mod part, follow the **split** design used by Ancillaries, Buildings and Visuals rather than one signature over every pack. A single signature throws away the expensive vanilla work whenever any mod changes.
4. Use `readJsonDiskCache`/`writeJsonDiskCache` (zstd level 1, failures read as misses), or the vanilla caches' publish-and-rename for binary formats.
5. If it holds data for the current game, clear its in-memory copy in `setCurrentGame`.
