import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import clsx from "clsx"
import { Briefcase, Loader2, Plus, Search, Shield, Star } from "lucide-react"
import { rfpApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { RFP_MODULES, STATUS_STYLE, LOST_STATUSES, optionLabel, formatMoney } from "../utils/rfp"

// Every bid from RFP ICT (Module 2) and RFP Telecom (Module 3) in one list.
const MODULES = ["ict", "telecom"]
const GO_STYLE = { GO: "bg-green-100 text-green-700", NO_GO: "bg-red-100 text-red-700", INCOMPLETE: "bg-amber-100 text-amber-700", NOT_SET_UP: "bg-gray-100 text-gray-500" }
const GO_LABEL = { GO: "Go", NO_GO: "No-Go", INCOMPLETE: "Incomplete", NOT_SET_UP: "Not set up" }
const STATUS_FILTERS = [
  { id: "all",    label: "All",                 match: () => true },
  { id: "open",   label: "Open",                match: s => ["PENDING", "IN_PROGRESS", "NEGOTIATION"].includes(s) },
  { id: "won",    label: "Won",                 match: s => s === "WON" },
  { id: "lost",   label: "Lost",                match: s => LOST_STATUSES.includes(s) },
  { id: "closed", label: "Dropped / cancelled", match: s => ["DROPPED", "CANCELLED"].includes(s) },
]

function useModuleData(module) {
  const api = rfpApi(module)
  const list = useQuery({ queryKey: ["rfps", module], queryFn: () => api.list().then(r => r.data) })
  const meta = useQuery({ queryKey: ["rfp-lists", module], queryFn: () => api.lists().then(r => r.data) })
  return { rows: (list.data || []).map(r => ({ ...r, _module: module })), lists: meta.data?.lists || {}, currency: meta.data?.currency, loading: list.isLoading }
}

export default function AllBidsPage() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const lang = i18n.language
  const ict = useModuleData("ict")
  const tel = useModuleData("telecom")
  const data = { ict, telecom: tel }
  const [q, setQ] = useState("")
  const [mod, setMod] = useState("all")
  const [filter, setFilter] = useState("all")

  const all = [...ict.rows, ...tel.rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const inModule = all.filter(r => mod === "all" || r._module === mod)
  const counts = Object.fromEntries(STATUS_FILTERS.map(f => [f.id, inModule.filter(r => f.match(r.status)).length]))
  const needle = q.trim().toLowerCase()
  const shown = inModule.filter(r => STATUS_FILTERS.find(f => f.id === filter).match(r.status) && (!needle ||
    [r.rfp_number, r.rfp_title, r.rfp_ref, r.client_name_en, r.client_name_ar, r.am_name].some(v => (v || "").toLowerCase().includes(needle))))
  const currency = ict.currency || tel.currency
  const cur = currency?.code ? ` · ${currency.code}` : ""
  const loading = ict.loading || tel.loading

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bids</h1>
          <p className="page-subtitle">Every bid from RFP ICT and RFP Telecom in one list</p>
        </div>
        <div className="flex gap-2">
          {MODULES.map(m => (
            <button key={m} className="btn-primary" onClick={() => navigate(`${RFP_MODULES[m].path}/new`)}>
              <Plus size={14}/> New {m === "ict" ? "ICT" : "Telecom"} bid
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input className="input pl-9" placeholder="Search client, title, bid number or reference" value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[["all", "Both"], ["ict", "ICT"], ["telecom", "Telecom"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setMod(id)}
              className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium", mod === id ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-900")}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium border",
                filter === f.id ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
              {f.label} <span className={filter === f.id ? "text-white/60" : "text-gray-400"}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl [&_th]:px-3 [&_td]:px-3">
            <thead>
              <tr><th>Bid</th><th>Module</th><th>Client</th><th>Submission</th><th>Bond</th><th title="Account manager">AM</th>
                <th className="text-right">TCV{cur}</th><th>Go / No-Go</th><th>Status</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10"><Loader2 className="animate-spin inline text-blue-500" size={20}/></td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={9} className="py-12">
                  <div className="empty-state">
                    <div className="empty-icon mx-auto"><Briefcase size={28}/></div>
                    <p className="text-sm text-gray-400">{all.length ? "No bids match this search." : "No bids yet. Use \"New ICT bid\" or \"New Telecom bid\" to add the first one."}</p>
                  </div>
                </td></tr>
              ) : shown.map(r => {
                const d = r.days_to_submission
                const { lists } = data[r._module]
                return (
                  <tr key={`${r._module}-${r.rfp_id}`} className="cursor-pointer" onClick={() => navigate(`${RFP_MODULES[r._module].path}/${r.rfp_id}`)}>
                    <td className="max-w-[200px]">
                      <div className="font-mono text-xs text-blue-600 whitespace-nowrap">{r.rfp_number}</div>
                      {r.rfp_title && <div className="text-sm text-gray-900 truncate" title={r.rfp_title}>{r.rfp_title}</div>}
                      {r.rfp_ref && <div className="text-xs text-gray-500 truncate">{r.rfp_ref}</div>}
                    </td>
                    <td><span className={clsx("badge text-xs", r._module === "ict" ? "bg-blue-50 text-blue-700" : "bg-teal-50 text-teal-700")}>{r._module === "ict" ? "ICT" : "Telecom"}</span></td>
                    <td className="min-w-[140px]">
                      <div className="font-medium text-gray-900 flex items-center gap-1">
                        {r.client_name_en}{r.is_strategic && <Star size={11} className="text-amber-500 fill-amber-400"/>}
                      </div>
                      {r.client_name_ar && <div className="text-xs text-gray-400" dir="rtl">{r.client_name_ar}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="text-sm">{fmt(r.submission_date)}</div>
                      <div className={clsx("text-xs font-semibold", d < 0 ? "text-gray-400" : d <= 7 ? "text-red-600" : "text-gray-500")}>
                        {d < 0 ? "Passed" : d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"} left`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {r.bid_bond_required
                        ? <span className="flex items-center gap-1 text-sm text-gray-700"><Shield size={12} className="text-amber-500"/>{Number(r.bid_bond_pct)}%</span>
                        : <span className="text-gray-400 text-sm">No</span>}
                    </td>
                    <td className="text-sm text-gray-700">{r.am_name || <span className="text-gray-400">—</span>}</td>
                    <td className="text-sm text-right tabular-nums whitespace-nowrap">{formatMoney(r.tcv, { decimals: currency?.decimals })}</td>
                    <td>
                      {r.eval_recommendation
                        ? <span className={clsx("badge text-xs whitespace-nowrap", GO_STYLE[r.eval_recommendation])}>{GO_LABEL[r.eval_recommendation]}{r.eval_score !== null ? ` · ${Number(r.eval_score)}%` : ""}</span>
                        : <span className="text-xs text-gray-400">Not evaluated</span>}
                    </td>
                    <td>
                      <span className={clsx("badge text-xs whitespace-nowrap", STATUS_STYLE[r.status] || "badge-gray")}>{optionLabel(lists.status, r.status, lang)}</span>
                      <div className="text-[11px] text-gray-400 mt-0.5">{optionLabel(lists.phase, r.phase, lang)}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
