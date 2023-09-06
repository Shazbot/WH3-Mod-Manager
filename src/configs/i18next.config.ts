import i18next from "i18next";
import i18nextBackend from "i18next-fs-backend";

const i18nextOptions = {
  backend: {
    loadPath: "./locales/{{lng}}/{{ns}}.json",
    addPath: "./locales/{{lng}}/{{ns}}.missing.json",
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
