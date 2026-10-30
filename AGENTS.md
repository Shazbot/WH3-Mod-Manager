# AGENTS.md

Be concise and token-conscious. Avoid unnecessary repository exploration, repeated file reads, and unrelated changes.

## Delegation

Only delegate implementation work when operating in Plan mode.

When in Plan mode:

- Keep planning, architectural decisions, and ambiguity resolution with the parent agent.
- Delegate implementation to Luna Max when Luna is capable of completing the task reliably.
- Use `fork_turns="none"` by default.
- Give Luna a compact, self-contained task with the goal, constraints, acceptance criteria, and relevant file hints.
- Avoid duplicate repository exploration between the parent and Luna.
- Normally use one Luna Max implementation worker.
- Keep delegation and worker summaries concise.

When not in Plan mode:

- Implement the task directly.
- Do not spawn implementation subagents.

Only use additional subagents for genuinely independent parallel work when the user explicitly requests it.

## UI and UX

For any UI or UX work, read `docs/DESIGN.md` before making changes.

`docs/DESIGN.md` is the authoritative visual and interaction design specification.

Follow it unless the task explicitly requests behavior or design that conflicts with it.

Do not modify `docs/DESIGN.md` unless the task explicitly requests a design-system change.

For non-UI work, do not read `docs/DESIGN.md` unless relevant.

## Subsystem documentation

Before exploring code for these areas, read the matching doc in `docs/`:

- `IPC.md`: main ↔ renderer channels by feature, message conventions, adding a channel.
- `FLOWS.md`: node-graph flows: format, node catalogue, manual vs launch execution, adding a node type.
- `CACHES.md`: every disk and memory cache: location, key, invalidation, adding a cache.
- `WH3_ASSET_HOST.md`: WH3AssetHost pipe protocol, optimize/check modes, versioning.
- `HEADLESS.md`: headless CLI and MCP pack tools.
- `NATIVE_PATCHES.md`: native patch manifests, flow templates, launch behaviour.
- `REACT_COMPILER.md`: React Compiler setup, what stops a component compiling and how to fix it, opt-outs, `yarn check:react-compiler`.

When a change alters what one of these docs describes, update the doc in the same change.

## Codebase Memory MCP

Use Codebase Memory MCP for architecture discovery and persistent project knowledge.

- At task start, consult `manage_adr(mode="get")` when architectural context is relevant.
- Use `get_architecture` and targeted graph queries to locate subsystems, entry points, dependencies, and callers before broad filesystem searches.
- Check `index_status` when freshness is uncertain. Verify important findings against source code, which takes precedence over stored memory.
- Do not reindex unnecessarily.

## Maintaining architectural memory

- After changes affecting subsystem responsibilities, interfaces, data flows, dependencies, or architectural constraints, update the relevant ADR sections.
- The ADR is over 8,000 characters, so `manage_adr(mode="set_sections")` is rejected ("merged ADR exceeds 8000 chars"). Read it with `manage_adr(mode="get")`, edit only the relevant sections, and write the whole document back with `manage_adr(mode="update")`. If the ADR ever drops below that size, `set_sections` works again; section names are bare headings such as `"STACK"`, without `##`.
- Preserve unrelated sections and valid historical decisions. Clearly supersede obsolete information.
- Record verified behavior, relevant source paths, and known design rationale. Do not invent historical decisions.
- Skip memory updates for changes that do not affect architecture.
- After major branch switches or merges, verify that the index and architectural memory reflect the current branch.
- Treat version-controlled architecture documentation as authoritative over CBM's local ADR.

## Implementation

- Follow existing project patterns and conventions.
- Make the smallest clean change that solves the task.
- Prefer targeted repository exploration over broad exploration.
- Avoid unrelated refactors, unnecessary abstractions, and new dependencies.
- Preserve existing behavior unless the task requires changing it.
- Run targeted tests or checks appropriate to the change.
- Prefer targeted validation over expensive full-project checks when sufficient.

Use native Windows Git for this repository, ideally from PowerShell or Windows Terminal.
(located in /mnt/c/Program Files/Git/cmd/git.exe)

## Pack inspection and automation

Use WHMM�s headless tools for inspecting, querying, editing, comparing,
validating, and subsetting WH3 pack files.

Documentation: /mnt/k/projects/whmm/docs/HEADLESS.md

Prefer the WHMM MCP tools when available. Otherwise invoke the CLI:
node /mnt/k/projects/whmm/dist/cli/main.js --help

If the tooling is missing or its source changed, build from the WHMM repo:
cd /mnt/k/projects/whmm
yarn build:tools

- Use --format json for machine-readable CLI results.
- Use explicit input packs and load order.
- Write modified packs to a separate output path.
- Validate generated packs before reporting success.
- Use pagination or explicit reports for large results.
- Inspect incomplete/unsupported coverage before relying on dependency graphs.
- Do not write one-off pack parsers when these tools support the operation.
- Use Node and native dependencies installed for the current platform.

Reuse src/packCore and src/automation when implementing pack functionality.
Keep CLI and MCP as adapters over the shared operation registry.
Rebuild the tools after changing their source before testing through the CLI.

## WSL2 Windows Filesystem Performance

Windows-mounted paths (`/mnt/c`, `/mnt/k`, etc.) are slow to traverse from WSL2. Prefer Windows-native tools for filesystem searches:

- **`es.exe` (Everything):** Indexed filename and directory searches. (located at K:\tools\es.exe)
- **`rg.exe` (Windows ripgrep):** File content searches and ignore-aware file discovery.
- **Windows Coreutils (`ls.exe`, `find.exe`):** Directory listing and traversal when needed.
- **`git ls-files`:** Fast discovery of tracked repository files.

Convert WSL paths using `wslpath -w` before passing them to Windows tools:

```bash
WIN_DIR="$(wslpath -w "$PWD")"

es.exe -path "$WIN_DIR" -n 100 'ext:cs'
rg.exe -n 'someFunction' "$WIN_DIR"
ls.exe "$WIN_DIR"
```

Avoid recursive Linux `find`, `ls`, and `grep` on Windows mounts. Use normal Linux tools for WSL-native paths. Fall back when Windows tools are unavailable. Everything results may include ignored files and depend on its index being current.

## Shell output efficiency

Minimize unnecessary tool output to conserve context tokens.

- Keep exploratory shell output under ~100 lines by default.
- Prefer targeted `rg -n` searches with scoped paths and file globs.
- Use `rg --files` for file discovery instead of recursive directory listings.
- Avoid dumping large files; use targeted line ranges instead.
- For large logs, search for errors/warnings and inspect summaries.
- Use `git diff --stat` before inspecting targeted diffs.
- Save verbose command output to a temporary file when needed, then inspect relevant sections.
- Avoid repeating searches or rereading unchanged content.
- Increase output limits when completeness is necessary.
- Never hide failures or lose command exit codes through output filtering.

## Vanilla game files

If you need to reference vanilla game files you can find them extracted in K:/projects/wh3dump/ , the shaders branch in the folder has material shaders the game uses.

asset editor that builds the WH3AssetHost.exe is located in K:\projects\assedFork
Warhammer 3 is located in K:\SteamLibrary\steamapps\common\Total War WARHAMMER III
