import i18next from "i18next";
import i18nextBackend from "i18next-fs-backend";
import isDev from "electron-is-dev";
import { app } from "electron";
import * as nodePath from "node:path";

export const getLocaleDirectory = () =>
  isDev ? nodePath.resolve(__dirname, "../../locales") : nodePath.join(__dirname, "locales");

const localeDirectory = getLocaleDirectory();
const missingLocaleDirectory = isDev ? localeDirectory : nodePath.join(app.getPath("userData"), "locales");

const i18nextOptions = {
  backend: {
    loadPath: nodePath.join(localeDirectory, "{{lng}}", "{{ns}}.json"),
    addPath: nodePath.join(missingLocaleDirectory, "{{lng}}", "{{ns}}.missing.json"),
    jsonIndent: 2,
  },
  interpolation: {
    escapeValue: false,
  },
  saveMissing: true,
  fallbackLng: "en",
};

i18next.use(i18nextBackend);

if (!i18next.isInitialized) {
  i18next.init(i18nextOptions);
}

export default i18next;
