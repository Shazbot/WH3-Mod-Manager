# Native patches

WHMM discovers native patch manifests at `whmm_patches/**/*.wh3patch.json` inside
enabled `.pack` files, including manifests directly inside `whmm_patches/`.
It reads the physical packs used for launch after staging, merging, overwrites,
and flow replacements.

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

## Format versions

The loader version is `2.1.0`. The original format-v1 contract is supported with
its mandatory exact `target.sha256` and module-relative addresses. Structural
schemas are available at:

- [Format v1](../src/nativePatches/schema-v1.json)
- [Format v2](../src/nativePatches/schema-v2.json)

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

The usual launch path is used when no native patches are discovered. Parameter
defaults are materialized before activation; this initial implementation has no
parameter editor or live patch controls.

## Limits and validation

Limits are 8 MiB per manifest, 64 MiB across discovered manifests, 64 MiB per
block, 512 MiB across selected block storage, and 256 selected packages. Zero
blocks count toward storage limits. Compressed pack entries are decoded with
output limits.

Loader tests, native startup harnesses, and in-game feature tests verify different
things. A successful loader or harness run does not establish gameplay behavior
or compatibility with an untested game update.
