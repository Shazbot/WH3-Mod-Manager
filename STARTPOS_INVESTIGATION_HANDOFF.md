# WHMM startpos faction-removal investigation handoff

Updated 2026-11-12. This handoff is for continuing the investigation in `/mnt/k/projects/whmm`.

## Goal

Remove every faction listed in `!b_mixer.pack` factions_tables from the existing Mixer `wh3_main_combi` startpos, using WHMM CLI for pack operations and game launch. The earlier Ravenqueen/Truthsayers removals are preserved positive campaign-load reports.

## Latest result

**V15 successfully loads the campaign.** On 2026-11-12 the user clicked Continue and confirmed it loaded fine; independent game-window capture shows the map and campaign advisor. WHMM CLI launched only Mixer and `data/!!b_mixer_all_table_factions_removed_v15.pack`. The authorized debugger recorded no native restoration error, then was detached while the same game process stayed alive. Game is left running. Save/reload/end-turn remain untested.

254 unique Mixer table keys were requested: 247 present factions removed, 7 already absent, 561 remain from 808. Montfort, Gisoreux and Quenelles transfer to Couronne. Five keys have transfer mappings, but Languille/Brionne references were historical. 85 focused tests and full-payload pack validation pass. Independent identity audits preserve 572 region owners (569 unchanged, 3 transfers), 450 land/sea manager references and 1611 sparse rows with unchanged opaque payloads.

The final V15 fix remaps 13 stable faction-owner references in 11 parallel basic-region-group arrays; every other decompressed byte matches V14. Prior native failures established numeric region/province/sea ownership, sparse faction rows, unsigned24 BIG-endian IDs (16/32-bit stay little-endian), mobile/garrison dependencies, orphan AI force-building slots/technologies, AI province owners and typed BDI belief references. Sources and regressions cover shared single/bulk cleanup and validation. Build with `yarn esf:build`; full batch needs `node --max-old-space-size=8192 tools/esf/dist/cli/removeFactions.js`.

Pack SHA256: `e9e9dd4357cdb370f3a505d0039b6384b2bb24652b710c6a3eb32dd93b34eefe`. Unchanged EXE SHA256: `d2a8a58288bf8bd86768f21ff6be036cebb1916f9c312999c60afc1abe13789f`. Use V15 alongside Mixer, without any other removal override. Detailed evidence, exact keys/transfers, scripts, native findings, validation reports and rolling history live in game-folder `startpos_all_mixer_factions/HANDOFF.md` and `status.json`.

### Earlier two-faction result

**Two-faction success:** the user confirmed that
`data/!!b_mixer_two_albion_factions_removed.pack` loads into the campaign with
Mixer. It removes both `ovn_alb_host_ravenqueen` and
`ovn_alb_order_of_the_truthsayers`, reducing808 factions to806. Both keys are
absent from serialized node references, and WHMM full-payload validation passes.
Use this override instead of the earlier one-faction overrides. Permanent
artifacts and runtime evidence are in game directory `startpos_two_factions/`.

The preceding single-faction result remains preserved in
`startpos_investigation_final/`. Source fixes passed17 focused regression tests;
no source changes were needed for the two-faction test. Save/reload and ending a
turn remain untested. Earlier crash findings below are historical snapshots.

## Historical v34 result

The no-edit CAAB writer-roundtrip override was reported by the user as loading fine. Treat it as a positive control for the current input/writer path, but distinguish the user's report from what was independently observed: an earlier screenshot showed the game at its startup Continue screen, and that observation alone did not prove a new campaign reached the map.

A focused diagnostic, v34, then retained the Ravenqueen entry in `CAI_INFLUENCE_MAP_MANAGER` while applying the other faction-removal edits. The user reported that v34 crashed. The game was launched with only Mixer plus v34; the current `modified.log` confirms both packs were active. The fresh dump is `D2026-11-10_T20-02-47.mdmp`.

Offline CDB analysis shows the same failure site and register state as v33:

- Exception: access violation, `Warhammer3.exe+0x2865dbe`.
- Instruction: `mov rcx,qword ptr [rcx+170h]`.
- `rcx = rbx = 0x15c`; attempted read at `0x2cc`.
- Process uptime at the exception: 46 seconds.
- Stack starts `Warhammer3.exe+0x2865dbe`, return address `Warhammer3.exe+0x2844161`.
- v33 dump: `D2026-11-10_T15-57-28.mdmp`, same RIP and invalid `rcx` value.

This rules out removal of that one influence-map key/map pair as the sole cause, assuming the v34 pack was loaded as recorded. It does not rule out other CAI cleanup or faction-indexed data edits.

## v34 artifact and how it was made

Installed pack:

`/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III/data/!!b_mixer_ravenqueen_removed_preserve_influence_v34.pack`

WHMM validated it as a valid PFH5 pack, one file, full payload validation complete, no diagnostics. Its only file is `campaigns\\wh3_main_combi\\startpos.esf`. Pack SHA256:

`81c2e6f848862abb5db1c3d9445f0396063643c10e794a728fcab27ba6ac23f4`

Edited ESF artifact in the repository cache:

`.cache/automation/startpos-investigation/v34_preserve_influence_startpos.esf`

SHA256: `363b35c56c554154a5c5949c6fb93825bd2ba82d3997ce14f9665d3cb7576463`.

It was generated from `.cache/automation/startpos-investigation/current_mixer_combi_startpos.esf` using the compiled `removeFaction` implementation. During that call, a temporary `Array.prototype.splice` wrapper skipped exactly the `splice(start, 2)` on the `CAI_INFLUENCE_MAP_MANAGER` group's array. All other removal behavior ran normally. The faction count changed 808 to 807; Ravenqueen was at index 559 (faction ID 561). No source-code files were changed for this experiment.

Important instrumentation caveat: `removeCaiFactionInfluenceMap()` returns `1` after the splice call without checking that the splice changed the group. Therefore the v34 report's `influenceMapsRemoved: 1` is misleading; the wrapper's `skippedSplices: 1` is the evidence the map pair was retained.

WHMM launch command used:

```sh
node dist/cli/main.js game launch --temporary \
  --only '!b_mixer.pack' \
  --only '!!b_mixer_ravenqueen_removed_preserve_influence_v34.pack' \
  --skip-intros --auto-start-campaign --game wh3 \
  --launch-timeout 240 --format json
```

The command returned `started:true`, `startedApp:true`, no warnings. `modified.log` lines 3261-3262 list v34 and `!b_mixer.pack`. The game is currently closed after the crash; do not kill/replace anything based on stale process state. Check `tasklist.exe /fi "imagename eq Warhammer3.exe"` before a new launch.

## Prior controls / artifacts

- Mixer source: `/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III/data/!b_mixer.pack`.
- Exact-byte priority override: `data/!!b_mixer_startpos_roundtrip.pack`. Its extracted `startpos.esf` matched Mixer byte-for-byte (SHA256 `41cb33f7f027f180497aba909079ad9a54a7c1434d9b1adcbe9de5c9dc4ee810`). It did not crash through startup in the earlier run.
- No-edit CAAB-writer roundtrip pack: `data/!!b_mixer_startpos_writer_roundtrip_v1.pack`. It was produced by the WHMM CAAB parse/write/recompress path with no faction deletion. Its opened inner payload was 122,130,903 bytes, SHA256 `1a4adc18a98fd97af5a383d79a409b85e20cd5600d843f7ef3cd39d6b0b6a9f0`. The user subsequently reported “loaded fine”; clarify the exact stage if needed, since no screenshot of the campaign map is recorded here.
- v33 edited pack: `data/!!b_mixer_ravenqueen_removed_startpos_v33.pack`; its expected decompressed runtime ESF is `.cache/automation/startpos-investigation/v33-runtime-expected.esf`, SHA256 `0870a28fe2362322a666241db4751883d80495581fd1603eb6dcd6ef01896756`. It crashed at the same address as v34.
- Recent crash-report directory: `/mnt/c/Users/tilic/AppData/Roaming/The Creative Assembly/Warhammer3/crash_report/`.
- v34 stack text is `D2026-11-10_T20-02-47.stack.txt`; it contains module names only, so use the minidump for registers/disassembly.
- `modified.log` is `/mnt/c/Users/tilic/AppData/Roaming/The Creative Assembly/Warhammer3/logs/modified.log`.

## Current implementation and source state

Main edit implementation: `tools/esf/src/edit/removeFaction.ts`, exported `removeFaction()` around lines 690-1032. Pack workflow: `tools/esf/src/cli/removeFactionPack.ts`; file CLI: `tools/esf/src/cli/removeFaction.ts`. CAAB tree/writer are `tools/esf/src/esf/codecs/caabTree.ts` and `caabWriter.ts`.

The latest `removeFaction` path edits diplomacy relationships and pairwise diplomacy, explicit faction IDs, faction-indexed records, CAI faction/world rows and several CAI entity tables, influence maps, beliefs and BDI ownership, family tree/name manager data, region faction references, then deletes the `FACTION_ARRAY` row. It structurally validates several invariants but is not proven game-safe.

Repository already had these user/task changes before this turn; preserve them and do not reset/revert:

```text
 M package.json
 M src/helperPackData.ts
 M tools/esf/README.md
 M tools/esf/src/esf/codecs/caabBinary.ts
 M tools/esf/src/esf/compressed.ts
 M tools/esf/src/index.ts
?? .codebase-memory/
?? tools/esf/src/cli/removeFaction.ts
?? tools/esf/src/cli/removeFactionPack.ts
?? tools/esf/src/edit/
?? tools/esf/src/esf/codecs/caabTree.ts
?? tools/esf/src/esf/codecs/caabWriter.ts
?? tools/esf/src/esf/recompress.ts
```

Codebase-memory project was indexed as `mnt-k-projects-whmm`; the relevant implementation and writer paths had no recorded coverage gaps. Index coverage is best-effort; direct source reads were also used.

## Useful prior findings

- v33 removed 53 BDI components and 8 `CAI_BDI_COMPONENT_BLOCK_OWNS` rows; v32 failed at the same crash site.
- Cross-family numeric collisions exist in CAI IDs. Do not infer that equal numbers in `CAI_CHARACTER_POST`, resource mobile, BDI component, faction, or string-table domains are the same identifier.
- v33 faction-index inventory showed expected 808-row cleanup for `CAI_WORLD_FACTIONS` (809 to 808), `FACTION_PLAGUES_DATA` (809 to 808), and the extra-row BDI ownership record (809 to 808). No obvious same-sized faction array was left untouched.
- The old dump object's `+8=3847` and `+0x20=348` happened to match IDs present in separate `FACTION_INFOS` rows. That association was not proven; treat it only as a lead.
- `removeCaiFactionInfluenceMap()` pairs each `CAI_HISTORICAL_INFLUENCE_MAP` child with the preceding key and removes both from one mixed group. v34 retained this pair and still crashed at the same site.

## Recommended next diagnostic

Build a broad “preserve CAI object rows” diagnostic from the original Mixer startpos, keeping the faction removal and required positional faction arrays/diplomacy edits, but skipping only deletions from these CAI cleanup arrays:

- `CAI_WORLD_CHARACTERS.groups`
- `CAI_CHARACTER_POSTS.groups`
- `CAI_WORLD_RESOURCE_MOBILES.groups`
- `CAI_WORLD_UNITS.groups`
- `CAI_FACTION_STRATEGIC_STANCE` node groups
- `CAI_INTERFACE_MANAGERS.groups`
- `CAI_BDI_POOL_BELIEFS` node groups
- `CAI_BDI_COMPONENT_BLOCK_OWNS` node groups
- `CAI_INFLUENCE_MAP_MANAGER.groups[0]` child array (already preserved in v34)

Do **not** skip removal/remapping of the target `CAI_WORLD_FACTIONS` positional row or faction IDs; those are parallel to `FACTION_ARRAY`. Do not rely on the report counters when splice operations are intercepted. Check actual group counts and written file structure. This is an isolation run only: preserved orphan CAI rows may themselves be inconsistent. If it still fails at the identical RIP, focus next on non-CAI faction-indexed metadata and explicit ID coverage; if it loads further, bisect the CAI groups above.

Before another game run: ensure no WH3 process is running; use WHMM CLI with only Mixer and the new single diagnostic pack; verify `modified.log` names the intended pack; record whether the user reached the campaign map; collect the new minidump if it crashes. Do not attach a live debugger or modify the installed EXE.


## Continuation through v39 — 2026-11-10

This section supersedes the earlier recommended v35 diagnostic. Separate builders,
reports and ESFs are preserved in the game directory under
`startpos_investigation_v35` through `startpos_investigation_v39`. No WHMM source
files or EXEs were changed. All packs were created/validated/launched via WHMM CLI.

- v35 broad CAI-row preservation crashed: dump D2026-11-10_T20-22-07.mdmp,
  RIP RVA 0x2865dbe, RCX=RBX=0xa06, uptime 44 seconds. Surviving protected CAI
  contents were hash-verified. Four empty nested ownership nodes disappeared with
  the required CAI faction row, and actual BDI component count fell by four.
- v36 preserves surviving faction IDs, leaving gap 561. All other cleanup active.
  Structural checks and full pack validation passed; crashed with the v33/v34
  RIP and RCX=RBX=0x15c. Dump D2026-11-10_T20-37-26.mdmp, uptime 44 seconds.
- v37 uses normal contiguous-ID removal, then removes numeric-array entries
  matching deleted BDI component IDs in CAI. It removed 851 entries in 826 arrays,
  with no remaining matches in supported CAI integer arrays. This is a broad
  diagnostic; identifier-domain equivalence is not universally established.
  Still crashed at the same instruction with 0x15c; dump
  D2026-11-10_T20-46-14.mdmp, uptime 40 seconds.
- v38 adds deletion of a CAI_RESOURCE_MOBILE_MILITARY_STRENGTH_ANALYSIS belief
  referencing deleted mobile ID 7996161, its influence-map key/map pair, and the
  new dangling CAI_ANALYSER array reference to removed component 8192769.
  Still crashed at the same instruction with 0x15c; dump
  D2026-11-10_T20-48-16.mdmp, uptime 38 seconds.
- v39 starts from v38 and updates the sole direct u16 value in CAI_FACTION rows.
  Original ordinary rows match row index + 1 (faction ID - 1); the trailing
  special participant ID 1 has u16=809, proving the field is positional rather
  than simply ID-1. Removal left 249 such fields unadjusted, including the
  trailing participant. V39 compacts them with fixed-width writes, retaining
  record sizes. Its semantic field name is unproven. Pack validation passed;
  launched for testing, result pending at this checkpoint. Pack:
  `data/!!b_mixer_ravenqueen_removed_cai_indices_v39.pack`.

Important native finding: the repeated AV is in destruction, after the campaign
loader has already returned status 1. Loader RVA 0x247dc28 checks its constructor
output status at +0x247dd78, then destroys the rejected environment. Destructor
chain reaches CAI world (0x2843534), then object destructor 0x2844104, which loads
the still-numeric reference from object+0x20 and passes it to 0x2865db0 as a
pointer. Do not identify the root load error solely from the cleanup AV.

CAI-world reference resolver RVA 0x286232c returns false on the first failed
child resolver, so later objects can remain unresolved. Base resolver
0x2af558c performs registry lookups and returns true. The dump's heap coverage
does not include the faction pointer vector, limiting postmortem inspection.
Offline CDB only; no live debugger attached and no process memory changed.

Main Ravenqueen CAI OWNED_DIRECT key is 32345. V36 had no remaining scalar
references to it, but packed arrays still contained this and other deleted IDs:
CAI_BDI_COMPONENT dependencies, CAI_DIPLOMATIC_ANALYSIS and
CAI_FACTION_MANAGER_MANAGER keys. Equal numeric values in other scalar families,
especially CAI_CHARACTER_POST IDs, still do not prove identical identifier domains.

Each CLI launch selected only Mixer and the new diagnostic. modified.log also
shows WHMM's generated !!!!out.pack in %APPDATA%/wh3mm/tempPacks; inspected content
was only intro movies, the logging marker and campaign autostart Lua, no startpos
or DB files. Never equate started=true or a surviving process with reaching the
campaign map. Verify current process state before each subsequent launch.

## Authoritative continuation through v45 — 2026-11-10

Supersedes the v39 checkpoint above. User explicitly authorized live debugger
attachment and EXE reverse engineering. The installed EXE has NOT been replaced
or patched on disk; original remains preserved. Debugger used early software
breakpoints and later hardware execution breakpoints on disposable CLI launches.

The no-edit writer-roundtrip control was relaunched with the same WHMM CLI
campaign autostart and the user explicitly reported that it loads fine (campaign
map). This is the positive control; process survival alone is not success.

Two source fixes are implemented in WHMM tools/esf/src/edit/removeFaction.ts:
1. CAI_CHARACTER_POSTS removal now follows sibling OWNED_DIRECT faction ownership.
   Old numeric-key matching deleted unrelated posts (3245/3246/32345 owned by
   27558, plus 7930625 owned by 27630). Target-owned post is 5222913, BDI638210,
   OWNED_DIRECT32345. Four ownership regression cases pass.
2. Historical influence-map deletion now decrements its explicit declared count,
   preserving the other scalar fields when the first key shares a raw span with
   that counter. Five regression cases pass, including first-map deletion and
   an encoding-width boundary. Latest yarn esf:build passes.
   Original v33 debugger captured a precise ESF overrun: native historical-map
   loop index808 with declared count809, despite only808 actual historical maps.
   Native loader RVA0x2b60cfc; readU32 failure caller+0x2b60f75. Reader error
   function RVA0x1443580 is the useful first-error breakpoint. The old cleanup AV
   at RVA0x2865dbe is secondary and masks the real cause.

IMPORTANT: v37-v41 broad generic-array diagnostics are INVALID approaches to
integrate. CAI_ANALYSER stores pairs; independently deleting matching integers
created odd-length arrays and introduced an earlier reader failure. v41 debugger
proved this. No broad array cleanup was merged into production source.

v43 is normal removal with the ownership fix only, generated by the compiled
ESF removal CLI. v44 adds only the historical-map counter fix (809->808 at inner
offset103763181). SHA256 outerESF:
e81ba76113e8fb6c7b0d1ecc06cfe06a6713942324d4681937658ee109c034fe.
v44 still crashes, but debugger proves the reader error is gone and instead
catches first CAI-world resolve failure. Full dump K:/wh3-first-failure-v44.dmp,
log startpos_debug/live-v44-first-failure.log. Native world resolver RVA0x286232c,
first child virtual resolver RVA0x2861e7c (CAI_THEATRE), first reference array
count1246, fails index1237 (0x4d5), native ID66426 (0x1037a). The serializer's
u24 payload for that entry is bytes01 03 7a; interpreting the same bytes as LE
produces7996161, the previously recorded deleted mobile BDI ID. Do not confuse
native endian/ID representation with the current JS helper's displayed values.

v45 removes exactly that confirmed dangling mobile reference from CAI_THEATRE,
on top of v44. Builder /tmp/whmm-startpos-v45/build.cjs; pack
 data/!!b_mixer_ravenqueen_removed_theatre_v45.pack.
WHMM CLI create and full-payload validation pass. Currently launched with an
automated first-error debugger; campaign result is pending at this checkpoint.
No mobile belief, generic arrays, or u16 ordinal experiments are in v44/v45.

Full dumps from earlier investigations were moved off K: to
/tmp/whmm-startpos-dumps/{model-cai-failure-v41,reader-error-v41,reader-error-v33}.dmp
because each is ~4GB. Do not copy full dumps into version artifact directories.
Debugger command scripts are /tmp/watch-wh3-resolver.ps1,
/tmp/resolver-v41.cdb, and K:/wh3-arm-cai-watch.cdb (currently v45).
Reliable workflow: watcher starts before WHMM CLI launch, waits20s after process
appears, attaches CDB, then hardware-breaks first CAI loader entry to arm precise
first-error execution breakpoints. Use -cf command files, forward-slash paths in
breakpoint command strings, and qd to detach after automated dump capture.
Do not use a data watchpoint on shared error flags: successful child reads write
zero hundreds of thousands of times, making campaign loading prohibitively slow.

## Campaign-load success — 2026-11-10 (supersedes v45 checkpoint)

The user explicitly confirmed: "successfuly loaded into campaign" for v48.
Working pack: `data/!!b_mixer_ravenqueen_removed_diplomatic_v48.pack`.
SHA256: c04c008c82aad2d1beedb95489e5f30a28bdc76f0cad65ea43e5ad7a11a0a538.
Its startpos SHA256 is db1524293639567a1c75ce551c7e45bb077330cdd252ec718ba95542e1e81b0f.
A permanent extracted copy is `startpos_investigation_final/campaign-tested-v48.esf`
in the game directory. WHMM CLI created, validated, extracted and launched it.
Launch selected only Mixer and this override, with WHMM's generated autostart pack.
Do not enable the older failed removal diagnostics alongside this pack.

Native debugging established successive root failures rather than the secondary
cleanup AV:
- v44 fixed historical-map count (809 -> 808), removing the reader overrun.
- v45 deleted the proven mobile reference in CAI_THEATRE, native ID66426,
  displayed as7996161 by the existing JS three-byte decoder.
- v46 deleted that mobile from CAI_REGION's fifth direct array. CAI_WORLD
  reference resolution then completed. Dump shows the next failure in BDI-pool
  belief resolution, caller RVA0x2619f7a, looking for that removed mobile.
- v47 removed its CAI_RESOURCE_MOBILE_MILITARY_STRENGTH_ANALYSIS group, its
  key/basic/extended resource-map triplet, and decremented resource count1246
  ->1245. Six CAI_ANALYSER reference pairs and one CAI_FACTION_MANAGER_MANAGER
  pair were deleted as COMPLETE pairs. The broad v37 integer deletion remains
  invalid and is not the implementation.
- v48 removed faction32345 from two surviving CAI_DIPLOMATIC_ANALYSIS arrays.
  Native resolver RVA0x2619668 calls0x261a2c4 for these individual-reference
  lists; a missing reference returns false. This candidate reached the campaign.

The repeated destruction crash was only an error-cleanup symptom. No executable
change was needed. Installed Warhammer3.exe remains SHA256
 d2a8a58288bf8bd86768f21ff6be036cebb1916f9c312999c60afc1abe13789f.
The original executable remains preserved. Live debugger v48 log ends with a
normal shutdown handler and contains no captured failure breakpoint.
`script_log_101126_2233.txt` records human/player faction turn start, loading-screen
dismissal, and the Empire campaign flyover, independently supporting user report.

Source fixes now live in WHMM tools/esf/src/edit/:
- removeFaction.ts: post ownership, historical count, mobile-dependent and
  schema-aware reference cleanup integration and report fields.
- caiMobileReferences.ts: only known theatre/region mobile arrays, diplomatic
  faction lists, analyser/manager complete pairs. Other arrays are untouched.
- caiMobileDependents.ts: deleted-mobile strength beliefs and both companion
  maps, with synchronized count and exact key-byte removal.
- Regression files removeFactionOwnership.test.ts (4),
  removeFactionInfluenceMap.test.ts (5), caiMobileReferences.test.ts (5),
  caiMobileDependents.test.ts (3): all17 pass. yarn esf:build passed.
  Permanent machine-readable test report:
  `startpos_investigation_final/regression-tests.json`.
README documents the positive result and remaining validation scope.

Validation scope: this specific Mixer Ravenqueen-removal campaign loads.
Save/reload, end-turn progression, other factions, and arbitrary edited startpos
files are not yet validated. No EXE patches, generic array clearing, or unproven
CAI u16 ordinal changes are needed for this successful case.

The WSL temporary directory was cleared after the successful test. Several old
full dumps that had been moved to /tmp are therefore no longer available there.
Permanent debugger logs, game packs, source fixes, and v35-v45 artifact folders
remain. Do not rely on /tmp builders/reports as permanent evidence.


## Final source-generated pack and comparison

Fresh production ESF removal completed from the original Mixer startpos. Its
structural and compressed-stream checks passed. Final pack created and fully
validated through WHMM CLI:
`data/!!b_mixer_ravenqueen_removed_verified.pack`
SHA256 f330b269261e78c5be3485bee0f96aeffb10893ab062846e7e3997e3b27fc62c.
ESF: `startpos_investigation_final/source-generated.esf`, SHA256
4641cdd96cbaa55aab6dd8db9c0f4a8d1b33dd3b5c0a0ea284b1816e33f9d31f.

The fresh source output is ten bytes shorter than v48. This is NOT simply header
padding: v48 retained one CAI_BDI_COMPONENT_BLOCK_OWNS group keyed8192769 for the
deleted mobile-strength belief. The production remover correctly deletes that
extra stale ownership row. Removing exactly that one group from v48 and writing
it produces a decompressed buffer BYTE-IDENTICAL to the fresh source output.
`comparison.json` records the passing assertion. Generated inner SHA256:
ce430c9f2fa231976b0ffb3a7e4105e33b956d3398cb8559b51400aabd9ec388.
Do not misreport the initial unequal token comparison as an unexplained source
regression; the difference was located and verified exactly.

The final source-generated pack was launched normally through WHMM CLI with only
Mixer and this override, temporary selection, intro skipping, campaign autostart,
and script logging. No debugger was attached for this final test. modified.log
confirms this pack, Mixer and WHMM's generated !!!!out.pack. New log
`script_log_101126_2314.txt` records actual human/player faction turn-start events
at98.8s, beyond native loading and initial campaign setup. A copy is preserved in
the final artifact directory. This is additional runtime evidence; the explicit
user-confirmed visible campaign map remains the v48 test. Save/reload and ending
a turn remain untested.

Build: yarn esf:build passed. All17 focused regression tests passed, with report
`regression-tests.json`. Pack report: `source-pack-validation.json`.
Keep v48 as the user-confirmed fallback. Use only one removal override with Mixer.


Final user confirmation: "campaign loaded fine" for the source-generated
`!!b_mixer_ravenqueen_removed_verified.pack` launch. The same runtime log also
records loading-screen dismissal and Empire campaign cinematic start at132.5s.
Both v48 and the final production-generated pack therefore have explicit
user-confirmed campaign-load success. Save/reload and end-turn remain untested.


## Two-faction test — 2026-11-10


Removed `ovn_alb_host_ravenqueen` and `ovn_alb_order_of_the_truthsayers`.
Input was the verified Ravenqueen-free `startpos_investigation_final/source-generated.esf`.
The production ESF CLI removed Truthsayers next, index559 / factionID561 in
that already compacted input. No territory transfer was needed. Source code
was unchanged for this test.

Final faction count808 ->806. The written file was reparsed and both keys are
absent from serialized ASCII references. The standard editor verified compacted
IDs, diplomacy/indexed data and compression. Full WHMM pack validation passed.

Pack: `data/!!b_mixer_two_albion_factions_removed.pack`
SHA2563a240e281fa684b37f07e4e447aa4bcf768d7a289c470db9ec3d9ea95b252660.
ESF SHA256fd60faefa3283aaf9fe9a84fe9062dd93db66241f7489fa84e11e14c51d4c7b4.

Artifacts in this directory: startpos.esf, removal.log, verification.json,
pack-validation.json, create-two-factions.json and verify-two-factions.cjs.

WHMM CLI launched a temporary selection of Mixer and this pack, with intro
skipping, script logging and campaign autostart. Older one-faction overrides
were excluded. Campaign result is pending at this checkpoint; do not infer
campaign success from process launch alone.


## Confirmed campaign-load success

The user reported "loaded fine" for the two-faction pack. The launch log
`script_log_101126_2332.txt` independently records human/player faction turn-start
at87.6s. Active mods were the two-faction override, Mixer, and WHMM's generated
!!!!out.pack. No debugger or executable modification was needed for this test.

Use `!!b_mixer_two_albion_factions_removed.pack` with Mixer, excluding the older
one-faction overrides. Faction count is806 and both requested faction keys are
absent from serialized node references. Save/reload and end-turn remain untested.


## All Mixer-table factions — 2026-11-11

See game-directory `startpos_all_mixer_factions/HANDOFF.md` for the current bulk-removal investigation. 254 DB keys, 247 present, expected561 survivors. Batch two-faction parity and21 focused tests pass. Full campaign result is pending. Existing two-faction success above remains the last confirmed campaign result.


## First bulk runtime fault and numeric REGION-owner fix — 2026-11-11

The initial561-faction pack passed structural/string validation but crashed
before CAI construction. Authorized CDB captured the early fault in
K:/wh3-bulk-first-failure.dmp (full-memory dump, approximately3.4GB).
Logs: live-first-failure.log, live-startup-failure.log and
offline-startup-inspection.log. Reusable debugger scripts are preserved here;
K:/wh3-bulk-start.cdb configures second-chance AV dump capture and then arms the
usual CAI checks. EXE bytes were not modified.

Fault RVA0x1d3335f dereferences a null key while province constructor0x28bfe4c
calls region grouping0x28d4fd8. Failing REGION object has regionID206,
wh3_main_combi_region_tower_of_the_stars. Its faction-owner pointer at+0x120
is null. The serialized REGION v3 direct scalar4 is still numeric owner607,
although only561 factions remain (maximum faction ID562). Original owner607
is the surviving wh3_main_cst_dread_rock_privateers, so changing only removed-faction strings
cannot fix this: EVERY surviving numeric region owner must follow ID compaction.

New tools/esf/src/edit/regionFactionIds.ts collects and rewrites exactly this
known REGION v3 owner field. It preserves unowned0 and special participant1,
compacts surviving owners, and maps removed owners to the recipient's compacted
ID. Unknown layouts or missing recipients are rejected. Both single and batch
removers call it. Shared output validation now rejects out-of-range region owners.
Five tests cover nested fields/trailing hashes, compaction, recipient compaction,
sentinel values, missing recipients, and unsupported versions. The full focused
suite now has26 cases.

Earlier one-/two-faction map-load reports did not establish territory ownership
correctness: old owner IDs could remain in range while referring to a different
faction. The earlier batch-two versus sequential-two byte equality is a valid
historical regression result BEFORE this new owner correction; it is not proof
that the old ownership fields were correct. Earlier successful packs remain
preserved; current source supersedes their numeric-owner handling.

A fresh original-input batch is generating startpos-region-owners.esf,
removal-region-owners-report.json and removal-region-owners.log. It will be
packaged and campaign-tested separately from the failed initial bulk pack.


## V3 sea-region fault and v4 candidate

V3 passed all land owner identity checks:572 regions (569 preserved,3 explicit
Couronne transfers) and341 province owner references. World loading then reached
SEA_REGION restoration and crashed in recruitment-manager base0x2a5f863, caller
0x2a60e7a ->FACTION_SEA_REGION_MANAGER loader0x29031dc. Sea41 managerUID77 still
contained old faction owner607, so its link at+0x70 was null. Dump:
K:/wh3-bulk-owner-v3-failure.dmp. Logs: live-province-owner-v3.log and
offline-v3-inspection.log. The first record value is the stable manager UID;
the second is the campaign faction ID that needs compaction.

A complete source audit found109 sea managers, version0, including3 id1 special
participants. None belongs to a removed Mixer faction. Only owner IDs need to
compact; no sea managers are deleted for this input. The shared territory-owner
collector in provinceFactionIds.ts now includes this explicit layout, preserving
nested IDs and special id1. Three additional tests cover it (34 focused cases in
total). Fresh original-input v4 output is startpos-sea-owners.esf with its own
report/log; runtime validation is pending at this checkpoint.

Identity correction to earlier notes: factionID607's original FACTION_ARRAY key
is wh3_main_cst_dread_rock_privateers. The AISLINN string observed in REGION206
is another region reference and must not be treated as the numeric owner's key.
Independent identity checks use actual FACTION_ARRAY key order, not region-name
strings, and therefore correctly preserve the current Dread Rock owner.
