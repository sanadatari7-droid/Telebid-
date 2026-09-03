import React, { useState, useEffect, useRef } from "react"
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import { useAuthStore } from "../../store/authStore"
import { useQuery } from "@tanstack/react-query"
import { notifApi, searchApi } from "../../services/api"
import {
  XCircle, LayoutDashboard, FileText, ClipboardCheck, BarChart3, Settings, Trophy,
  Users, Bell, LogOut, Search, ChevronDown, BookOpen, Shield,
  Calendar, Eye, History, Globe, Building2, Radio, Antenna,
  Monitor, FileSpreadsheet, Briefcase, Layers, MapPin, X,
  ChevronRight, TrendingUp, Zap, Menu, PanelLeftClose, PanelLeftOpen, Landmark, Sparkles, BookOpen as LibraryIcon
} from "lucide-react"
import clsx from "clsx"

const NAV_SECTIONS = [
  {
    section: null,
    items: [
      { label: "Dashboard",  path: "/dashboard",  icon: LayoutDashboard, badge: null },
    ]
  },
  {
    section: "Bid Management",
    items: [
      { label: "Lost Records",       path: "/lost-records", icon: XCircle },
      { label: "Audit Log",           path: "/audit-log",    icon: Shield },
      { label: "RFP & Bids",         path: "/rfp-bids",    icon: Briefcase },
      { label: "All Bids",            path: "/bids",         icon: FileText },
      { label: "EXPRO / Gov",         path: "/expro",        icon: Antenna },
      { label: "ICT Projects",        path: "/ict",          icon: Monitor },
      { label: "Bonds",               path: "/bonds",        icon: Landmark },
      { label: "Won Records",        path: "/won-records",  icon: Trophy },
      { label: "AI Alerts",           path: "/ai-alerts",    icon: Sparkles },
      { label: "Content Library",     path: "/content-library", icon: LibraryIcon },
      { label: "Opportunities",       path: "/opportunities",icon: TrendingUp },
      { label: "Invitations",         path: "/invitations",  icon: Bell },
    ]
  },
  {
    section: "Evaluation",
    items: [
      { label: "Evaluations",   path: "/evaluations", icon: ClipboardCheck },
      { label: "Approvals",     path: "/approvals",   icon: Shield },
    ]
  },
  {
    section: "Operations",
    items: [
      { label: "Contracts",   path: "/contracts",  icon: BookOpen },
      { label: "Vendors",     path: "/vendors",    icon: Building2 },
      { label: "Calendar",    path: "/calendar",   icon: Calendar },
    ]
  },
  {
    section: "Analytics",
    items: [
      { label: "Reports",     path: "/reports",    icon: BarChart3 },
      { label: "Bid Logs",    path: "/bid-logs",   icon: History },
    ]
  },
  {
    section: "System",
    items: [
      { label: "Company Settings",path: "/company-settings",icon: Building2 },
      { label: "System Settings", path: "/system-settings", icon: Settings },
      { label: "Users",           path: "/users",            icon: Users },
      { label: "Employees",       path: "/employees",        icon: Users },
    ]
  },
]

function QuickSearch({ onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState("")
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)
  const debounce = useRef(null)

  useEffect(() => { ref.current?.focus() }, [])

  useEffect(() => {
    clearTimeout(debounce.current)
    if (q.length < 2) { setResults(null); return }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await searchApi.global(q)
        setResults(r.data)
      } catch {}
      setLoading(false)
    }, 300)
    return () => clearTimeout(debounce.current)
  }, [q])

  const go = (url) => { navigate(url); onClose() }
  const ICONS = { bid: FileText, vendor: Building2, opportunity: Briefcase, contract: BookOpen }
  const COLORS = {
    bid: "text-blue-600 bg-blue-50",
    vendor: "text-green-600 bg-green-50",
    opportunity: "text-amber-600 bg-amber-50",
    contract: "text-purple-600 bg-purple-50"
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center pt-[10vh] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          <Search size={18} className="text-gray-400 flex-shrink-0"/>
          <input ref={ref} className="flex-1 text-sm outline-none placeholder-gray-400 text-gray-900"
            placeholder="Search bids, vendors, contracts, opportunities…"
            value={q} onChange={e => setQ(e.target.value)}/>
          {loading && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16}/></button>
        </div>
        {results && (
          <div className="max-h-80 overflow-y-auto p-2">
            {results.count === 0 ? (
              <div className="text-center py-6 text-sm text-gray-400">No results for "{q}"</div>
            ) : results.results.map((r, i) => {
              const Icon = ICONS[r.entity_type] || FileText
              const color = COLORS[r.entity_type] || "text-gray-600 bg-gray-50"
              return (
                <button key={i} onClick={() => go(r.url)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 text-left transition-colors">
                  <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", color)}>
                    <Icon size={14}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{r.title}</div>
                    <div className="text-xs text-gray-400 truncate">{r.subtitle}</div>
                  </div>
                  <span className="text-xs text-gray-300 capitalize flex-shrink-0">{r.entity_type}</span>
                </button>
              )
            })}
          </div>
        )}
        {!results && q.length < 2 && (
          <div className="p-4">
            <p className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">Quick Links</p>
            <div className="grid grid-cols-2 gap-2">
              {[["New Bid","/bids","blue"],["EXPRO Logs","/expro","amber"],["Contracts","/contracts","green"],["Reports","/reports","purple"]].map(([l,p,c])=>(
                <button key={l} onClick={()=>go(p)}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm text-gray-700 transition-colors">
                  <ChevronRight size={13} className={`text-${c}-500`}/>{l}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-50 flex items-center gap-4 text-xs text-gray-300">
          <span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-400">↑↓</kbd> Navigate</span>
          <span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-400">↵</kbd> Open</span>
          <span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-400">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const { data: unread = 0 } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => notifApi.unreadCount().then(r => r.data?.unread_count || 0),
    refetchInterval: 30000, retry: 1,
  })

  // Keyboard shortcut for search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault(); setShowSearch(true)
      }
      if (e.key === "Escape") setShowSearch(false)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const handleLogout = async () => { await logout(); navigate("/login") }

  // Get breadcrumb label
  const pathParts = location.pathname.split("/").filter(Boolean)
  const breadcrumb = pathParts.map(p => p.charAt(0).toUpperCase() + p.slice(1).replace(/-/g, " "))

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className={clsx("flex items-center gap-3 px-4 py-5 flex-shrink-0", collapsed && "justify-center")}>
        <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
          <Zap size={18} className="text-white"/>
        </div>
        {!collapsed && (
          <div>
            <div className="font-bold text-gray-900 text-sm leading-tight">TeleBid</div>
            <div className="text-[10px] text-gray-400 font-medium tracking-wide">ENTERPRISE</div>
          </div>
        )}
      </div>

      {/* Search trigger */}
      {!collapsed && (
        <div className="px-3 pb-3">
          <button onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-400 hover:bg-gray-100 transition-colors text-xs">
            <Search size={13}/>
            <span className="flex-1 text-left">Search…</span>
            <div className="flex items-center gap-0.5">
              <kbd className="bg-white px-1 rounded text-gray-300 border border-gray-200 text-[10px]">⌘</kbd>
              <kbd className="bg-white px-1 rounded text-gray-300 border border-gray-200 text-[10px]">K</kbd>
            </div>
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {section.section && !collapsed && (
              <div className="px-3 mb-1">
                <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest">
                  {section.section}
                </span>
              </div>
            )}
            {section.items.map(item => {
              const isActive = location.pathname === item.path ||
                (item.path !== "/" && location.pathname.startsWith(item.path))
              const Icon = item.icon
              return (
                <NavLink key={item.path} to={item.path} title={collapsed ? item.label : undefined}
                  className={clsx(
                    "nav-item group",
                    isActive ? "nav-item-active" : "nav-item-inactive",
                    collapsed && "justify-center px-2"
                  )}>
                  <Icon size={16} className="flex-shrink-0"/>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && item.badge != null && item.badge > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className={clsx("flex-shrink-0 border-t border-gray-100 p-3", collapsed && "flex justify-center")}>
        {collapsed ? (
          <button onClick={handleLogout} title="Logout"
            className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
            <LogOut size={16}/>
          </button>
        ) : (
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 group transition-colors">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.full_name?.charAt(0) || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-900 truncate">{user?.full_name}</div>
              <div className="text-[10px] text-gray-400 truncate">{user?.role_name || "User"}</div>
            </div>
            <button onClick={handleLogout} title="Logout"
              className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all">
              <LogOut size={13}/>
            </button>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* ── Desktop Sidebar ────────────────────────────────────── */}
      <aside className={clsx(
        "hidden lg:flex flex-col border-r border-gray-100 bg-white transition-all duration-300 flex-shrink-0 relative",
        collapsed ? "w-16" : "w-60"
      )}>
        <SidebarContent/>
        {/* Collapse toggle */}
        <button onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 shadow-sm transition-colors z-10">
          {collapsed ? <ChevronRight size={12}/> : <ChevronRight size={12} className="rotate-180"/>}
        </button>
      </aside>

      {/* ── Mobile Sidebar Overlay ─────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <SidebarContent/>
          </div>
        </div>
      )}

      {/* ── Main Area ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-4 gap-3 flex-shrink-0 z-10">
          {/* Mobile menu toggle */}
          <button className="lg:hidden btn-icon text-gray-500" onClick={() => setMobileOpen(!mobileOpen)}>
            <Menu size={18}/>
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm flex-1 min-w-0">
            <span className="text-gray-300 text-xs">Home</span>
            {breadcrumb.map((b, i) => (
              <React.Fragment key={i}>
                <ChevronRight size={12} className="text-gray-200 flex-shrink-0"/>
                <span className={clsx("truncate", i === breadcrumb.length - 1 ? "font-semibold text-gray-900" : "text-gray-400 text-xs")}>
                  {b}
                </span>
              </React.Fragment>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setShowSearch(true)}
              className="btn-icon text-gray-400 hover:text-gray-600 hidden sm:flex">
              <Search size={16}/>
            </button>
            <button onClick={() => navigate("/notifications")}
              className="btn-icon text-gray-400 hover:text-gray-600 relative">
              <Bell size={16}/>
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
            <button onClick={() => navigate("/system-settings")}
              className="btn-icon text-gray-400 hover:text-gray-600">
              <Settings size={16}/>
            </button>
            <div className="w-px h-5 bg-gray-100 mx-1"/>
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:bg-blue-700 transition-colors"
              onClick={() => navigate("/users")}>
              {user?.full_name?.charAt(0) || "U"}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="animate-slide-up">
            <Outlet/>
          </div>
        </main>
      </div>

      {/* Global Search */}
      {showSearch && <QuickSearch onClose={() => setShowSearch(false)}/>}
    </div>
  )
}
