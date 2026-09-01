import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { contractsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { generateContractPDF } from "../utils/exportUtils"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Trophy, CheckCircle2, Clock, AlertTriangle, Eye, FileText, Download } from "lucide-react"
import { QRCodeSVG as QRCode } from "qrcode.react"

export default function ContractsPage() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState(null)
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => contractsApi.list().then(r => r.data),
    retry: 1,
  })
  const { data: detail } = useQuery({
    queryKey: ["contract-detail", selected?.contract_id],
    queryFn: () => contractsApi.get(selected.contract_id).then(r => r.data),
    enabled: !!selected,
  })

  const signMut = useMutation({
    mutationFn: id => contractsApi.sign(id),
    onSuccess: () => { toast.success("Contract signed!"); qc.invalidateQueries({ queryKey: ["contracts"] }); qc.invalidateQueries({ queryKey: ["contract-detail", selected?.contract_id] }) }
  })
  const deleteMut = useMutation({
    mutationFn: id => contractsApi.delete(id),
    onSuccess: () => { toast.success("Contract archived"); qc.invalidateQueries({ queryKey: ["contracts"] }); setSelected(null) }
  })

  const statusColor = s => {
    if (s === "SIGNED" || s === "ACTIVE") return "badge-green"
    if (s === "EXPIRING_SOON") return "badge-amber"
    if (s === "EXPIRED") return "badge-red"
    return "badge-gray"
  }

  const stats = {
    total: contracts.length,
    active: contracts.filter(c => ["ACTIVE","SIGNED"].includes(c.status)).length,
    expiring: contracts.filter(c => c.display_status === "EXPIRING_SOON").length,
    expired: contracts.filter(c => c.display_status === "EXPIRED").length,
  }

  const contractDetail = detail?.contract || selected

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-primary-800">Contracts</h1>
        <p className="text-sm text-gray-500">Awarded contracts and contract management</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[["Total",stats.total,"bg-primary-500",Trophy],["Active",stats.active,"bg-green-600",CheckCircle2],["Expiring Soon",stats.expiring,"bg-amber-500",Clock],["Expired",stats.expired,"bg-red-500",AlertTriangle]].map(([l,v,c,Icon]) => (
          <div key={l} className="card flex items-center gap-4">
            <div className={clsx("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",c)}>
              <Icon size={20} className="text-white"/>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary-800">{v}</div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{l}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Contract #</th><th>Bid</th><th>Vendor</th><th>Value</th><th>Start</th><th>End</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-10">
                  <div className="inline-block animate-spin w-5 h-5 border-4 border-primary-500 border-t-transparent rounded-full"/>
                </td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">
                  <Trophy size={32} className="mx-auto mb-2 opacity-20"/>No contracts yet
                </td></tr>
              ) : contracts.map(c => (
                <tr key={c.contract_id}>
                  <td><span className="font-mono text-xs font-bold text-primary-600">{c.contract_number}</span></td>
                  <td><div className="text-xs text-gray-400">{c.bid_number}</div><div className="font-medium text-sm max-w-[150px] truncate">{c.bid_title}</div></td>
                  <td className="font-medium text-sm">{c.vendor_name}</td>
                  <td className="text-sm font-medium">{c.contract_value ? `${c.symbol||"$"}${Number(c.contract_value).toLocaleString()}` : "—"}</td>
                  <td className="text-xs text-gray-500">{fmt(c.start_date)}</td>
                  <td className="text-xs text-gray-500">{fmt(c.end_date)}</td>
                  <td><span className={statusColor(c.display_status||c.status)}>{c.display_status||c.status}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn-ghost btn-sm" title="View" onClick={() => setSelected(c)}><Eye size={13}/></button>
                      <button className="btn-ghost btn-sm" title="Download PDF" onClick={() => generateContractPDF(c)}><Download size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b">
              <div>
                <span className="font-mono text-xs text-primary-500 font-bold">{contractDetail?.contract_number}</span>
                <h2 className="text-lg font-bold mt-1">{contractDetail?.bid_title}</h2>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" title="Download Contract PDF"
                  onClick={() => generateContractPDF(contractDetail)}>
                  <Download size={13}/> PDF
                </button>
                <button className="btn-ghost p-2" onClick={() => setSelected(null)}>✕</button>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Vendor", contractDetail?.vendor_name],
                  ["Contact", contractDetail?.contact_person],
                  ["Email", contractDetail?.vendor_email],
                  ["Value", contractDetail?.contract_value ? `${contractDetail.symbol||"$"}${Number(contractDetail.contract_value).toLocaleString()}` : "—"],
                  ["Start Date", fmt(contractDetail?.start_date)],
                  ["End Date", fmt(contractDetail?.end_date)],
                  ["Status", contractDetail?.status],
                  ["Signed", contractDetail?.signed_at ? fmt(contractDetail.signed_at, "dd MMM yyyy HH:mm") : "Not signed yet"],
                ].map(([k,v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt>
                    <dd className="font-medium mt-0.5">{v || "—"}</dd>
                  </div>
                ))}
              </div>

              {/* QR Code */}
              <div className="flex items-start gap-5 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <QRCode
                  value={`TeleBid Contract: ${contractDetail?.contract_number} | Vendor: ${contractDetail?.vendor_name} | Value: ${contractDetail?.contract_value || "N/A"}`}
                  size={100}
                  level="M"
                />
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">QR Code</div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Scan to verify contract authenticity.<br/>
                    Contains contract number, vendor, and value.
                  </p>
                  <p className="font-mono text-xs text-primary-600 mt-2">{contractDetail?.contract_number}</p>
                </div>
              </div>

              {/* Documents */}
              {detail?.documents?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
                    <FileText size={14}/> Documents ({detail.documents.length})
                  </h4>
                  {detail.documents.map(d => (
                    <div key={d.doc_id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm mb-1">
                      <span>{d.doc_name}</span>
                      <span className="badge-gray">{d.doc_type}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2 border-t">
                {contractDetail?.status !== "SIGNED" && (
                  <button className="btn-primary btn-sm" disabled={signMut.isPending}
                    onClick={() => signMut.mutate(selected.contract_id)}>
                    <CheckCircle2 size={13}/> {signMut.isPending ? "Signing…" : "Sign Contract"}
                  </button>
                )}
                <button className="btn-secondary btn-sm" onClick={() => generateContractPDF(contractDetail)}>
                  <Download size={13}/> Download PDF
                </button>
                <button className="btn-danger btn-sm ml-auto"
                  onClick={() => { if (window.confirm("Archive this contract?")) deleteMut.mutate(selected.contract_id) }}>
                  Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
