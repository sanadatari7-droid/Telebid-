import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { reportsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { exportToExcel } from "../utils/exportUtils"
import clsx from "clsx"
import { Search, Download, RefreshCw, ChevronLeft, ChevronRight, Shield } from "lucide-react"

const ACTION_STYLE = { USER_CREATED:"badge-green", USER_UPDATED:"badge-blue", USER_DEACTIVATED:"badge-red", PASSWORD_RESET:"badge-amber", ROLES_UPDATED:"badge-purple", LOGIN:"badge-gray", LOGIN_FAILED:"badge-red" }

export default function AuditLogPage() {
  const [page,setPage]=useState(1)
  const [search,setSearch]=useState("")
  const {data,isLoading,refetch}=useQuery({queryKey:["audit-log",page],queryFn:()=>reportsApi.audit({page,page_size:50}).then(r=>r.data),retry:1})
  const items=data?.items||[]
  const detailsOf = log => log.old_value || log.new_value
    ? `${log.old_value ?? "—"} → ${log.new_value ?? "—"}`
    : (log.record_id ? `#${log.record_id}` : "—")
  const handleExport=()=>exportToExcel(items,[{header:"Action",key:"action"},{header:"User",key:"user_name"},{header:"Username",key:"username"},{header:"Entity",key:"record_type"},{header:"Details",accessor:detailsOf},{header:"Time",accessor:r=>r.action_at?fmt(r.action_at,"dd MMM yyyy HH:mm"):""}],"audit-log")
  const filtered=search?items.filter(i=>JSON.stringify(i).toLowerCase().includes(search.toLowerCase())):items
  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><Shield size={22}/> Audit Log</h1><p className="page-subtitle">Complete history of all system actions</p></div>
        <div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={()=>refetch()}><RefreshCw size={13}/></button><button className="btn-secondary btn-sm" onClick={handleExport}><Download size={13}/> Export</button></div>
      </div>
      <div className="card-sm py-3"><div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input className="input py-2 pl-9" placeholder="Filter by action, user, or details…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
      <div className="card p-0"><div className="overflow-x-auto"><table className="tbl">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>
          {isLoading?<tr><td colSpan={6} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
          :filtered.length===0?<tr><td colSpan={6} className="text-center py-10 text-sm text-gray-400">No audit records found</td></tr>
          :filtered.map((log,i)=>(
            <tr key={log.log_id||i}>
              <td className="text-xs text-gray-500 whitespace-nowrap">{log.action_at?fmt(log.action_at,"dd MMM HH:mm:ss"):"—"}</td>
              <td><div className="text-sm font-semibold">{log.user_name||"System"}</div>{log.username&&<div className="text-xs text-gray-400 font-mono">{log.username}</div>}</td>
              <td><span className={clsx("badge text-xs",ACTION_STYLE[log.action]||"badge-gray")}>{log.action?.replace(/_/g," ")}</span></td>
              <td className="text-xs text-gray-500">{log.record_type||log.module||"—"}</td>
              <td className="text-xs text-gray-600 max-w-[300px] truncate" title={detailsOf(log)}>{detailsOf(log)}</td>
              <td className="text-xs font-mono text-gray-400">{log.ip_address||"—"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {data?.total_pages>1&&<div className="flex items-center justify-between px-4 py-3 border-t border-gray-100"><span className="text-xs text-gray-500">{data.total} total entries</span><div className="flex gap-1 items-center"><button className="btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={13}/></button><span className="text-xs px-2">{page}/{data.total_pages}</span><button className="btn-ghost btn-sm" disabled={page>=data.total_pages} onClick={()=>setPage(p=>p+1)}><ChevronRight size={13}/></button></div></div>}
      </div>
    </div>
  )
}
