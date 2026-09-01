import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { reportsApi } from "../services/api"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { AlertTriangle, Download, FileText, FileSpreadsheet } from "lucide-react"
import clsx from "clsx"
import { exportToPDF, exportToExcel } from "../utils/exportUtils"
import { fmt } from "../utils/fmt"

const COLORS = ["#1e4080","#c8a84b","#16a34a","#dc2626","#9333ea","#06b6d4"]

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState("procurement")

  const { data: summary = [], isLoading: l1 } = useQuery({ queryKey:["report-summary"], queryFn:()=>reportsApi.summary().then(r=>r.data), retry:1 })
  const { data: vendors = [], isLoading: l2 } = useQuery({ queryKey:["report-vendors"], queryFn:()=>reportsApi.vendors().then(r=>r.data), retry:1 })
  const { data: kpis, isLoading: l3 } = useQuery({ queryKey:["report-kpis"], queryFn:()=>reportsApi.kpis().then(r=>r.data), retry:1 })
  const isLoading = l1 || l2 || l3

  const handleExportBids = (format) => {
    const cols = [
      { header:"Status", key:"status_name" },
      { header:"Bid Type", key:"bid_type" },
      { header:"Count", key:"bid_count" },
      { header:"Total Budget", accessor: r => r.total_budget ? `$${Number(r.total_budget).toLocaleString()}` : "—" },
      { header:"Avg Budget", accessor: r => r.avg_budget ? `$${Number(r.avg_budget).toLocaleString()}` : "—" },
    ]
    if (format === "pdf") exportToPDF(summary, cols, "Procurement Summary Report", "procurement_summary")
    else exportToExcel(summary, cols, "procurement_summary")
  }

  const handleExportVendors = (format) => {
    const cols = [
      { header:"Vendor", key:"company_name" },
      { header:"Category", key:"business_category" },
      { header:"Evaluations", key:"evaluations" },
      { header:"Avg Score", key:"avg_eval_score" },
      { header:"Late Deliveries", key:"total_late" },
      { header:"Contracts", key:"total_contracts" },
      { header:"Status", accessor: r => r.is_blacklisted ? "Blacklisted" : "Active" },
    ]
    if (format === "pdf") exportToPDF(vendors, cols, "Vendor Performance Report", "vendor_performance")
    else exportToExcel(vendors, cols, "vendor_performance")
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full"/>
    </div>
  )

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary-800">Reports & Analytics</h1>
          <p className="text-sm text-gray-500">Procurement performance insights and KPIs</p>
        </div>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <div className="text-3xl font-bold text-primary-700">{kpis.award_rate?.rate ?? 0}%</div>
            <div className="text-xs font-semibold text-gray-500 uppercase mt-1 tracking-wide">Award Success Rate</div>
            <div className="text-xs text-gray-400 mt-1">{kpis.award_rate?.awarded} of {kpis.award_rate?.total} bids awarded</div>
          </div>
          {(kpis.dept_activity || []).slice(0,3).map(d => (
            <div key={d.dept_name} className="card">
              <div className="text-sm font-semibold text-gray-700 truncate">{d.dept_name}</div>
              <div className="text-2xl font-bold text-primary-700 mt-1">{d.bid_count}</div>
              <div className="text-xs text-gray-400">bids · ${Number(d.total_budget||0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Report Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex">
          {[["procurement","Procurement Summary"],["vendors","Vendor Performance"],["charts","Charts"]].map(([t,l]) => (
            <button key={t} onClick={() => setActiveReport(t)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeReport===t?"border-primary-500 text-primary-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Procurement Summary */}
      {activeReport === "procurement" && (
        <div className="card p-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Procurement Summary</h3>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => handleExportBids("excel")}>
                <FileSpreadsheet size={13}/> Excel
              </button>
              <button className="btn-primary btn-sm" onClick={() => handleExportBids("pdf")}>
                <FileText size={13}/> PDF
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Status</th><th>Bid Type</th><th>Count</th><th>Total Budget</th><th>Avg Budget</th></tr></thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">No data yet</td></tr>
                ) : summary.map((r,i) => (
                  <tr key={i}>
                    <td className="font-medium">{r.status_name}</td>
                    <td><span className="badge-blue">{r.bid_type}</span></td>
                    <td className="font-bold text-primary-700">{r.bid_count}</td>
                    <td>{r.total_budget ? `$${Number(r.total_budget).toLocaleString()}` : "—"}</td>
                    <td>{r.avg_budget ? `$${Number(r.avg_budget).toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vendor Performance */}
      {activeReport === "vendors" && (
        <div className="card p-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Vendor Performance</h3>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => handleExportVendors("excel")}>
                <FileSpreadsheet size={13}/> Excel
              </button>
              <button className="btn-primary btn-sm" onClick={() => handleExportVendors("pdf")}>
                <FileText size={13}/> PDF
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Category</th><th>Evals</th><th>Avg Score</th><th>Late Deliveries</th><th>Contracts</th><th>Status</th></tr></thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.company_name}>
                    <td className="font-semibold">{v.company_name}</td>
                    <td className="text-sm text-gray-500">{v.business_category || "—"}</td>
                    <td className="text-sm">{v.evaluations || 0}</td>
                    <td>
                      {v.avg_eval_score ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full" style={{width:`${v.avg_eval_score}%`}}/>
                          </div>
                          <span className="text-sm font-medium">{v.avg_eval_score}</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td><span className={clsx("badge",Number(v.total_late)>0?"badge-red":"badge-green")}>{v.total_late||0}</span></td>
                    <td className="text-sm">{v.total_contracts||0}</td>
                    <td>
                      {v.is_blacklisted
                        ? <span className="badge-red flex items-center gap-1"><AlertTriangle size={10}/> Blacklisted</span>
                        : <span className="badge-green">Active</span>}
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400 text-sm">No data yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts */}
      {activeReport === "charts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Bid Count by Status</h3>
            {summary.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary} margin={{left:-20,right:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="status_name" tick={{fontSize:9}} interval={0} angle={-20} textAnchor="end" height={50}/>
                  <YAxis tick={{fontSize:11}}/>
                  <Tooltip/>
                  <Bar dataKey="bid_count" fill="#1e4080" radius={[4,4,0,0]} name="Bids"/>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-60 flex items-center justify-center text-gray-300">No data</div>}
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Vendor Status Split</h3>
            {vendors.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={[
                        { name:"Active", value: vendors.filter(v=>!v.is_blacklisted).length },
                        { name:"Blacklisted", value: vendors.filter(v=>v.is_blacklisted).length },
                      ]}
                      dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                      <Cell fill="#16a34a"/>
                      <Cell fill="#dc2626"/>
                    </Pie>
                    <Tooltip/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex justify-center gap-6 mt-2">
                  <span className="flex items-center gap-1 text-xs text-gray-600"><span className="w-3 h-3 rounded-full bg-green-600 inline-block"/>Active: {vendors.filter(v=>!v.is_blacklisted).length}</span>
                  <span className="flex items-center gap-1 text-xs text-gray-600"><span className="w-3 h-3 rounded-full bg-red-600 inline-block"/>Blacklisted: {vendors.filter(v=>v.is_blacklisted).length}</span>
                </div>
              </>
            ) : <div className="h-60 flex items-center justify-center text-gray-300">No vendors yet</div>}
          </div>

          <div className="card lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Department Activity</h3>
              <button className="btn-secondary btn-sm" onClick={() => exportToExcel(kpis?.dept_activity||[], [{header:"Department",key:"dept_name"},{header:"Bids",key:"bid_count"},{header:"Total Budget",key:"total_budget"}], "dept_activity")}>
                <Download size={13}/> Export
              </button>
            </div>
            {kpis?.dept_activity?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={kpis.dept_activity} margin={{left:-10,right:10}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="dept_name" tick={{fontSize:10}}/>
                  <YAxis tick={{fontSize:10}}/>
                  <Tooltip/>
                  <Bar dataKey="bid_count" fill="#c8a84b" radius={[4,4,0,0]} name="Bids"/>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-48 flex items-center justify-center text-gray-300">No data</div>}
          </div>
        </div>
      )}
    </div>
  )
}
