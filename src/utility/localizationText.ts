// {{tr:xxx}} inside a loc should be replaced with a ui_text_replacements_localised_text_xxx loc keys
export function resolveTextReplacements(
  localizedText: string | undefined,
  getLoc: (locId: string) => string | undefined,
) {
  if (!localizedText) return;

  return localizedText.replaceAll(/{{tr:(.*?)}}/gi, (_, captureGroup) => {
    let replacementText = getLoc(`ui_text_replacements_localised_text_${captureGroup}`) || getLoc(captureGroup);
    if (replacementText?.startsWith("{{tr:")) {
      const nestedReplacementKey = replacementText.match(/^{{tr:(.*?)}}$/i)?.[1];
      if (nestedReplacementKey) {
        replacementText =
          getLoc(`ui_text_replacements_localised_text_${nestedReplacementKey}`) ||
          getLoc(nestedReplacementKey) ||
          replacementText;
      }
    }
    return replacementText || captureGroup;
  });
}

export const stripGameMarkup = (value: string) =>
  value
    .replace(/\\n/g, "\n")
    .replace(/\[\[img:.*?\]\]\[\[\/img\]\]/gi, "")
    .replace(/\[\[\/?(?:b|i|col(?::[^\]]+)?)\]\]/gi, "")
    .trim();
