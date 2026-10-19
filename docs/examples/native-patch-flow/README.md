# Data-only Native Patch flow example

This example demonstrates the flow input format only. Its template reserves a
table in a zero-filled block but declares no signature, hook, fixup, or write
site, so it has no gameplay effect. Do not install it as a feature patch.

To inspect the editor flow, put `flow.json` at `whmmflows/example_native_mapping.json`
and `data-only.wh3patchtemplate.json` at
`whmm_patch_templates/data-only.wh3patchtemplate.json` in a test pack. The flow
authors a pair of example rows with Custom Schema and Custom Rows, connects them
to the template's `mappings` socket, and saves the resulting contribution. The
strings `example_flag` and `example_unit_set` are placeholders, not WH3 database
keys.

The `target_unit_sets` template is intentionally absent. Its requested expanded
flag storage remains blocked until the game object's construction, copying,
insertion, naming, evaluation, and destruction paths are audited and every safe
hook is established. See the [audit](../../native-patch-target-unit-flag-audit.md).
