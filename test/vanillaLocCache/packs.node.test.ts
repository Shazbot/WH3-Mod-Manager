import { describe, expect, it } from "vitest";

import { getVanillaLocalisationPackNames } from "../../src/vanillaLocCache/packs";

/**
 * The localisation packs WH3 ships, as listed by the game manifest, in an order that is not the
 * answer. Note the game's own codes: German is `ge`, Spanish `sp`, Korean `kr`.
 */
const packNames = [
  "data.pack",
  "local_ge.pack",
  "db.pack",
  "local_fr.pack",
  "local_en.pack",
  "models.pack",
  "local_zh.pack",
  "local_sp.pack",
  "local_kr.pack",
  "local_br.pack",
  "local_ru.pack",
];

describe("vanilla localisation packs", () => {
  it("takes only the local packs, ignoring everything that carries no locs", () => {
    expect(getVanillaLocalisationPackNames(packNames, "en")).toEqual(["local_en.pack"]);
  });

  it("puts the player's language after English so it overrides it", () => {
    expect(getVanillaLocalisationPackNames(packNames, "fr")).toEqual(["local_en.pack", "local_fr.pack"]);
  });

  it("does not list English twice when English is the player's language", () => {
    expect(getVanillaLocalisationPackNames(packNames, "en")).toEqual(["local_en.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, undefined)).toEqual(["local_en.pack"]);
  });

  it("maps the app's language codes onto the game's pack codes", () => {
    // Interpolating the app code would look for local_de/local_es/local_ko/local_pt, none of which
    // the game ships, and silently leave the player on English.
    expect(getVanillaLocalisationPackNames(packNames, "de")).toEqual(["local_en.pack", "local_ge.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, "es")).toEqual(["local_en.pack", "local_sp.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, "ko")).toEqual(["local_en.pack", "local_kr.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, "pt")).toEqual(["local_en.pack", "local_br.pack"]);
  });

  it("uses the app's own code where the game agrees with it", () => {
    for (const [language, pack] of [
      ["fr", "local_fr.pack"],
      ["ru", "local_ru.pack"],
      ["zh", "local_zh.pack"],
    ] as const) {
      expect(getVanillaLocalisationPackNames(packNames, language)).toEqual(["local_en.pack", pack]);
    }
  });

  it("leaves Japanese on English while still picking up a Japanese pack if one appears", () => {
    // WH3 ships none today, so the answer is English alone.
    expect(getVanillaLocalisationPackNames(packNames, "ja")).toEqual(["local_en.pack"]);

    // Probed under both spellings, so a release that adds one needs no code change.
    expect(getVanillaLocalisationPackNames([...packNames, "local_ja.pack"], "ja")).toEqual([
      "local_en.pack",
      "local_ja.pack",
    ]);
    expect(getVanillaLocalisationPackNames([...packNames, "local_jp.pack"], "ja")).toEqual([
      "local_en.pack",
      "local_jp.pack",
    ]);
  });

  it("falls back to English alone for a language the game ships nothing for", () => {
    expect(getVanillaLocalisationPackNames(packNames, "cs")).toEqual(["local_en.pack"]);
  });

  it("reads English only when the setting asks for it, whatever the language", () => {
    expect(getVanillaLocalisationPackNames(packNames, "ge", true)).toEqual(["local_en.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, "fr", true)).toEqual(["local_en.pack"]);
    // Off by default, so leaving it out keeps the player's language.
    expect(getVanillaLocalisationPackNames(packNames, "fr")).toEqual(["local_en.pack", "local_fr.pack"]);
    expect(getVanillaLocalisationPackNames(packNames, "fr", false)).toEqual(["local_en.pack", "local_fr.pack"]);
  });

  it("sorts a language's packs so a suffixed one wins, for versions that ship several", () => {
    // WH3 ships one English pack today, but has shipped suffixed ones, and set order is not stable.
    const withSuffixed = [...packNames, "local_en_3.pack"];
    expect(getVanillaLocalisationPackNames(withSuffixed, "en")).toEqual(["local_en.pack", "local_en_3.pack"]);
  });

  it("is stable regardless of the order the pack names arrive in", () => {
    expect(getVanillaLocalisationPackNames([...packNames].reverse(), "fr")).toEqual(
      getVanillaLocalisationPackNames(packNames, "fr"),
    );
  });
});
