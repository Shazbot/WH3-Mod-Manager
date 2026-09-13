# AGENTS.md

Be concise and token-conscious. Avoid unnecessary repository exploration, repeated file reads, and unrelated changes.

## Delegation

When acting as an orchestrator, delegate implementation to Luna Max when Luna is capable of completing the task reliably.

Keep difficult architectural decisions, ambiguity resolution, and unusually complex or high-risk work with the orchestrating agent when that is likely to produce a better result.

When delegating:

* Use `fork_turns="none"` by default.
* Give the worker a compact, self-contained task with the goal, constraints, acceptance criteria, and relevant file hints.
* Avoid duplicate repository exploration between the parent and worker.
* Normally use one implementation worker.
* Keep delegation and worker summaries concise.

When given an implementation task directly, implement it yourself by default. Do not spawn another agent merely because the task is non-trivial.

Spawn additional agents only when the user explicitly requests orchestration or independent parallel work clearly provides a benefit.

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
