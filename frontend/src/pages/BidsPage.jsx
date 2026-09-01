import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { bidsApi, watchlistApi } from "../services/api"
import { fmt } from "../utils/fmt"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Plus, Search, Eye, Copy, RefreshCw, ChevronLeft, ChevronRight, FileText, Star } from "lucide-react"

const DL = { GREEN:"text-green-600", ORANGE:"text-amber-600", RED:"text-red-600", GRAY:"text-gray-400" }
const DOT = { GREEN:"bg-green-500", ORANGE:"bg-amber-500", RED:"bg-red-500", GRAY:"bg-gray-400" }

const INITIAL_FORM = {
  bid_title: "", bid_type_id: "", bid_source: "",
  budget: "", currency_id: "1", description: "", submission_deadline: "",
  customer_name: "", organization: "", module_code: "", is_government: false,
  location_city: "", location_country: ""
}

export default function BidsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [moduleFilter, setModuleFilter] = useState("")
  const [budgetMin, setBudgetMin] = useState("")
  const [budgetMax, setBudgetMax] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [form, setForm] = useState(INITIAL_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["bids", page, search, statusFilter, typeFilter, moduleFilter],
    queryFn: () => bidsApi.list({
      page, page_size: 20,
      search: search || undefined,
      status_code: statusFilter || undefined,
      bid_type: typeFilter || undefined,
      module: moduleFilter || undefined
    }).then(r => r.data),
    retry: 1,
  })

  const handleFormChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    if (formErrors[e.target.name]) {
      setFormErrors(prev => ({ ...prev, [e.target.name]: "" }))
    }
  }

  const validateForm = () => {
    const errors = {}
    if (!form.bid_title.trim()) errors.bid_title = "Bid title is required"
    if (!form.bid_type_id) errors.bid_type_id = "Please select a bid type"
    if (!form.bid_source) errors.bid_source = "Please select a bid source"
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleCreate = async () => {
    if (!validateForm()) return
    setCreating(true)
    try {
      const payload = {
        bid_title: form.bid_title.trim(),
        bid_type_id: parseInt(form.bid_type_id),
        bid_source: form.bid_source,
        currency_id: parseInt(form.currency_id) || 1,
        budget: form.budget ? parseFloat(form.budget) : null,
        description: form.description.trim() || null,
        submission_deadline: form.submission_deadline || null,
      }
      await bidsApi.create(payload)
      toast.success("Bid created successfully!")
      qc.invalidateQueries({ queryKey: ["bids"] })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      setShowCreate(false)
      setForm(INITIAL_FORM)
    } catch (err) {
      const msg = err?.response?.data?.detail || "Failed to create bid"
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg))
    } finally {
      setCreating(false)
    }
  }

  const handleClone = async (bid) => {
    const title = window.prompt("New bid title:", `Copy of ${bid.bid_title}`)
    if (!title) return
    try {
      await bidsApi.clone(bid.bid_id, { title })
      toast.success("Bid cloned!")
      qc.invalidateQueries({ queryKey: ["bids"] })
    } catch { }
  }

  const watchMut = useMutation({
    mutationFn: bidId => watchlistApi.add(bidId),
    onSuccess: () => { toast.success("Added to watchlist"); qc.invalidateQueries({ queryKey: ["watchlist"] }) },
    onError: err => {
      const msg = err?.response?.data?.detail
      toast.error(err?.response?.status === 409 ? "Already in watchlist" : (typeof msg === "string" ? msg : "Failed to add to watchlist"))
    }
  })

  const items = data?.items || []

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary-800">Bids & Tenders</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} total records</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={15}/> Create Bid
        </button>
      </div>

      {/* Filters */}
      <div className="card py-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9 py-2" placeholder="Search bids…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
          </div>
          <select className="input w-auto py-2" value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">All Statuses</option>
            {["DRAFT","PENDING_APPROVAL","APPROVED","PUBLISHED","OPEN","CLOSED","TECH_EVAL","FIN_EVAL","AWARDED","CANCELLED","ARCHIVED"].map(s => (
              <option key={s} value={s}>{s.replace(/_/g," ")}</option>
            ))}
          </select>
          <select className="input w-auto py-2" value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1) }}>
            <option value="">All Types</option>
            {["RFQ","RFP","RFI","TENDER","BID"].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="input w-auto py-2" value={moduleFilter}
            onChange={e => { setModuleFilter(e.target.value); setPage(1) }}>
            <option value="">All Modules</option>
            <option value="TELECOM_EXPRO">Telecom — EXPRO/Gov</option>
            <option value="TELECOM_NONGOVT">Telecom — Non-Gov</option>
            <option value="NON_TELECOM">Non-Telecom / ICT</option>
          </select>
          <button className="btn-ghost py-2" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? "▲" : "▼"} Advanced
          </button>
          <button className="btn-ghost py-2" onClick={() => { setSearch(""); setStatusFilter(""); setTypeFilter(""); setBudgetMin(""); setBudgetMax(""); setDateFrom(""); setDateTo(""); setModuleFilter(""); setPage(1) }}>
            <RefreshCw size={13}/> Reset
          </button>
        </div>
      {showAdvanced && (
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Budget Min ($)</label>
            <input type="number" className="input py-1.5 text-sm" placeholder="0" value={budgetMin} onChange={e=>setBudgetMin(e.target.value)}/>
          </div>
          <div>
            <label className="label">Budget Max ($)</label>
            <input type="number" className="input py-1.5 text-sm" placeholder="999999" value={budgetMax} onChange={e=>setBudgetMax(e.target.value)}/>
          </div>
          <div>
            <label className="label">Created From</label>
            <input type="date" className="input py-1.5 text-sm" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
          </div>
          <div>
            <label className="label">Created To</label>
            <input type="date" className="input py-1.5 text-sm" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
          </div>
        </div>
      )}
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Bid #</th><th>Title</th><th>Module</th><th>Customer</th><th>Budget</th>
                <th>Deadline</th><th>Status</th><th>Created</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-12">
                  <div className="inline-block animate-spin w-6 h-6 border-4 border-primary-500 border-t-transparent rounded-full"/>
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">
                  <FileText size={32} className="mx-auto mb-2 opacity-20"/>
                  No bids found
                </td></tr>
              ) : items.map(bid => {
                const dc = DL[bid.deadline_color] || DL.GRAY
                const dotc = DOT[bid.deadline_color] || DOT.GRAY
                return (
                  <tr key={bid.bid_id}>
                    <td>
                      <span className="font-mono text-xs font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
                        {bid.bid_number}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-gray-800 max-w-[200px] truncate">{bid.bid_title}</div>
                    </td>
                    <td>
                      {bid.module_code
                        ? <span className="badge text-xs" style={{background: bid.module_code==="TELECOM_EXPRO"?"#fef3c7":bid.module_code==="TELECOM_NONGOVT"?"#dbeafe":"#dcfce7", color: bid.module_code==="TELECOM_EXPRO"?"#92400e":bid.module_code==="TELECOM_NONGOVT"?"#1e40af":"#166534"}}>{bid.module_code==="TELECOM_EXPRO"?"EXPRO/Gov":bid.module_code==="TELECOM_NONGOVT"?"Non-Gov":"ICT"}</span>
                        : <span className="badge-blue">{bid.bid_type_code}</span>}
                    </td>
                    <td className="text-sm text-gray-500 max-w-[120px] truncate">{bid.customer_name||"—"}</td>
                    <td className="text-sm font-medium">
                      {bid.budget ? `${bid.symbol || "$"}${Number(bid.budget).toLocaleString()}` : "—"}
                    </td>
                    <td>
                      {bid.submission_deadline ? (
                        <span className={`flex items-center gap-1 text-xs font-medium ${dc}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotc}`}/>
                          {fmt(bid.submission_deadline)}
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      <span className="badge" style={{ background: (bid.color_hex || "#9CA3AF") + "22", color: bid.color_hex || "#9CA3AF" }}>
                        {bid.status_name}
                      </span>
                    </td>
                    <td className="text-xs text-gray-400">{fmt(bid.created_at)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn-ghost btn-sm" title="View" onClick={() => navigate(`/bids/${bid.bid_id}`)}>
                          <Eye size={13}/>
                        </button>
                        <button className="btn-ghost btn-sm" title="Clone" onClick={() => handleClone(bid)}>
                          <Copy size={13}/>
                        </button>
                        <button className="btn-ghost btn-sm" title="Add to watchlist"
                          disabled={watchMut.isPending} onClick={() => watchMut.mutate(bid.bid_id)}>
                          <Star size={13}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              {((page-1)*20)+1}–{Math.min(page*20, data.total)} of {data.total}
            </span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p-1)}>
                <ChevronLeft size={13}/>
              </button>
              {Array.from({ length: Math.min(5, data.total_pages) }, (_, i) => i+1).map(p => (
                <button key={p} className={`btn-sm rounded-lg w-8 ${p === page ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="btn-ghost btn-sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p+1)}>
                <ChevronRight size={13}/>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Bid Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-primary-800">Create New Bid</h2>
              <button className="btn-ghost p-2" onClick={() => { setShowCreate(false); setForm(INITIAL_FORM); setFormErrors({}) }}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="label">Bid Title <span className="text-red-500">*</span></label>
                <input
                  name="bid_title"
                  value={form.bid_title}
                  onChange={handleFormChange}
                  className={clsx("input", formErrors.bid_title && "border-red-400")}
                  placeholder="e.g. Network Equipment Supply 2026"
                />
                {formErrors.bid_title && <p className="text-xs text-red-500 mt-1">{formErrors.bid_title}</p>}
              </div>

              {/* Type + Source */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Bid Type <span className="text-red-500">*</span></label>
                  <select
                    name="bid_type_id"
                    value={form.bid_type_id}
                    onChange={handleFormChange}
                    className={clsx("input", formErrors.bid_type_id && "border-red-400")}
                  >
                    <option value="">Select type…</option>
                    <option value="1">RFQ — Request for Quotation</option>
                    <option value="2">RFP — Request for Proposal</option>
                    <option value="3">RFI — Request for Information</option>
                    <option value="4">Public Tender</option>
                    <option value="5">General Bid</option>
                  </select>
                  {formErrors.bid_type_id && <p className="text-xs text-red-500 mt-1">{formErrors.bid_type_id}</p>}
                </div>
                <div>
                  <label className="label">Bid Source <span className="text-red-500">*</span></label>
                  <select
                    name="bid_source"
                    value={form.bid_source}
                    onChange={handleFormChange}
                    className={clsx("input", formErrors.bid_source && "border-red-400")}
                  >
                    <option value="">Select source…</option>
                    <option value="EMAIL">Email</option>
                    <option value="INVITATION">Customer Invitation</option>
                    <option value="PORTAL">Public Portal</option>
                    <option value="OTHER">Other</option>
                  </select>
                  {formErrors.bid_source && <p className="text-xs text-red-500 mt-1">{formErrors.bid_source}</p>}
                </div>
              </div>

              {/* Budget + Currency */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Budget</label>
                  <input
                    name="budget"
                    value={form.budget}
                    onChange={handleFormChange}
                    type="number"
                    min="0"
                    className="input"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select name="currency_id" value={form.currency_id} onChange={handleFormChange} className="input">
                    <option value="1">USD — US Dollar</option>
                    <option value="2">JOD — Jordanian Dinar</option>
                    <option value="3">SAR — Saudi Riyal</option>
                    <option value="4">AED — UAE Dirham</option>
                    <option value="5">EUR — Euro</option>
                  </select>
                </div>
              </div>

              {/* Deadline */}
              <div>
                <label className="label">Submission Deadline</label>
                <input
                  name="submission_deadline"
                  value={form.submission_deadline}
                  onChange={handleFormChange}
                  type="datetime-local"
                  className="input"
                />
              </div>

              {/* Customer + Organization */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Customer / Client</label>
                  <input name="customer_name" value={form.customer_name} onChange={handleFormChange} className="input" placeholder="e.g. Ministry of Energy"/>
                </div>
                <div>
                  <label className="label">Organization</label>
                  <input name="organization" value={form.organization} onChange={handleFormChange} className="input" placeholder="e.g. EXPRO"/>
                </div>
              </div>

              {/* Module + Government */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Bid Module</label>
                  <select name="module_code" value={form.module_code} onChange={handleFormChange} className="input">
                    <option value="">Not specified</option>
                    <option value="TELECOM_EXPRO">Telecom — EXPRO / Government</option>
                    <option value="TELECOM_NONGOVT">Telecom — Non-Government</option>
                    <option value="NON_TELECOM">Non-Telecom / ICT</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 mt-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.is_government} onChange={e => setForm(p=>({...p,is_government:e.target.checked}))} className="w-4 h-4 accent-primary-500"/>
                    <span className="font-medium text-gray-700">Government Bid</span>
                  </label>
                </div>
              </div>

              {/* Location */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">City</label>
                  <input name="location_city" value={form.location_city} onChange={handleFormChange} className="input" placeholder="e.g. Amman"/>
                </div>
                <div>
                  <label className="label">Country</label>
                  <input name="location_country" value={form.location_country} onChange={handleFormChange} className="input" placeholder="e.g. Jordan"/>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="label">Description</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleFormChange}
                  className="input"
                  rows={3}
                  placeholder="Brief scope description…"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3 justify-end pt-2 border-t border-gray-100">
                <button className="btn-secondary"
                  onClick={() => { setShowCreate(false); setForm(INITIAL_FORM); setFormErrors({}) }}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleCreate} disabled={creating}>
                  {creating ? "Creating…" : "Create Bid"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
