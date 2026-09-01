import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "../store/authStore"
import { authApi } from "../services/api"
import { apiErrorMessage } from "../utils/apiError"
import { Eye, EyeOff, Zap, Shield, Lock, User, Mail, Building2, Hash, AlertCircle, Loader2 } from "lucide-react"
import toast from "react-hot-toast"

const INITIAL = {
  company_name: "", company_code: "",
  admin_full_name: "", admin_username: "", admin_email: "", admin_password: "",
}

export default function SignupPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [form, setForm] = useState(INITIAL)
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const fc = e => {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    setError("")
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.company_name.trim()) { setError("Please enter your company name"); return }
    if (!form.company_code.trim()) { setError("Please choose a company code"); return }
    if (!form.admin_username.trim()) { setError("Please choose a username"); return }
    if (!form.admin_email.trim()) { setError("Please enter your email"); return }
    if (!form.admin_full_name.trim()) { setError("Please enter your full name"); return }
    if (form.admin_password.length < 8) { setError("Password must be at least 8 characters"); return }
    if (!/[A-Z]/.test(form.admin_password)) { setError("Password must contain at least one uppercase letter"); return }
    if (!/[0-9]/.test(form.admin_password)) { setError("Password must contain at least one number"); return }

    setLoading(true); setError("")
    try {
      const { data } = await authApi.signup({
        company_name: form.company_name.trim(),
        company_code: form.company_code.trim().toUpperCase(),
        admin_username: form.admin_username.trim(),
        admin_email: form.admin_email.trim(),
        admin_password: form.admin_password,
        admin_full_name: form.admin_full_name.trim(),
      })
      setAuth(data)
      toast.success(`Welcome to TeleBid, ${data.user?.full_name || data.user?.username}! Your company is ready.`)
      navigate("/dashboard", { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create your company. Please try again."))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <div className="hidden lg:flex lg:w-[45%] bg-blue-600 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-[-10%] right-[-10%] w-80 h-80 bg-blue-500/30 rounded-full blur-3xl"/>
          <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-indigo-700/30 rounded-full blur-3xl"/>
        </div>
        <div className="relative">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <Zap size={20} className="text-white"/>
            </div>
            <div>
              <div className="text-white font-bold text-lg">TeleBid</div>
              <div className="text-blue-200 text-xs font-medium tracking-widest">ENTERPRISE</div>
            </div>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Set Up Your Company
          </h2>
          <p className="text-blue-200 text-base leading-relaxed">
            Create a private workspace for your organization to manage bids, tenders and evaluations — your data is never shared with other companies.
          </p>
          <div className="mt-10 space-y-4">
            {[
              { icon: Shield, text: "Your own isolated company workspace" },
              { icon: Zap,    text: "You become the company Administrator" },
              { icon: Lock,   text: "Invite teammates once you're set up" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-blue-100">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-white"/>
                </div>
                <span className="text-sm font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-blue-300 text-xs">
          © 2026 TeleBid Enterprise · Secure Procurement Platform
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white"/>
            </div>
            <div className="font-bold text-gray-900">TeleBid Enterprise</div>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-1">Create your company workspace</h1>
          <p className="text-gray-400 text-sm mb-8">Start your free TeleBid Enterprise account</p>

          {error && (
            <div className="flex items-start gap-2 p-3.5 bg-red-50 border border-red-200 rounded-xl mb-5 text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Company Name</label>
                <div className="relative">
                  <Building2 size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                  <input name="company_name" type="text" className="input pl-10"
                    placeholder="Acme Telecom" value={form.company_name} onChange={fc}
                    autoFocus autoComplete="organization"/>
                </div>
              </div>
              <div>
                <label className="label">Company Code</label>
                <div className="relative">
                  <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                  <input name="company_code" type="text" className="input pl-8 uppercase"
                    placeholder="ACME" value={form.company_code} onChange={fc}/>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Your Admin Account</p>

              <div className="space-y-4">
                <div>
                  <label className="label">Full Name</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input name="admin_full_name" type="text" className="input pl-10"
                      placeholder="Jane Doe" value={form.admin_full_name} onChange={fc}
                      autoComplete="name"/>
                  </div>
                </div>

                <div>
                  <label className="label">Username</label>
                  <input name="admin_username" type="text" className="input"
                    placeholder="jdoe" value={form.admin_username} onChange={fc}
                    autoComplete="username"/>
                </div>

                <div>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input name="admin_email" type="email" className="input pl-10"
                      placeholder="jane@acme.com" value={form.admin_email} onChange={fc}
                      autoComplete="email"/>
                  </div>
                </div>

                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input name="admin_password" type={showPw ? "text" : "password"}
                      className="input pl-10 pr-10"
                      placeholder="At least 8 characters"
                      value={form.admin_password} onChange={fc}
                      autoComplete="new-password"/>
                    <button type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Must include an uppercase letter and a number.</p>
                </div>
              </div>
            </div>

            <button type="submit"
              className="btn-primary w-full justify-center py-3 text-base mt-2"
              disabled={loading}>
              {loading
                ? <><Loader2 size={16} className="animate-spin"/> Creating your workspace…</>
                : "Create Company Workspace"}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-5">
            Already have an account?{" "}
            <button onClick={() => navigate("/login")}
              className="text-blue-600 font-medium hover:underline">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
