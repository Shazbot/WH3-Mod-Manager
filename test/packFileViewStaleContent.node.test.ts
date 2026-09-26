import { describe, expect, it } from "vitest";

/**
 * Reproduces the ordering that made the file viewer show one file behind.
 *
 * Switching files leaves the previous file's payload in state until the load effect resolves, and
 * every effect in that render sees the stale value. The hydration effect ran first with the old
 * text, stamped the new file as hydrated, and then refused to hydrate again when the real content
 * arrived.
 *
 * These model the two effects rather than mounting the component, which needs CodeMirror, redux and
 * the pack IPC. What is being pinned is the guard, not React.
 */

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; fileKey: string; text?: string }
  | { status: "error"; error: string };

/** The hydration effect, as written in PackFileView. */
const hydrate = (
  loadState: LoadState,
  openedFileKey: string,
  hydratedKeyRef: { current: string | null },
  workingText: string | undefined,
  guardOnFileKey: boolean,
) => {
  if (loadState.status !== "loaded") return workingText;
  if (guardOnFileKey && loadState.fileKey !== openedFileKey) return workingText;

  const shouldHydrate = hydratedKeyRef.current !== openedFileKey || workingText == null;
  if (!shouldHydrate) return workingText;

  hydratedKeyRef.current = openedFileKey;
  return loadState.text ?? "";
};

/**
 * Opening B while A's payload is still in state: one render with the stale payload, then one with
 * B's. Returns what the editor would end up holding.
 */
const openBAfterA = (guardOnFileKey: boolean) => {
  const hydratedKeyRef = { current: "pack|a.lua" as string | null };
  let workingText: string | undefined = "A contents";

  // Render 1: filePath is already B, but loadState still describes A.
  workingText = hydrate(
    { status: "loaded", fileKey: "pack|a.lua", text: "A contents" },
    "pack|b.lua",
    hydratedKeyRef,
    workingText,
    guardOnFileKey,
  );
  // Render 2: B's content has landed.
  workingText = hydrate(
    { status: "loaded", fileKey: "pack|b.lua", text: "B contents" },
    "pack|b.lua",
    hydratedKeyRef,
    workingText,
    guardOnFileKey,
  );

  return workingText;
};

describe("file viewer content follows the file", () => {
  it("shows the file that was opened", () => {
    expect(openBAfterA(true)).toBe("B contents");
  });

  it("without the fileKey guard it keeps the previous file, which was the bug", () => {
    expect(openBAfterA(false)).toBe("A contents");
  });

  it("keeps edits to the file that is open", () => {
    const hydratedKeyRef = { current: "pack|b.lua" as string | null };
    const edited = "B contents, edited";

    expect(
      hydrate(
        { status: "loaded", fileKey: "pack|b.lua", text: "B contents" },
        "pack|b.lua",
        hydratedKeyRef,
        edited,
        true,
      ),
    ).toBe(edited);
  });

  it("hydrates the first file opened, when nothing was loaded before", () => {
    const hydratedKeyRef = { current: null as string | null };

    expect(
      hydrate(
        { status: "loaded", fileKey: "pack|a.lua", text: "A contents" },
        "pack|a.lua",
        hydratedKeyRef,
        undefined,
        true,
      ),
    ).toBe("A contents");
  });

  it("does not render a payload belonging to the file just left", () => {
    // Mirrors the render guard: a loaded state whose key does not match reads as still loading.
    const isStale = (loadState: LoadState, openedFileKey: string) =>
      loadState.status === "loaded" && loadState.fileKey !== openedFileKey;

    expect(isStale({ status: "loaded", fileKey: "pack|a.lua", text: "A" }, "pack|b.lua")).toBe(true);
    expect(isStale({ status: "loaded", fileKey: "pack|b.lua", text: "B" }, "pack|b.lua")).toBe(false);
  });
});
