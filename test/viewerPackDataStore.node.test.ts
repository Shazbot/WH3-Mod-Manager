import { afterEach, describe, expect, it } from "vitest";

import { clearPackDataStoreForPack, doneRequests, packDataStore } from "../src/components/viewer/packDataStore";
import type { Pack } from "../src/packFileTypes";

describe("viewer pack data cache cleanup", () => {
  afterEach(() => {
    delete packDataStore["/mods/closed.pack"];
    delete packDataStore["/mods/remaining.pack"];
    delete doneRequests["/mods/closed.pack"];
    delete doneRequests["/mods/remaining.pack"];
  });

  it("removes only the selected pack's data and request markers", () => {
    const closedPackPath = "/mods/closed.pack";
    const remainingPackPath = "/mods/remaining.pack";
    packDataStore[closedPackPath] = {} as Pack;
    packDataStore[remainingPackPath] = {} as Pack;
    doneRequests[closedPackPath] = ["db\\closed\\data__"];
    doneRequests[remainingPackPath] = ["db\\remaining\\data__"];

    clearPackDataStoreForPack(closedPackPath);

    expect(packDataStore[closedPackPath]).toBeUndefined();
    expect(doneRequests[closedPackPath]).toBeUndefined();
    expect(packDataStore[remainingPackPath]).toBeDefined();
    expect(doneRequests[remainingPackPath]).toEqual(["db\\remaining\\data__"]);
  });
});
