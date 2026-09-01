import React, { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { bondsApi, oppsV2Api } from "../services/api"
import { fmt } from "../utils/fmt"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Plus, Check, X, AlertTriangle, Clock, Shield, FileText, Trash2, Eye } from "lucide-react"

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

function BondModal({ bond, onClose }) {
  const qc = useQueryClient()
  const isNew = !bond?.bond_id
  const { data: opps = [] } = useQuery({
    queryKey:["opps-v2-all"],
    queryFn:()=>oppsV2Api.list({page_size:200}).then(r=>r.data?.items||[])
  })
  const [form, setForm] = useState(bond || { opp_id:"", bond_type:"NEW_BOND", bond_number:"", bond_amount:"", issue_date:"", expiry_date:"", issuer_bank:"", beneficiary:"", notes:"" })
  const fc = e => setForm(p=>({...p,[e.target.name]:e.target.value}))

  const saveMut = useMutation({
    mutationFn: () => isNew
      ? bondsApi.create({...form, opp_id:Number(form.opp_id), bond_amount:form.bond_amount?Number(form.bond_amount):null})
      : bondsApi.update(bond.bond_id, {...form, bond_amount:form.bond_amount?Number(form.bond_amount):null}),
    onSuccess: () => { toast.success(isNew?"Bond created":"Bond updated"); qc.invalidateQueries({queryKey:["bonds"]}); onClose() }
  })

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
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
            <div><label className="label">Bond Number</label><input name="bond_number" className="input" value={form.bond_number||""} onChange={fc}/></div>
            <div><label className="label">Bond Amount</label><input name="bond_amount" type="number" className="input" value={form.bond_amount||""} onChange={fc}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Issue Date</label><input name="issue_date" type="date" className="input" value={form.issue_date||""} onChange={fc}/></div>
            <div><label className="label">Expiry Date</label><input name="expiry_date" type="date" className="input" value={form.expiry_date||""} onChange={fc}/></div>
          </div>
          <div><label className="label">Issuer Bank</label><input name="issuer_bank" className="input" value={form.issuer_bank||""} onChange={fc}/></div>
          <div><label className="label">Beneficiary</label><input name="beneficiary" className="input" value={form.beneficiary||""} onChange={fc}/></div>
          <div><label className="label">Notes</label><textarea name="notes" className="input" rows={2} value={form.notes||""} onChange={fc}/></div>
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
    onSuccess: () => { toast.success("Bond approved & issued"); qc.invalidateQueries({queryKey:["bonds"]}) }
  })
  const deleteMut = useMutation({
    mutationFn: id => bondsApi.delete(id),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({queryKey:["bonds"]}) }
  })

  const KPI = [
    { label:"Total Bonds",    val:stats?.total||0,         color:"bg-blue-600" },
    { label:"New Bonds",      val:stats?.new_bonds||0,     color:"bg-blue-500" },
    { label:"Bid Bonds",      val:stats?.bid_bonds||0,     color:"bg-amber-500" },
    { label:"Final Bonds",    val:stats?.final_bonds||0,   color:"bg-green-600" },
    { label:"Pending",        val:stats?.pending||0,       color:"bg-yellow-500" },
    { label:"Expiring Soon",  val:stats?.expiring_soon||0, color:"bg-red-500" },
  ]

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonds</h1>
          <p className="page-subtitle">New Bonds → Bid Bonds → Final Bonds</p>
        </div>
        <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={14}/> New Bond</button>
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
            <option value="">All Types</option>
            {BOND_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input w-auto py-2" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
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
                <th>Bond Type</th>
                <th>Opportunity</th>
                <th>Bond #</th>
                <th>Amount</th>
                <th>Issuer Bank</th>
                <th>Issue Date</th>
                <th>Expiry</th>
                <th>Days Left</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
              ) : bonds.length===0 ? (
                <tr><td colSpan={10} className="py-12">
                  <div className="empty-state"><div className="empty-icon mx-auto"><Shield size={28}/></div><p className="text-sm text-gray-400">No bonds found</p></div>
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
