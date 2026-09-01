import React, { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { bidsApi, commentsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import clsx from "clsx"
import toast from "react-hot-toast"
import { ArrowLeft, CheckCircle2, Upload, Trophy, Clock, XCircle, Archive, MessageSquare, History, QrCode, Send, Trash2 } from "lucide-react"
import { QRCodeSVG as QRCode } from "qrcode.react"

const STEPS = ["DRAFT","PENDING_APPROVAL","APPROVED","PUBLISHED","OPEN","CLOSED","TECH_EVAL","FIN_EVAL","AWARDED","CONTRACT","COMPLETED","ARCHIVED"]
const STEP_LABELS = { DRAFT:"Draft",PENDING_APPROVAL:"Approval",APPROVED:"Approved",PUBLISHED:"Published",OPEN:"Open",CLOSED:"Closed",TECH_EVAL:"Tech Eval",FIN_EVAL:"Fin Eval",AWARDED:"Awarded",CONTRACT:"Contract",COMPLETED:"Completed",ARCHIVED:"Archived" }

export default function BidDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const bidId = Number(id)
  const [tab, setTab] = useState("overview")
  const [uploading, setUploading] = useState(false)
  const [commentText, setCommentText] = useState("")
  const [isInternal, setIsInternal] = useState(true)

  const { data: bid, isLoading } = useQuery({
    queryKey: ["bid", bidId],
    queryFn: () => bidsApi.get(bidId).then(r => r.data)
  })
  const { data: docs = [] } = useQuery({
    queryKey: ["bid-docs", bidId],
    queryFn: () => bidsApi.getDocs(bidId).then(r => r.data),
    enabled: tab === "documents"
  })
  const { data: ranking = [] } = useQuery({
    queryKey: ["bid-rank", bidId],
    queryFn: () => bidsApi.getVendorRank(bidId).then(r => r.data),
    enabled: tab === "ranking"
  })
  const { data: approvals = [] } = useQuery({
    queryKey: ["bid-approvals", bidId],
    queryFn: () => bidsApi.getApprovals(bidId).then(r => r.data),
    enabled: tab === "approvals"
  })
  const { data: comments = [] } = useQuery({
    queryKey: ["bid-comments", bidId],
    queryFn: () => commentsApi.list(bidId).then(r => r.data),
    enabled: tab === "comments"
  })
  const { data: history = [] } = useQuery({
    queryKey: ["bid-history", bidId],
    queryFn: () => bidsApi.getHistory(bidId).then(r => r.data),
    enabled: tab === "history"
  })

  const approveMut = useMutation({
    mutationFn: d => bidsApi.approve(bidId, d),
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["bid", bidId] }) }
  })
  const awardMut = useMutation({
    mutationFn: vendorId => bidsApi.award(bidId, { vendor_id: vendorId }),
    onSuccess: () => { toast.success("Bid awarded! Contract created."); qc.invalidateQueries({ queryKey: ["bid", bidId] }) }
  })
  const archiveMut = useMutation({
    mutationFn: () => bidsApi.archive(bidId),
    onSuccess: () => { toast.success("Bid archived"); qc.invalidateQueries({ queryKey: ["bid", bidId] }) }
  })
  const commentMut = useMutation({
    mutationFn: () => commentsApi.add(bidId, { body: commentText, is_internal: isInternal }),
    onSuccess: () => { toast.success("Comment added"); qc.invalidateQueries({ queryKey: ["bid-comments", bidId] }); setCommentText("") }
  })
  const deleteCommentMut = useMutation({
    mutationFn: commentId => commentsApi.delete(commentId),
    onSuccess: () => { toast.success("Comment deleted"); qc.invalidateQueries({ queryKey: ["bid-comments", bidId] }) }
  })

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await bidsApi.uploadDoc(bidId, "GENERAL", file)
      toast.success("Uploaded")
      qc.invalidateQueries({ queryKey: ["bid-docs", bidId] })
    } catch {} finally { setUploading(false) }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full"/>
    </div>
  )
  if (!bid) return <div className="p-6 text-red-500">Bid not found</div>

  const stepIdx = STEPS.indexOf(bid.status_code)
  const TABS = ["overview","documents","ranking","approvals","comments","history"]

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button className="btn-ghost p-2 mt-0.5" onClick={() => navigate("/bids")}><ArrowLeft size={18}/></button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xs font-bold text-primary-600 bg-primary-50 px-3 py-1 rounded-full">{bid.bid_number}</span>
            <span className="badge" style={{ background:(bid.color_hex||"#9CA3AF")+"22", color:bid.color_hex||"#9CA3AF" }}>{bid.status_name}</span>
            <span className="badge-blue">{bid.bid_type_code}</span>
          </div>
          <h1 className="text-xl font-bold text-primary-800 mt-2">{bid.bid_title}</h1>
          <p className="text-sm text-gray-500 mt-1">{bid.dept_name} · {bid.created_by_name} · {fmt(bid.created_at)}</p>
        </div>
        {bid.status_code !== "ARCHIVED" && (
          <button className="btn-secondary btn-sm" title="Archive this bid"
            onClick={() => { if (window.confirm("Archive this bid?")) archiveMut.mutate() }}>
            <Archive size={14}/> Archive
          </button>
        )}
      </div>

      {/* Lifecycle */}
      <div className="card py-5">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Bid Lifecycle</h3>
        <div className="flex items-center overflow-x-auto pb-2">
          {STEPS.filter(s => s !== "ARCHIVED").map((step, idx) => {
            const done = idx < stepIdx
            const active = idx === stepIdx
            const isLast = idx === STEPS.filter(s => s !== "ARCHIVED").length - 1
            return (
              <React.Fragment key={step}>
                <div className="flex flex-col items-center flex-shrink-0 min-w-[70px]">
                  <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                    done?"bg-green-500 text-white":active?"bg-primary-500 text-white ring-4 ring-primary-100":"bg-gray-100 text-gray-400")}>
                    {done ? <CheckCircle2 size={15}/> : idx+1}
                  </div>
                  <span className={clsx("text-xs mt-1.5 text-center leading-tight",
                    active?"text-primary-600 font-semibold":done?"text-green-600":"text-gray-400")}>
                    {STEP_LABELS[step]}
                  </span>
                </div>
                {!isLast && <div className={clsx("h-0.5 flex-1 min-w-[12px] mx-1",done?"bg-green-400":"bg-gray-200")}/>}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={clsx(
              "px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors whitespace-nowrap",
              tab===t?"border-primary-500 text-primary-600":"border-transparent text-gray-500 hover:text-gray-700"
            )}>
              {t === "comments" ? <span className="flex items-center gap-1"><MessageSquare size={13}/> Comments</span>
               : t === "history" ? <span className="flex items-center gap-1"><History size={13}/> History</span>
               : t === "ranking" ? "Vendor Ranking"
               : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Bid Details</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
              {[
                ["Bid Number", bid.bid_number],
                ["Type", bid.bid_type_name],
                ["Source", bid.bid_source],
                ["Department", bid.dept_name || "—"],
                ["Budget", bid.budget ? `${bid.symbol||"$"}${Number(bid.budget).toLocaleString()}` : "—"],
                ["Currency", bid.currency_code || "—"],
                ["Deadline", fmt(bid.submission_deadline, "dd MMM yyyy HH:mm")],
                ["Status", bid.status_name],
              ].map(([k,v]) => (
                <div key={k}>
                  <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{k}</dt>
                  <dd className="mt-1 font-medium text-gray-800">{v}</dd>
                </div>
              ))}
            </dl>
            {bid.description && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-sm text-gray-600 leading-relaxed">{bid.description}</p>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="card text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">QR Code</div>
              <QRCode
                value={`TeleBid|${bid.bid_number}|${bid.bid_title}|${bid.status_name}`}
                size={120} level="M" includeMargin
              />
              <p className="text-xs text-gray-400 mt-2 font-mono">{bid.bid_number}</p>
            </div>
            <div className="card">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</h4>
              <div className="space-y-2">
                {bid.status_code === "DRAFT" && (
                  <button className="btn-primary w-full justify-center btn-sm"
                    onClick={() => bidsApi.updateStatus(bidId,{status_id:2}).then(()=>{toast.success("Submitted"); qc.invalidateQueries({queryKey:["bid",bidId]})}).catch(()=>{})}>
                    Submit for Approval
                  </button>
                )}
                {bid.status_code === "PENDING_APPROVAL" && (
                  <button className="btn w-full justify-center bg-gold-500 text-white hover:bg-gold-600"
                    onClick={() => approveMut.mutate({level:1,decision:"APPROVE",comments:"Approved"})}>
                    Approve (Level 1)
                  </button>
                )}
                <button className="btn-secondary w-full justify-center btn-sm"
                  onClick={() => setTab("comments")}>
                  <MessageSquare size={13}/> Add Comment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENTS */}
      {tab === "documents" && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-gray-700">Documents ({docs.length})</h3>
            <label className={clsx("btn-primary btn-sm cursor-pointer", uploading && "opacity-60")}>
              <Upload size={13}/> {uploading ? "Uploading…" : "Upload"}
              <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.docx,.xlsx,.pptx,.zip,.png,.jpg"/>
            </label>
          </div>
          {!docs.length ? (
            <div className="text-center py-10 text-gray-400 text-sm">No documents uploaded yet</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Uploaded By</th><th>Date</th></tr></thead>
              <tbody>
                {docs.map(d => (
                  <tr key={d.doc_id}>
                    <td className="font-medium">{d.doc_name}</td>
                    <td><span className="badge-gray">{d.doc_type}</span></td>
                    <td className="text-xs text-gray-500">{d.file_size ? `${(d.file_size/1024).toFixed(1)} KB` : "—"}</td>
                    <td className="text-sm">{d.uploaded_by_name}</td>
                    <td className="text-xs text-gray-400">{fmt(d.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* RANKING */}
      {tab === "ranking" && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Vendor Ranking (Auto-Calculated)</h3>
          {!ranking.length ? (
            <p className="text-sm text-gray-400 text-center py-8">No evaluation scores yet</p>
          ) : (
            <div className="space-y-2">
              {ranking.map(r => (
                <div key={r.vendor_id} className={clsx("flex items-center gap-4 p-4 rounded-xl border",
                  r.ranking===1?"bg-green-50 border-green-200":"bg-gray-50 border-gray-100")}>
                  <div className="text-2xl w-10">{r.ranking===1?"🥇":r.ranking===2?"🥈":r.ranking===3?"🥉":`#${r.ranking}`}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{r.vendor_name}</div>
                    {r.ranking===1 && bid.status_code==="FIN_EVAL" && (
                      <button className="btn-primary btn-sm mt-1"
                        onClick={() => { if(window.confirm(`Award to ${r.vendor_name}?`)) awardMut.mutate(r.vendor_id) }}>
                        <Trophy size={12}/> Award
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{width:`${r.weighted_score}%`}}/>
                    </div>
                    <span className="font-bold text-primary-700">{r.weighted_score}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* APPROVALS */}
      {tab === "approvals" && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Approval Chain</h3>
          {!approvals.length ? (
            <p className="text-sm text-gray-400 text-center py-6">No approvals yet</p>
          ) : (
            <div className="space-y-3">
              {approvals.map(a => (
                <div key={a.approval_id} className={clsx("flex items-start gap-4 p-4 rounded-xl border",
                  a.status==="APPROVED"?"bg-green-50 border-green-200":a.status==="REJECTED"?"bg-red-50 border-red-200":"bg-amber-50 border-amber-200")}>
                  <div className={clsx("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0",
                    a.status==="APPROVED"?"bg-green-500":a.status==="REJECTED"?"bg-red-500":"bg-amber-500")}>
                    {a.status==="APPROVED"?<CheckCircle2 size={17} className="text-white"/>:a.status==="REJECTED"?<XCircle size={17} className="text-white"/>:<Clock size={17} className="text-white"/>}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{a.approver_name}</div>
                    <div className="text-xs text-gray-500">{a.approval_type} · Level {a.approval_level}</div>
                    {a.comments && <p className="text-sm text-gray-600 mt-1">{a.comments}</p>}
                  </div>
                  <div className="text-xs text-gray-400">{a.decided_at ? fmt(a.decided_at, "dd MMM yyyy HH:mm") : "Pending"}</div>
                </div>
              ))}
            </div>
          )}
          {bid.status_code === "PENDING_APPROVAL" && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Record Decision</h4>
              <div className="flex gap-3">
                <button className="btn-primary btn-sm" onClick={() => approveMut.mutate({level:1,decision:"APPROVE",approval_type:"GENERAL",comments:"Approved"})}>
                  <CheckCircle2 size={13}/> Approve
                </button>
                <button className="btn-danger btn-sm" onClick={() => approveMut.mutate({level:1,decision:"REJECT",approval_type:"GENERAL",comments:"Rejected"})}>
                  <XCircle size={13}/> Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* COMMENTS */}
      {tab === "comments" && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><MessageSquare size={15}/> Internal Comments</h3>
            <div className="space-y-3 mb-5 max-h-80 overflow-y-auto">
              {!comments.length ? (
                <p className="text-sm text-gray-400 text-center py-4">No comments yet</p>
              ) : comments.map(c => (
                <div key={c.comment_id} className={clsx("p-4 rounded-xl border", c.is_internal ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200")}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {c.author_name?.charAt(0)}
                      </div>
                      <div>
                        <span className="text-sm font-semibold">{c.author_name}</span>
                        <span className="ml-2 text-xs text-gray-400">{c.author_title}</span>
                        <span className={clsx("ml-2 badge text-xs", c.is_internal ? "badge-amber" : "badge-blue")}>{c.is_internal ? "Internal" : "External"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{fmt(c.created_at, "dd MMM HH:mm")}</span>
                      <button className="btn-ghost btn-sm text-red-400 p-1"
                        onClick={() => { if(window.confirm("Delete comment?")) deleteCommentMut.mutate(c.comment_id) }}>
                        <Trash2 size={11}/>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 mt-2 leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-3 mb-2">
                <label className="label mb-0 text-xs">Add Comment</label>
                <div className="flex gap-2 ml-auto">
                  <button onClick={() => setIsInternal(true)}
                    className={clsx("btn-sm rounded-lg", isInternal ? "btn-primary" : "btn-ghost text-gray-500")}>
                    Internal
                  </button>
                  <button onClick={() => setIsInternal(false)}
                    className={clsx("btn-sm rounded-lg", !isInternal ? "btn-primary" : "btn-ghost text-gray-500")}>
                    External
                  </button>
                </div>
              </div>
              <textarea className="input mb-3" rows={3} placeholder="Write your comment…"
                value={commentText} onChange={e => setCommentText(e.target.value)}/>
              <button className="btn-primary btn-sm" disabled={!commentText.trim() || commentMut.isPending}
                onClick={() => commentMut.mutate()}>
                <Send size={13}/> {commentMut.isPending ? "Posting…" : "Post Comment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY */}
      {tab === "history" && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><History size={15}/> Version History & Audit Trail</h3>
          {!history.length ? (
            <p className="text-sm text-gray-400 text-center py-6">No history yet</p>
          ) : (
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"/>
              <div className="space-y-4">
                {history.map((h, idx) => (
                  <div key={h.log_id} className="flex items-start gap-4 pl-10 relative">
                    <div className="absolute left-2 w-5 h-5 rounded-full bg-primary-100 border-2 border-primary-400 flex items-center justify-center -translate-x-1/2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-500"/>
                    </div>
                    <div className="flex-1 bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="badge-blue text-xs">{h.action}</span>
                          <span className="font-medium text-sm">{h.user_name || h.username}</span>
                        </div>
                        <span className="text-xs text-gray-400">{fmt(h.action_at, "dd MMM yyyy HH:mm")}</span>
                      </div>
                      {(h.old_value || h.new_value) && (
                        <div className="mt-1 text-xs text-gray-500 flex gap-2">
                          {h.old_value && <span>From: <code className="bg-red-50 px-1 rounded">{h.old_value}</code></span>}
                          {h.new_value && <span>To: <code className="bg-green-50 px-1 rounded">{h.new_value}</code></span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
