# React Compiler

The renderer is built with [React Compiler](https://react.dev/learn/react-compiler), which memoizes components and hooks automatically. This page covers how it is wired in, what stops it from compiling a component, how to fix that, and when to opt out.

As of 2026-10-30 every renderer component compiles (307 functions across 195 `.tsx` files) except the opt-outs listed in `scripts/react-compiler.cjs`.

## How it is wired in

| Where                        | What                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webpack.renderer.config.js` | `.tsx` files run through `babel-loader` (`@babel/plugin-syntax-typescript` + `babel-plugin-react-compiler`, `target: "18"`), then `esbuild-loader`. `.ts` files and the main and preload builds use esbuild only. |
| `react-compiler-runtime`     | The memo cache runtime React 18 needs. React 19 has it built in.                                                                                                                                                  |
| `vitest.config.mjs`          | The `reactCompiler` plugin compiles `src/**/*.tsx` before the TypeScript transform, so DOM tests run the same compiled components as the app.                                                                     |
| `eslint.config.mjs`          | The compiler's lint rules (`react-hooks/refs`, `immutability`, `preserve-manual-memoization`, ...) are enabled as warnings.                                                                                       |
| `scripts/react-compiler.cjs` | The allowlist of components the compiler may skip, and the build logger.                                                                                                                                          |
| `yarn check:react-compiler`  | Compiles every renderer component and fails if the compiler skips anything the allowlist does not cover, or if an allowlist entry is now larger than needed. Takes about a minute and a half.                     |

The compiler never breaks a component it cannot handle; it **skips** it and the component runs as written. That makes a new skip silent, so two things report it:

- The renderer build prints `[react-compiler] Skipped the component at <file>:<line>: <reason>` for a skipped component outside the allowlist. Babel caches its output, so this shows when a file is first compiled after an edit, which is when a new skip appears.
- `yarn check:react-compiler` checks the whole renderer. Run it after changing components.

The compiler must run on the TSX source. Once TypeScript has turned JSX into `createElement` calls, the compiler reads `ref` props as refs passed to a function and skips the component. In the Vitest plugin, do not set Babel's `retainLines`: it moves JSX text onto a new line, where the trailing space is dropped ("+ Add" renders as "+Add").

## What stops a component from compiling

Each of these makes the compiler skip the **whole** component or hook, not just the line.

### Code it cannot lower

| Not compiled                                                             | Write instead                                                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `try { } finally { }`, `try` without `catch`                             | `runGuarded(work, { onError, onFinally })` or `runGuardedSync(...)` from `src/utility/runGuarded.ts`              |
| `throw` inside `try`                                                     | the same, or move the parsing or validation into a module-level helper that returns a result                      |
| Optional chaining, `? :`, `&&` or `??` inside `try`                      | the same: the work runs in a callback, where these are fine                                                       |
| `counter++` on a module-level variable                                   | a module function, e.g. `const takeNextTabId = () => nextTabId++;`                                                |
| `i++` on a loop variable that a closure captures                         | copy it per iteration: `for (let row = 0; ...; row++) { const i = row; ... }`                                     |
| `a[key]                                                                  |                                                                                                                   | = []` | `if (!a[key]) a[key] = [];` |
| Computed keys from a template literal or `as`: ``{ [`${x}--open`]: v }`` | a plain string key, or compute the key into a `const` first. CSS variables: `{ "--x": v } as React.CSSProperties` |
| `useMemo(makeSelector, [])`                                              | `useMemo(() => makeSelector(), [])`                                                                               |
| A default parameter that reads a ref: `(x = someRef.current) => ...`     | an optional parameter resolved in the body: `const value = x === undefined ? someRef.current : x;`                |
| An `eslint-disable` for a `react-hooks` rule anywhere in the component   | fix what the rule reports (see below), or opt out                                                                 |

`runGuarded` rethrows when there is no `onError`, as a plain `try/finally` would. When converting a `try`, keep its behaviour: a `return` inside the callback only leaves the callback, and `break`/`continue` cannot cross it. Move the work into a callback only when the `try` is the last statement of its function, or when nothing inside it returns early.

### Rules of React it enforces

- **Refs are not read or written during render.** Update a latest-value ref in a layout effect:

  ```tsx
  const latestRef = useRef(value);
  useLayoutEffect(() => {
    latestRef.current = value;
  });
  ```

  If render needs the value, it is state, not a ref. A per-instance lazy initial value goes through `useState(() => ...)`. A pure memo cache that render reads can live at module level, behind a function (see `getPreferredTreeTabCached` in `ModsViewer.tsx`).

- **Render-time values are `const`.** A `let` reassigned later in render (`let skills = ...; skills = skills.filter(...)`) makes the compiler distrust every callback that uses it. In `SkillsView` two of them caused about 60 errors, including useState setters reported as missing dependencies. Build each stage as its own `const`.
- **`useCallback` and `useMemo` list every value they read.** The compiler cannot keep a manual memo whose dependencies are missing; this is also where stale closures hide. React Flow's `setNodes`/`setEdges` must be listed, since the compiler cannot tell they are stable. Read an optional field into a local first (`const allSkills = editorData?.allSkills;`), so the dependency matches what the body reads. Extra dependencies are allowed; missing ones are not.
- **A callback does not refer to itself** while it is being declared. Use a local function declaration inside the callback for a loop such as `requestAnimationFrame`.
- **Hooks stay above every early return.** A hook after a conditional return also crashes React when the condition changes ("Rendered fewer hooks than expected").
- **A function that reads a ref is not passed into a call made during render.** Pass it as a JSX prop, or wrap it in `useEventCallback` (`src/hooks.ts`), which returns a stable function that always calls the latest version. A JSX `ref` prop inside such a call counts too. For floating-ui, destructure the setters once after `useFloating`:

  ```tsx
  const { refs, floatingStyles } = useFloating(...);
  const { setReference, setFloating } = refs;
  ```

Effect dependency warnings (`exhaustive-deps` on `useEffect`, `set-state-in-effect`) are lint findings only and do not stop compilation.

## Opting out

Add `"use no memo"` as the first statement of a component, with a comment saying why, and add the file to `allowedSkips` in `scripts/react-compiler.cjs`. Opt out when a component depends on an object that changes **in place** while keeping its identity. The compiler assumes values do not change in place, so it would keep serving the first result:

| Component                                        | Why                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `HeadlessVirtualTree` (`PackTablesTreeView.tsx`) | Headless Tree's `tree` object is rebuilt in place; `tree.getItems()` would stay empty.      |
| `UnitPainterTextureEditor`                       | Texture buffers are edited in place; `historyVersion` is a dependency the memo never reads. |
| `VisualsModelPreview`                            | The three.js scene and animation actions are changed in place through refs.                 |
| `ThemeContext` (vendored flowbite)               | `useThemeMode` calls hooks conditionally behind a file-wide `eslint-disable`.               |

A dependency listed only to signal "something changed" (as with `historyVersion`) is a sign of this pattern: the compiler memoizes on what the code reads, and drops the signal.

## Checking a single file

`yarn check:react-compiler` lists each skipped function with its line and reason. For one file, the same logger works from Node:

```js
const babel = require("@babel/core");
babel.transformFileSync("src/components/Example.tsx", {
  babelrc: false,
  configFile: false,
  plugins: [
    ["@babel/plugin-syntax-typescript", { isTSX: true }],
    [
      "babel-plugin-react-compiler",
      {
        target: "18",
        logger: {
          logEvent: (_file, event) =>
            console.log(event.kind, event.fnLoc?.start?.line, event.detail?.options?.reason ?? ""),
        },
      },
    ],
  ],
});
```

`CompileSuccess` means the function compiled; `CompileError` or `CompileSkip` means it was skipped. The ESLint `react-hooks/preserve-manual-memoization` message names the mismatched dependency, which the compiler's own message does not.
