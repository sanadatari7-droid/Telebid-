import React, { useState, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { vendorsApi } from "../services/api"
import { useForm } from "react-hook-form"
import clsx from "clsx"
import toast from "react-hot-toast"
import * as XLSX from "xlsx"
import { QRCodeSVG as QRCode } from "qrcode.react"
import { Plus, Search, AlertTriangle, Mail, Phone, Upload, Download, FileSpreadsheet } from "lucide-react"
import { exportToExcel } from "../utils/exportUtils"

export default function VendorsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [showBl, setShowBl] = useState(undefined)
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [selected, setSelected] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef()
  const { register, handleSubmit, reset } = useForm()

  const { data, isLoading } = useQuery({
    queryKey: ["vendors", search, showBl],
    queryFn: () => vendorsApi.list({ search: search || undefined, is_blacklisted: showBl }).then(r => r.data),
    retry: 1,
  })
  const { data: detail } = useQuery({
    queryKey: ["vendor-detail", selected?.vendor_id],
    queryFn: () => vendorsApi.get(selected.vendor_id).then(r => r.data),
    enabled: !!selected,
  })

  const createMut = useMutation({
    mutationFn: d => vendorsApi.create(d),
    onSuccess: () => { toast.success("Vendor registered"); qc.invalidateQueries({ queryKey: ["vendors"] }); setShowCreate(false); reset() }
  })
  const blMut = useMutation({
    mutationFn: ({ id, reason }) => vendorsApi.blacklist(id, { reason }),
    onSuccess: () => { toast.success("Blacklisted"); qc.invalidateQueries({ queryKey: ["vendors"] }); setSelected(null) }
  })
  const unblMut = useMutation({
    mutationFn: id => vendorsApi.unblacklist(id),
    onSuccess: () => { toast.success("Removed from blacklist"); qc.invalidateQueries({ queryKey: ["vendors"] }); setSelected(null) }
  })

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)
      if (rows.length === 0) { toast.error("File is empty or has no data"); return }
      const result = await vendorsApi.bulkImport(rows)
      setImportResult(result.data)
      qc.invalidateQueries({ queryKey: ["vendors"] })
      toast.success(`Import done: ${result.data.created} created, ${result.data.skipped} skipped`)
    } catch (err) {
      toast.error("Failed to import: " + (err?.response?.data?.detail || err.message))
    } finally {
      setImporting(false)
      e.target.value = ""
    }
  }

  const downloadTemplate = () => {
    const template = [{ company_name:"Acme Corp",registration_no:"REG-001",contact_person:"John Smith",email:"john@acme.com",phone:"+1-555-0000",business_category:"Telecom" }]
    exportToExcel(template, [
      {header:"company_name",key:"company_name"},
      {header:"registration_no",key:"registration_no"},
      {header:"contact_person",key:"contact_person"},
      {header:"email",key:"email"},
      {header:"phone",key:"phone"},
      {header:"business_category",key:"business_category"},
    ], "vendor_import_template")
  }

  const items = data?.items || []

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary-800">Vendors</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} registered</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowImport(true)}><Upload size={15}/> Bulk Import</button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15}/> Register Vendor</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card py-3">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9 py-2" placeholder="Search vendors…"
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <select className="input w-auto py-2" value={showBl === undefined ? "" : String(showBl)}
            onChange={e => setShowBl(e.target.value === "" ? undefined : e.target.value === "true")}>
            <option value="">All Vendors</option>
            <option value="false">Active Only</option>
            <option value="true">Blacklisted Only</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-3 text-center py-12">
            <div className="inline-block animate-spin w-6 h-6 border-4 border-primary-500 border-t-transparent rounded-full"/>
          </div>
        ) : items.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-gray-400 text-sm">No vendors found</div>
        ) : items.map(v => (
          <div key={v.vendor_id}
            className={clsx("card cursor-pointer hover:shadow-md transition-shadow", v.is_blacklisted && "border-red-200 bg-red-50")}
            onClick={() => setSelected(v)}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0",
                  v.is_blacklisted ? "bg-red-400" : "bg-primary-500")}>
                  {v.company_name?.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-sm">{v.company_name}</div>
                  <div className="text-xs text-gray-400">{v.business_category || "General"}</div>
                </div>
              </div>
              {v.is_blacklisted && <span className="badge-red flex-shrink-0"><AlertTriangle size={10}/> Blacklisted</span>}
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
              {v.email && <span className="flex items-center gap-1 truncate"><Mail size={10}/>{v.email}</span>}
              {v.phone && <span className="flex items-center gap-1"><Phone size={10}/>{v.phone}</span>}
              <span>Contracts: <strong className="text-gray-700">{v.total_contracts || 0}</strong></span>
              <span>Score: <strong className="text-gray-700">{v.avg_score ? `${v.avg_score}/100` : "—"}</strong></span>
            </div>
          </div>
        ))}
      </div>

      {/* Bulk Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-primary-800">Bulk Import Vendors</h2>
              <button className="btn-ghost p-2" onClick={() => { setShowImport(false); setImportResult(null) }}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                <h4 className="text-sm font-semibold text-blue-700 mb-2">Required columns:</h4>
                <p className="text-xs text-blue-600 font-mono">company_name, registration_no, contact_person, email, phone, business_category</p>
              </div>
              <button className="btn-secondary w-full justify-center" onClick={downloadTemplate}>
                <FileSpreadsheet size={14}/> Download Excel Template
              </button>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-primary-400 transition-colors cursor-pointer"
                onClick={() => fileRef.current?.click()}>
                <Upload size={32} className="mx-auto mb-2 text-gray-300"/>
                <p className="font-medium text-gray-600">{importing ? "Importing…" : "Click to upload Excel / CSV"}</p>
                <p className="text-xs text-gray-400 mt-1">Supports .xlsx, .xls, .csv</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileImport}/>
              </div>
              {importResult && (
                <div className="p-4 bg-gray-50 rounded-xl border">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><div className="text-xl font-bold text-green-600">{importResult.created}</div><div className="text-xs text-gray-500">Created</div></div>
                    <div><div className="text-xl font-bold text-amber-600">{importResult.skipped}</div><div className="text-xs text-gray-500">Skipped</div></div>
                    <div><div className="text-xl font-bold text-red-600">{importResult.errors?.length || 0}</div><div className="text-xs text-gray-500">Errors</div></div>
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="mt-3 text-xs text-red-600 max-h-24 overflow-y-auto">
                      {importResult.errors.map((e,i) => <div key={i}>{e}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Vendor Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-primary-800">Register Vendor</h2>
              <button className="btn-ghost p-2" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit(d => createMut.mutate(d))} className="p-6 space-y-4">
              <div><label className="label">Company Name *</label><input {...register("company_name",{required:true})} className="input"/></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Registration No.</label><input {...register("registration_no")} className="input"/></div>
                <div><label className="label">Tax Number</label><input {...register("tax_number")} className="input"/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Contact Person</label><input {...register("contact_person")} className="input"/></div>
                <div><label className="label">Email</label><input {...register("email")} type="email" className="input"/></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Phone</label><input {...register("phone")} className="input"/></div>
                <div><label className="label">Business Category</label><input {...register("business_category")} className="input" placeholder="Telecom, ICT…"/></div>
              </div>
              <div><label className="label">Address</label><textarea {...register("address")} className="input" rows={2}/></div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={createMut.isPending}>{createMut.isPending ? "Saving…" : "Register"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vendor Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold">{selected.company_name}</h2>
                <p className="text-sm text-gray-500">{selected.business_category}</p>
                {selected.is_blacklisted && <span className="badge-red mt-1 inline-flex items-center gap-1"><AlertTriangle size={10}/> Blacklisted</span>}
              </div>
              <button className="btn-ghost p-2" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Reg No.", selected.registration_no || "—"],
                  ["Tax No.", selected.tax_number || "—"],
                  ["Contact", selected.contact_person || "—"],
                  ["Email", selected.email || "—"],
                  ["Phone", selected.phone || "—"],
                  ["Avg Score", selected.avg_score ? `${selected.avg_score}/100` : "—"],
                ].map(([k,v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt>
                    <dd className="font-medium mt-0.5">{v}</dd>
                  </div>
                ))}
              </div>

              {/* QR Code */}
              <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl border">
                <QRCode
                  value={`TeleBid Vendor: ${selected.company_name} | ${selected.email || ""} | ${selected.phone || ""}`}
                  size={80} level="M"
                />
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Vendor QR Code</div>
                  <p className="text-xs text-gray-400">Scan to identify this vendor</p>
                </div>
              </div>

              {/* Contracts */}
              {detail?.contracts?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Contracts ({detail.contracts.length})</h4>
                  {detail.contracts.slice(0,5).map(c => (
                    <div key={c.contract_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm mb-1">
                      <span className="font-mono text-xs text-primary-600">{c.contract_number}</span>
                      <span className="max-w-[200px] truncate">{c.bid_title}</span>
                      <span className="badge-green">{c.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2 border-t">
                {!selected.is_blacklisted ? (
                  <button className="btn-danger btn-sm"
                    onClick={() => { const r = window.prompt("Reason for blacklisting?"); if (r) blMut.mutate({ id: selected.vendor_id, reason: r }) }}>
                    <AlertTriangle size={12}/> Blacklist
                  </button>
                ) : (
                  <button className="btn-secondary btn-sm" onClick={() => unblMut.mutate(selected.vendor_id)}>
                    Remove from Blacklist
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
