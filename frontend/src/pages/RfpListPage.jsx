import React, { useState, useMemo } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Plus, Check, Trash2, Monitor, RadioTower, University, Loader2, ListTree, Search, Star, Shield } from "lucide-react"
import { rfpApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import { RFP_MODULES, buildTree, STATUS_STYLE, LOST_STATUSES, optionLabel, formatMoney, techLine } from "../utils/rfp"
import EvalQuestionsManager from "../components/rfp/EvalQuestionsManager"

const GO_STYLE = { GO: "bg-green-100 text-green-700", NO_GO: "bg-red-100 text-red-700", INCOMPLETE: "bg-amber-100 text-amber-700", NOT_SET_UP: "bg-gray-100 text-gray-500" }
const GO_LABEL = { GO: "Go", NO_GO: "No-Go", INCOMPLETE: "Incomplete", NOT_SET_UP: "Not set up" }
const MODULE_ICON = { ict: Monitor, telecom: RadioTower, expro: University }

const STATUS_FILTERS = [
  { id: "all",    label: "All",         match: () => true },
  { id: "open",   label: "Open",        match: s => ["PENDING", "IN_PROGRESS", "NEGOTIATION"].includes(s) },
  { id: "won",    label: "Won",         match: s => s === "WON" },
  { id: "lost",   label: "Lost",        match: s => LOST_STATUSES.includes(s) },
  { id: "closed", label: "Dropped / cancelled", exproLabel: "Dropped", match: s => ["DROPPED", "CANCELLED"].includes(s) },
]

// ── Scope of work list manager ────────────────────────────────────────────────
function ScopeNode({ node, tree, levels, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const kids = tree.children(node.cat_id)
  const level = levels[node.level - 1]
  const next = levels[node.level]
  const submit = () => { if (name.trim()) onAdd(node.cat_id, name.trim(), () => { setName(""); setAdding(false) }) }
  return (
    <div>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 flex-shrink-0" title={level?.name}>{level?.num}</span>
        <span className="text-sm text-gray-900">{node.cat_name}</span>
        {node.cat_name_ar && <span className="text-xs text-gray-400" dir="rtl">{node.cat_name_ar}</span>}
        <div className="ml-auto flex gap-1">
          {next && <button className="btn-ghost btn-sm text-xs" onClick={() => setAdding(a => !a)}><Plus size={11}/> Add {next.name.toLowerCase()}</button>}
          <button className="btn-ghost btn-sm text-red-400" title="Remove" onClick={() => onRemove(node)}><Trash2 size={11}/></button>
        </div>
      </div>
      {(kids.length > 0 || adding) && (
        <div className="ml-5 pl-3 border-l border-gray-200">
          {kids.map(k => <ScopeNode key={k.cat_id} node={k} tree={tree} levels={levels} onAdd={onAdd} onRemove={onRemove}/>)}
          {adding && (
            <div className="flex gap-2 py-1.5">
              <input className="input !py-1.5" autoFocus placeholder={`New ${next.name.toLowerCase()} under ${node.cat_name} — ${next.hint}`}
                value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}/>
              <button className="btn-primary btn-sm" onClick={submit}><Check size={12}/> Add</button>
              <button className="btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScopeListManager({ mod }) {
  const qc = useQueryClient()
  const api = rfpApi(mod.key)
  const { levels } = mod.scope
  const { data: options = [] } = useQuery({ queryKey: ["rfp-scope", mod.key], queryFn: () => api.scopeOptions().then(r => r.data) })
  const tree = useMemo(() => buildTree(options), [options])
  const [rootName, setRootName] = useState("")
  const refresh = () => qc.invalidateQueries({ queryKey: ["rfp-scope", mod.key] })
  const onAdd = async (parent_id, cat_name, done) => {
    try { await api.addScopeOption({ parent_id, cat_name }); refresh(); done() }
    catch (err) { toast.error(apiErrorMessage(err, "Couldn't add the item")) }
  }
  const onRemove = async node => {
    if (!window.confirm(`Remove "${node.cat_name}" and everything under it?`)) return
    try { await api.removeScopeOption(node.cat_id); toast.success("Removed"); refresh() }
    catch (err) { toast.error(apiErrorMessage(err, "Couldn't remove the item")) }
  }
  const first = levels[0].name.toLowerCase()
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
      <div className="card space-y-4">
        <div>
          <div className="section-title flex items-center gap-2"><ListTree size={13}/> {mod.scope.tab}</div>
          <p className="text-sm text-gray-500">
            The choices offered in field 4 of every RFP. Each item can have items under it, {levels.length} levels deep.
          </p>
        </div>
        <div>{tree.children(null).map(n => <ScopeNode key={n.cat_id} node={n} tree={tree} levels={levels} onAdd={onAdd} onRemove={onRemove}/>)}</div>
        <div className="flex gap-2 pt-3 border-t">
          <input className="input" placeholder={`New ${mod.scope.first}`} value={rootName} onChange={e => setRootName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && rootName.trim() && onAdd(null, rootName.trim(), () => setRootName(""))}/>
          <button className="btn-secondary whitespace-nowrap" disabled={!rootName.trim()}
            onClick={() => onAdd(null, rootName.trim(), () => setRootName(""))}><Plus size={13}/> Add {first}</button>
        </div>
      </div>
      <div className="card p-4 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">The {levels.length === 5 ? "five" : "two"} levels</div>
        {levels.map((l, i) => (
          <div key={l.num} className="flex gap-2 text-sm" style={{ paddingLeft: i * 10 }}>
            <span className="text-blue-600 font-semibold w-7 flex-shrink-0">{l.num}</span>
            <div><div className="font-medium text-gray-900">{l.name}</div><div className="text-xs text-gray-400">{l.hint}</div></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RfpListPage({ module }) {
  const mod = RFP_MODULES[module]
  const api = rfpApi(module)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const lang = i18n.language
  const [params, setParams] = useSearchParams()
  const tabs = [["rfps", mod.expro ? "Requests" : "RFPs"], ...(mod.scope ? [["scope", mod.scope.tab]] : []), ["questions", "Evaluation questions"]]
  const tab = tabs.some(([id]) => id === params.get("tab")) ? params.get("tab") : "rfps"
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")

  const { data: rfps = [], isLoading } = useQuery({ queryKey: ["rfps", module], queryFn: () => api.list().then(r => r.data) })
  const { data: meta } = useQuery({ queryKey: ["rfp-lists", module], queryFn: () => api.lists().then(r => r.data) })
  const lists = meta?.lists || {}
  const currency = meta?.currency

  const deleteMut = useMutation({
    mutationFn: id => api.delete(id),
    onSuccess: () => { toast.success(`${mod.expro ? "Request" : "RFP"} deleted`); qc.invalidateQueries({ queryKey: ["rfps", module] }) },
    onError: err => toast.error(apiErrorMessage(err, `Couldn't delete the ${mod.noun}`)),
  })

  const counts = Object.fromEntries(STATUS_FILTERS.map(f => [f.id, rfps.filter(r => f.match(r.status)).length]))
  const needle = q.trim().toLowerCase()
  const shown = rfps.filter(r => STATUS_FILTERS.find(f => f.id === filter).match(r.status) && (!needle ||
    [r.rfp_number, r.rfp_title, r.rfp_ref, r.sow, r.client_name_en, r.client_name_ar, r.am_name].some(v => (v || "").toLowerCase().includes(needle))))
  const Icon = MODULE_ICON[module]
  const open = (r, tabId) => navigate(`${mod.path}/${r.rfp_id}${tabId ? `?tab=${tabId}` : ""}`)

  const cur = currency?.code ? ` · ${currency.code}` : ""
  const money = v => formatMoney(v, { decimals: currency?.decimals })
  const headers = mod.expro
    ? ["EXPRO no.", "Entity", "Submission", "SOW", "Bond", "AM", `NRC / MRC${cur}`, "Go / No-Go", "Status", ""]
    : ["RFP", "Client", "Submission", "Bond", mod.telecom ? "Solution" : "Scope", "AM", `${mod.telecom ? "TCV / MRC" : "TCV"}${cur}`, "Go / No-Go", "Status", ""]

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">{mod.title}</h1>
          <p className="page-subtitle">{mod.subtitle}</p>
        </div>
        {tab === "rfps" && <button className="btn-primary" onClick={() => navigate(`${mod.path}/new`)}><Plus size={14}/> New {mod.expro ? "request" : "RFP"}</button>}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(([id, lbl]) => (
          <button key={id} onClick={() => setParams(id === "rfps" ? {} : { tab: id })}
            className={clsx("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px",
              tab === id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-900")}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "scope" ? <ScopeListManager mod={mod}/> : tab === "questions" ? <EvalQuestionsManager module={module}/> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-9" value={q} onChange={e => setQ(e.target.value)}
                placeholder={mod.expro ? "Search entity, EXPRO number or SOW" : "Search client, title, RFP number or reference"}/>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium border",
                    filter === f.id ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                  {(mod.expro && f.exproLabel) || f.label} <span className={filter === f.id ? "text-white/60" : "text-gray-400"}>{counts[f.id]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-0">
            <div className="overflow-x-auto">
              <table className="tbl [&_th]:px-3 [&_td]:px-3">
                <thead>
                  <tr>{headers.map((h, i) => <th key={i} className={h.includes("TCV") || h.includes("NRC") ? "text-right" : undefined}
                    title={h === "AM" ? "Account manager" : undefined}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={headers.length} className="text-center py-10"><Loader2 className="animate-spin inline text-blue-500" size={20}/></td></tr>
                  ) : shown.length === 0 ? (
                    <tr><td colSpan={headers.length} className="py-12">
                      <div className="empty-state">
                        <div className="empty-icon mx-auto"><Icon size={28}/></div>
                        <p className="text-sm text-gray-400">
                          {rfps.length ? `No ${mod.nouns} match this search.`
                            : mod.expro ? "No EXPRO requests yet. Use \"New request\" to add the first one."
                            : `No ${mod.title} RFPs yet. Use "New RFP" to add the first one.`}
                        </p>
                      </div>
                    </td></tr>
                  ) : shown.map(r => {
                    const d = r.days_to_submission
                    const tech = mod.telecom ? techLine(r, lists, lang) : ""
                    return (
                      <tr key={r.rfp_id} className="cursor-pointer" onClick={() => open(r)}>
                        {mod.expro ? (
                          <td className="whitespace-nowrap">
                            <div className="font-semibold text-gray-900 tabular-nums">{r.rfp_ref}</div>
                            <div className="font-mono text-[11px] text-gray-400">{r.rfp_number}</div>
                            {r.request_date && <div className="text-[11px] text-gray-400">U.Date {fmt(r.request_date)}</div>}
                          </td>
                        ) : (
                          <td className="max-w-[160px]">
                            <div className="font-mono text-xs text-blue-600 whitespace-nowrap">{r.rfp_number}</div>
                            {r.rfp_title && <div className="text-sm text-gray-900 truncate" title={r.rfp_title}>{r.rfp_title}</div>}
                            {r.rfp_ref && <div className="text-xs text-gray-500 truncate" title={r.rfp_ref}>{r.rfp_ref}</div>}
                            {r.channel && <div className="text-xs text-gray-400 truncate">{optionLabel(lists.channel, r.channel, lang)}</div>}
                          </td>
                        )}
                        <td className="min-w-[140px]">
                          <div className="font-medium text-gray-900 flex items-center gap-1">
                            {r.client_name_en}{r.is_strategic && <Star size={11} className="text-amber-500 fill-amber-400" title="Strategic account"/>}
                          </div>
                          {r.client_name_ar && <div className="text-xs text-gray-400" dir="rtl">{r.client_name_ar}</div>}
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="text-sm">{fmt(r.submission_date)}</div>
                          <div className={clsx("text-xs font-semibold", d < 0 ? "text-gray-400" : d <= 7 ? "text-red-600" : "text-gray-500")}>
                            {d < 0 ? "Passed" : d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"} left`}
                          </div>
                        </td>
                        {mod.expro && (
                          <td className="min-w-[160px] max-w-[220px]">
                            <div className="text-sm text-gray-900 line-clamp-2" title={r.sow || ""}>{r.sow || <span className="text-gray-400">—</span>}</div>
                            {tech && <div className="text-xs text-gray-500 mt-0.5">{tech}</div>}
                          </td>
                        )}
                        <td className="whitespace-nowrap">
                          {r.bid_bond_required
                            ? <span className="flex items-center gap-1 text-sm text-gray-700"><Shield size={12} className="text-amber-500"/>{Number(r.bid_bond_pct)}%</span>
                            : <span className="text-gray-400 text-sm">No</span>}
                        </td>
                        {!mod.expro && (
                          <td className="text-sm min-w-[140px] max-w-[200px]">
                            {r.scope_level1 ? (
                              mod.telecom ? <>
                                <div className="text-gray-900">{r.scope_level1}</div>
                                {r.scope_level2 && <div className="text-xs text-gray-500 truncate" title={r.scope_level2}>{r.scope_level2}</div>}
                              </> : <>{r.scope_level1}{r.scope_count > 1 && <span className="text-xs text-gray-400"> +{r.scope_count - 1}</span>}</>
                            ) : <span className="text-gray-400">—</span>}
                            {tech && <div className="text-xs text-gray-400">{tech}</div>}
                          </td>
                        )}
                        <td className="text-sm text-gray-700">{r.am_name || <span className="text-gray-400">—</span>}</td>
                        <td className="text-sm text-right tabular-nums whitespace-nowrap">
                          {mod.expro ? <>
                            <div>{money(r.nrc)}</div>
                            <div className="text-xs text-gray-500">{r.mrc !== null ? `${money(r.mrc)} / mo` : "—"}</div>
                          </> : <>
                            <div>{money(r.tcv)}</div>
                            {mod.telecom && r.mrc !== null && <div className="text-xs text-gray-500">{money(r.mrc)} / mo</div>}
                          </>}
                        </td>
                        <td onClick={e => { e.stopPropagation(); open(r, "evaluation") }}>
                          {r.eval_recommendation ? (
                            <span className={clsx("badge text-xs whitespace-nowrap", GO_STYLE[r.eval_recommendation])}>
                              {GO_LABEL[r.eval_recommendation]}{r.eval_score !== null ? ` · ${Number(r.eval_score)}%` : ""}
                            </span>
                          ) : <span className="text-xs text-gray-400">Not evaluated</span>}
                        </td>
                        <td>
                          <span className={clsx("badge text-xs whitespace-nowrap", STATUS_STYLE[r.status] || "badge-gray")}>{optionLabel(lists.status, r.status, lang)}</span>
                          <div className="text-[11px] text-gray-400 mt-0.5">{optionLabel(lists.phase, r.phase, lang)}</div>
                          {r.reason && <div className="text-[11px] text-gray-400">{optionLabel(lists.reason, r.reason, lang)}</div>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn-ghost btn-sm text-red-400" title="Delete"
                            onClick={() => { if (window.confirm(`Delete ${mod.expro ? `EXPRO ${r.rfp_ref} (${r.rfp_number})` : r.rfp_number}?`)) deleteMut.mutate(r.rfp_id) }}><Trash2 size={12}/></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
