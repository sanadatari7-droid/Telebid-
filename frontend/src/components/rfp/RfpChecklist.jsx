import React, { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Check, ChevronDown, X, Plus, MapPin, FileSignature, ShieldCheck, Clock, CheckCircle2, XCircle, Paperclip, Send, Download, Trash2, AlertTriangle } from "lucide-react"
import { rfpApi } from "../../services/api"
import { apiErrorMessage } from "../../utils/apiError"
import { fmtDT } from "../../utils/fmt"

// Yes / No as two checkboxes, only one of which can be ticked.
function YesNo({ value, onChange, disabled }) {
  return (
    <div className="flex gap-3">
      {[[true, "Yes"], [false, "No"]].map(([v, label]) => (
        <label key={label} className={clsx("flex items-center gap-2.5 px-5 py-3 rounded-xl border text-sm font-medium transition-colors",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          value === v ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700 hover:bg-gray-50")}>
          <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={value === v} disabled={disabled} onChange={() => onChange(v)}/>
          {label}
        </label>
      ))}
    </div>
  )
}

// Drop-down list of insurance policies to tick, with "add a policy" at the bottom.
function PolicyPicker({ options, selected, onToggle, onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const ref = useRef(null)
  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])
  const add = async () => { if (name.trim() && await onAdd(name.trim())) setName("") }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="input flex items-center justify-between text-left">
        <span className={selected.length ? "text-gray-900" : "text-gray-400"}>{selected.length ? `${selected.length} selected` : "Choose the policies…"}</span>
        <ChevronDown size={15} className={clsx("text-gray-400 transition-transform", open && "rotate-180")}/>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          <div className="max-h-60 overflow-y-auto">
            {options.map(o => (
              <label key={o.value} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)}/>
                {o.label}
              </label>
            ))}
          </div>
          <div className="flex gap-2 p-2 border-t border-gray-100">
            <input className="input !py-1.5 text-sm" placeholder="Add a policy, e.g. Contractor's all risk" value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}/>
            <button type="button" className="btn-secondary btn-sm whitespace-nowrap" disabled={!name.trim()} onClick={add}><Plus size={12}/> Add</button>
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map(v => (
            <span key={v} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-800">
              {options.find(o => o.value === v)?.label || v}
              <button type="button" onClick={() => onToggle(v)} className="text-blue-400 hover:text-blue-700" title="Remove"><X size={12}/></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const TERMS_STATUS = {
  PENDING:      { label: "Waiting for Contracting's approval",  icon: Clock,        cls: "bg-amber-50 border-amber-200 text-amber-800" },
  APPROVED:     { label: "Approved",                            icon: CheckCircle2, cls: "bg-green-50 border-green-200 text-green-800" },
  NOT_APPROVED: { label: "Not approved",                        icon: XCircle,      cls: "bg-red-50 border-red-200 text-red-800" },
}

function Part({ icon: Icon, num, title, hint, done, children }) {
  return (
    <section className="card space-y-4">
      <div className="flex items-start gap-3">
        <span className={clsx("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", done ? "bg-green-100 text-green-700" : "bg-blue-50 text-blue-600")}>
          {done ? <Check size={16}/> : <Icon size={16}/>}
        </span>
        <div>
          <h2 className="font-bold text-gray-900">{num}. {title}</h2>
          {hint && <p className="text-sm text-gray-500">{hint}</p>}
        </div>
      </div>
      <div className="pl-11 space-y-4">{children}</div>
    </section>
  )
}

const fileSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

// Special terms go to Contracting by email, with the documents the bid manager attaches.
function ContractingPanel({ api, rfpId, data, saved, onData }) {
  const [note, setNote] = useState("")
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const contracting = data.contracting
  const sent = !!saved.special_terms_sent_at
  const decided = saved.special_terms_status !== "PENDING"
  const refresh = r => onData(r.data)

  const upload = async files => {
    setUploading(true)
    try {
      for (const file of files) await api.uploadTermsFile(rfpId, file)
      refresh(await api.checklist(rfpId))
    } catch (err) { toast.error(apiErrorMessage(err, "Couldn't attach the file")) }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = "" }
  }
  const download = async f => {
    try {
      const r = await api.downloadTermsFile(rfpId, f.file_id)
      const url = URL.createObjectURL(r.data)
      const a = Object.assign(document.createElement("a"), { href: url, download: f.filename })
      a.click(); URL.revokeObjectURL(url)
    } catch (err) { toast.error(apiErrorMessage(err, "Couldn't download the file")) }
  }
  const removeMut = useMutation({
    mutationFn: id => api.deleteTermsFile(rfpId, id), onSuccess: refresh,
    onError: err => toast.error(apiErrorMessage(err, "Couldn't remove the file")),
  })
  const sendMut = useMutation({
    mutationFn: () => api.sendTerms(rfpId),
    onSuccess: r => { refresh(r); toast.success(`Sent to ${contracting.name}`) },
    onError: async err => { toast.error(apiErrorMessage(err, "Couldn't send the email")); refresh(await api.checklist(rfpId)) },
  })
  const decideMut = useMutation({
    mutationFn: decision => api.decideTerms(rfpId, { decision, note }),
    onSuccess: r => { refresh(r); setNote(""); toast.success("Answer saved — the bid manager has been told") },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the answer")),
  })

  const step = (n, label, done) => (
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
      <span className={clsx("w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0",
        done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{done ? "✓" : n}</span>{label}
    </div>
  )

  return (
    <div className="rounded-xl border border-gray-200 p-4 space-y-4">
      {step("a", "Attach the documents for Contracting", data.files.length > 0)}
      <div className="pl-8 space-y-2">
        {data.files.map(f => (
          <div key={f.file_id} className="flex items-center gap-2 text-sm">
            <Paperclip size={13} className="text-gray-400 flex-shrink-0"/>
            <button type="button" className="text-blue-600 hover:underline truncate text-left" onClick={() => download(f)} title="Download">{f.filename}</button>
            <span className="text-xs text-gray-400 whitespace-nowrap">{fileSize(f.size_bytes)}</span>
            <button type="button" className="ml-auto text-gray-400 hover:text-red-600" title="Remove" disabled={removeMut.isPending}
              onClick={() => removeMut.mutate(f.file_id)}><Trash2 size={13}/></button>
          </div>
        ))}
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => e.target.files.length && upload([...e.target.files])}/>
        <button type="button" className="btn-secondary btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          <Paperclip size={12}/> {uploading ? "Attaching…" : data.files.length ? "Attach more" : "Attach files"}
        </button>
        <p className="text-xs text-gray-400">e.g. the client's terms pages, the draft contract. Up to 10 MB each.</p>
      </div>

      {step("b", `Send to ${contracting.name} by email`, sent)}
      <div className="pl-8 space-y-2">
        {sent && <p className="text-xs text-green-700">✓ Sent to {saved.special_terms_sent_to} by {saved.special_terms_sent_by} · {fmtDT(saved.special_terms_sent_at)}</p>}
        {!contracting.email ? (
          <p className="text-xs text-amber-700">No Contracting email yet — set it in <Link to="/company-settings" className="underline font-semibold">Company Settings → C · Approvals</Link>.</p>
        ) : !decided && (
          <button type="button" className={sent ? "btn-ghost btn-sm text-xs" : "btn-primary btn-sm"} disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>
            <Send size={12}/> {sendMut.isPending ? "Sending…" : sent ? "Send again" : `Send to ${contracting.email}`}
          </button>
        )}
        {saved.special_terms_send_error && !sent && (
          <p className="text-xs text-red-600 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 flex-shrink-0"/>{saved.special_terms_send_error}</p>
        )}
      </div>

      {step("c", `${contracting.name}'s answer`, decided)}
      <div className="pl-8">
        {!decided ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">When {contracting.name} replies, record their answer here.</p>
            <input className="input text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="Their comments (optional)"/>
            <div className="flex gap-2">
              <button className="btn-primary btn-sm" disabled={decideMut.isPending} onClick={() => decideMut.mutate("APPROVED")}><CheckCircle2 size={13}/> Approved</button>
              <button className="btn-secondary btn-sm text-red-600" disabled={decideMut.isPending} onClick={() => decideMut.mutate("NOT_APPROVED")}><XCircle size={13}/> Not approved</button>
            </div>
          </div>
        ) : (
          <button className="btn-ghost btn-sm text-xs" disabled={decideMut.isPending}
            onClick={() => decideMut.mutate(saved.special_terms_status === "APPROVED" ? "NOT_APPROVED" : "APPROVED")}>
            Change to {saved.special_terms_status === "APPROVED" ? "Not approved" : "Approved"}
          </button>
        )}
      </div>
    </div>
  )
}

export default function RfpChecklist({ module, rfpId }) {
  const api = rfpApi(module)
  const key = ["rfp-checklist", module, rfpId]
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.checklist(rfpId).then(r => r.data) })
  const [f, setF] = useState(null)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!data) return
    const c = data.checklist
    setF({
      site_visit_required: c ? c.site_visit_required : null, site_visit_am_id: c?.site_visit_am_id || "",
      special_terms_required: c ? c.special_terms_required : null, special_terms: c?.special_terms || "",
      insurance_required: c ? c.insurance_required : null, insurance_policies: c?.insurance_policies || [],
    })
  }, [data])

  const saveMut = useMutation({
    mutationFn: () => api.saveChecklist(rfpId, { ...f, site_visit_am_id: f.site_visit_am_id ? Number(f.site_visit_am_id) : null }),
    onSuccess: r => { qc.setQueryData(key, r.data); toast.success("Checklist saved") },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the checklist")),
  })
  const addPolicy = async label => {
    try {
      const p = (await api.addPolicy(label)).data
      await qc.invalidateQueries({ queryKey: key })
      setF(prev => ({ ...prev, insurance_policies: prev.insurance_policies.includes(p.value) ? prev.insurance_policies : [...prev.insurance_policies, p.value] }))
      return true
    } catch (err) { toast.error(apiErrorMessage(err, "Couldn't add the policy")); return false }
  }

  if (isLoading || !data || !f) return <div className="card text-sm text-gray-400">Loading checklist…</div>
  const saved = data.checklist
  const termsChanged = (saved?.special_terms || "") !== f.special_terms.trim()

  const missing = [
    f.site_visit_required === null && "site visit Yes or No",
    f.site_visit_required && !f.site_visit_am_id && "the assigned sales person",
    f.special_terms_required === null && "special terms Yes or No",
    f.special_terms_required && !f.special_terms.trim() && "the special terms",
    f.insurance_required === null && "insurance Yes or No",
    f.insurance_required && !f.insurance_policies.length && "the insurance policies",
  ].filter(Boolean)
  const status = saved?.special_terms && !termsChanged ? TERMS_STATUS[saved.special_terms_status] : null
  const StatusIcon = status?.icon

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      <div className="space-y-5 min-w-0">
        <Part icon={MapPin} num="1" title="Site visit" hint="Is a site visit needed? If yes, choose the sales person who goes."
          done={f.site_visit_required === false || (f.site_visit_required && !!f.site_visit_am_id)}>
          <YesNo value={f.site_visit_required} onChange={v => setF(p => ({ ...p, site_visit_required: v, site_visit_am_id: v ? p.site_visit_am_id : "" }))}/>
          {f.site_visit_required && (
            <div>
              <label className="label">Assigned sales person <span className="text-red-500">*</span></label>
              <select className="input max-w-sm" value={f.site_visit_am_id} onChange={e => set("site_visit_am_id", e.target.value)}>
                <option value="">Choose…</option>
                {data.salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {!data.salesmen.length && <p className="form-hint">No sales people yet — add account managers in <Link to="/company-settings" className="underline">Company Settings</Link>.</p>}
            </div>
          )}
        </Part>

        <Part icon={FileSignature} num="2" title="Others — special terms and conditions"
          hint="Special terms go to Contracting for approval: attach the documents and send them by email. The bid manager is told the outcome."
          done={f.special_terms_required === false || (f.special_terms_required && !!f.special_terms.trim())}>
          <YesNo value={f.special_terms_required} onChange={v => set("special_terms_required", v)}/>
          {f.special_terms_required && (
            <div className="space-y-3">
              <div>
                <label className="label">Special terms and conditions <span className="text-red-500">*</span></label>
                <textarea className="input" rows={4} dir="auto" value={f.special_terms} onChange={e => set("special_terms", e.target.value)}
                  placeholder="e.g. Payment 90 days after acceptance; penalties capped at 10%"/>
                {termsChanged && saved?.special_terms && <p className="form-hint">Changed terms have to be sent to Contracting again after you save.</p>}
                {termsChanged && !saved?.special_terms && <p className="form-hint">Save the checklist, then attach the documents and send them to Contracting.</p>}
              </div>
              {status && (
                <div className={clsx("flex items-start gap-2 p-3 rounded-xl border text-sm", status.cls)}>
                  <StatusIcon size={16} className="mt-0.5 flex-shrink-0"/>
                  <div>
                    <div className="font-semibold">{status.label}</div>
                    {saved.special_terms_decider_name && <div className="text-xs opacity-80">Recorded by {saved.special_terms_decider_name} · {fmtDT(saved.special_terms_decided_at)}</div>}
                    {saved.special_terms_status === "PENDING" && !saved.special_terms_sent_at && <div className="text-xs opacity-80">Not sent to Contracting yet</div>}
                    {saved.special_terms_note && <div className="text-xs mt-1">Comments: {saved.special_terms_note}</div>}
                    <div className="text-xs opacity-80 mt-1">
                      Bid manager: {data.bid_manager ? `${data.bid_manager.full_name}${data.bid_manager.email ? ` (${data.bid_manager.email})` : ""}` : "not chosen yet — set it in the details tab"}
                    </div>
                  </div>
                </div>
              )}
              {status && <ContractingPanel api={api} rfpId={rfpId} data={data} saved={saved} onData={d => qc.setQueryData(key, d)}/>}
            </div>
          )}
        </Part>

        <Part icon={ShieldCheck} num="3" title="Insurance" hint="Does the client require insurance? If yes, tick every policy they ask for."
          done={f.insurance_required === false || (f.insurance_required && f.insurance_policies.length > 0)}>
          <YesNo value={f.insurance_required} onChange={v => setF(p => ({ ...p, insurance_required: v, insurance_policies: v ? p.insurance_policies : [] }))}/>
          {f.insurance_required && (
            <div className="max-w-xl">
              <label className="label">Policies required <span className="text-red-500">*</span></label>
              <PolicyPicker options={data.policies} selected={f.insurance_policies} onAdd={addPolicy}
                onToggle={v => set("insurance_policies", f.insurance_policies.includes(v) ? f.insurance_policies.filter(x => x !== v) : [...f.insurance_policies, v])}/>
            </div>
          )}
        </Part>
      </div>

      <aside className="lg:sticky lg:top-20 space-y-3">
        <div className="card p-4 space-y-2 text-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Checklist</div>
          {[["Site visit", f.site_visit_required, data.salesmen.find(s => String(s.id) === String(f.site_visit_am_id))?.name],
            ["Special terms", f.special_terms_required, status?.label],
            ["Insurance", f.insurance_required, f.insurance_policies.length ? `${f.insurance_policies.length} polic${f.insurance_policies.length === 1 ? "y" : "ies"}` : null],
          ].map(([label, v, extra]) => (
            <div key={label} className="flex justify-between gap-2">
              <span className="text-gray-500">{label}</span>
              <span className="text-gray-900 text-right">{v === null ? "—" : v ? `Yes${extra ? ` · ${extra}` : ""}` : "No"}</span>
            </div>
          ))}
        </div>
        {missing.length > 0 && <p className="text-xs text-amber-700">To save, fill in: {missing.join(", ")}</p>}
        <button className="btn-primary w-full justify-center" disabled={missing.length > 0 || saveMut.isPending} onClick={() => saveMut.mutate()}>
          <Check size={14}/> {saveMut.isPending ? "Saving…" : "Save checklist"}
        </button>
        {saved?.updated_at && <p className="text-xs text-gray-400 text-center">Last saved {fmtDT(saved.updated_at)}</p>}
      </aside>
    </div>
  )
}
