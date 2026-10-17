import { useState } from "react"
import { clientsApi } from "../services/api"

// Once the translation service says it's unavailable, stop asking for the rest of the visit.
let translationDown = false
export const isTranslationDown = () => translationDown

// An English + Arabic pair that fills itself in either direction: leave the English box and the
// Arabic is filled in; leave the Arabic box and the English is. A side someone typed themselves
// is never overwritten; a side that was filled in automatically follows the other one.
export function useBilingualPair(kind, { en, ar, setEn, setAr }) {
  const [auto, setAuto] = useState({ en: false, ar: false })
  const [busy, setBusy] = useState(null)   // "en" | "ar" while that side is being filled
  const [error, setError] = useState("")

  const fill = async from => {
    const to = from === "en" ? "ar" : "en"
    const text = ((from === "en" ? en : ar) || "").trim()
    const current = ((to === "ar" ? ar : en) || "").trim()
    if (!text || (current && !auto[to]) || translationDown) return
    setBusy(to); setError("")
    try {
      const { data } = await clientsApi.translateAny(text, kind, to)
      ;(to === "ar" ? setAr : setEn)(data.text)
      setAuto(a => ({ ...a, [to]: true }))
    } catch (err) {
      if (err.response?.status === 503) translationDown = true
      setError(`Automatic ${to === "ar" ? "Arabic" : "English"} isn't available right now. Please type it.`)
    } finally { setBusy(null) }
  }
  return {
    busy, error, down: translationDown,
    blurEn: () => fill("en"), blurAr: () => fill("ar"),
    typedEn: () => setAuto(a => ({ ...a, en: false })), typedAr: () => setAuto(a => ({ ...a, ar: false })),
  }
}
