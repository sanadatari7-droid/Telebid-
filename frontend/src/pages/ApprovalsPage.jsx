import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { bidsApi } from "../services/api"
import toast from "react-hot-toast"
import { ShieldCheck, CheckCircle2, XCircle, MessageSquare } from "lucide-react"

export default function ApprovalsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey:["bids-pending"], queryFn:()=>bidsApi.list({status_code:"PENDING_APPROVAL",page_size:50}).then(r=>r.data) })
  const approveMut = useMutation({ mutationFn:({bid_id,...d})=>bidsApi.approve(bid_id,d), onSuccess:()=>{ toast.success("Decision recorded"); qc.invalidateQueries({queryKey:["bids-pending"]}) } })
  const pending = data?.items || []

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <div><h1 className="text-xl font-bold text-primary-800">Approval Queue</h1><p className="text-sm text-gray-500">{pending.length} items awaiting decision</p></div>
      {!pending.length ? (
        <div className="card text-center py-16 text-gray-400"><ShieldCheck size={48} className="mx-auto mb-3 opacity-20"/><p className="font-medium">No pending approvals</p><p className="text-sm mt-1">All items reviewed</p></div>
      ) : pending.map(bid => <ApprovalCard key={bid.bid_id} bid={bid} onDecide={d=>approveMut.mutate({bid_id:bid.bid_id,...d})} loading={approveMut.isPending}/>)}
    </div>
  )
}

function ApprovalCard({ bid, onDecide, loading }) {
  const [comments, setComments] = useState("")
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="font-mono text-xs font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded">{bid.bid_number}</span>
          <h3 className="font-semibold text-base mt-2">{bid.bid_title}</h3>
          <p className="text-sm text-gray-500">{bid.bid_type_name} · Budget: {bid.budget?`$${Number(bid.budget).toLocaleString()}`:"—"}</p>
        </div>
        <span className="badge-amber">Pending Approval</span>
      </div>
      <div className="mb-3"><label className="label">Decision Comments</label><textarea className="input" rows={2} value={comments} onChange={e=>setComments(e.target.value)} placeholder="Add comments for audit trail…"/></div>
      <div className="flex items-center gap-3">
        <button className="btn-primary btn-sm" disabled={loading} onClick={()=>onDecide({level:1,decision:"APPROVE",approval_type:"GENERAL",comments})}><CheckCircle2 size={13}/> Approve</button>
        <button className="btn-danger btn-sm" disabled={loading} onClick={()=>{if(!comments){toast.error("Comments required for rejection");return}onDecide({level:1,decision:"REJECT",approval_type:"GENERAL",comments})}}><XCircle size={13}/> Reject</button>
        <button className="btn-ghost btn-sm" disabled={loading} onClick={()=>onDecide({level:1,decision:"REQUEST_INFO",approval_type:"GENERAL",comments})}><MessageSquare size={13}/> Request Info</button>
      </div>
    </div>
  )
}
