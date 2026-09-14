import { describe, expect, it, vi } from "vitest";

import { applyEditXmlFile, isSingleXmlElement, parseXmlWithOffsets } from "../../src/nodeGraph/editXmlFile";
import { executeNodeAction } from "../../src/nodeExecutor";
import type { PackedFile } from "../../src/packFileTypes";

vi.mock("@mongodb-js/zstd", () => ({
  decompress: vi.fn(async (input: Uint8Array) => input),
}));
vi.mock("electron-is-dev", () => ({
  default: false,
}));

const locator = (elementName: string, attributes: Array<{ name: string; value: string }> = []) => [
  { id: "step", elementName, attributes: attributes.map((attribute, index) => ({ ...attribute, id: `a${index}` })) },
];

const setAttributes = (sourceText: string, overrides: Record<string, unknown>) =>
  applyEditXmlFile(sourceText, {
    ignoreHierarchy: false,
    locatorSteps: locator("target") as any,
    action: "setAttributes",
    attributeEdits: [{ id: "edit", name: "new", newValue: "value" }],
    replacementXml: "",
    ...overrides,
  } as any);

const tableFor = (name: string, text: string): DBTablesNodeTable => {
  const buffer = Buffer.from(text, "utf8");
  return {
    name,
    fileName: name,
    sourceFile: { name: "source.pack", path: "source.pack" },
    table: { name, file_size: buffer.length, start_pos: 0, buffer } as PackedFile,
    outputFileName: name,
  };
};

describe("Edit XML File structural runtime", () => {
  it("searches components, excludes hierarchy, and allows wildcard descendants", () => {
    const result = applyEditXmlFile(
      '<root><hierarchy><target id="wrong" /></hierarchy><components><group><target id="right" /></group></components></root>',
      {
        ignoreHierarchy: true,
        locatorSteps: locator("*", [{ name: " id ", value: "right" }]) as any,
        action: "setAttributes",
        attributeEdits: [{ id: "edit", name: "new", newValue: "ok" }],
        replacementXml: "",
      },
    );
    expect(result.success).toBe(true);
    expect(result.text).toContain('<target id="right" new="ok" />');
    expect(result.text).toContain('<target id="wrong" />');
  });

  it("searches hierarchy when the document-wide mode is selected", () => {
    const result = applyEditXmlFile("<root><hierarchy><target /></hierarchy></root>", {
      ignoreHierarchy: false,
      locatorSteps: locator("target") as any,
      action: "setAttributes",
      attributeEdits: [{ id: "edit", name: "found", newValue: "yes" }],
      replacementXml: "",
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe('<root><hierarchy><target found="yes" /></hierarchy></root>');
  });

  it("searches every descendant at each hop and supports multiple intermediate matches", () => {
    const result = applyEditXmlFile(
      '<root><branch><wrapper><target id="a" /></wrapper></branch><branch><wrapper><target id="b" /></wrapper></branch></root>',
      {
        ignoreHierarchy: false,
        locatorSteps: locator("branch").concat(locator("target", [{ name: "id", value: "b" }])) as any,
        action: "replaceElement",
        attributeEdits: [],
        replacementXml: "<replacement />",
      },
    );
    expect(result.success).toBe(true);
    expect(result.text).toBe(
      '<root><branch><wrapper><target id="a" /></wrapper></branch><branch><wrapper><replacement /></wrapper></branch></root>',
    );
  });

  it("rejects zero and multiple final matches atomically", () => {
    const sourceText = "<root><target /><target /></root>";
    const multiple = setAttributes(sourceText, {});
    expect(multiple.success).toBe(false);
    expect(multiple.text).toBeUndefined();
    const zero = setAttributes(sourceText, { locatorSteps: locator("missing") });
    expect(zero.success).toBe(false);
    expect(zero.text).toBeUndefined();
  });

  it("preserves BOM, quote style, multiline formatting, and self-closing syntax", () => {
    const sourceText = "\uFEFF<root>\n  <target old='1'\n    keep=\"yes\"\n  />\n</root>";
    const result = setAttributes(sourceText, {
      locatorSteps: locator("target", [{ name: "old", value: "1" }]),
      attributeEdits: [
        { id: "one", name: "old", newValue: "2" },
        { id: "two", name: "added", newValue: "3" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe("\uFEFF<root>\n  <target old='2'\n    keep=\"yes\"\n    added='3'\n  />\n</root>");
  });

  it("accepts encoded ampersands when parsing XML attributes", () => {
    const result = setAttributes('<root><target expression="left &amp;&amp; right" /></root>', {
      locatorSteps: locator("target", [{ name: "expression", value: "left && right" }]),
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe('<root><target expression="left &amp;&amp; right" new="value" /></root>');
  });

  it("adds missing attributes on a matching-indented line for multiline tags", () => {
    const normal = setAttributes('<root>\n  <target\n    old="1">value</target>\n</root>', {
      attributeEdits: [{ id: "edit", name: "added", newValue: "2" }],
    });
    expect(normal.success).toBe(true);
    expect(normal.text).toBe('<root>\n  <target\n    old="1"\n    added="2">value</target>\n</root>');

    const selfClosing = setAttributes('<root>\n  <target\n    old="1"/>\n</root>', {
      attributeEdits: [{ id: "edit", name: "added", newValue: "2" }],
    });
    expect(selfClosing.success).toBe(true);
    expect(selfClosing.text).toBe('<root>\n  <target\n    old="1"\n    added="2"/>\n</root>');
  });

  it("rejects malformed source and incomplete or duplicate mutation config", () => {
    expect(setAttributes("<root><target></root>", {}).success).toBe(false);
    expect(
      setAttributes("<root><target /></root>", {
        attributeEdits: [
          { id: "one", name: "new", newValue: "1" },
          { id: "two", name: "new", newValue: "2" },
        ],
      }).success,
    ).toBe(false);
    expect(
      setAttributes("<root><target /></root>", {
        attributeEdits: [{ id: "one", name: "1bad", newValue: "1" }],
      }).success,
    ).toBe(false);
  });

  it("rejects CDATA outside an element and misplaced or duplicate doctypes", () => {
    const config = {
      ignoreHierarchy: false,
      locatorSteps: locator("target") as any,
      action: "setAttributes",
      attributeEdits: [{ id: "edit", name: "found", newValue: "yes" }],
      replacementXml: "",
    };
    expect(applyEditXmlFile("<![CDATA[text]]><root><target /></root>", config).success).toBe(false);
    expect(applyEditXmlFile("<root><![CDATA[text]]><target /></root>", config).success).toBe(true);
    expect(applyEditXmlFile("<root><target /></root><!DOCTYPE root>", config).success).toBe(false);
    expect(applyEditXmlFile("<!DOCTYPE root><!DOCTYPE root><root><target /></root>", config).success).toBe(false);
    expect(applyEditXmlFile("<root><!DOCTYPE root><target /></root>", config).success).toBe(false);
  });

  it("validates one replacement element and inserts its bytes verbatim", () => {
    expect(isSingleXmlElement("<a />")).toBe(true);
    expect(isSingleXmlElement("<a /><b />")).toBe(false);
    expect(isSingleXmlElement("text")).toBe(false);
    const replacement = "<new attr='raw'>  keep\n  bytes </new>";
    const result = applyEditXmlFile("<root><target /></root>", {
      ignoreHierarchy: false,
      locatorSteps: locator("target") as any,
      action: "replaceElement",
      attributeEdits: [],
      replacementXml: replacement,
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe(`<root>${replacement}</root>`);
  });

  it("reports source offsets for all parsed elements", () => {
    const sourceText = "<root><child /></root>";
    const parsed = parseXmlWithOffsets(sourceText);
    expect(sourceText.slice(parsed.root.start, parsed.root.end)).toBe(sourceText);
    expect(parsed.elements.map((element) => element.name)).toEqual(["root", "child"]);
  });

  it("executes path and input modes atomically and preserves an unchanged output", async () => {
    const sourceFiles = [{ name: "source.pack", path: "source.pack", loaded: true }];
    const input: DBTablesNodeData = {
      type: "TableSelection",
      tables: [tableFor("UI\\Campaign\\hud.xml", "<root><button /></root>")],
      sourceFiles,
      tableCount: 1,
    };
    const config = {
      targetMode: "path",
      filePath: "ui/campaign/hud.xml",
      ignoreHierarchy: false,
      locatorSteps: locator("button"),
      action: "setAttributes",
      attributeEdits: [{ id: "edit", name: "dock_offset", newValue: "-180.00,-190.00" }],
      replacementXml: "",
    };

    const first = await executeNodeAction({
      nodeId: "xml-one",
      nodeType: "editxmlfile",
      textValue: "",
      inputData: input,
      config,
    });
    expect(first.success).toBe(true);
    const firstOutput = first.data as DBTablesNodeData;
    expect(firstOutput.tables).toHaveLength(1);
    expect(firstOutput.tables[0].table.buffer?.toString("utf8")).toBe(
      '<root><button dock_offset="-180.00,-190.00" /></root>',
    );
    expect(firstOutput.sourceFiles).toBe(sourceFiles);
    expect(firstOutput.tables[0].outputFileName).toBe("UI\\Campaign\\hud.xml");

    const second = await executeNodeAction({
      nodeId: "xml-two",
      nodeType: "editxmlfile",
      textValue: "",
      inputData: firstOutput,
      config: {
        targetMode: "input",
        filePath: "",
        ignoreHierarchy: false,
        locatorSteps: locator("button"),
        action: "replaceElement",
        attributeEdits: [],
        replacementXml: '<LayoutEngine dock_offset="-180.00,-190.00" />',
      },
    });
    expect(second.success).toBe(true);
    expect((second.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8")).toBe(
      '<root><LayoutEngine dock_offset="-180.00,-190.00" /></root>',
    );

    const unchanged = await executeNodeAction({
      nodeId: "xml-unchanged",
      nodeType: "editxmlfile",
      textValue: "",
      inputData: {
        ...input,
        tables: [tableFor("ui/campaign/hud.xml", "<root><button /></root>")],
      },
      config,
    });
    expect(unchanged.success).toBe(true);
    expect((unchanged.data as DBTablesNodeData).tables).toHaveLength(1);

    const multiFile = await executeNodeAction({
      nodeId: "xml-multi",
      nodeType: "editxmlfile",
      textValue: "",
      inputData: { ...input, tables: [...input.tables, tableFor("ui/campaign/hud.xml", "<root />")] },
      config,
    });
    expect(multiFile.success).toBe(false);
    expect(multiFile.data).toBeUndefined();
  });

  it("chains the parent attribute edit and nested LayoutEngine replacement", async () => {
    const original = `<layout version="142">
  <hierarchy><button_group_management dock_offset="unchanged" /></hierarchy>
  <components>
    <button_group_management dock_offset="-64.00,-80.00">
      <wrapper>
        <LayoutEngine type="RadialList" radius="95" />
      </wrapper>
    </button_group_management>
  </components>
</layout>`;
    const input: DBTablesNodeData = {
      type: "TableSelection",
      tables: [tableFor("ui\\campaign ui\\hud_campaign.twui.xml", original)],
      sourceFiles: [],
      tableCount: 1,
    };

    const parentEdit = await executeNodeAction({
      nodeId: "xml-parent",
      nodeType: "editxmlfile",
      textValue: "",
      inputData: input,
      config: {
        targetMode: "path",
        filePath: "ui/campaign ui/hud_campaign.twui.xml",
        ignoreHierarchy: true,
        locatorSteps: locator("button_group_management"),
        action: "setAttributes",
        attributeEdits: [{ id: "dock", name: "dock_offset", newValue: "-180.00,-190.00" }],
        replacementXml: "",
      },
    });
    expect(parentEdit.success).toBe(true);

    const layoutEdit = await executeNodeAction({
      nodeId: "xml-layout",
      nodeType: "editxmlfile",
      textValue: "",
      inputData: parentEdit.data as DBTablesNodeData,
      config: {
        targetMode: "input",
        filePath: "",
        ignoreHierarchy: true,
        locatorSteps: [...locator("button_group_management"), ...locator("LayoutEngine")],
        action: "replaceElement",
        attributeEdits: [],
        replacementXml:
          '<LayoutEngine type="List" itemsperrow="5" reverse_order="false" vertical_alignment="Bottom" horizontal_alignment="Left" />',
      },
    });

    expect(layoutEdit.success).toBe(true);
    const edited = (layoutEdit.data as DBTablesNodeData).tables[0].table.buffer?.toString("utf8");
    expect(edited).toContain('dock_offset="-180.00,-190.00"');
    expect(edited).toContain('<LayoutEngine type="List" itemsperrow="5"');
    expect(edited).not.toContain('type="RadialList"');
    expect(edited).toContain('<hierarchy><button_group_management dock_offset="unchanged" /></hierarchy>');
  });
});
