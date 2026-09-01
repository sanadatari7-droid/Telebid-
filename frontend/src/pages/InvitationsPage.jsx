import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { bidsApi, vendorsApi } from "../services/api"
import { fmt, fmtDT } from "../utils/fmt"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Mail, Send, CheckCircle2, XCircle, Clock, Eye } from "lucide-react"

const STATUS_COLOR = { SENT:"badge-blue", OPENED:"badge-purple", ACCEPTED:"badge-green", DECLINED:"badge-red", NO_RESPONSE:"badge-gray" }
const STATUS_ICON = { SENT:Send, OPENED:Eye, ACCEPTED:CheckCircle2, DECLINED:XCircle, NO_RESPONSE:Clock }

export default function InvitationsPage() {
  const qc = useQueryClient()
  const [selectedBidId, setSelectedBidId] = useState("")
  const [showInvite, setShowInvite] = useState(false)
  const [selectedVendorId, setSelectedVendorId] = useState("")

  const { data:bids } = useQuery({ queryKey:["bids-inv"], queryFn:()=>bidsApi.list({page_size:100}).then(r=>r.data) })
  const { data:invitations=[], isLoading } = useQuery({
    queryKey:["invitations",selectedBidId], enabled:!!selectedBidId,
    queryFn:()=>bidsApi.getInvitations(Number(selectedBidId)).then(r=>r.data)
  })
  const { data:vendors } = useQuery({ queryKey:["vendors-inv"], queryFn:()=>vendorsApi.list({page_size:100}).then(r=>r.data) })

  const inviteMut = useMutation({
    mutationFn:()=>vendorsApi.invite(Number(selectedVendorId),{bid_id:Number(selectedBidId)}),
    onSuccess:()=>{ toast.success("Invitation sent"); qc.invalidateQueries({queryKey:["invitations",selectedBidId]}); setShowInvite(false); setSelectedVendorId("") }
  })
  const statusMut = useMutation({
    mutationFn:({invId,status})=>bidsApi.updateInvStatus(Number(selectedBidId),invId,{status}),
    onSuccess:()=>{ toast.success("Status updated"); qc.invalidateQueries({queryKey:["invitations",selectedBidId]}) }
  })

  const stats = { total:invitations.length, accepted:invitations.filter(i=>i.status==="ACCEPTED").length, declined:invitations.filter(i=>i.status==="DECLINED").length, pending:invitations.filter(i=>["SENT","OPENED","NO_RESPONSE"].includes(i.status)).length }

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-primary-800">Invitation Management</h1><p className="text-sm text-gray-500">Invite vendors to bids and track responses</p></div>
        {selectedBidId && <button className="btn-primary" onClick={()=>setShowInvite(true)}><Mail size={15}/> Invite Vendor</button>}
      </div>

      <div className="card py-3">
        <div className="flex items-center gap-3">
          <label className="label mb-0 flex-shrink-0">Select Bid:</label>
          <select className="input w-auto" value={selectedBidId} onChange={e=>setSelectedBidId(e.target.value)}>
            <option value="">Choose a bid…</option>
            {(bids?.items||[]).map(b=><option key={b.bid_id} value={b.bid_id}>{b.bid_number} — {b.bid_title}</option>)}
          </select>
        </div>
      </div>

      {selectedBidId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[["Total Invited",stats.total,"bg-primary-500"],["Accepted",stats.accepted,"bg-green-600"],["Declined",stats.declined,"bg-red-500"],["Pending",stats.pending,"bg-amber-500"]].map(([l,v,c])=>(
              <div key={l} className="card flex items-center gap-4">
                <div className={clsx("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",c)}><Mail size={18} className="text-white"/></div>
                <div><div className="text-2xl font-bold text-primary-800">{v}</div><div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{l}</div></div>
              </div>
            ))}
          </div>

          <div className="card p-0">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Vendor</th><th>Contact</th><th>Inv. Code</th><th>Sent</th><th>Responded</th><th>Status</th><th>Update Status</th></tr></thead>
                <tbody>
                  {isLoading ? <tr><td colSpan={7} className="text-center py-10"><div className="inline-block animate-spin w-5 h-5 border-4 border-primary-500 border-t-transparent rounded-full"/></td></tr>
                  : !invitations.length ? <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm"><Mail size={32} className="mx-auto mb-2 opacity-20"/>No invitations sent yet</td></tr>
                  : invitations.map(inv=>{
                    const Icon = STATUS_ICON[inv.status] || Clock
                    return (
                      <tr key={inv.inv_id}>
                        <td className="font-semibold">{inv.company_name}</td>
                        <td className="text-sm text-gray-500">{inv.contact_person||"—"}</td>
                        <td className="font-mono text-xs text-gray-400">{inv.inv_code?.slice(0,12)}…</td>
                        <td className="text-xs text-gray-500">{fmt(inv.date_sent, "dd MMM yyyy HH:mm")}</td>
                        <td className="text-xs text-gray-500">{inv.date_responded?fmt(inv.date_responded, "dd MMM yyyy"):"—"}</td>
                        <td><span className={clsx("badge flex items-center gap-1",STATUS_COLOR[inv.status]||"badge-gray")}><Icon size={10}/>{inv.status}</span></td>
                        <td>
                          <select className="input py-1 text-xs w-36"
                            value={inv.status}
                            onChange={e=>statusMut.mutate({invId:inv.inv_id,status:e.target.value})}>
                            {["SENT","OPENED","ACCEPTED","DECLINED","NO_RESPONSE"].map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!selectedBidId && (
        <div className="card text-center py-16 text-gray-400">
          <Mail size={48} className="mx-auto mb-3 opacity-20"/>
          <p className="font-medium">Select a bid to manage invitations</p>
        </div>
      )}

      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b"><h2 className="text-lg font-bold text-primary-800">Invite Vendor</h2><button className="btn-ghost p-2" onClick={()=>setShowInvite(false)}>✕</button></div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Select Vendor *</label>
                <select className="input" value={selectedVendorId} onChange={e=>setSelectedVendorId(e.target.value)}>
                  <option value="">Choose vendor…</option>
                  {(vendors?.items||[]).filter(v=>!v.is_blacklisted).map(v=>(
                    <option key={v.vendor_id} value={v.vendor_id}>{v.company_name} — {v.business_category||"General"}</option>
                  ))}
                </select>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-700">
                An invitation code will be auto-generated. The vendor will be notified via email.
              </div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button className="btn-secondary" onClick={()=>setShowInvite(false)}>Cancel</button>
                <button className="btn-primary" disabled={!selectedVendorId||inviteMut.isPending} onClick={()=>inviteMut.mutate()}>
                  <Send size={14}/> {inviteMut.isPending?"Sending…":"Send Invitation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
