import React, { useState, useMemo } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Plus, Check, Trash2, Monitor, Loader2, ListTree, Search, Star, Shield } from "lucide-react"
import { rfpIctApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import { SCOPE_LEVELS, buildTree, STATUS_STYLE, LOST_STATUSES, optionLabel, formatMoney } from "../utils/rfpIct"
import EvalQuestionsManager from "../components/rfp/EvalQuestionsManager"

const GO_STYLE = { GO: "bg-green-100 text-green-700", NO_GO: "bg-red-100 text-red-700", INCOMPLETE: "bg-amber-100 text-amber-700", NOT_SET_UP: "bg-gray-100 text-gray-500" }
const GO_LABEL = { GO: "Go", NO_GO: "No-Go", INCOMPLETE: "Incomplete", NOT_SET_UP: "Not set up" }

const STATUS_FILTERS = [
  { id: "all",    label: "All",         match: () => true },
  { id: "open",   label: "Open",        match: s => ["PENDING", "IN_PROGRESS", "NEGOTIATION"].includes(s) },
  { id: "won",    label: "Won",         match: s => s === "WON" },
  { id: "lost",   label: "Lost",        match: s => LOST_STATUSES.includes(s) },
  { id: "closed", label: "Dropped / cancelled", match: s => ["DROPPED", "CANCELLED"].includes(s) },
]

// ── Scope of work list manager ────────────────────────────────────────────────
function ScopeNode({ node, tree, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const kids = tree.children(node.cat_id)
  const level = SCOPE_LEVELS[node.level - 1]
  const next = SCOPE_LEVELS[node.level]
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
          {kids.map(k => <ScopeNode key={k.cat_id} node={k} tree={tree} onAdd={onAdd} onRemove={onRemove}/>)}
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

function ScopeListManager() {
  const qc = useQueryClient()
  const { data: options = [] } = useQuery({ queryKey: ["rfp-ict-scope"], queryFn: () => rfpIctApi.scopeOptions().then(r => r.data) })
  const tree = useMemo(() => buildTree(options), [options])
  const [rootName, setRootName] = useState("")
  const refresh = () => qc.invalidateQueries({ queryKey: ["rfp-ict-scope"] })
  const onAdd = async (parent_id, cat_name, done) => {
    try { await rfpIctApi.addScopeOption({ parent_id, cat_name }); refresh(); done() }
    catch (err) { toast.error(apiErrorMessage(err, "Couldn't add the item")) }
  }
  const onRemove = async node => {
    if (!window.confirm(`Remove "${node.cat_name}" and everything under it?`)) return
    try { await rfpIctApi.removeScopeOption(node.cat_id); toast.success("Removed"); refresh() }
    catch (err) { toast.error(apiErrorMessage(err, "Couldn't remove the item")) }
  }
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
      <div className="card space-y-4">
        <div>
          <div className="section-title flex items-center gap-2"><ListTree size={13}/> Scope of work list</div>
          <p className="text-sm text-gray-500">The choices offered in field 4 of every RFP. Each item can have items under it, five levels deep.</p>
        </div>
        <div>{tree.children(null).map(n => <ScopeNode key={n.cat_id} node={n} tree={tree} onAdd={onAdd} onRemove={onRemove}/>)}</div>
        <div className="flex gap-2 pt-3 border-t">
          <input className="input" placeholder="New scope (4.1), e.g. Infrastructure" value={rootName} onChange={e => setRootName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && rootName.trim() && onAdd(null, rootName.trim(), () => setRootName(""))}/>
          <button className="btn-secondary whitespace-nowrap" disabled={!rootName.trim()}
            onClick={() => onAdd(null, rootName.trim(), () => setRootName(""))}><Plus size={13}/> Add scope</button>
        </div>
      </div>
      <div className="card p-4 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">The five levels</div>
        {SCOPE_LEVELS.map((l, i) => (
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
export default function RfpIctPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = ["scope", "questions"].includes(params.get("tab")) ? params.get("tab") : "rfps"
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")

  const { data: rfps = [], isLoading } = useQuery({ queryKey: ["rfp-ict"], queryFn: () => rfpIctApi.list().then(r => r.data) })
  const { data: meta } = useQuery({ queryKey: ["rfp-ict-lists"], queryFn: () => rfpIctApi.lists().then(r => r.data) })
  const lists = meta?.lists || {}

  const deleteMut = useMutation({
    mutationFn: id => rfpIctApi.delete(id),
    onSuccess: () => { toast.success("RFP deleted"); qc.invalidateQueries({ queryKey: ["rfp-ict"] }) },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't delete the RFP")),
  })

  const counts = Object.fromEntries(STATUS_FILTERS.map(f => [f.id, rfps.filter(r => f.match(r.status)).length]))
  const needle = q.trim().toLowerCase()
  const shown = rfps.filter(r => STATUS_FILTERS.find(f => f.id === filter).match(r.status) && (!needle ||
    [r.rfp_number, r.rfp_title, r.rfp_ref, r.client_name_en, r.client_name_ar, r.am_name].some(v => (v || "").toLowerCase().includes(needle))))

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">RFP ICT</h1>
          <p className="page-subtitle">Module 2 · ICT requests for proposal</p>
        </div>
        {tab === "rfps" && <button className="btn-primary" onClick={() => navigate("/rfp-ict/new")}><Plus size={14}/> New RFP</button>}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {[["rfps", "RFPs"], ["scope", "Scope of work list"], ["questions", "Evaluation questions"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setParams(id === "rfps" ? {} : { tab: id })}
            className={clsx("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px",
              tab === id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-900")}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "scope" ? <ScopeListManager/> : tab === "questions" ? <EvalQuestionsManager/> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input className="input pl-9" placeholder="Search client, title, RFP number or reference" value={q} onChange={e => setQ(e.target.value)}/>
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
              <table className="tbl">
                <thead>
                  <tr><th>RFP</th><th>Client</th><th>Submission</th><th>Bond</th><th>Scope</th><th title="Account manager">AM</th><th className="text-right">TCV</th><th>Go / No-Go</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={10} className="text-center py-10"><Loader2 className="animate-spin inline text-blue-500" size={20}/></td></tr>
                  ) : shown.length === 0 ? (
                    <tr><td colSpan={10} className="py-12">
                      <div className="empty-state">
                        <div className="empty-icon mx-auto"><Monitor size={28}/></div>
                        <p className="text-sm text-gray-400">{rfps.length ? "No RFPs match this search." : "No ICT RFPs yet. Use \"New RFP\" to add the first one."}</p>
                      </div>
                    </td></tr>
                  ) : shown.map(r => {
                    const d = r.days_to_submission
                    return (
                      <tr key={r.rfp_id} className="cursor-pointer" onClick={() => navigate(`/rfp-ict/${r.rfp_id}`)}>
                        <td className="max-w-[190px]">
                          <div className="font-mono text-xs text-blue-600 whitespace-nowrap">{r.rfp_number}</div>
                          {r.rfp_title && <div className="text-sm text-gray-900 truncate" title={r.rfp_title}>{r.rfp_title}</div>}
                          {r.rfp_ref && <div className="text-xs text-gray-500 truncate" title={r.rfp_ref}>{r.rfp_ref}</div>}
                          {r.channel && <div className="text-xs text-gray-400 truncate">{optionLabel(lists.channel, r.channel, i18n.language)}</div>}
                        </td>
                        <td className="min-w-[170px]">
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
                        <td className="whitespace-nowrap">
                          {r.bid_bond_required
                            ? <span className="flex items-center gap-1 text-sm text-gray-700"><Shield size={12} className="text-amber-500"/>{Number(r.bid_bond_pct)}%</span>
                            : <span className="text-gray-400 text-sm">No</span>}
                        </td>
                        <td className="text-sm">
                          {r.scope_level1 ? <>{r.scope_level1}{r.scope_count > 1 && <span className="text-xs text-gray-400"> +{r.scope_count - 1}</span>}</> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="text-sm text-gray-700">{r.am_name || <span className="text-gray-400">—</span>}</td>
                        <td className="text-sm text-right tabular-nums whitespace-nowrap">{formatMoney(r.tcv, meta?.currency)}</td>
                        <td onClick={e => { e.stopPropagation(); navigate(`/rfp-ict/${r.rfp_id}?tab=evaluation`) }}>
                          {r.eval_recommendation ? (
                            <span className={clsx("badge text-xs whitespace-nowrap", GO_STYLE[r.eval_recommendation])}>
                              {GO_LABEL[r.eval_recommendation]}{r.eval_score !== null ? ` · ${Number(r.eval_score)}%` : ""}
                            </span>
                          ) : <span className="text-xs text-gray-400">Not evaluated</span>}
                        </td>
                        <td>
                          <span className={clsx("badge text-xs whitespace-nowrap", STATUS_STYLE[r.status] || "badge-gray")}>{optionLabel(lists.status, r.status, i18n.language)}</span>
                          <div className="text-[11px] text-gray-400 mt-0.5">{optionLabel(lists.phase, r.phase, i18n.language)}</div>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn-ghost btn-sm text-red-400" title="Delete"
                            onClick={() => { if (window.confirm(`Delete ${r.rfp_number}?`)) deleteMut.mutate(r.rfp_id) }}><Trash2 size={12}/></button>
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
