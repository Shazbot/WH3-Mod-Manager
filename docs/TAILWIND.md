# Tailwind CSS

The renderer uses Tailwind CSS 4.3 through `@tailwindcss/postcss` in `postcss.config.js`. Tailwind handles imports and vendor prefixes; there is no separate Autoprefixer plugin. Renderer webpack builds run this pipeline through `postcss-loader`.

## Theme and sources

`src/index.css` owns the CSS theme, plugins, dark variant, and container utility. Its explicit sources cover `src/` and Flowbite React's package files. Automatic source detection is disabled so generated bundles, tests, and unrelated workspace files do not add classes to the shipped stylesheet.

`tailwind.config.js` loads `src/styles/tailwindPalette.json` through `@config`. This palette preserves the resolved Tailwind 3 and legacy Flowbite colors, including Flowbite's blue, green, and purple overrides. It is intentional: replacing these values with Tailwind 4's default palette would change the existing design. The visual contract remains `docs/DESIGN.md`.

Semantic colors and radii use `@theme inline`. This keeps references such as `hsl(var(--background))` and `var(--radius)` on the consuming element, so nested dark surfaces resolve their own tokens correctly. The default sans font stack, centered container geometry, pointer cursors, and border fallback also preserve the former behavior.

## Components and plugins

- `src/flowbite/runtime.ts` configures packaged Flowbite React for Tailwind 4 in all four renderers and DOM tests. `SidebarTooltip.tsx` resolves the exported tooltip theme through Flowbite's theme helper, so its utility conversions match the packaged components. Vendored `src/flowbite` themes use migrated source classes directly.
- The legacy `flowbite/plugin` remains responsible for the existing form and tooltip base styles. Its plugin API is compatible with the current Tailwind build; changing the legacy plugin is a separate visual migration.
- `tailwind-scrollbar` 4 supplies scrollbar geometry and pseudo-elements. Tailwind 4.3's native color utilities use `--tw-scrollbar-*`; the small bridge at the end of `src/index.css` passes those colors to the plugin's `--scrollbar-*` variables.
- `tailwindcss-animate` supplies the existing animation utilities. `tailwind-merge` is on its Tailwind 4-compatible major version.

Form focus suppression belongs in the `components` layer: it overrides plugin defaults while allowing explicit focus-ring utilities to win. Keep custom base styles out of unlayered CSS when they must yield to utilities.

Source classes use trailing important modifiers, renamed outline/shadow/word-wrap utilities, and slash color opacity. Existing gradients specify `/srgb` to preserve their interpolation. Disabled button states select complete translucent color classes rather than the removed `bg-opacity-*` and `text-opacity-*` utilities.

## Validation

`test/tailwindCss.node.test.ts` compiles the real stylesheet and checks action/surface colors, semantic token resolution, radii, translucent controls/backdrops, and scrollbar output. `test/flowbiteMigration.dom.test.tsx` checks the Tailwind runtime version and real dropdown, toast, update, and sidebar tooltip interactions. Run these alongside renderer builds and relevant DOM tests after changing the styling pipeline.
