import { SupportedLanguage, SupportedLanguages } from "../supportedGames";

export const isSupportedLanguage = (value: string): value is SupportedLanguage => {
  return SupportedLanguages.includes(value as SupportedLanguage);
};
