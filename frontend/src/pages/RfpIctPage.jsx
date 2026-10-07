import React, { useState, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { clientsApi, rfpIctApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Plus, X, Check, Pencil, Trash2, Monitor, Languages, Loader2, ChevronRight, ListTree } from "lucide-react"

const BID_BOND_PCTS = [1, 2, 3]
const MAX_LEVELS = 5

const EMPTY_RFP = { client_id: "", submission_date: "", queries_deadline: "", bid_bond_required: false, bid_bond_pct: "", scope_ids: [] }

function buildTree(options) {
  const byId = new Map(options.map(o => [o.cat_id, o]))
  const children = new Map()
  options.forEach(o => {
    const key = o.parent_id ?? 0
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(o)
  })
  return { byId, children: id => children.get(id ?? 0) || [] }
}

// ── Arabic auto-translation ───────────────────────────────────────────────────
// Fills the Arabic field when the English field is left, unless someone has
// already typed their own Arabic there.
function useArabicAutofill(kind) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const run = async (english, currentArabic, wasAuto, setArabic) => {
    const text = (english || "").trim()
    if (!text || (currentArabic && !wasAuto)) return
    setBusy(true); setError("")
    try {
      const r = await clientsApi.translate(text, kind)
      setArabic(r.data.arabic)
    } catch (err) {
      setError(apiErrorMessage(err, "Translation failed. Type the Arabic yourself."))
    } finally { setBusy(false) }
  }
  return { busy, error, run }
}

function BilingualField({ label, multiline, en, ar, onEn, onAr, onLeaveEn, busy, error, required }) {
  const Input = multiline ? "textarea" : "input"
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{label} (English){required ? " *" : ""}</label>
          <Input className="input" rows={multiline ? 2 : undefined} value={en} onChange={e => onEn(e.target.value)} onBlur={onLeaveEn}/>
        </div>
        <div>
          <label className="label flex items-center gap-1.5">
            {label} (Arabic) {busy && <Loader2 size={11} className="animate-spin text-blue-500"/>}
          </label>
          <Input className="input" dir="rtl" rows={multiline ? 2 : undefined} value={ar} onChange={e => onAr(e.target.value)}
            placeholder={busy ? "Translating…" : "Filled in automatically"}/>
        </div>
      </div>
      {error && <p className="text-xs text-amber-600">{error}</p>}
    </div>
  )
}

function NewClientForm({ onCreated, onCancel }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name_en: "", name_ar: "", billing_address_en: "", billing_address_ar: "" })
  const [auto, setAuto] = useState({ name: false, address: false })
  const nameTr = useArabicAutofill("name")
  const addrTr = useArabicAutofill("address")
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const saveMut = useMutation({
    mutationFn: () => clientsApi.create(f),
    onSuccess: r => { toast.success("Client added"); qc.invalidateQueries({ queryKey: ["clients"] }); onCreated(r.data) },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't add the client")),
  })

  return (
    <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/60 space-y-3">
      <div className="flex items-center gap-2 text-xs text-blue-700">
        <Languages size={13}/> Type in English; the Arabic fills in automatically and can be corrected.
      </div>
      <BilingualField label="Client name" required en={f.name_en} ar={f.name_ar}
        onEn={v => set("name_en", v)} onAr={v => { set("name_ar", v); setAuto(a => ({ ...a, name: false })) }}
        onLeaveEn={() => nameTr.run(f.name_en, f.name_ar, auto.name, v => { set("name_ar", v); setAuto(a => ({ ...a, name: true })) })}
        busy={nameTr.busy} error={nameTr.error}/>
      <BilingualField label="Billing address" multiline en={f.billing_address_en} ar={f.billing_address_ar}
        onEn={v => set("billing_address_en", v)} onAr={v => { set("billing_address_ar", v); setAuto(a => ({ ...a, address: false })) }}
        onLeaveEn={() => addrTr.run(f.billing_address_en, f.billing_address_ar, auto.address, v => { set("billing_address_ar", v); setAuto(a => ({ ...a, address: true })) })}
        busy={addrTr.busy} error={addrTr.error}/>
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={!f.name_en.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>
          <Check size={12}/> {saveMut.isPending ? "Saving…" : "Save client"}
        </button>
        <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Scope of work picker (up to 5 levels) ─────────────────────────────────────
function ScopePicker({ options, selected, onChange }) {
  const tree = useMemo(() => buildTree(options), [options])
  const sel = new Set(selected)
  const roots = tree.children(null)
  const level1 = roots.find(r => sel.has(r.cat_id))

  const descendants = id => tree.children(id).flatMap(c => [c.cat_id, ...descendants(c.cat_id)])
  const toggle = id => {
    const next = new Set(sel)
    if (next.has(id)) { next.delete(id); descendants(id).forEach(d => next.delete(d)) }
    else next.add(id)
    onChange([...next])
  }

  const levels = []
  let parents = level1 ? [level1] : []
  for (let lvl = 2; lvl <= MAX_LEVELS && parents.length; lvl++) {
    const groups = parents.map(p => ({ parent: p, items: tree.children(p.cat_id) })).filter(g => g.items.length)
    if (!groups.length) break
    levels.push({ lvl, groups })
    parents = groups.flatMap(g => g.items.filter(i => sel.has(i.cat_id)))
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Level 1</label>
        <select className="input" value={level1?.cat_id || ""}
          onChange={e => onChange(e.target.value ? [Number(e.target.value)] : [])}>
          <option value="">Choose the main scope…</option>
          {roots.map(r => <option key={r.cat_id} value={r.cat_id}>{r.cat_name}</option>)}
        </select>
      </div>
      {levels.map(({ lvl, groups }) => (
        <div key={lvl}>
          <label className="label">Level {lvl} <span className="normal-case font-normal text-gray-400">· choose one or more</span></label>
          <div className="space-y-2">
            {groups.map(({ parent, items }) => (
              <div key={parent.cat_id} className="flex flex-wrap items-center gap-2">
                {groups.length > 1 && <span className="text-xs text-gray-400 w-full">Under {parent.cat_name}</span>}
                {items.map(it => (
                  <label key={it.cat_id} className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm",
                    sel.has(it.cat_id) ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                    <input type="checkbox" className="accent-blue-600" checked={sel.has(it.cat_id)} onChange={() => toggle(it.cat_id)}/>
                    {it.cat_name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
      {level1 && levels.length === 0 && (
        <p className="text-xs text-gray-400">Nothing is listed under {level1.cat_name} yet. Add Level 2 items in the "Scope of work list" tab.</p>
      )}
    </div>
  )
}

// ── RFP form ──────────────────────────────────────────────────────────────────
function RfpModal({ rfpId, onClose }) {
  const qc = useQueryClient()
  const isNew = !rfpId
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsApi.list().then(r => r.data) })
  const { data: options = [] } = useQuery({ queryKey: ["rfp-ict-scope"], queryFn: () => rfpIctApi.scopeOptions().then(r => r.data) })
  const { data: existing } = useQuery({ queryKey: ["rfp-ict", rfpId], queryFn: () => rfpIctApi.get(rfpId).then(r => r.data), enabled: !isNew })
  const [form, setForm] = useState(EMPTY_RFP)
  const [addingClient, setAddingClient] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (existing) setForm({
      client_id: existing.client_id, submission_date: existing.submission_date, queries_deadline: existing.queries_deadline || "",
      bid_bond_required: existing.bid_bond_required, bid_bond_pct: existing.bid_bond_pct ? Number(existing.bid_bond_pct) : "",
      scope_ids: existing.scope.map(s => s.cat_id),
    })
  }, [existing])

  const client = clients.find(c => c.client_id === Number(form.client_id))

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        client_id: Number(form.client_id), submission_date: form.submission_date,
        queries_deadline: form.queries_deadline || null, bid_bond_required: form.bid_bond_required,
        bid_bond_pct: form.bid_bond_required && form.bid_bond_pct ? Number(form.bid_bond_pct) : null,
        scope_ids: form.scope_ids,
      }
      return isNew ? rfpIctApi.create(payload) : rfpIctApi.update(rfpId, payload)
    },
    onSuccess: r => {
      toast.success(isNew ? `${r.data.rfp_number} created` : "RFP updated")
      qc.invalidateQueries({ queryKey: ["rfp-ict"] })
      onClose()
    },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the RFP")),
  })

  const canSave = form.client_id && form.submission_date && (!form.bid_bond_required || form.bid_bond_pct)

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-gray-900">{isNew ? "New RFP" : `Edit ${existing?.rfp_number || "RFP"}`}</h2>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="p-5 space-y-6">
          {/* 1 — Client */}
          <section className="space-y-2">
            <div className="section-title">1 — Client</div>
            {addingClient ? (
              <NewClientForm onCancel={() => setAddingClient(false)}
                onCreated={c => { set("client_id", c.client_id); setAddingClient(false) }}/>
            ) : (
              <>
                <div className="flex gap-2">
                  <select className="input" value={form.client_id} onChange={e => set("client_id", e.target.value)}>
                    <option value="">Choose a client…</option>
                    {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.name_en}{c.name_ar ? ` — ${c.name_ar}` : ""}</option>)}
                  </select>
                  <button className="btn-secondary whitespace-nowrap" onClick={() => setAddingClient(true)}><Plus size={13}/> New client</button>
                </div>
                {client && (
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm">
                    <div>
                      <div className="font-semibold text-gray-900">{client.name_en}</div>
                      <div className="text-gray-500 text-xs mt-0.5 whitespace-pre-line">{client.billing_address_en || "No billing address"}</div>
                    </div>
                    <div dir="rtl">
                      <div className="font-semibold text-gray-900">{client.name_ar || "—"}</div>
                      <div className="text-gray-500 text-xs mt-0.5 whitespace-pre-line">{client.billing_address_ar || ""}</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* 2 & 3 — Dates */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <div className="section-title">2 — Submission date</div>
              <input type="date" className="input" value={form.submission_date} onChange={e => set("submission_date", e.target.value)}/>
            </div>
            <div>
              <div className="section-title">3 — Last date for queries</div>
              <input type="date" className="input" value={form.queries_deadline} max={form.submission_date || undefined}
                onChange={e => set("queries_deadline", e.target.value)}/>
            </div>
          </section>

          {/* Bid bond */}
          <section className="space-y-2">
            <div className="section-title">Bid bond</div>
            <div className="flex items-center gap-3 flex-wrap">
              {[[true, "Yes"], [false, "No"]].map(([val, lbl]) => (
                <label key={lbl} className={clsx("flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium",
                  form.bid_bond_required === val ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                  <input type="checkbox" className="accent-blue-600" checked={form.bid_bond_required === val}
                    onChange={() => setForm(p => ({ ...p, bid_bond_required: val, bid_bond_pct: val ? p.bid_bond_pct : "" }))}/>
                  {lbl}
                </label>
              ))}
              {form.bid_bond_required && (
                <select className="input w-40" value={form.bid_bond_pct} onChange={e => set("bid_bond_pct", e.target.value)}>
                  <option value="">Percentage…</option>
                  {BID_BOND_PCTS.map(p => <option key={p} value={p}>{p}%</option>)}
                </select>
              )}
            </div>
          </section>

          {/* 4 — Scope of work */}
          <section className="space-y-2">
            <div className="section-title">4 — Scope of work</div>
            <ScopePicker options={options} selected={form.scope_ids} onChange={ids => set("scope_ids", ids)}/>
          </section>

          <div className="flex gap-3 justify-end pt-2 border-t">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!canSave || saveMut.isPending || addingClient} onClick={() => saveMut.mutate()}>
              <Check size={13}/> {saveMut.isPending ? "Saving…" : isNew ? "Create RFP" : "Save RFP"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Scope of work list manager ────────────────────────────────────────────────
function ScopeNode({ node, tree, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const kids = tree.children(node.cat_id)
  const submit = () => { if (name.trim()) onAdd(node.cat_id, name.trim(), () => { setName(""); setAdding(false) }) }
  return (
    <div>
      <div className="group flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
        <span className="badge-gray text-[10px] flex-shrink-0">L{node.level}</span>
        <span className="text-sm text-gray-900">{node.cat_name}</span>
        {node.cat_name_ar && <span className="text-xs text-gray-400" dir="rtl">{node.cat_name_ar}</span>}
        <div className="ml-auto flex gap-1">
          {node.level < MAX_LEVELS && (
            <button className="btn-ghost btn-sm text-xs" onClick={() => setAdding(a => !a)}><Plus size={11}/> Add under</button>
          )}
          <button className="btn-ghost btn-sm text-red-400" title="Remove" onClick={() => onRemove(node)}><Trash2 size={11}/></button>
        </div>
      </div>
      {(kids.length > 0 || adding) && (
        <div className="ml-5 pl-3 border-l border-gray-200">
          {kids.map(k => <ScopeNode key={k.cat_id} node={k} tree={tree} onAdd={onAdd} onRemove={onRemove}/>)}
          {adding && (
            <div className="flex gap-2 py-1.5">
              <input className="input !py-1.5" autoFocus placeholder={`New Level ${node.level + 1} item under ${node.cat_name}`}
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
    <div className="card space-y-4">
      <div>
        <div className="section-title flex items-center gap-2"><ListTree size={13}/> Scope of work list</div>
        <p className="text-sm text-gray-500">
          The choices offered in field 4, up to five levels deep — for example Infrastructure → Networking → Routing &amp; Switching → Cisco.
        </p>
      </div>
      <div>
        {tree.children(null).map(n => <ScopeNode key={n.cat_id} node={n} tree={tree} onAdd={onAdd} onRemove={onRemove}/>)}
      </div>
      <div className="flex gap-2 pt-2 border-t">
        <input className="input" placeholder="New Level 1 item" value={rootName} onChange={e => setRootName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && rootName.trim() && onAdd(null, rootName.trim(), () => setRootName(""))}/>
        <button className="btn-secondary whitespace-nowrap" disabled={!rootName.trim()}
          onClick={() => onAdd(null, rootName.trim(), () => setRootName(""))}><Plus size={13}/> Add Level 1</button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RfpIctPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState("rfps")
  const [editing, setEditing] = useState(null)   // null | "new" | rfp_id
  const { data: rfps = [], isLoading } = useQuery({ queryKey: ["rfp-ict"], queryFn: () => rfpIctApi.list().then(r => r.data) })

  const deleteMut = useMutation({
    mutationFn: id => rfpIctApi.delete(id),
    onSuccess: () => { toast.success("RFP deleted"); qc.invalidateQueries({ queryKey: ["rfp-ict"] }) },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't delete the RFP")),
  })

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">RFP ICT</h1>
          <p className="page-subtitle">Module 2 · RFP details, dates, bid bond and scope of work</p>
        </div>
        {tab === "rfps" && <button className="btn-primary" onClick={() => setEditing("new")}><Plus size={14}/> New RFP</button>}
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {[["rfps", "RFPs"], ["scope", "Scope of work list"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px",
              tab === id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-900")}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "scope" ? <ScopeListManager/> : (
        <div className="card p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>RFP #</th><th>Client</th><th>Submission</th><th>Last date for queries</th><th>Bid bond</th><th>Scope of work</th><th></th></tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-10"><Loader2 className="animate-spin inline text-blue-500" size={20}/></td></tr>
                ) : rfps.length === 0 ? (
                  <tr><td colSpan={7} className="py-12">
                    <div className="empty-state">
                      <div className="empty-icon mx-auto"><Monitor size={28}/></div>
                      <p className="text-sm text-gray-400">No ICT RFPs yet. Use "New RFP" to add the first one.</p>
                    </div>
                  </td></tr>
                ) : rfps.map(r => {
                  const d = r.days_to_submission
                  return (
                    <tr key={r.rfp_id}>
                      <td className="font-mono text-xs text-blue-600 whitespace-nowrap">{r.rfp_number}</td>
                      <td>
                        <div className="font-medium text-gray-900">{r.client_name_en}</div>
                        {r.client_name_ar && <div className="text-xs text-gray-400" dir="rtl">{r.client_name_ar}</div>}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="text-sm">{fmt(r.submission_date)}</div>
                        <div className={clsx("text-xs font-semibold", d < 0 ? "text-gray-400" : d <= 7 ? "text-red-600" : "text-gray-500")}>
                          {d < 0 ? "Passed" : d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"} left`}
                        </div>
                      </td>
                      <td className="text-sm whitespace-nowrap">{r.queries_deadline ? fmt(r.queries_deadline) : "—"}</td>
                      <td>{r.bid_bond_required ? <span className="badge-amber">Yes · {Number(r.bid_bond_pct)}%</span> : <span className="badge-gray">No</span>}</td>
                      <td className="text-sm">
                        {r.scope_level1 ? (
                          <span className="flex items-center gap-1 text-gray-700">
                            {r.scope_level1}
                            {r.scope_count > 1 && <><ChevronRight size={12} className="text-gray-300"/><span className="text-xs text-gray-400">+{r.scope_count - 1} more</span></>}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td>
                        <div className="flex gap-1 justify-end">
                          <button className="btn-ghost btn-sm" title="Edit" onClick={() => setEditing(r.rfp_id)}><Pencil size={12}/></button>
                          <button className="btn-ghost btn-sm text-red-400" title="Delete"
                            onClick={() => { if (window.confirm(`Delete ${r.rfp_number}?`)) deleteMut.mutate(r.rfp_id) }}><Trash2 size={12}/></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <RfpModal rfpId={editing === "new" ? null : editing} onClose={() => setEditing(null)}/>}
    </div>
  )
}
