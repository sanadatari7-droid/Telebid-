import axios from "axios"
import toast from "react-hot-toast"
import { apiErrorMessage } from "../utils/apiError"

const api = axios.create({ baseURL: "/api/v1", timeout: 30000 })

api.interceptors.request.use(config => {
  const token = localStorage.getItem("access_token")
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auth endpoints intentionally return 401 for bad credentials/OTP — that's a normal,
// recoverable form error, not a "your session died" event, so the interceptor below
// must not treat it as one (clearing storage / redirecting mid-login-attempt).
const AUTH_ENDPOINTS = ["/auth/login", "/auth/verify-otp", "/auth/register", "/auth/refresh"]
const isAuthEndpoint = url => AUTH_ENDPOINTS.some(p => url?.includes(p))

api.interceptors.response.use(
  res => res,
  async err => {
    const orig = err.config
    if (err.response?.status === 401 && !orig._retry && !isAuthEndpoint(orig.url)) {
      orig._retry = true
      const refresh = localStorage.getItem("refresh_token")
      if (refresh) {
        try {
          const { data } = await axios.post("/api/v1/auth/refresh", { refresh_token: refresh })
          localStorage.setItem("access_token", data.access_token)
          orig.headers.Authorization = `Bearer ${data.access_token}`
          return api(orig)
        } catch {
          localStorage.clear()
          window.location.href = "/login"
        }
      } else {
        localStorage.clear()
        window.location.href = "/login"
      }
    }
    if (err.response?.status !== 401) toast.error(apiErrorMessage(err, "An error occurred"))
    return Promise.reject(err)
  }
)


// ── AUTH ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login:      d => api.post("/auth/login", d),
  logout:     () => api.post("/auth/logout"),
  verifyOtp:  d => api.post("/auth/verify-otp", d),
  refreshToken: () => api.post("/auth/refresh"),
  register:   d => api.post("/auth/register", d),
}

// ── BIDS ──────────────────────────────────────────────────────────────────────
export const bidsApi = {
  list:    p => api.get("/bids", { params: p }),
  get:     id => api.get(`/bids/${id}`),
  create:  d => api.post("/bids", d),
  update:  (id, d) => api.patch(`/bids/${id}`, d),
  delete:  id => api.delete(`/bids/${id}`),
  approve: (id, d) => api.post(`/bids/${id}/approve`, d),
  submit:  id => api.post(`/bids/${id}/submit`),
  award:   id => api.post(`/bids/${id}/award`),
  clone:          id => api.post(`/bids/${id}/clone`),
  getDashboard:   () => api.get("/bids/dashboard"),
  updateStatus:   (id, d) => api.patch(`/bids/${id}/status`, d),
  archive:        id => api.post(`/bids/${id}/archive`),
  getDocs:        id => api.get(`/bids/${id}/documents`),
  uploadDoc:      (id, d) => api.post(`/bids/${id}/documents`, d),
  getApprovals:   id => api.get(`/bids/${id}/approvals`),
  getHistory:     id => api.get(`/bids/${id}/history`),
  getVendorRank:  id => api.get(`/bids/${id}/vendor-rank`),
  getInvitations: p => api.get("/bids/invitations", { params: p }),
  updateInvStatus:(id, d) => api.patch(`/bids/invitations/${id}`, d),
  calendarEvents: p => api.get("/bids/calendar", { params: p }),
}

// ── OPPORTUNITIES ─────────────────────────────────────────────────────────────
export const oppsApi = {
  list:   p => api.get("/opportunities", { params: p }),
  get:    id => api.get(`/opportunities/${id}`),
  create: d => api.post("/opportunities", d),
  update: (id, d) => api.patch(`/opportunities/${id}`, d),
  submit:          id => api.post(`/opportunities/${id}/submit`),
  managerDecision: (id, d) => api.post(`/opportunities/${id}/decision`, d),
}

// ── OPPORTUNITIES V2 ──────────────────────────────────────────────────────────
export const oppsV2Api = {
  list:                     p => api.get("/opportunities-v2", { params: p }),
  get:                      id => api.get(`/opportunities-v2/${id}`),
  create:                   d => api.post("/opportunities-v2", d),
  update:                   (id, d) => api.patch(`/opportunities-v2/${id}`, d),
  submit:                   id => api.post(`/opportunities-v2/${id}/submit`),
  approve:                  (id, level, d) => api.post(`/opportunities-v2/${id}/approve/${level}`, d),
  markWon:                  (id, d) => api.post(`/opportunities-v2/${id}/won`, d),
  markLost:                 (id, d) => api.post(`/opportunities-v2/${id}/lost`, d),
  getTeam:                  id => api.get(`/opportunities-v2/${id}/team`),
  addTeamMember:            (id, d) => api.post(`/opportunities-v2/${id}/team`, d),
  removeTeamMember:         (id, teamId) => api.delete(`/opportunities-v2/${id}/team/${teamId}`),
  getFeasibility:           id => api.get(`/opportunities-v2/${id}/feasibility`),
  saveFeasibility:          (id, d) => api.put(`/opportunities-v2/${id}/feasibility`, d),
  getQuestions:             id => api.get(`/opportunities-v2/${id}/questions`),
  addQuestion:              (id, d) => api.post(`/opportunities-v2/${id}/questions`, d),
  answerQuestion:           (id, qid, d) => api.patch(`/opportunities-v2/${id}/questions/${qid}/answer`, d),
  closeQuestion:            (id, qid) => api.patch(`/opportunities-v2/${id}/questions/${qid}/close`),
  deleteQuestion:           (id, qid) => api.delete(`/opportunities-v2/${id}/questions/${qid}`),
  getRefConfig:             () => api.get("/opportunities-v2/config/customer-ref"),
  saveRefConfig:            d => api.put("/opportunities-v2/config/customer-ref", d),
  previewRef:               d => api.post("/opportunities-v2/config/customer-ref/preview", d),
  getEmployeesForSelection: (role, search) => api.get("/opportunities-v2/employees/for-selection", { params: { role, search } }),
  getFamilies:              () => api.get("/opportunities-v2/solutions/families"),
  getSolutions:             familyId => api.get("/opportunities-v2/solutions/types", { params: { family_id: familyId } }),
  getAllSolutions:           () => api.get("/opportunities-v2/solutions/types"),
  dashboardStats:           () => api.get("/opportunities-v2/stats/dashboard"),
  upcomingDeadlines:        days => api.get("/opportunities-v2/deadlines/upcoming", { params: { days } }),
  overdueDeadlines:         () => api.get("/opportunities-v2/deadlines/overdue"),
  triggerBondReminder:      id => api.post(`/opportunities-v2/${id}/trigger-bond-reminder`),
}

// ── VENDORS ───────────────────────────────────────────────────────────────────
export const vendorsApi = {
  list:    p => api.get("/vendors", { params: p }),
  get:     id => api.get(`/vendors/${id}`),
  create:  d => api.post("/vendors", d),
  update:  (id, d) => api.patch(`/vendors/${id}`, d),
  delete:  id => api.delete(`/vendors/${id}`),
  blacklist:(id,d) => api.post(`/vendors/${id}/blacklist`, d),
  invite:  (id,d) => api.post(`/vendors/${id}/invite`, d),
  evalApi: { list: p => api.get("/evaluations", {params:p}), create: d => api.post("/evaluations",d) },
  bulkImport:   d => api.post("/vendors/bulk-import", d),
  unblacklist:  id => api.post(`/vendors/${id}/unblacklist`),
}

// ── EVALUATIONS ───────────────────────────────────────────────────────────────
export const evalApi = {
  getTemplates:   () => api.get("/evaluations/templates"),
  getTemplate:    id => api.get(`/evaluations/templates/${id}`),
  createTemplate: d => api.post("/evaluations/templates", d),
  list:           () => api.get("/evaluations"),
  getMyEval:      bidId => api.get(`/evaluations/bids/${bidId}/my-evaluation`),
  saveScore:      (bidId, d) => api.post(`/evaluations/bids/${bidId}/score`, d),
  submitEval:     (bidId, d) => api.post(`/evaluations/bids/${bidId}/submit`, d),
  getEvaluators:  bidId => api.get(`/evaluations/bids/${bidId}/evaluators`),
  assignEvaluator:(bidId, d) => api.post(`/evaluations/bids/${bidId}/assign`, d),
  getResults:     bidId => api.get(`/evaluations/bids/${bidId}/results`),
  addCriterion:   (id, d) => api.post(`/evaluations/templates/${id}/criteria`, d),
  deleteCriterion:(tid, cid) => api.delete(`/evaluations/templates/${tid}/criteria/${cid}`),
}

// ── CONTRACTS ─────────────────────────────────────────────────────────────────
export const contractsApi = {
  list:   p => api.get("/contracts", { params: p }),
  get:    id => api.get(`/contracts/${id}`),
  create: d => api.post("/contracts", d),
  update: (id,d) => api.patch(`/contracts/${id}`, d),
  delete: id => api.delete(`/contracts/${id}`),
  sign:   id => api.post(`/contracts/${id}/sign`),
}

// ── REFERENCES ────────────────────────────────────────────────────────────────
export const refsApi = {
  list:   p => api.get("/references", { params: p }),
  create: d => api.post("/references", d),
  update: (id,d) => api.patch(`/references/${id}`, d),
  delete: id => api.delete(`/references/${id}`),
  get: id => api.get(`/references/${id}`),
}

// ── EMPLOYEES ─────────────────────────────────────────────────────────────────
export const empApi = {
  list:          p => api.get("/employees", { params: p }),
  get:           id => api.get(`/employees/${id}`),
  create:        d => api.post("/employees", d),
  update:        (id,d) => api.patch(`/employees/${id}`, d),
  delete:        id => api.delete(`/employees/${id}`),
  getMappings:   () => api.get("/employees/mappings"),
  createMapping: d => api.post("/employees/mappings", d),
  deleteMapping: id => api.delete(`/employees/mappings/${id}`),
  updateProfile: (id, d) => api.patch(`/employees/${id}/profile`, d),
  getSectors:    () => api.get("/employees/sectors"),
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
export const notifApi = {
  list:        p => api.get("/notifications", { params: p }),
  unreadCount: () => api.get("/notifications/unread-count"),
  markRead:    id => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch("/notifications/mark-all-read"),
}

// ── USERS ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  list:          p => api.get("/users", { params: p }),
  get:           id => api.get(`/users/${id}`),
  create:        d => api.post("/users", d),
  update:        (id, d) => api.patch(`/users/${id}`, d),
  updateRoles:   (id, roleIds) => api.patch(`/users/${id}/roles`, { role_ids: roleIds }),
  resetPassword: (id, pw) => api.patch(`/users/${id}/reset-password`, { new_password: pw }),
  lock:          id => api.patch(`/users/${id}/lock`),
  unlock:        id => api.patch(`/users/${id}/unlock`),
  deactivate:    id => api.patch(`/users/${id}/deactivate`),
  activate:      id => api.patch(`/users/${id}/activate`),
  me:            () => api.get("/users/me"),
  getRoles:      () => api.get("/users/roles"),
  getDepts:      () => api.get("/users/departments"),
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
export const reportsApi = {
  summary:      () => api.get("/reports/procurement-summary"),
  vendors:      () => api.get("/reports/vendor-performance"),
  audit:        p => api.get("/reports/audit-trail", { params: p }),
  kpis:         () => api.get("/reports/kpis"),
  pipeline:     p => api.get("/reports/opportunities-pipeline", { params: p }),
  wonAnalysis:  () => api.get("/reports/won-analysis"),
  lostAnalysis: () => api.get("/reports/lost-analysis"),
  deadlines:    () => api.get("/reports/deadlines-overview"),
  teamPerf:     () => api.get("/reports/team-performance"),
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export const settingsApi = {
  getAll:              params => api.get("/settings", { params }),
  set:                 (key, value) => api.post("/settings", { setting_key: key, setting_value: value }),
  getDropdown:         key => api.get(`/settings/dropdowns/${key}`),
  getDropdownKeys:     () => api.get("/settings/dropdowns"),
  addDropdown:         d => api.post("/settings/dropdowns", d),
  removeDropdown:      (key, val) => api.delete(`/settings/dropdowns/${key}/${val}`),
  addDropdownOption:   d => api.post("/settings/dropdowns", d),
  deleteDropdownOption:(key, val) => api.delete(`/settings/dropdowns/${key}/${val}`),
  listDropdowns:       () => api.get("/settings/dropdowns"),
  getCompany:          () => api.get("/settings/company"),
  updateCompany:       d => api.patch("/settings/company", d),
  update:              d => api.patch("/settings/company", d),
  getIctCategories:    () => api.get("/settings/ict-categories"),
  addIctCategory:      d => api.post("/settings/ict-categories", d),
  testEmail:           email => api.post("/settings/test-email", { email }),
}

// ── SCHEDULER ─────────────────────────────────────────────────────────────────
export const schedulerApi = {
  sendReminders:      () => api.post("/scheduler/send-deadline-reminders"),
  checkBondReminders: () => api.post("/scheduler/check-bond-reminders"),
}

// ── WATCHLIST ─────────────────────────────────────────────────────────────────
export const watchlistApi = {
  list:   () => api.get("/watchlist"),
  add:    bidId => api.post(`/watchlist/${bidId}`),
  remove: id => api.delete(`/watchlist/${id}`),
}

// ── COMMENTS ──────────────────────────────────────────────────────────────────
export const commentsApi = {
  list:   bidId => api.get(`/comments/bid/${bidId}`),
  add:    (bidId, d) => api.post(`/comments/bid/${bidId}`, d),
  delete: id => api.delete(`/comments/${id}`),
}

// ── ICT ───────────────────────────────────────────────────────────────────────
export const ictApi = {
  list:   p => api.get("/ict", { params: p }),
  get:    id => api.get(`/ict/${id}`),
  create: d => api.post("/ict", d),
  update: (id,d) => api.patch(`/ict/${id}`, d),
  stats: () => api.get("/ict/stats"),
}

// ── EXPRO ─────────────────────────────────────────────────────────────────────
export const exproApi = {
  list:   p => api.get("/expro", { params: p }),
  get:    id => api.get(`/expro/${id}`),
  create: d => api.post("/expro", d),
  update: (id,d) => api.patch(`/expro/${id}`, d),
  getLogs:        p => api.get("/expro/logs", { params: p }),
  getLog:         id => api.get(`/expro/logs/${id}`),
  createLog:      d => api.post("/expro/logs", d),
  submitLog:      id => api.post(`/expro/logs/${id}/submit`),
  reviewLog:      (id, d) => api.post(`/expro/logs/${id}/review`, d),
  getFieldDefs:   () => api.get("/expro/field-definitions"),
  addFieldDef:    d => api.post("/expro/field-definitions", d),
  deleteFieldDef: id => api.delete(`/expro/field-definitions/${id}`),
}

// ── BID LOGS ──────────────────────────────────────────────────────────────────
export const bidLogsApi = {
  list:   p => api.get("/bid-logs", { params: p }),
  create: d => api.post("/bid-logs", d),
  getBidLogs:     p => api.get("/bid-logs", { params: p }),
  getEvalLogs:    p => api.get("/bid-logs/evaluations", { params: p }),
  getUserActivity:p => api.get("/bid-logs/activity", { params: p }),
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
export const searchApi = {
  global: q => api.get("/search", { params: { q } }),
}

// ── LOCATION ──────────────────────────────────────────────────────────────────
export const locationApi = {
  geocode: query => api.post("/location/geocode", { query }),
}

// ── EXCEL IMPORT ──────────────────────────────────────────────────────────────
export const excelImportApi = {
  upload:    d => api.post("/excel-import", d),
  list:      () => api.get("/excel-import"),
  getErrors: id => api.get(`/excel-import/${id}/errors`),
  history:        () => api.get("/excel-import/history"),
  analyze:        d => api.post("/excel-import/analyze", d),
  importCriteria: () => api.get("/excel-import/criteria"),
}

// ── BONDS ─────────────────────────────────────────────────────────────────────
export const bondsApi = {
  list:    p => api.get("/bonds", { params: p }),
  get:     id => api.get(`/bonds/${id}`),
  create:  d => api.post("/bonds", d),
  update:  (id, d) => api.patch(`/bonds/${id}`, d),
  approve: id => api.post(`/bonds/${id}/approve`),
  delete:  id => api.delete(`/bonds/${id}`),
  stats:   () => api.get("/bonds/stats/summary"),
}

// ── SERVICE CATEGORIES ────────────────────────────────────────────────────────
export const serviceCatsApi = {
  list:   p => api.get("/service-categories", { params: p }),
  tree:   type => api.get("/service-categories/tree", { params: { service_type: type } }),
  create: d => api.post("/service-categories", d),
  delete: id => api.delete(`/service-categories/${id}`),
}

// ── COMPANY CONFIG ────────────────────────────────────────────────────────────
export const companyConfigApi = {
  get:      () => api.get("/company-config"),
  update:   d => api.patch("/company-config", d),
  getAMs:   () => api.get("/company-config/account-managers"),
  addAM:    d => api.post("/company-config/account-managers", d),
  removeAM: id => api.delete(`/company-config/account-managers/${id}`),
  getBMs:   () => api.get("/company-config/bid-managers"),
  addBM:    d => api.post("/company-config/bid-managers", d),
  removeBM: id => api.delete(`/company-config/bid-managers/${id}`),
}

// ── WON RECORDS ───────────────────────────────────────────────────────────────
export const wonRecordsApi = {
  createFromOpp: (oppId, d) => api.post(`/won-records/from-opportunity/${oppId}`, d),
  list:          p => api.get("/won-records", { params: p }),
  get:           id => api.get(`/won-records/${id}`),
  getByOpp:      oppId => api.get(`/won-records/by-opportunity/${oppId}`),
  update:        (id, d) => api.patch(`/won-records/${id}`, d),
  stats:         () => api.get("/won-records/stats"),
}

// ── LOST RECORDS ──────────────────────────────────────────────────────────────
export const lostRecordsApi = {
  createFromOpp: (oppId, d) => api.post(`/lost-records/from-opportunity/${oppId}`, d),
  list:          p => api.get("/lost-records", { params: p }),
  get:           id => api.get(`/lost-records/${id}`),
  getByOpp:      oppId => api.get(`/lost-records/by-opportunity/${oppId}`),
  update:        (id, d) => api.patch(`/lost-records/${id}`, d),
  stats:         () => api.get("/lost-records/stats"),
  byCompetitor:  () => api.get("/lost-records/by-competitor"),
}

export default api
