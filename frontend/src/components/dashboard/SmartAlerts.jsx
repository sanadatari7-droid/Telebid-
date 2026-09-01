import React from "react"
import { useQuery } from "@tanstack/react-query"
import { bidsApi, oppsV2Api, schedulerApi } from "../../services/api"
import { AlertTriangle, Clock, XCircle, Info, CheckCircle2, TrendingUp, Bell, ArrowRight } from "lucide-react"
import { useNavigate } from "react-router-dom"
import clsx from "clsx"

export default function SmartAlerts() {
  const navigate = useNavigate()
  const { data } = useQuery({ queryKey:["dashboard"], queryFn:()=>bidsApi.getDashboard().then(r=>r.data), staleTime:60000 })
  const { data: os } = useQuery({ queryKey:["opps-v2-stats"], queryFn:()=>oppsV2Api.dashboardStats().then(r=>r.data), staleTime:60000 })

  const alerts = []
  const kpi = data?.kpi || {}
  const stats = os?.stats || {}

  if (kpi.expired_bids > 0)
    alerts.push({ type:"error", icon:XCircle, title:"Expired Bids", msg:`${kpi.expired_bids} bid(s) passed their deadline and are still open`, url:"/bids", label:"Review" })
  if (kpi.upcoming_deadlines > 0)
    alerts.push({ type:"warning", icon:Clock, title:"Upcoming Deadlines", msg:`${kpi.upcoming_deadlines} bid(s) have deadlines in the next 7 days`, url:"/calendar", label:"View Calendar" })
  if (stats.pending_approval > 0)
    alerts.push({ type:"info", icon:Bell, title:"Pending Approvals", msg:`${stats.pending_approval} opportunity/opportunities waiting for approval`, url:"/rfp-bids", label:"Review" })
  if (stats.overdue > 0)
    alerts.push({ type:"error", icon:AlertTriangle, title:"Overdue Opportunities", msg:`${stats.overdue} opportunity submission deadline has passed`, url:"/rfp-bids", label:"View" })
  if (stats.win_rate != null && stats.win_rate >= 70)
    alerts.push({ type:"success", icon:CheckCircle2, title:"Excellent Win Rate", msg:`Your win rate is ${stats.win_rate}% — well above average`, url:null })
  if (kpi.draft_bids > 5)
    alerts.push({ type:"info", icon:Info, title:"Many Draft Bids", msg:`You have ${kpi.draft_bids} draft bids — consider submitting or cancelling old ones`, url:"/bids", label:"View Drafts" })

  if (alerts.length === 0) return null

  const styles = {
    error:   "bg-red-50 border-red-200 text-red-700",
    warning: "bg-amber-50 border-amber-200 text-amber-700",
    info:    "bg-blue-50 border-blue-200 text-blue-700",
    success: "bg-green-50 border-green-200 text-green-700",
  }
  const iconColors = { error:"text-red-500", warning:"text-amber-500", info:"text-blue-500", success:"text-green-500" }

  return (
    <div className="space-y-2">
      <div className="section-title flex items-center gap-2">
        <AlertTriangle size={13}/>
        Smart Alerts ({alerts.length})
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {alerts.map((a, i) => (
          <div key={i} className={clsx("flex items-center gap-3 p-3.5 rounded-xl border text-sm", styles[a.type])}>
            <a.icon size={15} className={clsx("flex-shrink-0", iconColors[a.type])}/>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-xs uppercase tracking-wide opacity-70">{a.title}</div>
              <div className="mt-0.5 text-xs">{a.msg}</div>
            </div>
            {a.url && (
              <button className="btn-ghost btn-sm flex-shrink-0 gap-1 opacity-70 hover:opacity-100"
                onClick={() => navigate(a.url)}>
                {a.label} <ArrowRight size={11}/>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
