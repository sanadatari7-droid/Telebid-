import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ictApi, settingsApi, bidsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Plus, Monitor, Server, Shield, Wifi, HardDrive, Code, Cpu, Wrench, Building2, Search } from "lucide-react"

const CAT_ICONS = { CONSTRUCTION:Building2, INFRASTRUCTURE:Server, NETWORKING:Wifi, DATA_CENTER:Server, CYBERSECURITY:Shield, TELECOM:Wifi, SOFTWARE:Code, HARDWARE:Cpu, IT_SERVICES:Wrench, OTHER:Monitor }

const INITIAL_FORM = { bid_id:"", ict_cat_id:"", project_location:"", site_information:"", required_infrastructure:"", construction_requirements:"", technical_requirements:"", contractor_vendor:"", estimated_value:"", project_duration_days:"", notes:"" }

export default function ICTPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [catFilter, setCatFilter] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["ict", search, catFilter],
    queryFn: () => ictApi.list({ search: search||undefined, cat_code: catFilter||undefined }).then(r => r.data),
    retry: 1
  })
  const { data: stats } = useQuery({ queryKey:["ict-stats"], queryFn:()=>ictApi.stats().then(r=>r.data) })
  const { data: cats = [] } = useQuery({ queryKey:["ict-cats"], queryFn:()=>settingsApi.getIctCategories().then(r=>r.data) })
  const { data: bids } = useQuery({ queryKey:["bids-for-ict"], queryFn:()=>bidsApi.list({page_size:200}).then(r=>r.data) })

  const selCat = cats.find(c => String(c.ict_cat_id) === String(form.ict_cat_id))
  const isConstruction = selCat?.has_construction

  const handleCreate = async () => {
    if (!form.bid_id || !form.ict_cat_id) { toast.error("Please select a bid and category"); return }
    setCreating(true)
    try {
      await ictApi.create({ ...form, bid_id:Number(form.bid_id), ict_cat_id:Number(form.ict_cat_id), estimated_value:form.estimated_value?Number(form.estimated_value):null, project_duration_days:form.project_duration_days?Number(form.project_duration_days):null })
      toast.success("ICT project created")
      qc.invalidateQueries({ queryKey:["ict"] })
      qc.invalidateQueries({ queryKey:["ict-stats"] })
      setShowCreate(false); setForm(INITIAL_FORM)
    } catch(e) { toast.error(apiErrorMessage(e, "Failed")) }
    finally { setCreating(false) }
  }

  const items = data?.items || []

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-primary-800">ICT Module — Non-Telecom</h1><p className="text-sm text-gray-500">ICT projects: Construction, Infrastructure, Cybersecurity and more</p></div>
        <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={15}/> New ICT Project</button>
      </div>

      {/* Stats by category */}
      {stats?.by_category && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.by_category.filter(c=>c.project_count>0).map(c => {
            const Icon = CAT_ICONS[c.cat_code] || Monitor
            return (
              <div key={c.cat_code} className={clsx("card cursor-pointer transition-all hover:shadow-md border-2", catFilter===c.cat_code?"border-primary-500 bg-primary-50":"border-transparent")} onClick={()=>setCatFilter(catFilter===c.cat_code?"":c.cat_code)}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0"><Icon size={17} className="text-primary-600"/></div>
                  <div><div className="font-bold text-lg text-primary-700">{c.project_count}</div></div>
                </div>
                <div className="text-xs font-semibold text-gray-600 truncate">{c.cat_name}</div>
                {c.has_construction && <span className="badge-amber text-xs mt-1">Construction</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="card py-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9 py-2" placeholder="Search ICT projects…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <select className="input w-auto py-2" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
            <option value="">All Categories</option>
            {cats.map(c=><option key={c.cat_code} value={c.cat_code}>{c.cat_name}</option>)}
          </select>
          <button className="btn-ghost py-2" onClick={()=>{setSearch("");setCatFilter("")}}>Reset</button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Bid #</th><th>Title</th><th>Category</th><th>Customer</th><th>Location</th><th>Value</th><th>Duration</th><th>Status</th></tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={8} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-primary-500 border-t-transparent rounded-full"/></td></tr>
              : items.length===0 ? <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm"><Monitor size={32} className="mx-auto mb-2 opacity-20"/>No ICT projects yet</td></tr>
              : items.map(p=>(
                <tr key={p.bid_id} className="cursor-pointer" onClick={()=>setSelected(p)}>
                  <td><span className="font-mono text-xs font-bold text-primary-600">{p.bid_number}</span></td>
                  <td className="font-medium max-w-[160px] truncate">{p.bid_title}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {p.has_construction && <span className="badge-amber text-xs">Construction</span>}
                      <span className="badge-blue">{p.cat_name||"—"}</span>
                    </div>
                  </td>
                  <td className="text-sm text-gray-500">{p.customer_name||"—"}</td>
                  <td className="text-sm text-gray-500">{p.project_location||p.location_city||"—"}</td>
                  <td className="text-sm font-medium">{p.estimated_value?`$${Number(p.estimated_value).toLocaleString()}`:"—"}</td>
                  <td className="text-sm text-gray-500">{p.project_duration_days?`${p.project_duration_days} days`:"—"}</td>
                  <td><span className="badge" style={{background:(p.color_hex||"#9CA3AF")+"22",color:p.color_hex||"#9CA3AF"}}>{p.status_name}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-primary-800">New ICT Project</h2>
              <button className="btn-ghost p-2" onClick={()=>setShowCreate(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Link to Bid *</label>
                  <select className="input" value={form.bid_id} onChange={e=>setForm(p=>({...p,bid_id:e.target.value}))}>
                    <option value="">Select bid…</option>
                    {(bids?.items||[]).map(b=><option key={b.bid_id} value={b.bid_id}>{b.bid_number} — {b.bid_title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">ICT Category *</label>
                  <select className="input" value={form.ict_cat_id} onChange={e=>setForm(p=>({...p,ict_cat_id:e.target.value}))}>
                    <option value="">Select category…</option>
                    {cats.map(c=><option key={c.ict_cat_id} value={c.ict_cat_id}>{c.cat_name}{c.has_construction?" (Construction)":""}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Contractor / Vendor</label><input className="input" value={form.contractor_vendor} onChange={e=>setForm(p=>({...p,contractor_vendor:e.target.value}))} placeholder="Contractor name"/></div>
                <div><label className="label">Estimated Value ($)</label><input type="number" className="input" value={form.estimated_value} onChange={e=>setForm(p=>({...p,estimated_value:e.target.value}))}/></div>
              </div>

              <div><label className="label">Technical Requirements</label><textarea className="input" rows={3} value={form.technical_requirements} onChange={e=>setForm(p=>({...p,technical_requirements:e.target.value}))}/></div>

              {isConstruction && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 space-y-3">
                  <h4 className="text-sm font-semibold text-amber-700">🏗️ Construction-Specific Fields</h4>
                  <div><label className="label">Project Location</label><input className="input" value={form.project_location} onChange={e=>setForm(p=>({...p,project_location:e.target.value}))} placeholder="Site address or coordinates"/></div>
                  <div><label className="label">Site Information</label><textarea className="input" rows={2} value={form.site_information} onChange={e=>setForm(p=>({...p,site_information:e.target.value}))}/></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="label">Required Infrastructure</label><textarea className="input" rows={2} value={form.required_infrastructure} onChange={e=>setForm(p=>({...p,required_infrastructure:e.target.value}))}/></div>
                    <div><label className="label">Construction Requirements</label><textarea className="input" rows={2} value={form.construction_requirements} onChange={e=>setForm(p=>({...p,construction_requirements:e.target.value}))}/></div>
                  </div>
                  <div><label className="label">Project Duration (Days)</label><input type="number" className="input" value={form.project_duration_days} onChange={e=>setForm(p=>({...p,project_duration_days:e.target.value}))}/></div>
                </div>
              )}

              <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/></div>

              <div className="flex gap-3 justify-end pt-2 border-t">
                <button className="btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button className="btn-primary" disabled={creating} onClick={handleCreate}>{creating?"Creating…":"Create ICT Project"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b">
              <div><span className="font-mono text-xs text-primary-500 font-bold">{selected.bid_number}</span><h2 className="text-lg font-bold mt-1">{selected.bid_title}</h2><span className="badge-blue mt-1 inline-block">{selected.cat_name}</span></div>
              <button className="btn-ghost p-2" onClick={()=>setSelected(null)}>✕</button>
            </div>
            <div className="p-6">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[["Customer",selected.customer_name],["Category",selected.cat_name],["Location",selected.project_location||selected.location_city||"—"],["Contractor",selected.contractor_vendor||"—"],["Value",selected.estimated_value?`$${Number(selected.estimated_value).toLocaleString()}`:"—"],["Duration",selected.project_duration_days?`${selected.project_duration_days} days`:"—"]].map(([k,v])=>(
                  <div key={k}><dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt><dd className="font-medium mt-0.5">{v||"—"}</dd></div>
                ))}
              </dl>
              {selected.technical_requirements && <div className="mt-4 pt-4 border-t"><h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Technical Requirements</h4><p className="text-sm text-gray-600">{selected.technical_requirements}</p></div>}
              {selected.construction_requirements && <div className="mt-3"><h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Construction Requirements</h4><p className="text-sm text-gray-600">{selected.construction_requirements}</p></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
