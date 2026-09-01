import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { authApi } from "../services/api"
import { apiErrorMessage } from "../utils/apiError"
import { Eye, EyeOff, Zap, Shield, Lock, User, Mail, Briefcase, AlertCircle, Loader2 } from "lucide-react"
import toast from "react-hot-toast"

const INITIAL = { username:"", email:"", password:"", full_name:"", job_title:"" }

export default function RegisterPage() {
  const navigate = useNavigate()
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
    if (!form.username.trim())  { setError("Please choose a username"); return }
    if (!form.email.trim())     { setError("Please enter your email"); return }
    if (!form.full_name.trim()) { setError("Please enter your full name"); return }
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return }
    if (!/[A-Z]/.test(form.password)) { setError("Password must contain at least one uppercase letter"); return }
    if (!/[0-9]/.test(form.password)) { setError("Password must contain at least one number"); return }

    setLoading(true); setError("")
    try {
      await authApi.register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        job_title: form.job_title.trim(),
      })
      toast.success("Account created — you can now log in.")
      navigate("/login", { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err, "Registration failed. Please try again."))
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
            Join the Team
          </h2>
          <p className="text-blue-200 text-base leading-relaxed">
            Create your account to start managing bids, tenders and evaluations on the TeleBid Enterprise platform.
          </p>
          <div className="mt-10 space-y-4">
            {[
              { icon: Shield, text: "New accounts default to a limited role" },
              { icon: Zap,    text: "An administrator can grant full access" },
              { icon: Lock,   text: "Your password is stored securely, never in plain text" },
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

          <h1 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h1>
          <p className="text-gray-400 text-sm mb-8">Register to access TeleBid Enterprise</p>

          {error && (
            <div className="flex items-start gap-2 p-3.5 bg-red-50 border border-red-200 rounded-xl mb-5 text-red-700 text-sm">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input name="full_name" type="text" className="input pl-10"
                  placeholder="Jane Doe" value={form.full_name} onChange={fc}
                  autoFocus autoComplete="name"/>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Username</label>
                <input name="username" type="text" className="input"
                  placeholder="jdoe" value={form.username} onChange={fc}
                  autoComplete="username"/>
              </div>
              <div>
                <label className="label">Job Title</label>
                <div className="relative">
                  <Briefcase size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                  <input name="job_title" type="text" className="input pl-8"
                    placeholder="Optional" value={form.job_title} onChange={fc}/>
                </div>
              </div>
            </div>

            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input name="email" type="email" className="input pl-10"
                  placeholder="jane@company.com" value={form.email} onChange={fc}
                  autoComplete="email"/>
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input name="password" type={showPw ? "text" : "password"}
                  className="input pl-10 pr-10"
                  placeholder="At least 8 characters"
                  value={form.password} onChange={fc}
                  autoComplete="new-password"/>
                <button type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Must include an uppercase letter and a number.</p>
            </div>

            <button type="submit"
              className="btn-primary w-full justify-center py-3 text-base mt-2"
              disabled={loading}>
              {loading
                ? <><Loader2 size={16} className="animate-spin"/> Creating account…</>
                : "Create Account"}
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
