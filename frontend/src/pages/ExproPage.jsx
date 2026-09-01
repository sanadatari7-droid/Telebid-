import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { exproApi, bidsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Plus, FileText, CheckCircle2, Clock, XCircle, Settings, Send, Eye, Trash2 } from "lucide-react"
import { useAuthStore } from "../store/authStore"

export default function ExproPage() {
  const { hasRole } = useAuthStore()
  const qc = useQueryClient()
  const [tab, setTab] = useState("logs")
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState(null)
  const [fieldValues, setFieldValues] = useState({})
  const [selectedBidId, setSelectedBidId] = useState("")
  const [creating, setCreating] = useState(false)
  const [showAddField, setShowAddField] = useState(false)
  const [newField, setNewField] = useState({ field_key:"", field_label:"", field_type:"TEXT", is_required:false })

  const { data: logsData } = useQuery({ queryKey:["expro-logs"], queryFn:()=>exproApi.getLogs().then(r=>r.data), retry:1 })
  const { data: fieldDefs = [] } = useQuery({ queryKey:["expro-fields"], queryFn:()=>exproApi.getFieldDefs().then(r=>r.data) })
  const { data: bids } = useQuery({ queryKey:["bids-expro"], queryFn:()=>bidsApi.list({page_size:200}).then(r=>r.data) })
  const { data: logDetail } = useQuery({ queryKey:["expro-log", selected?.expro_log_id], queryFn:()=>exproApi.getLog(selected.expro_log_id).then(r=>r.data), enabled:!!selected })

  const submitMut = useMutation({ mutationFn:id=>exproApi.submitLog(id), onSuccess:()=>{ toast.success("EXPRO log submitted"); qc.invalidateQueries({queryKey:["expro-logs"]}) } })
  const reviewMut = useMutation({ mutationFn:({id,decision,notes})=>exproApi.reviewLog(id,{decision,notes}), onSuccess:()=>{ toast.success("Review recorded"); qc.invalidateQueries({queryKey:["expro-logs"]}) } })
  const addFieldMut = useMutation({ mutationFn:()=>exproApi.addFieldDef(newField), onSuccess:()=>{ toast.success("Field added"); qc.invalidateQueries({queryKey:["expro-fields"]}); setShowAddField(false); setNewField({field_key:"",field_label:"",field_type:"TEXT",is_required:false}) } })
  const delFieldMut = useMutation({ mutationFn:id=>exproApi.deleteFieldDef(id), onSuccess:()=>{ toast.success("Field removed"); qc.invalidateQueries({queryKey:["expro-fields"]}) } })

  const logs = logsData?.items || []
  const stats = { total:logs.length, draft:logs.filter(l=>l.status==="DRAFT").length, submitted:logs.filter(l=>l.status==="SUBMITTED").length, approved:logs.filter(l=>l.status==="APPROVED").length, rejected:logs.filter(l=>l.status==="REJECTED").length }

  const handleCreate = async () => {
    setCreating(true)
    try {
      await exproApi.createLog({ bid_id:selectedBidId?Number(selectedBidId):null, field_values:fieldValues })
      toast.success("EXPRO log created")
      qc.invalidateQueries({queryKey:["expro-logs"]})
      setShowCreate(false); setFieldValues({}); setSelectedBidId("")
    } catch(e){ toast.error(apiErrorMessage(e, "Failed")) }
    finally { setCreating(false) }
  }

  const statusBadge = s => { switch(s){ case"APPROVED":return"badge-green"; case"SUBMITTED":return"badge-blue"; case"REJECTED":return"badge-red"; default:return"badge-gray" }}
  const statusIcon = s => { switch(s){ case"APPROVED":return CheckCircle2; case"SUBMITTED":return Clock; case"REJECTED":return XCircle; default:return FileText }}

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-primary-800">EXPRO Log</h1><p className="text-sm text-gray-500">Oil & Gas Exploration — Government Tender Logs</p></div>
        <div className="flex gap-2">
          {hasRole("ADMIN") && <button className="btn-secondary btn-sm" onClick={()=>setTab(tab==="fields"?"logs":"fields")}><Settings size={14}/> {tab==="fields"?"View Logs":"Configure Fields"}</button>}
          <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={15}/> New EXPRO Log</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[["Total",stats.total,"bg-primary-500"],["Draft",stats.draft,"bg-gray-400"],["Submitted",stats.submitted,"bg-blue-500"],["Approved",stats.approved,"bg-green-600"],["Rejected",stats.rejected,"bg-red-500"]].map(([l,v,c])=>(
          <div key={l} className="card flex items-center gap-3">
            <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",c)}><FileText size={18} className="text-white"/></div>
            <div><div className="text-2xl font-bold text-primary-800">{v}</div><div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{l}</div></div>
          </div>
        ))}
      </div>

      {/* Field Configuration Tab */}
      {tab === "fields" && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">EXPRO Log Fields (Configurable)</h3>
            <button className="btn-primary btn-sm" onClick={()=>setShowAddField(true)}><Plus size={13}/> Add Field</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Field Key</th><th>Label</th><th>Type</th><th>Required</th><th></th></tr></thead>
            <tbody>
              {fieldDefs.map(f=>(
                <tr key={f.field_def_id}>
                  <td className="font-mono text-xs text-primary-600">{f.field_key}</td>
                  <td className="font-medium">{f.field_label}</td>
                  <td><span className="badge-blue">{f.field_type}</span></td>
                  <td>{f.is_required?<span className="badge-red">Required</span>:<span className="badge-gray">Optional</span>}</td>
                  <td><button className="btn-ghost btn-sm text-red-400" onClick={()=>delFieldMut.mutate(f.field_def_id)}><Trash2 size={12}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {showAddField && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-600 mb-3">Add New Field</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input className="input py-1.5 text-sm" placeholder="field_key" value={newField.field_key} onChange={e=>setNewField(p=>({...p,field_key:e.target.value}))}/>
                <input className="input py-1.5 text-sm" placeholder="Field Label" value={newField.field_label} onChange={e=>setNewField(p=>({...p,field_label:e.target.value}))}/>
                <select className="input py-1.5 text-sm" value={newField.field_type} onChange={e=>setNewField(p=>({...p,field_type:e.target.value}))}>
                  {["TEXT","TEXTAREA","NUMBER","DATE","BOOLEAN","DROPDOWN"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={newField.is_required} onChange={e=>setNewField(p=>({...p,is_required:e.target.checked}))} className="w-4 h-4"/> Required</label>
                  <button className="btn-primary btn-sm" disabled={!newField.field_key||!newField.field_label||addFieldMut.isPending} onClick={()=>addFieldMut.mutate()}><Plus size={12}/> Add</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Logs Tab */}
      {tab === "logs" && (
        <div className="card p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Reference</th><th>Bid</th><th>Status</th><th>Created By</th><th>Submitted</th><th>Reviewed</th><th></th></tr></thead>
              <tbody>
                {logs.length===0 ? <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm"><FileText size={32} className="mx-auto mb-2 opacity-20"/>No EXPRO logs yet</td></tr>
                : logs.map(l=>{
                  const Icon = statusIcon(l.status)
                  return (
                    <tr key={l.expro_log_id}>
                      <td className="font-mono text-xs font-bold text-primary-600">{l.log_reference}</td>
                      <td className="text-sm">{l.bid_number?<span>{l.bid_number} — {l.bid_title?.slice(0,30)}</span>:"—"}</td>
                      <td><span className={clsx("badge flex items-center gap-1",statusBadge(l.status))}><Icon size={10}/>{l.status}</span></td>
                      <td className="text-sm text-gray-500">{l.created_by_name}</td>
                      <td className="text-xs text-gray-400">{fmt(l.submitted_at)}</td>
                      <td className="text-sm text-gray-500">{l.reviewed_by_name||"—"}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn-ghost btn-sm" onClick={()=>setSelected(l)}><Eye size={13}/></button>
                          {l.status==="DRAFT" && <button className="btn-primary btn-sm" onClick={()=>submitMut.mutate(l.expro_log_id)}><Send size={11}/></button>}
                          {l.status==="SUBMITTED" && hasRole("ADMIN","DIRECTOR") && (
                            <>
                              <button className="btn-sm bg-green-500 text-white hover:bg-green-600 btn" onClick={()=>reviewMut.mutate({id:l.expro_log_id,decision:"APPROVE"})}><CheckCircle2 size={11}/></button>
                              <button className="btn-danger btn-sm" onClick={()=>reviewMut.mutate({id:l.expro_log_id,decision:"REJECT"})}><XCircle size={11}/></button>
                            </>
                          )}
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

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold text-primary-800">New EXPRO Log</h2><button className="btn-ghost p-2" onClick={()=>setShowCreate(false)}>✕</button></div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Link to Bid (Optional)</label>
                <select className="input" value={selectedBidId} onChange={e=>setSelectedBidId(e.target.value)}>
                  <option value="">No bid linked</option>
                  {(bids?.items||[]).map(b=><option key={b.bid_id} value={b.bid_id}>{b.bid_number} — {b.bid_title}</option>)}
                </select>
              </div>
              {fieldDefs.map(f=>(
                <div key={f.field_def_id}>
                  <label className="label">{f.field_label}{f.is_required&&<span className="text-red-500 ml-1">*</span>}{f.field_label_ar&&<span className="text-gray-400 text-xs ml-2">{f.field_label_ar}</span>}</label>
                  {f.field_type==="TEXTAREA"
                    ? <textarea className="input" rows={3} value={fieldValues[f.field_key]||""} onChange={e=>setFieldValues(p=>({...p,[f.field_key]:e.target.value}))}/>
                    : f.field_type==="BOOLEAN"
                    ? <select className="input" value={fieldValues[f.field_key]||""} onChange={e=>setFieldValues(p=>({...p,[f.field_key]:e.target.value}))}>
                        <option value="">Select…</option><option value="YES">Yes</option><option value="NO">No</option>
                      </select>
                    : <input type={f.field_type==="NUMBER"?"number":f.field_type==="DATE"?"date":"text"} className="input" value={fieldValues[f.field_key]||""} onChange={e=>setFieldValues(p=>({...p,[f.field_key]:e.target.value}))}/>
                  }
                </div>
              ))}
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button className="btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button className="btn-primary" disabled={creating} onClick={handleCreate}>{creating?"Creating…":"Create EXPRO Log"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail */}
      {selected && logDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b">
              <div><div className="font-mono text-xs text-primary-500 font-bold">{logDetail.log?.log_reference}</div><h2 className="text-lg font-bold mt-1">{logDetail.log?.bid_title||"No Bid Linked"}</h2><span className={clsx("badge mt-1 inline-block",statusBadge(logDetail.log?.status))}>{logDetail.log?.status}</span></div>
              <button className="btn-ghost p-2" onClick={()=>setSelected(null)}>✕</button>
            </div>
            <div className="p-6 space-y-3">
              {(logDetail.values||[]).map(v=>(
                <div key={v.value_id} className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{v.field_label}</div>
                    {v.field_label_ar && <div className="text-xs text-gray-300">{v.field_label_ar}</div>}
                  </div>
                  <div className="font-medium text-sm text-right max-w-[200px]">{v.field_value||"—"}</div>
                </div>
              ))}
              {!logDetail.values?.length && <p className="text-sm text-gray-400 text-center py-4">No field values recorded</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
