import React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { aiAlertsApi } from "../services/api"
import { fmtDT } from "../utils/fmt"
import { useAuthStore } from "../store/authStore"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Sparkles, Mail, RefreshCw, AlertOctagon, CheckCircle2, XCircle } from "lucide-react"

const SEVERITY_STYLE = {
  CRITICAL: "bg-red-100 text-red-700",
  HIGH:     "bg-amber-100 text-amber-700",
  MEDIUM:   "bg-blue-100 text-blue-700",
  LOW:      "bg-gray-100 text-gray-600",
}

export default function AiAlertsPage() {
  const { hasRole } = useAuthStore()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["ai-alerts"],
    queryFn: () => aiAlertsApi.list({ limit: 100 }).then(r => r.data),
    retry: 1,
  })

  const scanMut = useMutation({
    mutationFn: () => aiAlertsApi.scan(),
    onSuccess: (r) => {
      toast.success(r.data?.message || "Scan complete")
      qc.invalidateQueries({ queryKey: ["ai-alerts"] })
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Scan failed"),
  })

  const items = data?.items || []
  const stats = data?.stats || {}

  const KPI = [
    { label: "Total Alerts",   val: stats.total || 0,        color: "bg-blue-600" },
    { label: "Sent OK",        val: stats.sent_ok || 0,      color: "bg-green-600" },
    { label: "AI-Triaged",     val: stats.ai_generated || 0, color: "bg-purple-600" },
    { label: "Last 7 Days",    val: stats.last_7_days || 0,  color: "bg-amber-500" },
  ]

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Sparkles size={20} className="text-purple-600"/> AI Alert Watchdog</h1>
          <p className="page-subtitle">AI-triaged risk signals, emailed automatically via your configured mail relay (Outlook / Office 365 supported)</p>
        </div>
        {hasRole("ADMIN") && (
          <button className="btn-primary" disabled={scanMut.isPending} onClick={() => scanMut.mutate()}>
            <RefreshCw size={14} className={clsx(scanMut.isPending && "animate-spin")}/>
            {scanMut.isPending ? "Scanning…" : "Run AI Scan Now"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {KPI.map(k => (
          <div key={k.label} className="card-sm text-center">
            <div className={clsx("w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center text-white text-sm font-bold", k.color)}>{k.val}</div>
            <div className="text-xs font-medium text-gray-400">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="card-sm bg-blue-50 border-blue-200 text-xs text-blue-800 flex items-start gap-2">
        <Mail size={14} className="mt-0.5 shrink-0"/>
        <div>
          Scans open opportunities for risk signals — a deadline closing in, no activity in over a
          week, a deadline near with no costing sheet priced, or a high-value opportunity gone idle —
          and asks the AI advisor which ones genuinely deserve an alert email. Delivery uses the SMTP
          settings in <strong>System Settings → Email</strong>; point them at Outlook/Office 365's relay
          (<code>smtp.office365.com:587</code>) to send via Outlook. Without an Anthropic API key configured,
          alerts still send using a deterministic rule instead of AI triage.
        </div>
      </div>

      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Opportunity</th>
                <th>Headline</th>
                <th>Reason</th>
                <th>Recommended Action</th>
                <th>Source</th>
                <th>Sent</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="py-12">
                  <div className="empty-state"><div className="empty-icon mx-auto"><AlertOctagon size={28}/></div><p className="text-sm text-gray-400">No alerts yet — run a scan to check for risk signals</p></div>
                </td></tr>
              ) : items.map(a => (
                <tr key={a.alert_id}>
                  <td><span className={clsx("badge text-xs", SEVERITY_STYLE[a.severity] || "badge-gray")}>{a.severity}</span></td>
                  <td>
                    <div className="font-mono text-xs text-blue-600">{a.opp_number || "—"}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[140px]">{a.customer_name}</div>
                  </td>
                  <td className="text-xs font-medium text-gray-800 max-w-[220px]">{a.headline}</td>
                  <td className="text-xs text-gray-600 max-w-[260px]">{a.reason}</td>
                  <td className="text-xs text-gray-600 max-w-[220px]">{a.recommended_action || "—"}</td>
                  <td className="text-xs">
                    <span className={clsx("badge text-xs", a.ai_generated ? "bg-purple-100 text-purple-700" : "badge-gray")}>
                      {a.ai_generated ? "AI" : "Rule-based"}
                    </span>
                  </td>
                  <td>
                    {a.sent_ok
                      ? <CheckCircle2 size={15} className="text-green-600"/>
                      : <XCircle size={15} className="text-red-400" title="SMTP not configured or delivery failed"/>}
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">{fmtDT(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
