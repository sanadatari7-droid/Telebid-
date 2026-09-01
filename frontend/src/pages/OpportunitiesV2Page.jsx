import React, { useState, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { oppsV2Api, settingsApi, usersApi, serviceCatsApi, wonRecordsApi } from "../services/api"
import { exportToExcel } from "../utils/exportUtils"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import clsx from "clsx"
import toast from "react-hot-toast"
import {
  Plus, Search, Trophy, XCircle, Clock, CheckCircle2, FileText, AlertCircle,
  Download, Eye, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw,
  Users, MessageSquare, Settings2, Microscope, UserCheck, X, Send,
  Check, MoreHorizontal, Trash2, Reply, Lock, Calendar, User, Building2, Bell
} from "lucide-react"

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  DRAFT:             "bg-gray-100 text-gray-600",
  PENDING_L1:        "bg-yellow-100 text-yellow-700",
  PENDING_L2:        "bg-orange-100 text-orange-700",
  PENDING_L3:        "bg-amber-100 text-amber-700",
  APPROVED:          "bg-green-100 text-green-700",
  CHANGES_REQUESTED: "bg-blue-100 text-blue-700",
  SUBMITTED_CUST:    "bg-indigo-100 text-indigo-700",
  WON:               "bg-emerald-100 text-emerald-700",
  LOST:              "bg-red-100 text-red-700",
  DROPPED:           "bg-gray-100 text-gray-500",
  CANCELLED:         "bg-red-50 text-red-400",
  PENDING:           "bg-yellow-50 text-yellow-600",
}
const PRIORITY_STYLE = {
  LOW:    "badge-gray",
  NORMAL: "badge-blue",
  HIGH:   "badge-amber",
  URGENT: "badge-red",
}
const SOURCES = [
  { key:"source_customer_rfp", label:"Customer RFP" },
  { key:"source_government",   label:"Government" },
  { key:"source_etimad",       label:"Etimad" },
  { key:"source_expro",        label:"EXPRO" },
  { key:"source_forsah",       label:"Forsah" },
  { key:"source_wholesales",   label:"Wholesales" },
]
const INITIAL_FORM = {
  customer_name:"", customer_name_ar:"", customer_id:"",
  customer_type:"CORPORATE", is_strategic:false,
  source_customer_rfp:false, source_government:false, source_etimad:false,
  source_expro:false, source_forsah:false, source_wholesales:false,
  project_type:"", expro_ref:"", rfp_ref:"",
  source_single:"",
  service_type:"", service_cat_l1:"", service_cat_l2:"",
  family_id:"", solution_id:"", solution_detail:"",
  media_type:"", sla_type:"", bandwidth_mbps:"", quantity:"1",
  contract_duration:"", coverage_study:"",
  nrc:"", mrc:"", tcv:"", currency_id:"1", project_size:"",
  description:"", sow_detail:"", location_text:"", attachment_url:"", notes:"",
  sales_rep_id:"", presales_id:"", bid_manager_id:"",
  presales_comments:"", sales_comments:"", bid_comments:"", finance_comments:"",
  rfp_issue_date:"", questions_deadline:"", submission_deadline:"", expected_award_date:"",
  bond_required:false, manager_id:"",
}

// ── Employee Selector ─────────────────────────────────────────────────────────
function EmpSelector({ value, onChange, label, role, placeholder }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const { data: emps = [] } = useQuery({
    queryKey: ["emps-select", role, q],
    queryFn: () => oppsV2Api.getEmployeesForSelection(role, q || undefined).then(r => r.data),
    staleTime: 30000,
  })
  const selected = emps.find(e => String(e.emp_id) === String(value) || String(e.user_id) === String(value))
  return (
    <div className="relative">
      {label && <label className="label">{label}</label>}
      <div className="relative">
        <input
          className="input pr-8"
          placeholder={placeholder || "Search by name…"}
          value={open ? q : (selected?.full_name || "")}
          onFocus={() => setOpen(true)}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
        />
        {value && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            onClick={() => { onChange(null); setQ(""); setOpen(false) }}>
            <X size={13}/>
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {emps.length === 0 ? (
            <div className="p-3 text-xs text-gray-400 text-center">No employees found</div>
          ) : emps.map(e => (
            <button key={e.emp_id} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 text-left border-b border-gray-50 last:border-0"
              onMouseDown={() => { onChange(e); setOpen(false); setQ("") }}>
              <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold flex-shrink-0">
                {e.initials || e.full_name?.slice(0,2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900">{e.full_name}</div>
                <div className="text-xs text-gray-400">{e.job_title || e.employee_type} {e.sectors_covered ? `· ${e.sectors_covered}` : ""}</div>
              </div>
              <span className="text-xs text-gray-300 flex-shrink-0">{e.initials || ""}</span>
            </button>
          ))}
        </div>
      )}
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)}/>}
    </div>
  )
}

// ── Questions Panel ───────────────────────────────────────────────────────────
function QuestionsPanel({ oppId }) {
  const qc = useQueryClient()
  const [newQ, setNewQ] = useState({ question_text:"", assigned_to:"", deadline_dt:"", priority:"NORMAL" })
  const [answerFor, setAnswerFor] = useState(null)
  const [answerText, setAnswerText] = useState("")
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ["opp-questions", oppId],
    queryFn: () => oppsV2Api.getQuestions(oppId).then(r => r.data),
    refetchInterval: 30000,
  })
  const { data: users } = useQuery({ queryKey:["users-list"], queryFn:()=>usersApi.list({page_size:200}).then(r=>r.data) })
  const userList = users?.items || []
  const addMut = useMutation({
    mutationFn: () => oppsV2Api.addQuestion(oppId, { ...newQ, assigned_to: newQ.assigned_to ? Number(newQ.assigned_to) : null }),
    onSuccess: () => { toast.success("Question added"); qc.invalidateQueries({queryKey:["opp-questions",oppId]}); setNewQ({question_text:"",assigned_to:"",deadline_dt:"",priority:"NORMAL"}) }
  })
  const answerMut = useMutation({
    mutationFn: () => oppsV2Api.answerQuestion(oppId, answerFor, { response: answerText }),
    onSuccess: () => { toast.success("Answered"); qc.invalidateQueries({queryKey:["opp-questions",oppId]}); setAnswerFor(null); setAnswerText("") }
  })
  const closeMut = useMutation({
    mutationFn: qid => oppsV2Api.closeQuestion(oppId, qid),
    onSuccess: () => { toast.success("Closed"); qc.invalidateQueries({queryKey:["opp-questions",oppId]}) }
  })
  const deleteMut = useMutation({
    mutationFn: qid => oppsV2Api.deleteQuestion(oppId, qid),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({queryKey:["opp-questions",oppId]}) }
  })

  const overdue = questions.filter(q => q.status === "OVERDUE")
  const open = questions.filter(q => q.status === "OPEN")
  const answered = questions.filter(q => q.status === "ANSWERED")
  const closed = questions.filter(q => q.status === "CLOSED")

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2">
        {[["Open", open.length, "bg-blue-50 text-blue-700 border-blue-100"],
          ["Overdue", overdue.length, "bg-red-50 text-red-700 border-red-100"],
          ["Answered", answered.length, "bg-green-50 text-green-700 border-green-100"],
          ["Closed", closed.length, "bg-gray-50 text-gray-500 border-gray-100"]].map(([l,v,style])=>(
          <div key={l} className={clsx("rounded-xl border p-3 text-center", style)}>
            <div className="text-xl font-bold">{v}</div>
            <div className="text-xs font-medium">{l}</div>
          </div>
        ))}
      </div>

      {/* Add question */}
      <div className="card-sm space-y-3">
        <div className="section-title flex items-center gap-2"><Plus size={12}/> Add Question</div>
        <div>
          <label className="label">Question *</label>
          <textarea className="input" rows={2} placeholder="Enter your question…"
            value={newQ.question_text} onChange={e=>setNewQ(p=>({...p,question_text:e.target.value}))}/>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Assign To</label>
            <select className="input" value={newQ.assigned_to} onChange={e=>setNewQ(p=>({...p,assigned_to:e.target.value}))}>
              <option value="">Unassigned</option>
              {userList.map(u=><option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Deadline</label>
            <input type="datetime-local" className="input" value={newQ.deadline_dt} onChange={e=>setNewQ(p=>({...p,deadline_dt:e.target.value}))}/>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={newQ.priority} onChange={e=>setNewQ(p=>({...p,priority:e.target.value}))}>
              {["LOW","NORMAL","HIGH","URGENT"].map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <button className="btn-primary btn-sm" disabled={!newQ.question_text.trim()||addMut.isPending} onClick={()=>addMut.mutate()}>
          <Plus size={13}/> {addMut.isPending?"Adding…":"Add Question"}
        </button>
      </div>

      {/* Question list */}
      <div className="space-y-2">
        {isLoading ? <div className="skeleton h-20"/> : questions.length === 0 ? (
          <div className="empty-state py-8">
            <div className="empty-icon mx-auto"><MessageSquare size={24}/></div>
            <p className="text-sm text-gray-400">No questions yet</p>
          </div>
        ) : questions.map(q => {
          const isOverdue = q.status === "OVERDUE"
          const daysLeft = q.days_left
          return (
            <div key={q.question_id} className={clsx("rounded-xl border p-4",
              isOverdue ? "bg-red-50 border-red-200" : q.status==="ANSWERED"?"bg-green-50 border-green-100":q.status==="CLOSED"?"bg-gray-50 border-gray-100":"bg-white border-gray-100")}>
              <div className="flex items-start gap-3">
                <div className={clsx("w-2 h-2 rounded-full mt-2 flex-shrink-0",
                  isOverdue?"bg-red-500":q.status==="ANSWERED"?"bg-green-500":q.status==="CLOSED"?"bg-gray-400":"bg-blue-500")}/>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{q.question_text}</div>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-400">
                    {q.assigned_to_name && <span className="flex items-center gap-1"><User size={11}/>{q.assigned_to_name}</span>}
                    {q.deadline_dt && (
                      <span className={clsx("flex items-center gap-1", isOverdue?"text-red-600 font-semibold":daysLeft!=null&&daysLeft<=3?"text-amber-600 font-semibold":"")}>
                        <Calendar size={11}/>{fmt(q.deadline_dt)}
                        {daysLeft!=null && (isOverdue?` (${Math.abs(daysLeft)}d overdue)`:daysLeft<=7?` (${daysLeft}d left)`:"")}
                      </span>
                    )}
                    <span className={PRIORITY_STYLE[q.priority]||"badge-gray"}>{q.priority}</span>
                  </div>
                  {q.response && (
                    <div className="mt-2 p-2.5 bg-white rounded-lg border border-gray-100 text-sm text-gray-700">
                      <div className="text-xs font-semibold text-green-600 mb-1">✓ Response</div>
                      {q.response}
                      <div className="text-xs text-gray-400 mt-1">— {q.responded_by_name} · {fmt(q.responded_at)}</div>
                    </div>
                  )}
                  {/* Answer form */}
                  {answerFor === q.question_id && (
                    <div className="mt-3 space-y-2">
                      <textarea className="input text-sm" rows={2} placeholder="Type your response…" value={answerText} onChange={e=>setAnswerText(e.target.value)}/>
                      <div className="flex gap-2">
                        <button className="btn-success btn-sm" disabled={!answerText.trim()||answerMut.isPending} onClick={()=>answerMut.mutate()}>
                          <Check size={12}/> Submit Answer
                        </button>
                        <button className="btn-ghost btn-sm" onClick={()=>{setAnswerFor(null);setAnswerText("")}}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {q.status==="OPEN"||q.status==="OVERDUE" ? (
                    <button className="btn-ghost btn-sm" title="Answer" onClick={()=>{setAnswerFor(q.question_id);setAnswerText("")}}>
                      <Reply size={13}/>
                    </button>
                  ) : null}
                  {q.status!=="CLOSED" && (
                    <button className="btn-ghost btn-sm text-gray-400" title="Close" onClick={()=>closeMut.mutate(q.question_id)}>
                      <Lock size={12}/>
                    </button>
                  )}
                  <button className="btn-ghost btn-sm text-red-400 hover:text-red-600" title="Delete" onClick={()=>deleteMut.mutate(q.question_id)}>
                    <Trash2 size={12}/>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Feasibility Panel ─────────────────────────────────────────────────────────
function FeasibilityPanel({ oppId }) {
  const qc = useQueryClient()
  const { data: feas } = useQuery({ queryKey:["feasibility",oppId], queryFn:()=>oppsV2Api.getFeasibility(oppId).then(r=>r.data), retry:false })
  const [form, setForm] = useState(null)
  const [salesEmp, setSalesEmp] = useState(null)
  const [psEmp, setPsEmp] = useState(null)
  const [editing, setEditing] = useState(false)

  React.useEffect(() => {
    if (feas && !form) setForm({
      sales_emp_id: feas.sales_emp_id, presales_emp_id: feas.presales_emp_id,
      sales_notes: feas.sales_notes || "", presales_notes: feas.presales_notes || "",
      feasibility_status: feas.feasibility_status || "PENDING",
      feasibility_notes: feas.feasibility_notes || ""
    })
  }, [feas])

  const saveMut = useMutation({
    mutationFn: () => oppsV2Api.saveFeasibility(oppId, {
      ...form,
      sales_emp_id: salesEmp?.emp_id || form?.sales_emp_id,
      presales_emp_id: psEmp?.emp_id || form?.presales_emp_id,
    }),
    onSuccess: () => { toast.success("Feasibility saved"); qc.invalidateQueries({queryKey:["feasibility",oppId]}); setEditing(false) }
  })

  const FEAS_STATUS = [
    ["PENDING","Pending","bg-gray-100 text-gray-600"],
    ["FEASIBLE","Feasible","bg-green-100 text-green-700"],
    ["NOT_FEASIBLE","Not Feasible","bg-red-100 text-red-700"],
    ["PARTIAL","Partial","bg-amber-100 text-amber-700"],
  ]

  const current = feas || {}
  const statusStyle = FEAS_STATUS.find(s=>s[0]===current.feasibility_status) || FEAS_STATUS[0]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title mb-0 flex items-center gap-2"><Microscope size={13}/> EXPRO Feasibility Study — Section 9</div>
        <button className="btn-secondary btn-sm" onClick={()=>setEditing(!editing)}>
          {editing ? "Cancel" : <><Settings2 size={13}/> Edit</>}
        </button>
      </div>

      {/* Feasibility Status */}
      {!editing && (
        <div className={clsx("inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium", statusStyle[2])}>
          <Microscope size={13}/>
          Feasibility: {statusStyle[1]}
        </div>
      )}

      {/* Side-by-side Sales & Pre-Sales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sales */}
        <div className="card-sm">
          <div className="section-title flex items-center gap-2 text-blue-600"><UserCheck size={12}/> Sales</div>
          {editing ? (
            <div className="space-y-3">
              <EmpSelector
                label="Sales Person"
                value={form?.sales_emp_id}
                role="SALES"
                onChange={e => { setSalesEmp(e); setForm(p=>({...p, sales_emp_id:e?.emp_id})) }}
                placeholder="Search sales employee…"
              />
              {(salesEmp || current.sales_name) && (
                <div className="p-3 bg-blue-50 rounded-xl text-xs space-y-1">
                  <div><span className="font-semibold">Name:</span> {salesEmp?.full_name || current.sales_name}</div>
                  <div><span className="font-semibold">Initials:</span> {salesEmp?.initials || current.sales_initials || "—"}</div>
                  <div><span className="font-semibold">Title:</span> {salesEmp?.job_title || current.sales_title || "—"}</div>
                  <div><span className="font-semibold">Sectors:</span> {salesEmp?.sectors_covered || current.sales_sectors || "—"}</div>
                </div>
              )}
              <div>
                <label className="label">Sales Notes</label>
                <textarea className="input" rows={2} value={form?.sales_notes||""} onChange={e=>setForm(p=>({...p,sales_notes:e.target.value}))}/>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {current.sales_name ? (
                <>
                  <InfoRow label="Name" value={current.sales_name}/>
                  <InfoRow label="Initials" value={current.sales_initials}/>
                  <InfoRow label="Title" value={current.sales_title}/>
                  <InfoRow label="Sectors" value={current.sales_sectors}/>
                  {current.sales_notes && <InfoRow label="Notes" value={current.sales_notes}/>}
                </>
              ) : <div className="text-gray-400 text-xs text-center py-4">No sales assigned</div>}
            </div>
          )}
        </div>

        {/* Pre-Sales */}
        <div className="card-sm">
          <div className="section-title flex items-center gap-2 text-purple-600"><UserCheck size={12}/> Pre-Sales</div>
          {editing ? (
            <div className="space-y-3">
              <EmpSelector
                label="Pre-Sales Person"
                value={form?.presales_emp_id}
                role="PRESALES"
                onChange={e => { setPsEmp(e); setForm(p=>({...p, presales_emp_id:e?.emp_id})) }}
                placeholder="Search pre-sales employee…"
              />
              {(psEmp || current.presales_name) && (
                <div className="p-3 bg-purple-50 rounded-xl text-xs space-y-1">
                  <div><span className="font-semibold">Name:</span> {psEmp?.full_name || current.presales_name}</div>
                  <div><span className="font-semibold">Initials:</span> {psEmp?.initials || current.presales_initials || "—"}</div>
                  <div><span className="font-semibold">Title:</span> {psEmp?.job_title || current.presales_title || "—"}</div>
                  <div><span className="font-semibold">Sectors:</span> {psEmp?.sectors_covered || current.presales_sectors || "—"}</div>
                </div>
              )}
              <div>
                <label className="label">Pre-Sales Notes</label>
                <textarea className="input" rows={2} value={form?.presales_notes||""} onChange={e=>setForm(p=>({...p,presales_notes:e.target.value}))}/>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {current.presales_name ? (
                <>
                  <InfoRow label="Name" value={current.presales_name}/>
                  <InfoRow label="Initials" value={current.presales_initials}/>
                  <InfoRow label="Title" value={current.presales_title}/>
                  <InfoRow label="Sectors" value={current.presales_sectors}/>
                  {current.presales_notes && <InfoRow label="Notes" value={current.presales_notes}/>}
                </>
              ) : <div className="text-gray-400 text-xs text-center py-4">No pre-sales assigned</div>}
            </div>
          )}
        </div>
      </div>

      {/* Feasibility Outcome */}
      {editing && (
        <div className="card-sm space-y-3">
          <div className="section-title">Feasibility Outcome</div>
          <div>
            <label className="label">Status</label>
            <div className="grid grid-cols-4 gap-2">
              {FEAS_STATUS.map(([v,l,s])=>(
                <button key={v} onClick={()=>setForm(p=>({...p,feasibility_status:v}))}
                  className={clsx("p-2.5 rounded-xl text-xs font-semibold border text-center transition-all",
                    form?.feasibility_status===v ? s+" border-current" : "bg-white text-gray-400 border-gray-200 hover:bg-gray-50")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Feasibility Notes</label>
            <textarea className="input" rows={3} value={form?.feasibility_notes||""} onChange={e=>setForm(p=>({...p,feasibility_notes:e.target.value}))} placeholder="Overall feasibility assessment…"/>
          </div>
          <button className="btn-primary btn-sm" disabled={saveMut.isPending} onClick={()=>saveMut.mutate()}>
            <Check size={13}/> {saveMut.isPending?"Saving…":"Save Feasibility Study"}
          </button>
        </div>
      )}

      {!editing && current.feasibility_notes && (
        <div className="card-sm">
          <div className="section-title">Feasibility Notes</div>
          <p className="text-sm text-gray-700">{current.feasibility_notes}</p>
        </div>
      )}
    </div>
  )
}

// ── Ref Config Modal ──────────────────────────────────────────────────────────
function RefConfigModal({ onClose }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey:["ref-config"], queryFn:()=>oppsV2Api.getRefConfig().then(r=>r.data) })
  const [form, setForm] = useState(null)
  const [preview, setPreview] = useState("")
  React.useEffect(() => { if (cfg && !form) setForm({...cfg}) }, [cfg])

  const fc = (k, v) => setForm(p => ({...p, [k]:v}))

  React.useEffect(() => {
    if (!form) return
    oppsV2Api.previewRef({ config: form, presales_initials:"SA", customer_id:"12345" })
      .then(r => setPreview(r.data.preview)).catch(()=>{})
  }, [form])

  const saveMut = useMutation({
    mutationFn: () => oppsV2Api.saveRefConfig(form),
    onSuccess: () => { toast.success("Config saved"); qc.invalidateQueries({queryKey:["ref-config"]}); onClose() }
  })

  if (!form) return null
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="font-bold text-gray-900">Customer Reference Config</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure how references are generated</p>
          </div>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Company Initials */}
          <div>
            <label className="label">Company Initials</label>
            <div className="flex gap-2">
              <input className="input" value={form.company_initials||""} onChange={e=>fc("company_initials",e.target.value)} placeholder="e.g. SLM"/>
              <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                <input type="checkbox" checked={!!form.use_company_initials} onChange={e=>fc("use_company_initials",e.target.checked)} className="w-4 h-4 accent-blue-600"/>
                <span className="text-sm text-gray-700">Include</span>
              </label>
            </div>
          </div>
          {/* Components */}
          <div className="space-y-2">
            <label className="label">Reference Components</label>
            {[
              ["use_presales_initials","Pre-Sales Initials","Example: SA"],
              ["use_cash","CASH label","Fixed text"],
              ["use_customer_id","Customer ID","From customer field"],
            ].map(([key,label,hint])=>(
              <label key={key} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50">
                <div>
                  <div className="text-sm font-medium text-gray-900">{label}</div>
                  <div className="text-xs text-gray-400">{hint}</div>
                </div>
                <input type="checkbox" checked={!!form[key]} onChange={e=>fc(key,e.target.checked)} className="w-4 h-4 accent-blue-600"/>
              </label>
            ))}
          </div>
          {/* Cash label if enabled */}
          {form.use_cash && (
            <div>
              <label className="label">Cash Label</label>
              <input className="input" value={form.cash_label||"CASH"} onChange={e=>fc("cash_label",e.target.value)}/>
            </div>
          )}
          {/* Separator */}
          <div>
            <label className="label">Separator</label>
            <div className="flex gap-2">
              {["-","/","_","."].map(s=>(
                <button key={s} onClick={()=>fc("separator",s)}
                  className={clsx("px-4 py-2 rounded-xl border text-sm font-mono font-bold",
                    form.separator===s?"bg-blue-600 text-white border-blue-600":"bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
                  {s}
                </button>
              ))}
              <input className="input flex-1 font-mono" value={form.separator||"-"} onChange={e=>fc("separator",e.target.value)} maxLength={3}/>
            </div>
          </div>
          {/* Preview */}
          <div className="bg-blue-50 rounded-xl p-3">
            <div className="text-xs font-semibold text-blue-600 mb-1">Preview</div>
            <div className="font-mono text-lg font-bold text-blue-800">{preview || "—"}</div>
            <div className="text-xs text-blue-500 mt-0.5">Example with PS=SA, Customer=12345</div>
          </div>
          {/* Unique */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!form.require_unique} onChange={e=>fc("require_unique",e.target.checked)} className="w-4 h-4 accent-blue-600"/>
            <span className="text-sm text-gray-700">Require unique references (prevent duplicates)</span>
          </label>
        </div>
        <div className="flex gap-3 justify-end p-5 border-t">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saveMut.isPending} onClick={()=>saveMut.mutate()}>
            <Check size={13}/> {saveMut.isPending?"Saving…":"Save Config"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── InfoRow helper ────────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 font-medium w-16 flex-shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  )
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({ oppId, onClose }) {
  const [activeTab, setActiveTab] = useState("overview")
  const qc = useQueryClient()
  const { data: detail, isLoading } = useQuery({
    queryKey: ["opp-v2-detail", oppId],
    queryFn: () => oppsV2Api.get(oppId).then(r => r.data),
  })
  const submitMut = useMutation({
    mutationFn: () => oppsV2Api.submit(oppId),
    onSuccess: () => { toast.success("Submitted for approval"); qc.invalidateQueries({queryKey:["opp-v2-detail",oppId]}); qc.invalidateQueries({queryKey:["opps-v2"]}) }
  })
  const [showApproval, setShowApproval] = useState(false)
  const [approvalForm, setApprovalForm] = useState({decision:"APPROVE",comments:"",level:null})
  const [showWon, setShowWon] = useState(false)
  const [showLost, setShowLost] = useState(false)
  const [wonForm, setWonForm] = useState({won_date:"",po_date:"",order_number:"",order_summary:"",discount_applied:"",invoice_status:"NOT_INVOICED",invoice_number:"",invoice_date:"",invoice_amount:"",payment_terms:"",bid_person_notes:""})
  const [lostForm, setLostForm] = useState({lost_date:"",loss_reason:"",loss_type:"COMPETITOR",competitor_name:"",winner_name:"",winner_tcv:"",comments:""})
  const approveMut = useMutation({
    mutationFn: () => oppsV2Api.approve(oppId, approvalForm.level, {decision:approvalForm.decision,comments:approvalForm.comments}),
    onSuccess: () => { toast.success("Decision recorded"); setShowApproval(false); qc.invalidateQueries({queryKey:["opp-v2-detail",oppId]}); qc.invalidateQueries({queryKey:["opps-v2"]}) }
  })
  const wonMut = useMutation({
    mutationFn: () => wonRecordsApi.createFromOpp(oppId, {
      won_date: wonForm.won_date,
      po_date: wonForm.po_date || null,
      order_number: wonForm.order_number || null,
      order_summary: wonForm.order_summary || null,
      discount_applied: wonForm.discount_applied ? Number(wonForm.discount_applied) : null,
      invoice_status: wonForm.invoice_status || "NOT_INVOICED",
      invoice_number: wonForm.invoice_number || null,
      invoice_date: wonForm.invoice_date || null,
      invoice_amount: wonForm.invoice_amount ? Number(wonForm.invoice_amount) : null,
      payment_terms: wonForm.payment_terms || null,
      bid_person_notes: wonForm.bid_person_notes || null,
    }),
    onSuccess: r => {
      toast.success(`🎉 Won! Record ${r.data.won_number} created`)
      setShowWon(false)
      qc.invalidateQueries({queryKey:["opps-v2"]})
      qc.invalidateQueries({queryKey:["opp-v2-detail",oppId]})
      qc.invalidateQueries({queryKey:["opps-v2-stats"]})
      onClose()
    },
    onError: e => toast.error(apiErrorMessage(e, "Failed to create WON record"))
  })
  const lostMut = useMutation({
    mutationFn: () => oppsV2Api.markLost(oppId, {...lostForm, winner_tcv:lostForm.winner_tcv?Number(lostForm.winner_tcv):null}),
    onSuccess: () => { toast.success("Marked LOST"); setShowLost(false); qc.invalidateQueries({queryKey:["opps-v2"]}); onClose() }
  })
  const bondReminderMut = useMutation({
    mutationFn: () => oppsV2Api.triggerBondReminder(oppId),
    onSuccess: r => { toast.success(r.data.message||"Bond reminder sent!"); qc.invalidateQueries({queryKey:["opp-v2-detail",oppId]}) },
    onError: e => toast.error(apiErrorMessage(e, "Failed to send reminder"))
  })

  const opp = detail?.opportunity
  const TABS = [
    { id:"overview", label:"Overview", icon: FileText },
    { id:"team", label:"Team", icon: Users },
    { id:"feasibility", label:"Feasibility", icon: Microscope },
    { id:"questions", label:`Questions${opp?.questions_open>0?` (${opp.questions_open})`:opp?.questions_count>0?` (${opp.questions_count})`:""}`, icon: MessageSquare },
    { id:"approvals", label:"Approvals", icon: CheckCircle2 },
    { id:"log", label:"Log", icon: Clock },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b flex-shrink-0">
          {isLoading ? <div className="skeleton h-8 w-48"/> : (
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-blue-600 font-bold">{opp?.opp_number}</span>
                {opp?.customer_ref && <span className="badge-indigo font-mono text-xs">{opp.customer_ref}</span>}
                <span className={clsx("badge text-xs",STATUS_STYLE[opp?.status]||"badge-gray")}>{opp?.status?.replace(/_/g," ")}</span>
                {opp?.is_strategic && <span className="badge-amber">⭐ Strategic</span>}
              </div>
              <h2 className="font-bold text-gray-900 text-lg mt-1">{opp?.customer_name}</h2>
              {opp?.customer_name_ar && <p className="text-sm text-gray-400" dir="rtl">{opp.customer_name_ar}</p>}
            </div>
          )}
          <button className="btn-ghost p-2 flex-shrink-0" onClick={onClose}><X size={16}/></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5 flex-shrink-0 overflow-x-auto">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={clsx("flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap",
                activeTab===tab.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-700")}>
              <tab.icon size={13}/>{tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="skeleton h-16"/>)}</div> : (
            <>
              {activeTab === "overview" && (
                <div className="space-y-4">
                  {/* Key fields grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    {[
                      ["EXPRO Ref", opp?.expro_ref],
                      ["RFP Ref", opp?.rfp_ref],
                      ["Customer ID", opp?.customer_id],
                      ["Customer Ref", opp?.customer_ref],
                      ["Project Type", opp?.project_type],
                      ["Solution", `${opp?.family_name||""} — ${opp?.solution_name||opp?.solution_detail||"—"}`],
                      ["Media", opp?.media_type],
                      ["SLA", opp?.sla_type],
                      ["Bandwidth", opp?.bandwidth_mbps ? `${opp.bandwidth_mbps} Mbps` : null],
                      ["NRC", opp?.nrc ? `${opp.symbol||"$"}${Number(opp.nrc).toLocaleString()}` : null],
                      ["MRC", opp?.mrc ? `${opp.symbol||"$"}${Number(opp.mrc).toLocaleString()}` : null],
                      ["TCV", opp?.tcv ? `${opp.symbol||"$"}${Number(opp.tcv).toLocaleString()}` : null],
                      ["Contract Duration", opp?.contract_duration],
                      ["Project Size", opp?.project_size],
                      ["Location", opp?.location_text],
                    ].filter(([,v])=>v).map(([k,v])=>(
                      <div key={k}>
                        <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt>
                        <dd className="font-medium mt-0.5">{v}</dd>
                      </div>
                    ))}
                  </div>
                  {/* Sources */}
                  <div>
                    <div className="section-title">RFP Sources</div>
                    <div className="flex flex-wrap gap-2">
                      {SOURCES.filter(s=>opp?.[s.key]).map(s=><span key={s.key} className="badge-blue">{s.label}</span>)}
                      {!SOURCES.some(s=>opp?.[s.key]) && <span className="text-sm text-gray-400">None selected</span>}
                    </div>
                  </div>
                  {/* Comments */}
                  {[["Pre-Sales",opp?.presales_comments,"bg-blue-50"],["Sales",opp?.sales_comments,"bg-green-50"],["Bid Manager",opp?.bid_comments,"bg-amber-50"],["Finance",opp?.finance_comments,"bg-purple-50"]].filter(([,c])=>c).map(([l,c,bg])=>(
                    <div key={l} className={clsx("p-3 rounded-xl",bg)}>
                      <div className="text-xs font-semibold text-gray-500 mb-1">{l} Comments</div>
                      <div className="text-sm">{c}</div>
                    </div>
                  ))}
                  {/* Deadlines */}
                  {detail?.deadlines?.length > 0 && (
                    <div>
                      <div className="section-title">Deadlines</div>
                      <div className="space-y-2">
                        {detail.deadlines.map(d => {
                          const dl = d.deadline_dt ? new Date(d.deadline_dt) : null
                          const dLeft = dl ? Math.ceil((dl-new Date())/(1000*60*60*24)) : null
                          return (
                            <div key={d.deadline_id} className={clsx("flex items-center justify-between p-3 rounded-xl border text-sm",
                              dLeft!=null&&dLeft<0?"bg-red-50 border-red-200":dLeft!=null&&dLeft<3?"bg-amber-50 border-amber-200":"bg-gray-50 border-gray-100")}>
                              <span className="font-medium">{d.deadline_label}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-gray-500 text-xs">{dl?fmt(dl):""}</span>
                                {dLeft!=null && <span className={clsx("font-bold text-xs",dLeft<0?"text-red-600":dLeft<3?"text-amber-600":"text-green-600")}>{dLeft<0?`${Math.abs(dLeft)}d late`:`${dLeft}d left`}</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {/* Won/Lost details */}
                  {opp?.status==="WON" && (
                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                      <div className="section-title text-emerald-700 mb-2">🎉 Won Details</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <InfoRow label="Order #" value={opp.order_number}/>
                        <InfoRow label="Won Date" value={fmt(opp.won_date)}/>
                        <InfoRow label="TCV" value={opp.tcv?`${opp.symbol||"$"}${Number(opp.tcv).toLocaleString()}`:null}/>
                        {opp.order_summary && <div className="col-span-2"><InfoRow label="Summary" value={opp.order_summary}/></div>}
                      </div>
                    </div>
                  )}
                  {opp?.status==="LOST" && (
                    <div className="p-4 bg-red-50 rounded-xl border border-red-200">
                      <div className="section-title text-red-700 mb-2">Lost Details</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <InfoRow label="Lost Date" value={fmt(opp.lost_date)}/>
                        <InfoRow label="Reason" value={opp.loss_reason}/>
                        <InfoRow label="Type" value={opp.loss_type}/>
                        <InfoRow label="Competitor" value={opp.competitor_name}/>
                        <InfoRow label="Winner" value={opp.winner_name}/>
                        <InfoRow label="Winner TCV" value={opp.winner_tcv?`${opp.symbol||"$"}${Number(opp.winner_tcv).toLocaleString()}`:null}/>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "team" && (
                <div className="space-y-3">
                  <div className="section-title">Opportunity Team Members</div>
                  {detail?.team?.length === 0 ? (
                    <div className="empty-state py-8"><div className="empty-icon mx-auto"><Users size={24}/></div><p className="text-sm text-gray-400">No team members</p></div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {detail?.team?.map(m => (
                        <div key={m.team_id} className="flex items-start gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold flex-shrink-0">
                            {m.initials || m.full_name?.slice(0,2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm text-gray-900">{m.full_name}</div>
                            <div className="text-xs text-gray-400">{m.job_title || m.role}</div>
                            {m.sectors && <div className="text-xs text-gray-400 mt-0.5">Sectors: {m.sectors}</div>}
                          </div>
                          <span className={clsx("badge text-xs flex-shrink-0",
                            m.role==="SALES"?"badge-blue":m.role==="PRESALES"?"badge-purple":m.role==="BID_MANAGER"?"badge-amber":"badge-gray")}>
                            {m.role.replace("_"," ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "feasibility" && <FeasibilityPanel oppId={oppId}/>}
              {activeTab === "questions" && <QuestionsPanel oppId={oppId}/>}

              {/* ── Bond Requirement Notice ─────────────────────── */}
              {activeTab === "overview" && opp?.bond_required && (
                <div className={clsx("p-4 rounded-xl border",
                  opp.bond_reminder_sent ? "bg-gray-50 border-gray-200" : "bg-amber-50 border-amber-200")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Bell size={16} className={opp.bond_reminder_sent?"text-gray-400":"text-amber-600"} />
                      <div>
                        <div className="font-semibold text-sm text-gray-900">
                          🔔 Bid Bond Required
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {opp.bond_reminder_sent
                            ? `Reminder sent at ${opp.bond_reminder_sent_at ? new Date(opp.bond_reminder_sent_at).toLocaleString() : "—"}`
                            : "Reminder will be sent automatically 6 days before the submission deadline."}
                        </div>
                      </div>
                    </div>
                    <button className="btn-warning btn-sm flex-shrink-0" disabled={bondReminderMut.isPending}
                      onClick={()=>bondReminderMut.mutate()}>
                      <Bell size={12}/> {bondReminderMut.isPending?"Sending…":"Send Reminder Now"}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "approvals" && (
                <div className="space-y-3">
                  <div className="section-title">Approval Chain</div>
                  {detail?.approvals?.length === 0 ? (
                    <div className="alert-info text-sm">Not yet submitted for approval</div>
                  ) : detail?.approvals?.map(a => (
                    <div key={a.approval_id} className={clsx("flex items-start gap-3 p-4 rounded-xl border",
                      a.status==="APPROVED"?"bg-green-50 border-green-200":a.status==="REJECTED"?"bg-red-50 border-red-200":a.status==="CHANGES_REQUESTED"?"bg-amber-50 border-amber-200":"bg-gray-50 border-gray-100")}>
                      <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0",
                        a.status==="APPROVED"?"bg-green-500":a.status==="REJECTED"?"bg-red-500":a.status==="CHANGES_REQUESTED"?"bg-amber-500":"bg-gray-300")}>
                        L{a.approval_level}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-sm">Level {a.approval_level} — {a.status}</div>
                        {a.approver_name && <div className="text-xs text-gray-500 mt-0.5">{a.approver_name} · {a.approver_position}</div>}
                        {a.comments && <div className="text-xs italic text-gray-600 mt-1 bg-white/60 rounded-lg p-2">"{a.comments}"</div>}
                        {a.is_locked && <div className="flex items-center gap-1 text-xs text-gray-400 mt-1"><Lock size={10}/> Locked</div>}
                      </div>
                      {a.decided_at && <div className="text-xs text-gray-400 flex-shrink-0">{fmt(a.decided_at,"dd MMM HH:mm")}</div>}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "log" && (
                <div className="space-y-1">
                  {detail?.logs?.length === 0 ? <div className="text-sm text-gray-400 text-center py-8">No activity yet</div>
                  : detail?.logs?.map(l => (
                    <div key={l.log_id} className="flex items-center gap-3 text-xs py-2 border-b border-gray-50">
                      <span className="text-gray-400 whitespace-nowrap w-28 flex-shrink-0">{fmt(l.performed_at,"dd MMM HH:mm")}</span>
                      <span className="badge-blue">{l.action}</span>
                      <span className="text-gray-600">{l.performed_by_name}</span>
                      {l.comments && <span className="text-gray-400 truncate">{l.comments}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center gap-2 p-4 border-t flex-shrink-0 flex-wrap">
          {opp?.status==="DRAFT" && (
            <button className="btn-primary btn-sm" disabled={submitMut.isPending} onClick={()=>submitMut.mutate()}>
              <Send size={13}/> Submit for Approval
            </button>
          )}
          {opp?.status?.startsWith("PENDING_L") && (
            <button className="btn-warning btn-sm" onClick={()=>{const lev=parseInt(opp.status.slice(-1)); setApprovalForm({decision:"APPROVE",comments:"",level:lev}); setShowApproval(true)}}>
              <CheckCircle2 size={13}/> Record Decision
            </button>
          )}
          {opp?.status==="APPROVED" && (
            <>
              <button className="btn-success btn-sm" onClick={()=>setShowWon(true)}><Trophy size={13}/> Won</button>
              <button className="btn-danger btn-sm" onClick={()=>setShowLost(true)}><XCircle size={13}/> Lost</button>
            </>
          )}
          <div className="flex-1"/>
          <button className="btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Approval sub-modal */}
      {showApproval && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b"><h2 className="font-bold">Level {approvalForm.level} Approval Decision</h2></div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {[["APPROVE","Approve","bg-green-500"],["REJECT","Reject","bg-red-500"],["CHANGES_REQUESTED","Changes","bg-amber-500"]].map(([v,l,c])=>(
                  <button key={v} onClick={()=>setApprovalForm(p=>({...p,decision:v}))}
                    className={clsx("p-3 rounded-xl font-semibold text-sm transition-all",
                      approvalForm.decision===v?"text-white "+c:"bg-gray-50 text-gray-500 hover:bg-gray-100")}>
                    {l}
                  </button>
                ))}
              </div>
              <div>
                <label className="label">Comments</label>
                <textarea className="input" rows={3} value={approvalForm.comments} onChange={e=>setApprovalForm(p=>({...p,comments:e.target.value}))} placeholder="Add comments…"/>
              </div>
              <div className="alert-warning text-xs">This decision will be locked and cannot be changed.</div>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary" onClick={()=>setShowApproval(false)}>Cancel</button>
                <button className="btn-primary" disabled={approveMut.isPending} onClick={()=>approveMut.mutate()}>
                  {approveMut.isPending?"Saving…":"Confirm Decision"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Won sub-modal */}
      {showWon && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b bg-emerald-50"><h2 className="font-bold text-emerald-800">🎉 Record Win</h2><p className="text-sm text-emerald-600">{opp?.customer_name}</p></div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Win Date *</label><input type="date" className="input" value={wonForm.won_date} onChange={e=>setWonForm(p=>({...p,won_date:e.target.value}))}/></div>
                <div><label className="label">Order # *</label><input className="input" value={wonForm.order_number} onChange={e=>setWonForm(p=>({...p,order_number:e.target.value}))}/></div>
              </div>
              <div><label className="label">Order Summary</label><textarea className="input" rows={2} value={wonForm.order_summary} onChange={e=>setWonForm(p=>({...p,order_summary:e.target.value}))}/></div>
              <div><label className="label">TCV</label><input type="number" className="input" value={wonForm.tcv} onChange={e=>setWonForm(p=>({...p,tcv:e.target.value}))}/></div>
              <div className="flex gap-2 justify-end pt-2">
                <button className="btn-secondary" onClick={()=>setShowWon(false)}>Cancel</button>
                <button className="btn-success" disabled={!wonForm.won_date||!wonForm.order_number||wonMut.isPending} onClick={()=>wonMut.mutate()}>
                  <Trophy size={13}/> {wonMut.isPending?"Saving…":"Confirm Win"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lost sub-modal */}
      {showLost && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b bg-red-50"><h2 className="font-bold text-red-800">Record Loss</h2><p className="text-sm text-red-600">{opp?.customer_name}</p></div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Lost Date *</label><input type="date" className="input" value={lostForm.lost_date} onChange={e=>setLostForm(p=>({...p,lost_date:e.target.value}))}/></div>
                <div><label className="label">Loss Type</label>
                  <select className="input" value={lostForm.loss_type} onChange={e=>setLostForm(p=>({...p,loss_type:e.target.value}))}>
                    {["COMPETITOR","TECHNICAL","FINANCIAL","CANCELLED"].map(v=><option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">Loss Reason *</label><input className="input" value={lostForm.loss_reason} onChange={e=>setLostForm(p=>({...p,loss_reason:e.target.value}))}/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Competitor</label><input className="input" value={lostForm.competitor_name} onChange={e=>setLostForm(p=>({...p,competitor_name:e.target.value}))}/></div>
                <div><label className="label">Winner</label><input className="input" value={lostForm.winner_name} onChange={e=>setLostForm(p=>({...p,winner_name:e.target.value}))}/></div>
              </div>
              <div><label className="label">Winner TCV</label><input type="number" className="input" value={lostForm.winner_tcv} onChange={e=>setLostForm(p=>({...p,winner_tcv:e.target.value}))}/></div>
              <div><label className="label">Comments</label><textarea className="input" rows={2} value={lostForm.comments} onChange={e=>setLostForm(p=>({...p,comments:e.target.value}))}/></div>
              <div className="flex gap-2 justify-end pt-2">
                <button className="btn-secondary" onClick={()=>setShowLost(false)}>Cancel</button>
                <button className="btn-danger" disabled={!lostForm.lost_date||!lostForm.loss_reason||lostMut.isPending} onClick={()=>lostMut.mutate()}>
                  {lostMut.isPending?"Saving…":"Confirm Loss"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create Modal ──────────────────────────────────────────────────────────────
function CreateModal({ onClose }) {
  const qc = useQueryClient()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({...INITIAL_FORM})
  const [salesEmpObj, setSalesEmpObj] = useState(null)
  const [psEmpObj, setPsEmpObj] = useState(null)
  const [errors, setErrors] = useState({})
  const [creating, setCreating] = useState(false)
  const { data: families = [] } = useQuery({ queryKey:["sol-families"], queryFn:()=>oppsV2Api.getFamilies().then(r=>r.data) })
  const { data: allSolutions = [] } = useQuery({ queryKey:["sol-types-all"], queryFn:()=>oppsV2Api.getAllSolutions().then(r=>r.data) })
  const { data: projectTypes = [] } = useQuery({ queryKey:["dd-project-type"], queryFn:()=>settingsApi.getDropdown("project_type").then(r=>r.data) })
  const { data: mediaDd = [] } = useQuery({ queryKey:["dd-media"], queryFn:()=>settingsApi.getDropdown("media_type").then(r=>r.data) })
  const { data: slaDd = [] } = useQuery({ queryKey:["dd-sla"], queryFn:()=>settingsApi.getDropdown("sla_type").then(r=>r.data) })
  const { data: sizeDd = [] } = useQuery({ queryKey:["dd-size"], queryFn:()=>settingsApi.getDropdown("project_size").then(r=>r.data) })
  const { data: lossReasonDd = [] } = useQuery({ queryKey:["dd-loss"], queryFn:()=>settingsApi.getDropdown("loss_reason").then(r=>r.data) })
  const { data: refCfg } = useQuery({ queryKey:["ref-config"], queryFn:()=>oppsV2Api.getRefConfig().then(r=>r.data) })
  const { data: users } = useQuery({ queryKey:["users-list"], queryFn:()=>usersApi.list({page_size:200}).then(r=>r.data) })
  const userList = users?.items || []

  const filteredSolutions = allSolutions.filter(s => !form.family_id || String(s.family_id) === String(form.family_id))
  const fc = e => { const {name,value,type,checked}=e.target; setForm(p=>({...p,[name]:type==="checkbox"?checked:value})); setErrors(p=>({...p,[name]:null})) }

  const validate = () => {
    const e = {}
    if (!form.customer_name.trim()) e.customer_name = "Customer name is required"
    if (!form.submission_deadline) e.submission_deadline = "Submission deadline is required"
    if (form.questions_deadline && form.submission_deadline && new Date(form.questions_deadline) > new Date(form.submission_deadline))
      e.questions_deadline = "Questions deadline cannot be after submission deadline"
    if (form.rfp_issue_date && form.submission_deadline && new Date(form.rfp_issue_date) > new Date(form.submission_deadline))
      e.rfp_issue_date = "RFP issue date cannot be after submission deadline"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleCreate = async () => {
    if (!validate()) return
    setCreating(true)
    try {
      const payload = {
        ...form,
        family_id: form.family_id ? Number(form.family_id) : null,
        solution_id: form.solution_id ? Number(form.solution_id) : null,
        sales_rep_id: salesEmpObj?.user_id || (form.sales_rep_id ? Number(form.sales_rep_id) : null),
        presales_id: psEmpObj?.user_id || (form.presales_id ? Number(form.presales_id) : null),
        bid_manager_id: form.bid_manager_id ? Number(form.bid_manager_id) : null,
        bond_required: !!form.bond_required,
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        currency_id: Number(form.currency_id)||1,
        quantity: Number(form.quantity)||1,
        bandwidth_mbps: form.bandwidth_mbps ? Number(form.bandwidth_mbps) : null,
        nrc: form.nrc ? Number(form.nrc) : null,
        mrc: form.mrc ? Number(form.mrc) : null,
        tcv: form.tcv ? Number(form.tcv) : null,
      }
      // Untouched optional date/number inputs land here as "" rather than being
      // omitted — the backend's Optional[date]/Optional[int] fields reject "" as
      // an invalid date/integer (only null or a real value is accepted).
      for (const k of Object.keys(payload)) {
        if (payload[k] === "") payload[k] = null
      }
      const res = await oppsV2Api.create(payload)
      toast.success(`Opportunity created! Ref: ${res.data.customer_ref || res.data.opp_number}`)
      qc.invalidateQueries({queryKey:["opps-v2"]})
      qc.invalidateQueries({queryKey:["opps-v2-stats"]})
      onClose()
    } catch(e) {
      toast.error(apiErrorMessage(e, "Failed to create"))
    } finally { setCreating(false) }
  }

  const STEPS = ["Customer & Source","Solution","Team","Deadlines"]

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-gray-900">New Opportunity / RFP</h2>
            <div className="flex items-center gap-2 mt-2">
              {STEPS.map((s,i)=>(
                <React.Fragment key={i}>
                  <div className={clsx("step-dot text-xs",step>i?"step-dot-done":step===i+1?"step-dot-active":"step-dot-idle")}>{step>i?"✓":i+1}</div>
                  {i<STEPS.length-1 && <div className={clsx("step-line w-8",step>i+1?"bg-blue-600":"bg-gray-100")}/>}
                </React.Fragment>
              ))}
              <span className="text-xs text-gray-400 ml-2">{STEPS[step-1]}</span>
            </div>
          </div>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="p-5">
          {/* STEP 1: Customer & Source */}
          {step===1 && (
            <div className="space-y-4">
              <div className="section-title">Customer Information</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label label-required">Customer Name</label>
                  <input name="customer_name" className={clsx("input",errors.customer_name&&"input-error")} value={form.customer_name} onChange={fc} placeholder="e.g. Saudi Aramco"/>
                  {errors.customer_name && <p className="form-error">{errors.customer_name}</p>}
                </div>
                <div>
                  <label className="label">Customer Name (Arabic)</label>
                  <input name="customer_name_ar" className="input" value={form.customer_name_ar} onChange={fc} dir="rtl" placeholder="اسم العميل"/>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Customer ID</label>
                  <input name="customer_id" className="input" value={form.customer_id} onChange={fc}/>
                  {refCfg && (
                    <p className="form-hint">Used to build customer ref: <strong className="font-mono">{[refCfg.use_company_initials&&refCfg.company_initials,refCfg.use_presales_initials&&"[PS]",refCfg.use_cash&&refCfg.cash_label,refCfg.use_customer_id&&"[ID]"].filter(Boolean).join(refCfg.separator||"-")}</strong></p>
                  )}
                </div>
                <div>
                  <label className="label">Customer Type</label>
                  <select name="customer_type" className="input" value={form.customer_type} onChange={fc}>
                    <option value="CORPORATE">Corporate</option>
                    <option value="GOVERNMENT">Government</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" name="is_strategic" checked={form.is_strategic} onChange={fc} className="w-4 h-4 accent-blue-600"/>
                <span className="text-sm font-medium text-gray-700">⭐ Strategic Account</span>
              </label>

              <div className="section-title mt-2">RFP Source <span className="text-gray-400 font-normal normal-case">(select one)</span></div>
              <div className="alert-info text-xs mb-2">Check Box — only one item can be chosen</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {["Etimad","Email","Client","Portal"].map(src=>(
                  <label key={src} className={clsx("flex items-center gap-2 p-3 border rounded-xl cursor-pointer transition-all",
                    form.source_single===src.toUpperCase()?"bg-blue-50 border-blue-400":"hover:bg-gray-50 border-gray-200")}>
                    <input type="radio" name="source_single" value={src.toUpperCase()} checked={form.source_single===src.toUpperCase()}
                      onChange={fc} className="w-4 h-4 accent-blue-600"/>
                    <span className="text-sm font-medium">{src}</span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">EXPRO Reference #</label>
                  <input name="expro_ref" className="input" value={form.expro_ref} onChange={fc}/>
                </div>
                <div>
                  <label className="label">RFP / Bid Reference</label>
                  <input name="rfp_ref" className="input" value={form.rfp_ref} onChange={fc}/>
                </div>
              </div>
              <div>
                <label className="label">Project Type</label>
                <select name="project_type" className="input" value={form.project_type} onChange={fc}>
                  <option value="">Select…</option>
                  {projectTypes.map(p=><option key={p.option_value} value={p.option_value}>{p.option_label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* STEP 2: Solution */}
          {step===2 && (
            <div className="space-y-4">
              <div className="section-title">Solution & Technical Details</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Solution Family</label>
                  <select name="family_id" className="input" value={form.family_id} onChange={e=>{fc(e);setForm(p=>({...p,solution_id:""}))}}>
                    <option value="">All Families</option>
                    {families.map(f=><option key={f.family_id} value={f.family_id}>{f.family_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Solution Type</label>
                  <select name="solution_id" className="input" value={form.solution_id} onChange={fc}>
                    <option value="">Select…</option>
                    {filteredSolutions.map(s=><option key={s.solution_id} value={s.solution_id}>{s.solution_name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">SOW / Solution Detail</label>
                <textarea name="sow_detail" className="input" rows={2} value={form.sow_detail} onChange={fc} placeholder="Describe scope of work…"/>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Media Type</label>
                  <select name="media_type" className="input" value={form.media_type} onChange={fc}>
                    <option value="">Select…</option>
                    {mediaDd.map(m=><option key={m.option_value} value={m.option_value}>{m.option_label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">SLA</label>
                  <select name="sla_type" className="input" value={form.sla_type} onChange={fc}>
                    <option value="">Select…</option>
                    {slaDd.map(s=><option key={s.option_value} value={s.option_value}>{s.option_label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">Bandwidth (Mbps)</label><input name="bandwidth_mbps" type="number" className="input" value={form.bandwidth_mbps} onChange={fc}/></div>
                <div><label className="label">Quantity</label><input name="quantity" type="number" className="input" value={form.quantity} onChange={fc} min="1"/></div>
                <div><label className="label">Contract Duration</label><input name="contract_duration" className="input" value={form.contract_duration} onChange={fc} placeholder="e.g. 3 Years"/></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">NRC</label><input name="nrc" type="number" className="input" value={form.nrc} onChange={fc}/></div>
                <div><label className="label">MRC</label><input name="mrc" type="number" className="input" value={form.mrc} onChange={fc}/></div>
                <div><label className="label">TCV</label><input name="tcv" type="number" className="input" value={form.tcv} onChange={fc}/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Project Size</label>
                  <select name="project_size" className="input" value={form.project_size} onChange={fc}>
                    <option value="">Select…</option>
                    {sizeDd.map(s=><option key={s.option_value} value={s.option_value}>{s.option_label}</option>)}
                  </select>
                </div>
                <div><label className="label">Coverage Study</label><input name="coverage_study" className="input" value={form.coverage_study} onChange={fc}/></div>
              </div>
              <div><label className="label">Location</label><input name="location_text" className="input" value={form.location_text} onChange={fc}/></div>
              <div><label className="label">Attachment URL</label><input name="attachment_url" className="input" value={form.attachment_url} onChange={fc} placeholder="https://…"/></div>
            </div>
          )}

          {/* STEP 3: Team (with EmpSelector for Sales & Pre-Sales) */}
          {step===3 && (
            <div className="space-y-5">
              {/* Sales */}
              <div className="card-sm border-blue-100">
                <div className="section-title text-blue-600 flex items-center gap-2"><UserCheck size={12}/> Sales Representative</div>
                <EmpSelector
                  label="Sales Person (select by full name)"
                  role="SALES"
                  value={salesEmpObj?.emp_id || form.sales_rep_id}
                  onChange={e => { setSalesEmpObj(e); setForm(p=>({...p, sales_rep_id: e?.user_id||""})) }}
                />
                {salesEmpObj && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div><label className="label">Initials</label><input className="input bg-gray-50" value={salesEmpObj.initials||""} readOnly/></div>
                    <div><label className="label">Title</label><input className="input bg-gray-50" value={salesEmpObj.job_title||""} readOnly/></div>
                    <div><label className="label">Sectors</label><input className="input bg-gray-50" value={salesEmpObj.sectors_covered||""} readOnly/></div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="label">Sales Comments</label>
                  <textarea name="sales_comments" className="input" rows={2} value={form.sales_comments} onChange={fc}/>
                </div>
              </div>

              {/* Pre-Sales */}
              <div className="card-sm border-purple-100">
                <div className="section-title text-purple-600 flex items-center gap-2"><UserCheck size={12}/> Pre-Sales</div>
                <EmpSelector
                  label="Pre-Sales Person (select by full name)"
                  role="PRESALES"
                  value={psEmpObj?.emp_id || form.presales_id}
                  onChange={e => { setPsEmpObj(e); setForm(p=>({...p, presales_id: e?.user_id||""})) }}
                />
                {psEmpObj && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div><label className="label">Initials</label><input className="input bg-gray-50" value={psEmpObj.initials||""} readOnly/></div>
                    <div><label className="label">Title</label><input className="input bg-gray-50" value={psEmpObj.job_title||""} readOnly/></div>
                    <div><label className="label">Sectors</label><input className="input bg-gray-50" value={psEmpObj.sectors_covered||""} readOnly/></div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="label">Pre-Sales Comments</label>
                  <textarea name="presales_comments" className="input" rows={2} value={form.presales_comments} onChange={fc}/>
                </div>
              </div>

              {/* Bid Manager comments */}
              <div className="card-sm">
                <div className="section-title">Additional Comments</div>
                <div className="space-y-3">
                  <div><label className="label">Bid Manager Comments</label><textarea name="bid_comments" className="input" rows={2} value={form.bid_comments} onChange={fc}/></div>
                  <div><label className="label">Finance Comments</label><textarea name="finance_comments" className="input" rows={2} value={form.finance_comments} onChange={fc}/></div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Deadlines */}
          {step===4 && (
            <div className="space-y-4">
              <div className="section-title">Deadlines</div>
              <div className="alert-warning text-xs">Submission deadline is required. Questions deadline must be before submission deadline.</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">RFP Issue Date</label>
                  <input name="rfp_issue_date" type="date" className={clsx("input",errors.rfp_issue_date&&"input-error")} value={form.rfp_issue_date} onChange={fc}/>
                  {errors.rfp_issue_date && <p className="form-error">{errors.rfp_issue_date}</p>}
                </div>
                <div>
                  <label className="label">Questions Deadline</label>
                  <input name="questions_deadline" type="datetime-local" className={clsx("input",errors.questions_deadline&&"input-error")} value={form.questions_deadline} onChange={fc}/>
                  {errors.questions_deadline && <p className="form-error">{errors.questions_deadline}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label label-required">Submission Deadline</label>
                  <input name="submission_deadline" type="datetime-local" className={clsx("input",errors.submission_deadline&&"input-error")} value={form.submission_deadline} onChange={fc}/>
                  {errors.submission_deadline && <p className="form-error">{errors.submission_deadline}</p>}
                </div>
                <div>
                  <label className="label">Expected Award Date</label>
                  <input name="expected_award_date" type="date" className="input" value={form.expected_award_date} onChange={fc}/>
                </div>
              </div>
              {/* ── BID BOND QUESTION ───────────────────────────────── */}
              <div className="card-sm border-amber-100 bg-amber-50/50">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-bold text-gray-900">Is a Bid Bond Required?</div>
                    <div className="text-xs text-gray-500 mt-1">
                      If yes, a reminder will be sent to the bid person and their manager
                      <strong> 6 days before the submission deadline</strong> to request the bond.
                    </div>
                  </div>
                  <label className="flex-shrink-0 flex items-center gap-2 cursor-pointer">
                    <span className="text-sm font-semibold text-gray-700">{form.bond_required?"Yes":"No"}</span>
                    <button type="button"
                      onClick={()=>setForm(p=>({...p,bond_required:!p.bond_required}))}
                      className={clsx("relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none",
                        form.bond_required?"bg-amber-500":"bg-gray-200")}>
                      <span className={clsx("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200",
                        form.bond_required?"translate-x-6":"translate-x-0.5")}/>
                    </button>
                  </label>
                </div>
                {form.bond_required && (
                  <div className="mt-3 pt-3 border-t border-amber-200">
                    <div className="alert-warning text-xs mb-3">
                      ⚠️ Bond reminder will be sent automatically 6 days before submission deadline to the bid person and manager.
                    </div>
                    <div>
                      <label className="label">Manager to Notify (for bond reminder)</label>
                      <select name="manager_id" className="input" value={form.manager_id} onChange={fc}>
                        <option value="">Select manager…</option>
                        {userList.map(u=><option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                      </select>
                      <p className="form-hint">This manager will receive a copy of the bond reminder email.</p>
                    </div>
                  </div>
                )}
              </div>

              <div><label className="label">General Description</label><textarea name="description" className="input" rows={3} value={form.description} onChange={fc}/></div>
              <div><label className="label">Notes</label><textarea name="notes" className="input" rows={2} value={form.notes} onChange={fc}/></div>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-between mt-6 pt-4 border-t">
            <div>{step>1 && <button className="btn-secondary" onClick={()=>setStep(p=>p-1)}>← Back</button>}</div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              {step<4 ? (
                <button className="btn-primary" onClick={()=>setStep(p=>p+1)}>Next →</button>
              ) : (
                <button className="btn-primary" disabled={creating} onClick={handleCreate}>
                  {creating ? "Creating…" : "Create Opportunity"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function OpportunitiesV2Page() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showRefConfig, setShowRefConfig] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["opps-v2", page, search, statusFilter],
    queryFn: () => oppsV2Api.list({ page, page_size:20, search:search||undefined, status:statusFilter||undefined }).then(r=>r.data),
    retry:1,
  })
  const { data: stats } = useQuery({ queryKey:["opps-v2-stats"], queryFn:()=>oppsV2Api.dashboardStats().then(r=>r.data), retry:1 })
  const os = stats?.stats || {}
  const items = data?.items || []

  const handleExport = () => {
    exportToExcel(items, [
      {header:"Opp #",key:"opp_number"},{header:"Customer Ref",key:"customer_ref"},
      {header:"Customer",key:"customer_name"},{header:"EXPRO Ref",key:"expro_ref"},
      {header:"RFP Ref",key:"rfp_ref"},{header:"Solution",key:"solution_name"},
      {header:"TCV",key:"tcv"},{header:"Sales Rep",key:"sales_rep_name"},
      {header:"Pre-Sales",key:"presales_name"},{header:"Status",key:"status"},
      {header:"Submission Deadline",accessor:r=>r.submission_deadline?fmt(r.submission_deadline):""},
    ], "opportunities")
    toast.success("Exported to Excel")
  }

  const KPI_CARDS = [
    { label:"Total",    value:os.total||0,           color:"bg-blue-600" },
    { label:"Pending",  value:os.pending_approval||0, color:"bg-amber-500" },
    { label:"Approved", value:os.approved||0,         color:"bg-green-600" },
    { label:"Won 🎉",   value:os.won||0,              color:"bg-emerald-600" },
    { label:"Lost",     value:os.lost||0,             color:"bg-red-500" },
    { label:"Win Rate", value:os.win_rate!=null?`${os.win_rate}%`:"—", color:"bg-purple-600" },
  ]

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">RFP & Opportunity Management</h1>
          <p className="page-subtitle">EXPRO Bid & Opportunity Tracking with Feasibility Studies</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost btn-sm" onClick={()=>setShowRefConfig(true)}><Settings2 size={13}/> Ref Config</button>
          <button className="btn-secondary btn-sm" onClick={handleExport}><Download size={13}/> Export</button>
          <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={14}/> New Opportunity</button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {KPI_CARDS.map(k=>(
          <div key={k.label} className="card-sm text-center">
            <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 text-white text-sm font-bold",k.color)}>{k.value}</div>
            <div className="text-xs font-medium text-gray-400">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Win rate bar */}
      {os.win_rate!=null && (
        <div className="card-sm flex items-center gap-4">
          <span className="text-xs font-semibold text-gray-500 w-20 flex-shrink-0">Win Rate</span>
          <div className="flex-1 progress"><div className="progress-bar bg-emerald-500" style={{width:`${os.win_rate}%`}}/></div>
          <span className="text-sm font-bold text-emerald-600 w-12 text-right">{os.win_rate}%</span>
          <span className="text-xs text-gray-400">TCV Pipeline: ${Number(os.total_tcv_pipeline||0).toLocaleString()}</span>
        </div>
      )}

      {/* Filters */}
      <div className="card-sm py-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input py-2 pl-9" placeholder="Search by customer, EXPRO ref, RFP ref, customer ref…"
              value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
          </div>
          <select className="input w-auto py-2" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1)}}>
            <option value="">All Statuses</option>
            {Object.keys(STATUS_STYLE).map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
          </select>
          <button className="btn-ghost py-2" onClick={()=>{setSearch("");setStatusFilter("");setPage(1)}}><RefreshCw size={13}/></button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Opp #</th>
                <th>Customer Ref</th>
                <th>Customer</th>
                <th>Solution</th>
                <th>TCV</th>
                <th>Sales</th>
                <th>Pre-Sales</th>
                <th>Submission</th>
                <th>Q?</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
              ) : items.length===0 ? (
                <tr><td colSpan={11} className="py-12">
                  <div className="empty-state"><div className="empty-icon mx-auto"><FileText size={28}/></div><p className="text-sm text-gray-400">No opportunities found</p></div>
                </td></tr>
              ) : items.map(o => {
                const daysLeft = o.days_to_deadline
                const dlColor = daysLeft!=null && daysLeft<0 ? "text-red-600" : daysLeft<3 ? "text-red-500" : daysLeft<7 ? "text-amber-600" : "text-green-600"
                return (
                  <tr key={o.opp_id} className="cursor-pointer" onClick={()=>setShowDetail(o.opp_id)}>
                    <td><span className="font-mono text-xs font-bold text-blue-600">{o.opp_number}</span></td>
                    <td><span className="font-mono text-xs text-gray-600">{o.customer_ref||"—"}</span></td>
                    <td>
                      <div className="font-medium text-sm max-w-[140px]">
                        <div className="truncate">{o.customer_name}</div>
                        {o.is_strategic && <span className="text-xs text-amber-500">⭐ Strategic</span>}
                      </div>
                    </td>
                    <td>
                      <div className="text-xs">
                        {o.family_name && <span className="badge-blue mb-0.5 block w-fit">{o.family_name}</span>}
                        <span className="text-gray-500 truncate block max-w-[100px]">{o.solution_name||o.solution_detail||"—"}</span>
                      </div>
                    </td>
                    <td className="font-medium text-sm whitespace-nowrap">{o.tcv?`${o.symbol||"$"}${Number(o.tcv).toLocaleString()}`:"—"}</td>
                    <td className="text-xs text-gray-600 max-w-[100px] truncate">{o.sales_rep_name||"—"}</td>
                    <td className="text-xs text-gray-600 max-w-[100px] truncate">{o.presales_name||"—"}</td>
                    <td>
                      {o.submission_deadline ? (
                        <div>
                          <div className="text-xs text-gray-500">{fmt(o.submission_deadline)}</div>
                          {daysLeft!=null && <div className={clsx("text-xs font-bold",dlColor)}>{daysLeft<0?`${Math.abs(daysLeft)}d late`:`${daysLeft}d left`}</div>}
                        </div>
                      ) : "—"}
                    </td>
                    <td>
                      {o.questions_count > 0 && (
                        <div className="text-center">
                          {o.questions_open>0 ? <span className="badge-red text-xs">{o.questions_open} open</span> : <span className="badge-green text-xs">✓ {o.questions_count}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <span className={clsx("badge text-xs",STATUS_STYLE[o.status]||"badge-gray")}>{o.status?.replace(/_/g," ")}</span>
                        {o.bond_required && (
                          <span className={clsx("badge text-xs",o.bond_reminder_sent?"badge-gray":"bg-amber-100 text-amber-700")}>
                            {o.bond_reminder_sent?"Bond ✓":"🔔 Bond"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td onClick={e=>e.stopPropagation()}>
                      <button className="btn-ghost btn-sm" onClick={()=>setShowDetail(o.opp_id)}><Eye size={13}/></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data && data.total_pages>1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">{data.total} records</span>
            <div className="flex gap-1 items-center">
              <button className="btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={13}/></button>
              <span className="text-xs text-gray-500 px-2">{page}/{data.total_pages}</span>
              <button className="btn-ghost btn-sm" disabled={page>=data.total_pages} onClick={()=>setPage(p=>p+1)}><ChevronRight size={13}/></button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateModal onClose={()=>setShowCreate(false)}/>}
      {showDetail && <DetailModal oppId={showDetail} onClose={()=>setShowDetail(null)}/>}
      {showRefConfig && <RefConfigModal onClose={()=>setShowRefConfig(false)}/>}
    </div>
  )
}
