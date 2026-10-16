import React from "react"
import { Link } from "react-router-dom"
import { Lock } from "lucide-react"
import { useCompanyModules } from "../../hooks/useCompanyModules"
import { RFP_MODULES } from "../../utils/rfp"

// A bid module opens only if the company type includes it (Telecom: all three, ICT: Bid ICT only).
export default function ModuleGate({ module, children }) {
  const { modules, companyType, loading } = useCompanyModules()
  if (loading) return null
  if (modules.includes(module)) return children
  const title = RFP_MODULES[module].title
  return (
    <div className="p-6 max-w-xl mx-auto">
      <div className="card text-center py-12 space-y-3">
        <Lock size={30} className="mx-auto text-gray-300"/>
        <p className="font-semibold text-gray-900">{title} isn't open for your company</p>
        <p className="text-sm text-gray-500">
          {companyType
            ? `${title} is for Telecom companies. Your company type is ICT, so you have Bid ICT.`
            : "Choose your company type first: Telecom companies get Bid ICT, Bid Telecom and EXPRO; ICT companies get Bid ICT."}
        </p>
        <Link to="/company-settings" className="btn-primary inline-flex">Go to Company Profile</Link>
      </div>
    </div>
  )
}
