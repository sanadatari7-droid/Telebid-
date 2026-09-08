import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import ar from "./locales/ar.json"

// Reuses the "lang" localStorage key the earlier partial translation hook
// already used, so a saved preference carries over rather than resetting.
const savedLang = localStorage.getItem("lang") || "en"

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: savedLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
})

export function applyDocumentDirection(lang) {
  const isAr = lang === "ar"
  document.documentElement.setAttribute("lang", lang)
  document.documentElement.setAttribute("dir", isAr ? "rtl" : "ltr")
}

export function setAppLanguage(lang) {
  localStorage.setItem("lang", lang)
  i18n.changeLanguage(lang)
  applyDocumentDirection(lang)
}

// Apply on initial load too (covers a hard refresh, not just a live switch).
applyDocumentDirection(savedLang)

export default i18n
