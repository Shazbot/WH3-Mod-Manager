# AGENTS.md

Be concise and token-conscious. Avoid unnecessary repository exploration, repeated file reads, and unrelated changes.

## Model Routing

Use the root agent primarily for orchestration, architectural decisions, ambiguity resolution, and review.

For non-trivial implementation work:

If the root agent is not already Luna Max, delegate implementation to Luna Max.
Use fork_turns="none" by default.
Give the worker a compact, self-contained task with the goal, constraints, acceptance criteria, and relevant file hints.
Avoid duplicate repository exploration between the root agent and worker.
Normally use one implementation worker.

If the root agent is already Luna Max:

Implement the task directly.
Do not spawn another Luna agent merely to perform the same implementation.
Spawn subagents only when independent or parallel work would clearly help.

Trivial changes may be implemented directly when delegation would cost more than it saves.

After delegated implementation, review the worker summary, diff, and test results. If corrections are needed, give the worker a narrow follow-up task rather than restarting the work.

## UI and UX

For any UI or UX work, read `docs/DESIGN.md` before making changes.

`docs/DESIGN.md` is the authoritative visual and interaction design specification.

Follow it unless the task explicitly requests behavior or design that conflicts with it.

Do not modify `docs/DESIGN.md` unless the task explicitly requests a design-system change.

For non-UI work, do not read `docs/DESIGN.md` unless relevant.

## Implementation

* Follow existing project patterns and conventions.
* Make the smallest clean change that solves the task.
* Avoid unrelated refactors, unnecessary abstractions, and new dependencies.
* Preserve existing behavior unless the task requires changing it.
* Run targeted tests/checks appropriate to the change.
* Prefer targeted validation over expensive full-project checks when sufficient.
