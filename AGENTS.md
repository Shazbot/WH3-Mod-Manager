# AGENTS.md

Be concise and token-conscious. Avoid unnecessary repository exploration, repeated file reads, and unrelated changes.

## Delegation

Only delegate implementation work when operating in Plan mode.

When in Plan mode:

* Keep planning, architectural decisions, and ambiguity resolution with the parent agent.
* Delegate implementation to Luna Max when Luna is capable of completing the task reliably.
* Use `fork_turns="none"` by default.
* Give Luna a compact, self-contained task with the goal, constraints, acceptance criteria, and relevant file hints.
* Avoid duplicate repository exploration between the parent and Luna.
* Normally use one Luna Max implementation worker.
* Keep delegation and worker summaries concise.

When not in Plan mode:

* Implement the task directly.
* Do not spawn implementation subagents.

Only use additional subagents for genuinely independent parallel work when the user explicitly requests it.

## UI and UX

For any UI or UX work, read `docs/DESIGN.md` before making changes.

`docs/DESIGN.md` is the authoritative visual and interaction design specification.

Follow it unless the task explicitly requests behavior or design that conflicts with it.

Do not modify `docs/DESIGN.md` unless the task explicitly requests a design-system change.

For non-UI work, do not read `docs/DESIGN.md` unless relevant.

## Implementation

* Follow existing project patterns and conventions.
* Make the smallest clean change that solves the task.
* Prefer targeted repository exploration over broad exploration.
* Avoid unrelated refactors, unnecessary abstractions, and new dependencies.
* Preserve existing behavior unless the task requires changing it.
* Run targeted tests or checks appropriate to the change.
* Prefer targeted validation over expensive full-project checks when sufficient.
