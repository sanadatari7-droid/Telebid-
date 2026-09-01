import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { refsApi } from "../services/api"
import { useForm } from "react-hook-form"
import { fmt, fmtDT } from "../utils/fmt"
import toast from "react-hot-toast"
import { Plus, BookOpen, History, Globe } from "lucide-react"

export default function ReferencesPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState(null)
  const { register, handleSubmit, reset } = useForm()
  const { data=[], isLoading } = useQuery({ queryKey:["references",search], queryFn:()=>refsApi.list({search:search||undefined}).then(r=>r.data) })
  const { data:detail } = useQuery({ queryKey:["ref",selected?.ref_id], queryFn:()=>refsApi.get(selected.ref_id).then(r=>r.data), enabled:!!selected })
  const createMut = useMutation({ mutationFn:d=>refsApi.create(d), onSuccess:()=>{ toast.success("Reference created"); qc.invalidateQueries({queryKey:["references"]}); setShowCreate(false); reset() } })

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-primary-800">Company References</h1><p className="text-sm text-gray-500">Reusable project references — auto-versioned on update</p></div>
        <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={15}/> Add Reference</button>
      </div>
      <div className="card py-3"><input className="input py-2" placeholder="Search references…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading ? <div className="col-span-3 text-center py-12"><div className="inline-block animate-spin w-6 h-6 border-4 border-primary-500 border-t-transparent rounded-full"/></div>
        : !data.length ? <div className="col-span-3 text-center py-12 text-gray-400 text-sm"><BookOpen size={32} className="mx-auto mb-2 opacity-20"/>No references yet</div>
        : (data || []).map(ref => (
          <div key={ref.ref_id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={()=>setSelected(ref)}>
            <div className="flex items-start justify-between mb-3">
              <div><div className="font-semibold text-sm">{ref.company_name}</div><div className="font-mono text-xs text-primary-500">{ref.ref_number}</div></div>
              <span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full"><History size={10}/> v{ref.current_version}</span>
            </div>
            <div className="text-sm font-medium text-gray-700 mb-1">{ref.project_name}</div>
            <div className="text-xs text-gray-500 mb-3">Client: {ref.client_name}</div>
            <div className="flex flex-wrap gap-2 text-xs">
              {ref.country && <span className="flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-0.5 rounded"><Globe size={10}/>{ref.country}</span>}
              {ref.industry && <span className="badge-blue">{ref.industry}</span>}
              {ref.project_value && <span className="font-medium text-gray-600">${Number(ref.project_value).toLocaleString()}</span>}
            </div>
            <div className="flex justify-between mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
              <span>{ref.sales_rep_name}</span><span>{ref.presales_name}</span>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold text-primary-800">Add Company Reference</h2><button className="btn-ghost p-2" onClick={()=>setShowCreate(false)}>✕</button></div>
            <form onSubmit={handleSubmit(d=>createMut.mutate(d))} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Company Name *</label><input {...register("company_name",{required:true})} className="input"/></div>
                <div><label className="label">Client Name *</label><input {...register("client_name",{required:true})} className="input"/></div>
              </div>
              <div><label className="label">Project Name *</label><input {...register("project_name",{required:true})} className="input"/></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Sales Rep User ID *</label><input {...register("sales_rep_id",{required:true,valueAsNumber:true})} type="number" className="input"/></div>
                <div><label className="label">Presales Eng User ID *</label><input {...register("presales_eng_id",{required:true,valueAsNumber:true})} type="number" className="input"/></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">Value</label><input {...register("project_value",{valueAsNumber:true})} type="number" className="input"/></div>
                <div><label className="label">Industry</label><input {...register("industry")} className="input"/></div>
                <div><label className="label">Country</label><input {...register("country")} className="input"/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Start Date</label><input {...register("start_date")} type="date" className="input"/></div>
                <div><label className="label">Completion Date</label><input {...register("completion_date")} type="date" className="input"/></div>
              </div>
              <div><label className="label">Description</label><textarea {...register("description")} className="input" rows={3}/></div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button type="button" className="btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={createMut.isPending}>{createMut.isPending?"Creating…":"Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b">
              <div><span className="font-mono text-xs text-primary-500 font-bold">{selected.ref_number}</span><h2 className="text-lg font-bold mt-1">{selected.project_name}</h2><p className="text-sm text-gray-500">{selected.company_name}</p></div>
              <div className="flex gap-2"><span className="badge-blue">v{selected.current_version}</span><button className="btn-ghost p-2" onClick={()=>setSelected(null)}>✕</button></div>
            </div>
            <div className="p-6 space-y-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[["Client",selected.client_name],["Country",selected.country||"—"],["Industry",selected.industry||"—"],["Value",selected.project_value?`$${Number(selected.project_value).toLocaleString()}`:"—"],["Sales",selected.sales_rep_name||"—"],["Presales",selected.presales_name||"—"]].map(([k,v])=>(
                  <div key={k}><dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt><dd className="font-medium mt-0.5">{v}</dd></div>
                ))}
              </dl>
              {detail?.version_history?.length>0 && (
                <div><h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><History size={14}/> Version History</h4>
                  {detail.version_history.map(v=>(
                    <div key={v.version_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm border border-gray-200 mb-1">
                      <span className="font-mono text-xs font-bold text-primary-600">v{v.version_number}</span>
                      <span className="text-gray-600">{v.project_name}</span>
                      <span className="text-xs text-gray-400">{fmt(v.changed_at, "dd MMM yyyy")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
