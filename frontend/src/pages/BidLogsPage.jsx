import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { bidLogsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import clsx from "clsx"
import { FileText, User, ClipboardList, Star, ChevronLeft, ChevronRight } from "lucide-react"

const TABS = [["bid","Bid Logs",FileText],["eval","Evaluation Logs",Star],["activity","User Activity",User]]

export default function BidLogsPage() {
  const [tab, setTab] = useState("bid")
  const [page, setPage] = useState(1)

  const { data: bidLogs } = useQuery({ queryKey:["bid-logs",page], queryFn:()=>bidLogsApi.getBidLogs({page,page_size:50}).then(r=>r.data), enabled:tab==="bid" })
  const { data: evalLogs } = useQuery({ queryKey:["eval-logs",page], queryFn:()=>bidLogsApi.getEvalLogs({page,page_size:50}).then(r=>r.data), enabled:tab==="eval" })
  const { data: activity } = useQuery({ queryKey:["user-activity",page], queryFn:()=>bidLogsApi.getUserActivity({page,page_size:50}).then(r=>r.data), enabled:tab==="activity", retry:1 })

  const active = tab==="bid"?bidLogs:tab==="eval"?evalLogs:activity

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div><h1 className="text-xl font-bold text-primary-800">Bid Logs</h1><p className="text-sm text-gray-500">Detailed activity logs for all bid-related actions</p></div>

      <div className="border-b border-gray-200">
        <div className="flex">
          {TABS.map(([t,l,Icon])=>(
            <button key={t} onClick={()=>{setTab(t);setPage(1)}} className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab===t?"border-primary-500 text-primary-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>
              <Icon size={15}/>{l}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-0">
        <div className="overflow-x-auto">
          {tab==="bid" && (
            <table className="tbl">
              <thead><tr><th>Time</th><th>Bid</th><th>Action</th><th>Module</th><th>Performed By</th><th>Description</th></tr></thead>
              <tbody>
                {(bidLogs?.items||[]).map(l=>(
                  <tr key={l.bid_log_id}>
                    <td className="text-xs text-gray-400 whitespace-nowrap">{fmt(l.created_at,"dd MMM HH:mm")}</td>
                    <td><span className="font-mono text-xs text-primary-600">{l.bid_number||"—"}</span></td>
                    <td><span className="badge-blue">{l.action}</span></td>
                    <td><span className="badge-gray">{l.module}</span></td>
                    <td className="text-sm">{l.performed_by_name}</td>
                    <td className="text-sm text-gray-500 max-w-[200px] truncate">{l.description||"—"}</td>
                  </tr>
                ))}
                {!(bidLogs?.items?.length)&&<tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">No bid logs yet</td></tr>}
              </tbody>
            </table>
          )}
          {tab==="eval" && (
            <table className="tbl">
              <thead><tr><th>Time</th><th>Bid</th><th>Action</th><th>Performed By</th><th>Description</th></tr></thead>
              <tbody>
                {(evalLogs?.items||[]).map(l=>(
                  <tr key={l.eval_log_id}>
                    <td className="text-xs text-gray-400 whitespace-nowrap">{fmt(l.created_at,"dd MMM HH:mm")}</td>
                    <td><span className="font-mono text-xs text-primary-600">{l.bid_number||"—"}</span></td>
                    <td><span className="badge-blue">{l.action}</span></td>
                    <td className="text-sm">{l.performed_by_name}</td>
                    <td className="text-sm text-gray-500">{l.description||"—"}</td>
                  </tr>
                ))}
                {!(evalLogs?.items?.length)&&<tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">No evaluation logs yet</td></tr>}
              </tbody>
            </table>
          )}
          {tab==="activity" && (
            <table className="tbl">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Record</th></tr></thead>
              <tbody>
                {(activity?.items||[]).map(l=>(
                  <tr key={l.log_id}>
                    <td className="text-xs text-gray-400 whitespace-nowrap">{fmt(l.action_at,"dd MMM HH:mm")}</td>
                    <td className="text-sm font-medium">{l.user_name||l.username}</td>
                    <td><span className="badge-blue">{l.action}</span></td>
                    <td><span className="badge-gray">{l.module||"—"}</span></td>
                    <td className="text-xs text-gray-400">{l.record_type} #{l.record_id}</td>
                  </tr>
                ))}
                {!(activity?.items?.length)&&<tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">No user activity yet</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {active && active.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">Page {page} of {active.total_pages}</span>
            <div className="flex gap-1">
              <button className="btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={13}/></button>
              <button className="btn-ghost btn-sm" disabled={page>=active.total_pages} onClick={()=>setPage(p=>p+1)}><ChevronRight size={13}/></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
