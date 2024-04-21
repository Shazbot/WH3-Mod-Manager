import { createContext } from "react";
import { default as enTranslation } from "../locales/en/translation.json";
// we just need the loc keys
export const staticTextIds: Record<string, string | number> = enTranslation;

const context = createContext({});
export default context;
