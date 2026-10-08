import React, { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Plus, Trash2, Check, ArrowUp, ArrowDown, ClipboardCheck, X } from "lucide-react"
import { rfpApi } from "../../services/api"
import { apiErrorMessage } from "../../utils/apiError"
import { RFP_MODULES } from "../../utils/rfp"

const DEFAULT_OPTIONS = [{ label: "Yes", value: 100 }, { label: "Partly", value: 50 }, { label: "No", value: 0 }]
let tmpId = 0
const newQuestion = () => ({ key: `n${++tmpId}`, question: "", weight: "", evaluator_title: "", options: DEFAULT_OPTIONS.map(o => ({ ...o, key: `o${++tmpId}` })) })

// Set once by the bid department, per module: the questions every RFP in the module is evaluated against.
export default function EvalQuestionsManager({ module }) {
  const mod = RFP_MODULES[module]
  const api = rfpApi(module)
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ["rfp-eval-config", module], queryFn: () => api.evalConfig().then(r => r.data) })
  const [passMark, setPassMark] = useState(60)
  const [questions, setQuestions] = useState([])

  useEffect(() => {
    if (!data) return
    setPassMark(data.pass_mark)
    setQuestions(data.questions.map(q => ({
      ...q, key: `q${q.question_id}`, weight: Number(q.weight), evaluator_title: q.evaluator_title || "",
      options: q.options.map(o => ({ ...o, key: `o${o.option_id}`, value: Number(o.value) })),
    })))
  }, [data])

  const titles = Object.keys(data?.titles || {})
  const total = Math.round(questions.reduce((s, q) => s + (Number(q.weight) || 0), 0) * 100) / 100
  const weightsOk = questions.length === 0 || Math.abs(total - 100) < 0.01
  const complete = questions.every(q => q.question.trim() && Number(q.weight) > 0 && q.options.length && q.options.every(o => o.label.trim() && o.value !== ""))

  const updateQ = (key, patch) => setQuestions(qs => qs.map(q => q.key === key ? { ...q, ...patch } : q))
  const updateO = (qKey, oKey, patch) => setQuestions(qs => qs.map(q => q.key !== qKey ? q
    : { ...q, options: q.options.map(o => o.key === oKey ? { ...o, ...patch } : o) }))
  const move = (i, d) => setQuestions(qs => { const n = [...qs]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })

  const saveMut = useMutation({
    mutationFn: () => api.saveEvalConfig({
      pass_mark: Number(passMark),
      questions: questions.map(q => ({
        question_id: q.question_id, question: q.question, weight: Number(q.weight), evaluator_title: q.evaluator_title || null,
        options: q.options.map(o => ({ option_id: o.option_id, label: o.label, value: Number(o.value) })),
      })),
    }),
    onSuccess: () => { toast.success("Evaluation questions saved"); qc.invalidateQueries({ queryKey: ["rfp-eval-config", module] }); qc.invalidateQueries({ queryKey: ["rfp-evaluation", module] }) },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the questions")),
  })

  return (
    <div className="space-y-5">
      <div className="card space-y-4">
        <div>
          <div className="section-title flex items-center gap-2"><ClipboardCheck size={13}/> Evaluation questions</div>
          <p className="text-sm text-gray-500 max-w-3xl">
            Set once by the bid department. Every {mod.expro ? "EXPRO request" : `${mod.title} RFP`} is answered against these
            questions; the other modules have their own. Each question has a weight; each answer is worth a share of that
            weight. The {mod.noun}'s score is the total, out of 100%.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="label">Pass mark</label>
            <div className="relative w-32">
              <input type="number" min="0" max="100" className="input pr-8 tabular-nums" value={passMark} onChange={e => setPassMark(e.target.value)}/>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
            </div>
          </div>
          <p className="text-sm text-gray-500 pb-2.5">{mod.expro ? "A request" : "An RFP"} needs at least this score, and the EBITDA minimum from{" "}
            <Link to="/company-settings" className="text-blue-600 hover:underline">Pricing Approval</Link>, to be a <strong className="text-green-700">Go</strong>.</p>
        </div>
        {titles.length === 0 && (
          <div className="alert-info text-xs">
            To say who answers each question, add evaluators with their titles in{" "}
            <Link to="/company-settings" className="underline">Company Settings → Evaluators</Link>.
          </div>
        )}
      </div>

      {questions.map((q, i) => (
        <div key={q.key} className="card space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 text-sm font-bold flex items-center justify-center flex-shrink-0 mt-1">{i + 1}</span>
            <div className="flex-1 grid md:grid-cols-[minmax(0,1fr)_120px_200px] gap-3">
              <div>
                <label className="label">Question</label>
                <textarea className="input" rows={2} value={q.question} onChange={e => updateQ(q.key, { question: e.target.value })}
                  placeholder="e.g. Do we have vendor quotes or partner support for this RFP?"/>
              </div>
              <div>
                <label className="label">Weight</label>
                <div className="relative">
                  <input type="number" min="0" max="100" className="input pr-8 tabular-nums" value={q.weight} onChange={e => updateQ(q.key, { weight: e.target.value })}/>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
                </div>
              </div>
              <div>
                <label className="label">Answered by</label>
                <select className="input" value={q.evaluator_title} onChange={e => updateQ(q.key, { evaluator_title: e.target.value })}>
                  <option value="">Anyone</option>
                  {titles.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              <button className="btn-ghost btn-sm" disabled={i === 0} title="Move up" onClick={() => move(i, -1)}><ArrowUp size={12}/></button>
              <button className="btn-ghost btn-sm" disabled={i === questions.length - 1} title="Move down" onClick={() => move(i, 1)}><ArrowDown size={12}/></button>
              <button className="btn-ghost btn-sm text-red-400" title="Remove question" onClick={() => setQuestions(qs => qs.filter(x => x.key !== q.key))}><Trash2 size={12}/></button>
            </div>
          </div>
          <div className="ml-10">
            <label className="label">Answers and their value</label>
            <div className="space-y-2">
              {q.options.map(o => (
                <div key={o.key} className="flex items-center gap-2">
                  <input className="input max-w-xs" value={o.label} onChange={e => updateO(q.key, o.key, { label: e.target.value })} placeholder="Answer"/>
                  <div className="relative w-28">
                    <input type="number" min="0" max="100" className="input pr-8 tabular-nums" value={o.value} onChange={e => updateO(q.key, o.key, { value: e.target.value })}/>
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
                  </div>
                  <span className="text-xs text-gray-400 w-28">= {Math.round((Number(q.weight) || 0) * (Number(o.value) || 0)) / 100} points</span>
                  <button className="btn-ghost btn-sm text-gray-400" disabled={q.options.length === 1} title="Remove answer"
                    onClick={() => updateQ(q.key, { options: q.options.filter(x => x.key !== o.key) })}><X size={12}/></button>
                </div>
              ))}
              <button className="btn-ghost btn-sm text-xs" onClick={() => updateQ(q.key, { options: [...q.options, { key: `o${++tmpId}`, label: "", value: 0 }] })}>
                <Plus size={11}/> Add answer
              </button>
            </div>
          </div>
        </div>
      ))}

      <button className="w-full card border-dashed border-2 border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-300 flex items-center justify-center gap-2 py-4"
        onClick={() => setQuestions(qs => [...qs, newQuestion()])}>
        <Plus size={15}/> Add question
      </button>

      <div className="sticky bottom-4 card flex items-center gap-4 py-3 shadow-lg">
        <div className={clsx("text-sm font-semibold tabular-nums", weightsOk ? "text-green-700" : "text-red-600")}>
          Weights: {total}% {weightsOk ? "✓" : "— must add up to 100%"}
        </div>
        <div className="text-sm text-gray-400">{questions.length} question{questions.length === 1 ? "" : "s"}</div>
        <button className="btn-primary ml-auto" disabled={!weightsOk || !complete || saveMut.isPending} onClick={() => saveMut.mutate()}>
          <Check size={14}/> {saveMut.isPending ? "Saving…" : "Save questions"}
        </button>
      </div>
    </div>
  )
}
