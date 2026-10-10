import React, { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Check, BadgePercent, Undo2, Clock, CheckCircle2, AlertTriangle } from "lucide-react"
import { rfpApi } from "../../services/api"
import { apiErrorMessage } from "../../utils/apiError"
import { fmtDT } from "../../utils/fmt"
import { RFP_MODULES, formatMoney } from "../../utils/rfp"

function Row({ num, label, source, children }) {
  return (
    <div className="grid sm:grid-cols-[190px_minmax(0,1fr)] gap-x-4 gap-y-1 py-4 border-b border-gray-100 last:border-0">
      <div>
        <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <span className="text-xs font-bold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">{num}</span>{label}
        </div>
        {source && <div className="text-xs text-gray-400 mt-1 sm:ml-7">{source}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Money({ value, onChange, currency, placeholder = "0" }) {
  const d = currency?.decimals ?? 2
  return (
    <div className="relative max-w-xs">
      <input type="number" min="0" step={1 / 10 ** d} className="input pr-14 tabular-nums" value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder}/>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{currency?.code}</span>
    </div>
  )
}

const n = v => (v === "" || v === null || v === undefined ? null : Number(v))
const round2 = x => Math.round(x * 100) / 100

// The same rules as the server: which level has to approve these figures, and why.
function assess(basis, f, cfg) {
  const price = n(f.price), cost = n(f.cost), list = n(f.list_price), ebitda = n(f.ebitda_pct)
  if (!(price > 0)) return null
  let pct, level, reasons = []
  if (basis === "MARGIN") {
    if (cost === null) return null
    pct = round2((price - cost) / price * 100)
    const l1 = n(cfg.ict_l1_min_margin), l2 = n(cfg.ict_l2_min_margin)
    if (l1 !== null && pct >= l1) { level = 1; reasons.push(`Margin ${pct}% is at least Level 1's minimum of ${l1}%`) }
    else if (l2 !== null && pct >= l2) { level = 2; reasons.push(`Margin ${pct}% is below Level 1's minimum but at least Level 2's minimum of ${l2}%`) }
    else { level = 3; reasons.push(`Margin ${pct}% is below Level 2's minimum${l2 !== null ? ` of ${l2}%` : ""}`) }
  } else {
    if (!(list > 0) || price > list) return null
    pct = round2((list - price) / list * 100)
    const l1 = n(cfg.telecom_l1_max_discount), l2 = n(cfg.telecom_l2_max_discount)
    if (l1 !== null && pct <= l1) { level = 1; reasons.push(`Discount ${pct}% is within Level 1's limit of ${l1}%`) }
    else if (l2 !== null && pct <= l2) { level = 2; reasons.push(`Discount ${pct}% is above Level 1's limit but within Level 2's limit of ${l2}%`) }
    else { level = 3; reasons.push(`Discount ${pct}% is above Level 2's limit${l2 !== null ? ` of ${l2}%` : ""}`) }
  }
  const emin = n(cfg.ebitda_min_pct)
  if (emin !== null && ebitda !== null && ebitda < emin) { level = 3; reasons.push(`EBITDA ${ebitda}% is below the ${emin}% minimum, so Level 3 must approve`) }
  return { pct, level, reasons }
}

const STATUS = {
  PENDING:   { label: "Waiting for approval", icon: Clock,         cls: "bg-amber-50 border-amber-200 text-amber-800" },
  APPROVED:  { label: "Pricing approved",     icon: CheckCircle2,  cls: "bg-green-50 border-green-200 text-green-800" },
  SENT_BACK: { label: "Sent back",            icon: AlertTriangle, cls: "bg-red-50 border-red-200 text-red-800" },
}

export default function RfpPricing({ module, rfpId }) {
  const mod = RFP_MODULES[module]
  const api = rfpApi(module)
  const key = ["rfp-pricing", module, rfpId]
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.pricing(rfpId).then(r => r.data) })
  const [form, setForm] = useState(null)
  const [backNote, setBackNote] = useState("")
  const [showBack, setShowBack] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const str = v => (v === null || v === undefined ? "" : String(Number(v)))

  useEffect(() => {
    if (!data) return
    const p = data.pricing
    setForm(p
      ? { cost: str(p.cost), price: str(p.price), list_price: str(p.list_price), ebitda_pct: str(p.ebitda_pct), notes: p.notes || "" }
      : { cost: "", price: str(data.defaults.price), list_price: "", ebitda_pct: str(data.defaults.ebitda_pct), notes: "" })
  }, [data])

  const onDone = msg => r => { toast.success(msg); qc.setQueryData(key, r.data); setShowBack(false); setBackNote("") }
  const saveMut = useMutation({
    mutationFn: () => api.savePricing(rfpId, {
      price: n(form.price), cost: data.basis === "MARGIN" ? n(form.cost) : null,
      list_price: data.basis === "DISCOUNT" ? n(form.list_price) : null, ebitda_pct: n(form.ebitda_pct), notes: form.notes,
    }),
    onSuccess: r => onDone(r.data.pricing.status === "APPROVED" ? "Saved" : "Pricing submitted for approval")(r),
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the pricing")),
  })
  const approveMut = useMutation({
    mutationFn: lvl => api.approvePricing(rfpId, lvl),
    onSuccess: r => onDone(r.data.pricing.status === "APPROVED" ? "Pricing approved" : `Level ${r.data.pricing.approval_level} approved`)(r),
    onError: err => toast.error(apiErrorMessage(err, "Couldn't record the approval")),
  })
  const backMut = useMutation({
    mutationFn: () => api.sendBackPricing(rfpId, backNote),
    onSuccess: onDone("Pricing sent back"),
    onError: err => toast.error(apiErrorMessage(err, "Couldn't send it back")),
  })

  if (isLoading || !data || !form) return <div className="card text-sm text-gray-400">Loading pricing…</div>
  const { pricing, config, currency, basis, can_approve } = data
  const margin = basis === "MARGIN"
  const titles = [config.l1_title, config.l2_title, config.l3_title]
  const live = assess(basis, form, config)
  const figuresChanged = pricing && (["cost", "price", "list_price", "ebitda_pct"].some(k => str(pricing[k]) !== (form[k] === "" ? "" : String(Number(form[k])))))
  const restarts = pricing && (figuresChanged || pricing.status === "SENT_BACK")
  const hasApprovals = pricing && pricing.approval_level > 0
  const offerBad = !margin && n(form.price) > 0 && n(form.list_price) > 0 && n(form.price) > n(form.list_price)
  const canSave = !!live && !saveMut.isPending
  const noLimits = margin ? config.ict_l1_min_margin === null && config.ict_l2_min_margin === null
                          : config.telecom_l1_max_discount === null && config.telecom_l2_max_discount === null
  const st = pricing && STATUS[pricing.status]

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <section className="card">
        <div className="pb-2">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2"><BadgePercent size={16} className="text-blue-600"/> Pricing approval</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {margin ? "Enter the cost and the selling price. The margin decides who has to approve it."
                    : "Enter the list price and the price we offer. The discount decides who has to approve it."}
          </p>
        </div>
        {noLimits && (
          <div className="mt-2 mb-1 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            The {margin ? "margin" : "discount"} limits aren't set yet, so every pricing goes to Level 3.{" "}
            <Link to="/company-settings" className="font-semibold underline">Set them in Company Settings → Pricing Approval Cycle</Link>
          </div>
        )}

        {margin ? (
          <>
            <Row num="1" label="Total cost" source="What the bid costs us">
              <Money value={form.cost} onChange={v => set("cost", v)} currency={currency}/>
            </Row>
            <Row num="2" label="Selling price" source={data.defaults.price !== null ? `Prefilled from the ${mod.noun}'s TCV` : "The price we offer the client"}>
              <Money value={form.price} onChange={v => set("price", v)} currency={currency}/>
            </Row>
          </>
        ) : (
          <>
            <Row num="1" label="List price" source="The price before any discount">
              <Money value={form.list_price} onChange={v => set("list_price", v)} currency={currency}/>
            </Row>
            <Row num="2" label="Offered price" source={data.defaults.price !== null ? `Prefilled from the ${mod.noun}'s TCV` : "The price we offer the client"}>
              <Money value={form.price} onChange={v => set("price", v)} currency={currency}/>
              {offerBad && <p className="text-xs text-red-500 mt-1">The offered price can't be more than the list price.</p>}
            </Row>
          </>
        )}
        <Row num="3" label={margin ? "Margin" : "Discount"} source="Worked out for you">
          <div className="text-2xl font-bold text-gray-900 tabular-nums py-1">{live ? `${live.pct}%` : "—"}</div>
          {live && (
            <div className="text-xs text-gray-500">
              {margin ? `${formatMoney(n(form.price) - n(form.cost), currency)} profit on ${formatMoney(n(form.price), currency)}`
                      : `${formatMoney(n(form.list_price) - n(form.price), currency)} off ${formatMoney(n(form.list_price), currency)}`}
            </div>
          )}
        </Row>
        <Row num="4" label="EBITDA" source={data.defaults.ebitda_pct !== null ? "Prefilled from the evaluation (A)" : "Optional"}>
          <div className="relative w-32">
            <input type="number" step="0.1" className="input pr-8 tabular-nums" value={form.ebitda_pct} onChange={e => set("ebitda_pct", e.target.value)} placeholder="—"/>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
          </div>
          {config.ebitda_min_pct !== null && <p className="text-xs text-gray-400 mt-1">Below {Number(config.ebitda_min_pct)}% always needs Level 3.</p>}
        </Row>
        <Row num="5" label="Notes for the approvers" source="Optional">
          <textarea className="input min-h-[70px]" value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. Strategic client, price matched to last year's award"/>
        </Row>

        {live && (
          <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-900 mt-2">
            <div className="font-semibold">Needs approval up to Level {live.level} — {titles[live.level - 1]}</div>
            <ul className="text-xs text-blue-800 mt-1 space-y-0.5">{live.reasons.map(r => <li key={r}>• {r}</li>)}</ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-4 mt-4 border-t border-gray-100">
          <button className="btn-primary" disabled={!canSave}
            onClick={() => { if (!(restarts && hasApprovals) || window.confirm("Changing the figures starts the approvals again from Level 1. Continue?")) saveMut.mutate() }}>
            <Check size={14}/> {saveMut.isPending ? "Saving…" : !pricing || restarts ? "Submit for approval" : "Save notes"}
          </button>
          {!live && <span className="text-xs text-gray-400">Fill in fields 1 and 2 to continue.</span>}
          {restarts && hasApprovals && <span className="text-xs text-amber-700">The figures changed — approvals will start again.</span>}
        </div>
      </section>

      <aside className="lg:sticky lg:top-20 space-y-4">
        {st && (
          <div className={clsx("rounded-xl border px-4 py-3 flex items-start gap-2.5", st.cls)}>
            <st.icon size={18} className="flex-shrink-0 mt-0.5"/>
            <div className="text-sm">
              <div className="font-semibold">{st.label}</div>
              <div className="text-xs opacity-80">{margin ? "Margin" : "Discount"} {Number(pricing.pct)}% · submitted by {pricing.submitted_by_name} · {fmtDT(pricing.submitted_at)}</div>
              {pricing.status === "SENT_BACK" && (
                <div className="text-xs mt-1">{pricing.sent_back_by_name}: “{pricing.sent_back_note}” — change the figures and submit again.</div>
              )}
            </div>
          </div>
        )}

        <div className="card-sm bg-blue-50 border-blue-100 space-y-2">
          <div className="section-title text-xs mb-1">Approval cycle</div>
          {[1, 2, 3].map(lvl => {
            const required = pricing ? pricing.required_level : live?.level
            const notNeeded = required && lvl > required
            const done = pricing && pricing.approval_level >= lvl
            const isNext = pricing && pricing.status === "PENDING" && pricing.approval_level === lvl - 1 && !notNeeded
            return (
              <div key={lvl} className={clsx("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-2.5 rounded-lg bg-white border border-blue-100", notNeeded && "opacity-50")}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className={clsx("badge flex-shrink-0", done ? "bg-green-100 text-green-700" : "badge-gray")}>L{lvl}</span>
                  <span className="text-sm font-semibold text-gray-900">{titles[lvl - 1]}</span>
                </div>
                {done ? <span className="text-xs text-green-700 font-medium">✓ {pricing[`l${lvl}_approver_name`]} · {fmtDT(pricing[`l${lvl}_approved_at`])}</span>
                  : notNeeded ? <span className="text-xs text-gray-400">Not needed</span>
                  : isNext && can_approve ? (
                    <button className="btn-primary btn-sm" disabled={approveMut.isPending} onClick={() => approveMut.mutate(lvl)}>
                      <Check size={12}/> {approveMut.isPending ? "Approving…" : "Approve"}
                    </button>)
                  : <span className="text-xs text-gray-400">{pricing ? "Waiting" : "—"}</span>}
              </div>
            )
          })}
          {pricing?.status === "PENDING" && can_approve && (
            showBack ? (
              <div className="space-y-2 pt-1">
                <textarea className="input text-sm min-h-[60px]" autoFocus placeholder="Why is it being sent back?" value={backNote} onChange={e => setBackNote(e.target.value)}/>
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm text-red-600" disabled={!backNote.trim() || backMut.isPending} onClick={() => backMut.mutate()}>
                    <Undo2 size={12}/> {backMut.isPending ? "Sending…" : "Send back"}
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => setShowBack(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost btn-sm text-xs text-red-600" onClick={() => setShowBack(true)}><Undo2 size={11}/> Send back with a reason</button>
            )
          )}
          {pricing?.status === "PENDING" && !can_approve && <p className="text-xs text-gray-500">An admin, department manager or director approves each level.</p>}
          <p className="text-[11px] text-gray-400 pt-1">The levels and limits are set in Company Settings → Pricing Approval Cycle. The bid manager is told the outcome.</p>
        </div>
      </aside>
    </div>
  )
}
