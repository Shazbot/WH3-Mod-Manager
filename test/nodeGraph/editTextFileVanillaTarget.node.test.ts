import { describe, expect, it } from "vitest";

import { applyTextFileEdits, matchesTextFileTarget } from "../../src/nodeGraph/textFileEdits";
import type { TextFileEditRule } from "../../src/nodeGraph/textFileEdits";

/** The pack path as variants.pack stores it - backslashes, which the rule below does not use. */
const packPath = "variantmeshes\\variantmeshdefinitions\\emp_state_troops_shields_set1.variantmeshdefinition";

const vanillaContent = `<VARIANT_MESH>
\t<SLOT name="shield">
\t\t<VARIANT_MESH model="VariantMeshes/wh_variantmodels/hu1/emp/emp_props/emp_state_troops_shield_01.wsmodel">
\t\t\t<META_DATA>equipment</META_DATA>
\t\t\t<META_DATA>audio_shield_type:metal</META_DATA>
\t\t</VARIANT_MESH>
\t\t<VARIANT_MESH model="VariantMeshes/wh_variantmodels/hu1/emp/emp_props/emp_state_troops_shield_05.wsmodel">
\t\t\t<META_DATA>equipment</META_DATA>
\t\t\t<META_DATA>audio_shield_type:metal</META_DATA>
\t\t</VARIANT_MESH>
\t</SLOT>
</VARIANT_MESH>`;

const appendShieldsRule: TextFileEditRule = {
  id: "append_shields",
  targetMatch: "path",
  // Written with forward slashes, the way the file appears in an extracted dump.
  target: "variantmeshes/variantmeshdefinitions/emp_state_troops_shields_set1.variantmeshdefinition",
  mode: "xml",
  selector: 'SLOT[name="shield"] > VARIANT_MESH:last-child',
  operation: "insertAfter",
  value:
    '<VARIANT_MESH model="VariantMeshes/wh_variantmodels/hu1/emp/pj_emp_props/pj_shield_01.wsmodel">\n' +
    "\t\t\t<META_DATA>audio_shield_type:metal</META_DATA>\n" +
    "\t\t</VARIANT_MESH>",
} as TextFileEditRule;

describe("editing a vanilla variantmeshdefinition", () => {
  it("matches the pack path however the target's slashes are written", () => {
    expect(matchesTextFileTarget(packPath, appendShieldsRule)).toBe(true);
    expect(matchesTextFileTarget(packPath, { ...appendShieldsRule, target: packPath })).toBe(true);
  });

  it("appends a mesh after the slot's last one", () => {
    const result = applyTextFileEdits(packPath, vanillaContent, [appendShieldsRule], "autoIndent");

    expect(result.errors).toEqual([]);
    expect(result.matchCountByRuleId[appendShieldsRule.id]).toBe(1);
    expect(result.text).toContain("pj_emp_props/pj_shield_01.wsmodel");
    // Appended, not substituted: the vanilla meshes are all still there.
    expect(result.text).toContain("emp_state_troops_shield_01.wsmodel");
    expect(result.text).toContain("emp_state_troops_shield_05.wsmodel");
    // Inside the slot rather than after it, or the game will not load it.
    expect(result.text.indexOf("pj_shield_01.wsmodel")).toBeLessThan(result.text.indexOf("</SLOT>"));
  });

  it("reports a miss rather than silently changing nothing", () => {
    const result = applyTextFileEdits(
      packPath,
      vanillaContent,
      [{ ...appendShieldsRule, selector: 'SLOT[name="cape"] > VARIANT_MESH:last-child' }],
      "autoIndent",
    );

    expect(result.text).toBe(vanillaContent);
    expect(result.matchCountByRuleId[appendShieldsRule.id] ?? 0).toBe(0);
  });
});
