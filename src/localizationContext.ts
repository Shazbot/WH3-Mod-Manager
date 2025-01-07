import { createContext, useContext } from "react";
import { default as enTranslation } from "../locales/en/translation.json";
// we just need the loc keys
export const staticTextIds: Record<string, string | number> = enTranslation;

const context = createContext({});
export default context;

export const useLocalizations = () => {
  return useContext(context) as typeof enTranslation;
}