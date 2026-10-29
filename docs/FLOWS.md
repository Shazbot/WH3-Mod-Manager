# Flows

A **flow** is a node graph that reads DB tables and pack files, transforms them, and writes the result into a new pack. Modders build flows in the node editor and ship them inside their packs. When a player launches the game with such a mod enabled, WHMM runs those flows and loads the packs they produce.

This document covers the saved format, the node catalogue, how options work, both execution paths, the launch cache, and the link to native patches.

## Where the code is

| Part                     | Files                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor UI (renderer)     | `src/components/NodeEditor.tsx` (mounted from `Main.tsx` and `viewer/ModsViewer.tsx`), `src/nodeGraph/nodes/renderers.tsx` (one component per node type), `nodeTypes.tsx`, `editorState.ts`, `FlowOptionsModal.tsx` (author defines options) |
| Node catalogue           | `src/nodeGraph/nodeRegistry.ts` (defaults, labels, sidebar sections), `src/nodeGraph/nodes/types.ts` (per-node data types), `FlowNodeType` and `NodeEdgeTypes` in `src/index.d.ts`                                                           |
| Wiring rules             | `src/nodeGraph/connectionRules.ts` (`isConnectionAllowed`, `applyConnection`)                                                                                                                                                                |
| Saved format             | `src/nodeGraph/types.ts` (`SerializedNodeGraph`), `src/nodeGraph/graphSerialization.ts` (serialize, deserialize, and `prepareGraphForExecution` for manual runs)                                                                             |
| Packed flows             | `src/nodeGraph/flowPackOperations.ts` (`whmmflows\` naming)                                                                                                                                                                                  |
| Execution (main process) | `src/nodeGraphExecutor.ts` (`executeNodeGraph`: scheduling and branch pruning), `src/nodeExecutor.ts` (`executeNodeAction`: one `case` per node type, about 9k lines), `src/flowExecutionSupport.ts` (`FlowExecutionContext`, debug logging) |
| Launch-time runs         | `prepareFlow` and `executeFlowsForPack` in `src/packFileSerializer.ts`, called from the `startGame` handler in `src/ipcMainListeners.ts`                                                                                                     |
| End-user options         | `src/components/UserFlowOptionsModal.tsx` (opened from `ModRows.tsx`), stored as `userFlowOptions` in the app config                                                                                                                         |
| Native patch node        | `src/nativePatches/flowTemplate.ts`, `src/nodeGraph/nativePatchSchema.ts`; behaviour is specified in `docs/NATIVE_PATCHES.md`                                                                                                                |

## Saved format

A flow inside a pack lives at `whmmflows\<name>.json`. `normalizePackedFlowName` adds the prefix and the `.json` extension, and rejects names containing `..` or starting with `\`. The JSON is a `SerializedNodeGraph`:

```ts
{
  version: "1.0",
  timestamp: number,
  nodes: SerializedNode[],              // { id, type, position?, data: { label, type, isDisabled?, ...node fields } }
  connections: SerializedConnection[],  // { id, sourceId, targetId, sourceType?, targetType?, sourceHandle?, targetHandle? }
  options: FlowOption[],                // author-defined options, see below
  metadata: { nodeCount, connectionCount },
  isGraphEnabled: boolean,              // whether players get an on/off switch for this flow
  graphStartsEnabled: boolean,          // that switch's default
}
```

`deserializeNodeGraph` only checks that `nodes` and `connections` exist. The version string is not used for migration.

Node `data` is a flat bag of optional fields shared by all node types; see `SerializedNode` in `types.ts`. `serializeReactFlowNodes` copies an explicit list of those fields, so **a field missing from that function is silently dropped on save**.

Saving from the editor:

- `saveNodeFlow` stages the flow as an unsaved file in the pack that is open in the viewer. It is written when that pack is saved.
- `saveFlowToPack` writes the flow straight into a pack on disk. It refuses to overwrite an existing flow unless asked.

## Edge data types

Every input and output socket carries one of the `NodeEdgeTypes` (`src/index.d.ts`):

| Type                                | Carries                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `PackFiles`                         | A set of packs to read from                            |
| `TableSelection`                    | DB/LOC tables with their rows                          |
| `ColumnSelection`                   | Selected columns of tables                             |
| `ChangedColumnSelection`            | Edited column values, ready to save                    |
| `IndexedTable`                      | A table indexed by key columns, for lookups            |
| `NestedTableSelection`              | Rows with nested child rows, e.g. from a nested lookup |
| `DBData`                            | Raw DB data                                            |
| `Text`, `Text Lines`, `GroupedText` | Text output for the text nodes                         |

`connectionRules.ts` decides which handle may connect to which, and updates schema-dependent node data when a connection is made.

## Node catalogue

There are 47 node types, grouped as they appear in the editor sidebar (`nodeRegistry.ts`). The descriptions are the registry's own fallback strings.

| Section              | Type id                   | Label                       | What it does                                                                         |
| -------------------- | ------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Pack input           | `allenabledmods`          | All Enabled Mods            | Outputs all currently enabled mods as PackFiles                                      |
|                      | `packfilesdropdown`       | Pack Dropdown Input         | Picks a pack from a dropdown                                                         |
|                      | `packedfiles`             | Pack Textbox Input          | Outputs the PackFiles named in a textbox                                             |
|                      | `removepacksource`        | Remove Pack Source          | Removes one pack from incoming pack sources                                          |
| Packed Files         | `edittextfile`            | Edit Text File              | Edits lua and xml files by selector, literal text or regex; can chain earlier edits  |
|                      | `editxmlfile`             | Edit XML File               | Edits one exact XML element chosen by a structural locator                           |
|                      | `packfileoperations`      | Move Or Copy Files          | Copies, moves, renames or deletes files, writing a copy of the pack with the changes |
| Table Selection      | `referencelookup`         | Reference Lookup            | Finds rows in tables the input table references                                      |
|                      | `reversereferencelookup`  | Reverse Reference Lookup    | Finds rows in tables that reference the input table                                  |
|                      | `tableselectiondropdown`  | Table Dropdown Input        | Picks a table from a dropdown                                                        |
|                      | `tableselection`          | Table Textbox Input         | PackFiles → TableSelection                                                           |
| Table Rows Filtering | `deduplicate`             | Deduplicate Rows            | Removes duplicate rows                                                               |
|                      | `filter`                  | Filter                      | Filters rows with AND/OR conditions                                                  |
|                      | `multifilter`             | Multi-Filter                | Splits rows by column values into several outputs                                    |
|                      | `removetables`            | Remove Tables               | Passes its input through with the named tables dropped                               |
| Control Flow         | `conditionalbranch`       | Conditional Branch          | Sends rows down one branch, chosen by a checkbox or radio flow option                |
| Localisation         | `editloctext`             | Edit Loc Text               | Changes the text of loc rows whose key starts with a given prefix                    |
| Column Selection     | `columnselectiondropdown` | Column Dropdown Input       | Picks a column from a dropdown                                                       |
|                      | `columnselection`         | Column Textbox Input        | TableSelection → ColumnSelection                                                     |
| Processing           | `numericadjustment`       | Numeric Adjustment          | ColumnSelection → ChangedColumnSelection                                             |
|                      | `mathceil`                | Math Ceil                   | Rounds changed values up                                                             |
|                      | `mathmax`                 | Math Max                    | `Math.max(value, input)` on changed values                                           |
|                      | `mergechanges`            | Merge Changes               | Merges several ChangedColumnSelection inputs into one                                |
|                      | `onnx`                    | ONNX Prediction             | Runs packed bundle or standalone ONNX inference and writes enabled table outputs    |
|                      | `savechanges`             | Save Changes                | Writes the result to a pack (see Outputs below)                                      |
| Text                 | `appendtext`              | Append Text                 | Adds text before and after                                                           |
|                      | `groupbycolumns`          | Group By Columns (For Text) | TableSelection + two columns → GroupedText                                           |
|                      | `groupedcolumnstotext`    | Grouped Columns to Text     | Formats GroupedText using a pattern and join separator                               |
|                      | `textjoin`                | Text Join                   | Text Lines → Text                                                                    |
|                      | `textsurround`            | Text Surround               | Wraps Text or Text Lines in surrounding text                                         |
| Table Operations     | `addnewcolumn`            | Add Or Transform Columns    | Adds derived columns or transforms existing ones, optionally only on matching rows   |
|                      | `aggregatenested`         | Aggregate Nested            | min/max/sum/avg/count over nested arrays                                             |
|                      | `combinesametables`       | Combine Same Tables         | Merges entries for the same table into one, keeping every row                        |
|                      | `deepclone`               | Deep Clone                  | Clones rows and the tables they reference, optionally into several variants          |
|                      | `dumptotsv`               | Dump to TSV                 | Exports table data to a TSV file for inspection                                      |
|                      | `extracttable`            | Extract Table               | Keeps columns with a prefix and removes the prefix                                   |
|                      | `flattennested`           | Flatten Nested              | Expands nested selections into flat rows                                             |
|                      | `generaterows`            | Generate Rows               | Creates new rows with transformations and several outputs                            |
|                      | `getcountercolumn`        | Get Counter Column          | Collects numeric column values across tables                                         |
|                      | `groupby`                 | Group By                    | SQL-like GROUP BY with aggregations                                                  |
|                      | `indextable`              | Index Table                 | Indexes a table by key columns for fast lookups                                      |
|                      | `lookup`                  | Lookup (Join)               | Joins indexed tables (inner, left, anti, nested, cross)                              |
| Custom schema        | `customrowsinput`         | Custom Rows Input           | Rows typed in by hand against a custom schema                                        |
|                      | `customschema`            | Custom Schema               | Defines a table schema: column names and types                                       |
|                      | `generaterowsschema`      | Generate Rows (Schema)      | Generates rows from a custom schema over a counter range                             |
|                      | `readtsvfrompack`         | Read TSV From Pack          | Reads a TSV file from a pack using a custom schema                                   |
|                      | `nativepatch`             | Native Patch                | Builds a validated native patch contribution from a template and table inputs        |

## Options

An author declares options on the flow (`FlowOptionsModal.tsx`). Players set them per mod and per flow in `UserFlowOptionsModal`. The values are saved in the app config as `userFlowOptions[packName][flowFileName] = { optionValues: { [optionId]: value }, graphEnabled? }`.

| Option type | Value                         | Typical use                                                                                                |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `textbox`   | string                        | Free text substituted into node fields                                                                     |
| `multiline` | newline-separated list        | The Filter node reads it as "any of these values"; native patch `ascii_key_list` inputs                    |
| `range`     | number (`min`, `max`, `step`) | Numeric parameters                                                                                         |
| `checkbox`  | boolean                       | Drives a Conditional Branch                                                                                |
| `radio`     | id of the chosen choice       | Drives a Conditional Branch. An unknown stored id falls back to the first choice (`resolveRadioChoiceId`). |

Options reach nodes in three ways:

1. **Placeholders.** Each `{{optionId}}` is replaced by the player's value (or the default) in:
   - the text fields listed in `flowOptionTextFields`: `textValue`, `pattern`, `beforeText`, `afterText`, `joinSeparator`, `packName`, `packedFileName`, `filePath`, `replacementXml`
   - each transformation's `transformationOptionFields`
   - nested rule fields of `filter`, `editloctext`, `edittextfile`, `editxmlfile` and `deepclone`
2. **Conditional Branch** binds to one checkbox or radio option with `selectedFlowOptionId`.
3. **Native Patch** binds template scalar inputs to options with `scalarOptionBindings`. A `multiline` value is split into a list.

If `isGraphEnabled` is set, players can switch the whole flow off (`graphEnabled: false`), and a launch then skips it.

## Two ways a flow runs

### Manual run (editor)

1. `NodeEditor.tsx` calls `prepareGraphForExecution` (`graphSerialization.ts`). This applies option values and other runtime fills in the renderer.
2. The editor invokes IPC `executeNodeGraph`.
3. The main process creates a fresh `FlowExecutionContext` and calls `executeNodeGraph`. Per-node results go back to the editor, which uses them for previews.

A manual Save Changes writes to the game's **`data`** folder, and can open the result in Explorer or the viewer.

When the flow being edited is a `whmmflows\` file of an open pack, that pack is the flow's "source pack", and nodes can leave it out of their inputs (`ignoreFlowSourcePack`).

### Launch run (`startGame`)

When the player starts the game, the `startGame` handler in `ipcMainListeners.ts` does the following:

1. Finds the enabled mods that contain `whmmflows\` files. A pack's index is read just to check this.
2. Checks the launch cache (below). On a hit, it reuses the earlier output and skips the remaining steps.
3. Clears `<game>/whmm_flows/` and resets the numbers already taken by Generate Rows `counter` transformations (`resetCounterTracking`). The reset happens once per launch, so generated numbers stay unique across all flows in all packs. A manual run resets them on every run.
4. Runs `executeFlowsForPack` for each mod, in load order:
   - It reads the mod's own packed copy of its flows, then skips flows the player switched off.
   - `prepareFlow` applies the player's option values, sets `useCurrentPack` inputs to the mod's own pack, gives every Save Changes a `flowExecutionId`, and fills in the current game's schema.
   - `executeNodeGraph` then runs the flow. Every flow of one launch shares one `FlowExecutionContext`, which caches pack reads, pack indexes and table rows.
   - If the player gave the mod data overwrites, flows read the rewritten copy in `<game>/whmm_overwrites/` instead (`packPathSubstitutes`).
5. Adds `add_working_directory "<game>/whmm_flows"` plus a `mod "<pack>";` line for each pack the flows created.
   - A **replacement** pack (Move Or Copy Files that copies a whole pack, wired into Save Changes) keeps the original's file name. The original is then dropped from the mod list.
   - Packs named after `node_graph_output_<flowExecutionId>` or the node's `packName` are added alongside the mods.

**Keep `prepareFlow` (main process) and `prepareGraphForExecution` (renderer) in sync.** They apply the same substitutions on the two paths. When they drift, a flow behaves differently at game start than it did in the editor; the code comments call out earlier fixes for exactly that.

## Execution semantics (`executeNodeGraph`)

- **Start.** The run starts from nodes with no incoming connections; a graph without any fails with "No starting nodes found".
- **Order.** Nodes run **one at a time**, in the order a work queue reaches them; nothing runs in parallel.
- **When a node runs.** A node is queued once every incoming connection is either from a node that succeeded or pruned by a branch.
- **Inputs.** `buildInputDataForTarget` collects the outputs of a node's live incoming connections. Then `executeNodeAction` dispatches on the node type, with the node's config serialized as `textValue` (`serializeNodeConfigForExecution`, or the `nodeConfigs` built by `prepareFlow`).
- **Failure.** A failed node records its error. Nodes downstream of it never run, the graph result is `success: false`, and other branches carry on.
- **Disabled nodes** (`isDisabled`) are skipped without producing a result. **Nodes downstream of a disabled node do not run either**, unless another live path feeds them.
- **Control flow.** A node can return `activeOutputHandles`, as Conditional Branch does. Connections from its other handles are pruned, and a node whose every input was pruned is skipped, together with its whole branch. A node fed by both branches still runs; it is a join.
- **Native patch schema connections** (the purple Schema output into Custom Rows Input) are declarations, not dependencies. They are read ahead with `readNativePatchFlowTableSchema` and do not count toward ordering, so rows can feed back into the same Native Patch node without a cycle.

Results are `{ success, data?, error?, warnings?, activeOutputHandles? }` per node. A Save Changes result has `data.type === "SaveResult"` with `savedTo` and `replacedPackPaths`. `executeFlowsForPack` collects these to build the mod list.

## Launch cache

`<userData>/flow-execution-cache.bin` is zstd-compressed JSON, one entry per game. Version: `FLOW_EXECUTION_CACHE_VERSION` (currently 12; the history is in comments next to it).

The cache key is a hash of:

- the cache version, the game and the game path;
- every enabled mod's path, name, load order, size and mtime;
- every vanilla pack's size and mtime;
- the player's `userFlowOptions` and `packDataOverwrites`.

A launch **reuses** the previous output when all of these hold:

- the key matches;
- the entry has no runtime native-patch contributions (those live only in memory, so they must be rebuilt every launch);
- every cached output pack still exists in `whmm_flows`.

A launch where any flow failed does not update the cache.

## Native patches from flows

The `nativepatch` node turns a template from `whmm_patch_templates/**/*.wh3patchtemplate.json`, plus option and table inputs, into a validated contribution. There are two ways out:

- **Wired into Save Changes:** the contribution is written as a file under `whmm_patch_contributions/v1/` in the output pack.
- **Output left unconnected ("terminal"):** a successful launch run hands it straight to the launch planner. Nothing is written to disk, and the flow runs again on every launch.

If an enabled launch flow that contains a Native Patch node fails anywhere upstream of, at, or downstream of that node, **the launch is aborted** with "Native Patch flow failed: …".

The template format, limits, merge rules and examples are in [`NATIVE_PATCHES.md`](NATIVE_PATCHES.md#flow-driven-native-patches).

## Debugging

- In development, set `WHMM_VERBOSE_FLOW_EXECUTION=1` to log every node, every skipped branch, and per-node memory (`flowExecutionDebugLog`).
- The `startGame` handler logs which flows ran, their timings, created packs, and cache hits and misses to `main.log`.
- To force a rerun, change an option, touch a mod, or delete `flow-execution-cache.bin`.

## Adding a node type

1. Add the id to `FlowNodeType` in `src/index.d.ts` and a data type in `src/nodeGraph/nodes/types.ts`.
2. Register it in `nodeRegistry.ts`: a `createNodeDefinition` entry with default data, label and description keys, and a sidebar section. Add the strings to `locales/*/translation.json`.
3. Add its React component in `nodes/renderers.tsx` and map it in `nodeTypes.tsx`.
4. Teach `connectionRules.ts` which edge types it accepts and produces.
5. Add any new data fields to `SerializedNode["data"]` **and** to `serializeReactFlowNodes`. Otherwise they are dropped on save.
6. If the node needs more than `textValue` at run time, add a case to `prepareNodeConfig` (`packFileSerializer.ts`); the default passes only `textValue`. If it has text fields that should take `{{option}}` values, handle them in **both** `prepareFlow` and `prepareGraphForExecution`.
7. Add a `case` in `executeNodeAction` (`nodeExecutor.ts`). If it needs the DB schema, add it to `schemaAwareFlowNodeTypes`.
8. Add targeted tests next to the existing ones in `test/nodeGraph/` (one file per node, e.g. `conditionalBranch.node.test.ts`, `connectionRules.node.test.ts`).

The ONNX node uses `TableSelection` for input and output. It reads a manifest bundle or one packed `.onnx` model from the selected source pack (an empty selection uses the flow-owning pack). Its controls offer schema column/reference choices, constants, output enablement, destination columns and add/replace/delta modes; advanced JSON mappings remain available for custom paths. Ambiguous paths and unresolved `is_ranged` bindings must be assigned before execution. Linked output rows are cloned per root row while existing shared rows remain intact. The launch execution cache was bumped when this node was added.

Opening an ONNX node inspects its binding choices. Schema searches share a name/reference index and memoized path results within that schema snapshot. Reverse reachability prunes unrelated branches before enumerating forward paths, so listing choices does not repeatedly traverse the whole branching schema in the main process.

ONNX bindings can also test whether a column is populated, independently of whether its foreign key resolves. Numeric column bindings can opt into `missingAsNaN` so a packed preprocessor handles imputation; the default remains zero. Output bindings can opt into `roundPrediction` before delta strength and writeback. Model inspection and execution select installed default table versions rather than assuming the largest schema version belongs to the running game. The Radious example in `docs/examples/onnx-radious/` uses these settings to follow its companion predictor.
