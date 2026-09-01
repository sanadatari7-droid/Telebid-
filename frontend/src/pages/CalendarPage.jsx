import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { bidsApi } from "../services/api"
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isSameMonth, addMonths, subMonths, isToday
} from "date-fns"
import clsx from "clsx"
import { ChevronLeft, ChevronRight, Calendar, AlertCircle } from "lucide-react"

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const { data, isLoading, isError } = useQuery({
    queryKey: ["calendar-events"],
    queryFn: () => bidsApi.calendarEvents().then(r => r.data),
    retry: 1,
  })

  const bids = data?.bids || []
  const contracts = data?.contracts || []

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  })
  const startDow = startOfMonth(currentMonth).getDay()

  const getEventsForDay = (day) => {
    const events = []
    bids.forEach(b => {
      if (b.submission_deadline && isSameDay(new Date(b.submission_deadline), day)) {
        events.push({ type: "deadline", label: `📋 ${b.bid_number}`, color: "bg-red-100 text-red-700" })
      }
      if (b.opening_date && isSameDay(new Date(b.opening_date), day)) {
        events.push({ type: "opening", label: `📂 ${b.bid_number} Open`, color: "bg-blue-100 text-blue-700" })
      }
      if (b.closing_date && isSameDay(new Date(b.closing_date), day)) {
        events.push({ type: "closing", label: `🔒 ${b.bid_number} Close`, color: "bg-gray-100 text-gray-700" })
      }
    })
    contracts.forEach(c => {
      if (c.start_date && isSameDay(new Date(c.start_date), day)) {
        events.push({ type: "contract-start", label: `📝 ${c.contract_number}`, color: "bg-green-100 text-green-700" })
      }
      if (c.end_date && isSameDay(new Date(c.end_date), day)) {
        events.push({ type: "contract-end", label: `⚠️ ${c.contract_number}`, color: "bg-amber-100 text-amber-700" })
      }
    })
    return events
  }

  const upcoming = [...bids]
    .filter(b => b.submission_deadline && new Date(b.submission_deadline) >= new Date())
    .sort((a, b) => new Date(a.submission_deadline) - new Date(b.submission_deadline))
    .slice(0, 8)

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full"/>
    </div>
  )

  if (isError) return (
    <div className="p-6">
      <div className="card text-center py-12">
        <AlertCircle size={40} className="mx-auto mb-3 text-red-400"/>
        <p className="font-semibold text-gray-700">Could not load calendar data</p>
        <p className="text-sm text-gray-400 mt-1">Make sure the backend is running</p>
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-primary-800">Procurement Calendar</h1>
        <p className="text-sm text-gray-500">Submission deadlines, evaluations, and contract dates</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        {/* Calendar */}
        <div className="xl:col-span-3 card">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-primary-800">
              {format(currentMonth, "MMMM yyyy")}
            </h2>
            <div className="flex items-center gap-2">
              <button className="btn-ghost p-2" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft size={16}/>
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setCurrentMonth(new Date())}>
                Today
              </button>
              <button className="btn-ghost p-2" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight size={16}/>
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
              <div key={d} className="text-xs font-semibold text-gray-400 text-center py-2">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: startDow }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[70px]"/>
            ))}
            {daysInMonth.map(day => {
              const events = getEventsForDay(day)
              const inMonth = isSameMonth(day, currentMonth)
              const todayDay = isToday(day)
              return (
                <div key={day.toString()}
                  className={clsx(
                    "min-h-[70px] p-1 rounded-lg border transition-colors",
                    todayDay ? "bg-primary-50 border-primary-300" : "border-transparent hover:bg-gray-50",
                    !inMonth && "opacity-30"
                  )}>
                  <div className={clsx(
                    "text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full",
                    todayDay ? "bg-primary-500 text-white" : "text-gray-700"
                  )}>
                    {format(day, "d")}
                  </div>
                  <div className="space-y-0.5">
                    {events.slice(0, 3).map((ev, i) => (
                      <div key={i} className={clsx("text-xs px-1 py-0.5 rounded truncate", ev.color)}>
                        {ev.label}
                      </div>
                    ))}
                    {events.length > 3 && (
                      <div className="text-xs text-gray-400 pl-1">+{events.length - 3} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-gray-100">
            {[
              ["bg-red-100 text-red-700", "Submission Deadline"],
              ["bg-blue-100 text-blue-700", "Opening Date"],
              ["bg-green-100 text-green-700", "Contract Start"],
              ["bg-amber-100 text-amber-700", "Contract End"],
            ].map(([c, l]) => (
              <span key={l} className={clsx("text-xs px-2 py-1 rounded-full", c)}>{l}</span>
            ))}
          </div>
        </div>

        {/* Upcoming deadlines sidebar */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Calendar size={15}/> Upcoming Deadlines
          </h3>
          {upcoming.length === 0 ? (
            <div className="card text-center py-8 text-gray-400 text-sm">No upcoming deadlines</div>
          ) : upcoming.map(b => {
            const dl = new Date(b.submission_deadline)
            const daysLeft = Math.ceil((dl - new Date()) / (1000*60*60*24))
            const color = daysLeft > 7 ? "border-l-green-500 bg-green-50"
              : daysLeft > 2 ? "border-l-amber-500 bg-amber-50"
              : "border-l-red-500 bg-red-50"
            const tc = daysLeft > 7 ? "text-green-700" : daysLeft > 2 ? "text-amber-700" : "text-red-700"
            return (
              <div key={b.bid_id} className={clsx("p-3 rounded-lg border-l-4", color)}>
                <div className="font-mono text-xs font-bold text-primary-600">{b.bid_number}</div>
                <div className="font-medium text-sm mt-0.5 line-clamp-2">{b.bid_title}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-500">{format(dl, "dd MMM yyyy")}</span>
                  <span className={clsx("text-xs font-bold", tc)}>{daysLeft}d left</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
