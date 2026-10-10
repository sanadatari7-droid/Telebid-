import React, { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate, useParams, Link, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import toast from "react-hot-toast"
import clsx from "clsx"
import {
  ArrowLeft, ArrowRight, Check, Plus, Languages, Loader2, Star, Shield, ExternalLink, ChevronDown, X, Lock,
} from "lucide-react"
import { clientsApi, rfpApi } from "../services/api"
import { apiErrorMessage } from "../utils/apiError"
import { fmt } from "../utils/fmt"
import { RFP_MODULES, buildTree, STATUS_STYLE, LOST_STATUSES, optionLabel, formatMoney, techLine } from "../utils/rfp"
import RfpEvaluation from "../components/rfp/RfpEvaluation"
import RfpBidBond from "../components/rfp/RfpBidBond"
import RfpChecklist from "../components/rfp/RfpChecklist"

// bid_bond_required starts empty (null) so Yes or No has to be chosen before moving on.
const EMPTY = {
  client_id: "", rfp_title: "", rfp_ref: "", channel: "", project_type: "", description: "",
  submission_date: "", queries_deadline: "", request_date: "", bid_bond_required: null, bid_bond_pct: "",
  scope_ids: [], sow: "", media: "", sla: "", bandwidth_mbps: "", quantity: "", contract_duration: "",
  coverage_study: "", location: "", attachment_url: "",
  am_id: "", presales_emp_id: "", bm_id: "", am_comment: "", presales_comment: "", bid_comment: "",
  project_size: "", tcv: "", nrc: "", mrc: "", phase: "ON_GOING", status: "PENDING", reason: "", winner_name: "", winner_tcv: "",
}
const NUMBERS = ["bid_bond_pct", "bandwidth_mbps", "quantity", "am_id", "presales_emp_id", "bm_id", "tcv", "nrc", "mrc", "winner_tcv"]
const has = v => v !== null && v !== undefined && String(v).trim() !== ""

// ── Small building blocks ─────────────────────────────────────────────────────
function Field({ label, required, optional, hint, children, className }) {
  return (
    <div className={className}>
      <label className="label flex items-center gap-1.5">
        {label}{required && <span className="text-red-500">*</span>}
        {optional && <span className="normal-case font-normal text-gray-400 tracking-normal">(optional)</span>}
      </label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  )
}

function Pills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button type="button" key={o.value} onClick={() => onChange(o.value)}
          className={clsx("px-3.5 py-2 rounded-xl border text-sm font-medium transition-colors",
            value === o.value ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select className="input" value={value ?? ""} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Unit({ unit, children }) {
  return (
    <div className="relative">
      {children}
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">{unit}</span>
    </div>
  )
}

// Yes / No as two checkboxes, only one of which can be ticked.
function YesNo({ value, onChange }) {
  return (
    <div className="flex gap-3">
      {[[true, "Yes"], [false, "No"]].map(([v, label]) => (
        <label key={label} className={clsx("flex items-center gap-2.5 px-5 py-3 rounded-xl border cursor-pointer text-sm font-medium transition-colors",
          value === v ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700 hover:bg-gray-50")}>
          <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={value === v} onChange={() => onChange(v)}/>
          {label}
        </label>
      ))}
    </div>
  )
}

// A drop-down list where several items can be ticked.
function MultiSelect({ groups, selected, onToggle, placeholder }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])
  const chosen = groups.flatMap(g => g.items).filter(it => selected.has(it.cat_id))
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="input flex items-center justify-between gap-2 text-left">
        <span className={chosen.length ? "text-gray-900" : "text-gray-400"}>
          {chosen.length ? `${chosen.length} selected` : placeholder}
        </span>
        <ChevronDown size={15} className={clsx("text-gray-400 transition-transform", open && "rotate-180")}/>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-y-auto py-1">
          {groups.map(g => (
            <div key={g.parent.cat_id}>
              {groups.length > 1 && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Under {g.parent.cat_name}</div>}
              {g.items.map(it => (
                <label key={it.cat_id} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={selected.has(it.cat_id)} onChange={() => onToggle(it.cat_id)}/>
                  {it.cat_name}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chosen.map(it => (
            <span key={it.cat_id} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-800">
              {it.cat_name}
              <button type="button" onClick={() => onToggle(it.cat_id)} className="text-blue-400 hover:text-blue-700" title="Remove"><X size={12}/></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const isLink = v => /^https?:\/\//i.test((v || "").trim())

// ── New client (English with automatic Arabic) ────────────────────────────────
function useArabicAutofill(kind) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const run = async (english, currentArabic, wasAuto, setArabic) => {
    const text = (english || "").trim()
    if (!text || (currentArabic && !wasAuto)) return
    setBusy(true); setError("")
    try { setArabic((await clientsApi.translate(text, kind)).data.arabic) }
    catch (err) { setError(apiErrorMessage(err, "Translation failed. Type the Arabic yourself.")) }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

function NewClientForm({ noun, onCreated, onCancel }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name_en: "", name_ar: "", billing_address_en: "", billing_address_ar: "", is_strategic: false })
  const [auto, setAuto] = useState({ name: false, address: false })
  const nameTr = useArabicAutofill("name")
  const addrTr = useArabicAutofill("address")
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const saveMut = useMutation({
    mutationFn: () => clientsApi.create(f),
    onSuccess: r => { toast.success(`${noun} added`); qc.invalidateQueries({ queryKey: ["clients"] }); onCreated(r.data) },
    onError: err => toast.error(apiErrorMessage(err, `Couldn't add the ${noun.toLowerCase()}`)),
  })
  const pair = (label, kEn, kAr, autoKey, tr, multiline) => {
    const Input = multiline ? "textarea" : "input"
    return (
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={`${label} (English)`} required>
          <Input className="input" rows={multiline ? 2 : undefined} value={f[kEn]} onChange={e => set(kEn, e.target.value)}
            onBlur={() => tr.run(f[kEn], f[kAr], auto[autoKey], v => { set(kAr, v); setAuto(a => ({ ...a, [autoKey]: true })) })}/>
        </Field>
        <Field label={<span className="flex items-center gap-1.5">{label} (Arabic){tr.busy && <Loader2 size={11} className="animate-spin text-blue-500"/>}</span>} required>
          <Input className="input" dir="rtl" rows={multiline ? 2 : undefined} value={f[kAr]}
            placeholder={tr.busy ? "Translating…" : "Filled in automatically"}
            onChange={e => { set(kAr, e.target.value); setAuto(a => ({ ...a, [autoKey]: false })) }}/>
          {tr.error && <p className="text-xs text-amber-600 mt-1">{tr.error}</p>}
        </Field>
      </div>
    )
  }
  const complete = ["name_en", "name_ar", "billing_address_en", "billing_address_ar"].every(k => has(f[k]))
  return (
    <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/50 space-y-3">
      <div className="flex items-center gap-2 text-xs text-blue-700">
        <Languages size={13}/> Type in English. The Arabic fills in when you leave the field, and you can correct it.
      </div>
      {pair(`${noun} name`, "name_en", "name_ar", "name", nameTr)}
      {pair("Billing address", "billing_address_en", "billing_address_ar", "address", addrTr, true)}
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer w-fit">
        <input type="checkbox" className="accent-blue-600" checked={f.is_strategic} onChange={e => set("is_strategic", e.target.checked)}/>
        Strategic account
      </label>
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={!complete || saveMut.isPending} onClick={() => saveMut.mutate()}>
          <Check size={12}/> {saveMut.isPending ? "Saving…" : `Save ${noun.toLowerCase()}`}
        </button>
        <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// The levels of the scope of work shown for the current selection: level 1, then the
// items under whatever is chosen at the level above.
function scopeLevels(tree, sel, count) {
  const roots = tree.children(null)
  const levels = [{ i: 0, groups: [{ parent: { cat_id: 0 }, items: roots }] }]
  let parents = roots.filter(r => sel.has(r.cat_id))
  for (let i = 1; i < count && parents.length; i++) {
    const groups = parents.map(p => ({ parent: p, items: tree.children(p.cat_id) })).filter(g => g.items.length)
    if (!groups.length) break
    levels.push({ i, groups })
    parents = groups.flatMap(g => g.items.filter(it => sel.has(it.cat_id)))
  }
  return levels
}

// ── Page ──────────────────────────────────────────────────────────────────────
// Remount per record so the form never carries over from the last one opened.
export default function RfpEditorPage({ module }) {
  const { rfpId } = useParams()
  return <RfpEditor key={`${module}-${rfpId || "new"}`} module={module} rfpId={rfpId}/>
}

function RfpEditor({ module, rfpId }) {
  const mod = RFP_MODULES[module]
  const api = rfpApi(module)
  const isNew = !rfpId
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { i18n } = useTranslation()
  const lang = i18n.language
  const [params, setParams] = useSearchParams()
  const tab = !isNew && ["evaluation", "bond", "checklist"].includes(params.get("tab")) ? params.get("tab") : "details"
  const party = mod.expro ? "Government entity" : "Client"

  const { data: meta } = useQuery({ queryKey: ["rfp-lists", module], queryFn: () => api.lists().then(r => r.data) })
  const { data: team } = useQuery({ queryKey: ["rfp-team"], queryFn: () => api.teamOptions().then(r => r.data) })
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsApi.list().then(r => r.data) })
  const { data: scopeOptions = [] } = useQuery({ queryKey: ["rfp-scope", module], queryFn: () => api.scopeOptions().then(r => r.data), enabled: !!mod.scope })
  const { data: existing } = useQuery({ queryKey: ["rfp", module, rfpId], queryFn: () => api.get(rfpId).then(r => r.data), enabled: !isNew })

  const [form, setForm] = useState(EMPTY)
  const [stepIdx, setStepIdx] = useState(0)
  const [addingClient, setAddingClient] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!existing) return
    const f = { ...EMPTY }
    Object.keys(EMPTY).forEach(k => {
      if (existing[k] === null || existing[k] === undefined) return
      f[k] = NUMBERS.includes(k) ? Number(existing[k]) : existing[k]
    })
    f.scope_ids = existing.scope.map(s => s.cat_id)
    setForm(f)
  }, [existing])

  const lists = meta?.lists || {}
  const currency = meta?.currency
  const opts = key => (lists[key] || []).map(o => ({ value: o.value, label: lang === "ar" && o.label_ar ? o.label_ar : o.label }))
  const client = clients.find(c => c.client_id === Number(form.client_id))
  const isLost = LOST_STATUSES.includes(form.status)
  const isDropped = form.phase === "DROPPED" || ["DROPPED", "CANCELLED"].includes(form.status)
  const moneyStep = 1 / 10 ** (currency?.decimals ?? 2)
  const cur = currency?.code ? ` · ${currency.code}` : ""

  const tree = useMemo(() => buildTree(scopeOptions), [scopeOptions])
  const sel = useMemo(() => new Set(form.scope_ids), [form.scope_ids])
  const levels = mod.scope ? scopeLevels(tree, sel, mod.scope.levels.length) : []
  const scopePath = levels.map(l => l.groups.flatMap(g => g.items).filter(it => sel.has(it.cat_id)).map(it => it.cat_name)).filter(n => n.length)
  const toggleScope = id => {
    const next = new Set(sel)
    const drop = x => { next.delete(x); tree.children(x).forEach(c => drop(c.cat_id)) }
    if (next.has(id)) drop(id); else next.add(id)
    set("scope_ids", [...next])
  }
  const setLevel1 = id => set("scope_ids", id ? [Number(id)] : [])

  const daysLeft = form.submission_date
    ? Math.round((new Date(form.submission_date) - new Date(new Date().toDateString())) / 86400000) : null
  const tech = mod.telecom ? techLine(form, lists, lang) : ""
  const teamEmpty = team && !team.account_managers.length && !team.bid_managers.length && !team.presales.length

  // ── Steps: one per field (group), in the order given for the module ──
  const need = (cond, label) => (cond ? [] : [label])
  const moneyNeeded = !isDropped
  const clientStep = {
    id: "client", num: "1", title: "Client name & billing address", hint: mod.expro ? "The government entity that posted the request." : "Who the bid is for. Pick from the list, or add a new client once.",
    missing: () => need(form.client_id, party.toLowerCase()),
  }
  const steps = mod.expro ? [
    { id: "request", title: "EXPRO request", hint: "The request as posted on the EXPRO portal.",
      missing: () => [...need(has(form.rfp_ref), "EXPRO number"), ...need(form.request_date, "U.Date"),
        ...need(form.client_id, "government entity"), ...need(has(form.description), "comment")] },
    { id: "submission", title: "Submission date", hint: "The date the response is due.", missing: () => need(form.submission_date, "submission date") },
    { id: "bond", title: "Bid bond", hint: "Is a bid bond needed for this request?", missing: () => bondMissing() },
    { id: "technical", title: "Solution & technical details", hint: "What is being offered.", missing: () => technicalMissing() },
    { id: "team", title: "Team & comments", hint: "Who is working on this request.", missing: () => teamMissing() },
    { id: "value", title: "Pricing & status", hint: "Prices and where the request stands.", missing: () => valueMissing() },
  ] : [
    clientStep,
    { id: "submission", num: "2", title: "Submission date", hint: "The date the bid is due.", missing: () => need(form.submission_date, "submission date") },
    { id: "queries", num: "3", title: "Last date for queries", hint: "The last day the client accepts questions. It must be on or before the submission date.",
      missing: () => !form.queries_deadline ? ["last date for queries"]
        : form.submission_date && form.queries_deadline > form.submission_date ? ["a query date on or before the submission date"] : [] },
    { id: "bond", title: "Bid bond", hint: "Is a bid bond needed for this bid?", missing: () => bondMissing() },
    { id: "scope", num: "4", title: "Scope of work", hint: mod.scope.hint, missing: () => scopeMissing() },
    ...(mod.telecom ? [{ id: "technical", title: "Solution & technical details", hint: "What is being offered.", missing: () => technicalMissing() }] : []),
    { id: "info", title: "Bid information", hint: "From the bid log: title, reference, channel and type.",
      missing: () => [...need(has(form.rfp_title), "bid title"), ...need(form.channel, "channel"),
        ...need(form.project_type, "project type"), ...need(has(form.description), "project description")] },
    { id: "team", title: mod.telecom ? "Team & comments" : "Team", hint: "Who is working on this bid.", missing: () => teamMissing() },
    { id: "value", title: "Value & status", hint: "The value of the bid and where it stands.", missing: () => valueMissing() },
  ]
  function bondMissing() {
    if (form.bid_bond_required === null) return ["Yes or No"]
    return form.bid_bond_required && !form.bid_bond_pct ? ["bid bond percentage"] : []
  }
  function scopeMissing() {
    return levels.filter(l => !l.groups.some(g => g.items.some(it => sel.has(it.cat_id))))
      .map(l => `${mod.scope.levels[l.i].num} ${mod.scope.levels[l.i].name}`)
  }
  function technicalMissing() {
    return [...need(has(form.sow), "SOW"), ...need(form.media, "media"), ...need(form.sla, "SLA"),
      ...need(has(form.bandwidth_mbps), "bandwidth"), ...need(has(form.quantity), "quantity"), ...need(has(form.contract_duration), "contract")]
  }
  function teamMissing() {
    return [...need(form.am_id, "account manager"), ...need(form.presales_emp_id, "presales"), ...need(form.bm_id, "bid manager")]
  }
  function valueMissing() {
    const m = []
    if (moneyNeeded) {
      if (mod.telecom) m.push(...need(has(form.nrc), "NRC"), ...need(has(form.mrc), "MRC"))
      if (mod.bidLog) m.push(...need(form.project_size, "project size"), ...need(has(form.tcv), "TCV"))
    }
    if (isDropped) m.push(...need(form.reason, "reason for dropping"))
    if (mod.bidLog && isLost) m.push(...need(has(form.winner_name), "winner"))
    return m
  }

  const missingByStep = steps.map(s => s.missing())
  const complete = missingByStep.map(m => m.length === 0)
  const allComplete = complete.every(Boolean)
  const reachable = i => complete.slice(0, i).every(Boolean)
  const current = steps[Math.min(stepIdx, steps.length - 1)]
  const missing = missingByStep[stepIdx] || []
  const isLast = stepIdx === steps.length - 1

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {}
      Object.entries(form).forEach(([k, v]) => {
        payload[k] = v === "" ? null : NUMBERS.includes(k) && v !== null ? Number(v) : v
      })
      payload.client_id = Number(form.client_id)
      payload.bid_bond_required = !!form.bid_bond_required
      if (!form.bid_bond_required) payload.bid_bond_pct = null
      return isNew ? api.create(payload) : api.update(rfpId, payload)
    },
    onSuccess: r => {
      toast.success(`${r.data.rfp_number} ${isNew ? "created" : "saved"}`)
      qc.invalidateQueries({ queryKey: ["rfps", module] })
      qc.invalidateQueries({ queryKey: ["rfp", module] })
      navigate(mod.path)
    },
    onError: err => toast.error(apiErrorMessage(err, `Couldn't save the ${mod.noun}`)),
  })

  const heading = isNew ? (mod.expro ? "New EXPRO request" : "New Bid")
    : mod.expro && existing ? `EXPRO ${existing.rfp_ref}` : existing?.rfp_number || mod.noun

  // ── Step contents ──
  const clientPicker = addingClient ? (
    <NewClientForm noun={mod.expro ? "Entity" : "Client"} onCancel={() => setAddingClient(false)}
      onCreated={c => { set("client_id", c.client_id); setAddingClient(false) }}/>
  ) : (
    <Field label={mod.expro ? "Government entity" : "Client name"} required>
      <div className="flex gap-2">
        <select className="input" value={form.client_id} onChange={e => set("client_id", e.target.value)}>
          <option value="">{mod.expro ? "Choose the government entity…" : "Choose a client…"}</option>
          {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.name_en}{c.name_ar ? ` — ${c.name_ar}` : ""}</option>)}
        </select>
        <button className="btn-secondary whitespace-nowrap" onClick={() => setAddingClient(true)}><Plus size={13}/> New {mod.expro ? "entity" : "client"}</button>
      </div>
      {client && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3 p-4 rounded-xl bg-gray-50 border border-gray-100 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">English</div>
            <div className="font-semibold text-gray-900 flex items-center gap-1.5">
              {client.name_en}{client.is_strategic && <span className="badge-amber text-[10px] flex items-center gap-0.5"><Star size={10}/> Strategic</span>}
            </div>
            <div className="text-gray-500 text-xs mt-0.5 whitespace-pre-line">{client.billing_address_en || "No billing address"}</div>
          </div>
          <div dir="rtl">
            <div className="text-[11px] tracking-wider text-gray-400 mb-1">العربية</div>
            <div className="font-semibold text-gray-900">{client.name_ar || "—"}</div>
            <div className="text-gray-500 text-xs mt-0.5 whitespace-pre-line">{client.billing_address_ar || ""}</div>
          </div>
        </div>
      )}
    </Field>
  )

  const commentBox = (key, label) => (
    <textarea className="input mt-2" rows={2} value={form[key]} onChange={e => set(key, e.target.value)} placeholder={`${label} (optional)`} dir="auto"/>
  )

  const money = (key, label, hint) => (
    <Field label={`${label}${cur}`} required={moneyNeeded} hint={hint}>
      <input type="number" min="0" step={moneyStep} className="input tabular-nums" value={form[key]} onChange={e => set(key, e.target.value)} placeholder="0"/>
    </Field>
  )

  const body = {
    client: clientPicker,
    request: (
      <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="EXPRO number" required hint="The request number on the portal">
            <input className="input font-mono" value={form.rfp_ref} onChange={e => set("rfp_ref", e.target.value)} placeholder="e.g. 18435"/>
          </Field>
          <Field label="U.Date" required hint="Date the request was uploaded">
            <input type="date" className="input" value={form.request_date} onChange={e => set("request_date", e.target.value)}/>
          </Field>
        </div>
        {clientPicker}
        <Field label="Comment" required hint="The request text, as written by the entity">
          <textarea className="input" rows={3} dir="auto" value={form.description} onChange={e => set("description", e.target.value)}
            placeholder="e.g. تأسيس دائرة انترنت بسرعة 200 ميجا فايبر"/>
        </Field>
      </div>
    ),
    submission: (
      <Field label="Submission date" required
        hint={daysLeft === null ? null : daysLeft < 0 ? "This date has passed" : daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} from today`}>
        <input type="date" className="input max-w-xs" value={form.submission_date} onChange={e => set("submission_date", e.target.value)}/>
      </Field>
    ),
    queries: (
      <Field label="Last date for queries" required hint={form.submission_date ? `Submission date: ${fmt(form.submission_date)}` : null}>
        <input type="date" className="input max-w-xs" value={form.queries_deadline} max={form.submission_date || undefined}
          onChange={e => set("queries_deadline", e.target.value)}/>
      </Field>
    ),
    bond: (
      <div className="space-y-5">
        <Field label="Bid bond required?" required>
          <YesNo value={form.bid_bond_required} onChange={v => setForm(p => ({ ...p, bid_bond_required: v, bid_bond_pct: v ? p.bid_bond_pct : "" }))}/>
        </Field>
        {form.bid_bond_required && (
          <Field label="Bid bond percentage" required hint="The bid bond itself is requested in sub-module B · Bid bond, after this is saved.">
            <select className="input max-w-xs" value={form.bid_bond_pct} onChange={e => set("bid_bond_pct", e.target.value ? Number(e.target.value) : "")}>
              <option value="">Choose the percentage…</option>
              {(meta?.bid_bond_pcts || [1, 2, 3]).map(p => <option key={p} value={p}>{p}%</option>)}
            </select>
          </Field>
        )}
      </div>
    ),
    scope: mod.scope && (
      <div className="space-y-4">
        {levels.map(({ i, groups }) => {
          const L = mod.scope.levels[i]
          return (
            <div key={i} className={clsx(i > 0 && "pl-4 border-l-2 border-blue-100")}>
              <Field label={<><span className="text-blue-600">{L.num}</span> {L.name}</>} required
                hint={i === 0 ? L.hint : `${L.hint} · you can choose more than one`}>
                {i === 0 ? (
                  <select className="input" value={groups[0].items.find(it => sel.has(it.cat_id))?.cat_id || ""} onChange={e => setLevel1(e.target.value)}>
                    <option value="">Choose {L.name.toLowerCase()}…</option>
                    {groups[0].items.map(it => <option key={it.cat_id} value={it.cat_id}>{it.cat_name}</option>)}
                  </select>
                ) : (
                  <MultiSelect groups={groups} selected={sel} onToggle={toggleScope} placeholder={`Choose ${L.name.toLowerCase()}…`}/>
                )}
              </Field>
            </div>
          )
        })}
        {!scopeOptions.length && (
          <p className="text-sm text-gray-500">The list is empty. Add options in the{" "}
            <Link to={`${mod.path}?tab=scope`} className="text-blue-600 hover:underline">{mod.scope.tab.toLowerCase()}</Link>.</p>
        )}
        <p className="text-xs text-gray-400">
          Missing an option? An admin can add it in the{" "}
          <Link to={`${mod.path}?tab=scope`} className="text-blue-600 hover:underline">{mod.scope.tab.toLowerCase()}</Link>.
        </p>
      </div>
    ),
    technical: (
      <div className="space-y-5">
        <Field label={mod.expro ? "SOW" : "SOW / solution detail"} required>
          <textarea className="input" rows={2} value={form.sow} onChange={e => set("sow", e.target.value)}
            placeholder="e.g. BDI 1:1 Core Fiber + Static IP + DDoS Protection + Managed Router"/>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Media" required><Pills options={opts("media")} value={form.media} onChange={v => set("media", v)}/></Field>
          <Field label="SLA" required><Pills options={opts("sla")} value={form.sla} onChange={v => set("sla", v)}/></Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Bandwidth (BW)" required>
            <Unit unit="Mbps"><input type="number" min="0" className="input pr-14 tabular-nums" value={form.bandwidth_mbps} onChange={e => set("bandwidth_mbps", e.target.value)} placeholder="e.g. 200"/></Unit>
          </Field>
          <Field label="Quantity (QTY)" required>
            <input type="number" min="1" className="input tabular-nums" value={form.quantity} onChange={e => set("quantity", e.target.value)} placeholder="e.g. 1"/>
          </Field>
          <Field label="Contract" required>
            <input className="input" value={form.contract_duration} onChange={e => set("contract_duration", e.target.value)} placeholder="e.g. 12 Months, 3 Years"/>
          </Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Coverage study" optional>
            <input className="input" value={form.coverage_study} onChange={e => set("coverage_study", e.target.value)} placeholder="e.g. TLS, add on"/>
          </Field>
          <Field label="Location" optional className="sm:col-span-2" hint="A Google Maps link or the address">
            <div className="flex gap-2">
              <input className="input" value={form.location} onChange={e => set("location", e.target.value)} placeholder="https://maps.app.goo.gl/…"/>
              {isLink(form.location) && <a href={form.location.trim()} target="_blank" rel="noreferrer" className="btn-secondary" title="Open map"><ExternalLink size={13}/></a>}
            </div>
          </Field>
        </div>
        <Field label="Attachments" optional hint="Link to the documents, e.g. the SharePoint folder">
          <div className="flex gap-2">
            <input className="input" value={form.attachment_url} onChange={e => set("attachment_url", e.target.value)} placeholder="https://…sharepoint.com/…"/>
            {isLink(form.attachment_url) && <a href={form.attachment_url.trim()} target="_blank" rel="noreferrer" className="btn-secondary" title="Open folder"><ExternalLink size={13}/></a>}
          </div>
        </Field>
      </div>
    ),
    info: (
      <div className="space-y-5">
        <Field label="Bid title" required hint="Also used as the bid subject on the bid bond">
          <input className="input" value={form.rfp_title} onChange={e => set("rfp_title", e.target.value)}
            placeholder={mod.telecom ? "e.g. Branch connectivity for 20 sites" : "e.g. Hospital campus network refresh"}/>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Bid reference" optional hint="The client's own reference, if they gave one">
            <input className="input font-mono" value={form.rfp_ref} onChange={e => set("rfp_ref", e.target.value)} placeholder="e.g. SPC-26-0045"/>
          </Field>
          <Field label="Channel" required hint="How the bid reached us">
            <Select value={form.channel} onChange={v => set("channel", v)} options={opts("channel")} placeholder="Choose…"/>
          </Field>
        </div>
        <Field label="Project type" required>
          <Pills options={opts("project_type")} value={form.project_type} onChange={v => set("project_type", v)}/>
        </Field>
        <Field label="Project description" required>
          <textarea className="input" rows={3} value={form.description} onChange={e => set("description", e.target.value)}
            placeholder="What the client is asking for, in a sentence or two"/>
        </Field>
      </div>
    ),
    team: (
      <div className="space-y-4">
        {teamEmpty && (
          <div className="alert-info text-xs">
            No team members are set up yet. Add account managers and bid specialists in{" "}
            <Link to="/company-settings" className="underline">Company Settings</Link>, and presales staff in{" "}
            <Link to="/employees" className="underline">Employees</Link>.
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Account manager" required>
            <Select value={form.am_id} onChange={v => set("am_id", v)} placeholder="Choose…"
              options={(team?.account_managers || []).map(m => ({ value: m.id, label: m.name }))}/>
            {mod.telecom && commentBox("am_comment", "AM comment")}
          </Field>
          <Field label="Presales" required>
            <Select value={form.presales_emp_id} onChange={v => set("presales_emp_id", v)} placeholder="Choose…"
              options={(team?.presales || []).map(m => ({ value: m.id, label: m.name }))}/>
            {mod.telecom && commentBox("presales_comment", "Presales comments")}
          </Field>
          <Field label="Bid manager" required>
            <Select value={form.bm_id} onChange={v => set("bm_id", v)} placeholder="Choose…"
              options={(team?.bid_managers || []).map(m => ({ value: m.id, label: m.name }))}/>
            {mod.telecom && commentBox("bid_comment", "Bid comment")}
          </Field>
        </div>
      </div>
    ),
    value: (
      <div className="space-y-5">
        <Field label="Phase" required>
          <Pills options={opts("phase")} value={form.phase} onChange={v => set("phase", v)}/>
        </Field>
        <Field label="Status" required>
          <Pills options={opts("status")} value={form.status} onChange={v => set("status", v)}/>
        </Field>
        {isDropped && (
          <Field label="Reason for dropping" required>
            <Select value={form.reason} onChange={v => set("reason", v)} options={opts("reason")} placeholder="Choose a reason…"/>
          </Field>
        )}
        {mod.telecom && (
          <div className="grid sm:grid-cols-2 gap-4">
            {money("nrc", "NRC", "One-time charge")}
            {money("mrc", "MRC", "Monthly charge")}
          </div>
        )}
        {mod.bidLog && (
          <div className="grid sm:grid-cols-2 gap-4">
            {money("tcv", "TCV", "Total contract value")}
            <Field label="Project size" required={moneyNeeded}>
              <Pills options={opts("project_size")} value={form.project_size} onChange={v => set("project_size", v)}/>
            </Field>
          </div>
        )}
        {isDropped && <p className="text-xs text-gray-400">Prices and size aren't needed for a dropped {mod.noun}.</p>}
        {mod.bidLog && isLost && (
          <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl bg-red-50/60 border border-red-100">
            <Field label="Winner" required>
              <input className="input" value={form.winner_name} onChange={e => set("winner_name", e.target.value)} placeholder="Who won the bid"/>
            </Field>
            <Field label={`Winner's TCV${cur}`} optional>
              <input type="number" min="0" className="input tabular-nums" value={form.winner_tcv} onChange={e => set("winner_tcv", e.target.value)}/>
            </Field>
          </div>
        )}
      </div>
    ),
  }

  const goNext = () => { if (!missing.length) setStepIdx(i => Math.min(i + 1, steps.length - 1)) }

  return (
    <div>
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex flex-wrap items-center gap-4">
          <Link to={mod.path} className="btn-ghost btn-sm"><ArrowLeft size={14}/> {mod.title}</Link>
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[11px] font-bold text-blue-700 bg-blue-50 rounded-md px-2 py-0.5 whitespace-nowrap">Module {mod.num}</span>
            <h1 className="text-lg font-bold text-gray-900 truncate">{heading}</h1>
            {!isNew && existing && mod.expro && <span className="font-mono text-xs text-gray-400">{existing.rfp_number}</span>}
            {!isNew && existing && (
              <span className={clsx("badge text-xs", STATUS_STYLE[form.status] || "badge-gray")}>{optionLabel(lists.status, form.status, lang)}</span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto bg-gray-100 rounded-xl p-1">
            {[["details", `${mod.expro ? "Request" : "Bid"} details`], ["evaluation", "A · Evaluation"], ["bond", "B · Bid bond"], ["checklist", "C · Checklist"]].map(([id, lbl]) => (
              <button key={id} disabled={isNew && id !== "details"} title={isNew && id !== "details" ? `Create the ${mod.noun} first` : undefined}
                onClick={() => setParams(id === "details" ? {} : { tab: id })}
                className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed",
                  tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900")}>
                {lbl}
              </button>
            ))}
          </div>
          {tab === "details" && !isNew && (
            <button className="btn-primary whitespace-nowrap" disabled={!allComplete || addingClient || saveMut.isPending}
              title={allComplete ? undefined : "Complete every step first"} onClick={() => saveMut.mutate()}>
              <Check size={14}/> {saveMut.isPending ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      </div>

      {tab === "evaluation" ? (
        <div className="max-w-screen-xl mx-auto p-6"><RfpEvaluation module={module} rfpId={rfpId}/></div>
      ) : tab === "checklist" ? (
        <div className="max-w-screen-xl mx-auto p-6"><RfpChecklist module={module} rfpId={rfpId}/></div>
      ) : tab === "bond" ? (
        <div className="max-w-screen-xl mx-auto p-6"><RfpBidBond module={module} rfpId={rfpId} onGoToDetails={() => setParams({})}/></div>
      ) : (

      <div className="max-w-screen-xl mx-auto p-6 grid lg:grid-cols-[230px_minmax(0,1fr)_270px] gap-6 items-start">
        {/* Steps */}
        <nav className="card p-3 lg:sticky lg:top-20">
          <div className="px-2 pb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Steps</span>
            <span className="text-[11px] text-gray-400">{complete.filter(Boolean).length} of {steps.length} done</span>
          </div>
          <div className="h-1 rounded-full bg-gray-100 mx-2 mb-2 overflow-hidden">
            <div className="h-full bg-green-500 transition-all" style={{ width: `${100 * complete.filter(Boolean).length / steps.length}%` }}/>
          </div>
          <ol className="space-y-0.5">
            {steps.map((s, i) => {
              const open = reachable(i)
              return (
                <li key={s.id}>
                  <button disabled={!open} onClick={() => setStepIdx(i)}
                    className={clsx("w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left transition-colors",
                      i === stepIdx ? "bg-blue-50 text-blue-800 font-semibold" : open ? "text-gray-700 hover:bg-gray-50" : "text-gray-400 cursor-not-allowed")}>
                    <span className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0",
                      complete[i] ? "bg-green-500 text-white" : i === stepIdx ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500")}>
                      {complete[i] ? <Check size={12}/> : !open ? <Lock size={10}/> : i + 1}
                    </span>
                    <span className="truncate">{s.title}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        {/* Current step */}
        <section className="card p-0 min-w-0">
          <div className="px-6 pt-5 pb-4 border-b border-gray-100">
            <div className="text-xs font-semibold text-blue-600">
              Step {stepIdx + 1} of {steps.length}{current.num ? ` · Field ${current.num}` : ""}
            </div>
            <h2 className="text-xl font-bold text-gray-900 mt-0.5">{current.title}</h2>
            {current.hint && <p className="text-sm text-gray-500 mt-1">{current.hint}</p>}
          </div>
          <div className="px-6 py-6">{body[current.id]}</div>
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl flex items-center gap-3">
            {stepIdx > 0
              ? <button className="btn-secondary" onClick={() => setStepIdx(i => i - 1)}><ArrowLeft size={14}/> Back</button>
              : <button className="btn-ghost" onClick={() => navigate(mod.path)}>Cancel</button>}
            <div className="ml-auto flex items-center gap-3 min-w-0">
              {missing.length > 0 && <span className="text-xs text-amber-700 truncate">To continue, fill in: {missing.join(", ")}</span>}
              {isLast ? (
                <button className="btn-primary whitespace-nowrap" disabled={!allComplete || addingClient || saveMut.isPending} onClick={() => saveMut.mutate()}>
                  <Check size={14}/> {saveMut.isPending ? "Saving…" : isNew ? `Create ${mod.expro ? "request" : "bid"}` : "Save changes"}
                </button>
              ) : (
                <button className="btn-primary whitespace-nowrap" disabled={missing.length > 0 || addingClient} onClick={goNext}>
                  Next <ArrowRight size={14}/>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Summary */}
        <aside className="card p-4 space-y-3 text-sm lg:sticky lg:top-20">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Summary</div>
          {mod.expro && (
            <div><div className="text-xs text-gray-400">EXPRO number</div><div className="font-semibold text-gray-900 font-mono">{form.rfp_ref || "—"}</div></div>
          )}
          <div>
            <div className="text-xs text-gray-400">{party}</div>
            <div className="font-medium text-gray-900">{client?.name_en || "—"}</div>
            {client?.name_ar && <div className="text-xs text-gray-500" dir="rtl">{client.name_ar}</div>}
          </div>
          <div>
            <div className="text-xs text-gray-400">Submission</div>
            <div className="font-medium text-gray-900">{form.submission_date ? fmt(form.submission_date) : "—"}</div>
            {daysLeft !== null && daysLeft >= 0 && (
              <div className={clsx("text-xs font-semibold", daysLeft <= 7 ? "text-red-600" : "text-gray-500")}>
                {daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
              </div>
            )}
            {form.queries_deadline && <div className="text-xs text-gray-500">Queries by {fmt(form.queries_deadline)}</div>}
          </div>
          <div className="flex items-center gap-1.5">
            <Shield size={13} className="text-gray-400"/>
            <span className="text-gray-700">{form.bid_bond_required === null ? "Bid bond: —" : form.bid_bond_required ? `Bid bond ${form.bid_bond_pct ? `${form.bid_bond_pct}%` : "(choose %)"}` : "No bid bond"}</span>
          </div>
          {mod.scope && (
            <div>
              <div className="text-xs text-gray-400 mb-1">Scope of work</div>
              {scopePath.length ? (
                <div className="space-y-1">
                  {scopePath.map((names, i) => (
                    <div key={i} className="flex gap-1.5 text-xs">
                      <span className="text-blue-600 font-semibold w-7 flex-shrink-0">{mod.scope.levels[i].num}</span>
                      <span className="text-gray-700">{names.join(", ")}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-gray-400">—</div>}
            </div>
          )}
          {mod.telecom && (
            <div>
              <div className="text-xs text-gray-400">Technical</div>
              <div className="text-gray-700">{tech || "—"}</div>
              {form.contract_duration && <div className="text-xs text-gray-500">Contract {form.contract_duration}</div>}
            </div>
          )}
          {mod.telecom && (
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs text-gray-400">NRC</div><div className="font-semibold text-gray-900 tabular-nums">{formatMoney(has(form.nrc) ? form.nrc : null, currency)}</div></div>
              <div><div className="text-xs text-gray-400">MRC</div><div className="font-semibold text-gray-900 tabular-nums">{formatMoney(has(form.mrc) ? form.mrc : null, currency)}</div></div>
            </div>
          )}
          {mod.bidLog && (
            <div><div className="text-xs text-gray-400">TCV</div><div className="font-semibold text-gray-900 tabular-nums">{formatMoney(has(form.tcv) ? form.tcv : null, currency)}</div></div>
          )}
        </aside>
      </div>
      )}
    </div>
  )
}
