import React, { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Check, CheckCircle2, XCircle, AlertCircle, ClipboardCheck, TrendingUp, UserCheck } from "lucide-react"
import { rfpIctApi } from "../../services/api"
import { apiErrorMessage } from "../../utils/apiError"
import { fmtDT } from "../../utils/fmt"

// Mirrors the server's rule so the result updates as answers are picked; the server recomputes on save.
function computeResult(questions, answers, ebitda, ebitdaMin, passMark) {
  if (!questions.length) return { recommendation: "NOT_SET_UP", score: null, reasons: ["No evaluation questions have been set up yet"], answered: 0, total: 0 }
  let score = 0, answered = 0
  questions.forEach(q => {
    const opt = q.options.find(o => o.option_id === answers[q.question_id]?.option_id)
    if (opt) { answered++; score += Number(q.weight) * Number(opt.value) / 100 }
  })
  score = Math.round(score * 100) / 100
  const base = { score, answered, total: questions.length }
  const missing = []
  if (answered < questions.length) { const n = questions.length - answered; missing.push(`${n} question${n === 1 ? "" : "s"} still to answer`) }
  if (ebitdaMin !== null && ebitda === "") missing.push("Enter the business case EBITDA")
  if (missing.length) return { ...base, recommendation: "INCOMPLETE", reasons: missing }
  const reasons = []
  if (score < passMark) reasons.push(`Score ${score}% is below the ${passMark}% pass mark`)
  if (ebitdaMin !== null && Number(ebitda) < ebitdaMin) reasons.push(`EBITDA ${Number(ebitda)}% is below the ${ebitdaMin}% minimum`)
  if (reasons.length) return { ...base, recommendation: "NO_GO", reasons }
  const ok = [`Score ${score}% meets the ${passMark}% pass mark`]
  if (ebitdaMin !== null) ok.push(`EBITDA ${Number(ebitda)}% meets the ${ebitdaMin}% minimum`)
  return { ...base, recommendation: "GO", reasons: ok }
}

const VERDICT = {
  GO:         { label: "Go",         icon: CheckCircle2, cls: "bg-green-50 border-green-200 text-green-800", bar: "bg-green-500" },
  NO_GO:      { label: "No-Go",      icon: XCircle,      cls: "bg-red-50 border-red-200 text-red-800",       bar: "bg-red-500" },
  INCOMPLETE: { label: "Incomplete", icon: AlertCircle,  cls: "bg-amber-50 border-amber-200 text-amber-800", bar: "bg-amber-400" },
  NOT_SET_UP: { label: "Not set up", icon: AlertCircle,  cls: "bg-gray-50 border-gray-200 text-gray-700",    bar: "bg-gray-300" },
}

export default function RfpEvaluation({ rfpId }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ["rfp-evaluation", rfpId], queryFn: () => rfpIctApi.evaluation(rfpId).then(r => r.data) })
  const [answers, setAnswers] = useState({})
  const [ebitda, setEbitda] = useState("")

  useEffect(() => {
    if (!data) return
    setAnswers(Object.fromEntries(data.answers.map(a => [a.question_id, { option_id: a.option_id, comment: a.comment || "" }])))
    setEbitda(data.ebitda_pct ?? "")
  }, [data])

  const questions = data?.questions || []
  const result = useMemo(() => computeResult(questions, answers, ebitda, data?.ebitda_min ?? null, data?.pass_mark ?? 60),
    [questions, answers, ebitda, data])
  const savedBy = Object.fromEntries((data?.answers || []).map(a => [a.question_id, a]))

  const groups = useMemo(() => {
    const m = new Map()
    questions.forEach((q, i) => {
      const key = q.evaluator_title || ""
      if (!m.has(key)) m.set(key, [])
      m.get(key).push({ ...q, num: i + 1 })
    })
    return [...m.entries()]
  }, [questions])

  const saveMut = useMutation({
    mutationFn: () => rfpIctApi.saveEvaluation(rfpId, {
      ebitda_pct: ebitda === "" ? null : Number(ebitda),
      answers: Object.entries(answers).filter(([, a]) => a.option_id).map(([qid, a]) => ({ question_id: Number(qid), option_id: a.option_id, comment: a.comment })),
    }),
    onSuccess: r => {
      const v = VERDICT[r.data.result.recommendation]
      toast.success(`Evaluation saved — ${v.label}`)
      qc.setQueryData(["rfp-evaluation", rfpId], r.data)
      qc.invalidateQueries({ queryKey: ["rfp-ict"] })
    },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the evaluation")),
  })

  if (isLoading || !data) return <div className="card text-sm text-gray-400">Loading evaluation…</div>

  if (!questions.length) {
    return (
      <div className="card text-center py-12 space-y-3">
        <ClipboardCheck size={32} className="mx-auto text-gray-300"/>
        <p className="text-gray-700 font-medium">No evaluation questions yet</p>
        <p className="text-sm text-gray-500">The bid department sets the questions once, then every RFP is evaluated against them.</p>
        <Link to="/rfp-ict?tab=questions" className="btn-primary inline-flex">Set up evaluation questions</Link>
      </div>
    )
  }

  const v = VERDICT[result.recommendation]
  const VIcon = v.icon
  const pct = Math.max(0, Math.min(100, result.score || 0))

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      <div className="space-y-5 min-w-0">
        {groups.map(([title, qs]) => (
          <section key={title || "general"} className="card space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck size={15} className="text-blue-600"/>
              <h2 className="font-bold text-gray-900">{title || "General questions"}</h2>
              {title && <span className="text-sm text-gray-500">· {(data.titles[title] || []).join(", ") || "no evaluator with this title"}</span>}
            </div>
            {qs.map(q => {
              const a = answers[q.question_id] || {}
              const saved = savedBy[q.question_id]
              return (
                <div key={q.question_id} className="p-4 rounded-xl border border-gray-100 bg-gray-50/50 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-bold text-blue-700 bg-blue-50 rounded-md px-1.5 py-0.5 flex-shrink-0 mt-0.5">Q{q.num}</span>
                    <p className="text-sm font-medium text-gray-900 flex-1">{q.question}</p>
                    <span className="text-xs text-gray-500 whitespace-nowrap">Weight {Number(q.weight)}%</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-9">
                    {q.options.map(o => (
                      <button type="button" key={o.option_id}
                        onClick={() => setAnswers(p => ({ ...p, [q.question_id]: { ...a, option_id: a.option_id === o.option_id ? null : o.option_id } }))}
                        className={clsx("px-3.5 py-1.5 rounded-lg border text-sm transition-colors",
                          a.option_id === o.option_id ? "bg-blue-600 border-blue-600 text-white font-medium" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")}>
                        {o.label} <span className={a.option_id === o.option_id ? "text-white/70" : "text-gray-400"}>· {Number(o.value)}%</span>
                      </button>
                    ))}
                  </div>
                  <div className="pl-9">
                    <input className="input !py-1.5 text-sm" placeholder="Note (optional)" value={a.comment || ""}
                      onChange={e => setAnswers(p => ({ ...p, [q.question_id]: { ...a, comment: e.target.value } }))}/>
                    {saved?.answered_by_name && <p className="text-xs text-gray-400 mt-1">Answered by {saved.answered_by_name} · {fmtDT(saved.answered_at)}</p>}
                  </div>
                </div>
              )
            })}
          </section>
        ))}

        <section className="card space-y-3">
          <div className="flex items-center gap-2"><TrendingUp size={15} className="text-blue-600"/><h2 className="font-bold text-gray-900">Business case</h2></div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="label">EBITDA margin</label>
              <div className="relative w-36">
                <input type="number" step="0.1" className="input pr-8 tabular-nums" value={ebitda} onChange={e => setEbitda(e.target.value)} placeholder="—"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 pb-2.5">
              {data.ebitda_min !== null
                ? <>Minimum to Go: <strong>{data.ebitda_min}%</strong> (set in Company Settings → Pricing Approval Cycle)</>
                : <>No EBITDA minimum is set, so it doesn't affect the result. Set one in Company Settings → Pricing Approval Cycle.</>}
            </p>
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-20 space-y-4">
        <div className={clsx("card border-2 p-5 space-y-4", v.cls)}>
          <div className="flex items-center gap-2">
            <VIcon size={22}/>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">Recommendation</div>
              <div className="text-2xl font-bold leading-tight">{v.label}</div>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold tabular-nums">{result.score ?? 0}%</span>
              <span className="text-xs opacity-70">{result.answered}/{result.total} answered</span>
            </div>
            <div className="relative h-2.5 rounded-full bg-white/70 mt-2 overflow-visible">
              <div className={clsx("h-full rounded-full transition-all", v.bar)} style={{ width: `${pct}%` }}/>
              <div className="absolute -top-1 w-0.5 bg-gray-800" style={{ left: `${data.pass_mark}%`, height: 18 }} title="Pass mark"/>
            </div>
            <div className="text-xs opacity-70 mt-1.5">Pass mark {data.pass_mark}%</div>
          </div>
          <ul className="space-y-1 text-sm">
            {result.reasons.map(r => <li key={r} className="flex gap-1.5"><span>•</span>{r}</li>)}
          </ul>
        </div>
        <button className="btn-primary w-full justify-center" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
          <Check size={14}/> {saveMut.isPending ? "Saving…" : "Save evaluation"}
        </button>
        {data.updated_at && <p className="text-xs text-gray-400 text-center">Last saved {fmtDT(data.updated_at)}</p>}
      </aside>
    </div>
  )
}
