import React, { useState, useEffect, useMemo } from "react"
import { useNavigate, useParams, Link, useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import toast from "react-hot-toast"
import clsx from "clsx"
import {
  ArrowLeft, Check, Plus, Languages, Loader2, Star, Shield, ChevronRight, Circle, CheckCircle2, ExternalLink,
} from "lucide-react"
import { clientsApi, rfpApi } from "../services/api"
import { apiErrorMessage } from "../utils/apiError"
import { fmt } from "../utils/fmt"
import { RFP_MODULES, buildTree, STATUS_STYLE, LOST_STATUSES, optionLabel, formatMoney, techLine } from "../utils/rfp"
import RfpEvaluation from "../components/rfp/RfpEvaluation"
import RfpBidBond from "../components/rfp/RfpBidBond"

const EMPTY = {
  client_id: "", rfp_title: "", rfp_ref: "", channel: "", project_type: "", description: "",
  submission_date: "", queries_deadline: "", request_date: "", bid_bond_required: false, bid_bond_pct: "",
  scope_ids: [], sow: "", media: "", sla: "", bandwidth_mbps: "", quantity: "", contract_duration: "",
  coverage_study: "", location: "", attachment_url: "",
  am_id: "", presales_emp_id: "", bm_id: "", am_comment: "", presales_comment: "", bid_comment: "",
  project_size: "", tcv: "", nrc: "", mrc: "", phase: "ON_GOING", status: "PENDING", reason: "", winner_name: "", winner_tcv: "",
}
const NUMBERS = ["bid_bond_pct", "bandwidth_mbps", "quantity", "am_id", "presales_emp_id", "bm_id", "tcv", "nrc", "mrc", "winner_tcv"]

function sectionsFor(mod) {
  return [
    { id: "client", title: mod.expro ? "EXPRO request" : "Client & RFP" },
    { id: "dates", title: "Dates & bid bond" },
    ...(mod.scope ? [{ id: "scope", title: mod.telecom ? "Family & solution" : "Scope of work" }] : []),
    ...(mod.telecom ? [{ id: "technical", title: "Solution & technical details" }] : []),
    { id: "team", title: mod.telecom ? "Team & comments" : "Team" },
    { id: "value", title: mod.expro ? "Pricing & status" : "Value & status" },
  ]
}

// ── Small building blocks ─────────────────────────────────────────────────────
function Section({ id, num, title, hint, children }) {
  return (
    <section id={id} className="card scroll-mt-24 space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          {num && <span className="text-xs font-bold text-blue-600 bg-blue-50 rounded-md px-1.5 py-0.5">{num}</span>}
          {title}
        </h2>
        {hint && <p className="text-sm text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, num, required, hint, children, className }) {
  return (
    <div className={className}>
      <label className="label flex items-center gap-1.5">
        {num && <span className="text-blue-600">{num}</span>}{label}{required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  )
}

function Pills({ options, value, onChange, allowClear }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button type="button" key={o.value}
          onClick={() => onChange(allowClear && value === o.value ? "" : o.value)}
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
        <Field label={`${label} (English)`} required={kEn === "name_en"}>
          <Input className="input" rows={multiline ? 2 : undefined} value={f[kEn]} onChange={e => set(kEn, e.target.value)}
            onBlur={() => tr.run(f[kEn], f[kAr], auto[autoKey], v => { set(kAr, v); setAuto(a => ({ ...a, [autoKey]: true })) })}/>
        </Field>
        <Field label={<span className="flex items-center gap-1.5">{label} (Arabic){tr.busy && <Loader2 size={11} className="animate-spin text-blue-500"/>}</span>}>
          <Input className="input" dir="rtl" rows={multiline ? 2 : undefined} value={f[kAr]}
            placeholder={tr.busy ? "Translating…" : "Filled in automatically"}
            onChange={e => { set(kAr, e.target.value); setAuto(a => ({ ...a, [autoKey]: false })) }}/>
          {tr.error && <p className="text-xs text-amber-600 mt-1">{tr.error}</p>}
        </Field>
      </div>
    )
  }
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
        <button className="btn-primary btn-sm" disabled={!f.name_en.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>
          <Check size={12}/> {saveMut.isPending ? "Saving…" : `Save ${noun.toLowerCase()}`}
        </button>
        <button className="btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Scope of work: the module's named levels ──────────────────────────────────
function ScopePicker({ mod, options, selected, onChange }) {
  const levelsDef = mod.scope.levels
  const tree = useMemo(() => buildTree(options), [options])
  const sel = new Set(selected)
  const roots = tree.children(null)
  const level1 = roots.find(r => sel.has(r.cat_id))
  const descendants = id => tree.children(id).flatMap(c => [c.cat_id, ...descendants(c.cat_id)])
  const toggle = id => {
    const next = new Set(sel)
    if (next.has(id)) { next.delete(id); descendants(id).forEach(d => next.delete(d)) } else next.add(id)
    onChange([...next])
  }

  const levels = []
  let parents = level1 ? [level1] : []
  for (let i = 1; i < levelsDef.length && parents.length; i++) {
    const groups = parents.map(p => ({ parent: p, items: tree.children(p.cat_id) })).filter(g => g.items.length)
    if (!groups.length) { levels.push({ i, groups: [], emptyUnder: parents }); break }
    levels.push({ i, groups })
    parents = groups.flatMap(g => g.items.filter(it => sel.has(it.cat_id)))
  }

  return (
    <div className="space-y-5">
      <Field num={levelsDef[0].num} label={levelsDef[0].name} hint={levelsDef[0].hint}>
        <Pills options={roots.map(r => ({ value: r.cat_id, label: r.cat_name }))} value={level1?.cat_id}
          onChange={v => onChange(v ? [v] : [])} allowClear/>
      </Field>
      {levels.map(({ i, groups, emptyUnder }) => (
        <div key={i} className="pl-4 border-l-2 border-blue-100">
          <Field num={levelsDef[i].num} label={levelsDef[i].name}
            hint={emptyUnder ? null : `${levelsDef[i].hint} · choose one or more`}>
            {emptyUnder ? (
              <p className="text-sm text-gray-400">
                Nothing listed under {emptyUnder.map(p => p.cat_name).join(", ")} yet. Add options in the
                {" "}<Link to={`${mod.path}?tab=scope`} className="text-blue-600 hover:underline">{mod.scope.tab.toLowerCase()}</Link>.
              </p>
            ) : (
              <div className="space-y-2.5">
                {groups.map(({ parent, items }) => (
                  <div key={parent.cat_id}>
                    {groups.length > 1 && <div className="text-xs font-medium text-gray-400 mb-1.5">Under {parent.cat_name}</div>}
                    <div className="flex flex-wrap gap-2">
                      {items.map(it => (
                        <button type="button" key={it.cat_id} onClick={() => toggle(it.cat_id)}
                          className={clsx("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                            sel.has(it.cat_id) ? "bg-blue-50 border-blue-300 text-blue-700 font-medium" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                          {sel.has(it.cat_id) ? <Check size={13}/> : <Plus size={13} className="text-gray-300"/>}
                          {it.cat_name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </div>
      ))}
    </div>
  )
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
  const tab = !isNew && ["evaluation", "bond"].includes(params.get("tab")) ? params.get("tab") : "details"
  const party = mod.expro ? "Government entity" : "Client"

  const { data: meta } = useQuery({ queryKey: ["rfp-lists", module], queryFn: () => api.lists().then(r => r.data) })
  const { data: team } = useQuery({ queryKey: ["rfp-team"], queryFn: () => api.teamOptions().then(r => r.data) })
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsApi.list().then(r => r.data) })
  const { data: scopeOptions = [] } = useQuery({ queryKey: ["rfp-scope", module], queryFn: () => api.scopeOptions().then(r => r.data), enabled: !!mod.scope })
  const { data: existing } = useQuery({ queryKey: ["rfp", module, rfpId], queryFn: () => api.get(rfpId).then(r => r.data), enabled: !isNew })

  const [form, setForm] = useState(EMPTY)
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
  const sections = sectionsFor(mod)
  const step = 1 / 10 ** (currency?.decimals ?? 2)
  const cur = currency?.code ? ` · ${currency.code}` : ""

  const tree = useMemo(() => buildTree(scopeOptions), [scopeOptions])
  const scopePath = useMemo(() => {
    const sel = new Set(form.scope_ids)
    const path = []
    let level = tree.children(null).filter(o => sel.has(o.cat_id))
    while (level.length) {
      path.push(level.map(o => o.cat_name))
      level = level.flatMap(o => tree.children(o.cat_id).filter(c => sel.has(c.cat_id)))
    }
    return path
  }, [form.scope_ids, tree])

  const daysLeft = form.submission_date
    ? Math.round((new Date(form.submission_date) - new Date(new Date().toDateString())) / 86400000) : null
  const tech = mod.telecom ? techLine(form, lists, lang) : ""

  const done = {
    client: !!form.client_id && (!mod.expro || !!form.rfp_ref.trim()),
    dates: !!form.submission_date && (!form.bid_bond_required || !!form.bid_bond_pct),
    scope: form.scope_ids.length > 0,
    technical: !!(form.sow || form.media || form.bandwidth_mbps !== ""),
    team: !!(form.am_id || form.presales_emp_id || form.bm_id),
    value: mod.expro ? form.nrc !== "" || form.mrc !== ""
      : !!(form.tcv !== "" || form.project_size || (mod.telecom && (form.nrc !== "" || form.mrc !== ""))),
  }
  const missing = [!form.client_id && party.toLowerCase(), mod.expro && !form.rfp_ref.trim() && "EXPRO number",
    !form.submission_date && "submission date", form.bid_bond_required && !form.bid_bond_pct && "bid bond percentage"].filter(Boolean)

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {}
      Object.entries(form).forEach(([k, v]) => {
        payload[k] = v === "" ? null : NUMBERS.includes(k) && v !== null ? Number(v) : v
      })
      payload.client_id = Number(form.client_id)
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

  const goTo = id => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  const teamEmpty = team && !team.account_managers.length && !team.bid_managers.length && !team.presales.length
  const heading = isNew ? (mod.expro ? "New EXPRO request" : `New ${mod.title} RFP`)
    : mod.expro && existing ? `EXPRO ${existing.rfp_ref}` : existing?.rfp_number || mod.noun

  const clientPicker = addingClient ? (
    <NewClientForm noun={mod.expro ? "Entity" : "Client"} onCancel={() => setAddingClient(false)}
      onCreated={c => { set("client_id", c.client_id); setAddingClient(false) }}/>
  ) : (
    <Field label={party} required>
      <div className="flex gap-2">
        <select className="input" value={form.client_id} onChange={e => set("client_id", e.target.value)}>
          <option value="">{mod.expro ? "Choose the government entity…" : "Choose a client…"}</option>
          {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.name_en}{c.name_ar ? ` — ${c.name_ar}` : ""}</option>)}
        </select>
        <button className="btn-secondary whitespace-nowrap" onClick={() => setAddingClient(true)}><Plus size={13}/> New {mod.expro ? "entity" : "client"}</button>
      </div>
      {client && (
        <div className="mt-2 grid sm:grid-cols-2 gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm">
          <div>
            <div className="font-semibold text-gray-900 flex items-center gap-1.5">
              {client.name_en}{client.is_strategic && <span className="badge-amber text-[10px] flex items-center gap-0.5"><Star size={10}/> Strategic</span>}
            </div>
            <div className="text-gray-500 text-xs mt-0.5 whitespace-pre-line">{client.billing_address_en || "No billing address"}</div>
          </div>
          <div dir="rtl">
            <div className="font-semibold text-gray-900">{client.name_ar || "—"}</div>
            <div className="text-gray-500 text-xs mt-0.5 whitespace-pre-line">{client.billing_address_ar || ""}</div>
          </div>
        </div>
      )}
    </Field>
  )

  const comment = (key, label) => (
    <textarea className="input mt-2" rows={2} value={form[key]} onChange={e => set(key, e.target.value)} placeholder={label} dir="auto"/>
  )

  return (
    <div>
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-4">
          <Link to={mod.path} className="btn-ghost btn-sm"><ArrowLeft size={14}/> {mod.title}</Link>
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900 truncate">{heading}</h1>
            {!isNew && existing && mod.expro && <span className="font-mono text-xs text-gray-400">{existing.rfp_number}</span>}
            {!isNew && existing && (
              <span className={clsx("badge text-xs", STATUS_STYLE[form.status] || "badge-gray")}>{optionLabel(lists.status, form.status, lang)}</span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-4 bg-gray-100 rounded-xl p-1">
            {[["details", `1 · ${mod.expro ? "Request" : "RFP"} details`], ["evaluation", "2 · Evaluation"], ["bond", "3 · Bid bond"]].map(([id, lbl]) => (
              <button key={id} disabled={isNew && id !== "details"} title={isNew && id !== "details" ? `Create the ${mod.noun} first` : undefined}
                onClick={() => setParams(id === "details" ? {} : { tab: id })}
                className={clsx("px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed",
                  tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900")}>
                {lbl}
              </button>
            ))}
          </div>
          {tab === "details" && <div className="ml-auto flex items-center gap-3">
            {missing.length > 0 && <span className="hidden md:block text-xs text-gray-400">Still needed: {missing.join(", ")}</span>}
            <button className="btn-secondary" onClick={() => navigate(mod.path)}>Cancel</button>
            <button className="btn-primary whitespace-nowrap" disabled={missing.length > 0 || addingClient || saveMut.isPending} onClick={() => saveMut.mutate()}>
              <Check size={14}/> {saveMut.isPending ? "Saving…" : isNew ? `Create ${mod.expro ? "request" : "RFP"}` : "Save changes"}
            </button>
          </div>}
        </div>
      </div>

      {tab === "evaluation" ? (
        <div className="max-w-screen-xl mx-auto p-6"><RfpEvaluation module={module} rfpId={rfpId}/></div>
      ) : tab === "bond" ? (
        <div className="max-w-screen-xl mx-auto p-6"><RfpBidBond module={module} rfpId={rfpId} onGoToDetails={() => setParams({})}/></div>
      ) : (

      <div className="max-w-screen-xl mx-auto p-6 grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
        <div className="space-y-5 min-w-0">
          {/* Client & RFP / EXPRO request */}
          {mod.expro ? (
            <Section id="client" title="EXPRO request" hint="The request as posted on the EXPRO portal.">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="EXPRO number" required hint="The request number on the portal">
                  <input className="input font-mono" value={form.rfp_ref} onChange={e => set("rfp_ref", e.target.value)} placeholder="e.g. 18435"/>
                </Field>
                <Field label="U.Date" hint="Date the request was uploaded">
                  <input type="date" className="input" value={form.request_date} onChange={e => set("request_date", e.target.value)}/>
                </Field>
              </div>
              {clientPicker}
              <Field label="Comment" hint="The request text, as written by the entity">
                <textarea className="input" rows={3} dir="auto" value={form.description} onChange={e => set("description", e.target.value)}
                  placeholder="e.g. تأسيس دائرة انترنت بسرعة 200 ميجا فايبر"/>
              </Field>
            </Section>
          ) : (
            <Section id="client" num="1" title="Client & RFP" hint="Who the RFP is from and how it reached us.">
              {clientPicker}
              <Field label="RFP title" hint="Used as the bid subject on the bid bond">
                <input className="input" value={form.rfp_title} onChange={e => set("rfp_title", e.target.value)}
                  placeholder={mod.telecom ? "e.g. Branch connectivity for 20 sites" : "e.g. Hospital campus network refresh"}/>
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="RFP reference" hint="The client's own reference, if any">
                  <input className="input font-mono" value={form.rfp_ref} onChange={e => set("rfp_ref", e.target.value)} placeholder="e.g. SPC-26-0045"/>
                </Field>
                <Field label="Channel" hint="How the RFP reached us">
                  <Select value={form.channel} onChange={v => set("channel", v)} options={opts("channel")} placeholder="Choose…"/>
                </Field>
              </div>
              <Field label="Project type">
                <Pills options={opts("project_type")} value={form.project_type} onChange={v => set("project_type", v)} allowClear/>
              </Field>
              <Field label="Project description">
                <textarea className="input" rows={3} value={form.description} onChange={e => set("description", e.target.value)}
                  placeholder="What the client is asking for, in a sentence or two"/>
              </Field>
            </Section>
          )}

          {/* Dates & bid bond */}
          <Section id="dates" num={mod.bidLog ? "2–3" : null} title="Dates & bid bond">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field num={mod.bidLog ? "2" : null} label="Submission date" required
                hint={daysLeft === null ? null : daysLeft < 0 ? "This date has passed" : daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} from today`}>
                <input type="date" className="input" value={form.submission_date} onChange={e => set("submission_date", e.target.value)}/>
              </Field>
              {mod.bidLog && (
                <Field num="3" label="Last date for queries" hint="Must be on or before the submission date">
                  <input type="date" className="input" value={form.queries_deadline} max={form.submission_date || undefined}
                    onChange={e => set("queries_deadline", e.target.value)}/>
                </Field>
              )}
            </div>
            <Field label="Bid bond required?">
              <div className="flex flex-wrap items-center gap-3">
                <Pills options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                  value={form.bid_bond_required ? "yes" : "no"}
                  onChange={v => setForm(p => ({ ...p, bid_bond_required: v === "yes", bid_bond_pct: v === "yes" ? p.bid_bond_pct : "" }))}/>
                {form.bid_bond_required && (
                  <>
                    <ChevronRight size={16} className="text-gray-300"/>
                    <Pills options={(meta?.bid_bond_pcts || [1, 2, 3]).map(p => ({ value: p, label: `${p}%` }))}
                      value={form.bid_bond_pct} onChange={v => set("bid_bond_pct", v)}/>
                  </>
                )}
              </div>
              {form.bid_bond_required && !form.bid_bond_pct && <p className="text-xs text-red-500 mt-1">Choose the bid bond percentage.</p>}
            </Field>
          </Section>

          {/* Scope of work */}
          {mod.scope && (
            <Section id="scope" num="4" title={mod.telecom ? "Scope of work · family & solution" : "Scope of work"} hint={mod.scope.hint}>
              <ScopePicker mod={mod} options={scopeOptions} selected={form.scope_ids} onChange={ids => set("scope_ids", ids)}/>
            </Section>
          )}

          {/* Solution & technical details */}
          {mod.telecom && (
            <Section id="technical" title="Solution & technical details">
              <Field label={mod.expro ? "SOW" : "SOW / solution detail"}>
                <textarea className="input" rows={2} value={form.sow} onChange={e => set("sow", e.target.value)}
                  placeholder="e.g. BDI 1:1 Core Fiber + Static IP + DDoS Protection + Managed Router"/>
              </Field>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Media">
                  <Pills options={opts("media")} value={form.media} onChange={v => set("media", v)} allowClear/>
                </Field>
                <Field label="SLA">
                  <Pills options={opts("sla")} value={form.sla} onChange={v => set("sla", v)} allowClear/>
                </Field>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Bandwidth (BW)">
                  <Unit unit="Mbps">
                    <input type="number" min="0" className="input pr-14 tabular-nums" value={form.bandwidth_mbps} onChange={e => set("bandwidth_mbps", e.target.value)} placeholder="e.g. 200"/>
                  </Unit>
                </Field>
                <Field label="Quantity (QTY)">
                  <input type="number" min="1" className="input tabular-nums" value={form.quantity} onChange={e => set("quantity", e.target.value)} placeholder="e.g. 1"/>
                </Field>
                <Field label="Contract">
                  <input className="input" value={form.contract_duration} onChange={e => set("contract_duration", e.target.value)} placeholder="e.g. 12 Months, 3 Years"/>
                </Field>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Field label="Coverage study">
                  <input className="input" value={form.coverage_study} onChange={e => set("coverage_study", e.target.value)} placeholder="e.g. TLS, add on"/>
                </Field>
                <Field label="Location" className="sm:col-span-2" hint="A Google Maps link or the address">
                  <div className="flex gap-2">
                    <input className="input" value={form.location} onChange={e => set("location", e.target.value)} placeholder="https://maps.app.goo.gl/…"/>
                    {isLink(form.location) && <a href={form.location.trim()} target="_blank" rel="noreferrer" className="btn-secondary" title="Open map"><ExternalLink size={13}/></a>}
                  </div>
                </Field>
              </div>
              <Field label="Attachments" hint="Link to the request's documents, e.g. the SharePoint folder">
                <div className="flex gap-2">
                  <input className="input" value={form.attachment_url} onChange={e => set("attachment_url", e.target.value)} placeholder="https://…sharepoint.com/…"/>
                  {isLink(form.attachment_url) && <a href={form.attachment_url.trim()} target="_blank" rel="noreferrer" className="btn-secondary" title="Open folder"><ExternalLink size={13}/></a>}
                </div>
              </Field>
            </Section>
          )}

          {/* Team */}
          <Section id="team" title={mod.telecom ? "Team & comments" : "Team"} hint={`Who is working on this ${mod.noun}.`}>
            {teamEmpty && (
              <div className="alert-info text-xs">
                No team members are set up yet. Add account managers and bid specialists in{" "}
                <Link to="/company-settings" className="underline">Company Settings</Link>, and presales staff in{" "}
                <Link to="/employees" className="underline">Employees</Link>.
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Account manager">
                <Select value={form.am_id} onChange={v => set("am_id", v)} placeholder="Choose…"
                  options={(team?.account_managers || []).map(m => ({ value: m.id, label: m.name }))}/>
                {mod.telecom && comment("am_comment", "AM comment")}
              </Field>
              <Field label="Presales">
                <Select value={form.presales_emp_id} onChange={v => set("presales_emp_id", v)} placeholder="Choose…"
                  options={(team?.presales || []).map(m => ({ value: m.id, label: m.name }))}/>
                {mod.telecom && comment("presales_comment", "Presales comments")}
              </Field>
              <Field label="Bid manager">
                <Select value={form.bm_id} onChange={v => set("bm_id", v)} placeholder="Choose…"
                  options={(team?.bid_managers || []).map(m => ({ value: m.id, label: m.name }))}/>
                {mod.telecom && comment("bid_comment", "Bid comment")}
              </Field>
            </div>
          </Section>

          {/* Value / pricing & status */}
          <Section id="value" title={mod.expro ? "Pricing & status" : "Value & status"}>
            {mod.telecom && (
              <div className={clsx("grid gap-4", mod.bidLog ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                <Field label={`NRC${cur}`} hint="One-time charge">
                  <input type="number" min="0" step={step} className="input tabular-nums" value={form.nrc} onChange={e => set("nrc", e.target.value)} placeholder="0"/>
                </Field>
                <Field label={`MRC${cur}`} hint="Monthly charge">
                  <input type="number" min="0" step={step} className="input tabular-nums" value={form.mrc} onChange={e => set("mrc", e.target.value)} placeholder="0"/>
                </Field>
                {mod.bidLog && (
                  <Field label={`TCV${cur}`} hint="Total contract value">
                    <input type="number" min="0" step={step} className="input tabular-nums" value={form.tcv} onChange={e => set("tcv", e.target.value)} placeholder="0"/>
                  </Field>
                )}
              </div>
            )}
            {mod.bidLog && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Project size">
                  <Pills options={opts("project_size")} value={form.project_size} onChange={v => set("project_size", v)} allowClear/>
                </Field>
                {!mod.telecom && (
                  <Field label={`Total contract value (TCV)${cur}`}>
                    <input type="number" min="0" step={step} className="input tabular-nums" value={form.tcv} onChange={e => set("tcv", e.target.value)} placeholder="0"/>
                  </Field>
                )}
              </div>
            )}
            <Field label="Phase">
              <Pills options={opts("phase")} value={form.phase} onChange={v => set("phase", v || "ON_GOING")}/>
            </Field>
            <Field label="Status">
              <Pills options={opts("status")} value={form.status} onChange={v => set("status", v || "PENDING")}/>
            </Field>
            {isDropped && (
              <Field label="Reason for dropping">
                <Select value={form.reason} onChange={v => set("reason", v)} options={opts("reason")} placeholder="Choose a reason…"/>
              </Field>
            )}
            {mod.bidLog && isLost && (
              <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl bg-red-50/60 border border-red-100">
                <Field label="Winner">
                  <input className="input" value={form.winner_name} onChange={e => set("winner_name", e.target.value)} placeholder="Who won the RFP"/>
                </Field>
                <Field label={`Winner's TCV${cur}`}>
                  <input type="number" min="0" className="input tabular-nums" value={form.winner_tcv} onChange={e => set("winner_tcv", e.target.value)}/>
                </Field>
              </div>
            )}
          </Section>
        </div>

        {/* Side panel: progress + summary */}
        <aside className="lg:sticky lg:top-20 space-y-4">
          <div className="card p-4 space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 pb-1">Sections</div>
            {sections.map(s => (
              <button key={s.id} onClick={() => goTo(s.id)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-left text-gray-700 hover:bg-gray-50">
                {done[s.id] ? <CheckCircle2 size={16} className="text-green-600 flex-shrink-0"/> : <Circle size={16} className="text-gray-300 flex-shrink-0"/>}
                {s.title}
              </button>
            ))}
          </div>
          <div className="card p-4 space-y-3 text-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Summary</div>
            {mod.expro && (
              <div>
                <div className="text-xs text-gray-400">EXPRO number</div>
                <div className="font-semibold text-gray-900 font-mono">{form.rfp_ref || "—"}</div>
              </div>
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
            </div>
            <div className="flex items-center gap-1.5">
              <Shield size={13} className="text-gray-400"/>
              <span className="text-gray-700">{form.bid_bond_required ? `Bid bond ${form.bid_bond_pct ? `${form.bid_bond_pct}%` : "(choose %)"}` : "No bid bond"}</span>
            </div>
            {mod.scope && (
              <div>
                <div className="text-xs text-gray-400 mb-1">{mod.telecom ? "Family & solution" : "Scope of work"}</div>
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
                <div><div className="text-xs text-gray-400">NRC</div><div className="font-semibold text-gray-900 tabular-nums">{formatMoney(form.nrc === "" ? null : form.nrc, currency)}</div></div>
                <div><div className="text-xs text-gray-400">MRC</div><div className="font-semibold text-gray-900 tabular-nums">{formatMoney(form.mrc === "" ? null : form.mrc, currency)}</div></div>
              </div>
            )}
            {mod.bidLog && (
              <div>
                <div className="text-xs text-gray-400">TCV</div>
                <div className="font-semibold text-gray-900 tabular-nums">{formatMoney(form.tcv === "" ? null : form.tcv, currency)}</div>
              </div>
            )}
          </div>
        </aside>
      </div>
      )}
    </div>
  )
}
