import React, { lazy, Suspense, Component } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import { useAuthStore } from "./store/authStore"
import AppLayout from "./components/layout/AppLayout"
import LoginPage from "./pages/LoginPage"
import SignupPage from "./pages/SignupPage"
import RegisterPage from "./pages/RegisterPage"

const DashboardPage    = lazy(() => import("./pages/DashboardPage"))
const BidsPage         = lazy(() => import("./pages/BidsPage"))
const BidDetailPage    = lazy(() => import("./pages/BidDetailPage"))
const OpportunitiesPage= lazy(() => import("./pages/OpportunitiesPage"))
const VendorsPage      = lazy(() => import("./pages/VendorsPage"))
const ReferencesPage   = lazy(() => import("./pages/ReferencesPage"))
const EmployeesPage    = lazy(() => import("./pages/EmployeesPage"))
const ApprovalsPage    = lazy(() => import("./pages/ApprovalsPage"))
const NotificationsPage= lazy(() => import("./pages/NotificationsPage"))
const ReportsPage      = lazy(() => import("./pages/ReportsPage"))
const UsersPage        = lazy(() => import("./pages/UsersPage"))
const SettingsPage     = lazy(() => import("./pages/SettingsPage"))
const EvaluationsPage  = lazy(() => import("./pages/EvaluationsPage"))
const ContractsPage    = lazy(() => import("./pages/ContractsPage"))
const CalendarPage     = lazy(() => import("./pages/CalendarPage"))
const InvitationsPage  = lazy(() => import("./pages/InvitationsPage"))
const WatchlistPage    = lazy(() => import("./pages/WatchlistPage"))
const ICTPage           = lazy(() => import("./pages/ICTPage"))
const ExproPage         = lazy(() => import("./pages/ExproPage"))
const BidLogsPage       = lazy(() => import("./pages/BidLogsPage"))
const GlobalSearchPage  = lazy(() => import("./pages/GlobalSearchPage"))
const ExcelImportPage   = lazy(() => import("./pages/ExcelImportPage"))
const SystemSettingsPage= lazy(() => import("./pages/SystemSettingsPage"))
const OpportunitiesV2Page= lazy(() => import("./pages/OpportunitiesV2Page"))
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"))
const LostRecordsPage = lazy(() => import("./pages/LostRecordsPage"))
const CompanySettingsPage = lazy(() => import("./pages/CompanySettingsPage"))
const BondsPage           = lazy(() => import("./pages/BondsPage"))
const WonRecordsPage      = lazy(() => import("./pages/WonRecordsPage"))
const AiAlertsPage        = lazy(() => import("./pages/AiAlertsPage"))
const ContentLibraryPage  = lazy(() => import("./pages/ContentLibraryPage"))

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error("Page error:", error, info) }
  render() {
    if (this.state.hasError) return (
      <div className="flex items-center justify-center h-64 p-8">
        <div className="card max-w-lg w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-4">{this.state.error?.message || "An unexpected error occurred."}</p>
          <button className="btn-primary btn-sm" onClick={() => this.setState({ hasError: false, error: null })}>Try Again</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

function Loader() {
  return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full"/></div>
}
function Guard({ children }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? children : <Navigate to="/login" replace/>
}
function AdminGuard({ children }) {
  const { isAuthenticated, hasRole } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace/>
  return hasRole("ADMIN") ? children : <Navigate to="/dashboard" replace/>
}
function Page({ component: C }) {
  return <ErrorBoundary><C/></ErrorBoundary>
}

export default function App() {
  return (
    <Suspense fallback={<Loader/>}>
      <Routes>
        <Route path="/login" element={<LoginPage/>}/>
        <Route path="/signup" element={<SignupPage/>}/>
        <Route path="/" element={<Guard><AppLayout/></Guard>}>
          <Route index element={<Navigate to="/dashboard" replace/>}/>
          <Route path="dashboard"     element={<Page component={DashboardPage}/>}/>
          <Route path="register" element={<AdminGuard><Page component={RegisterPage}/></AdminGuard>}/>
          <Route path="bids"          element={<Page component={BidsPage}/>}/>
          <Route path="bids/:id"      element={<Page component={BidDetailPage}/>}/>
          <Route path="opportunities" element={<Page component={OpportunitiesPage}/>}/>
          <Route path="vendors"       element={<Page component={VendorsPage}/>}/>
          <Route path="invitations"   element={<Page component={InvitationsPage}/>}/>
          <Route path="evaluations"   element={<Page component={EvaluationsPage}/>}/>
          <Route path="contracts"     element={<Page component={ContractsPage}/>}/>
          <Route path="references"    element={<Page component={ReferencesPage}/>}/>
          <Route path="employees"     element={<Page component={EmployeesPage}/>}/>
          <Route path="approvals"     element={<Page component={ApprovalsPage}/>}/>
          <Route path="notifications" element={<Page component={NotificationsPage}/>}/>
          <Route path="watchlist"     element={<Page component={WatchlistPage}/>}/>
          <Route path="calendar"      element={<Page component={CalendarPage}/>}/>
          <Route path="reports"       element={<Page component={ReportsPage}/>}/>
          <Route path="users"         element={<Page component={UsersPage}/>}/>
          <Route path="settings"      element={<Page component={SettingsPage}/>}/>
          <Route path="ict"           element={<Page component={ICTPage}/>}/>
          <Route path="expro"         element={<Page component={ExproPage}/>}/>
          <Route path="bid-logs"      element={<Page component={BidLogsPage}/>}/>
          <Route path="search"        element={<Page component={GlobalSearchPage}/>}/>
          <Route path="excel-import"  element={<Page component={ExcelImportPage}/>}/>
          <Route path="system-settings" element={<Page component={SystemSettingsPage}/>}/>
          <Route path="lost-records" element={<Page component={LostRecordsPage}/>}/>
          <Route path="audit-log" element={<Page component={AuditLogPage}/>}/>
          <Route path="rfp-bids"         element={<Page component={OpportunitiesV2Page}/>}/>
          <Route path="company-settings" element={<Page component={CompanySettingsPage}/>}/>
          <Route path="bonds"            element={<Page component={BondsPage}/>}/>
          <Route path="won-records"      element={<Page component={WonRecordsPage}/>}/>
          <Route path="ai-alerts"        element={<Page component={AiAlertsPage}/>}/>
          <Route path="content-library"  element={<Page component={ContentLibraryPage}/>}/>
          <Route path="*"             element={<Navigate to="/dashboard" replace/>}/>
        </Route>
      </Routes>
    </Suspense>
  )
}
