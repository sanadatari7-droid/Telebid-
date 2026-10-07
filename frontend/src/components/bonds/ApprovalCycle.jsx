import React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Check, AlertTriangle, Send, FileText } from "lucide-react"
import { bondsApi, companyConfigApi } from "../../services/api"
import { apiErrorMessage } from "../../utils/apiError"
import { fmtDT } from "../../utils/fmt"
import { saveDownload } from "../../utils/download"

const DEFAULT_TITLES = ["Bid Department Manager", "VP Sales", "Finance"]

export function useBondApprovalConfig() {
  const { data } = useQuery({ queryKey:["bond-approval"], queryFn:()=>companyConfigApi.getBondApproval().then(r=>r.data) })
  return {
    titles: data ? [data.l1_title, data.l2_title, data.l3_title] : DEFAULT_TITLES,
    officeName: data?.office_name || "Bid Bond Issuance Office",
  }
}

export function invalidateBonds(qc, bondId) {
  qc.invalidateQueries({queryKey:["bonds"]})
  qc.invalidateQueries({queryKey:["bond-stats"]})
  if (bondId) qc.invalidateQueries({queryKey:["bond", bondId]})
}

// L1 → L2 → L3 → issuance office. Only the next level in line can approve.
export default function ApprovalCycle({ bond, onChange }) {
  const qc = useQueryClient()
  const { titles, officeName } = useBondApprovalConfig()
  const level = bond.approval_level || 0

  const levelMut = useMutation({
    mutationFn: lvl => bondsApi.approveLevel(bond.bond_id, lvl),
    onSuccess: (res, lvl) => {
      const office = res.data.office
      if (office?.sent) toast.success(`Approved — request sent to ${office.office_name}`)
      else if (office && !office.sent) toast.error(`Approved, but not sent: ${office.error}`, { duration: 8000 })
      else toast.success(`Level ${lvl} approved`)
      invalidateBonds(qc, bond.bond_id)
      onChange?.()
    },
    onError: err => toast.error(apiErrorMessage(err, "Couldn't record the approval"))
  })
  const sendMut = useMutation({
    mutationFn: () => bondsApi.sendToOffice(bond.bond_id),
    onSuccess: res => { toast.success(res.data.message); invalidateBonds(qc, bond.bond_id); onChange?.() },
    onError: err => { toast.error(apiErrorMessage(err, "Couldn't send the request")); invalidateBonds(qc, bond.bond_id); onChange?.() }
  })

  const fullyApproved = ["APPROVED","REQUESTED","ISSUED"].includes(bond.status)

  return (
    <div className="card-sm bg-blue-50 border-blue-100 space-y-2">
      <div className="section-title text-xs mb-1">Approval Cycle</div>
      {[1,2,3].map(lvl => {
        const done = level >= lvl
        const isNext = bond.status === "PENDING" && level === lvl - 1
        return (
          <div key={lvl} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-2.5 rounded-lg bg-white border border-blue-100">
            <div className="flex items-center gap-2 min-w-0">
              <span className={clsx("badge flex-shrink-0", done ? "bg-green-100 text-green-700" : "badge-gray")}>L{lvl}</span>
              <span className="text-sm font-semibold text-gray-900">{titles[lvl-1]}</span>
            </div>
            {done ? (
              <span className="text-xs text-green-700 font-medium break-all">✓ {bond[`l${lvl}_approver_name`]} · {fmtDT(bond[`l${lvl}_approved_at`])}</span>
            ) : isNext ? (
              <button className="btn-primary btn-sm" disabled={levelMut.isPending} onClick={() => levelMut.mutate(lvl)}>
                <Check size={12}/> {levelMut.isPending ? "Approving…" : "Approve"}
              </button>
            ) : (
              <span className="text-xs text-gray-400">Waiting</span>
            )}
          </div>
        )
      })}

      <div className={clsx("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-2.5 rounded-lg border",
        bond.office_sent_at ? "bg-green-50 border-green-200" : "bg-white border-blue-100")}>
        <div className="flex items-center gap-2 min-w-0">
          <Send size={14} className={bond.office_sent_at ? "text-green-600" : "text-gray-400"}/>
          <span className="text-sm font-semibold text-gray-900">{officeName}</span>
        </div>
        {bond.office_sent_at ? (
          <span className="text-xs text-green-700 font-medium break-all">✓ Sent to {bond.office_sent_to} · {fmtDT(bond.office_sent_at)}</span>
        ) : fullyApproved ? (
          <button className="btn-secondary btn-sm" disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>
            <Send size={12}/> {sendMut.isPending ? "Sending…" : "Send to office"}
          </button>
        ) : (
          <span className="text-xs text-gray-400">Sent after Level 3</span>
        )}
      </div>
      {bond.office_send_error && !bond.office_sent_at && (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/> {bond.office_send_error}
        </div>
      )}
      {bond.office_sent_at && bond.status === "REQUESTED" && (
        <button className="btn-ghost btn-sm text-xs" disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>
          <Send size={11}/> Send again
        </button>
      )}
      <button className="btn-secondary btn-sm w-full justify-center" onClick={async () => {
        try { saveDownload(await bondsApi.requestLetter(bond.bond_id), "Bid Bond Request.docx") }
        catch (err) { toast.error("Couldn't create the request letter") }
      }}>
        <FileText size={12}/> Download request letter (Word)
      </button>
    </div>
  )
}
