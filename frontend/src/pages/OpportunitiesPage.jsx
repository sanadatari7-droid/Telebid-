import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { oppsApi } from "../services/api"
import { useForm } from "react-hook-form"
import { fmt, fmtDT } from "../utils/fmt"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Plus, Send, ThumbsUp, ThumbsDown, ChevronRight } from "lucide-react"
import { useAuthStore } from "../store/authStore"

const STATUS_BADGE = { DRAFT:"badge-gray",SUBMITTED:"badge-amber",MANAGER_REVIEW:"badge-amber",ASSIGNED_PRESALES:"badge-blue",PRESALES_EVALUATION:"badge-purple",SALES_REVIEW:"badge-blue",GO_APPROVED:"badge-green",NO_GO_CLOSED:"badge-red",PURCHASE_PENDING:"badge-amber" }
const KANBAN = [
  { key:"DRAFT",        label:"Draft",          color:"bg-gray-50 border-gray-200" },
  { key:"SUBMITTED",    label:"Manager Review", color:"bg-amber-50 border-amber-200" },
  { key:"ASSIGNED_PRESALES",label:"Presales",   color:"bg-blue-50 border-blue-200" },
  { key:"SALES_REVIEW", label:"Go / No-Go",     color:"bg-purple-50 border-purple-200" },
  { key:"GO_APPROVED",  label:"Go ✓",           color:"bg-green-50 border-green-200" },
  { key:"NO_GO_CLOSED", label:"No-Go ✗",        color:"bg-red-50 border-red-200" },
]

export default function OpportunitiesPage() {
  const { hasRole } = useAuthStore()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState(null)
  const [comments, setComments] = useState("")
  const { register, handleSubmit, reset, formState:{errors} } = useForm()

  const { data:opps=[], isLoading } = useQuery({ queryKey:["opportunities"], queryFn:()=>oppsApi.list().then(r=>r.data) })
  const createMut = useMutation({ mutationFn:d=>oppsApi.create(d), onSuccess:()=>{ toast.success("Opportunity created — email sent to manager"); qc.invalidateQueries({queryKey:["opportunities"]}); setShowCreate(false); reset() } })
  const submitMut = useMutation({ mutationFn:id=>oppsApi.submit(id), onSuccess:()=>{ toast.success("Submitted for manager review"); qc.invalidateQueries({queryKey:["opportunities"]}) } })
  const decisionMut = useMutation({ mutationFn:({id,...d})=>oppsApi.managerDecision(id,d), onSuccess:()=>{ toast.success("Decision recorded"); qc.invalidateQueries({queryKey:["opportunities"]}); setSelected(null); setComments("") } })

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-primary-800">Opportunities</h1><p className="text-sm text-gray-500">Bid initiation and approval workflow</p></div>
        {hasRole("SALES","PROCUREMENT","ADMIN") && (
          <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={15}/> New Opportunity</button>
        )}
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {KANBAN.map(group => {
          const items = opps.filter(o => group.key==="SUBMITTED" ? ["SUBMITTED","MANAGER_REVIEW"].includes(o.status) : o.status===group.key)
          return (
            <div key={group.key} className={clsx("border rounded-xl p-3",group.color)}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">{group.label}</span>
                <span className="text-xs font-bold bg-white rounded-full px-2 py-0.5 border">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map(opp => (
                  <div key={opp.opp_id} className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={()=>setSelected(opp)}>
                    <div className="font-mono text-xs text-primary-500 font-semibold">{opp.opp_number}</div>
                    <div className="font-semibold text-xs mt-1 leading-tight line-clamp-2">{opp.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{opp.customer_name}</div>
                    <span className="badge-blue text-xs mt-2 inline-block">{opp.procurement_type}</span>
                  </div>
                ))}
                {!items.length && <div className="text-xs text-gray-300 text-center py-3">Empty</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-700">All Opportunities</h3></div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>#</th><th>Title</th><th>Type</th><th>Customer</th><th>Sales</th><th>Presales</th><th>Deadline</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={9} className="text-center py-10"><div className="inline-block animate-spin w-5 h-5 border-4 border-primary-500 border-t-transparent rounded-full"/></td></tr>
              : opps.map(opp => (
                <tr key={opp.opp_id}>
                  <td className="font-mono text-xs font-bold text-primary-600">{opp.opp_number}</td>
                  <td className="font-medium max-w-[160px] truncate">{opp.title}</td>
                  <td><span className="badge-blue">{opp.procurement_type}</span></td>
                  <td className="text-sm">{opp.customer_name}</td>
                  <td className="text-sm text-gray-500">{opp.sales_rep_name||"—"}</td>
                  <td className="text-sm text-gray-500">{opp.presales_name||"—"}</td>
                  <td className="text-xs text-gray-500">{opp.submission_deadline?fmt(opp.submission_deadline, "dd MMM yyyy"):"—"}</td>
                  <td><span className={STATUS_BADGE[opp.status]||"badge-gray"}>{opp.status.replace(/_/g," ")}</span></td>
                  <td>
                    <div className="flex gap-1">
                      {opp.status==="DRAFT" && <button className="btn-primary btn-sm" onClick={()=>submitMut.mutate(opp.opp_id)}><Send size={11}/> Submit</button>}
                      <button className="btn-ghost btn-sm" onClick={()=>setSelected(opp)}><ChevronRight size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold text-primary-800">New Opportunity</h2><button className="btn-ghost p-2" onClick={()=>setShowCreate(false)}>✕</button></div>
            <form onSubmit={handleSubmit(d=>createMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="label">Title <span className="text-red-500">*</span></label><input {...register("title",{required:true})} className="input" placeholder="Opportunity title"/></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Type <span className="text-red-500">*</span></label>
                  <select {...register("procurement_type",{required:true})} className="input">
                    <option value="">Select…</option>
                    {["TENDER","BID","RFQ","RFP","RFI"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div><label className="label">Company Ref</label>
                  <select {...register("company_ref_required")} className="input">
                    <option value="NOT_APPLICABLE">Not Applicable</option>
                    <option value="REQUIRED">Required</option>
                  </select>
                </div>
              </div>
              <div><label className="label">Customer <span className="text-red-500">*</span></label><input {...register("customer_name",{required:true})} className="input" placeholder="Customer / organization"/></div>
              <div><label className="label">Sales Rep User ID <span className="text-red-500">*</span></label><input {...register("sales_rep_id",{required:true,valueAsNumber:true})} type="number" className="input" placeholder="e.g. 2"/></div>
              <div><label className="label">Submission Deadline</label><input {...register("submission_deadline")} type="date" className="input"/></div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button type="button" className="btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={createMut.isPending}>{createMut.isPending?"Creating…":"Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail/Decision Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <div><span className="font-mono text-xs text-primary-500 font-bold">{selected.opp_number}</span><h2 className="text-lg font-bold mt-1">{selected.title}</h2></div>
              <button className="btn-ghost p-2" onClick={()=>setSelected(null)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[["Customer",selected.customer_name],["Type",selected.procurement_type],["Sales",selected.sales_rep_name||"—"],["Presales",selected.presales_name||"—"],["Status",selected.status.replace(/_/g," ")],["Step",selected.current_step]].map(([k,v])=>(
                  <div key={k}><dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt><dd className="font-medium mt-0.5">{v}</dd></div>
                ))}
              </dl>
              {["SUBMITTED","MANAGER_REVIEW"].includes(selected.status) && hasRole("DEPT_MANAGER","ADMIN") && (
                <div className="border-t pt-4 space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700">Manager Decision</h4>
                  <div><label className="label">Comments</label><textarea className="input" rows={2} value={comments} onChange={e=>setComments(e.target.value)} placeholder="Add decision comments…"/></div>
                  <div className="flex gap-3">
                    <button className="btn-primary flex-1 justify-center" disabled={decisionMut.isPending} onClick={()=>decisionMut.mutate({id:selected.opp_id,decision:"APPROVE",comments,presales_id:selected.presales_eng_id})}>
                      <ThumbsUp size={13}/> Approve & Assign Presales
                    </button>
                    <button className="btn-danger flex-1 justify-center" disabled={decisionMut.isPending} onClick={()=>decisionMut.mutate({id:selected.opp_id,decision:"REJECT",comments})}>
                      <ThumbsDown size={13}/> Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
