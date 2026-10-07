import React, { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { companyConfigApi, empApi, oppsV2Api, usersApi } from "../services/api"
import { COUNTRIES } from "../constants/countries"
import { apiErrorMessage } from "../utils/apiError"
import toast from "react-hot-toast"
import clsx from "clsx"
import {
  Building2, Key, Hash, Users, Briefcase, TrendingUp, Shield,
  ClipboardList, Microscope, Plus, Trash2, Check, X, Pencil, ChevronRight, Globe2, UserCheck, Send
} from "lucide-react"

// 9 sections exactly as in Image 2
const SECTIONS = [
  { id:"1", num:"1", label:"Company Name",                       icon:Building2 },
  { id:"2", num:"2", label:"Activation Code",                    icon:Key },
  { id:"3", num:"3", label:"Reference Model",                    icon:Hash },
  { id:"4", num:"4", label:"Account Managers",                   icon:Users },
  { id:"5", num:"5", label:"Bid Specialists / Managers",         icon:Briefcase },
  { id:"8", num:"8", label:"Bid Evaluations Questions & Value",  icon:ClipboardList },
  { id:"9", num:"9", label:"EXPRO Feasibility Study",            icon:Microscope },
  { id:"B", num:"B", label:"Evaluators (Module 1 / Sub-B)",      icon:UserCheck },
  { id:"C", num:"C", label:"Pricing Approval (Module 1 / Sub-C)", icon:TrendingUp },
  { id:"D", num:"D", label:"Bid Bond Approval (Module 1 / Sub-D)", icon:Shield },
]

// ── Section 1 & 2: Company Info ───────────────────────────────────────────────
function CompanyInfoSection() {
  const qc = useQueryClient()
  const { data: company } = useQuery({ queryKey:["company-cfg"], queryFn:()=>companyConfigApi.get().then(r=>r.data) })
  const { data: currencies = [] } = useQuery({ queryKey:["currencies"], queryFn:()=>companyConfigApi.getCurrencies().then(r=>r.data) })
  const [form, setForm] = useState({})
  useEffect(() => { if (company) setForm({ ...company }) }, [company])
  const fc = e => setForm(p=>({...p,[e.target.name]:e.target.value}))
  const toggleService = key => setForm(p=>({...p,[key]: !p[key]}))
  const saveMut = useMutation({
    mutationFn: () => {
      if (!form.services_ict && !form.services_telecom) {
        toast.error("Select at least one service offered (ICT, Telecom, or both)")
        return Promise.reject(new Error("validation"))
      }
      return companyConfigApi.update(form)
    },
    onSuccess: () => { toast.success("Company updated"); qc.invalidateQueries({queryKey:["company-cfg"]}) },
    onError: err => { if (err.message !== "validation") toast.error(err?.response?.data?.detail || "Failed to save") }
  })

  return (
    <div className="space-y-6">
      {/* Section 1 — Company Name */}
      <div className="card space-y-4">
        <div className="section-title flex items-center gap-2"><Building2 size={13}/> 1 — Company Name</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Company Name (English)</label>
            <input name="company_name" className="input" value={form.company_name||""} onChange={fc}/>
          </div>
          <div>
            <label className="label">Company Name (Arabic)</label>
            <input name="company_name_ar" className="input" value={form.company_name_ar||""} onChange={fc} dir="rtl"/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Company Initials</label>
            <input name="company_initials" className="input font-mono font-bold text-lg tracking-widest" maxLength={10}
              value={form.company_initials||""} onChange={fc} placeholder="e.g. SLM"/>
            <p className="form-hint">Used in reference number generation</p>
          </div>
          <div>
            <label className="label">Industry</label>
            <input name="industry" className="input" value={form.industry||""} onChange={fc}/>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="label">Phone</label><input name="phone" className="input" value={form.phone||""} onChange={fc}/></div>
          <div><label className="label">Email</label><input name="email" className="input" value={form.email||""} onChange={fc}/></div>
          <div><label className="label">Website</label><input name="website" className="input" value={form.website||""} onChange={fc}/></div>
        </div>

        {/* Module 1 / Sub-module A — country & currency */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Country of Operation</label>
            <select name="country" className="input" value={form.country||""} onChange={fc}>
              <option value="">Select country…</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Currency</label>
            <select name="currency_id" className="input" value={form.currency_id||""}
              onChange={e=>setForm(p=>({...p, currency_id: e.target.value ? Number(e.target.value) : null}))}>
              <option value="">Select currency…</option>
              {currencies.map(c => <option key={c.currency_id} value={c.currency_id}>{c.currency_code} — {c.currency_name}</option>)}
            </select>
          </div>
        </div>

        {/* Currency decimals — single choice of 2 / 3 / 4 */}
        <div>
          <label className="label">Currency Decimals</label>
          <div className="flex gap-2">
            {[2,3,4].map(n => (
              <label key={n} className={clsx("flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium",
                form.currency_decimals===n ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                <input type="checkbox" className="accent-blue-600" checked={form.currency_decimals===n}
                  onChange={()=>setForm(p=>({...p, currency_decimals:n}))}/>
                {n} decimals
              </label>
            ))}
          </div>
        </div>

        {/* Services offered — ICT / Telecom checkboxes, both = Both */}
        <div>
          <label className="label">Services Offered</label>
          <div className="flex gap-2">
            {[["services_ict","ICT"],["services_telecom","Telecom"]].map(([key,label]) => (
              <label key={key} className={clsx("flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium",
                form[key] ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                <input type="checkbox" className="accent-blue-600" checked={!!form[key]} onChange={()=>toggleService(key)}/>
                {label}
              </label>
            ))}
          </div>
          <p className="form-hint">Check both to offer ICT and Telecom.</p>
        </div>
      </div>

      {/* Section 2 — Activation Code */}
      <div className="card space-y-4">
        <div className="section-title flex items-center gap-2"><Key size={13}/> 2 — Activation Code</div>
        <div className="alert-warning text-xs">
          The activation code is used to license and authenticate the application. Keep it secure.
        </div>
        <div>
          <label className="label">Activation Code</label>
          <input name="activation_code" className="input font-mono" value={form.activation_code||""}
            onChange={fc} placeholder="Enter activation code"/>
        </div>
      </div>

      <button className="btn-primary" disabled={saveMut.isPending} onClick={()=>saveMut.mutate()}>
        <Check size={13}/> {saveMut.isPending?"Saving…":"Save Company Settings"}
      </button>
    </div>
  )
}

// ── Section 3: Reference Model ────────────────────────────────────────────────
function RefModelSection() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey:["ref-config"], queryFn:()=>oppsV2Api.getRefConfig().then(r=>r.data) })
  const [form, setForm] = useState(null)
  const [preview, setPreview] = useState("")
  useEffect(() => { if (cfg && !form) setForm({...cfg}) }, [cfg])
  const fc = (k, v) => setForm(p=>({...p,[k]:v}))

  useEffect(() => {
    if (!form) return
    oppsV2Api.previewRef({ config: form, presales_initials:"SA", customer_id:"12345", am_initials:"AM", client_initials:"CL" })
      .then(r => setPreview(r.data.preview)).catch(()=>{})
  }, [form])

  const saveMut = useMutation({
    mutationFn: () => oppsV2Api.saveRefConfig(form),
    onSuccess: () => { toast.success("Reference model saved"); qc.invalidateQueries({queryKey:["ref-config"]}) }
  })

  if (!form) return null

  // From Image 8: fields are optional checkboxes
  // Company Initials - Pre-Sales Initials - Account Manager Initials - Ref # - Client Initials - Version 1.x
  const COMPONENTS = [
    { key:"use_company_initials",  label:"Company Initials",          hint:"e.g. SLM", configKey:"company_initials", defaultVal:"SLM" },
    { key:"use_presales_initials", label:"Pre-Sales Initials",         hint:"Auto from employee", configKey:null },
    { key:"use_am_initials",       label:"Account Manager Initials",   hint:"Auto from employee", configKey:null },
    { key:"use_cash",              label:"CASH Label",                  hint:"Fixed text", configKey:"cash_label", defaultVal:"CASH" },
    { key:"use_customer_id",       label:"Reference Number / Client ID",hint:"Customer ref field", configKey:null },
    { key:"use_client_initials",   label:"Client Initials",            hint:"From customer name", configKey:null },
    { key:"use_version",           label:"Version",                     hint:"e.g. 1.x", configKey:"version_label", defaultVal:"1.x" },
  ]

  return (
    <div className="card space-y-5">
      <div>
        <div className="section-title flex items-center gap-2"><Hash size={13}/> 3 — Reference Model</div>
        <div className="alert-info text-xs mb-4">
          Fields are optional checkboxes — enable only the components you want in the customer reference.
        </div>

        <div className="space-y-3">
          {COMPONENTS.map((comp, i) => (
            <div key={comp.key} className={clsx("flex items-center justify-between p-3.5 rounded-xl border transition-all",
              form[comp.key] ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-100")}>
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-400">
                  {i+1}
                </span>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{comp.label}</div>
                  <div className="text-xs text-gray-400">{comp.hint}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {comp.configKey && form[comp.key] && (
                  <input className="input w-32 py-1 text-sm font-mono"
                    value={form[comp.configKey] || ""}
                    onChange={e => fc(comp.configKey, e.target.value)}
                    placeholder={comp.defaultVal}/>
                )}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={!!form[comp.key]}
                    onChange={e => fc(comp.key, e.target.checked)}/>
                  <div className="w-10 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 transition-all after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5"/>
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* Separator */}
        <div className="mt-4">
          <label className="label">Separator</label>
          <div className="flex gap-2">
            {["-","/","_","."].map(s => (
              <button key={s} onClick={()=>fc("separator",s)}
                className={clsx("px-4 py-2 rounded-xl border font-mono font-bold text-sm",
                  form.separator===s?"bg-blue-600 text-white border-blue-600":"bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
          <div className="text-xs font-semibold text-blue-600 mb-1 uppercase tracking-wide">Live Preview</div>
          <div className="font-mono text-xl font-bold text-blue-800">{preview || "—"}</div>
          <div className="text-xs text-blue-400 mt-1">Example: PS=SA, AM=AM, Customer=12345, Client=CL, v1.x</div>
        </div>

        <button className="btn-primary mt-4" disabled={saveMut.isPending} onClick={()=>saveMut.mutate()}>
          <Check size={13}/> {saveMut.isPending?"Saving…":"Save Reference Model"}
        </button>
      </div>
    </div>
  )
}

// ── Section 4: Account Managers ───────────────────────────────────────────────
function PeopleSection({ type }) {
  const qc = useQueryClient()
  const isAM = type === "am"
  const { data: items = [] } = useQuery({
    queryKey: [isAM?"company-ams":"company-bms"],
    queryFn: () => (isAM ? companyConfigApi.getAMs() : companyConfigApi.getBMs()).then(r=>r.data)
  })
  const { data: employees = [] } = useQuery({
    queryKey: ["emps-all"],
    queryFn: () => empApi.list({}).then(r=>r.data)
  })
  const { data: users } = useQuery({ queryKey:["users-list"], queryFn:()=>usersApi.list({page_size:200}).then(r=>r.data) })
  const userList = users?.items || []

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ emp_id:"", full_name:"", email:"", initials:"" })

  const handleEmpChange = (empId) => {
    const emp = employees.find(e=>String(e.emp_id)===String(empId))
    if (emp) {
      setForm(p=>({...p, emp_id:empId, full_name:emp.full_name, email:emp.email, initials:emp.initials||""}))
    } else {
      setForm(p=>({...p, emp_id:empId}))
    }
  }

  const addMut = useMutation({
    mutationFn: () => (isAM ? companyConfigApi.addAM : companyConfigApi.addBM)(
      { emp_id: form.emp_id?Number(form.emp_id):null, full_name:form.full_name, email:form.email, initials:form.initials }),
    onSuccess: () => {
      toast.success("Added successfully")
      qc.invalidateQueries({queryKey:[isAM?"company-ams":"company-bms"]})
      setShowAdd(false); setForm({emp_id:"",full_name:"",email:"",initials:""})
    }
  })
  const removeMut = useMutation({
    mutationFn: id => (isAM ? companyConfigApi.removeAM : companyConfigApi.removeBM)(id),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({queryKey:[isAM?"company-ams":"company-bms"]}) }
  })

  const title = isAM ? "4 — Account Managers" : "5 — Bid Specialists / Managers"
  const Icon = isAM ? Users : Briefcase

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title mb-0 flex items-center gap-2"><Icon size={13}/> {title}</div>
        <button className="btn-primary btn-sm" onClick={()=>setShowAdd(!showAdd)}>
          <Plus size={12}/> Add
        </button>
      </div>

      {showAdd && (
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-3">
          <div>
            <label className="label">Select Employee (auto-fills info)</label>
            <select className="input" value={form.emp_id} onChange={e=>handleEmpChange(e.target.value)}>
              <option value="">Select employee…</option>
              {employees.map(e=><option key={e.emp_id} value={e.emp_id}>{e.full_name}{e.initials?` (${e.initials})`:""}</option>)}
            </select>
          </div>
          {!form.emp_id && (
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Full Name *</label><input className="input" value={form.full_name} onChange={e=>setForm(p=>({...p,full_name:e.target.value}))}/></div>
              <div><label className="label">Initials</label><input className="input font-mono" value={form.initials} onChange={e=>setForm(p=>({...p,initials:e.target.value}))} maxLength={4}/></div>
              <div><label className="label">Email</label><input className="input" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))}/></div>
            </div>
          )}
          {form.emp_id && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="p-2 bg-white rounded-lg border border-blue-100">
                <div className="text-xs text-gray-400">Name</div><div className="font-semibold">{form.full_name}</div>
              </div>
              <div className="p-2 bg-white rounded-lg border border-blue-100">
                <div className="text-xs text-gray-400">Initials</div><div className="font-mono font-bold">{form.initials||"—"}</div>
              </div>
              <div className="p-2 bg-white rounded-lg border border-blue-100">
                <div className="text-xs text-gray-400">Email</div><div className="truncate">{form.email||"—"}</div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" disabled={!form.full_name||addMut.isPending} onClick={()=>addMut.mutate()}>
              <Plus size={12}/> {addMut.isPending?"Adding…":"Add"}
            </button>
            <button className="btn-ghost btn-sm" onClick={()=>setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {items.length===0 ? (
        <div className="text-center py-6 text-sm text-gray-400">No {isAM?"account managers":"bid specialists"} configured</div>
      ) : (
        <div className="space-y-2">
          {items.map(m=>(
            <div key={m[isAM?"am_id":"bm_id"]} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {m.initials || m.full_name?.slice(0,2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900">{m.full_name}</div>
                <div className="text-xs text-gray-400">{m.email}</div>
              </div>
              {m.initials && <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{m.initials}</span>}
              <button className="btn-ghost btn-sm text-red-400"
                onClick={()=>removeMut.mutate(m[isAM?"am_id":"bm_id"])}>
                <Trash2 size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Section B: Evaluators (Module 1 / Sub-module B) ──────────────────────────
// Repeatable Name / Email / Title records. Title is later selectable in
// Module 2 (RFP ICT)'s evaluation process.
function EvaluatorsSection() {
  const qc = useQueryClient()
  const { data: items = [] } = useQuery({
    queryKey: ["company-evaluators"],
    queryFn: () => companyConfigApi.getEvaluators().then(r=>r.data)
  })
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ full_name:"", email:"", title:"" })

  const addMut = useMutation({
    mutationFn: () => companyConfigApi.addEvaluator(form),
    onSuccess: () => {
      toast.success("Evaluator added")
      qc.invalidateQueries({queryKey:["company-evaluators"]})
      setShowAdd(false); setForm({ full_name:"", email:"", title:"" })
    },
    onError: err => toast.error(err?.response?.data?.detail || "Failed to add evaluator")
  })
  const removeMut = useMutation({
    mutationFn: id => companyConfigApi.removeEvaluator(id),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({queryKey:["company-evaluators"]}) }
  })

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title mb-0 flex items-center gap-2"><UserCheck size={13}/> B — Evaluators</div>
        <button className="btn-primary btn-sm" onClick={()=>setShowAdd(!showAdd)}>
          <Plus size={12}/> Add
        </button>
      </div>
      <div className="alert-info text-xs">
        Each evaluator's Title is selectable later in Module 2 (RFP ICT)'s evaluation process.
      </div>

      {showAdd && (
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Name *</label><input className="input" value={form.full_name} onChange={e=>setForm(p=>({...p,full_name:e.target.value}))}/></div>
            <div><label className="label">Email</label><input className="input" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))}/></div>
            <div><label className="label">Title *</label><input className="input" value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}/></div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" disabled={!form.full_name||!form.title||addMut.isPending} onClick={()=>addMut.mutate()}>
              <Plus size={12}/> {addMut.isPending?"Adding…":"Add"}
            </button>
            <button className="btn-ghost btn-sm" onClick={()=>setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {items.length===0 ? (
        <div className="text-center py-6 text-sm text-gray-400">No evaluators configured</div>
      ) : (
        <div className="space-y-2">
          {items.map(m=>(
            <div key={m.evaluator_id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {m.full_name?.slice(0,2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900">{m.full_name}</div>
                <div className="text-xs text-gray-400">{m.email}</div>
              </div>
              <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{m.title}</span>
              <button className="btn-ghost btn-sm text-red-400" onClick={()=>removeMut.mutate(m.evaluator_id)}>
                <Trash2 size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Section C: Pricing Approval Cycle (Module 1 / Sub-module C) ──────────────
// L1 → L2 → L3. Telecom escalates on discount %, ICT on margin %.
// Go / No-Go business case gate is a minimum EBITDA %.
const PCT_FIELDS = ["telecom_l1_max_discount","telecom_l2_max_discount","ict_l1_min_margin","ict_l2_min_margin","ebitda_min_pct"]

function PctInput({ value, onChange, min = 0 }) {
  return (
    <div className="relative w-28">
      <input type="number" step="0.01" min={min} max="100" className="input pr-7 text-right tabular-nums"
        value={value ?? ""} onChange={e => onChange(e.target.value)} placeholder="—"/>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
    </div>
  )
}

function RuleRow({ level, title, children }) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="flex items-center gap-3 min-w-0">
        <span className="badge-blue flex-shrink-0">{level}</span>
        <span className="text-sm font-semibold text-gray-900 truncate">{title}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-500 flex-shrink-0">{children}</div>
    </div>
  )
}

function PricingApprovalSection() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey:["pricing-approval"], queryFn:()=>companyConfigApi.getPricingApproval().then(r=>r.data) })
  const { data: company } = useQuery({ queryKey:["company-cfg"], queryFn:()=>companyConfigApi.get().then(r=>r.data) })
  const [form, setForm] = useState(null)
  useEffect(() => { if (cfg) setForm({ ...cfg }) }, [cfg])
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { l1_title: form.l1_title, l2_title: form.l2_title, l3_title: form.l3_title }
      PCT_FIELDS.forEach(k => { payload[k] = form[k] === "" || form[k] == null ? null : Number(form[k]) })
      return companyConfigApi.savePricingApproval(payload)
    },
    onSuccess: () => { toast.success("Pricing approval cycle saved"); qc.invalidateQueries({queryKey:["pricing-approval"]}) },
    onError: err => toast.error(apiErrorMessage(err, "Failed to save pricing approval cycle"))
  })

  if (!form) return null

  // Show only the service lines the company offers (Sub-module A); both if not set yet.
  const noneSet = !company?.services_ict && !company?.services_telecom
  const showTelecom = noneSet || company?.services_telecom
  const showIct = noneSet || company?.services_ict
  const titles = [form.l1_title, form.l2_title, form.l3_title]

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="section-title flex items-center gap-2"><TrendingUp size={13}/> C — Pricing Approval Cycle</div>
        <div className="alert-info text-xs">
          Pricing is approved in sequence. Each level's title can be renamed to match your organisation.
        </div>
        <div className="flex items-stretch gap-2">
          {["l1_title","l2_title","l3_title"].map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 && <ChevronRight size={16} className="text-gray-300 self-center flex-shrink-0"/>}
              <div className="flex-1 p-3 rounded-xl border border-gray-200 bg-white">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">Level {i+1}</div>
                <input className="input" value={form[k] || ""} onChange={e => set(k, e.target.value)}/>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {showTelecom && (
        <div className="card space-y-3">
          <div className="section-title">Telecom — approval by discount %</div>
          <RuleRow level="L1" title={titles[0]}>
            approves discounts up to <PctInput value={form.telecom_l1_max_discount} onChange={v => set("telecom_l1_max_discount", v)}/>
          </RuleRow>
          <RuleRow level="L2" title={titles[1]}>
            approves discounts up to <PctInput value={form.telecom_l2_max_discount} onChange={v => set("telecom_l2_max_discount", v)}/>
          </RuleRow>
          <RuleRow level="L3" title={titles[2]}>
            approves any discount above {form.telecom_l2_max_discount !== "" && form.telecom_l2_max_discount != null ? `${form.telecom_l2_max_discount}%` : "Level 2's limit"}
          </RuleRow>
        </div>
      )}

      {showIct && (
        <div className="card space-y-3">
          <div className="section-title">ICT — approval by margin %</div>
          <RuleRow level="L1" title={titles[0]}>
            approves margins of at least <PctInput value={form.ict_l1_min_margin} onChange={v => set("ict_l1_min_margin", v)}/>
          </RuleRow>
          <RuleRow level="L2" title={titles[1]}>
            approves margins of at least <PctInput value={form.ict_l2_min_margin} onChange={v => set("ict_l2_min_margin", v)}/>
          </RuleRow>
          <RuleRow level="L3" title={titles[2]}>
            approves any margin below {form.ict_l2_min_margin !== "" && form.ict_l2_min_margin != null ? `${form.ict_l2_min_margin}%` : "Level 2's limit"}
          </RuleRow>
        </div>
      )}

      <div className="card space-y-3">
        <div className="section-title">Business case — Go / No-Go</div>
        <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
          <div>
            <div className="text-sm font-semibold text-gray-900">Minimum EBITDA margin to Go</div>
            <div className="text-xs text-gray-400">Earnings Before Interest, Taxes, Depreciation &amp; Amortization, as a % of revenue. Below this is a No-Go.</div>
          </div>
          <PctInput value={form.ebitda_min_pct} onChange={v => set("ebitda_min_pct", v)} min={-100}/>
        </div>
      </div>

      <button className="btn-primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        <Check size={13}/> {saveMut.isPending ? "Saving…" : "Save Pricing Approval Cycle"}
      </button>
    </div>
  )
}

// ── Section D: Bid Bond Approval Cycle (Module 1 / Sub-module D) ─────────────
// L1 → L2 → L3, then the request is emailed to the Bid Bond Issuance Office.
function BondApprovalSection() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey:["bond-approval"], queryFn:()=>companyConfigApi.getBondApproval().then(r=>r.data) })
  const [form, setForm] = useState(null)
  useEffect(() => { if (cfg) setForm({ ...cfg, office_email: cfg.office_email || "" }) }, [cfg])
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const saveMut = useMutation({
    mutationFn: () => companyConfigApi.saveBondApproval({
      l1_title: form.l1_title, l2_title: form.l2_title, l3_title: form.l3_title,
      office_name: form.office_name, office_email: form.office_email || null, auto_send: form.auto_send,
    }),
    onSuccess: () => { toast.success("Bid bond approval cycle saved"); qc.invalidateQueries({queryKey:["bond-approval"]}) },
    onError: err => toast.error(apiErrorMessage(err, "Failed to save bid bond approval cycle"))
  })

  if (!form) return null

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="section-title flex items-center gap-2"><Shield size={13}/> D — Bid Bond Approval Cycle</div>
        <div className="alert-info text-xs">
          Every bond request is approved in this order. Once the last level approves, the request is sent to the issuance office.
        </div>
        <div className="flex items-stretch gap-2">
          {["l1_title","l2_title","l3_title"].map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 && <ChevronRight size={16} className="text-gray-300 self-center flex-shrink-0"/>}
              <div className="flex-1 p-3 rounded-xl border border-gray-200 bg-white">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">Level {i+1}</div>
                <input className="input" value={form[k] || ""} onChange={e => set(k, e.target.value)}/>
              </div>
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-3 p-3 rounded-xl border border-green-200 bg-green-50">
          <Send size={15} className="text-green-700 flex-shrink-0"/>
          <div className="text-sm text-gray-700">
            Then {form.auto_send ? "sent automatically" : "sent manually"} to <strong className="text-gray-900">{form.office_name || "the issuance office"}</strong>
            {form.office_email ? <span className="text-gray-500"> · {form.office_email}</span> : null}
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="section-title">Bid Bond Issuance Office</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Office name</label>
            <input className="input" value={form.office_name || ""} onChange={e => set("office_name", e.target.value)}/>
          </div>
          <div>
            <label className="label">Office email</label>
            <input className="input" value={form.office_email} onChange={e => set("office_email", e.target.value)}
              placeholder="bonds@yourbank.com"/>
            <p className="form-hint">Separate several addresses with commas.</p>
          </div>
        </div>
        <label className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100 cursor-pointer">
          <input type="checkbox" className="accent-blue-600 w-4 h-4" checked={!!form.auto_send}
            onChange={e => set("auto_send", e.target.checked)}/>
          <div>
            <div className="text-sm font-semibold text-gray-900">Send automatically after final approval</div>
            <div className="text-xs text-gray-400">When off, someone sends it from the bond with "Send to office".</div>
          </div>
        </label>
      </div>

      <button className="btn-primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        <Check size={13}/> {saveMut.isPending ? "Saving…" : "Save Bid Bond Approval Cycle"}
      </button>
    </div>
  )
}

// ── Section 8: Bid Evaluation Q&A ────────────────────────────────────────────
function BidEvalSection() {
  const { data: templates = [] } = useQuery({
    queryKey:["eval-templates"],
    queryFn:()=>import("../services/api").then(m=>m.evalApi.getTemplates().then(r=>r.data))
  })
  return (
    <div className="card space-y-4">
      <div className="section-title flex items-center gap-2"><ClipboardList size={13}/> 8 — Bid Evaluations Questions & Associated Value</div>
      <div className="alert-info text-sm">
        Evaluation templates define the weighted criteria used to score vendor bids.
      </div>
      <div className="space-y-2">
        {templates.length===0 ? (
          <div className="text-center py-6 text-sm text-gray-400">No evaluation templates — go to Evaluations to create one</div>
        ) : templates.map(t=>(
          <div key={t.template_id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div>
              <div className="font-semibold text-sm">{t.template_name}</div>
              <div className="text-xs text-gray-400">{t.description}</div>
            </div>
            <span className="badge-blue">{t.criteria_count||0} criteria</span>
          </div>
        ))}
      </div>
      <a href="/evaluations" className="btn-secondary btn-sm inline-flex">
        <ClipboardList size={12}/> Manage Evaluation Templates
      </a>
    </div>
  )
}

// ── Section 9: EXPRO Feasibility Study ───────────────────────────────────────
function ExproFeasibilitySection() {
  return (
    <div className="card space-y-4">
      <div className="section-title flex items-center gap-2"><Microscope size={13}/> 9 — EXPRO Feasibility Study</div>
      <div className="alert-info text-sm">
        The EXPRO Feasibility Study captures Sales and Pre-Sales responsibility for each opportunity.
      </div>
      <div className="grid grid-cols-2 gap-4">
        {[
          ["Sales Information","Sales Man Name, Sales Man Initials, Title, Sector Covered","bg-blue-50 border-blue-100"],
          ["Pre-Sales Information","Pre-Sales Man Name, Pre-Sales Man Initials, Pre-Sales Title, Pre-Sales Sector Covered","bg-purple-50 border-purple-100"],
        ].map(([t,d,style])=>(
          <div key={t} className={clsx("p-4 rounded-xl border",style)}>
            <div className="font-semibold text-sm text-gray-900 mb-2">{t}</div>
            <div className="text-xs text-gray-500 space-y-1">
              {d.split(", ").map(f=><div key={f} className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0"/>{f}</div>)}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">Configure employees under Account Managers and Employees sections.</p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CompanySettingsPage() {
  const [active, setActive] = useState("1")
  const section = SECTIONS.find(s=>s.id===active)
  const Icon = section?.icon || Building2

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Company Settings</h1>
          <p className="page-subtitle">Configure your organisation's application settings</p>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left nav — 9 sections */}
        <div className="w-72 flex-shrink-0 space-y-1">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={()=>setActive(s.id)}
              className={clsx("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-all",
                active===s.id ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900")}>
              <span className={clsx("w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0",
                active===s.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500")}>
                {s.num}
              </span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0">
          {active==="1" || active==="2" ? <CompanyInfoSection/> : null}
          {active==="3" ? <RefModelSection/> : null}
          {active==="4" ? <PeopleSection type="am"/> : null}
          {active==="5" ? <PeopleSection type="bm"/> : null}
          {active==="8" ? <BidEvalSection/> : null}
          {active==="9" ? <ExproFeasibilitySection/> : null}
          {active==="B" ? <EvaluatorsSection/> : null}
          {active==="C" ? <PricingApprovalSection/> : null}
          {active==="D" ? <BondApprovalSection/> : null}
        </div>
      </div>
    </div>
  )
}
