import { format as dateFnsFormat, isValid } from "date-fns"

export function fmt(date, pattern = "dd MMM yyyy") {
  if (!date) return "—"
  try {
    const d = new Date(date)
    return isValid(d) ? dateFnsFormat(d, pattern) : "—"
  } catch { return "—" }
}

export function fmtDT(date) { return fmt(date, "dd MMM yyyy HH:mm") }
