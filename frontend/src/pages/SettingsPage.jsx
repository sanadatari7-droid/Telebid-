import React, { useState, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { schedulerApi } from "../services/api"
import { Moon, Sun, Globe, Shield, Mail, Send, Monitor, Check, Bell } from "lucide-react"
import clsx from "clsx"
import toast from "react-hot-toast"

export default function SettingsPage() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true")
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "en")

  useEffect(() => {
    if (darkMode) { document.documentElement.classList.add("dark"); localStorage.setItem("darkMode","true") }
    else { document.documentElement.classList.remove("dark"); localStorage.setItem("darkMode","false") }
  }, [darkMode])

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"
    document.documentElement.lang = lang
    localStorage.setItem("lang", lang)
  }, [lang])

  const reminderMut = useMutation({
    mutationFn: () => schedulerApi.sendReminders(),
    onSuccess: r => toast.success(r.data.message),
    onError: () => toast.error("Failed to send reminders — check SMTP settings"),
  })
  const bondMut = useMutation({
    mutationFn: () => schedulerApi.sendReminders(),  // uses same endpoint which includes bond reminders
    onSuccess: r => toast.success(r.data.message || "Bond reminders processed"),
    onError: () => toast.error("Failed to send bond reminders"),
  })

  return (
    <div className="p-6 max-w-screen-md mx-auto space-y-6">
      <div>
        <h1 className="page-title">App Settings</h1>
        <p className="page-subtitle">Appearance, language and notification preferences</p>
      </div>

      {/* Appearance */}
      <div className="card space-y-1">
        <div className="section-title flex items-center gap-2"><Monitor size={13}/> Appearance</div>
        
        {/* Dark Mode */}
        <div className="flex items-center justify-between py-4 border-b border-gray-50">
          <div className="flex items-start gap-3">
            {darkMode ? <Moon size={18} className="text-indigo-500 mt-0.5"/> : <Sun size={18} className="text-amber-500 mt-0.5"/>}
            <div>
              <div className="text-sm font-semibold text-gray-900">Dark Mode</div>
              <div className="text-xs text-gray-400 mt-0.5">Switch between light and dark interface</div>
            </div>
          </div>
          <button onClick={() => setDarkMode(!darkMode)}
            className={clsx("relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
              darkMode ? "bg-blue-600" : "bg-gray-200")}>
            <span className={clsx("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200",
              darkMode ? "translate-x-6" : "translate-x-0.5")}/>
          </button>
        </div>

        {/* Language */}
        <div className="flex items-center justify-between py-4">
          <div className="flex items-start gap-3">
            <Globe size={18} className="text-blue-500 mt-0.5"/>
            <div>
              <div className="text-sm font-semibold text-gray-900">Language</div>
              <div className="text-xs text-gray-400 mt-0.5">Switch interface language and text direction</div>
            </div>
          </div>
          <div className="flex rounded-xl overflow-hidden border border-gray-200">
            {[["en","English","ltr"],["ar","عربي","rtl"]].map(([code, label]) => (
              <button key={code} onClick={() => setLang(code)}
                className={clsx("px-4 py-2 text-sm font-medium transition-all",
                  lang === code ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50")}>
                {label}
                {lang === code && <Check size={13} className="inline ml-1.5"/>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Email Notifications */}
      <div className="card space-y-4">
        <div className="section-title flex items-center gap-2"><Mail size={13}/> Email Notifications</div>
        <div className="alert-info">
          <Shield size={15} className="flex-shrink-0"/>
          <div className="text-xs">
            Configure SMTP settings in <code className="bg-white/60 px-1 py-0.5 rounded font-mono">System Settings → Email</code> to enable email delivery.
            OTP codes and bid notifications will be sent automatically when SMTP is configured.
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Deadline Reminder Emails</div>
            <div className="text-xs text-gray-400 mt-0.5">Send reminder emails to bid owners for upcoming deadlines (next 7 days)</div>
          </div>
          <button className="btn-secondary btn-sm" disabled={reminderMut.isPending} onClick={() => reminderMut.mutate()}>
            <Send size={13}/> {reminderMut.isPending ? "Sending…" : "Send Now"}
          </button>
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-gray-50">
          <div>
            <div className="text-sm font-semibold text-gray-900">Bid Bond Reminders</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Send bond reminders for all opportunities where bond is required and deadline is within 6 days.
              Notifies the bid person <strong>and</strong> their manager.
            </div>
          </div>
          <button className="btn-warning btn-sm" disabled={bondMut?.isPending} onClick={() => bondMut?.mutate?.()}>
            <Bell size={13}/> {bondMut?.isPending ? "Sending…" : "Send Bond Reminders"}
          </button>
        </div>
      </div>

      {/* System Info */}
      <div className="card">
        <div className="section-title flex items-center gap-2"><Shield size={13}/> System</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {[
            ["Version", "1.0.0"],
            ["Build", "Production"],
            ["Auth", "JWT + OTP 2FA"],
            ["Database", "PostgreSQL 16"],
            ["Backend", "FastAPI 0.111"],
            ["Frontend", "React 18 + Vite"],
          ].map(([k,v]) => (
            <div key={k} className="flex justify-between border-b border-gray-50 pb-2">
              <span className="text-gray-400 text-xs font-medium">{k}</span>
              <span className="text-gray-700 text-xs font-semibold">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
