import { describe, expect, it } from "vitest";

import { applyTextFileEdits, TextFileEditRule } from "../../src/nodeGraph/textFileEdits";
import { autoIndentXmlFragment, formatXmlDocument } from "../../src/nodeGraph/textFileFormatting";

const xmlRule = (overrides: Partial<TextFileEditRule> = {}): TextFileEditRule => ({
  id: "format",
  targetMatch: "name",
  target: "unit.variantmeshdefinition",
  mode: "xml",
  selector: "OLD",
  operation: "insertAfter",
  value: "<NEW><CHILD/></NEW>",
  ...overrides,
});

describe("Edit Text File formatters", () => {
  it("pretty-prints XML using its existing indentation and line endings", () => {
    const source = "<ROOT>\r\n\t<SLOT><META_DATA>audio:metal</META_DATA></SLOT>\r\n</ROOT>\r\n";
    const result = formatXmlDocument(source, "prettyXml");

    expect(result.error).toBeUndefined();
    expect(result.text).toBe(
      "<ROOT>\r\n\t<SLOT>\r\n\t\t<META_DATA>audio:metal</META_DATA>\r\n\t</SLOT>\r\n</ROOT>\r\n",
    );
  });

  it("compacts XML without adding a final newline", () => {
    const source = "<ROOT>\n  <SLOT>\n    <MESH/>\n  </SLOT>\n</ROOT>";
    const result = formatXmlDocument(source, "compactXml");

    expect(result.error).toBeUndefined();
    expect(result.text).toBe("<ROOT><SLOT><MESH/></SLOT></ROOT>");
  });

  it("leaves invalid XML unchanged and reports why", () => {
    const source = "<ROOT><SLOT></ROOT>";
    const result = formatXmlDocument(source, "prettyXml");

    expect(result.text).toBe(source);
    expect(result.error).toContain("invalid XML");
  });

  it("auto-indents an inserted fragment at its destination", () => {
    const source = "<ROOT>\n  <SLOT>\n    <OLD/>\n  </SLOT>\n</ROOT>";
    const insertionIndex = source.indexOf("<OLD/>") + "<OLD/>".length;
    const result = autoIndentXmlFragment(source, "<NEW>\n<CHILD/>\n</NEW>", insertionIndex, "insertAfter");

    expect(result.error).toBeUndefined();
    expect(result.text).toBe("\n    <NEW>\n      <CHILD/>\n    </NEW>");
  });

  it("runs auto-indent while applying rules and whole-document formatting afterward", () => {
    const source = "<ROOT>\n  <SLOT>\n    <OLD/>\n  </SLOT>\n</ROOT>";
    const autoIndented = applyTextFileEdits("unit.variantmeshdefinition", source, [xmlRule()], "autoIndent");
    expect(autoIndented.text).toContain("<OLD/>\n    <NEW>\n      <CHILD/>\n    </NEW>");

    const compacted = applyTextFileEdits(
      "unit.variantmeshdefinition",
      source,
      [xmlRule({ operation: "replace", value: "<NEW><CHILD/></NEW>" })],
      "compactXml",
    );
    expect(compacted.text).toBe("<ROOT><SLOT><NEW><CHILD/></NEW></SLOT></ROOT>");
  });
});
