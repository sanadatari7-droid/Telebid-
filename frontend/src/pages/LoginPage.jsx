import React, { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "../store/authStore"
import { authApi } from "../services/api"
import { Eye, EyeOff, Zap, Shield, Lock, User, KeyRound, AlertCircle, Loader2, CheckCircle2 } from "lucide-react"
import toast from "react-hot-toast"
import clsx from "clsx"

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [step, setStep] = useState("login")   // login | otp
  const [form, setForm] = useState({ username:"", password:"", otp:"" })
  const [session, setSession] = useState(null)
  const [demoOtp, setDemoOtp] = useState(null)
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const otpRef = useRef(null)

  // Auto-focus OTP input when step changes
  useEffect(() => {
    if (step === "otp" && otpRef.current) {
      setTimeout(() => otpRef.current?.focus(), 100)
    }
  }, [step])

  const fc = e => {
    const { name, value } = e.target
    // Strip non-digits from OTP field
    const val = name === "otp" ? value.replace(/\D/g, "").slice(0, 6) : value
    setForm(p => ({ ...p, [name]: val }))
    setError("")
  }

  // ── Step 1: Username + Password ──────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault()
    if (!form.username.trim()) { setError("Please enter your username"); return }
    if (!form.password)        { setError("Please enter your password"); return }
    setLoading(true); setError("")
    try {
      const { data } = await authApi.login({
        username: form.username.trim(),
        password: form.password,
      })
      if (data.requires_otp) {
        setSession(data.session_token)
        // If SMTP not configured, demo_otp is shown — auto-fill it
        if (data.demo_otp) {
          setDemoOtp(data.demo_otp)
          setForm(p => ({ ...p, otp: data.demo_otp }))
          toast("Demo mode: OTP auto-filled ↓", { icon: "🔐" })
        } else {
          setDemoOtp(null)
          toast.success("OTP sent to your email")
        }
        setStep("otp")
      } else if (data.access_token) {
        setAuth(data)
        toast.success(`Welcome back, ${data.user?.full_name || data.user?.username}!`)
        navigate("/dashboard", { replace: true })
      }
    } catch (err) {
      const msg = err?.response?.data?.detail
      setError(typeof msg === "string" ? msg : "Login failed. Check your credentials.")
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: OTP Verification ─────────────────────────────────────────────
  const handleOtp = async (e) => {
    e.preventDefault()
    if (!form.otp || form.otp.length !== 6) {
      setError("Please enter the 6-digit verification code")
      return
    }
    setLoading(true); setError("")
    try {
      const { data } = await authApi.verifyOtp({
        session_token: session,
        otp_code: form.otp,
      })
      if (data.access_token) {
        setAuth(data)
        toast.success(`Welcome back, ${data.user?.full_name || data.user?.username}!`)
        navigate("/dashboard", { replace: true })
      }
    } catch (err) {
      const msg = err?.response?.data?.detail
      setError(typeof msg === "string" ? msg : "Invalid OTP code. Please try again.")
      // Clear OTP field on failure so user can retype
      setForm(p => ({ ...p, otp: "" }))
    } finally {
      setLoading(false)
    }
  }

  const goBack = () => {
    setStep("login")
    setError("")
    setDemoOtp(null)
    setSession(null)
    setForm(p => ({ ...p, otp: "" }))
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* ── Left branding panel ─────────────────────────────────────────── */}
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
            Professional Bid &amp; Tender Management
          </h2>
          <p className="text-blue-200 text-base leading-relaxed">
            A complete enterprise platform for managing the full lifecycle of bids, tenders, evaluations and contracts.
          </p>
          <div className="mt-10 space-y-4">
            {[
              { icon: Shield, text: "Multi-level approval workflows" },
              { icon: Zap,    text: "EXPRO & Government bid tracking" },
              { icon: Lock,   text: "Role-based access control" },
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

      {/* ── Right login form ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white"/>
            </div>
            <div className="font-bold text-gray-900">TeleBid Enterprise</div>
          </div>

          {/* ── Step 1: Login ─────────────────────────────────────────────── */}
          {step === "login" && (
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h1>
              <p className="text-gray-400 text-sm mb-8">Sign in to your account to continue</p>

              {error && (
                <div className="flex items-start gap-2 p-3.5 bg-red-50 border border-red-200 rounded-xl mb-5 text-red-700 text-sm">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="label">Username or Email</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input name="username" type="text" className="input pl-10"
                      placeholder="Enter your username"
                      value={form.username} onChange={fc}
                      autoFocus autoComplete="username"/>
                  </div>
                </div>

                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input name="password" type={showPw ? "text" : "password"}
                      className="input pl-10 pr-10"
                      placeholder="Enter your password"
                      value={form.password} onChange={fc}
                      autoComplete="current-password"/>
                    <button type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                </div>

                <button type="submit"
                  className="btn-primary w-full justify-center py-3 text-base mt-2"
                  disabled={loading}>
                  {loading
                    ? <><Loader2 size={16} className="animate-spin"/> Signing in…</>
                    : "Sign in"}
                </button>
              </form>

              {/* Demo credentials box */}
              <div className="mt-6 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <div className="text-xs font-semibold text-blue-600 mb-2 uppercase tracking-wide">Default Credentials</div>
                <div className="grid grid-cols-2 gap-2 text-xs text-blue-700">
                  <div><span className="font-medium">Username:</span> admin</div>
                  <div><span className="font-medium">Password:</span> Admin@1234</div>
                </div>
                <div className="text-xs text-blue-500 mt-2">Change these immediately after first login.</div>
              </div>

              <p className="text-center text-xs text-gray-400 mt-5">
                Don't have a company workspace yet?{" "}
                <button onClick={() => navigate("/signup")}
                  className="text-blue-600 font-medium hover:underline">
                  Create one
                </button>
              </p>
            </div>
          )}

          {/* ── Step 2: OTP ───────────────────────────────────────────────── */}
          {step === "otp" && (
            <div>
              <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
                <KeyRound size={26} className="text-blue-600"/>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">Verify your identity</h1>
              <p className="text-gray-400 text-sm mb-6">Enter the 6-digit verification code</p>

              {/* Demo OTP notice */}
              {demoOtp && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl mb-5">
                  <Shield size={16} className="text-amber-600 flex-shrink-0 mt-0.5"/>
                  <div>
                    <div className="text-sm font-semibold text-amber-800">Demo Mode</div>
                    <div className="text-xs text-amber-700 mt-0.5">
                      SMTP is not configured — your OTP is shown below and auto-filled.
                      Configure SMTP in System Settings to send real emails.
                    </div>
                    <div className="font-mono text-2xl font-bold mt-2 tracking-[0.4em] text-amber-800">
                      {demoOtp}
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3.5 bg-red-50 border border-red-200 rounded-xl mb-5 text-red-700 text-sm">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5"/>
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleOtp} className="space-y-4">
                <div>
                  <label className="label">6-Digit Verification Code</label>
                  <input
                    ref={otpRef}
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    className={clsx(
                      "input text-center text-2xl tracking-[1em] font-mono font-bold py-4",
                      form.otp.length === 6 && "border-green-400 bg-green-50"
                    )}
                    placeholder="000000"
                    value={form.otp}
                    onChange={fc}
                  />
                  {form.otp.length > 0 && form.otp.length < 6 && (
                    <p className="text-xs text-gray-400 mt-1 text-center">
                      {6 - form.otp.length} more digit{6-form.otp.length !== 1 ? "s" : ""} needed
                    </p>
                  )}
                  {form.otp.length === 6 && (
                    <p className="text-xs text-green-600 mt-1 text-center flex items-center justify-center gap-1">
                      <CheckCircle2 size={12}/> Ready to verify
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-primary w-full justify-center py-3 text-base"
                  disabled={loading || form.otp.length !== 6}>
                  {loading
                    ? <><Loader2 size={16} className="animate-spin"/> Verifying…</>
                    : "Verify & Continue"}
                </button>
              </form>

              <button
                onClick={goBack}
                className="w-full text-center text-sm text-gray-400 hover:text-gray-600 mt-4 transition-colors">
                ← Back to sign in
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
