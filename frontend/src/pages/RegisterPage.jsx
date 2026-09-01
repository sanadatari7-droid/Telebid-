import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { authApi } from "../services/api"
import { apiErrorMessage } from "../utils/apiError"
import { Eye, EyeOff, Lock, User, Mail, Briefcase, AlertCircle, Loader2, UserPlus } from "lucide-react"
import toast from "react-hot-toast"

const INITIAL = { username:"", email:"", password:"", full_name:"", job_title:"" }

// Authenticated ADMIN-only "invite a teammate" form — the public
// registration flow is SignupPage.jsx (creates a new company/tenant).
// New teammates always land as PROCUREMENT; an admin promotes them
// explicitly afterwards via User Management.
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
    if (!form.email.trim())     { setError("Please enter their email"); return }
    if (!form.full_name.trim()) { setError("Please enter their full name"); return }
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
      toast.success(`${form.full_name.trim()} has been added to your company.`)
      navigate("/users", { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err, "Could not add teammate. Please try again."))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <div className="card">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <UserPlus size={18} className="text-blue-600"/>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Invite a Teammate</h1>
            <p className="text-gray-400 text-xs">They'll join your company workspace as Procurement</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3.5 bg-red-50 border border-red-200 rounded-xl mt-5 mb-1 text-red-700 text-sm">
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-5">
          <div>
            <label className="label">Full Name</label>
            <div className="relative">
              <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input name="full_name" type="text" className="input pl-10"
                placeholder="Jane Doe" value={form.full_name} onChange={fc}
                autoFocus autoComplete="off"/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Username</label>
              <input name="username" type="text" className="input"
                placeholder="jdoe" value={form.username} onChange={fc}
                autoComplete="off"/>
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
                autoComplete="off"/>
            </div>
          </div>

          <div>
            <label className="label">Temporary Password</label>
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
            <p className="text-xs text-gray-400 mt-1">Must include an uppercase letter and a number. Share this with them securely.</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => navigate("/users")}
              className="btn-secondary flex-1 justify-center py-3">
              Cancel
            </button>
            <button type="submit"
              className="btn-primary flex-1 justify-center py-3"
              disabled={loading}>
              {loading
                ? <><Loader2 size={16} className="animate-spin"/> Adding…</>
                : "Add Teammate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
