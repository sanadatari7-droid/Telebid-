// Field 4 (scope of work) levels, named as the business uses them.
export const SCOPE_LEVELS = [
  { num: "4.1", name: "Scope",               hint: "The main scope, e.g. Infrastructure" },
  { num: "4.2", name: "Hardware / Software", hint: "e.g. Hardware, Software" },
  { num: "4.3", name: "Technology",          hint: "e.g. Networking, Routing & Switching" },
  { num: "4.4", name: "Service",             hint: "e.g. Supply & install, Maintenance" },
  { num: "4.5", name: "Brand",               hint: "e.g. Cisco, Juniper" },
]

export function buildTree(options) {
  const children = new Map()
  options.forEach(o => {
    const key = o.parent_id ?? 0
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(o)
  })
  return { children: id => children.get(id ?? 0) || [] }
}

export const STATUS_STYLE = {
  PENDING:        "bg-gray-100 text-gray-700",
  IN_PROGRESS:    "bg-blue-100 text-blue-700",
  NEGOTIATION:    "bg-amber-100 text-amber-700",
  WON:            "bg-green-100 text-green-700",
  LOST:           "bg-red-100 text-red-700",
  LOST_TECHNICAL: "bg-red-100 text-red-700",
  LOST_FINANCIAL: "bg-red-100 text-red-700",
  CANCELLED:      "bg-gray-200 text-gray-600",
  DROPPED:        "bg-gray-200 text-gray-600",
}
export const LOST_STATUSES = ["LOST", "LOST_TECHNICAL", "LOST_FINANCIAL"]

export function optionLabel(list, value, lang) {
  const o = (list || []).find(x => x.value === value)
  if (!o) return value || ""
  return lang === "ar" && o.label_ar ? o.label_ar : o.label
}

export function formatMoney(value, currency) {
  if (value === null || value === undefined || value === "") return "—"
  const d = currency?.decimals ?? 2
  const n = new Intl.NumberFormat("en", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(value))
  return currency?.code ? `${currency.code} ${n}` : n
}
