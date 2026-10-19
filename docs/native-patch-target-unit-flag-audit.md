# Native target-unit flag audit

Status: expanded flag storage is blocked. The `target_unit_sets` flow template is
not runnable and must not be presented as a working template until the unresolved
native consumers and object lifetime are traced.

The supplied prototype targets the preserved original executable with SHA-256
`9bd58c63bd7fc5c9909b3d3d9b6b7a6ae4eac784369bf91a9e53c3e9f42be496`. Its v9a
handoff documents a custom name-to-ID/evaluator hook for flag `0xF2`, and a DB
unit-set lookup in the evaluator. That ID fits the stock bitset. The prototype
does not expand the flag range.

Read-only disassembly of that original image confirms these fixed-capacity sites:

| RVA                      | Observed behavior                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x61A130`               | Existing name-to-ID conversion checks its static key table and returns `0xF6` when no key matches. The prototype assigns its custom name `0xF2`.               |
| `0x2E79BAC`              | Table-loading path clears 32 bytes, converts each flag name, skips unknown `0xF6`, rejects IDs at or above `0xF8`, and sets a bit in one of four 64-bit words. |
| `0x2ED4B34`              | Flag mutator writes a bit into a fixed object field at the bitset base plus `0x768`; IDs at or above `0xF8` take the invalid-position path.                    |
| `0x2ED6C4C`              | A second mutator writes a bit at a different fixed object offset (`+0xF8` from its bitset base) and also rejects IDs at or above `0xF8`.                       |
| `0x2D91860`              | Evaluation walks IDs `0..0xF7` and reads the corresponding four qwords before invoking per-flag evaluation.                                                    |
| `0x2F10E0C`, `0x2F10ED4` | Additional direct callers of name-to-ID conversion; their full name-display and object-lifetime semantics are unresolved.                                      |

The five direct call sites to the evaluator loop found by scanning references
are at RVAs `0x2D93918`, `0x2DB49FC`, `0x30D3738`, `0x30D3A24`, and `0x30E36CC`.
They show that the stock loop is shared by multiple target-evaluation paths.

The code and handoff do not establish all constructors, insertion routes, copy
operations, destructors, serialization, or enum-to-text/UI consumers for these
flag-bearing objects. The v9a emitted-code fixtures and Windows image mapping do
not exercise those engine consumers or establish in-game behavior. Extending the
range safely needs a complete lifecycle audit and guarded hooks for every
producer and consumer, with preserved object layouts and stock behavior. No
installed executable or game file was changed during this audit.
