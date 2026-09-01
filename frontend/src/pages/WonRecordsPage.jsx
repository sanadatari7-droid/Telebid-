import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { wonRecordsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { exportToExcel } from "../utils/exportUtils"
import clsx from "clsx"
import toast from "react-hot-toast"
import {
  Trophy, Search, Download, Eye, RefreshCw, ChevronLeft, ChevronRight,
  FileText, DollarSign, TrendingUp, CheckCircle2, Clock, X, Pencil, Check,
  AlertCircle, Info
} from "lucide-react"

const INVOICE_STYLE = {
  NOT_INVOICED: "badge-gray",
  PARTIAL:      "badge-amber",
  INVOICED:     "badge-blue",
  PAID:         "badge-green",
}

// ── WON Record Detail Modal ───────────────────────────────────────────────────
function WonDetailModal({ wonId, onClose }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})

  const { data, isLoading } = useQuery({
    queryKey: ["won-detail", wonId],
    queryFn: () => wonRecordsApi.get(wonId).then(r => r.data),
  })

  const won = data?.won_record
  const fc = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  React.useEffect(() => {
    if (won && !editing) setForm({
      po_number: won.po_number || "",
      po_date: won.po_date || "",
      order_number: won.order_number || "",
      order_summary: won.order_summary || "",
      discount_applied: won.discount_applied || "",
      invoice_status: won.invoice_status || "NOT_INVOICED",
      invoice_number: won.invoice_number || "",
      invoice_date: won.invoice_date || "",
      invoice_amount: won.invoice_amount || "",
      payment_terms: won.payment_terms || "",
      bid_person_notes: won.bid_person_notes || "",
    })
  }, [won, editing])

  const updateMut = useMutation({
    mutationFn: () => wonRecordsApi.update(wonId, {
      ...form,
      discount_applied: form.discount_applied ? Number(form.discount_applied) : null,
      invoice_amount: form.invoice_amount ? Number(form.invoice_amount) : null,
    }),
    onSuccess: () => {
      toast.success("WON record updated")
      qc.invalidateQueries({ queryKey: ["won-detail", wonId] })
      qc.invalidateQueries({ queryKey: ["won-records"] })
      qc.invalidateQueries({ queryKey: ["won-stats"] })
      setEditing(false)
    }
  })

  const sym = won?.symbol || "$"

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b bg-emerald-50 rounded-t-2xl sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2">
              <Trophy size={18} className="text-emerald-600"/>
              <span className="font-mono text-sm font-bold text-emerald-700">{won?.won_number}</span>
              <span className="badge-green text-xs">{won?.won_status}</span>
            </div>
            <h2 className="font-bold text-gray-900 text-lg mt-1">{won?.customer_name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Opp: {data?.won_record?.opp_number}</p>
          </div>
          <div className="flex items-center gap-2">
            {!editing && (
              <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Pencil size={13}/> Edit
              </button>
            )}
            <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="skeleton h-16"/>)}</div>
          ) : (
            <>
              {/* ── COPIED FROM OPPORTUNITY (read-only) ──────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="section-title mb-0">Opportunity Information</div>
                  <span className="badge-gray text-xs flex items-center gap-1">
                    <Info size={10}/> Copied — Read Only
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    ["EXPRO Ref",      won?.expro_ref],
                    ["PO #",           won?.po_number],
                    ["Customer",       won?.customer_name],
                    ["Media",          won?.media_type],
                    ["SLA",            won?.sla_type],
                    ["Bandwidth",      won?.bandwidth_mbps ? `${won.bandwidth_mbps} Mbps` : null],
                    ["Quantity",       won?.quantity],
                    ["SOW",            won?.solution_detail || won?.sow_detail],
                    ["Solution",       won?.solution_name],
                    ["Contract",       won?.contract_duration],
                    ["NRC",            won?.nrc ? `${sym}${Number(won.nrc).toLocaleString()}` : null],
                    ["MRC",            won?.mrc ? `${sym}${Number(won.mrc).toLocaleString()}` : null],
                    ["Original TCV",   won?.tcv ? `${sym}${Number(won.tcv).toLocaleString()}` : null],
                    ["Sales Rep",      won?.sales_rep_name],
                    ["Pre-Sales",      won?.presales_name],
                    ["Bid Manager",    won?.bid_manager_name],
                  ].filter(([,v]) => v).map(([k,v]) => (
                    <div key={k} className="bg-gray-50 rounded-xl p-3">
                      <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt>
                      <dd className="font-medium text-sm mt-0.5 text-gray-900">{v}</dd>
                    </div>
                  ))}
                </div>
                {won?.sow_detail && won.sow_detail !== won.solution_detail && (
                  <div className="mt-3 bg-gray-50 rounded-xl p-3">
                    <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Scope of Work</dt>
                    <dd className="text-sm text-gray-700">{won.sow_detail}</dd>
                  </div>
                )}
              </div>

              {/* Financial Summary */}
              {(won?.tcv || won?.discount_applied || won?.final_value) && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ["Original TCV",    won?.tcv,              "bg-blue-50 border-blue-100 text-blue-800"],
                    ["Discount Applied", won?.discount_applied ? `${won.discount_applied}%  (−${sym}${Number(won.discount_amount||0).toLocaleString()})` : "None", "bg-amber-50 border-amber-100 text-amber-800"],
                    ["Final Value",     won?.final_value || won?.tcv, "bg-emerald-50 border-emerald-200 text-emerald-800"],
                  ].map(([k, v, style]) => (
                    <div key={k} className={clsx("rounded-xl border p-4 text-center", style)}>
                      <div className="text-xs font-semibold opacity-60 uppercase tracking-wide mb-1">{k}</div>
                      <div className="font-bold text-lg">
                        {typeof v === "number" ? `${sym}${Number(v).toLocaleString()}` : v || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── BID PERSON FIELDS ─────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="section-title mb-0">WON Record — Bid Person Fields</div>
                  {editing && <span className="badge-blue text-xs">Editing</span>}
                </div>

                {editing ? (
                  <div className="space-y-4">
                    <div className="alert-info text-xs">
                      Fill in the required WON-specific information below. Fields marked * are required.
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label label-required">Won Date</label>
                        <input name="won_date" type="date" className="input bg-gray-50" value={won?.won_date||""} readOnly/>
                        <p className="form-hint">Set when opportunity was marked Won</p>
                      </div>
                      <div>
                        <label className="label">PO Date</label>
                        <input name="po_date" type="date" className="input" value={form.po_date} onChange={fc}/>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">PO Number</label>
                        <input name="po_number" className="input" value={form.po_number} onChange={fc}/>
                      </div>
                      <div>
                        <label className="label">Order Number</label>
                        <input name="order_number" className="input" value={form.order_number} onChange={fc}/>
                      </div>
                      <div>
                        <label className="label">Discount Applied (%)</label>
                        <input name="discount_applied" type="number" className="input" min="0" max="100" step="0.01"
                          value={form.discount_applied} onChange={fc} placeholder="e.g. 10.5"/>
                        {form.discount_applied && won?.tcv && (
                          <p className="form-hint">
                            Discount: {sym}{Math.round(Number(won.tcv) * Number(form.discount_applied) / 100).toLocaleString()} →
                            Final: {sym}{Math.round(Number(won.tcv) * (1 - Number(form.discount_applied)/100)).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="label">Order Summary</label>
                      <textarea name="order_summary" className="input" rows={2} value={form.order_summary} onChange={fc}/>
                    </div>
                    <div className="section-title mt-2">Invoice Information</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Invoice Status</label>
                        <select name="invoice_status" className="input" value={form.invoice_status} onChange={fc}>
                          {["NOT_INVOICED","PARTIAL","INVOICED","PAID"].map(s=>(
                            <option key={s} value={s}>{s.replace("_"," ")}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Invoice Number</label>
                        <input name="invoice_number" className="input" value={form.invoice_number} onChange={fc}/>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Invoice Date</label>
                        <input name="invoice_date" type="date" className="input" value={form.invoice_date} onChange={fc}/>
                      </div>
                      <div>
                        <label className="label">Invoice Amount</label>
                        <input name="invoice_amount" type="number" className="input" value={form.invoice_amount} onChange={fc}/>
                      </div>
                    </div>
                    <div>
                      <label className="label">Payment Terms</label>
                      <input name="payment_terms" className="input" value={form.payment_terms} onChange={fc} placeholder="e.g. Net 30, 50% upfront"/>
                    </div>
                    <div>
                      <label className="label">Bid Person Notes</label>
                      <textarea name="bid_person_notes" className="input" rows={2} value={form.bid_person_notes} onChange={fc}/>
                    </div>
                    <div className="flex gap-3 justify-end">
                      <button className="btn-secondary" onClick={()=>setEditing(false)}>Cancel</button>
                      <button className="btn-success" disabled={updateMut.isPending} onClick={()=>updateMut.mutate()}>
                        <Check size={13}/> {updateMut.isPending ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      ["Won Date",      won?.won_date ? fmt(won.won_date) : null],
                      ["PO Number",     won?.po_number],
                      ["PO Date",       won?.po_date ? fmt(won.po_date) : null],
                      ["Order #",       won?.order_number],
                      ["Discount",      won?.discount_applied ? `${won.discount_applied}%` : null],
                      ["Disc. Amount",  won?.discount_amount ? `${sym}${Number(won.discount_amount).toLocaleString()}` : null],
                      ["Final Value",   won?.final_value ? `${sym}${Number(won.final_value).toLocaleString()}` : null],
                      ["Invoice #",     won?.invoice_number],
                      ["Invoice Date",  won?.invoice_date ? fmt(won.invoice_date) : null],
                      ["Invoice Amt",   won?.invoice_amount ? `${sym}${Number(won.invoice_amount).toLocaleString()}` : null],
                      ["Payment Terms", won?.payment_terms],
                    ].filter(([,v]) => v).map(([k,v]) => (
                      <div key={k} className="bg-emerald-50 rounded-xl p-3">
                        <dt className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">{k}</dt>
                        <dd className="font-medium text-sm mt-0.5 text-gray-900">{v}</dd>
                      </div>
                    ))}
                    {won?.invoice_status && (
                      <div className="bg-emerald-50 rounded-xl p-3">
                        <dt className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Invoice Status</dt>
                        <dd className="mt-1"><span className={clsx("badge text-xs", INVOICE_STYLE[won.invoice_status]||"badge-gray")}>{won.invoice_status?.replace("_"," ")}</span></dd>
                      </div>
                    )}
                    {won?.bid_person_notes && (
                      <div className="col-span-full bg-emerald-50 rounded-xl p-3">
                        <dt className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-1">Notes</dt>
                        <dd className="text-sm text-gray-700">{won.bid_person_notes}</dd>
                      </div>
                    )}
                    {won?.order_summary && (
                      <div className="col-span-full bg-emerald-50 rounded-xl p-3">
                        <dt className="text-xs font-semibold text-emerald-600 uppercase tracking-wide mb-1">Order Summary</dt>
                        <dd className="text-sm text-gray-700">{won.order_summary}</dd>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Audit Trail */}
              {data?.audit_trail?.length > 0 && (
                <div>
                  <div className="section-title">Audit Trail</div>
                  <div className="space-y-1">
                    {data.audit_trail.map(l => (
                      <div key={l.log_id} className="flex items-center gap-3 text-xs py-2 border-b border-gray-50">
                        <span className="text-gray-400 w-28 flex-shrink-0">{fmt(l.performed_at, "dd MMM HH:mm")}</span>
                        <span className="badge-blue">{l.action.replace(/_/g," ")}</span>
                        <span className="text-gray-600">{l.performed_by_name}</span>
                        {l.comments && <span className="text-gray-400 truncate">{l.comments}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WonRecordsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [invFilter, setInvFilter] = useState("")
  const [showDetail, setShowDetail] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ["won-records", page, search, invFilter],
    queryFn: () => wonRecordsApi.list({ page, page_size: 20, search: search || undefined, invoice_status: invFilter || undefined }).then(r => r.data),
    retry: 1,
  })
  const { data: stats } = useQuery({ queryKey: ["won-stats"], queryFn: () => wonRecordsApi.stats().then(r => r.data), retry: 1 })

  const items = data?.items || []

  const handleExport = () => {
    exportToExcel(items, [
      { header: "WON #",           key: "won_number" },
      { header: "Opp #",           key: "opp_number" },
      { header: "EXPRO Ref",       key: "expro_ref" },
      { header: "PO #",            key: "po_number" },
      { header: "Customer",        key: "customer_name" },
      { header: "Media",           key: "media_type" },
      { header: "SLA",             key: "sla_type" },
      { header: "BW (Mbps)",       key: "bandwidth_mbps" },
      { header: "QTY",             key: "quantity" },
      { header: "SOW",             key: "solution_detail" },
      { header: "TCV",             key: "tcv" },
      { header: "Discount %",      key: "discount_applied" },
      { header: "Final Value",     key: "final_value" },
      { header: "Won Date",        accessor: r => r.won_date ? fmt(r.won_date) : "" },
      { header: "PO Date",         accessor: r => r.po_date ? fmt(r.po_date) : "" },
      { header: "Order #",         key: "order_number" },
      { header: "Invoice Status",  key: "invoice_status" },
      { header: "Invoice #",       key: "invoice_number" },
      { header: "Payment Terms",   key: "payment_terms" },
      { header: "Sales Rep",       key: "sales_rep_name" },
      { header: "Bid Manager",     key: "bid_manager_name" },
    ], "won-opportunities")
    toast.success("Exported to Excel")
  }

  const KPI = [
    { label: "Total Won",       val: stats?.total || 0,                                  color: "bg-emerald-600" },
    { label: "Total TCV",       val: stats?.total_tcv ? `$${Number(stats.total_tcv).toLocaleString()}` : "—",    color: "bg-blue-600" },
    { label: "Total Final",     val: stats?.total_final_value ? `$${Number(stats.total_final_value).toLocaleString()}` : "—", color: "bg-indigo-600" },
    { label: "Paid",            val: stats?.paid || 0,                                   color: "bg-green-600" },
    { label: "Invoiced",        val: stats?.invoiced || 0,                               color: "bg-blue-500" },
    { label: "Not Invoiced",    val: stats?.not_invoiced || 0,                           color: "bg-gray-500" },
  ]

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Trophy size={24} className="text-emerald-600"/> Won Opportunities</h1>
          <p className="page-subtitle">WON records with copied opportunity data and Bid Person inputs</p>
        </div>
        <button className="btn-secondary btn-sm" onClick={handleExport}><Download size={13}/> Export Excel</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {KPI.map(k => (
          <div key={k.label} className="card-sm text-center">
            <div className={clsx("w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center text-white text-xs font-bold", k.color)}>{k.val}</div>
            <div className="text-xs font-medium text-gray-400">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Outstanding revenue */}
      {stats?.total_outstanding > 0 && (
        <div className="alert-warning text-sm flex items-center gap-3">
          <AlertCircle size={16} className="flex-shrink-0"/>
          <span>Outstanding revenue (not yet paid): <strong>${Number(stats.total_outstanding).toLocaleString()}</strong></span>
        </div>
      )}

      {/* Filters */}
      <div className="card-sm py-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input py-2 pl-9" placeholder="Search by customer, WON #, EXPRO ref, PO #…"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
          </div>
          <select className="input w-auto py-2" value={invFilter} onChange={e => { setInvFilter(e.target.value); setPage(1) }}>
            <option value="">All Invoice Statuses</option>
            {["NOT_INVOICED","PARTIAL","INVOICED","PAID"].map(s => (
              <option key={s} value={s}>{s.replace("_"," ")}</option>
            ))}
          </select>
          <button className="btn-ghost py-2" onClick={() => { setSearch(""); setInvFilter(""); setPage(1) }}>
            <RefreshCw size={13}/>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>WON #</th>
                <th>EXPRO Ref</th>
                <th>PO #</th>
                <th>Customer</th>
                <th>Media</th>
                <th>SLA</th>
                <th>BW</th>
                <th>QTY</th>
                <th>TCV</th>
                <th>Discount</th>
                <th>Final Value</th>
                <th>Won Date</th>
                <th>PO Date</th>
                <th>Invoice</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={15} className="text-center py-10">
                  <div className="animate-spin inline-block w-5 h-5 border-4 border-emerald-500 border-t-transparent rounded-full"/>
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={15} className="py-12">
                  <div className="empty-state">
                    <div className="empty-icon mx-auto"><Trophy size={28}/></div>
                    <p className="text-sm text-gray-400">No WON records yet</p>
                    <p className="text-xs text-gray-300 mt-1">Mark an opportunity as Won in RFP & Bids</p>
                  </div>
                </td></tr>
              ) : items.map(w => (
                <tr key={w.won_id} className="cursor-pointer" onClick={() => setShowDetail(w.won_id)}>
                  <td><span className="font-mono text-xs font-bold text-emerald-600">{w.won_number}</span></td>
                  <td className="font-mono text-xs text-gray-500">{w.expro_ref || "—"}</td>
                  <td className="font-mono text-xs text-gray-500">{w.po_number || "—"}</td>
                  <td>
                    <div className="font-medium text-sm max-w-[140px] truncate">{w.customer_name}</div>
                    <div className="text-xs text-gray-400">{w.opp_number}</div>
                  </td>
                  <td className="text-xs">{w.media_type || "—"}</td>
                  <td className="text-xs">{w.sla_type || "—"}</td>
                  <td className="text-xs">{w.bandwidth_mbps ? `${w.bandwidth_mbps}M` : "—"}</td>
                  <td className="text-xs">{w.quantity || "—"}</td>
                  <td className="text-xs font-medium">{w.tcv ? `${w.symbol||"$"}${Number(w.tcv).toLocaleString()}` : "—"}</td>
                  <td className="text-xs">{w.discount_applied ? `${w.discount_applied}%` : "—"}</td>
                  <td className="text-sm font-bold text-emerald-700">{w.final_value ? `${w.symbol||"$"}${Number(w.final_value).toLocaleString()}` : "—"}</td>
                  <td className="text-xs">{w.won_date ? fmt(w.won_date) : "—"}</td>
                  <td className="text-xs">{w.po_date ? fmt(w.po_date) : <span className="text-amber-500 font-medium">Missing</span>}</td>
                  <td>
                    <span className={clsx("badge text-xs", INVOICE_STYLE[w.invoice_status] || "badge-gray")}>
                      {w.invoice_status?.replace("_"," ") || "—"}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className="btn-ghost btn-sm" onClick={() => setShowDetail(w.won_id)}><Eye size={13}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">{data.total} records</span>
            <div className="flex gap-1 items-center">
              <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={13}/></button>
              <span className="text-xs text-gray-500 px-2">{page}/{data.total_pages}</span>
              <button className="btn-ghost btn-sm" disabled={page >= data.total_pages} onClick={() => setPage(p => p + 1)}><ChevronRight size={13}/></button>
            </div>
          </div>
        )}
      </div>

      {showDetail && <WonDetailModal wonId={showDetail} onClose={() => setShowDetail(null)}/>}
    </div>
  )
}
