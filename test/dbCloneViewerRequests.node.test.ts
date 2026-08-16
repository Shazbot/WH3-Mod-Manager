import { describe, expect, it, vi } from "vitest";

import {
  enqueueDBCloneViewerRequest,
  subscribeToDBCloneViewerRequests,
} from "../src/components/viewer/dbCloneViewerRequests";

describe("DB Clone viewer requests", () => {
  it("holds a buildings clone request until the viewer tabs subscribe", () => {
    const request = {
      packPath: "memory://buildings_clone",
      tables: [{ dbName: "building_levels_tables", dbSubname: "dbclone_" }],
    };
    const listener = vi.fn();

    enqueueDBCloneViewerRequest(request);
    const unsubscribe = subscribeToDBCloneViewerRequests(listener);

    expect(listener).toHaveBeenCalledWith(request);
    unsubscribe();
  });

  it("delivers later clone requests immediately and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDBCloneViewerRequests(listener);
    const request = {
      packPath: "memory://another_clone",
      tables: [{ dbName: "building_chains_tables", dbSubname: "dbclone_" }],
    };

    enqueueDBCloneViewerRequest(request);
    expect(listener).toHaveBeenCalledWith(request);

    unsubscribe();
    enqueueDBCloneViewerRequest({ packPath: "memory://not_delivered", tables: [] });
    expect(listener).toHaveBeenCalledTimes(1);

    // Drain the deliberately queued request so this module's singleton state cannot leak.
    subscribeToDBCloneViewerRequests(() => {})();
  });
});
