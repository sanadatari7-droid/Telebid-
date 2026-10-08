// Modules 2–4 share one RFP engine; this says how each module differs.
//   bidLog  — the bid log fields (File 2): title, channel, project type, queries date, size, TCV, winner
//   telecom — the telecom fields (old app + EXPRO log): SOW, media, SLA, bandwidth, quantity,
//             contract, coverage study, location, attachments, NRC / MRC, team comments
//   expro   — EXPRO portal requests (File 1): the EXPRO number and U.Date

// Field 4 (scope of work) levels, named as the business uses them.
export const ICT_SCOPE_LEVELS = [
  { num: "4.1", name: "Scope",               hint: "The main scope, e.g. Infrastructure" },
  { num: "4.2", name: "Hardware / Software", hint: "e.g. Hardware, Software" },
  { num: "4.3", name: "Technology",          hint: "e.g. Networking, Routing & Switching" },
  { num: "4.4", name: "Service",             hint: "e.g. Supply & install, Maintenance" },
  { num: "4.5", name: "Brand",               hint: "e.g. Cisco, Juniper" },
]
// Telecom: Family → Solution, as in the bid log.
export const TELECOM_SCOPE_LEVELS = [
  { num: "4.1", name: "Family",   hint: "e.g. Connectivity, Mobility" },
  { num: "4.2", name: "Solution", hint: "e.g. BDI, L3 (IPVPN), SIP Trunk" },
]

export const RFP_MODULES = {
  ict: {
    key: "ict", num: 2, path: "/rfp-ict", title: "RFP ICT", subtitle: "Module 2 · ICT requests for proposal",
    noun: "RFP", nouns: "RFPs", bidLog: true,
    scope: { levels: ICT_SCOPE_LEVELS, tab: "Scope of work list", first: "scope (4.1), e.g. Infrastructure",
             hint: "Start with the main scope, then narrow it down. From 4.2 on you can pick several." },
  },
  telecom: {
    key: "telecom", num: 3, path: "/rfp-telecom", title: "RFP Telecom", subtitle: "Module 3 · Telecom requests for proposal",
    noun: "RFP", nouns: "RFPs", bidLog: true, telecom: true,
    scope: { levels: TELECOM_SCOPE_LEVELS, tab: "Family & solution list", first: "family (4.1), e.g. Connectivity",
             hint: "Choose the family, then one or more solutions under it." },
  },
  expro: {
    key: "expro", num: 4, path: "/expro-requests", title: "EXPRO",
    subtitle: "Module 4 · Requests from the Expenditure and Projects Efficiency Authority",
    noun: "request", nouns: "requests", telecom: true, expro: true, scope: null,
  },
}

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

// "Fiber · Premium · 200 Mbps × 20" — the technical line shown in lists and summaries.
export function techLine(r, lists, lang) {
  const parts = [optionLabel(lists?.media, r.media, lang), optionLabel(lists?.sla, r.sla, lang)].filter(Boolean)
  const bw = r.bandwidth_mbps !== null && r.bandwidth_mbps !== undefined && r.bandwidth_mbps !== ""
    ? `${Number(r.bandwidth_mbps)} Mbps` : ""
  const qty = r.quantity && Number(r.quantity) !== 1 ? `× ${r.quantity}` : ""
  if (bw || qty) parts.push([bw, qty].filter(Boolean).join(" "))
  return parts.join(" · ")
}
