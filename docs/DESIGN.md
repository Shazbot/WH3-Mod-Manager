# WH3 Mod Manager — Design System

## Product

A desktop power-user application for managing Total War: Warhammer III mods.

This is not a website, marketing application, mobile application, or generic SaaS dashboard.

The interface should feel like purpose-built desktop software.

Primary qualities:

* Dense
* Fast
* Precise
* Utilitarian
* Modern without being decorative
* Comfortable for long sessions
* Easy to scan with hundreds or thousands of mods

Visual references may include VS Code, JetBrains IDEs, Steam, Mod Organizer 2, and other high-quality desktop productivity applications.

Do not directly copy another application's visual identity.

## Core principle

Information density and usability take precedence over decorative design.

The user should be able to see a large amount of useful information without the interface feeling cluttered.

Do not make the interface more spacious merely to make it look modern.

---

## Layout

Use a desktop application shell rather than a webpage layout.

Important interface regions should be visually distinct primarily through:

* subtle background differences
* borders/dividers
* spacing
* typography

Do not place every interface region inside a card.

Prefer persistent toolbars, sidebars, panes, tables, status bars and context menus where appropriate.

Avoid large empty areas.

Avoid oversized headers.

Avoid excessive padding.

---

## Density

Controls should be compact enough for a mouse-and-keyboard desktop workflow.

Typical targets:

* standard toolbar/control height: approximately 30–36px
* dense table/list rows: approximately 28–34px
* compact icon buttons
* small but readable gaps between related controls
* larger spacing only when separating logical groups

Density should never make hit targets ambiguous or text difficult to read.

---

## Typography

Use one primary UI typeface unless a monospace font is necessary for technical data.

Typography hierarchy should be restrained.

Prefer differences in:

* weight
* size
* contrast

rather than dramatically different font sizes.

Large webpage-style headings should generally not appear inside application screens.

Technical identifiers, file paths and similar data may use monospace where useful.

---

## Color

The primary interface is dark.

Use neutral dark surfaces with enough separation to distinguish panes without making every surface a different color.

Use one primary accent color.

Accent color is reserved for:

* current selection
* primary actions
* active navigation
* important interactive focus
* meaningful highlighted states

Do not use accent colors decoratively.

Success, warning and error colors communicate state and should not compete with the primary accent.

Avoid gradients unless a very specific component genuinely requires one.

---

## Borders and surfaces

Prefer subtle 1px separators and surface changes.

Avoid:

* large floating cards
* heavy drop shadows
* glassmorphism
* excessive rounded rectangles
* glowing controls
* decorative gradients

Dialogs and menus may use modest elevation where necessary to establish hierarchy.

Corner radii should be restrained and consistent.

---

## Mod list

The mod list is the application's primary working surface.

It must remain highly scannable at high row counts.

Important information should be recognizable without opening an individual mod.

Selection, enabled/disabled state, hover state, warnings and errors must remain visually distinct from one another.

Do not convert table rows into cards.

Do not increase row height significantly for aesthetic reasons.

Do not remove useful columns simply to create whitespace.

The existing virtualized/table implementation and its behavior must be preserved unless a separate task explicitly requests changes.

---

## Navigation

Primary navigation should be persistent and compact.

Current location must be obvious without requiring large decorative treatments.

Icons should have consistent optical size and stroke weight.

Prefer icons accompanied by text where icon meaning could be ambiguous.

Do not invent unfamiliar icons for important actions when a standard icon exists.

---

## Controls

Buttons should clearly distinguish:

1. Primary action
2. Normal action
3. Destructive action
4. Icon/utility action

Most desktop application actions should not look like large call-to-action buttons.

Toolbar actions should remain compact.

Hover, active, disabled and keyboard-focus states must be implemented.

---

## Context menus

Context menus are important power-user UI.

They should be:

* compact
* quickly scannable
* grouped logically
* capable of showing keyboard shortcuts
* visually clear about disabled items
* capable of nested actions where necessary

Do not replace appropriate context-menu actions with permanent buttons merely to make them discoverable.

---

## Dialogs

Dialogs should be task-focused.

Avoid excessive explanatory prose.

Use clear hierarchy:

title → necessary information → controls → actions

Destructive operations require appropriate distinction and confirmation.

---

## Interaction

Preserve desktop conventions.

Support existing:

* keyboard shortcuts
* right-click actions
* multi-selection
* drag-and-drop
* sorting
* filtering
* resizing
* tooltips
* selection behavior

A visual redesign must not silently alter application behavior.

---

## Motion

Motion should be subtle and functional.

Use animation primarily to communicate:

* opening/closing
* state changes
* movement
* feedback

Avoid decorative animation.

Frequent operations should feel instantaneous.

---

## Do not

Do not turn the application into a generic SaaS dashboard.

Do not use a bento-grid layout.

Do not wrap every section in a rounded card.

Do not use large hero-like headings.

Do not use excessive whitespace.

Do not make desktop controls mobile-sized.

Do not replace dense tables with cards.

Do not use gradients or glow effects merely to make the UI look modern.

Do not hide frequently used actions behind extra clicks without a usability reason.

Do not modify application architecture solely to achieve a visual effect.

Do not replace mature existing controls with custom implementations unless specifically requested.

---

## Implementation rule

Existing application behavior, architecture and performance characteristics are constraints.

When improving an existing component:

1. Understand its behavior first.
2. Preserve its public interface where practical.
3. Separate visual changes from functional changes.
4. Reuse existing primitives before creating new ones.
5. Extract reusable design primitives only when repetition justifies them.

Visual polish must not come at the cost of responsiveness or information density.
