// Resolves appearance before the stylesheet paints. It is a classic blocking script because the
// deferred app module could run after the first paint; the key and values belong to
// src/appearance.ts. The desktop entry supplies its preference on <html>; a browser uses the
// value saved for this origin.
(function () {
  const root = document.documentElement;
  let preference = root.dataset.appearancePreference;
  if (!window.factoryDesktop) {
    try {
      preference = window.localStorage.getItem("factory.appearance");
    } catch {
      // A profile that blocks storage uses the shipped preference.
    }
  }
  if (preference !== "light" && preference !== "dark") preference = "system";
  const mode =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  root.dataset.appearancePreference = preference;
  root.dataset.appearance = mode;
  // Match the Factory canvas in styles.css before the stylesheet is available.
  document.querySelector('meta[name="theme-color"]').content =
    mode === "dark" ? "#09090b" : "#ffffff";
})();
