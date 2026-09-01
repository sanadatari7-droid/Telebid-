import { useEffect, useState } from "react"

export function useTranslation() {
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "en")

  useEffect(() => {
    const handler = () => setLang(localStorage.getItem("lang") || "en")
    window.addEventListener("storage", handler)
    // Also poll for changes in same tab
    const interval = setInterval(() => {
      const current = localStorage.getItem("lang") || "en"
      if (current !== lang) setLang(current)
    }, 500)
    return () => { window.removeEventListener("storage", handler); clearInterval(interval) }
  }, [lang])

  const isAr = lang === "ar"

  // t(english, arabic) - returns correct language string
  const t = (en, ar) => isAr && ar ? ar : en

  return { lang, setLang, isAr, t }
}
