# Target unit sets Native Patch flow

This experimental template connects user-authored `flag` / `unit_set` rows to the
expanded target-unit native patch. It contains the real native payload and hook
definitions. Gameplay, lifecycle, persistence, and Windows unwind validation remain
outside this WHMM integration change.

Put these entries in the same mod pack:

- `target_unit_sets.experimental.wh3patchtemplate.json` at
  `whmm_patch_templates/target_unit_sets.experimental.wh3patchtemplate.json`.
- `flow.json` at `whmmflows/target_unit_sets.json`.

Open the flow in WHMM and edit **Custom Rows Input**. Replace the example strings
with your flag name and existing DB unit-set keys. Repeat a flag in several rows
to allow any of its listed unit sets. The Native Patch node's **Schema** output
defines the required columns for Custom Rows Input, whose rows feed back into
the patch's **mappings** input. No separate Custom Schema node is needed.
Connect any other table with the same
`flag` and `unit_set` string columns to the Native Patch node's **mappings** input
to author the rows elsewhere. Save Changes writes the resolved native contribution
into `target_unit_sets_mapping.pack`; enable that generated pack for launch.
Alternatively, remove the contribution connection from Native Patch to Save Changes to use it
as a terminal node. When the owning pack's flow runs at startup, WHMM applies its
contribution directly without writing a contribution pack. Keep the connection
for the existing pack export workflow.
Keep the schema connection to Custom Rows Input in either mode.
Different providers may add flags; providers defining the same flag must agree on
its complete set of unit-set keys.

The mapping does not create database flag definitions, ability bindings, unit sets,
or their membership rows. Supply those through normal DB content. Stock enum names
retain stock behavior. The legacy custom name remains ID 242; additional custom
names are assigned IDs from 248 in ASCII order.

The template has no whole-executable hash requirement. WHMM checks the expected
original bytes at every hook before activation, allowing unrelated executable
changes. Hook addresses and game object layouts remain build-specific; this does
not establish compatibility with arbitrary game updates. An offline patch such as
v9c that already changes these hook sites will fail the byte checks. Patches apply
only at process startup.

To regenerate pack-ready files from the upstream native sources:

```sh
python3 -B tools/nativePatchPackages/export_target_unit_sets.py
```

The command writes under ignored `native-patches/target-unit-sets/`. Pack only its
`whmm_patch_templates/` and `whmmflows/` contents. Its report and CFI output are
export diagnostics. The preserved supported original is still used as the build
input; its hash in the report records provenance rather than a runtime requirement.
The command neither edits the game installation nor launches the game.
The checked-in template was generated with a 100,000-row capacity; its template
ID and version are derived from the native package (`wh3.target-unit-sets`,
`0.1.0`). See `--help` for source, analysis dependency, capacity, and output paths.
