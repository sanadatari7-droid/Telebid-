import React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { watchlistApi } from "../services/api"
import { useNavigate } from "react-router-dom"
import { fmt, fmtDT } from "../utils/fmt"
import clsx from "clsx"
import toast from "react-hot-toast"
import { Star, Eye, Trash2 } from "lucide-react"

export default function WatchlistPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data:items=[], isLoading } = useQuery({ queryKey:["watchlist"], queryFn:()=>watchlistApi.list().then(r=>r.data) })
  const removeMut = useMutation({ mutationFn:id=>watchlistApi.remove(id), onSuccess:()=>{ toast.success("Removed from watchlist"); qc.invalidateQueries({queryKey:["watchlist"]}) } })

  const DL = { GREEN:"text-green-600 bg-green-50", ORANGE:"text-amber-600 bg-amber-50", RED:"text-red-600 bg-red-50", GRAY:"text-gray-500 bg-gray-50" }

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <div><h1 className="text-xl font-bold text-primary-800">Watchlist</h1><p className="text-sm text-gray-500">Bids you are monitoring — {items.length} items</p></div>

      {isLoading ? <div className="text-center py-12"><div className="inline-block animate-spin w-6 h-6 border-4 border-primary-500 border-t-transparent rounded-full"/></div>
      : !items.length ? (
        <div className="card text-center py-16 text-gray-400">
          <Star size={48} className="mx-auto mb-3 opacity-20"/>
          <p className="font-medium">Your watchlist is empty</p>
          <p className="text-sm mt-1">Add bids to your watchlist from the Bids page</p>
          <button className="btn-primary btn-sm mt-4" onClick={()=>navigate("/bids")}>Browse Bids</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(b=>{
            const dc = DL[b.deadline_color] || DL.GRAY
            return (
              <div key={b.bid_id} className="card hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <span className="font-mono text-xs font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded">{b.bid_number}</span>
                  <button className="btn-ghost btn-sm text-red-400 hover:text-red-600 -mr-2 -mt-1" onClick={()=>removeMut.mutate(b.bid_id)}><Trash2 size={13}/></button>
                </div>
                <h3 className="font-semibold text-sm mb-1 line-clamp-2">{b.bid_title}</h3>
                <div className="flex items-center gap-2 mb-3">
                  <span className="badge-blue">{b.bid_type_code}</span>
                  <span className="badge" style={{background:(b.color_hex||"#9CA3AF")+"22",color:b.color_hex||"#9CA3AF"}}>{b.status_name}</span>
                </div>
                {b.submission_deadline && (
                  <div className={clsx("text-xs font-medium px-2 py-1 rounded-lg inline-flex items-center gap-1 mb-3",dc)}>
                    📅 {fmt(b.submission_deadline, "dd MMM yyyy")}
                    {b.deadline_color!=="GRAY" && <span>· {Math.ceil((new Date(b.submission_deadline)-new Date())/(1000*60*60*24))}d left</span>}
                  </div>
                )}
                <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-400">Added {fmt(b.added_at, "dd MMM yyyy")}</span>
                  <button className="btn-ghost btn-sm" onClick={()=>navigate(`/bids/${b.bid_id}`)}><Eye size={13}/> View</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
