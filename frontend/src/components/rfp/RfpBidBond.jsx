import React, { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Check, Shield, Trash2, Lock, ArrowRight } from "lucide-react"
import { rfpApi } from "../../services/api"
import { apiErrorMessage } from "../../utils/apiError"
import { fmt } from "../../utils/fmt"
import { RFP_MODULES, formatMoney } from "../../utils/rfp"
import ApprovalCycle, { useBondApprovalConfig } from "../bonds/ApprovalCycle"

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

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + Number(days || 0))
  return d
}

export default function RfpBidBond({ module, rfpId, onGoToDetails }) {
  const mod = RFP_MODULES[module]
  const api = rfpApi(module)
  const key = ["rfp-bid-bond", module, rfpId]
  const details = mod.expro ? "the request details" : "RFP details"
  const qc = useQueryClient()
  const { titles, officeName } = useBondApprovalConfig()
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.bidBond(rfpId).then(r => r.data) })
  const [form, setForm] = useState(null)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!data) return
    const b = data.bond
    setForm(b
      ? { bid_subject: b.bid_subject || "", validity_days: b.validity_days || data.default_validity_days, lg_base_value: b.lg_base_value !== null ? Number(b.lg_base_value) : "", bid_ref: b.bid_ref || "", language: b.language || "Arabic" }
      : data.defaults && { ...data.defaults, lg_base_value: data.defaults.lg_base_value ?? "" })
  }, [data])

  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["bonds"] }) }
  const saveMut = useMutation({
    mutationFn: () => api.saveBidBond(rfpId, { ...form, validity_days: Number(form.validity_days), lg_base_value: Number(form.lg_base_value) }),
    onSuccess: r => { toast.success(data.bond ? "Bid bond request updated" : `Bid bond request created — waiting for ${titles[0]}`); qc.setQueryData(key, r.data); qc.invalidateQueries({ queryKey: ["bonds"] }) },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't save the bid bond request")),
  })
  const deleteMut = useMutation({
    mutationFn: () => api.deleteBidBond(rfpId),
    onSuccess: () => { toast.success("Bid bond request deleted"); refresh() },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't delete the request")),
  })

  if (isLoading || !data) return <div className="card text-sm text-gray-400">Loading bid bond…</div>
  const { rfp, currency, bond } = data
  // Field 2 is the RFP title; EXPRO requests have none, so their SOW is offered instead.
  const titleLabel = mod.expro ? "Request title" : "RFP title"
  const titleSource = rfp.rfp_title ? "From RFP details — edit if the bond needs different wording"
    : mod.expro && rfp.sow ? "From the request's SOW — edit if the bond needs different wording"
    : `Not set in ${details} — type it here`

  if (!rfp.bid_bond_required || rfp.bid_bond_pct === null) {
    return (
      <div className="card text-center py-12 space-y-3">
        <Shield size={32} className="mx-auto text-gray-300"/>
        <p className="text-gray-700 font-medium">This {mod.noun} doesn't need a bid bond</p>
        <p className="text-sm text-gray-500">To request one, set "Bid bond required?" to Yes and choose the percentage in {details}.</p>
        <button className="btn-secondary inline-flex" onClick={onGoToDetails}>Go to {details}</button>
      </div>
    )
  }
  if (!form) return null

  const locked = !!bond && (bond.approval_level || 0) > 0
  const pct = Number(rfp.bid_bond_pct)
  const d = currency?.decimals ?? 2
  const value = form.lg_base_value === "" ? null : Number(form.lg_base_value)
  const amount = value === null ? null : Math.round(value * pct / 100 * 10 ** d) / 10 ** d
  const expiry = addDays(rfp.submission_date, form.validity_days)
  const arabic = form.language === "Arabic"
  const canSave = form.bid_subject.trim() && form.bid_ref.trim() && value > 0 && Number(form.validity_days) >= 1

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <section className="card">
        <div className="flex items-start justify-between gap-4 pb-2">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2"><Shield size={16} className="text-amber-500"/> Bid bond request</h2>
            <p className="text-sm text-gray-500 mt-0.5">Most of it is filled in from the {mod.noun}. Check it, enter the bid value, and save.</p>
          </div>
          {locked && <span className="badge bg-gray-100 text-gray-600 flex items-center gap-1 whitespace-nowrap"><Lock size={11}/> Locked — in approval</span>}
        </div>

        <fieldset disabled={locked}>
          <Row num="1" label="Client name" source="From the client record">
            <div className={clsx("rounded-lg px-3 py-2", !arabic && "bg-blue-50/60")}><div className="text-sm text-gray-900">{rfp.name_en}</div>
              <div className="text-xs text-gray-500 whitespace-pre-line">{rfp.billing_address_en || "No English billing address"}</div></div>
            <div dir="rtl" className={clsx("rounded-lg px-3 py-2 mt-1", arabic && "bg-blue-50/60")}><div className="text-sm text-gray-900">{rfp.name_ar || "—"}</div>
              <div className="text-xs text-gray-500 whitespace-pre-line">{rfp.billing_address_ar || ""}</div></div>
            <p className="text-xs text-gray-400 mt-1">The highlighted version goes on the bond, to match its language.</p>
          </Row>
          <Row num="2" label={titleLabel} source={titleSource}>
            <input className="input" value={form.bid_subject} onChange={e => set("bid_subject", e.target.value)}
              placeholder={mod.expro ? "e.g. L3 (IPVPN) Core Fiber" : "e.g. Hospital campus network refresh"}/>
            {!form.bid_subject.trim() && <p className="text-xs text-red-500 mt-1">The {titleLabel.toLowerCase()} is required.</p>}
          </Row>
          <Row num="3" label="Submission date" source={`From ${details}`}>
            <div className="text-sm font-medium text-gray-900 py-2">{fmt(rfp.submission_date)}</div>
          </Row>
          <Row num="4" label="Bond duration" source="Counted from the submission date">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-32">
                <input type="number" min="1" className="input pr-12 tabular-nums" value={form.validity_days} onChange={e => set("validity_days", e.target.value)}/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">days</span>
              </div>
              <ArrowRight size={14} className="text-gray-300"/>
              <span className="text-sm text-gray-700">Valid until <strong>{fmt(expiry)}</strong></span>
            </div>
          </Row>
          <Row num="5" label="Bid value" source={rfp.tcv !== null ? `Prefilled from the ${mod.noun}'s TCV` : "The value of our bid"}>
            <div className="relative max-w-xs">
              <input type="number" min="0" step={1 / 10 ** d} className="input pr-14 tabular-nums" value={form.lg_base_value}
                onChange={e => set("lg_base_value", e.target.value)} placeholder="0"/>
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{currency?.code}</span>
            </div>
          </Row>
          <Row num="6" label="Bid bond value" source={`${pct}% of the bid value, from ${details}`}>
            <div className="py-1">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">{formatMoney(amount, currency)}</div>
              <div className="text-xs text-gray-500">{pct}% × {formatMoney(value, currency)}</div>
            </div>
          </Row>
          <Row num="7" label="Reference" source={rfp.company_initials ? `Company initials (${rfp.company_initials}) + ${mod.expro ? "EXPRO number" : "RFP reference"}` : "Add company initials in Company Settings → Company Profile"}>
            <input className="input font-mono" value={form.bid_ref} onChange={e => set("bid_ref", e.target.value)}/>
          </Row>
          <Row num="8" label="Language of bond">
            <div className="flex gap-2">
              {["Arabic", "English"].map(l => (
                <button type="button" key={l} onClick={() => set("language", l)}
                  className={clsx("px-4 py-2 rounded-xl border text-sm font-medium",
                    form.language === l ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50")}>
                  {l === "Arabic" ? "Arabic · عربي" : "English"}
                </button>
              ))}
            </div>
          </Row>
        </fieldset>

        {!locked && (
          <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
            <button className="btn-primary" disabled={!canSave || saveMut.isPending} onClick={() => saveMut.mutate()}>
              <Check size={14}/> {saveMut.isPending ? "Saving…" : bond ? "Save changes" : "Create bid bond request"}
            </button>
            {bond && (
              <button className="btn-ghost text-red-500 ml-auto" disabled={deleteMut.isPending}
                onClick={() => { if (window.confirm("Delete this bid bond request?")) deleteMut.mutate() }}>
                <Trash2 size={13}/> Delete request
              </button>
            )}
          </div>
        )}
      </section>

      <aside className="lg:sticky lg:top-20 space-y-4">
        {bond ? (
          <>
            <ApprovalCycle bond={bond} onChange={() => qc.invalidateQueries({ queryKey: key })}/>
            <Link to="/bonds" className="text-xs text-blue-600 hover:underline block text-center">Also listed on the Bonds page</Link>
          </>
        ) : (
          <div className="card p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">After you create the request</div>
            <ol className="space-y-2 text-sm text-gray-700">
              {[...titles, officeName].map((t, i) => (
                <li key={t} className="flex items-center gap-2">
                  <span className={clsx("w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0",
                    i < titles.length ? "bg-gray-100 text-gray-600" : "bg-green-100 text-green-700")}>{i < titles.length ? `L${i + 1}` : "✉"}</span>
                  {i < titles.length ? `${t} approves` : `Sent to ${t}`}
                </li>
              ))}
            </ol>
            <p className="text-xs text-gray-400">The approval chain is set in Company Settings → Bid Bond Approval Cycle.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
