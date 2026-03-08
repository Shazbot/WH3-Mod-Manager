import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const isDomEnvironment = typeof window !== "undefined" && typeof document !== "undefined";

if (isDomEnvironment) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });

  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: vi.fn(),
  });

  if (!window.URL.createObjectURL) {
    Object.defineProperty(window.URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:mock-url"),
    });
  }

  if (!window.URL.revokeObjectURL) {
    Object.defineProperty(window.URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(),
    });
  }

  window.api =
    window.api ??
    (({
      getDBNameToDBVersions: vi.fn(),
      getDefaultTableVersions: vi.fn(),
    } as unknown) as NonNullable<Window["api"]>);
}

afterEach(() => {
  cleanup();
});
