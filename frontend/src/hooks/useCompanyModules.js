import { useQuery } from "@tanstack/react-query"
import { companyConfigApi } from "../services/api"

// The bid modules the company's type gives it: Telecom → ict, telecom, expro; ICT → ict; not chosen → none.
export function useCompanyModules() {
  const { data, isLoading } = useQuery({ queryKey: ["company-cfg"], queryFn: () => companyConfigApi.get().then(r => r.data) })
  return { modules: data?.modules || [], companyType: data?.company_type || null, loading: isLoading }
}

// The company's logo as a data URL (null when none is uploaded).
export function useCompanyLogo() {
  const { data } = useQuery({ queryKey: ["company-logo"], queryFn: () => companyConfigApi.getLogo().then(r => r.data), staleTime: 5 * 60 * 1000 })
  return data?.data_url || null
}
