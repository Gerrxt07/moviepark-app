export const LOCALE_KEY = "moviepark-locale";
export const SUPPORTED_LOCALES = ["de", "en"];

export function normalizeLocale(value) {
  return SUPPORTED_LOCALES.includes(value) ? value : "de";
}

export function readLocale() {
  if (typeof window === "undefined") return "de";
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_KEY));
  } catch {
    return "de";
  }
}

export function writeLocale(locale) {
  if (typeof window === "undefined") return;
  const normalized = normalizeLocale(locale);
  try {
    window.localStorage.setItem(LOCALE_KEY, normalized);
  } catch {
    // The document still adopts the selected language for this page load.
  }
  document.documentElement.lang = normalized;
  document.documentElement.dataset.locale = normalized;
}

export function localeCode() {
  return readLocale() === "en" ? "en-GB" : "de-DE";
}
