import React from "react";

import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { reactFlowNodeTypes } from "../../src/nodeGraph/nodeTypes";
import { getEditXmlFileValidationErrors } from "../../src/nodeGraph/nodes/renderers";

const makeNode = (onUpdateNodeData = vi.fn(), overrides: Record<string, unknown> = {}) => ({
  id: "edit_xml_1",
  type: "editxmlfile",
  position: { x: 0, y: 0 },
  data: {
    label: "Edit XML File",
    type: "editxmlfile",
    inputType: "PackFiles",
    outputType: "TableSelection",
    targetMode: "path",
    filePath: "",
    ignoreHierarchy: true,
    locatorSteps: [{ id: "locator_1", elementName: "*", attributes: [] }],
    action: "setAttributes",
    attributeEdits: [{ id: "attribute_1", name: "", newValue: "" }],
    replacementXml: "",
    onUpdateNodeData,
    ...overrides,
  },
});

const renderNode = (node = makeNode()) =>
  render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow fitView edges={[]} nodeTypes={reactFlowNodeTypes} nodes={[node as any]} />
      </ReactFlowProvider>
    </div>,
  );

describe("Edit XML File node", () => {
  it("rejects duplicate attribute names and invalid replacement fragments before saving", () => {
    const common = {
      targetMode: "path",
      filePath: "ui/test.xml",
      ignoreHierarchy: true,
      locatorSteps: [{ id: "locator", elementName: "*", attributes: [] }],
      replacementXml: "",
    } as const;

    expect(
      getEditXmlFileValidationErrors(
        {
          ...common,
          action: "setAttributes",
          attributeEdits: [
            { id: "first", name: "dock_offset", newValue: "one" },
            { id: "second", name: "dock_offset", newValue: "two" },
          ],
        },
        "PackFiles",
      ).map((error) => error.code),
    ).toContain("setAttributeDuplicateName");

    expect(
      getEditXmlFileValidationErrors(
        {
          ...common,
          action: "replaceElement",
          attributeEdits: [],
          replacementXml: "<one /><two />",
        },
        "PackFiles",
      ).map((error) => error.code),
    ).toContain("replacementInvalid");
  });

  it("opens with the safe authoring defaults", async () => {
    const view = renderNode();

    fireEvent.click(await view.findByText("Edit", { selector: "button" }));

    const dialog = await view.findByRole("dialog");
    expect(within(dialog).getByLabelText("Exact XML path")).toHaveValue("");
    expect(within(dialog).getByLabelText("Element name 1")).toHaveValue("*");
    expect(within(dialog).getByLabelText("Ignore hierarchy (start in <components>)")).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(within(dialog).getByText(/must match exactly one element/i)).toBeInTheDocument();
  });

  it("builds nested locator steps and commits one valid attribute edit", async () => {
    const onUpdateNodeData = vi.fn();
    const view = renderNode(makeNode(onUpdateNodeData));

    fireEvent.click(await view.findByText("Edit", { selector: "button" }));
    const dialog = await view.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Exact XML path"), {
      target: { value: "ui/campaign ui/hud_campaign.twui.xml" },
    });
    fireEvent.change(within(dialog).getByLabelText("Element name 1"), {
      target: { value: "button_group_management" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "+ Add step" }));
    fireEvent.change(within(dialog).getByLabelText("Element name 2"), {
      target: { value: "LayoutEngine" },
    });
    fireEvent.change(within(dialog).getByLabelText("Attribute name 1"), {
      target: { value: "dock_offset" },
    });
    fireEvent.change(within(dialog).getByLabelText("New value 1"), {
      target: { value: "-180.00,-190.00" },
    });

    const done = within(dialog).getByRole("button", { name: "Done" });
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);

    expect(onUpdateNodeData).toHaveBeenCalledWith(
      expect.objectContaining({
        targetMode: "path",
        filePath: "ui/campaign ui/hud_campaign.twui.xml",
        ignoreHierarchy: true,
        locatorSteps: [
          expect.objectContaining({ elementName: "button_group_management" }),
          expect.objectContaining({ elementName: "LayoutEngine" }),
        ],
        action: "setAttributes",
        attributeEdits: [expect.objectContaining({ name: "dock_offset", newValue: "-180.00,-190.00" })],
      }),
    );
    await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks before discarding a dirty modal draft", async () => {
    const view = renderNode();

    fireEvent.click(await view.findByText("Edit", { selector: "button" }));
    let dialog = await view.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Exact XML path"), { target: { value: "ui/test.xml" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(await view.findByText("Discard XML edit changes?")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
    dialog = await view.findByRole("dialog");
    expect(within(dialog).getByLabelText("Exact XML path")).toHaveValue("ui/test.xml");

    fireEvent.click(dialog);
    fireEvent.click(await view.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
