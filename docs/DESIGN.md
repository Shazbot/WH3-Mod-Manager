# WH3 Mod Manager — Design System

This document describes the existing visual system and the rules a future redesign must preserve. It distinguishes observed implementation details from recommendations for places where the current UI is inconsistent. A recommendation is a visual standard only; it must not change an action, data model, navigation rule, or performance characteristic.

## Product character

WH3 Mod Manager is a desktop-first tool for people who manage large mod collections and inspect game data. Its interface should feel:

- dense, fast, and precise;
- utilitarian rather than promotional;
- optimized for scanning, comparison, and keyboard/mouse control;
- visually calm enough to support long sessions;
- explicit about state, warnings, load order, and destructive actions.

The mod list is the primary workspace. It is not a dashboard and should not become a collection of cards, hero panels, oversized empty regions, gradients, glow effects, or decorative illustrations. Thumbnails are functional metadata and may support scanning; they are not a reason to turn rows into cards.

## Design contract

Any visual redesign must preserve these product constraints:

- Keep the persistent desktop navigation and compact shell.
- Preserve keyboard shortcuts, including `Ctrl+F` for the main filter, `Ctrl+1` through `Ctrl+N` for tabs, `Escape` for dismissing transient UI, and the load-order placement keys.
- Preserve left-click, right-click, `Ctrl`/`Cmd` selection, multi-selection, sorting, filtering, column resizing, tooltips, and the current viewer-opening shortcuts.
- Preserve the distinction between enabled and disabled mod panes, including dual-pane mode and category mode.
- Preserve load-order insertion feedback and stable scroll positions while rows are toggled or reordered.
- Keep table/grid interactions direct: editing, selection, row headers, pinned columns, context menus, and automatic scroll-to-cell behavior must remain discoverable.
- Keep large mod lists and pack tables virtualized. A visual change must not add a per-row layout or measurement cost that defeats virtualization.
- Keep scroll ownership clear. The list, viewer table/tree, drawer, menu, and page shell may each scroll only when that is already their responsibility.
- Use color and icons as reinforcement for text and position, never as the only way to understand state.
- Design for long names, authors, pack names, translated strings, and large numeric values. Truncate only where the existing component already truncates and provide the existing tooltip or expansion path.
- Reuse established controls, menu surfaces, modal structure, and typography roles instead of introducing a second visual language for every feature.

## Shell and layout

### Existing structure

The application has a fixed-height title strip followed by a persistent left navigation rail, a main workspace, an optional utility sidebar, and transient notifications.

- The custom top strip is `28px` high, full width, fixed above application content, and uses Tailwind `gray-700` styling. It contains the application icon and a light, small title. The strip is draggable through `#top-bar`.
- The main shell reserves the same `28px` title-strip height. The mod workspace scroll container uses a `56px` left offset, `44px` top padding, `16px` bottom padding, and a maximum/explicit height of `calc(100vh - 28px)`.
- Viewer content uses `32px` horizontal padding, `44px` top padding, and `16px` bottom padding. Its table/viewer root uses `calc(100vh - 3.5rem)` and compensates the outer top spacing with a negative top margin.
- The regular workspace is a centered twelve-column grid with a maximum width of `100rem` (`1600px`). The mod area occupies ten columns and the right utility sidebar occupies two columns with a small gap.
- The main feature panels remain mounted after first activation and are hidden when inactive. This keeps tab switching responsive and preserves panel state.
- Scrollbars are dark and compact. The main mod list uses a gray track and blue thumb; other components may own their own scrollbars when they contain a large list or table.

### Layout rules

- Treat the `28px` title strip, `56px` navigation offset, and compact content padding as shell constants. Do not reclaim them by overlaying content under the title bar or hiding the navigation rail at ordinary desktop widths.
- Use the existing centered workspace width as the comfortable upper bound. Extra width should improve column breathing room, not create decorative whitespace.
- Keep controls and status close to the list they affect. A toolbar may occupy one compact row; it should not become a full-width marketing header.
- Keep the primary list visually dominant. The utility sidebar is secondary and must not compete with row content.
- Preserve the current split-view relationship: a dual mod list uses two equally weighted panes with a `12px` gap, while the regular shell uses the ten/two-column relationship above.
- Avoid horizontal page scrolling. Long values should use the component’s established truncation, wrapping, pinned-column, or tooltip behavior.
- When changing a panel’s size, preserve its existing owner of vertical scrolling and its fixed-position overlays.

## Navigation

### Existing pattern

The left navigation is a vertical tab list in a bordered dark panel. It is fixed near the top of the shell and remains available while the workspace changes.

- The rail begins `32px` from the top and is fixed at the left edge with a high stacking level.
- The panel has a `1px` `#3c3e43` border, `#1c1d1f` background, and a maximum height of `calc(100vh - 3rem)` (`48px` reserved around the shell). The tab list itself uses `#394250` and scrolls when necessary.
- Each tab is `60px` high with base padding of `12px 6px`; the usable label area receives approximately `14px` left padding. Selected tabs use approximately `10px` left padding and a `4px` left border in `#1c64f2`.
- Selected tabs use `#262626` and white text. Unselected tabs remain quiet and readable against the blue-gray list background.
- Icons come from the existing `react-icons` families and are generally in the `1.25rem`–`1.5rem` range. Do not introduce large decorative navigation symbols.
- Labels and the `Ctrl+N` hint are hidden until the tab is hovered where the compact rail needs to save space. The visible tab order is also the keyboard shortcut order; hidden feature tabs do not consume a visible shortcut position.
- “All Mods” remains the stable first destination. The remaining tabs are feature/game dependent.

### Navigation rules

- Keep the rail persistent and discoverable on desktop.
- Preserve the selected indicator’s left-edge position and strong blue accent; do not use a filled pill or a large card for the active tab.
- Keep icon, label, and shortcut hint aligned to the same tab box. If a label is unavailable, the icon still needs a tooltip.
- Keep tab names short enough to scan, but do not hide the feature name behind icon-only navigation when the user is exploring the application.
- Preserve the current keyboard order and current-game/feature visibility rules.
- Do not use category colors from the mod list as navigation state colors. Navigation selection uses the blue system accent.

## Mod list and mod rows

The mod list is a dense, virtualized table-like surface. It has two established shapes: a wide multi-column row and a compact two-line row. Both shapes use a shared header/row grid template so headings remain aligned with data.

### Wide list geometry

The wide layout exposes order, enablement, identifying pack/name information, optional author/time fields, and configuration controls. At desktop widths the base grid template includes these verified tracks:

```text
57px 80px 1fr 1fr 0.5fr 80px
```

Thumbnail and author variants add their existing `max-content` and `0.5fr` tracks. Below `1024px`, fields marked `grid-area-autohide` are hidden rather than forcing the page to scroll horizontally. The header and every row must continue to use the same template for the active variant.

Wide-row implementation facts:

- The minimum row treatment is `0px` without thumbnails and `104px` with thumbnails. Estimated rows use a `32px` floor without thumbnails and `104px` with thumbnails.
- Thumbnails are square, capped at `6rem`, and stay subordinate to the text columns.
- The time cell is normally `28px` high with thumbnails and `24px` without them.
- The order number uses a bold blue (`blue-500`) treatment. Load-order insertion uses an arrow/placeholder rather than a permanent decorative marker.
- Configuration gears/knobs are utility controls. They are white normally and use `#1c64f2` when pack data has been overwritten.
- Row content uses `0.25rem` horizontal/vertical wide-list padding where the wide row style applies.

Do not hard-code a new column layout in a redesign. The active thumbnail/author options and the shared CSS templates are the source of truth.

### Compact density

Compact rows use a two-line title/metadata treatment and intentionally omit the wide row’s checkbox column. The following values are implemented density tokens and should remain the baseline for visual redesigns:

| Density     | Order track | Thumbnail track | Time track | Gear track | Thumbnail | Vertical pad | Title / weight | Meta     | Line height | Text-only floor | Thumbnail floor |
| ----------- | ----------: | --------------: | ---------: | ---------: | --------: | -----------: | -------------- | -------- | ----------: | --------------: | --------------: |
| Compact     |        56px |          4.5rem |    6.25rem |       44px |      4rem |       0.5rem | 1rem / 500     | 0.875rem |        1.25 |            72px |            80px |
| Comfortable |        60px |          5.5rem |    6.75rem |       48px |      5rem |      0.75rem | 1.125rem / 500 | 1rem     |       1.375 |            96px |           104px |
| Roomy       |        64px |          6.5rem |     7.5rem |       52px |      6rem |         1rem | 1.25rem / 600  | 1rem     |         1.5 |           112px |           128px |

The floor values are important to virtualization and visual rhythm. A redesign may change the presentation within a density role, but must not make rows shorter than the corresponding measured floor without updating the measurement model at the same time.

### Row content and states

The title is the human-readable mod name. The author and pack name are secondary metadata. In compact mode, clicking the row or labels toggles the mod because the checkbox is intentionally hidden; in wide mode, order, checkbox, thumbnail, pack, name, author, time, and configuration controls occupy their respective columns.

| State or meaning      | Existing treatment                                                                                         | Design rule                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Normal row            | Dark neutral row surface with light text                                                                   | Keep text-first scanning and restrained contrast.                        |
| Row hover             | Inner cells use `#525252`; the outer hover adds an inset top line around `#71717a` and a black bottom line | Make the whole row target obvious without turning it into a card.        |
| Manual/active row     | Uses the same `#525252` functional highlight                                                               | Do not add a second unrelated selection color.                           |
| Load-order placement  | A `2.4s` cyan reorder animation, with `rgba(8,145,178,.58)` start color and `#22d3ee` inset emphasis       | Keep insertion feedback temporary and local to the row.                  |
| Drop ghost            | `3px` dotted `#666` placeholder                                                                            | Preserve the visible insertion location.                                 |
| Placement hover       | Blue `blue-700/40` feedback; ordinary row-hover highlighting is suppressed                                 | Do not replace the placement affordance with an unverified drag gesture. |
| Data pack             | Orange `orange-500` label/icon treatment unless the value is symbolic                                      | Keep pack provenance legible in text and icon form.                      |
| Symbolic pack         | Blue `blue-400`                                                                                            | Do not use this color as a generic enabled/selected state.               |
| Modding pack          | Amber `amber-400`                                                                                          | Keep category/provenance meaning separate from global status.            |
| Deleted/movie         | Red `red-800` icon treatment                                                                               | Pair with a text/tooltip explanation where space permits.                |
| Merged/archive        | Gray `gray-300` icon treatment                                                                             | Keep the row readable and avoid warning-red noise.                       |
| Custom folder         | Custom folder icon                                                                                         | Preserve the distinction from ordinary pack provenance.                  |
| Overwritten pack data | Gear/knob changes to `#1c64f2`                                                                             | This is a data-state signal, not a hover color.                          |

Use opacity only where the current UI already uses it for counts or secondary information. Do not make disabled mods unreadable; the disabled/enabled pane and checkbox state must remain obvious at a glance.

### Interaction contract

- Clicking the row/label or checkbox toggles the mod according to the existing mode.
- Right-click opens the row context menu at the pointer and preserves the relevant scroll position when the menu closes.
- `Ctrl`-clicking a mod can open it in the viewer, excluding clicks on row controls.
- Sorting is available from the header. Clicking toggles the sort; in dual mode, `Shift`-click can synchronize both panes. Right-click header actions must remain available.
- Load-order placement provides its existing arrow/placeholder and keyboard handling: `Escape` cancels, `ArrowUp`/`ArrowDown` moves, and `Enter` confirms.
- Toggling a mod must preserve the pane’s scroll position after the virtualized list re-renders.
- Category headings are compact buttons with a chevron, a category badge, and an enabled/total count. The current heading pattern is `gap-2`, `px-2`, `py-1`, a bottom border in slate, and a subdued hover background.

### Dual and category layouts

Dual mode uses two equal grid columns with a `12px` gap. Each pane has a small caption (`px-2 pb-1`, approximately `0.875rem`) and muted counts. The disabled pane uses a left category control with a blue/slate border treatment; the enabled pane remains the action destination. Category mode keeps the disabled pane on the left and the enable action on the right.

Keep pane captions, counts, category headings, and empty states aligned to the same content edge as their rows. They are structural orientation aids, not cards.

## Tables and data grids

### Pack-table viewer

Pack-table inspection uses AG Grid and must remain a data-dense editable grid, not a card or tile layout. The implementation has two row-height modes:

| Table mode  |                         Row height | Use             |
| ----------- | ---------------------------------: | --------------- |
| Normal      | `36px` (`28px` content plus `8px`) | Ordinary tables |
| Dense/large | `31px` (`23px` content plus `8px`) | Large tables    |

Additional verified geometry:

- Cell text is `1.1rem` (`17.6px`); AG Grid headers are approximately `14px` at medium weight and may wrap to a maximum of two lines with `1.15` line height.
- Horizontal cell padding is `10px`. Numeric columns have a `56px` minimum; checkbox columns `36px`; row-index columns at least `50px` plus approximately `20px` internal padding; ordinary text content has a `110px` minimum.
- The pinned key column may expand to a `280px` maximum-content width on hover. Pinned/selection affordances must remain visible while horizontal scrolling.
- Header and cell separators use a solid `rgba(148,163,184,.32)` line. Odd rows use `rgba(148,163,184,.07)`; hover uses `rgba(96,165,250,.12)`.
- Selected cells use `rgba(59,130,246,.22)` with an inset border around `rgba(96,165,250,.7)`. Selected headers and row indexes use the existing darker blue overlays.
- The grid uses `Inter`, then `Roboto`, then `Arial`, sans-serif. Keep the text high contrast against the dark grid surface.
- Fixed sizing is used for sufficiently large data sets; large-table thresholds are `20,000` rows or `2,000,000` cells. Do not make visual measurement dependent on rendering every row.

The grid supports direct cell editing where allowed, sorting, filtering, resizing, row and cell selection, row-header selection, context menus, and automatic scroll-to-cell. `Ctrl`/`Cmd` is additive selection. These interactions must remain available without relying on hover-only controls.

The bottom action row uses compact buttons around `px-3 py-2` and `text-sm`. The key-column selector is compact (`px-2 py-1`), the table filter is about `192px` wide, and pin/hide controls use blue for active and gray for inactive states. The auto-scroll anchor is a small `22px` control with a `13px` label, dark translucent background, a thin border, and a fully rounded shape.

### Viewer shell and tabs

The viewer toolbar is a single compact row: vertically centered, `py-1`, right padding around `8px`, dark `gray-800` surface, and a bottom border in `gray-600`.

- The resizable file/tree sidebar defaults to about `17%`; the icon-only sidebar threshold is `300px`.
- File actions use small `text-sm` controls. File uses purple (`purple-600`), Save uses green (`green-600`), and Save As uses blue (`blue-600`). These colors communicate action families and should not become decorative fills across the application.
- Toolbar icon buttons use compact horizontal padding, a small shadow, and a rounded utility shape. A global-search button has a `Ctrl+Shift+F` title and must remain discoverable through a tooltip or accessible label.
- Pack tabs and file tabs are small rounded bordered tabs. Active pack tabs use `gray-700` with a `gray-500` border and white text; inactive tabs use `gray-800`, muted text, and a `gray-700` border with a subdued hover. Labels cap around `220px` and truncate. Dirty tabs show a leading dot; close icons are muted until hovered.
- File menus use a minimum width of `10rem`, a dark `gray-800` surface, a `gray-600` border, `6px` rounding, `py-1`, and a strong but restrained shadow. Recent-file submenus range from `16rem` to `28rem`.
- The tree/table split must keep independent scrolling and context-menu placement. The viewer should not acquire page-level scrolling as a side effect of toolbar or tab changes.

## Controls

### Buttons

The existing control vocabulary uses Flowbite-style rounded buttons, Tailwind colors, compact padding, and clear action variants. The shared theme provides these size roles:

| Size | Typography                | Horizontal / vertical padding |
| ---- | ------------------------- | ----------------------------- |
| XS   | `text-xs`                 | `px-2 py-1`                   |
| SM   | `text-sm`                 | `px-3 py-1.5`                 |
| MD   | `text-sm`                 | `px-4 py-2`                   |
| LG   | `text-base`               | `px-5 py-2.5`                 |
| XL   | inherited larger emphasis | `px-6 py-3`                   |

Buttons are normally `rounded-lg` (an `8px` radius). Use the smallest role that leaves the label, icon, focus treatment, and hit target comfortable:

- Toolbar and menu actions: approximately `30px`–`32px` tall when the component already uses compact `py-1`/`py-2` treatment.
- Regular sidebar and form controls: approximately `32px`–`36px` tall, with more room for labels.
- The title strip is a separate `28px` shell control and should not inherit ordinary button sizing.

Existing variants include blue/info for primary actions, gray for neutral actions, purple for file/open actions, green for run/save actions, and red/failure for destructive actions. Disabled controls use reduced opacity and a not-allowed cursor in the shared theme. Destructive actions need both the red treatment and an unambiguous label; never communicate danger by color alone.

Avoid pill-shaped controls unless the control is explicitly a status chip or the existing component already requires a fully rounded affordance. Do not use gradients, glow, oversized shadows, or a different corner language for individual features.

### Inputs, selects, and checkboxes

- The main filter is a native dark text input with `text-sm`, `p-2.5`, `rounded-lg`, gray-700 background, and gray-600 border. Keep the filter easy to reach with `Ctrl+F` and visually tied to the mod list.
- React Select controls use `#394250` background, `#4d5562` default border, and `#5189f4` focus border. Focused controls round their upper corners at approximately `3px` when the menu is open. Menus use `#394250` with a `2px` blue border; focused options use `#4b5563`.
- Select values, input text, and options use light slate text. Wrapped select styling allows normal wrapping anywhere when a value is long; do not force a single-line overflow that hides the selected value.
- Desktop checkboxes and gear icons use a `1.2` scale at widths of at least `1024px` and their base size below that breakpoint. Keep the hit target aligned with the row rather than increasing row height arbitrarily.
- Existing global CSS removes box shadows from checkbox, radio, and text-input focus states. A redesign should replace that suppression with one consistent, visible keyboard-focus ring using the blue accent/ring token while preserving the current dimensions.

## Dialogs, drawers, and overlays

### Modals

Flowbite modal structure is the baseline:

- Fixed overlay with a dark backdrop (`gray-900` at roughly `50%` opacity in the light class and `80%` in dark mode).
- Outer content padding around `16px`; inner content is rounded (`8px`), dark `gray-700`, and shadowed.
- Header is a flex row with `20px` padding, a bottom border, a medium `20px` title, and a compact rounded close button with a `20px` icon.
- Body uses `24px` padding and owns vertical scrolling when content is too tall. The local modal body caps its height at `calc(100% - 6rem)`.
- Footer uses `24px` padding with `8px` horizontal action spacing.
- Keep the existing modal size roles from `sm` through `7xl`; choose a size based on content, not on a decorative composition.

Dialogs must show title, purpose, current context, and the safest primary action without relying on color. Preserve `Escape` dismissal where it exists and keep focus handling accessible.

### Drawers

The options drawer is a right-side full-height panel. Its overlay is fixed to the viewport with a low-opacity dark gray backdrop and a high stacking level. The panel is full height, white in the shared generic drawer and dark in the actual options surface, with a maximum width of `32rem` (`max-w-lg`), `16px` internal padding, and a shadow.

Opening and closing currently use opacity/translation transitions around `500ms`; `Escape` closes the drawer. Keep section grouping, headings, separators, and the drawer’s own scrollbar. Options are form controls, not dashboard cards: use compact vertical rhythm and reserve larger gaps for real section breaks.

### Fixed overlays and stacking

Respect the existing overlay layers: the title bar is around `z-1000`, the navigation rail around `z-200`, sidebar tooltips around `z-300`, row placement status around `z-60`, generic drawers around `z-50`, and toasts around `z-100`. New overlays should choose an explicit layer that does not accidentally cover the title bar or a modal.

## Context menus

Context menus are compact action lists anchored to the pointer or the owning control. They should feel like a continuation of the surface, not a floating card.

- Mod menus are about `13rem` wide (`w-52`), use white/dark `gray-700`, `rounded`/`rounded-lg`, a divider where groups need separation, a strong shadow, `py-1`, and `text-sm` items with approximately `py-2 px-4`.
- Viewer menus use `gray-800` with a `gray-600` border, compact rounding, and shadow. Viewer submenu panels use `8px` outer padding, no gap between adjacent menu layers, a `250px`–`340px` width range, and a maximum height of `calc(100vh - 1rem)` with internal scrolling.
- Menus flip or shift to remain at least `8px` from the viewport edge. They must remain fully usable near the bottom and right edges.
- Group actions in a stable order: inspect/open first, common edits next, organization actions next, and destructive actions last. Use separators sparingly.
- Destructive actions use red icon/text and should include a clear text label. Disabled actions retain their position and show the shared disabled treatment.
- Preserve pointer, keyboard, and focus opening paths. Avoid hover-only submenus when the same action cannot be reached by keyboard or click.
- The current menus do not all expose the same semantic roles or item behavior. Standardizing menu semantics and focus behavior is a valid future cleanup, but it must not change which actions are available or their ordering without a product decision.

## Tooltips and transient feedback

- Sidebar tooltips are portal-based, fixed-position overlays with an `8px` offset, viewport flip/shift behavior, a scrollable maximum height, and a safe hover polygon. They should appear beside the rail without moving the layout.
- The shared tooltip uses a dark surface, `text-sm`, medium weight, `py-2 px-3`, rounded corners, a small shadow, and an arrow. Tooltip text must name an icon-only action or explain a non-obvious state; it should not repeat every visible label.
- Toasts are fixed near the lower-left corner at about `1%` from the edges, `w-96`, and a high stacking level. They use compact rounded dark surfaces, `16px` padding, an icon, message, and dismiss action. Current semantic examples are blue info, green success, and red warning/error.
- Placement status is fixed at the lower right with `16px` offsets, a blue border, dark slate surface, `16px 12px` padding, small text, and a strong shadow. Keep it separate from toasts so both remain readable.
- Motion and opacity must never be the only indication of an error, completed action, or changed selection.

## Typography

The repository self-hosts Libre Baskerville (normal, bold, and italic), Inter (variable `400`–`600`), and Roboto (variable `400`–`500`). The AG Grid pack-table theme explicitly uses `Inter`, then `Roboto`, then `Arial`, sans-serif. The general UI currently relies heavily on component utility classes rather than a single global family.

Recommended roles:

- Inter for controls, navigation, list metadata, tables, and numeric data.
- Roboto as a compatible fallback for dense data surfaces and environments where Inter is unavailable.
- Libre Baskerville only for an intentional explanatory/editorial emphasis, never for dense mod rows or table cells.

Typography should establish hierarchy through size, weight, and muted color rather than large headings. Existing key roles are `text-xs` for compact hints, `text-sm` for controls and metadata, `1rem`–`1.25rem` for row titles by density, and `1.1rem` for pack-table cells. Keep line heights tight enough for scanning but high enough to avoid clipped wrapped headers or translated strings.

Do not assume that a font loaded in CSS is already applied globally. Verify the target component’s actual `font-family` before documenting or changing a typography value.

## Color and theme

### Semantic theme tokens

Dark mode uses the following HSL tokens from `src/index.css` and `tailwind.config.js`:

```css
--background: 224 71% 4%;
--foreground: 213 31% 91%;
--muted: 223 47% 11%;
--muted-foreground: 215.4 16.3% 56.9%;
--accent: 216 34% 17%;
--accent-foreground: 210 40% 98%;
--popover: 224 71% 4%;
--popover-foreground: 215 20.2% 65.1%;
--border: 216 34% 17%;
--input: 216 34% 17%;
--card: 224 71% 4%;
--card-foreground: 213 31% 91%;
--primary: 210 40% 98%;
--primary-foreground: 222.2 47.4% 1.2%;
--secondary: 222.2 47.4% 11.2%;
--secondary-foreground: 210 40% 98%;
--destructive: 0 63% 31%;
--destructive-foreground: 210 40% 98%;
--ring: 216 34% 17%;
--radius: 0.5rem;
```

The body itself currently uses `rgb(38,38,38)` (`#262626`), while many surfaces use explicit Tailwind gray/slate classes and some components use the semantic tokens. A redesign should converge these into named roles without changing the current contrast hierarchy.

### Surface and state roles

- `#262626` is the recurring deep neutral for the selected navigation surface and page body; list rows use the same neutral family with stronger functional hover/active surfaces where specified.
- `#394250` is the blue-gray control/select surface.
- `#404040` is the mod-list header surface.
- `#525252` is a functional row hover/active surface.
- `gray-700`/`gray-800` are the primary dark control, menu, drawer, and viewer surfaces.
- Blue (`blue-500` through `blue-700`) is the main interaction accent: selection, focus, links, active controls, and load-order affordances where specified.
- Purple, green, and red distinguish file/run/success and failure/destructive action families. Keep those meanings stable.
- Slate text is the neutral light-text family. Use muted slate for metadata and counts, not for information that is required to complete an action.

Category colors are domain identity only: blue, emerald, red, amber, purple, rose, teal, orange, slate, white, black, lime, sky, and fuchsia are defined for category badges. They must not be reused as generic enabled, selected, warning, or destructive states.

### Borders, radius, and elevation

The Tailwind semantic radius roles are approximately `4px` (`sm`), `6px` (`md`), and `8px` (`lg`, from `--radius`). Use thin borders to define dense surfaces, with stronger borders only for focus, active selection, or menu separation. Shadows are functional depth cues for drawers, menus, modals, toolbars, and toasts; they should not be a general decoration.

## Icons and imagery

The interface uses `react-icons` from several established families. Keep icons optically aligned to their text and use the existing nominal sizes: approximately `1rem`/`1.25rem` for compact controls, `1.25rem`–`1.5rem` for navigation, and `20px`/`24px` where a modal or toolbar explicitly requires it.

- Icon-only controls require a tooltip or accessible name.
- Do not mix filled and outline icons arbitrarily within one action group.
- Use icons to reinforce pack provenance, deleted/merged/custom-folder status, sort direction, chevrons, close, and configuration state.
- Mod thumbnails are content and metadata. Keep their square aspect ratio and existing caps; do not add decorative image treatments or AI-generated artwork to the product shell.

## Motion

Motion is subtle, local, and functional:

- Gear hover uses a roughly `200ms` transition with a slight opacity/scale response.
- Drawer open/close uses opacity and translation over roughly `500ms`.
- Reorder feedback uses the existing `2.4s` highlight animation.
- AG Grid rows use `animateRows: false`; do not add broad row animations to large tables.

Future motion should explain a state change, preserve pointer/keyboard timing, and respect reduced-motion preferences. Do not animate every row, surface, or icon on hover.

## Performance and implementation rules

- The mod list uses `WindowScroller`, `AutoSizer`, `CellMeasurer`, and a virtualized list. Keep row height/floor values and overscan assumptions explicit. The current overscan is lower for thumbnail rows (`6`) than for text-only rows (`12`); preserve that measured trade-off unless the virtualization model changes with it.
- Category headings are measured as part of the list. Any new heading, banner, empty state, or inline warning must report its real height to the list measurement path.
- The viewer keeps feature panels mounted after first use and uses virtualized/large-table strategies. Do not replace those with `map`-rendered full datasets for visual convenience.
- Pack-table thresholds, fixed row heights, pinned-column behavior, and cell/header templates are part of the performance contract.
- Keep CSS grid templates shared between headers and rows. Avoid measuring text to calculate every column or adding nested card layouts inside every row.
- Preserve stable scroll positions when toggling a mod, closing a context menu, switching a dual-pane sort, or changing viewer selection.
- Prefer CSS state changes over React re-renders for hover, focus, and small visual transitions.
- Keep overlays portal-based/fixed where they are today so menus and tooltips do not change document layout.

## Current gaps to standardize

These are observed inconsistencies worth addressing in a future visual pass, without altering behavior:

1. Buttons use several ad hoc combinations of blue, purple, green, gray, and different compact heights. Map them to the shared size and action-family roles while preserving existing action meaning.
2. Fonts are self-hosted but the general UI does not have one clearly enforced family. Establish a component-level typography baseline and document exceptions.
3. Focus shadows are globally suppressed for several form controls. Add a consistent visible keyboard-focus ring that does not change layout.
4. Mod and viewer context menus do not all expose the same semantic roles or focus behavior. Consolidate menu primitives and retain their current placement, action order, and scroll behavior.
5. Explicit Tailwind gray/slate colors, body `#262626`, and semantic HSL tokens coexist. Create named surface/state roles gradually and verify contrast before replacing literals.
6. Navigation icons come from multiple icon families and have slightly different optical weights. Normalize alignment and perceived size without changing the icon’s meaning.
7. Z-index values are component-specific. Keep the current effective stacking order documented and centralize it only when doing so cannot put menus behind the title bar or modals.
8. The list, drawer, menus, toasts, and viewer each own scrolling in slightly different ways. Standardize scrollbar appearance and affordances while preserving each owner and its virtualization boundary.

## Do not

- Do not turn the mod list into cards, masonry, bento panels, or a dashboard.
- Do not add hero banners, gradients, glow, ornamental illustrations, or large empty whitespace.
- Do not hide persistent navigation or remove desktop keyboard affordances to imitate a mobile layout.
- Do not replace virtualized rows/tables with full-DOM rendering or animated list transitions.
- Do not remove right-click menus, multi-selection, direct table editing, pinned-column behavior, sort/filter controls, or load-order keyboard placement.
- Do not use category colors as global state colors.
- Do not rely on color, hover, opacity, or animation as the only state indication.
- Do not invent a drag/drop behavior for load-order placement when the current interaction uses an insertion placeholder and keyboard controls.
- Do not change row floors, table row heights, scroll ownership, or panel mounting as a visual-only refactor.
- Do not document unverified values as design tokens. When a value is not present in the implementation, label it as a recommendation or leave it open for a product decision.

## Reference implementation

The primary implementation references for this specification are:

- `src/app.tsx`, `src/appMain.tsx`, `src/components/TopBar.tsx`, and `src/components/Main.tsx` for shell geometry and mounted panels;
- `src/components/LeftSidebar.tsx`, `src/styles/LeftSidebar.css`, and `src/components/Sidebar.tsx` for navigation and utility controls;
- `src/components/ModRows.tsx`, `src/components/ModRow.tsx`, `src/components/ModListPane.tsx`, `src/components/ModListHeader.tsx`, and `src/components/ModListCategoryHeader.tsx` for list structure and interaction;
- `src/index.css` and `tailwind.config.js` for theme, typography, density, grid, and table tokens;
- `src/components/viewer/ModsViewer.tsx`, `src/components/viewer/PackTablesTreeView.tsx`, and `src/components/viewer/PackTablesTableView.tsx` for viewer surfaces and data-grid behavior;
- `src/flowbite/theme/default.ts`, `src/styles/selectStyle.ts`, `src/components/ModDropdown.tsx`, and `src/components/viewer/ContextMenuSubmenu.tsx` for shared control, menu, and overlay patterns.

When this document and a source implementation disagree, verify the source first. Update this document only when the intended behavior or visual contract is clear; do not use it as a reason to make unrelated production changes.
