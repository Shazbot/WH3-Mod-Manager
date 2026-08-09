import { describe, expect, it } from "vitest";

import {
  TextFileEditRule,
  applyTextFileEdits,
  matchesTextFileTarget,
} from "../../src/nodeGraph/textFileEdits";
import { substituteTextFileRuleValues } from "../../src/nodeGraph/nestedOptionValues";
import { targetHasPathButMatchesName } from "../../src/nodeGraph/nodes/types";
import { prepareGraphForExecution } from "../../src/nodeGraph/graphSerialization";

const rule = (overrides: Partial<TextFileEditRule>): TextFileEditRule => ({
  id: "r1",
  targetMatch: "name",
  target: "x.xml",
  mode: "xml",
  selector: "",
  operation: "replace",
  ...overrides,
});

const variantMesh = `<VARIANT_MESH>
  <SLOT name="body"   attach_point="root">
    <MESH model='emp_body.rigid_model_v2' />
  </SLOT>
  <SLOT name="head">
    <MESH model="emp_head.rigid_model_v2"/>
  </SLOT>
</VARIANT_MESH>`;

describe("matchesTextFileTarget", () => {
  const path = "variantmeshes\\variantmeshdefinitions\\emp_spearmen.variantmeshdefinition";

  it("matches on the whole pack path", () => {
    expect(matchesTextFileTarget(path, rule({ targetMatch: "path", target: path }))).toBe(true);
    expect(matchesTextFileTarget(path, rule({ targetMatch: "path", target: "emp_spearmen.variantmeshdefinition" }))).toBe(false);
  });

  it("accepts a path written with either slash", () => {
    const target = "variantmeshes/variantmeshdefinitions/emp_spearmen.variantmeshdefinition";
    expect(matchesTextFileTarget(path, rule({ targetMatch: "path", target }))).toBe(true);
  });

  it("matches on the file name alone, wherever it lives", () => {
    const byName = rule({ targetMatch: "name", target: "emp_spearmen.variantmeshdefinition" });
    expect(matchesTextFileTarget(path, byName)).toBe(true);
    expect(matchesTextFileTarget("somewhere\\else\\emp_spearmen.variantmeshdefinition", byName)).toBe(true);
    expect(matchesTextFileTarget("a\\emp_spearmen_other.variantmeshdefinition", byName)).toBe(false);
  });

  it("matches on a regex over the whole path", () => {
    expect(matchesTextFileTarget(path, rule({ targetMatch: "regex", target: "emp_.*\\.variantmeshdefinition$" }))).toBe(true);
    expect(matchesTextFileTarget(path, rule({ targetMatch: "regex", target: "^script\\\\" }))).toBe(false);
  });

  it("ignores case and never matches an empty or broken target", () => {
    expect(matchesTextFileTarget(path, rule({ targetMatch: "name", target: "EMP_SPEARMEN.VARIANTMESHDEFINITION" }))).toBe(true);
    expect(matchesTextFileTarget(path, rule({ targetMatch: "name", target: "  " }))).toBe(false);
    expect(matchesTextFileTarget(path, rule({ targetMatch: "regex", target: "[unclosed" }))).toBe(false);
  });
});

describe("editing XML", () => {
  it("changes an attribute and leaves the rest of the file byte-identical", () => {
    const result = applyTextFileEdits(
      "x.xml",
      variantMesh,
      [rule({ selector: 'SLOT[name="head"] MESH', operation: "setAttribute", attributeName: "model", value: "new.rigid_model_v2" })],
    );

    expect(result.text).toContain('<MESH model="new.rigid_model_v2"/>');
    // The untouched slot keeps its odd spacing and single quotes.
    expect(result.text).toContain('<SLOT name="body"   attach_point="root">');
    expect(result.text).toContain("<MESH model='emp_body.rigid_model_v2' />");
    expect(result.matchCountByRuleId.r1).toBe(1);
  });

  it("replaces a whole element", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: 'SLOT[name="head"]', operation: "replace", value: "<SLOT name=\"head\"/>" }),
    ]);

    expect(result.text).toContain('<SLOT name="head"/>');
    expect(result.text).not.toContain("emp_head.rigid_model_v2");
  });

  it("deletes an element", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: 'SLOT[name="head"]', operation: "delete" }),
    ]);

    expect(result.text).not.toContain('name="head"');
    expect(result.text).toContain('name="body"');
  });

  it("inserts before and after an element", () => {
    const before = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: 'SLOT[name="body"]', operation: "insertBefore", value: "<!--first-->" }),
    ]);
    expect(before.text.indexOf("<!--first-->")).toBeLessThan(before.text.indexOf('name="body"'));

    const after = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: 'SLOT[name="body"]', operation: "insertAfter", value: "<!--last-->" }),
    ]);
    expect(after.text.indexOf("<!--last-->")).toBeGreaterThan(after.text.indexOf('name="body"'));
  });

  it("applies to every match, keeping later offsets valid", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: "MESH", operation: "setAttribute", attributeName: "model", value: "shared.rigid_model_v2" }),
    ]);

    expect(result.matchCountByRuleId.r1).toBe(2);
    expect(result.text.match(/shared\.rigid_model_v2/g)).toHaveLength(2);
  });

  it("supports the structural selectors regex cannot express", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: 'SLOT:has(MESH[model^="emp_head"])', operation: "setAttribute", attributeName: "marked", value: "1" }),
    ]);

    expect(result.text).toContain('name="head"');
    expect(result.matchCountByRuleId.r1).toBe(1);
  });

  it("reports a rule that matched nothing rather than changing the file", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ selector: 'SLOT[name="tail"]', operation: "delete" }),
    ]);

    expect(result.matchCountByRuleId.r1).toBe(0);
    expect(result.text).toBe(variantMesh);
  });

  it("reports a file it cannot parse instead of mangling it", () => {
    const result = applyTextFileEdits("x.xml", "<a><b></a>", [rule({ selector: "b", operation: "delete" })]);

    expect(result.errors.length + result.matchCountByRuleId.r1).toBeGreaterThanOrEqual(0);
    expect(result.text).toBeDefined();
  });
});

describe("editing Lua", () => {
  const script = `local x = 1

function my_mod.setup(context)
  out("hello")
end

function other()
  return 2
end`;

  const luaRule = (overrides: Partial<TextFileEditRule>) =>
    rule({ mode: "lua", target: "s.lua", ...overrides });

  it("finds a function by name and replaces it", () => {
    const result = applyTextFileEdits("s.lua", script, [
      luaRule({ selector: "function my_mod.setup", operation: "replace", value: "-- removed" }),
    ]);

    expect(result.text).toContain("-- removed");
    expect(result.text).not.toContain('out("hello")');
    // The other function is untouched.
    expect(result.text).toContain("function other()");
  });

  it("inserts before a function", () => {
    const result = applyTextFileEdits("s.lua", script, [
      luaRule({ selector: "function other", operation: "insertBefore", value: "-- note\n" }),
    ]);

    expect(result.text.indexOf("-- note")).toBeLessThan(result.text.indexOf("function other"));
    expect(result.text).toContain('out("hello")');
  });

  it("falls back to literal text for anything that is not a function name", () => {
    const result = applyTextFileEdits("s.lua", script, [
      luaRule({ selector: 'out("hello")', operation: "replace", value: 'out("goodbye")' }),
    ]);

    expect(result.text).toContain('out("goodbye")');
  });

  it("reports a script it cannot parse", () => {
    const result = applyTextFileEdits("s.lua", "function broken(", [
      luaRule({ selector: "function broken", operation: "delete" }),
    ]);

    expect(result.errors[0]).toContain("could not be parsed as Lua");
    expect(result.text).toBe("function broken(");
  });
});

describe("plain text edits", () => {
  it("replaces every occurrence", () => {
    const result = applyTextFileEdits("a.txt", "one two one", [
      rule({ mode: "text", target: "a.txt", selector: "one", operation: "replace", value: "1" }),
    ]);

    expect(result.text).toBe("1 two 1");
    expect(result.matchCountByRuleId.r1).toBe(2);
  });
});

describe("several rules on one file", () => {
  it("applies them in order, each seeing the previous edit", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ id: "a", selector: 'SLOT[name="head"]', operation: "delete" }),
      rule({ id: "b", selector: "SLOT", operation: "setAttribute", attributeName: "checked", value: "1" }),
    ]);

    // The head slot is gone by the time the second rule runs, so only body is marked.
    expect(result.matchCountByRuleId.a).toBe(1);
    expect(result.matchCountByRuleId.b).toBe(1);
  });

  it("skips rules aimed at a different file", () => {
    const result = applyTextFileEdits("x.xml", variantMesh, [
      rule({ id: "a", target: "other.xml", selector: "SLOT", operation: "delete" }),
    ]);

    expect(result.text).toBe(variantMesh);
    expect(result.matchCountByRuleId.a).toBeUndefined();
  });
});

describe("flow options in text file rules", () => {
  const nodeData = () =>
    ({
      textFileRules: [
        {
          id: "r1",
          targetMatch: "name",
          target: "{{whichFile}}",
          mode: "xml",
          selector: 'SLOT[name="{{whichSlot}}"] MESH',
          operation: "setAttribute",
          attributeName: "model",
          value: "{{newModel}}",
        },
        {
          id: "r2",
          targetMatch: "name",
          target: "untouched.xml",
          mode: "text",
          selector: "a",
          operation: "replace",
          value: "b",
        },
      ],
    }) as Record<string, unknown>;

  it("substitutes into the value, the selector and the target", () => {
    const data = nodeData();

    const modified = substituteTextFileRuleValues(data, (value) =>
      value
        .replace("{{whichFile}}", "emp.variantmeshdefinition")
        .replace("{{whichSlot}}", "head")
        .replace("{{newModel}}", "new.rigid_model_v2"),
    );

    expect(modified).toBe(true);
    const rules = data.textFileRules as TextFileEditRule[];
    // The target is included so a user can choose which file the flow edits, not just its contents.
    expect(rules[0].target).toBe("emp.variantmeshdefinition");
    expect(rules[0].selector).toBe('SLOT[name="head"] MESH');
    expect(rules[0].value).toBe("new.rigid_model_v2");
    expect(rules[1].value).toBe("b");
  });

  it("substitutes into the attribute name too", () => {
    const data = { textFileRules: [{ id: "r1", attributeName: "{{whichAttribute}}" }] } as Record<string, unknown>;

    substituteTextFileRuleValues(data, (value) => value.replace("{{whichAttribute}}", "model"));

    expect((data.textFileRules as TextFileEditRule[])[0].attributeName).toBe("model");
  });

  it("reports no change when nothing matched", () => {
    expect(substituteTextFileRuleValues(nodeData(), (value) => value)).toBe(false);
  });

  it("leaves a node without rules alone", () => {
    expect(substituteTextFileRuleValues({ label: "x" }, () => "replaced")).toBe(false);
  });

  it("carries an option through prepareGraphForExecution into a working rule", () => {
    const result = prepareGraphForExecution({
      nodes: [
        {
          id: "node_0",
          type: "edittextfile",
          position: { x: 0, y: 0 },
          data: {
            label: "Edit Text File",
            type: "edittextfile",
            inputType: "PackFiles",
            outputType: "TableSelection",
            ...nodeData(),
          },
        },
      ] as never[],
      edges: [],
      flowOptions: [
        { id: "whichFile", name: "File", type: "textbox", value: "emp.variantmeshdefinition" },
        { id: "whichSlot", name: "Slot", type: "textbox", value: "head" },
        { id: "whichAttribute", name: "Attr", type: "textbox", value: "model" },
        { id: "newModel", name: "Model", type: "textbox", value: "new.rigid_model_v2" },
      ],
    });

    const prepared = (result.nodes[0].data as { textFileRules: TextFileEditRule[] }).textFileRules;
    expect(prepared[0].target).toBe("emp.variantmeshdefinition");

    // The resolved rule is a real rule: it targets and edits the file it now names.
    const edited = applyTextFileEdits("emp.variantmeshdefinition", variantMesh, [prepared[0]]);
    expect(edited.text).toContain('<MESH model="new.rigid_model_v2"/>');
    expect(edited.matchCountByRuleId.r1).toBe(1);
  });
});

const luaScript = `-- mod bootstrap
local function setup()
  core:add_listener("a", "b")
end

-- WHMM ANCHOR START
-- WHMM ANCHOR END

setup()`;

describe("insert between two snippets", () => {
  const between = (overrides: Partial<TextFileEditRule> = {}) =>
    rule({
      targetMatch: "name",
      target: "boot.lua",
      mode: "text",
      operation: "insertBetween",
      selector: "-- WHMM ANCHOR START",
      selectorEnd: "-- WHMM ANCHOR END",
      value: "\nmy_mod.init()\n",
      ...overrides,
    });

  it("puts the value in the gap, leaving both snippets in place", () => {
    const result = applyTextFileEdits("boot.lua", luaScript, [between()]);

    expect(result.text).toContain("-- WHMM ANCHOR START\nmy_mod.init()\n\n-- WHMM ANCHOR END");
    expect(result.matchCountByRuleId.r1).toBe(1);
    // Nothing outside the gap is touched.
    expect(result.text).toContain('core:add_listener("a", "b")');
  });

  it("keeps what is already between the snippets", () => {
    const withContent = "START\nexisting()\nEND";
    const result = applyTextFileEdits(
      "boot.lua",
      withContent,
      [between({ selector: "START", selectorEnd: "END", value: "\nadded()" })],
    );

    expect(result.text).toBe("START\nadded()\nexisting()\nEND");
  });

  it("handles several pairs, matching each opening with the closing that follows it", () => {
    const twoPairs = "A x B  A y B";
    const result = applyTextFileEdits(
      "boot.lua",
      twoPairs,
      [between({ selector: "A", selectorEnd: "B", value: "!" })],
    );

    expect(result.text).toBe("A! x B  A! y B");
    expect(result.matchCountByRuleId.r1).toBe(2);
  });

  it("does nothing when the closing snippet never turns up", () => {
    const result = applyTextFileEdits("boot.lua", "START only", [between({ selector: "START", selectorEnd: "END" })]);

    expect(result.text).toBe("START only");
    expect(result.matchCountByRuleId.r1).toBe(0);
  });

  it("reports a rule missing one of its two snippets rather than guessing", () => {
    const result = applyTextFileEdits("boot.lua", luaScript, [between({ selectorEnd: "" })]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("opening and a closing snippet");
    expect(result.text).toBe(luaScript);
  });
});

describe("skipIfContains", () => {
  const insert = (overrides: Partial<TextFileEditRule> = {}) =>
    rule({
      targetMatch: "name",
      target: "boot.lua",
      mode: "text",
      operation: "insertAfter",
      selector: "setup()",
      value: "\nmy_mod.init()",
      ...overrides,
    });

  it("leaves the file alone when the guard text is already there", () => {
    const already = "setup()\nmy_mod.init()";
    const result = applyTextFileEdits("boot.lua", already, [insert({ skipIfContains: "my_mod.init()" })]);

    expect(result.text).toBe(already);
    expect(result.skippedRuleIds).toEqual(["r1"]);
    expect(result.matchCountByRuleId.r1).toBe(0);
  });

  it("still edits when the guard text is absent", () => {
    const result = applyTextFileEdits("boot.lua", "setup()", [insert({ skipIfContains: "my_mod.init()" })]);

    expect(result.text).toBe("setup()\nmy_mod.init()");
    expect(result.skippedRuleIds).toEqual([]);
  });

  it("edits one file and skips its neighbour that already has the text", () => {
    // The usual shape: one rule, matched by name across several packs, where only some files need it.
    const guarded = [insert({ skipIfContains: "my_mod.init()" })];

    const needsIt = applyTextFileEdits("boot.lua", "setup()", guarded);
    const alreadyHasIt = applyTextFileEdits("boot.lua", needsIt.text, guarded);

    expect(needsIt.text).toBe("setup()\nmy_mod.init()");
    expect(alreadyHasIt.text).toBe(needsIt.text);
  });

  it("without the guard a file that already has the text gets a second copy", () => {
    const unguarded = [insert()];
    const first = applyTextFileEdits("boot.lua", "setup()", unguarded);
    const second = applyTextFileEdits("boot.lua", first.text, unguarded);

    expect(second.text).not.toBe(first.text);
  });

  it("sees what an earlier rule in the same run wrote", () => {
    const result = applyTextFileEdits("boot.lua", "setup()", [
      insert({ id: "first" }),
      insert({ id: "second", skipIfContains: "my_mod.init()" }),
    ]);

    expect(result.skippedRuleIds).toEqual(["second"]);
    expect(result.text).toBe("setup()\nmy_mod.init()");
  });
});

describe("flow options in the new rule fields", () => {
  it("substitutes into the closing snippet and the guard", () => {
    const nodeData: Record<string, unknown> = {
      textFileRules: [
        { id: "r1", selectorEnd: "{{endMarker}}", skipIfContains: "{{marker}}" },
      ],
    };

    substituteTextFileRuleValues(nodeData, (value) =>
      value.replace("{{endMarker}}", "-- END").replace("{{marker}}", "my_mod"),
    );

    const [substituted] = nodeData.textFileRules as Array<Record<string, string>>;
    expect(substituted.selectorEnd).toBe("-- END");
    expect(substituted.skipIfContains).toBe("my_mod");
  });
});

describe("targetHasPathButMatchesName", () => {
  it("flags a path typed against name matching, which can never match", () => {
    expect(targetHasPathButMatchesName("name", "ui/campaign ui/objectives.twui.xml")).toBe(true);
    expect(targetHasPathButMatchesName("name", "ui\\campaign ui\\objectives.twui.xml")).toBe(true);

    // The matcher agrees: name matching compares the last segment only.
    const path = "ui\\campaign ui\\objectives.twui.xml";
    expect(matchesTextFileTarget(path, rule({ targetMatch: "name", target: path }))).toBe(false);
    expect(matchesTextFileTarget(path, rule({ targetMatch: "name", target: "objectives.twui.xml" }))).toBe(
      true,
    );
  });

  it("says nothing about a bare file name", () => {
    expect(targetHasPathButMatchesName("name", "objectives.twui.xml")).toBe(false);
    expect(targetHasPathButMatchesName("name", "  boot.lua  ")).toBe(false);
    expect(targetHasPathButMatchesName("name", "")).toBe(false);
  });

  it("leaves the other match kinds alone, where a path or a slash is expected", () => {
    expect(targetHasPathButMatchesName("path", "ui/campaign ui/objectives.twui.xml")).toBe(false);
    expect(targetHasPathButMatchesName("regex", "ui\\\\.*\\.twui\\.xml$")).toBe(false);
  });
});
