import React from "react"
import { useQuery } from "@tanstack/react-query"
import { bidsApi, oppsV2Api, notifApi, bondsApi } from "../services/api"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
         PieChart, Pie, Cell, LineChart, Line, AreaChart, Area } from "recharts"
import { FileText, CheckCircle2, Clock, DollarSign, XCircle, AlertCircle,
         Trophy, TrendingUp, TrendingDown, Building2, Zap, Calendar, Bell, ArrowRight, BarChart3 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { fmt } from "../utils/fmt"
import clsx from "clsx"

const PALETTE = ["#3b82f6","#f59e0b","#10b981","#ef4444","#8b5cf6","#06b6d4","#ec4899"]

function KPI({ label, value, sub, icon: Icon, color, trend, onClick }) {
  return (
    <div className={clsx("kpi-card group", onClick && "cursor-pointer hover:shadow-md transition-all")}
      onClick={onClick}>
      <div className={clsx("kpi-icon", color)}>
        <Icon size={20} className="text-white"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="kpi-value">{value ?? <span className="skeleton w-10 h-6 inline-block"/>}</div>
        <div className="kpi-label truncate">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
      {trend != null && (
        <div className={clsx("flex-shrink-0 text-xs font-semibold flex items-center gap-0.5",
          trend >= 0 ? "text-green-500" : "text-red-500")}>
          {trend >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
          {Math.abs(trend)}%
        </div>
      )}
    </div>
  )
}

function DeadlineCard({ opp }) {
  const dt = opp.submission_deadline ? new Date(opp.submission_deadline) : null
  const daysLeft = dt ? Math.ceil((dt - new Date()) / (1000*60*60*24)) : null
  const isOverdue = daysLeft != null && daysLeft < 0
  const isUrgent = daysLeft != null && daysLeft <= 3 && !isOverdue
  return (
    <div className={clsx("flex items-center gap-3 p-3 rounded-xl border transition-colors",
      isOverdue ? "bg-red-50 border-red-100" : isUrgent ? "bg-amber-50 border-amber-100" : "bg-gray-50 border-gray-100")}>
      <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold",
        isOverdue ? "bg-red-500 text-white" : isUrgent ? "bg-amber-500 text-white" : "bg-blue-100 text-blue-700")}>
        {isOverdue ? "!" : daysLeft ?? "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{opp.customer_name || opp.bid_title}</div>
        <div className="text-xs text-gray-400">{opp.opp_number || opp.bid_number}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs font-bold text-gray-500">{dt ? fmt(dt) : "—"}</div>
        <div className={clsx("text-xs font-semibold",
          isOverdue ? "text-red-500" : isUrgent ? "text-amber-500" : "text-gray-400")}>
          {isOverdue ? `${Math.abs(daysLeft)}d late` : `${daysLeft}d left`}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data: bidsData, isLoading: bidsLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => bidsApi.getDashboard().then(r => r.data),
    refetchInterval: 60000, retry: 1,
  })
  const { data: oppsStats } = useQuery({
    queryKey: ["opps-v2-stats"],
    queryFn: () => oppsV2Api.dashboardStats().then(r => r.data),
    retry: 1,
  })
  const { data: upcoming = [] } = useQuery({
    queryKey: ["upcoming-deadlines"],
    queryFn: () => oppsV2Api.upcomingDeadlines(14).then(r => r.data),
    retry: 1,
  })
  const { data: notifData = [] } = useQuery({
    queryKey: ["notifs-recent"],
    queryFn: () => notifApi.list({ page_size: 5 }).then(r => r.data?.items || []),
    retry: 1,
  })

  const kpi   = bidsData?.kpi || {}
  const monthly   = bidsData?.monthly_stats || []
  const typeDist  = bidsData?.type_distribution || []
  const deptSpend = bidsData?.dept_spending || []
  const recent    = bidsData?.recent_activity || []
  const os        = oppsStats?.stats || {}
  const byFamily  = oppsStats?.by_family || []
  const byStatus  = oppsStats?.by_status || []

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Procurement & bid management overview</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => navigate("/rfp-bids")}>
            <FileText size={13}/> New Opportunity
          </button>
          <button className="btn-primary btn-sm" onClick={() => navigate("/bids")}>
            <Zap size={13}/> New Bid
          </button>
        </div>
      </div>


      {/* ── Quick Action Buttons (from dashboard sketch) ─────────────────── */}
      <div className="card-sm">
        <div className="section-title mb-3">Quick Actions</div>
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label:"Company Settings",  path:"/company-settings", color:"bg-gray-700" },
            { label:"New EXPRO Request", path:"/rfp-bids?new=expro", color:"bg-blue-600" },
            { label:"Won EXPRO",         path:"/rfp-bids?status=WON&type=EXPRO", color:"bg-emerald-600" },
            { label:"Lost EXPRO",        path:"/rfp-bids?status=LOST&type=EXPRO", color:"bg-red-600" },
            { label:"NEW RFP",           path:"/rfp-bids?new=rfp", color:"bg-indigo-600" },
            { label:"Won RFPs",          path:"/rfp-bids?status=WON", color:"bg-green-600" },
            { label:"Lost RFPs",         path:"/rfp-bids?status=LOST", color:"bg-red-500" },
            { label:"New Bond",          path:"/bonds?new=true", color:"bg-amber-600" },
          ].map(btn => (
            <button key={btn.label} onClick={()=>navigate(btn.path)}
              className={clsx("flex flex-col items-center justify-center p-3 rounded-xl text-white text-xs font-semibold text-center leading-tight transition-all hover:opacity-90 hover:scale-105 active:scale-95 shadow-sm",btn.color)}>
              {btn.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={()=>navigate("/bonds?type=BID_BOND")}
            className="flex-1 py-2 px-3 rounded-xl bg-amber-500 text-white text-xs font-semibold text-center hover:bg-amber-600 transition-all">
            Bid Bond
          </button>
          <button onClick={()=>navigate("/bonds?type=FINAL_BOND")}
            className="flex-1 py-2 px-3 rounded-xl bg-amber-700 text-white text-xs font-semibold text-center hover:bg-amber-800 transition-all">
            Final Bond
          </button>
        </div>
      </div>

      {/* Bids KPIs */}
      <div>
        <div className="section-title">Bids Overview</div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 gap-3">
          <KPI label="Total Bids"         value={kpi.total_bids}          icon={FileText}     color="bg-blue-600"    onClick={() => navigate("/bids")}/>
          <KPI label="Open Bids"          value={kpi.open_bids}           icon={CheckCircle2} color="bg-indigo-500"  onClick={() => navigate("/bids")}/>
          <KPI label="Awarded"            value={kpi.awarded_bids}        icon={Trophy}       color="bg-emerald-600" onClick={() => navigate("/contracts")}/>
          <KPI label="Upcoming Deadlines" value={kpi.upcoming_deadlines}  icon={AlertCircle}  color="bg-amber-500"   sub="Next 7 days" onClick={() => navigate("/calendar")}/>
        </div>
      </div>

      {/* Opportunities KPIs */}
      {os.total > 0 && (
        <div>
          <div className="section-title">Opportunities Pipeline</div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPI label="Total Opps"    value={os.total}            icon={TrendingUp}   color="bg-slate-600"/>
            <KPI label="Pending"       value={os.pending_approval} icon={Clock}        color="bg-amber-500"/>
            <KPI label="Approved"      value={os.approved}         icon={CheckCircle2} color="bg-blue-600"/>
            <KPI label="Won 🎉"        value={os.won}              icon={Trophy}       color="bg-emerald-600"/>
            <KPI label="Lost"          value={os.lost}             icon={XCircle}      color="bg-red-500"/>
            <KPI label="Win Rate"      value={os.win_rate!=null?`${os.win_rate}%`:"—"} icon={TrendingUp} color="bg-purple-600"/>
          </div>
          {os.win_rate != null && (
            <div className="mt-3 card-sm flex items-center gap-4">
              <div className="text-sm font-medium text-gray-500">Pipeline Win Rate</div>
              <div className="flex-1 progress">
                <div className="progress-bar bg-emerald-500" style={{ width: `${os.win_rate}%` }}/>
              </div>
              <div className="text-sm font-bold text-emerald-600">{os.win_rate}%</div>
              <div className="text-xs text-gray-400">
                TCV Won: <strong>${Number(os.total_tcv_won||0).toLocaleString()}</strong> of
                Pipeline: <strong>${Number(os.total_tcv_pipeline||0).toLocaleString()}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Monthly Activity */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Monthly Bid Activity</h3>
              <p className="text-xs text-gray-400 mt-0.5">Bids created per month</p>
            </div>
          </div>
          {monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthly} margin={{ left:-20, right:5, top:5 }}>
                <defs>
                  <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15}/>
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                <XAxis dataKey="month" tick={{ fontSize:11, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize:11, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{ borderRadius:"12px", border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.1)", fontSize:"12px" }}/>
                <Area type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} fill="url(#blueGrad)" name="Bids"/>
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-gray-300">
              <BarChart3 size={32} className="mb-2 opacity-30"/>
              <span className="text-sm">Create bids to see activity</span>
            </div>
          )}
        </div>

        {/* Bid Type Distribution */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Bid Type Split</h3>
          <p className="text-xs text-gray-400 mb-4">Distribution by type</p>
          {typeDist.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={typeDist} dataKey="count" nameKey="type_name" cx="50%" cy="50%"
                    innerRadius={40} outerRadius={68} paddingAngle={3}>
                    {typeDist.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} strokeWidth={0}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius:"10px", border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.1)", fontSize:"12px" }}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {typeDist.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PALETTE[i % PALETTE.length] }}/>
                    <span className="text-gray-600 flex-1 truncate">{t.type_name}</span>
                    <span className="font-semibold text-gray-900">{t.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-gray-300">
              <PieChart size={32} className="mb-2 opacity-30"/>
              <span className="text-sm">No data yet</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Upcoming Deadlines */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Upcoming Deadlines</h3>
              <p className="text-xs text-gray-400">Next 14 days</p>
            </div>
            <button onClick={() => navigate("/calendar")} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              Calendar <ArrowRight size={11}/>
            </button>
          </div>
          <div className="space-y-2">
            {upcoming.length === 0 && (
              <div className="empty-state py-8">
                <div className="empty-icon mx-auto"><Calendar size={24}/></div>
                <p className="text-sm text-gray-400">No upcoming deadlines</p>
              </div>
            )}
            {upcoming.slice(0,5).map((d, i) => (
              <DeadlineCard key={i} opp={d}/>
            ))}
          </div>
        </div>

        {/* Department Spending */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Department Activity</h3>
              <p className="text-xs text-gray-400">Budget allocation</p>
            </div>
          </div>
          <div className="space-y-3">
            {deptSpend.length > 0 ? deptSpend.slice(0,6).map((d, i) => {
              const max = Number(deptSpend[0]?.total_budget) || 1
              const pct = Math.round((Number(d.total_budget || 0) / max) * 100)
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-gray-700 truncate max-w-[140px]">{d.dept_name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="badge-gray">{d.bid_count}</span>
                      <span className="text-gray-400">{pct}%</span>
                    </div>
                  </div>
                  <div className="progress">
                    <div className="progress-bar" style={{ width:`${pct}%`, background: PALETTE[i % PALETTE.length] }}/>
                  </div>
                </div>
              )
            }) : (
              <div className="empty-state py-8">
                <div className="empty-icon mx-auto"><Building2 size={24}/></div>
                <p className="text-sm text-gray-400">No department data</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Bids */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Recent Bids</h3>
              <p className="text-xs text-gray-400">Latest activity</p>
            </div>
            <button onClick={() => navigate("/bids")} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              All bids <ArrowRight size={11}/>
            </button>
          </div>
          <div className="space-y-2">
            {recent.length === 0 ? (
              <div className="empty-state py-8">
                <div className="empty-icon mx-auto"><FileText size={24}/></div>
                <p className="text-sm text-gray-400">No bids yet</p>
              </div>
            ) : recent.slice(0, 6).map(b => (
              <div key={b.bid_id}
                onClick={() => navigate(`/bids/${b.bid_id}`)}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-semibold text-blue-600">{b.bid_number}</div>
                  <div className="text-sm font-medium text-gray-900 truncate">{b.bid_title}</div>
                </div>
                <div className="flex-shrink-0">
                  <span className="badge" style={{ background:(b.color_hex||"#64748b")+"20", color:b.color_hex||"#64748b" }}>
                    {b.status_name}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Solution Family Chart (if opps data available) */}
      {byFamily.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 text-sm mb-4">Opportunities by Solution Family</h3>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={byFamily} layout="vertical" margin={{ left:0, right:20 }}>
              <XAxis type="number" tick={{ fontSize:11, fill:"#94a3b8" }} axisLine={false} tickLine={false}/>
              <YAxis type="category" dataKey="family_name" tick={{ fontSize:11, fill:"#64748b" }} axisLine={false} tickLine={false} width={100}/>
              <Tooltip contentStyle={{ borderRadius:"10px", border:"none", boxShadow:"0 4px 20px rgba(0,0,0,0.1)", fontSize:"12px" }}/>
              <Bar dataKey="count" fill="#3b82f6" radius={[0,4,4,0]} name="Opportunities"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
