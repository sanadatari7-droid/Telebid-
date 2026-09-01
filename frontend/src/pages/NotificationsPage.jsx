import React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { notifApi } from "../services/api"
import { fmt, fmtDT } from "../utils/fmt"
import { Bell, CheckCheck } from "lucide-react"
import clsx from "clsx"
import toast from "react-hot-toast"

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey:["notifications"], queryFn:()=>notifApi.list({page_size:50}).then(r=>r.data) })
  const markRead = useMutation({ mutationFn:id=>notifApi.markRead(id), onSuccess:()=>qc.invalidateQueries({queryKey:["notifications"]}) })
  const markAll = useMutation({ mutationFn:()=>notifApi.markAllRead(), onSuccess:()=>{ toast.success("All read"); qc.invalidateQueries({queryKey:["notifications"]}) } })
  const items = data?.items || []
  return (
    <div className="p-6 space-y-5 max-w-screen-lg mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-primary-800">Notifications</h1><p className="text-sm text-gray-500">{items.filter(n=>!n.is_read).length} unread</p></div>
        <button className="btn-secondary" onClick={()=>markAll.mutate()}><CheckCheck size={14}/> Mark All Read</button>
      </div>
      <div className="space-y-2">
        {isLoading ? <div className="text-center py-12"><div className="inline-block animate-spin w-6 h-6 border-4 border-primary-500 border-t-transparent rounded-full"/></div>
        : !items.length ? <div className="card text-center py-12 text-gray-400"><Bell size={36} className="mx-auto mb-2 opacity-20"/><p>No notifications</p></div>
        : items.map(n => (
          <div key={n.notif_id} className={clsx("card flex items-start gap-4 cursor-pointer transition-all",!n.is_read?"bg-primary-50 border-primary-200 hover:bg-primary-100":"hover:bg-gray-50")}
            onClick={()=>{ if(!n.is_read) markRead.mutate(n.notif_id) }}>
            <div className={clsx("w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0",!n.is_read?"bg-primary-500":"bg-transparent")}/>
            <div className="flex-1">
              <div className={clsx("text-sm",!n.is_read?"font-semibold text-gray-900":"text-gray-700")}>{n.title}</div>
              {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
              <div className="text-xs text-gray-400 mt-1">{fmt(n.created_at, "dd MMM yyyy HH:mm")}</div>
            </div>
            <span className="badge-gray text-xs flex-shrink-0">{n.notif_type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
