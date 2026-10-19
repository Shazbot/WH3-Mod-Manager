# Native patches

WHMM discovers native patch manifests at `whmm_patches/**/*.wh3patch.json` inside
enabled `.pack` files, including manifests directly inside `whmm_patches/`.
It reads the physical packs used for launch after staging, merging, overwrites,
and flow replacements.

Flow-driven native patches use declarative templates in
`whmm_patch_templates/**/*.wh3patchtemplate.json`. A flow selects a validated
template, binds its declared inputs, and sends an inspectable contribution through
the normal Save Changes node. Templates contain no build scripts or executable
replacement logic.

Patches change the new game process's memory. They do not rewrite `Warhammer3.exe`.
Enabling, disabling, or updating a patch requires a new game process.

## Package selection and payloads

For each case-sensitive `package.id`, WHMM selects the highest SemVer precedence
across all discovered files, including files with identical virtual paths in
different packs. Equal versions use normal pack priority; within one pack the
ordinally first normalized manifest path wins. SemVer build metadata does not
increase version precedence. Dependencies must match the selected package's
declared version exactly; selection does not downgrade a package to satisfy a
dependency.

An external block payload is relative to its manifest's directory and must exist
in that same physical pack. For example:

```text
whmm_patches/officer_dead.wh3patch.json
whmm_patches/officer_code.bin
```

Another pack cannot replace `officer_code.bin` for this manifest. Companion
`assets`, in contrast, are checked against effective game content using normal
load order. Asset declarations do not create or modify pack entries.

Payload hashes, exact sizes, and expected original bytes remain mandatory as
specified by the format. Selected packages abort launch on failure unless they
declare a different failure policy.

## Failure policy

Loader 2.1.0 adds an optional root field in both format versions:

```json
{ "on_failure": "abort" }
```

| Value    | When the patch fails                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| `abort`  | Abort launch. This is the default when the field is omitted.                                              |
| `warn`   | Skip the whole package, warn the user, and continue launching.                                            |
| `silent` | Skip the whole package and continue without a user warning. Diagnostic logs may still record the failure. |

Use `requires_loader.min_version: "2.1.0"` when relying on this field. It applies
to package validation, payloads, required assets, target hashes, address lookup,
guards, relocations and activation. The highest selected version is skipped as
a package; the loader does not downgrade to a lower version. Dependencies on a
skipped package are failures governed by each dependent package's own policy.

If native startup fails, the helper first terminates that startup process. WHMM
then starts a fresh process with the failed optional package removed. If no
packages remain, WHMM uses the normal launch path. Shared helper failures can
remove all optional packages before retrying required packages. It never releases
a process with a partially applied package.

Unreadable manifests, invalid JSON/duplicate keys and unrecognized policy values
cannot provide a trustworthy continue policy and still abort. Unconfirmed
termination or an already committed release also prevents automatic retry;
the manager reports the uncertain startup state instead of starting another game.
An existing helper session also remains an error, preventing duplicate launches.

## Flow-driven native patches

The Native Patch flow node lists valid templates from the flow's owning pack or a
selected enabled pack. Pack selection is stored by pack name, so a copied flow
does not retain an author's absolute workshop path. A template can declare scalar
inputs (`bool`, `u32`, `i32`, `f32`, or `ascii_key_list`) and bounded table
inputs. Scalar controls use manifest defaults and can bind to compatible flow
options. Table input IDs create named `TableSelection` sockets; rows must provide
the declared column names and types. `table_name` is a display label, while
column names define the accepted table shape.

Table declarations choose a `group_by` column and a `value_column`. Duplicate
group/value rows are removed. When several flows or mods provide the same
template, they can add different groups. Providers of the same group must declare
the same sorted set of values; otherwise launch fails and names both providers.
For a target that treats repeated flags as OR-ed sets, author each flag/unit-set
pair explicitly in normal flow nodes. Empty table inputs produce no contribution
package and do not activate template defaults.

Template format `wh3-native-patch-template` version 1 and contribution format
`wh3-native-patch-contribution` version 1 are strict JSON contracts. A template
binds each declared input to one unique scalar or table parameter in its native
patch manifest. Scalar-only templates may use native manifest versions 1 or 2;
table inputs require manifest version 3 and `table-parameters.v1`. A v1 table
binding must use the manifest table's two columns as one
`group_by`/`value_column` pair; source tables need those named columns, while
other source columns and the physical source table name do not affect binding.
Keys are case-sensitive. Repeated rows for one group form that group's value
set, and duplicate pairs are removed. Across providers, a group is accepted only
when every provider supplies the same sorted value set.

Each template is limited to 8 MiB. Table declarations are bounded by the native
parameter capacity and `max_rows`; all table inputs together are limited to
100,000 rows and resolved scalar/table inputs to 64 MiB per contribution. The
serialized contribution is limited to 160 MiB. Table destinations are validated
against block bounds and overlap rules before launch. Numeric and boolean table
cells each occupy a four-byte stride; a boolean stores 0 or 1 in its first byte
and leaves the following three bytes zero.

The node emits a raw file under `whmm_patch_contributions/v1/`, carrying the
validated template, hashed payload bytes, resolved input values, and flow/node
provenance. Save Changes writes that file into its output pack. At launch WHMM
reads contributions from the final enabled packs after flow generation, verifies
them again, and combines matching template versions into one package before
checking conflicts with standalone patches. Malformed templates, incompatible
versions, conflicting group definitions, standalone package ID collisions, and
input capacity errors fail launch before standalone `on_failure` retry handling.
Failures during native block and runtime preparation can still follow the
manifest's `on_failure` policy. An enabled startup flow containing a Native
Patch node also aborts launch if that graph fails upstream of the node, at the
node, or downstream while saving its contribution. Disabled or pruned nodes are
skipped.

Templates and their payloads must be pack entries under
`whmm_patch_templates/`; file payloads are relative to the template's folder.
Template discovery validates declarations but never activates them. The flow
node reads only the selected template and its declared payloads; it does not run
scripts or replace the game's executable.

The [data-only example](examples/native-patch-flow/) shows a flow that authors
mapping rows with Custom Schema and Custom Rows nodes and passes them through a
template. It has no hook or write site and produces no gameplay change. It
documents the input plumbing only. The requested `target_unit_sets` expansion is
blocked pending the complete native object lifecycle audit described in the
[target-unit flag audit](native-patch-target-unit-flag-audit.md); no runnable
template is included for it.

## Format versions

The loader version is `2.2.0`. The original format-v1 contract is supported with
its mandatory exact `target.sha256` and module-relative addresses. Structural
schemas are available at:

- [Format v1](../src/nativePatches/schema-v1.json)
- [Format v2](../src/nativePatches/schema-v2.json)
- [Format v3](../src/nativePatches/schema-v3.json)

The schemas describe structure. The loader additionally validates SemVer,
capabilities, paths, references, source hashes, lengths, instruction displacement
ranges, overlaps, dependencies, claims, and allocation/protection constraints.
Unknown fields are rejected outside `extensions`. Duplicate JSON keys are errors.

Format v2 retains the v1 fields and adds:

- Optional `target.sha256`. If present, it must match. If omitted, unrelated changes
  to the executable do not cause a whole-file hash rejection.
- A `signatures` array, which may be empty. Each signature has `id`, `module:
"game"`, `pattern`, and optional `scope` (`"executable"` by default, or
  `"readable"`). Patterns contain space-separated hexadecimal bytes and `??`
  wildcards. Each must match exactly once in the selected mapped PE sections.
- Signature address references, such as `{ "signature": "hook", "offset": 0 }`.
  The optional offset is a signed integer relative to the matching address.
- Derived relative addresses, which decode an existing signed `rel8` or `rel32`
  operand. Both the operand offset and the full instruction-end offset are
  explicit; this also handles RIP-relative operands with trailing immediates.

Packages using signatures or derived references must declare `signatures.v2` in
`requires_loader.capabilities`. Existing capabilities are `blocks.v1`,
`fixups.v1`, `win64-unwind.v1`, and `startup-activation.v1`.

Example v2 address declarations (illustrative patterns, not a verified WH3 patch):

```json
{
  "signatures": [
    {
      "id": "call_site",
      "module": "game",
      "pattern": "E8 ?? ?? ?? ?? 84 C0 75 ?? 48 8B",
      "scope": "executable"
    }
  ],
  "symbols": {
    "hook": { "signature": "call_site", "offset": 0 },
    "original_callee": {
      "relative": {
        "from": { "signature": "call_site" },
        "kind": "rel32",
        "operand_offset": 1,
        "instruction_end_offset": 5
      }
    }
  }
}
```

This fragment belongs inside a complete v2 manifest. Write sites can use the
resolved `hook` symbol, while fixups can target `original_callee`.

Format v3 retains v2 and adds bounded `table` parameters. `ascii_key_list` is
also supported in formats v1 and v2, so scalar-only templates need not use v3.
The loader requires `table-parameters.v1` for table storage. Each table declares
named typed columns plus `count_at` and `entries_at` destinations in a validated
block. ASCII cells occupy `max_bytes + 1` bytes including a zero terminator;
numeric and boolean cells use four-byte slots, with boolean values stored in the
first byte and three zero padding bytes. All destinations participate in block
bounds, overlap, and capacity validation before launch.

## Compatibility across game updates

An RVA is relative to the loaded executable base, so it already handles ASLR.
It does not follow code that a game update moves inside the image. Signatures
handle that movement when their identifying patterns remain unique.

When migrating a package to v2, update **every** version-sensitive module
reference, including return destinations, called functions, data references,
guards, and original unwind parents. Keep exact expected bytes at write sites.
A matching signature and unchanged hook bytes do not prove that object layouts,
calling conventions, or the surrounding game behavior remain compatible.

## Startup and platforms

Windows uses the bundled x64 startup helper. Linux runs that helper through
Protontricks using WH3 Steam app ID `1142710` and the game's Proton environment.
Native and Flatpak Protontricks installations are supported. Missing prerequisites
produce a launch error when native patches are selected.

The helper holds startup while preparing payloads, relocations, protections, and
in-process unwind registration. It verifies original bytes again before activation
and waits for WHMM's release acknowledgement. Startup failure or cancellation
aborts the newly created process. It does not attach patches to an already running
game.

The usual launch path is used when no native patches are discovered. Scalar and
table parameter values are validated and materialized before activation; native
patch parameters do not expose live in-game controls.

## Limits and validation

Limits are 8 MiB per manifest/template, 64 MiB across discovered manifests,
64 MiB per block, 512 MiB across selected block storage and contributions, 160
MiB per encoded contribution, 64 MiB of resolved table/scalar inputs per
contribution, and 256 selected packages. Zero blocks count toward storage limits.
Compressed pack entries are decoded with output limits.

Loader tests, native startup harnesses, and in-game feature tests verify different
things. A successful loader or harness run does not establish gameplay behavior
or compatibility with an untested game update.
