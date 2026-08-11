import { describe, expect, it } from "vitest";

import appReducer, { selectFlowFile } from "../src/appSlice";
import initialState from "../src/initialAppState";

describe("node editor flow selection", () => {
  it("can detach a new graph from a file while retaining its pack", () => {
    const packPath = "K:\\mods\\owner.pack";
    const flowFile = "whmmflows\\flow.json";
    const openState = appReducer(initialState, selectFlowFile({ packPath, flowFile }));
    const blankState = appReducer(
      openState,
      selectFlowFile({ packPath, flowFile: undefined }),
    );

    expect(blankState.currentFlowFileSelection).toBeUndefined();
    expect(blankState.currentFlowFilePackPath).toBe(packPath);

    const reopenedState = appReducer(blankState, selectFlowFile({ packPath, flowFile }));
    expect(reopenedState.currentFlowFileSelection).toBe(flowFile);
  });
});
