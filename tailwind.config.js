// Preserve the application palette while the Tailwind 4 theme lives in src/index.css.
module.exports = {
  theme: {
    extend: { colors: require("./src/styles/tailwindPalette.json") },
  },
};
