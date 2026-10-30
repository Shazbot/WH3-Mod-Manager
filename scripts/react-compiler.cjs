// Shared React Compiler settings for the renderer build (webpack.renderer.config.js) and the coverage check
// (scripts/check-react-compiler.cjs). See docs/REACT_COMPILER.md.
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

// Components the compiler is allowed to skip, keyed by file, with how many functions in that file it may skip.
// Anything else it skips is reported: by the build as a warning, and by `yarn check:react-compiler` as a failure.
const allowedSkips = {
  "src/components/viewer/PackTablesTreeView.tsx": {
    count: 1,
    reason: 'HeadlessVirtualTree opts out ("use no memo"): Headless Tree changes its tree object in place.',
  },
  "src/components/UnitPainterTextureEditor.tsx": {
    count: 1,
    reason: 'Opts out ("use no memo"): texture buffers are edited in place and signalled by historyVersion.',
  },
  "src/components/VisualsModelPreview.tsx": {
    count: 1,
    reason: 'Opts out ("use no memo"): the three.js scene is changed in place through refs.',
  },
  "src/flowbite/components/Flowbite/ThemeContext.tsx": {
    count: 3,
    reason: "Vendored flowbite: useThemeMode calls hooks conditionally behind a file-wide eslint-disable.",
  },
};

const isSkipEvent = (event) =>
  event.kind === "CompileError" || event.kind === "CompileSkip" || event.kind === "PipelineError";

const toRepoPath = (filename) => path.relative(repoRoot, filename).split(path.sep).join("/");

// One line describing why the compiler skipped a function.
const describeSkip = (event) => {
  const detail = event.detail?.options ?? event.detail ?? {};
  const reason = String(detail.reason ?? detail.description ?? event.reason ?? event.kind).replace(/\s+/g, " ");
  const line = detail.loc?.start?.line ?? JSON.stringify(event.detail ?? {}).match(/"line":(\d+)/)?.[1];
  return line ? `${reason} (line ${line})` : reason;
};

// A babel-plugin-react-compiler logger for the build: warns once per skipped function outside the allowlist.
const createBuildLogger = () => {
  const reported = new Set();
  return {
    logEvent(filename, event) {
      if (!filename || !isSkipEvent(event)) return;
      const file = toRepoPath(filename);
      if (allowedSkips[file]) return;
      const functionLine = event.fnLoc?.start?.line ?? "?";
      const key = `${file}:${functionLine}`;
      if (reported.has(key)) return;
      reported.add(key);
      console.warn(
        `[react-compiler] Skipped the component at ${file}:${functionLine}: ${describeSkip(event)}. ` +
          "See docs/REACT_COMPILER.md.",
      );
    },
  };
};

module.exports = { allowedSkips, createBuildLogger, describeSkip, isSkipEvent, repoRoot, toRepoPath };
