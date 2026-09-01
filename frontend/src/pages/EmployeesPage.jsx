import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { empApi } from "../services/api"
import toast from "react-hot-toast"
import {
  Plus, ArrowRight, Trash2, UserCog, Pencil, Check, X,
  Users, Tag, Briefcase, MapPin, ChevronRight
} from "lucide-react"
import clsx from "clsx"

// ── Employee Profile Edit Modal ───────────────────────────────────────────────
function ProfileModal({ emp, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    initials: emp.initials || "",
    job_title: emp.job_title || "",
    sectors_covered: emp.sectors_covered || "",
    employee_type: emp.employee_type || "SALES",
  })
  const fc = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  // Auto-generate initials from full name if blank
  const autoInitials = () => {
    const parts = emp.full_name.trim().split(/\s+/)
    const generated = parts.map(p => p[0]?.toUpperCase() || "").join("")
    setForm(p => ({ ...p, initials: generated }))
  }

  const saveMut = useMutation({
    mutationFn: () => empApi.updateProfile(emp.emp_id, form),
    onSuccess: () => {
      toast.success("Profile updated")
      qc.invalidateQueries({ queryKey: ["emp"] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="font-bold text-gray-900">Edit Employee Profile</h2>
            <p className="text-sm text-gray-400 mt-0.5">{emp.full_name}</p>
          </div>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Initials */}
          <div>
            <label className="label">Initials</label>
            <div className="flex gap-2">
              <input name="initials" className="input font-mono text-center text-lg font-bold tracking-widest"
                value={form.initials} onChange={fc} maxLength={4} placeholder="SA"
                style={{ width: "80px" }}/>
              <button className="btn-secondary btn-sm flex-1 text-xs" onClick={autoInitials}>
                Auto-generate from name
              </button>
            </div>
            <p className="form-hint">Example: Sanad Atari → SA, Ahmad Ali → AA</p>
          </div>

          {/* Job Title */}
          <div>
            <label className="label">Job Title</label>
            <input name="job_title" className="input" value={form.job_title} onChange={fc}
              placeholder="e.g. Senior Sales Engineer"/>
          </div>

          {/* Sectors */}
          <div>
            <label className="label">Sectors Covered</label>
            <input name="sectors_covered" className="input" value={form.sectors_covered} onChange={fc}
              placeholder="e.g. Telecom, Government, Finance"/>
            <p className="form-hint">Separate multiple sectors with commas</p>
          </div>

          {/* Employee Type */}
          <div>
            <label className="label">Employee Type</label>
            <div className="grid grid-cols-4 gap-2">
              {["SALES","PRESALES","MANAGER","ADMIN"].map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, employee_type: t }))}
                  className={clsx("p-2 rounded-xl text-xs font-semibold border transition-all",
                    form.employee_type === t
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50")}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              <Check size={13}/> {saveMut.isPending ? "Saving…" : "Save Profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Employee Card ─────────────────────────────────────────────────────────────
function EmpCard({ emp, onEdit }) {
  const ROLE_COLOR = {
    SALES: "bg-blue-100 text-blue-700",
    PRESALES: "bg-purple-100 text-purple-700",
    MANAGER: "bg-amber-100 text-amber-700",
    ADMIN: "bg-gray-100 text-gray-700",
  }
  const sectors = emp.sectors_covered ? emp.sectors_covered.split(",").map(s => s.trim()).filter(Boolean) : []

  return (
    <div className="card-sm flex items-start gap-4 group">
      {/* Avatar */}
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        {emp.initials || emp.full_name?.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-gray-900">{emp.full_name}</div>
            <div className="text-xs text-gray-400 mt-0.5">{emp.email}</div>
          </div>
          <button className="btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onEdit(emp)}>
            <Pencil size={12}/>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className={clsx("badge text-xs", ROLE_COLOR[emp.employee_type] || "badge-gray")}>
            {emp.employee_type}
          </span>
          {emp.initials && (
            <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">
              {emp.initials}
            </span>
          )}
          {emp.job_title && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Briefcase size={10}/>{emp.job_title}
            </span>
          )}
        </div>

        {sectors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {sectors.map(s => (
              <span key={s} className="text-xs bg-gray-50 border border-gray-100 text-gray-500 px-2 py-0.5 rounded-lg flex items-center gap-1">
                <MapPin size={9}/>{s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EmployeesPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState("all")
  const [editEmp, setEditEmp] = useState(null)
  const [showMap, setShowMap] = useState(false)
  const [mapForm, setMapForm] = useState({ sales_emp_id: "", presales_emp_id: "" })

  const { data: allEmps = [], isLoading } = useQuery({
    queryKey: ["emp", "all"],
    queryFn: () => empApi.list({}).then(r => r.data),
  })
  const { data: mappings = [] } = useQuery({
    queryKey: ["emp-mappings"],
    queryFn: () => empApi.getMappings().then(r => r.data),
  })

  const sales    = allEmps.filter(e => e.employee_type === "SALES")
  const presales = allEmps.filter(e => e.employee_type === "PRESALES")
  const displayed = tab === "all" ? allEmps : tab === "SALES" ? sales : tab === "PRESALES" ? presales : allEmps

  const mapMut = useMutation({
    mutationFn: () => empApi.createMapping({
      sales_emp_id: Number(mapForm.sales_emp_id),
      presales_emp_id: Number(mapForm.presales_emp_id),
    }),
    onSuccess: () => {
      toast.success("Mapping created")
      qc.invalidateQueries({ queryKey: ["emp-mappings"] })
      setShowMap(false)
      setMapForm({ sales_emp_id: "", presales_emp_id: "" })
    },
  })
  const delMapMut = useMutation({
    mutationFn: id => empApi.deleteMapping(id),
    onSuccess: () => { toast.success("Mapping removed"); qc.invalidateQueries({ queryKey: ["emp-mappings"] }) },
  })

  const TABS = [
    { id: "all",      label: "All Employees", count: allEmps.length },
    { id: "SALES",    label: "Sales",         count: sales.length },
    { id: "PRESALES", label: "Pre-Sales",     count: presales.length },
    { id: "mappings", label: "Mappings",      count: mappings.length },
  ]

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">Manage Sales & Pre-Sales team profiles, initials and sector coverage</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowMap(true)}>
          <Plus size={13}/> Create Mapping
        </button>
      </div>

      {/* Info banner */}
      <div className="alert-info text-xs">
        <UserCog size={15} className="flex-shrink-0"/>
        <div>
          <strong>Employee profiles drive automatic population</strong> — When you select an employee in an opportunity,
          their <strong>Initials, Job Title, and Sectors</strong> are automatically filled in.
          Click the ✏️ icon on any employee card to configure their profile.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx("flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
              tab === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-700")}>
            {t.label}
            <span className={clsx("rounded-full text-[10px] font-bold px-1.5 py-0.5",
              tab === t.id ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500")}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Employee grid */}
      {tab !== "mappings" && (
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map(i => <div key={i} className="skeleton h-28"/>)}
            </div>
          ) : displayed.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon mx-auto"><Users size={28}/></div>
              <p className="text-sm text-gray-400">No employees in this category</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayed.map(e => (
                <EmpCard key={e.emp_id} emp={e} onEdit={setEditEmp}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mappings tab */}
      {tab === "mappings" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Sales → Pre-Sales mappings automatically suggest a pre-sales engineer when a sales rep is selected on an opportunity.
          </p>
          {mappings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon mx-auto"><ArrowRight size={28}/></div>
              <p className="text-sm text-gray-400">No mappings configured yet</p>
            </div>
          ) : mappings.map(m => (
            <div key={m.mapping_id} className="card-sm flex items-center gap-4">
              {/* Sales */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                  {m.sales_name?.slice(0,2).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{m.sales_name}</div>
                  <div className="text-xs text-gray-400">{m.sales_email}</div>
                  <span className="badge-blue text-xs mt-0.5">Sales</span>
                </div>
              </div>

              <ChevronRight size={18} className="text-gray-300 flex-shrink-0"/>

              {/* Pre-Sales */}
              <div className="flex items-center gap-3 flex-1">
                <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
                  {m.presales_name?.slice(0,2).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{m.presales_name}</div>
                  <div className="text-xs text-gray-400">{m.presales_email}</div>
                  <span className="badge text-xs mt-0.5 badge-purple">Pre-Sales</span>
                </div>
              </div>

              <button className="btn-ghost btn-sm text-red-400 hover:text-red-600"
                onClick={() => { if (window.confirm("Remove this mapping?")) delMapMut.mutate(m.mapping_id) }}>
                <Trash2 size={13}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create Mapping Modal */}
      {showMap && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-bold text-gray-900">Create Sales → Pre-Sales Mapping</h2>
              <button className="btn-ghost p-2" onClick={() => setShowMap(false)}><X size={16}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Sales Employee</label>
                <select className="input" value={mapForm.sales_emp_id}
                  onChange={e => setMapForm(p => ({ ...p, sales_emp_id: e.target.value }))}>
                  <option value="">Select sales person…</option>
                  {sales.map(e => (
                    <option key={e.emp_id} value={e.emp_id}>
                      {e.full_name}{e.initials ? ` (${e.initials})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Pre-Sales Employee</label>
                <select className="input" value={mapForm.presales_emp_id}
                  onChange={e => setMapForm(p => ({ ...p, presales_emp_id: e.target.value }))}>
                  <option value="">Select pre-sales person…</option>
                  {presales.map(e => (
                    <option key={e.emp_id} value={e.emp_id}>
                      {e.full_name}{e.initials ? ` (${e.initials})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button className="btn-secondary" onClick={() => setShowMap(false)}>Cancel</button>
                <button className="btn-primary"
                  disabled={!mapForm.sales_emp_id || !mapForm.presales_emp_id || mapMut.isPending}
                  onClick={() => mapMut.mutate()}>
                  <Plus size={13}/> {mapMut.isPending ? "Creating…" : "Create Mapping"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editEmp && <ProfileModal emp={editEmp} onClose={() => setEditEmp(null)}/>}
    </div>
  )
}
