import React from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Circle, ArrowRight, Rocket } from "lucide-react"
import { companyConfigApi } from "../../services/api"

// What a new company still has to set up. Hidden once everything is done.
export default function SetupChecklist() {
  const { data } = useQuery({ queryKey: ["setup-status"], queryFn: () => companyConfigApi.setupStatus().then(r => r.data) })
  if (!data) return null
  const steps = data.steps
  const done = steps.filter(s => s.done).length
  if (done === steps.length) return null
  const next = steps.find(s => !s.done)
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Rocket size={18}/></span>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-900">Getting started</h2>
          <p className="text-sm text-gray-500">Set these up once, and bids go through without stopping. {done} of {steps.length} done.</p>
        </div>
        <Link to={next.link} className="btn-primary btn-sm">Next: set it up <ArrowRight size={13}/></Link>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-green-500 transition-all" style={{ width: `${100 * done / steps.length}%` }}/>
      </div>
      <ul className="grid sm:grid-cols-2 gap-1">
        {steps.map(s => (
          <li key={s.id}>
            <Link to={s.link} className="flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm hover:bg-gray-50">
              {s.done ? <CheckCircle2 size={16} className="text-green-600 flex-shrink-0"/> : <Circle size={16} className="text-gray-300 flex-shrink-0"/>}
              <span className={s.done ? "text-gray-400 line-through" : "text-gray-800"}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
