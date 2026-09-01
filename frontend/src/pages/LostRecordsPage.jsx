import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { lostRecordsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { exportToExcel } from "../utils/exportUtils"
import clsx from "clsx"
import toast from "react-hot-toast"
import { XCircle, Search, Download, Eye, RefreshCw, ChevronLeft, ChevronRight,
         X, Pencil, Check, Users, RotateCcw } from "lucide-react"

const LOSS_STYLE = {
  LOST_FINANCIALLY:"bg-red-100 text-red-700", LOST_TECHNICAL:"bg-orange-100 text-orange-700",
  CANCELLED:"bg-gray-100 text-gray-600", NO_AWARD:"bg-purple-100 text-purple-700", COMPETITOR:"bg-amber-100 text-amber-700",
}

function LostDetailModal({ lostId, onClose }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const { data, isLoading } = useQuery({ queryKey:["lost-detail",lostId], queryFn:()=>lostRecordsApi.get(lostId).then(r=>r.data) })
  const lost = data?.lost_record
  const fc = e => setForm(p=>({...p,[e.target.name]:e.target.value}))
  React.useEffect(()=>{ if(lost&&!editing) setForm({ loss_reason:lost.loss_reason||"", competitor_name:lost.competitor_name||"", winner_name:lost.winner_name||"", winner_tcv:lost.winner_tcv||"", winner_solution:lost.winner_solution||"", price_difference:lost.price_difference||"", technical_gap:lost.technical_gap||"", lessons_learned:lost.lessons_learned||"", bid_person_notes:lost.bid_person_notes||"", could_revisit:!!lost.could_revisit, revisit_notes:lost.revisit_notes||"" }) }, [lost,editing])
  const updateMut = useMutation({
    mutationFn:()=>lostRecordsApi.update(lostId,{...form,winner_tcv:form.winner_tcv?Number(form.winner_tcv):null,price_difference:form.price_difference?Number(form.price_difference):null,could_revisit:!!form.could_revisit}),
    onSuccess:()=>{toast.success("Updated");qc.invalidateQueries({queryKey:["lost-detail",lostId]});qc.invalidateQueries({queryKey:["lost-records"]});qc.invalidateQueries({queryKey:["lost-stats"]});setEditing(false)}
  })
  const sym = lost?.symbol||"$"
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b bg-red-50 rounded-t-2xl sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2"><XCircle size={18} className="text-red-600"/><span className="font-mono text-sm font-bold text-red-700">{lost?.lost_number}</span><span className={clsx("badge text-xs",LOSS_STYLE[lost?.loss_type]||"badge-gray")}>{lost?.loss_type?.replace(/_/g," ")}</span></div>
            <h2 className="font-bold text-gray-900 text-lg mt-1">{lost?.customer_name}</h2>
          </div>
          <div className="flex gap-2">{!editing&&<button className="btn-secondary btn-sm" onClick={()=>setEditing(true)}><Pencil size={13}/> Edit</button>}<button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button></div>
        </div>
        <div className="p-6 space-y-5">
          {isLoading?<div className="skeleton h-40"/>:(<>
            <div>
              <div className="flex items-center gap-2 mb-3"><div className="section-title mb-0">Opportunity Data</div><span className="badge-gray text-xs">Copied · Read Only</span></div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[["EXPRO Ref",lost?.expro_ref],["PO #",lost?.rfp_ref],["Client",lost?.customer_name],["Media",lost?.media_type],["SLA",lost?.sla_type],["BW",lost?.bandwidth_mbps?`${lost.bandwidth_mbps} Mbps`:null],["QTY",lost?.quantity],["SOW",lost?.solution_detail||lost?.sow_detail],["TCV",lost?.tcv?`${sym}${Number(lost.tcv).toLocaleString()}`:null]].filter(([,v])=>v).map(([k,v])=>(
                  <div key={k} className="bg-gray-50 rounded-xl p-3"><dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt><dd className="font-medium text-sm mt-0.5">{v}</dd></div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3"><div className="section-title mb-0">Loss Analysis</div>{editing&&<span className="badge-blue text-xs">Editing</span>}</div>
              {editing?(
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="label">Loss Reason</label><input name="loss_reason" className="input" value={form.loss_reason} onChange={fc}/></div>
                    <div><label className="label">Competitor</label><input name="competitor_name" className="input" value={form.competitor_name} onChange={fc}/></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="label">Winner</label><input name="winner_name" className="input" value={form.winner_name} onChange={fc}/></div>
                    <div><label className="label">Winner TCV</label><input name="winner_tcv" type="number" className="input" value={form.winner_tcv} onChange={fc}/></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="label">Winner Solution</label><input name="winner_solution" className="input" value={form.winner_solution} onChange={fc}/></div>
                    <div><label className="label">Price Difference</label><input name="price_difference" type="number" className="input" value={form.price_difference} onChange={fc}/></div>
                  </div>
                  <div><label className="label">Technical Gap</label><textarea name="technical_gap" className="input" rows={2} value={form.technical_gap} onChange={fc}/></div>
                  <div><label className="label">Lessons Learned</label><textarea name="lessons_learned" className="input" rows={3} value={form.lessons_learned} onChange={fc}/></div>
                  <div><label className="label">Notes</label><textarea name="bid_person_notes" className="input" rows={2} value={form.bid_person_notes} onChange={fc}/></div>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!form.could_revisit} onChange={e=>setForm(p=>({...p,could_revisit:e.target.checked}))} className="w-4 h-4 accent-blue-600"/><span className="text-sm">Worth revisiting?</span></label>
                  <div className="flex gap-3 justify-end"><button className="btn-secondary" onClick={()=>setEditing(false)}>Cancel</button><button className="btn-primary" disabled={updateMut.isPending} onClick={()=>updateMut.mutate()}><Check size={13}/> {updateMut.isPending?"Saving…":"Save"}</button></div>
                </div>
              ):(
                <div className="grid grid-cols-2 gap-3">
                  {[["Lost Date",lost?.lost_date?fmt(lost.lost_date):null],["Loss Type",lost?.loss_type?.replace(/_/g," ")],["Loss Reason",lost?.loss_reason],["Competitor",lost?.competitor_name],["Winner",lost?.winner_name],["Winner TCV",lost?.winner_tcv?`${sym}${Number(lost.winner_tcv).toLocaleString()}`:null],["Price Diff",lost?.price_difference?`${sym}${Number(lost.price_difference).toLocaleString()}`:null]].filter(([,v])=>v).map(([k,v])=>(
                    <div key={k} className="bg-red-50 rounded-xl p-3"><dt className="text-xs font-semibold text-red-500 uppercase tracking-wide">{k}</dt><dd className="font-medium text-sm mt-0.5">{v}</dd></div>
                  ))}
                  {lost?.technical_gap&&<div className="col-span-full bg-red-50 rounded-xl p-3"><dt className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Technical Gap</dt><dd className="text-sm">{lost.technical_gap}</dd></div>}
                  {lost?.lessons_learned&&<div className="col-span-full bg-amber-50 rounded-xl p-3"><dt className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Lessons Learned</dt><dd className="text-sm">{lost.lessons_learned}</dd></div>}
                  {lost?.could_revisit&&<div className="col-span-full badge-green p-3 rounded-xl text-sm"><strong>✅ Worth revisiting</strong>{lost.revisit_notes&&` — ${lost.revisit_notes}`}</div>}
                </div>
              )}
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}

export default function LostRecordsPage() {
  const [page,setPage]=useState(1)
  const [search,setSearch]=useState("")
  const [typeFilter,setTypeFilter]=useState("")
  const [showDetail,setShowDetail]=useState(null)
  const {data,isLoading}=useQuery({queryKey:["lost-records",page,search,typeFilter],queryFn:()=>lostRecordsApi.list({page,page_size:20,search:search||undefined,loss_type:typeFilter||undefined}).then(r=>r.data),retry:1})
  const {data:stats}=useQuery({queryKey:["lost-stats"],queryFn:()=>lostRecordsApi.stats().then(r=>r.data),retry:1})
  const {data:byComp=[]}=useQuery({queryKey:["lost-by-comp"],queryFn:()=>lostRecordsApi.byCompetitor().then(r=>r.data),retry:1})
  const items=data?.items||[]
  const handleExport=()=>{exportToExcel(items,[{header:"LOST #",key:"lost_number"},{header:"Customer",key:"customer_name"},{header:"Loss Type",key:"loss_type"},{header:"Competitor",key:"competitor_name"},{header:"TCV",key:"tcv"},{header:"Lost Date",accessor:r=>r.lost_date?fmt(r.lost_date):""}],"lost-opps");toast.success("Exported")}
  const KPI=[["Total Lost",stats?.total_lost||0,"bg-red-600"],["TCV Lost",stats?.total_tcv_lost?`$${Number(stats.total_tcv_lost).toLocaleString()}`:"—","bg-red-500"],["Financial",stats?.financial_losses||0,"bg-orange-600"],["Technical",stats?.technical_losses||0,"bg-amber-600"],["Competitors",stats?.unique_competitors||0,"bg-gray-600"],["Can Revisit",stats?.revisit_opportunities||0,"bg-blue-600"]]
  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-5">
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><XCircle size={24} className="text-red-600"/> Lost Opportunities</h1><p className="page-subtitle">Loss analysis, competitor intelligence and lessons learned</p></div>
        <button className="btn-secondary btn-sm" onClick={handleExport}><Download size={13}/> Export</button>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">{KPI.map(([l,v,c])=><div key={l} className="card-sm text-center"><div className={clsx("w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center text-white text-xs font-bold",c)}>{v}</div><div className="text-xs font-medium text-gray-400">{l}</div></div>)}</div>
      {byComp.length>0&&<div className="card-sm"><div className="section-title flex items-center gap-2"><Users size={12}/> Top Competitors</div><div className="flex flex-wrap gap-2">{byComp.slice(0,8).map(c=><div key={c.competitor_name} className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-1.5 text-xs"><span className="font-semibold">{c.competitor_name}</span><span className="text-red-600 font-bold">{c.losses} losses</span></div>)}</div></div>}
      <div className="card-sm py-3"><div className="flex flex-wrap gap-3"><div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input className="input py-2 pl-9" placeholder="Search…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></div><select className="input w-auto py-2" value={typeFilter} onChange={e=>{setTypeFilter(e.target.value);setPage(1)}}><option value="">All Types</option>{["LOST_FINANCIALLY","LOST_TECHNICAL","CANCELLED","NO_AWARD","COMPETITOR"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}</select><button className="btn-ghost py-2" onClick={()=>{setSearch("");setTypeFilter("");setPage(1)}}><RefreshCw size={13}/></button></div></div>
      <div className="card p-0"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>LOST #</th><th>Customer</th><th>Loss Type</th><th>Competitor</th><th>TCV</th><th>Winner TCV</th><th>Sales Rep</th><th>Lost Date</th><th>Revisit?</th><th></th></tr></thead>
        <tbody>
          {isLoading?<tr><td colSpan={10} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-red-500 border-t-transparent rounded-full"/></td></tr>
          :items.length===0?<tr><td colSpan={10} className="py-12"><div className="empty-state"><div className="empty-icon mx-auto"><XCircle size={28}/></div><p className="text-sm text-gray-400">No LOST records yet</p></div></td></tr>
          :items.map(l=>(
            <tr key={l.lost_id} className="cursor-pointer" onClick={()=>setShowDetail(l.lost_id)}>
              <td><span className="font-mono text-xs font-bold text-red-600">{l.lost_number}</span></td>
              <td><div className="font-medium text-sm truncate max-w-[140px]">{l.customer_name}</div><div className="text-xs text-gray-400">{l.opp_number}</div></td>
              <td><span className={clsx("badge text-xs",LOSS_STYLE[l.loss_type]||"badge-gray")}>{l.loss_type?.replace(/_/g," ")}</span></td>
              <td className="text-sm text-gray-600">{l.competitor_name||"—"}</td>
              <td className="text-sm font-medium">{l.tcv?`${l.symbol||"$"}${Number(l.tcv).toLocaleString()}`:"—"}</td>
              <td className="text-sm text-gray-500">{l.winner_tcv?`${l.symbol||"$"}${Number(l.winner_tcv).toLocaleString()}`:"—"}</td>
              <td className="text-xs text-gray-500">{l.sales_rep_name||"—"}</td>
              <td className="text-xs">{l.lost_date?fmt(l.lost_date):"—"}</td>
              <td>{l.could_revisit&&<span className="badge-blue text-xs flex items-center gap-1"><RotateCcw size={9}/> Yes</span>}</td>
              <td onClick={e=>e.stopPropagation()}><button className="btn-ghost btn-sm" onClick={()=>setShowDetail(l.lost_id)}><Eye size={13}/></button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {data?.total_pages>1&&<div className="flex items-center justify-between px-4 py-3 border-t border-gray-100"><span className="text-xs text-gray-500">{data.total} records</span><div className="flex gap-1 items-center"><button className="btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={13}/></button><span className="text-xs px-2">{page}/{data.total_pages}</span><button className="btn-ghost btn-sm" disabled={page>=data.total_pages} onClick={()=>setPage(p=>p+1)}><ChevronRight size={13}/></button></div></div>}
      </div>
      {showDetail&&<LostDetailModal lostId={showDetail} onClose={()=>setShowDetail(null)}/>}
    </div>
  )
}
