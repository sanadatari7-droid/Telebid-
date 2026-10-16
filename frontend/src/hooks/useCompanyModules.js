import { useQuery } from "@tanstack/react-query"
import { companyConfigApi } from "../services/api"

// The bid modules the company's type gives it: Telecom → ict, telecom, expro; ICT → ict; not chosen → none.
export function useCompanyModules() {
  const { data, isLoading } = useQuery({ queryKey: ["company-cfg"], queryFn: () => companyConfigApi.get().then(r => r.data) })
  return { modules: data?.modules || [], companyType: data?.company_type || null, loading: isLoading }
}
