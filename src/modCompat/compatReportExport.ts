import { PackCollisions } from "../packFileTypes";

/**
 * A compatibility report written out in a form two builds can be diffed against each other.
 *
 * Built to answer one question: did a change to how the data is read alter what gets reported? So the
 * output has to be **canonical** - the same findings must produce the same bytes regardless of the
 * order they happened to be discovered in. Object keys are sorted, and so are arrays, by the canonical
 * form of their own elements.
 *
 * Sorting arrays does discard the order findings came in. That is deliberate: the order conflicts are
 * discovered is an artefact of pack iteration, not a fact about the mods, and leaving it in would make
 * every diff noisy with differences that mean nothing.
 */

/** Recursively sorts object keys and array elements so equal content always serialises identically. */
export const canonicaliseForDiff = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const items = value.map(canonicaliseForDiff);
    return items
      .map((item) => ({ item, key: JSON.stringify(item) ?? "" }))
      .sort((first, second) => (first.key < second.key ? -1 : first.key > second.key ? 1 : 0))
      .map(({ item }) => item);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicaliseForDiff((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
};

export interface CompatReportModEntry {
  name: string;
  isEnabled: boolean;
  loadOrder: number | null;
}

export interface CompatReportCounts {
  packFileCollisions: number;
  packTableCollisions: number;
  missingTableReferences: number;
  uniqueIdsCollisions: number;
  scriptListenerCollisions: number;
  packFileAnalysisErrors: number;
  missingFileRefs: number;
}

export interface CompatHtmlReportOptions {
  generatedAt?: Date;
  scopeLabel?: string;
}

const countEntries = (byPack: Record<string, unknown[]>): number =>
  Object.values(byPack).reduce((total, entries) => total + entries.length, 0);

const countNestedEntries = (byPack: Record<string, Record<string, unknown[]>>): number =>
  Object.values(byPack).reduce((total, byFile) => total + countEntries(byFile), 0);

/**
 * Totals, so a difference is obvious before anyone opens a diff tool.
 *
 * Counting the leaves rather than the top-level keys: a pack losing one of its five missing references
 * is exactly the kind of regression this is looking for, and a key count would not show it.
 */
export const countCompatFindings = (collisions: PackCollisions): CompatReportCounts => ({
  packFileCollisions: collisions.packFileCollisions.length,
  packTableCollisions: collisions.packTableCollisions.length,
  missingTableReferences: countEntries(collisions.missingTableReferences),
  uniqueIdsCollisions: countEntries(collisions.uniqueIdsCollisions),
  scriptListenerCollisions: countEntries(collisions.scriptListenerCollisions),
  packFileAnalysisErrors: countNestedEntries(collisions.packFileAnalysisErrors),
  missingFileRefs: countNestedEntries(collisions.missingFileRefs),
});

/**
 * The whole report as text.
 *
 * The mod list is included because a comparison across two builds only means anything if both ran over
 * the same mods - and a mod set that quietly differs is the most likely way to get a misleading result.
 */
export const formatCompatReport = (
  collisions: PackCollisions,
  mods: readonly CompatReportModEntry[],
): string =>
  `${JSON.stringify(
    {
      mods: canonicaliseForDiff(
        mods.map((mod) => ({ name: mod.name, isEnabled: mod.isEnabled, loadOrder: mod.loadOrder })),
      ),
      counts: countCompatFindings(collisions),
      collisions: canonicaliseForDiff(collisions),
    },
    null,
    2,
  )}\n`;

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const sortRows = (rows: string[][]) =>
  rows.sort((first, second) => first.join("\0").localeCompare(second.join("\0")));

const renderFindingTable = (headers: string[], rows: string[][]) => {
  if (rows.length === 0) return '<p class="empty">No findings in this category.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${sortRows(rows)
      .map(
        (row) =>
          `<tr data-finding>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
};

const renderReportSection = (
  id: string,
  title: string,
  description: string,
  count: number,
  headers: string[],
  rows: string[][],
) => `<details class="report-section" id="${id}" open>
  <summary>
    <span>${escapeHtml(title)}</span>
    <span class="count">${count.toLocaleString("en-US")}</span>
  </summary>
  <div class="section-body">
    <p class="description">${escapeHtml(description)}</p>
    ${renderFindingTable(headers, rows)}
  </div>
</details>`;

/** Produces a self-contained, searchable compatibility report intended for people rather than diffs. */
export const formatCompatReportHtml = (
  collisions: PackCollisions,
  mods: readonly CompatReportModEntry[],
  options: CompatHtmlReportOptions = {},
): string => {
  const counts = countCompatFindings(collisions);
  const totalFindings = Object.values(counts).reduce((total, count) => total + count, 0);
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const scopeLabel = options.scopeLabel || "Checked mods";

  const packFileRows = collisions.packFileCollisions.map((collision) => [
    collision.firstPackName,
    collision.secondPackName,
    collision.fileName,
    collision.areSameSize ? "Yes" : "No",
  ]);
  const packTableRows = collisions.packTableCollisions.map((collision) => [
    collision.firstPackName,
    collision.secondPackName,
    collision.fileName,
    collision.secondFileName,
    collision.key,
    collision.value,
  ]);
  const missingTableReferenceRows = Object.entries(collisions.missingTableReferences).flatMap(
    ([packName, references]) =>
      references.map((reference) => [
        packName,
        reference.originDBFileName,
        reference.originFileSuffix,
        reference.originFieldName,
        reference.targetDBFileName,
        reference.targetFieldName,
        reference.value,
      ]),
  );
  const uniqueIdRows = Object.entries(collisions.uniqueIdsCollisions).flatMap(
    ([packName, entries]) =>
      entries.map((entry) => [
        packName,
        entry.tableName,
        entry.fieldName,
        entry.value.value,
        entry.firstPackName,
        entry.secondPackName || entry.valueTwo.packName,
        entry.value.packFileName,
        entry.valueTwo.packFileName,
      ]),
  );
  const scriptListenerRows = Object.entries(collisions.scriptListenerCollisions).flatMap(
    ([packName, entries]) =>
      entries.map((entry) => [
        packName,
        entry.value.value,
        entry.firstPackName,
        entry.secondPackName || entry.valueTwo.packName,
        entry.value.packFileName,
        entry.valueTwo.packFileName,
        String(entry.value.position),
        String(entry.valueTwo.position),
      ]),
  );
  const analysisErrorRows = Object.entries(collisions.packFileAnalysisErrors).flatMap(
    ([packName, files]) =>
      Object.entries(files).flatMap(([fileName, errors]) =>
        errors.map((error) => [
          packName,
          fileName,
          error.msg,
          error.lineNum == null ? "" : String(error.lineNum),
          error.colNum == null ? "" : String(error.colNum),
        ]),
      ),
  );
  const missingFileRows = Object.entries(collisions.missingFileRefs).flatMap(([packName, files]) =>
    Object.entries(files).flatMap(([fileName, references]) =>
      references.map((reference) => [
        packName,
        fileName,
        reference.reference,
        reference.packName,
        reference.packFileName,
      ]),
    ),
  );

  const sections = [
    renderReportSection(
      "file-collisions",
      "File collisions",
      "Files supplied by more than one checked pack.",
      counts.packFileCollisions,
      ["First pack", "Second pack", "File", "Same size"],
      packFileRows,
    ),
    renderReportSection(
      "database-collisions",
      "Database key collisions",
      "Rows in database tables that use the same key.",
      counts.packTableCollisions,
      ["First pack", "Second pack", "First file", "Second file", "Key", "Value"],
      packTableRows,
    ),
    renderReportSection(
      "missing-database-references",
      "Missing database references",
      "Database values that reference keys not present in the checked data.",
      counts.missingTableReferences,
      ["Pack", "Origin table", "Origin file", "Origin field", "Target table", "Target field", "Value"],
      missingTableReferenceRows,
    ),
    renderReportSection(
      "duplicate-unique-ids",
      "Duplicate unique IDs",
      "Unique identifiers defined more than once.",
      counts.uniqueIdsCollisions,
      ["Pack", "Table", "Field", "Value", "First pack", "Second pack", "First file", "Second file"],
      uniqueIdRows,
    ),
    renderReportSection(
      "duplicate-listeners",
      "Duplicate listener names",
      "Lua listeners that reuse the same name.",
      counts.scriptListenerCollisions,
      ["Pack", "Listener", "First pack", "Second pack", "First file", "Second file", "First position", "Second position"],
      scriptListenerRows,
    ),
    renderReportSection(
      "file-errors",
      "File analysis errors",
      "Syntax and parsing errors found while checking supported files.",
      counts.packFileAnalysisErrors,
      ["Pack", "File", "Message", "Line", "Column"],
      analysisErrorRows,
    ),
    renderReportSection(
      "missing-files",
      "Missing file references",
      "Files referenced by checked content that could not be found.",
      counts.missingFileRefs,
      ["Pack", "Source file", "Missing reference", "Origin pack", "Origin file"],
      missingFileRows,
    ),
  ].join("\n");

  const summaryCards = [
    ["File collisions", counts.packFileCollisions, "file-collisions"],
    ["Database collisions", counts.packTableCollisions, "database-collisions"],
    ["Missing DB references", counts.missingTableReferences, "missing-database-references"],
    ["Duplicate IDs", counts.uniqueIdsCollisions, "duplicate-unique-ids"],
    ["Duplicate listeners", counts.scriptListenerCollisions, "duplicate-listeners"],
    ["File errors", counts.packFileAnalysisErrors, "file-errors"],
    ["Missing files", counts.missingFileRefs, "missing-files"],
  ]
    .map(
      ([label, count, target]) => `<a class="summary-card" href="#${target}">
        <span>${escapeHtml(label)}</span><strong>${Number(count).toLocaleString("en-US")}</strong>
      </a>`,
    )
    .join("");

  const orderedMods = [...mods].sort(
    (first, second) =>
      (first.loadOrder ?? Number.MAX_SAFE_INTEGER) - (second.loadOrder ?? Number.MAX_SAFE_INTEGER) ||
      first.name.localeCompare(second.name),
  );
  const modRows = orderedMods
    .map(
      (mod) => `<tr data-mod>
        <td>${mod.loadOrder == null ? "—" : escapeHtml(mod.loadOrder)}</td>
        <td>${escapeHtml(mod.name)}</td>
        <td><span class="status ${mod.isEnabled ? "enabled" : "disabled"}">${
          mod.isEnabled ? "Enabled" : "Disabled"
        }</span></td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WH3 Mod Manager Compatibility Report</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1120; --panel:#111827; --panel2:#1f2937; --line:#374151; --text:#e5e7eb; --muted:#9ca3af; --blue:#60a5fa; --red:#f87171; --green:#34d399; }
    * { box-sizing:border-box; }
    body { margin:0; background:linear-gradient(145deg,#09101d,#111827 55%,#0f172a); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(1500px,calc(100% - 32px)); margin:0 auto; padding:40px 0 64px; }
    header { margin-bottom:24px; }
    h1 { margin:0 0 8px; font-size:clamp(26px,4vw,42px); letter-spacing:-.03em; }
    .subtitle,.description,.meta { color:var(--muted); }
    .meta { display:flex; flex-wrap:wrap; gap:8px 20px; margin-top:14px; }
    .overall { display:inline-flex; align-items:center; gap:8px; margin-top:18px; padding:8px 12px; border:1px solid var(--line); border-radius:999px; background:var(--panel); }
    .overall strong { color:${totalFindings === 0 ? "var(--green)" : "var(--red)"}; }
    .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:24px 0; }
    .summary-card { display:flex; justify-content:space-between; gap:12px; padding:14px; border:1px solid var(--line); border-radius:12px; background:rgba(17,24,39,.9); color:var(--text); text-decoration:none; }
    .summary-card:hover { border-color:var(--blue); transform:translateY(-1px); }
    .summary-card strong { color:var(--blue); font-size:18px; }
    .toolbar { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:10px; padding:12px; margin:20px 0; border:1px solid var(--line); border-radius:12px; background:rgba(11,17,32,.94); backdrop-filter:blur(8px); }
    input { flex:1 1 280px; min-width:0; padding:9px 12px; border:1px solid var(--line); border-radius:8px; background:#030712; color:var(--text); }
    button { padding:9px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel2); color:var(--text); cursor:pointer; }
    button:hover { border-color:var(--blue); }
    details { margin:14px 0; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:rgba(17,24,39,.9); }
    summary { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; cursor:pointer; font-size:17px; font-weight:650; }
    summary:hover { background:rgba(31,41,55,.75); }
    .count { min-width:34px; padding:2px 9px; border-radius:999px; background:#1e3a5f; color:#bfdbfe; text-align:center; font-size:13px; }
    .section-body { padding:0 18px 18px; }
    .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:9px; }
    table { width:100%; border-collapse:collapse; background:#0b1220; }
    th,td { padding:9px 11px; border-bottom:1px solid #253044; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th { position:sticky; top:0; background:#1f2937; color:#dbeafe; white-space:nowrap; }
    tbody tr:nth-child(even) { background:rgba(31,41,55,.35); }
    tbody tr:hover { background:rgba(37,99,235,.12); }
    .empty { margin:12px 0 0; padding:18px; border:1px dashed var(--line); border-radius:9px; color:var(--muted); text-align:center; }
    .mods { margin-top:24px; }
    .status { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; }
    .status.enabled { background:#064e3b; color:#a7f3d0; }
    .status.disabled { background:#3f3f46; color:#d4d4d8; }
    [hidden] { display:none !important; }
    footer { margin-top:28px; color:var(--muted); text-align:center; }
    @media print { :root { color-scheme:light; } body { background:#fff; color:#111; } main { width:100%; padding:0; } .toolbar { display:none; } details { break-inside:avoid; background:#fff; border-color:#bbb; } details:not([open]) > *:not(summary) { display:block; } table { background:#fff; } th { position:static; background:#eee; color:#111; } .subtitle,.description,.meta,footer { color:#444; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Compatibility Report</h1>
    <p class="subtitle">WH3 Mod Manager compatibility check results</p>
    <div class="meta"><span><strong>Scope:</strong> ${escapeHtml(scopeLabel)}</span><span><strong>Generated:</strong> <time datetime="${generatedAt}">${escapeHtml(generatedAt)}</time></span><span><strong>Mods recorded:</strong> ${mods.length.toLocaleString("en-US")}</span></div>
    <div class="overall"><span>Total findings</span><strong>${totalFindings.toLocaleString("en-US")}</strong></div>
  </header>
  <section class="summary" aria-label="Finding summary">${summaryCards}</section>
  <div class="toolbar">
    <input id="report-search" type="search" placeholder="Search findings by pack, file, table, key, or message…" aria-label="Search findings">
    <button id="expand-all" type="button">Expand all</button>
    <button id="collapse-all" type="button">Collapse all</button>
    <button type="button" onclick="window.print()">Print</button>
  </div>
  <section aria-label="Compatibility findings">${sections}</section>
  <details class="mods" open>
    <summary><span>Mods included in report</span><span class="count">${mods.length.toLocaleString("en-US")}</span></summary>
    <div class="section-body"><div class="table-wrap"><table><thead><tr><th>Load order</th><th>Pack</th><th>State</th></tr></thead><tbody>${modRows}</tbody></table></div></div>
  </details>
  <footer>Generated by WH3 Mod Manager</footer>
</main>
<script>
  (() => {
    const sections = [...document.querySelectorAll('.report-section')];
    const rows = [...document.querySelectorAll('[data-finding]')];
    const search = document.getElementById('report-search');
    const applySearch = () => {
      const query = search.value.trim().toLocaleLowerCase();
      rows.forEach((row) => { row.hidden = query !== '' && !row.textContent.toLocaleLowerCase().includes(query); });
      sections.forEach((section) => {
        const sectionRows = [...section.querySelectorAll('[data-finding]')];
        section.hidden = query !== '' && (sectionRows.length === 0 || sectionRows.every((row) => row.hidden));
        if (query !== '' && !section.hidden) section.open = true;
      });
    };
    search.addEventListener('input', applySearch);
    document.getElementById('expand-all').addEventListener('click', () => document.querySelectorAll('details').forEach((section) => { section.open = true; }));
    document.getElementById('collapse-all').addEventListener('click', () => document.querySelectorAll('details').forEach((section) => { section.open = false; }));
  })();
</script>
</body>
</html>\n`;
};
