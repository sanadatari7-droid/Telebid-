import React, { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { evalApi, bidsApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import clsx from "clsx"
import toast from "react-hot-toast"
import {
  Plus, ClipboardCheck, Star, Save, Send,
  Trash2, CheckCircle2, Users, Info, ChevronDown
} from "lucide-react"

// ── helpers ──────────────────────────────────────────────────────────────────
const CRIT_TYPES = ["TECHNICAL", "FINANCIAL", "COMPLIANCE"]
const CRIT_BADGE = { TECHNICAL: "badge-blue", FINANCIAL: "badge-green", COMPLIANCE: "badge-purple" }

// ── main component ────────────────────────────────────────────────────────────
export default function EvaluationsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState("templates")

  // template tab state
  const [selTmplId, setSelTmplId] = useState(null)
  const [showCreateTmpl, setShowCreateTmpl] = useState(false)
  const [showAddCrit, setShowAddCrit] = useState(false)
  const [tmplForm, setTmplForm] = useState({ tmpl_name: "", bid_type_id: "", description: "" })
  const [critForm, setCritForm] = useState({ crit_name: "", crit_type: "TECHNICAL", weight: "", max_score: "100", description: "" })

  // scoring/results tab state
  const [selBidId, setSelBidId] = useState("")
  const [selTmplForBid, setSelTmplForBid] = useState("")
  const [showAssign, setShowAssign] = useState(false)
  const [assignForm, setAssignForm] = useState({ evaluator_id: "", tmpl_id: "", eval_type: "TECHNICAL" })
  const [scores, setScores] = useState({})

  // ── queries ────────────────────────────────────────────────────────────────
  const { data: templates = [], isLoading: tmplsLoading } = useQuery({
    queryKey: ["eval-templates"],
    queryFn: () => evalApi.getTemplates().then(r => r.data),
    retry: 1,
  })

  const { data: tmplDetail } = useQuery({
    queryKey: ["eval-tmpl-detail", selTmplId],
    queryFn: () => evalApi.getTemplate(selTmplId).then(r => r.data),
    enabled: !!selTmplId,
  })

  const { data: bidsPage, isLoading: bidsLoading } = useQuery({
    queryKey: ["eval-bids-list"],
    queryFn: () => bidsApi.list({ page_size: 200, page: 1 }).then(r => r.data),
    retry: 1,
    staleTime: 0,
  })
  const allBids = bidsPage?.items || []

  const selBid = allBids.find(b => String(b.bid_id) === String(selBidId))
  const matchTmpls = templates.filter(t => !t.bid_type_id || t.bid_type_id === selBid?.bid_type_id)
  const tmplOptions = matchTmpls.length > 0 ? matchTmpls : templates

  // auto-select template when bid changes and only one option
  useEffect(() => {
    if (selBidId && tmplOptions.length === 1) {
      setSelTmplForBid(String(tmplOptions[0].tmpl_id))
    } else {
      setSelTmplForBid("")
    }
  }, [selBidId])

  const { data: myEval, isError: myEvalMissing } = useQuery({
    queryKey: ["my-eval", selBidId],
    queryFn: () => evalApi.getMyEval(Number(selBidId)).then(r => r.data),
    enabled: !!selBidId && tab === "scoring",
    retry: false,
  })

  const { data: results } = useQuery({
    queryKey: ["eval-results", selBidId],
    queryFn: () => evalApi.getResults(Number(selBidId)).then(r => r.data),
    enabled: !!selBidId && tab === "results",
    retry: false,
  })

  const { data: evaluators = [] } = useQuery({
    queryKey: ["evaluators", selBidId],
    queryFn: () => evalApi.getEvaluators(Number(selBidId)).then(r => r.data),
    enabled: !!selBidId && tab === "results",
    retry: false,
  })

  // ── mutations ──────────────────────────────────────────────────────────────
  const createTmplMut = useMutation({
    mutationFn: () => evalApi.createTemplate({
      tmpl_name: tmplForm.tmpl_name,
      description: tmplForm.description || null,
      bid_type_id: tmplForm.bid_type_id ? Number(tmplForm.bid_type_id) : null,
    }),
    onSuccess: () => {
      toast.success("Template created")
      qc.invalidateQueries({ queryKey: ["eval-templates"] })
      setShowCreateTmpl(false)
      setTmplForm({ tmpl_name: "", bid_type_id: "", description: "" })
    },
  })

  const addCritMut = useMutation({
    mutationFn: () => evalApi.addCriterion(selTmplId, {
      crit_name: critForm.crit_name,
      crit_type: critForm.crit_type,
      weight: Number(critForm.weight),
      max_score: Number(critForm.max_score) || 100,
      description: critForm.description || null,
    }),
    onSuccess: () => {
      toast.success("Criterion added")
      qc.invalidateQueries({ queryKey: ["eval-tmpl-detail", selTmplId] })
      setShowAddCrit(false)
      setCritForm({ crit_name: "", crit_type: "TECHNICAL", weight: "", max_score: "100", description: "" })
    },
    onError: e => toast.error(apiErrorMessage(e, "Failed to add criterion")),
  })

  const delCritMut = useMutation({
    mutationFn: critId => evalApi.deleteCriterion(selTmplId, critId),
    onSuccess: () => {
      toast.success("Removed")
      qc.invalidateQueries({ queryKey: ["eval-tmpl-detail", selTmplId] })
    },
  })

  const assignMut = useMutation({
    mutationFn: () => evalApi.assignEvaluator(Number(selBidId), {
      evaluator_id: Number(assignForm.evaluator_id),
      tmpl_id: Number(assignForm.tmpl_id || selTmplForBid),
      eval_type: assignForm.eval_type,
    }),
    onSuccess: () => {
      toast.success("Evaluator assigned")
      qc.invalidateQueries({ queryKey: ["evaluators", selBidId] })
      setShowAssign(false)
      setAssignForm({ evaluator_id: "", tmpl_id: "", eval_type: "TECHNICAL" })
    },
    onError: e => toast.error(apiErrorMessage(e, "Failed to assign")),
  })

  const saveScoreMut = useMutation({
    mutationFn: d => evalApi.saveScore(Number(selBidId), d),
    onSuccess: () => toast.success("Score saved"),
  })

  const submitEvalMut = useMutation({
    mutationFn: () => evalApi.submitEval(Number(selBidId), { comments: "" }),
    onSuccess: r => {
      toast.success(`Submitted! Score: ${r.data.total_score}`)
      qc.invalidateQueries({ queryKey: ["my-eval", selBidId] })
    },
    onError: e => toast.error(apiErrorMessage(e, "Submit failed")),
  })

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary-800">Evaluation Module</h1>
          <p className="text-sm text-gray-500">Templates → Assign → Score → Auto-rank</p>
        </div>
        <div className="flex gap-2">
          {tab === "templates" && (
            <button className="btn-primary" onClick={() => setShowCreateTmpl(true)}>
              <Plus size={15}/> New Template
            </button>
          )}
          {tab !== "templates" && selBidId && (
            <button className="btn-secondary" onClick={() => setShowAssign(true)}>
              <Users size={15}/> Assign Evaluator
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex">
          {[["templates","📋 Templates"],["scoring","⭐ Score Vendors"],["results","🏆 Results"]].map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors
                ${tab === t ? "border-primary-500 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ TEMPLATES TAB ═══ */}
      {tab === "templates" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Templates</h3>
              <span className="badge-blue">{templates.length}</span>
            </div>
            {tmplsLoading ? (
              <div className="card text-center py-6">
                <div className="animate-spin inline-block w-5 h-5 border-4 border-primary-500 border-t-transparent rounded-full"/>
              </div>
            ) : templates.length === 0 ? (
              <div className="card text-center py-8 text-gray-400 text-sm">
                <ClipboardCheck size={28} className="mx-auto mb-2 opacity-20"/>
                No templates yet — create one to get started
              </div>
            ) : templates.map(t => (
              <div key={t.tmpl_id}
                onClick={() => setSelTmplId(t.tmpl_id)}
                className={clsx("card cursor-pointer transition-all border-2",
                  selTmplId === t.tmpl_id ? "border-primary-500 bg-primary-50" : "border-transparent hover:border-gray-200")}>
                <div className="font-semibold text-sm">{t.tmpl_name}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {t.bid_type_name ? `For: ${t.bid_type_name}` : "All bid types"}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">{t.criteria_count || 0} criteria</span>
                  <span className="badge-blue text-xs">{t.created_by_name}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Detail */}
          <div className="lg:col-span-2">
            {selTmplId && tmplDetail ? (
              <div className="card">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h3 className="font-bold text-primary-800 text-lg">{tmplDetail.template?.tmpl_name}</h3>
                    <p className="text-xs text-gray-500">{tmplDetail.template?.description || "No description"}</p>
                  </div>
                  <button className="btn-primary btn-sm" onClick={() => setShowAddCrit(true)}>
                    <Plus size={13}/> Add Criterion
                  </button>
                </div>

                {CRIT_TYPES.map(type => {
                  const crits = (tmplDetail.criteria || []).filter(c => c.crit_type === type)
                  if (!crits.length) return null
                  const totalW = crits.reduce((s, c) => s + Number(c.weight), 0)
                  return (
                    <div key={type} className="mb-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className={clsx("badge", CRIT_BADGE[type])}>{type}</span>
                        <span className={clsx("text-xs font-medium", totalW > 100 ? "text-red-600" : "text-gray-500")}>
                          Weight: {totalW}%
                        </span>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-gray-200">
                        <table className="tbl">
                          <thead><tr><th>Name</th><th>Weight</th><th>Max Score</th><th></th></tr></thead>
                          <tbody>
                            {crits.map(c => (
                              <tr key={c.crit_id}>
                                <td className="font-medium">{c.crit_name}</td>
                                <td><span className="badge-amber">{c.weight}%</span></td>
                                <td className="text-sm">{c.max_score}</td>
                                <td>
                                  <button className="btn-ghost btn-sm text-red-400"
                                    onClick={() => delCritMut.mutate(c.crit_id)}>
                                    <Trash2 size={12}/>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}

                {!tmplDetail.criteria?.length && (
                  <div className="text-center py-10 text-gray-400 text-sm">
                    <Info size={24} className="mx-auto mb-2 opacity-30"/>
                    Click "Add Criterion" to define scoring criteria
                  </div>
                )}
              </div>
            ) : (
              <div className="card text-center py-16 text-gray-300">
                <ClipboardCheck size={48} className="mx-auto mb-3 opacity-20"/>
                <p className="text-gray-500 font-medium">Select a template to view criteria</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ BID SELECTOR (scoring + results) ═══ */}
      {(tab === "scoring" || tab === "results") && (
        <div className="card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Select Bid</label>
              <select className="input" value={selBidId}
                onChange={e => { setSelBidId(e.target.value); setSelTmplForBid("") }}>
                {bidsLoading
                  ? <option>Loading bids…</option>
                  : <>
                      <option value="">— Choose a bid to evaluate —</option>
                      {allBids.map(b => (
                        <option key={b.bid_id} value={b.bid_id}>
                          {b.bid_number} — {b.bid_title} [{b.bid_type_code}]
                        </option>
                      ))}
                    </>
                }
              </select>
              {!bidsLoading && allBids.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No bids found — create a bid first</p>
              )}
            </div>
            {selBidId && tab === "scoring" && (
              <div>
                <label className="label">
                  Evaluation Template
                  {matchTmpls.length > 0 && <span className="ml-1 text-primary-400 font-normal text-xs">({matchTmpls.length} match this bid type)</span>}
                </label>
                <select className="input" value={selTmplForBid} onChange={e => setSelTmplForBid(e.target.value)}>
                  <option value="">— Select template —</option>
                  {tmplOptions.map(t => (
                    <option key={t.tmpl_id} value={t.tmpl_id}>
                      {t.tmpl_name} {t.bid_type_name ? `(${t.bid_type_name})` : "(All types)"}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {selBid && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Selected:</span>
              <span className="badge-blue">{selBid.bid_type_code}</span>
              <span className="font-mono text-xs text-primary-600">{selBid.bid_number}</span>
              <span className="text-xs text-gray-500 truncate">{selBid.bid_title}</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ SCORING TAB ═══ */}
      {tab === "scoring" && !selBidId && (
        <div className="card text-center py-12 text-gray-400">
          <ChevronDown size={36} className="mx-auto mb-2 opacity-20"/>
          <p className="font-medium text-gray-500">Select a bid above to start scoring</p>
        </div>
      )}

      {tab === "scoring" && selBidId && (
        <div>
          {myEval?.evaluation && !myEvalMissing ? (
            <div className="card">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-bold text-primary-800">{myEval.evaluation.tmpl_name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Status: <span className={clsx("font-semibold",
                      myEval.evaluation.status === "SUBMITTED" ? "text-green-600" : "text-amber-600")}>
                      {myEval.evaluation.status}
                    </span>
                  </p>
                </div>
                {myEval.evaluation.total_score && (
                  <div className="text-center bg-primary-50 px-4 py-2 rounded-xl">
                    <div className="text-2xl font-bold text-primary-700">{myEval.evaluation.total_score}</div>
                    <div className="text-xs text-gray-400">Total Score</div>
                  </div>
                )}
              </div>

              {myEval.evaluation.status === "SUBMITTED" ? (
                <div className="text-center py-8 bg-green-50 rounded-xl border border-green-200">
                  <CheckCircle2 size={48} className="mx-auto mb-3 text-green-500"/>
                  <p className="font-semibold text-lg text-green-800">Evaluation Submitted</p>
                  <p className="text-sm text-gray-500 mt-1">Score: <strong className="text-primary-600">{myEval.evaluation.total_score}</strong></p>
                </div>
              ) : (
                <>
                  {(myEval.vendors || []).length === 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 mb-4 flex gap-2">
                      <Info size={16} className="flex-shrink-0 mt-0.5"/>
                      No vendors invited yet — go to Invitations page to invite vendors first
                    </div>
                  )}

                  {(myEval.criteria || []).map(c => (
                    <div key={c.crit_id} className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{c.crit_name}</span>
                          <span className={clsx("badge text-xs", CRIT_BADGE[c.crit_type])}>{c.crit_type}</span>
                        </div>
                        <span className="text-xs text-gray-400">Weight: {c.weight}% · Max: {c.max_score}</span>
                      </div>
                      {(myEval.vendors || []).map(v => {
                        const key = `${c.crit_id}_${v.vendor_id}`
                        const saved = Array.isArray(c.scores) ? c.scores.find(s => s.vendor_id === v.vendor_id) : null
                        const val = scores[key] !== undefined ? scores[key] : (Number(saved?.score) || 0)
                        return (
                          <div key={v.vendor_id} className="flex items-center gap-3 mb-2 bg-white p-2 rounded-lg border border-gray-100">
                            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center font-bold text-xs text-primary-600 flex-shrink-0">
                              {v.company_name?.[0]}
                            </div>
                            <span className="text-xs font-medium text-gray-700 w-28 flex-shrink-0 truncate">{v.company_name}</span>
                            <input type="range" min={0} max={Number(c.max_score)} step={1} value={val}
                              onChange={e => setScores(p => ({ ...p, [key]: Number(e.target.value) }))}
                              className="flex-1 accent-primary-500"/>
                            <input type="number" min={0} max={Number(c.max_score)} value={val}
                              onChange={e => setScores(p => ({ ...p, [key]: Math.min(Number(e.target.value), Number(c.max_score)) }))}
                              className="input w-16 text-center py-1 text-sm font-bold"/>
                            <span className="text-xs text-gray-400">/{c.max_score}</span>
                            <button title="Save score" className="btn-ghost btn-sm text-primary-500"
                              onClick={() => saveScoreMut.mutate({ crit_id: c.crit_id, vendor_id: v.vendor_id, score: val })}>
                              <Save size={13}/>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  <div className="flex justify-end pt-4 border-t border-gray-100">
                    <button className="btn-primary" disabled={submitEvalMut.isPending}
                      onClick={() => { if (window.confirm("Submit evaluation? Cannot be undone.")) submitEvalMut.mutate() }}>
                      <Send size={14}/> {submitEvalMut.isPending ? "Submitting…" : "Submit Evaluation"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-400">
              <ClipboardCheck size={36} className="mx-auto mb-3 opacity-20"/>
              <p className="font-medium text-gray-600">No evaluation assigned to you for this bid</p>
              <p className="text-sm mt-1 text-gray-400">Click "Assign Evaluator" to assign yourself (user ID: 1)</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ RESULTS TAB ═══ */}
      {tab === "results" && !selBidId && (
        <div className="card text-center py-12 text-gray-400">
          <ChevronDown size={36} className="mx-auto mb-2 opacity-20"/>
          <p className="font-medium text-gray-500">Select a bid above to view results</p>
        </div>
      )}

      {tab === "results" && selBidId && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Star size={16} className="text-gold-500"/> Vendor Ranking
            </h3>
            {results?.ranking?.length > 0 ? (
              <div className="space-y-2">
                {results.ranking.map(r => (
                  <div key={r.vendor_id} className={clsx("flex items-center gap-4 p-4 rounded-xl border",
                    r.ranking === 1 ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-100")}>
                    <div className="text-2xl w-10 text-center">
                      {r.ranking === 1 ? "🥇" : r.ranking === 2 ? "🥈" : r.ranking === 3 ? "🥉" : `#${r.ranking}`}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold">{r.vendor_name}</div>
                      {r.ranking === 1 && <div className="text-xs text-green-600 font-medium">✓ Recommended Winner</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-28 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${r.weighted_score}%` }}/>
                      </div>
                      <span className="font-bold text-primary-700 w-12 text-right">{r.weighted_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-center py-6 text-gray-400 text-sm">No scores submitted yet</p>}
          </div>

          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Users size={16}/> Evaluators ({evaluators.length})
            </h3>
            {evaluators.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No evaluators assigned</p>
            ) : (
              <table className="tbl">
                <thead><tr><th>Evaluator</th><th>Template</th><th>Type</th><th>Status</th><th>Score</th><th>Submitted</th></tr></thead>
                <tbody>
                  {evaluators.map(e => (
                    <tr key={e.bid_eval_id}>
                      <td className="font-medium">{e.evaluator_name}</td>
                      <td className="text-sm text-gray-500">{e.tmpl_name}</td>
                      <td><span className="badge-blue">{e.eval_type}</span></td>
                      <td><span className={clsx("badge", e.status === "SUBMITTED" ? "badge-green" : "badge-amber")}>{e.status}</span></td>
                      <td className="font-bold text-primary-600">{e.total_score || "—"}</td>
                      <td className="text-xs text-gray-400">{fmt(e.submitted_at, "dd MMM yyyy HH:mm")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══ MODALS ═══ */}

      {/* Create Template */}
      {showCreateTmpl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-primary-800">New Evaluation Template</h2>
              <button className="btn-ghost p-2" onClick={() => setShowCreateTmpl(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Template Name *</label>
                <input className="input" placeholder="e.g. Standard RFP Evaluation"
                  value={tmplForm.tmpl_name}
                  onChange={e => setTmplForm(p => ({ ...p, tmpl_name: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Bid Type (optional)</label>
                <select className="input"
                  value={tmplForm.bid_type_id}
                  onChange={e => setTmplForm(p => ({ ...p, bid_type_id: e.target.value }))}>
                  <option value="">All Bid Types</option>
                  <option value="1">RFQ — Request for Quotation</option>
                  <option value="2">RFP — Request for Proposal</option>
                  <option value="3">RFI — Request for Information</option>
                  <option value="4">Public Tender</option>
                  <option value="5">General Bid</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">Linking to a bid type auto-suggests this template when scoring that bid type</p>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={2} placeholder="What is this template for?"
                  value={tmplForm.description}
                  onChange={e => setTmplForm(p => ({ ...p, description: e.target.value }))}/>
              </div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button className="btn-secondary" onClick={() => setShowCreateTmpl(false)}>Cancel</button>
                <button className="btn-primary" disabled={!tmplForm.tmpl_name.trim() || createTmplMut.isPending}
                  onClick={() => createTmplMut.mutate()}>
                  {createTmplMut.isPending ? "Creating…" : "Create Template"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Criterion */}
      {showAddCrit && selTmplId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-primary-800">Add Criterion</h2>
              <button className="btn-ghost p-2" onClick={() => setShowAddCrit(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Criterion Name *</label>
                <input className="input" placeholder="e.g. Price Competitiveness"
                  value={critForm.crit_name}
                  onChange={e => setCritForm(p => ({ ...p, crit_name: e.target.value }))}/>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Type *</label>
                  <select className="input" value={critForm.crit_type}
                    onChange={e => setCritForm(p => ({ ...p, crit_type: e.target.value }))}>
                    <option value="TECHNICAL">Technical</option>
                    <option value="FINANCIAL">Financial</option>
                    <option value="COMPLIANCE">Compliance</option>
                  </select>
                </div>
                <div>
                  <label className="label">Weight (%) *</label>
                  <input type="number" className="input" placeholder="e.g. 30" min="1" max="100"
                    value={critForm.weight}
                    onChange={e => setCritForm(p => ({ ...p, weight: e.target.value }))}/>
                </div>
              </div>
              <div>
                <label className="label">Max Score</label>
                <input type="number" className="input" min="1"
                  value={critForm.max_score}
                  onChange={e => setCritForm(p => ({ ...p, max_score: e.target.value }))}/>
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input" placeholder="What does this measure?"
                  value={critForm.description}
                  onChange={e => setCritForm(p => ({ ...p, description: e.target.value }))}/>
              </div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button className="btn-secondary" onClick={() => setShowAddCrit(false)}>Cancel</button>
                <button className="btn-primary"
                  disabled={!critForm.crit_name.trim() || !critForm.weight || addCritMut.isPending}
                  onClick={() => addCritMut.mutate()}>
                  {addCritMut.isPending ? "Adding…" : "Add Criterion"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Evaluator */}
      {showAssign && selBidId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold text-primary-800">Assign Evaluator</h2>
                <p className="text-xs text-gray-400">Bid: {selBid?.bid_number}</p>
              </div>
              <button className="btn-ghost p-2" onClick={() => setShowAssign(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Evaluator User ID *</label>
                <input type="number" className="input" placeholder="e.g. 1"
                  value={assignForm.evaluator_id}
                  onChange={e => setAssignForm(p => ({ ...p, evaluator_id: e.target.value }))}/>
                <p className="text-xs text-gray-400 mt-1">Admin user ID is 1. Check Users page for other IDs.</p>
              </div>
              <div>
                <label className="label">Template *</label>
                <select className="input" value={assignForm.tmpl_id || selTmplForBid}
                  onChange={e => setAssignForm(p => ({ ...p, tmpl_id: e.target.value }))}>
                  <option value="">Select template…</option>
                  {(tmplOptions.length > 0 ? tmplOptions : templates).map(t => (
                    <option key={t.tmpl_id} value={t.tmpl_id}>{t.tmpl_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Evaluation Type</label>
                <select className="input" value={assignForm.eval_type}
                  onChange={e => setAssignForm(p => ({ ...p, eval_type: e.target.value }))}>
                  <option value="TECHNICAL">Technical Evaluation</option>
                  <option value="FINANCIAL">Financial Evaluation</option>
                </select>
              </div>
              <div className="flex gap-3 justify-end pt-2 border-t">
                <button className="btn-secondary" onClick={() => setShowAssign(false)}>Cancel</button>
                <button className="btn-primary"
                  disabled={!assignForm.evaluator_id || assignMut.isPending}
                  onClick={() => assignMut.mutate()}>
                  {assignMut.isPending ? "Assigning…" : "Assign Evaluator"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
