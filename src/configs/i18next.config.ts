import i18next from "i18next";
import i18nextBackend from "i18next-fs-backend";
import isDev from "electron-is-dev";

const i18nextOptions = {
  backend: {
    loadPath: isDev
      ? "./locales/{{lng}}/{{ns}}.json"
      : "./resources/app/.webpack/main/locales/{{lng}}/{{ns}}.json",
    addPath: isDev
      ? "./locales/{{lng}}/{{ns}}.missing.json"
      : "./resources/app/.webpack/main/locales/{{lng}}/{{ns}}.missing.json",
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
