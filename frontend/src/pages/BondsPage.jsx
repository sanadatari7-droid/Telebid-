import React, { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { bondsApi, oppsV2Api } from "../services/api"
import { fmt } from "../utils/fmt"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Plus, Check, X, AlertTriangle, Clock, Shield, FileText, Trash2, Eye } from "lucide-react"
import { useTranslation } from "react-i18next"

const BOND_TYPES = [
  { value:"NEW_BOND",   label:"New Bond",   color:"bg-blue-100 text-blue-700" },
  { value:"BID_BOND",   label:"Bid Bond",   color:"bg-amber-100 text-amber-700" },
  { value:"FINAL_BOND", label:"Final Bond", color:"bg-green-100 text-green-700" },
]
const STATUS_STYLE = {
  PENDING:   "bg-yellow-100 text-yellow-700",
  ISSUED:    "bg-green-100 text-green-700",
  EXPIRED:   "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-500",
  RELEASED:  "bg-blue-100 text-blue-700",
}

const EMPTY_BOND = {
  opp_id:"", bond_type:"NEW_BOND", bond_number:"", bond_amount:"",
  issue_date:"", expiry_date:"", issuer_bank:"", beneficiary:"", notes:"",
  bid_ref:"", bid_subject:"", beneficiary_address:"", lg_percentage:"", lg_base_value:"",
  language:"Arabic", submission_date:"", requester_name:"", recipient_name:"",
}

function BondModal({ bond, onClose }) {
  const qc = useQueryClient()
  const isNew = !bond?.bond_id
  const { data: opps = [] } = useQuery({
    queryKey:["opps-v2-all"],
    queryFn:()=>oppsV2Api.list({page_size:200}).then(r=>r.data?.items||[])
  })
  const [form, setForm] = useState(bond ? {...EMPTY_BOND, ...bond} : EMPTY_BOND)
  const fc = e => setForm(p=>({...p,[e.target.name]:e.target.value}))
  const [approverInput, setApproverInput] = useState({ business_solution:"", cbo:"" })

  const computedLg = form.lg_percentage && form.lg_base_value
    ? (Number(form.lg_base_value) * Number(form.lg_percentage) / 100)
    : null

  const saveMut = useMutation({
    mutationFn: () => isNew
      ? bondsApi.create({...form, opp_id:Number(form.opp_id), bond_amount:form.bond_amount?Number(form.bond_amount):null,
          lg_percentage:form.lg_percentage?Number(form.lg_percentage):null, lg_base_value:form.lg_base_value?Number(form.lg_base_value):null})
      : bondsApi.update(bond.bond_id, {...form, bond_amount:form.bond_amount?Number(form.bond_amount):null,
          lg_percentage:form.lg_percentage?Number(form.lg_percentage):null, lg_base_value:form.lg_base_value?Number(form.lg_base_value):null}),
    onSuccess: () => { toast.success(isNew?"Bond created":"Bond updated"); qc.invalidateQueries({queryKey:["bonds"]}); qc.invalidateQueries({queryKey:["bond-stats"]}); onClose() }
  })

  const approveMut = useMutation({
    mutationFn: ({ stage, name }) => stage === "business_solution"
      ? bondsApi.approveBusinessSolution(bond.bond_id, name)
      : bondsApi.approveCbo(bond.bond_id, name),
    onSuccess: () => { toast.success("Approval recorded"); qc.invalidateQueries({queryKey:["bonds"]}) }
  })

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-gray-900">{isNew?"New Bond":"Edit Bond"}</h2>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="p-5 space-y-4">
          {isNew && (
            <div>
              <label className="label">Opportunity *</label>
              <select name="opp_id" className="input" value={form.opp_id} onChange={fc}>
                <option value="">Select opportunity…</option>
                {opps.map(o=><option key={o.opp_id} value={o.opp_id}>{o.opp_number} — {o.customer_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Bond Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {BOND_TYPES.map(t=>(
                <button key={t.value} onClick={()=>setForm(p=>({...p,bond_type:t.value}))}
                  className={clsx("p-3 rounded-xl border text-sm font-semibold transition-all",
                    form.bond_type===t.value?t.color+" border-current":"bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Bid No. (Ref.)</label><input name="bid_ref" className="input" placeholder="e.g. SLM-RF: MAU-26-166-CP" value={form.bid_ref||""} onChange={fc}/></div>
            <div><label className="label">Bond Number</label><input name="bond_number" className="input" value={form.bond_number||""} onChange={fc}/></div>
          </div>
          <div><label className="label">Bid Subject</label><input name="bid_subject" className="input" value={form.bid_subject||""} onChange={fc}/></div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Beneficiary</label><input name="beneficiary" className="input" value={form.beneficiary||""} onChange={fc}/></div>
            <div><label className="label">Beneficiary Address</label><input name="beneficiary_address" className="input" value={form.beneficiary_address||""} onChange={fc}/></div>
          </div>

          <div className="card-sm bg-gray-50">
            <div className="section-title text-xs mb-2">L/G Value &amp; Percentage</div>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div><label className="label">Percentage %</label><input name="lg_percentage" type="number" step="0.01" className="input" placeholder="1" value={form.lg_percentage||""} onChange={fc}/></div>
              <div><label className="label">Base Value (SR)</label><input name="lg_base_value" type="number" className="input" value={form.lg_base_value||""} onChange={fc}/></div>
              <div><label className="label">Bond Amount</label>
                <input name="bond_amount" type="number" className="input" placeholder={computedLg ? computedLg.toLocaleString() : ""} value={form.bond_amount||""} onChange={fc}/>
              </div>
            </div>
            {computedLg != null && !form.bond_amount && (
              <p className="text-xs text-gray-500 mt-1.5">
                = {form.lg_percentage}% of SR {Number(form.lg_base_value).toLocaleString()} → <strong>SR {computedLg.toLocaleString()}</strong> (auto-calculated if Bond Amount is left blank)
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Submission Date</label><input name="submission_date" type="date" className="input" value={form.submission_date||""} onChange={fc}/></div>
            <div><label className="label">Issue Date</label><input name="issue_date" type="date" className="input" value={form.issue_date||""} onChange={fc}/></div>
            <div><label className="label">L/G Validity (Expiry)</label><input name="expiry_date" type="date" className="input" value={form.expiry_date||""} onChange={fc}/></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Issuer Bank</label><input name="issuer_bank" className="input" value={form.issuer_bank||""} onChange={fc}/></div>
            <div>
              <label className="label">Language</label>
              <select name="language" className="input" value={form.language||"Arabic"} onChange={fc}>
                <option value="Arabic">Arabic</option>
                <option value="English">English</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Requester (From)</label><input name="requester_name" className="input" value={form.requester_name||""} onChange={fc}/></div>
            <div><label className="label">Recipient (To)</label><input name="recipient_name" className="input" value={form.recipient_name||""} onChange={fc}/></div>
          </div>

          <div><label className="label">Notes</label><textarea name="notes" className="input" rows={2} value={form.notes||""} onChange={fc}/></div>

          {!isNew && (
            <div className="card-sm bg-blue-50 border-blue-100">
              <div className="section-title text-xs mb-2">Approval Chain</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Business Solution</label>
                  {bond.business_solution_approver ? (
                    <p className="text-sm text-green-700 font-medium">✓ {bond.business_solution_approver}</p>
                  ) : (
                    <div className="flex gap-1.5">
                      <input className="input !py-1.5" placeholder="Approver name" value={approverInput.business_solution}
                        onChange={e=>setApproverInput(p=>({...p,business_solution:e.target.value}))}/>
                      <button className="btn-secondary btn-sm" disabled={!approverInput.business_solution||approveMut.isPending}
                        onClick={()=>approveMut.mutate({stage:"business_solution", name:approverInput.business_solution})}>Record</button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">CBO</label>
                  {bond.cbo_approver ? (
                    <p className="text-sm text-green-700 font-medium">✓ {bond.cbo_approver}</p>
                  ) : (
                    <div className="flex gap-1.5">
                      <input className="input !py-1.5" placeholder="Approver name" value={approverInput.cbo}
                        onChange={e=>setApproverInput(p=>({...p,cbo:e.target.value}))}/>
                      <button className="btn-secondary btn-sm" disabled={!approverInput.cbo||approveMut.isPending}
                        onClick={()=>approveMut.mutate({stage:"cbo", name:approverInput.cbo})}>Record</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saveMut.isPending||(!form.opp_id&&isNew)} onClick={()=>saveMut.mutate()}>
              <Check size={13}/> {saveMut.isPending?"Saving…":"Save Bond"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BondsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showCreate, setShowCreate] = useState(false)
  const [editBond, setEditBond] = useState(null)
  const [typeFilter, setTypeFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  // Dashboard "Quick Actions" link here with ?new=true to jump straight into creating a bond.
  useEffect(() => {
    if (searchParams.get("new") === "true") {
      setShowCreate(true)
      setSearchParams(p => { p.delete("new"); return p }, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { data: bonds = [], isLoading } = useQuery({
    queryKey:["bonds", typeFilter, statusFilter],
    queryFn:()=>bondsApi.list({bond_type:typeFilter||undefined, status:statusFilter||undefined}).then(r=>r.data),
    retry:1,
  })
  const { data: stats } = useQuery({ queryKey:["bond-stats"], queryFn:()=>bondsApi.stats().then(r=>r.data), retry:1 })

  const approveMut = useMutation({
    mutationFn: id => bondsApi.approve(id),
    onSuccess: () => { toast.success("Bond approved & issued"); qc.invalidateQueries({queryKey:["bonds"]}); qc.invalidateQueries({queryKey:["bond-stats"]}) }
  })
  const deleteMut = useMutation({
    mutationFn: id => bondsApi.delete(id),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({queryKey:["bonds"]}); qc.invalidateQueries({queryKey:["bond-stats"]}) }
  })

  const KPI = [
    { label:t("bonds.totalBonds"),    val:stats?.total||0,         color:"bg-blue-600" },
    { label:t("bonds.newBonds"),      val:stats?.new_bonds||0,     color:"bg-blue-500" },
    { label:t("bonds.bidBonds"),      val:stats?.bid_bonds||0,     color:"bg-amber-500" },
    { label:t("bonds.finalBonds"),    val:stats?.final_bonds||0,   color:"bg-green-600" },
    { label:t("bonds.pending"),        val:stats?.pending||0,       color:"bg-yellow-500" },
    { label:t("bonds.expiringSoon"),  val:stats?.expiring_soon||0, color:"bg-red-500" },
  ]

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("bonds.pageTitle")}</h1>
          <p className="page-subtitle">{t("bonds.breadcrumb")}</p>
        </div>
        <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={14}/> {t("bonds.newBond")}</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {KPI.map(k=>(
          <div key={k.label} className="card-sm text-center">
            <div className={clsx("w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center text-white text-sm font-bold",k.color)}>{k.val}</div>
            <div className="text-xs font-medium text-gray-400">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card-sm py-3">
        <div className="flex gap-3 flex-wrap">
          <select className="input w-auto py-2" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
            <option value="">{t("bonds.allTypes")}</option>
            {BOND_TYPES.map(bt=><option key={bt.value} value={bt.value}>{bt.label}</option>)}
          </select>
          <select className="input w-auto py-2" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="">{t("bonds.allStatuses")}</option>
            {["PENDING","ISSUED","EXPIRED","CANCELLED","RELEASED"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("bonds.colBondType")}</th>
                <th>{t("bonds.colOpportunity")}</th>
                <th>{t("bonds.colBondNumber")}</th>
                <th>{t("bonds.colAmount")}</th>
                <th>{t("bonds.colIssuerBank")}</th>
                <th>{t("bonds.colIssueDate")}</th>
                <th>{t("bonds.colExpiry")}</th>
                <th>{t("bonds.colDaysLeft")}</th>
                <th>{t("bonds.colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
              ) : bonds.length===0 ? (
                <tr><td colSpan={10} className="py-12">
                  <div className="empty-state"><div className="empty-icon mx-auto"><Shield size={28}/></div><p className="text-sm text-gray-400">{t("bonds.noBondsFound")}</p></div>
                </td></tr>
              ) : bonds.map(b => {
                const typeInfo = BOND_TYPES.find(t=>t.value===b.bond_type)
                const daysLeft = b.days_to_expiry
                const expColor = daysLeft!=null&&daysLeft<0?"text-red-600":daysLeft<7?"text-amber-600":"text-gray-600"
                return (
                  <tr key={b.bond_id}>
                    <td><span className={clsx("badge",typeInfo?.color||"badge-gray")}>{typeInfo?.label||b.bond_type}</span></td>
                    <td>
                      <div className="font-mono text-xs text-blue-600">{b.opp_number}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[120px]">{b.customer_name}</div>
                    </td>
                    <td className="font-mono text-xs">{b.bond_number||"—"}</td>
                    <td className="font-medium">{b.bond_amount?`${b.symbol||"$"}${Number(b.bond_amount).toLocaleString()}`:"—"}</td>
                    <td className="text-xs text-gray-600">{b.issuer_bank||"—"}</td>
                    <td className="text-xs">{b.issue_date?fmt(b.issue_date):"—"}</td>
                    <td className="text-xs">{b.expiry_date?fmt(b.expiry_date):"—"}</td>
                    <td>
                      {daysLeft!=null && (
                        <span className={clsx("font-bold text-xs",expColor)}>
                          {daysLeft<0?`${Math.abs(daysLeft)}d expired`:`${daysLeft}d`}
                        </span>
                      )}
                    </td>
                    <td><span className={clsx("badge text-xs",STATUS_STYLE[b.status]||"badge-gray")}>{b.status}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm" onClick={()=>setEditBond(b)}><Eye size={12}/></button>
                        {b.status==="PENDING" && (
                          <button className="btn-success btn-sm" onClick={()=>approveMut.mutate(b.bond_id)} title="Approve & Issue">
                            <Check size={12}/>
                          </button>
                        )}
                        <button className="btn-ghost btn-sm text-red-400" onClick={()=>{if(window.confirm("Delete?"))deleteMut.mutate(b.bond_id)}}>
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <BondModal onClose={()=>setShowCreate(false)}/>}
      {editBond && <BondModal bond={editBond} onClose={()=>setEditBond(null)}/>}
    </div>
  )
}
