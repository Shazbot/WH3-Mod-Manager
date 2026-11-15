import { describe, expect, it } from "vitest";
import { resolveSkillSetCultures, type SkillSetCultureSources } from "../src/skillsData/cultures";

const set = (key: string, agentSubtype: string, extra: { factionKey?: string; subculture?: string } = {}) => ({
  key,
  agentSubtype,
  factionKey: extra.factionKey ?? "",
  subculture: extra.subculture ?? "",
});

const sources: SkillSetCultureSources = {
  subcultureToCulture: {
    sc_vmp: "wh_main_vmp_vampire_counts",
    sc_nag: "wh3_main_nag_nagash",
    sc_chs: "wh_main_chs_chaos",
    sc_kho: "wh3_main_kho_khorne",
    sc_dae: "wh3_main_dae_daemons",
    sc_ksl: "wh3_main_ksl_kislev",
    sc_emp: "wh_main_emp_empire",
    sc_rogue: "wh2_main_rogue",
  },
  factionToSubculture: {
    vmp1: "sc_vmp",
    vmp2: "sc_vmp",
    nag1: "sc_nag",
    nag2: "sc_nag",
    chs1: "sc_chs",
    chs2: "sc_chs",
    chs3: "sc_chs",
    chs4: "sc_chs",
    kho1: "sc_kho",
    kho2: "sc_kho",
    kho3: "sc_kho",
    kho4: "sc_kho",
    dae1: "sc_dae",
    rogue1: "sc_rogue",
    emp1: "sc_emp",
  },
  subtypeToFactions: {
    mannfred: ["vmp1", "vmp2", "nag1", "nag2"],
    skarr: ["chs1", "chs2", "chs3", "chs4", "kho1", "kho2", "kho3", "kho4", "dae1"],
    tie: ["rogue1", "emp1"],
    many: ["chs1", "chs2", "emp1"],
  },
};

const resolve = (...sets: ReturnType<typeof set>[]) => resolveSkillSetCultures(sets, sources);

describe("resolveSkillSetCultures", () => {
  it("uses the set's subculture first", () => {
    const result = resolve(set("a_set", "mannfred", { subculture: "sc_ksl", factionKey: "emp1" }));
    expect(result.a_set).toBe("wh3_main_ksl_kislev");
  });

  it("uses the set's faction when there is no subculture", () => {
    expect(resolve(set("a_set", "mannfred", { factionKey: "emp1" })).a_set).toBe("wh_main_emp_empire");
  });

  it("falls through when the faction or subculture is unknown", () => {
    const result = resolve(set("x_vmp_set", "mannfred", { factionKey: "unknown", subculture: "nope" }));
    expect(result.x_vmp_set).toBe("wh_main_vmp_vampire_counts");
  });

  it("prefers the candidate whose code is in the set key", () => {
    expect(resolve(set("x_nag_set", "mannfred")).x_nag_set).toBe("wh3_main_nag_nagash");
  });

  it("falls back to the subtype key tokens", () => {
    expect(resolve(set("plain_set", "many_emp_lord")).plain_set).toBeUndefined();
    sources.subtypeToFactions.many_emp_lord = ["chs1", "chs2", "emp1"];
    expect(resolve(set("plain_set", "many_emp_lord")).plain_set).toBe("wh_main_emp_empire");
    delete sources.subtypeToFactions.many_emp_lord;
  });

  it("picks the most permitting factions when no code matches", () => {
    expect(resolve(set("plain_set", "many")).plain_set).toBe("wh_main_chs_chaos");
  });

  it("breaks count ties by key order", () => {
    expect(resolve(set("plain_set", "tie")).plain_set).toBe("wh2_main_rogue");
  });

  it("matches the 'rogue' code from a two-segment tail", () => {
    expect(resolve(set("x_rogue_set", "tie")).x_rogue_set).toBe("wh2_main_rogue");
  });

  it("matches known cultures by code when there are no candidates", () => {
    const result = resolve(set("wh2_main_skill_node_set_ksl_captain", "ksl_captain"));
    expect(result.wh2_main_skill_node_set_ksl_captain).toBe("wh3_main_ksl_kislev");
  });

  it("leaves sets with no match unresolved", () => {
    expect(resolve(set("wh2_pro08_skill_node_neu_felix", "wh2_pro08_neu_felix"))).toEqual({});
  });

  it("resolves Mannfred to Vampire Counts", () => {
    const result = resolve(set("wh_main_skill_node_set_vmp_mannfred", "mannfred"));
    expect(result.wh_main_skill_node_set_vmp_mannfred).toBe("wh_main_vmp_vampire_counts");
  });

  it("resolves Skarr to Khorne", () => {
    const result = resolve(set("wh3_dlc26_skill_node_set_kho_skarr_bloodwrath", "skarr"));
    expect(result.wh3_dlc26_skill_node_set_kho_skarr_bloodwrath).toBe("wh3_main_kho_khorne");
  });
});
