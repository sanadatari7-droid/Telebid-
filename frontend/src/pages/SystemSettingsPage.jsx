import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { settingsApi } from "../services/api"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Settings, Building2, Globe, Shield, Bell, Database, Plus, Trash2, Edit2, Save, X } from "lucide-react"

const CATEGORIES = [
  { key:"COMPANY",     label:"Company Info",    icon:Building2 },
  { key:"SECURITY",    label:"Security",        icon:Shield },
  { key:"EMAIL",       label:"Email / SMTP",    icon:Bell },
  { key:"EVALUATION",  label:"Evaluation",      icon:Database },
  { key:"INTEGRATIONS",label:"Integrations",    icon:Globe },
  { key:"BIDS",        label:"Bids",            icon:Settings },
  { key:"MODULES",     label:"Modules",         icon:Settings },
  { key:"FINANCE",     label:"Finance",         icon:Database },
  { key:"DISPLAY",     label:"Display",         icon:Globe },
]

export default function SystemSettingsPage() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState("COMPANY")
  const [editingKey, setEditingKey] = useState(null)
  const [editValue, setEditValue] = useState("")
  const [showDropdowns, setShowDropdowns] = useState(false)
  const [selectedDropdown, setSelectedDropdown] = useState("")
  const [newOption, setNewOption] = useState({ option_value:"", option_label:"" })

  const { data: settings = [] } = useQuery({
    queryKey: ["system-settings", activeTab],
    queryFn: () => settingsApi.getAll({ category: activeTab }).then(r => r.data)
  })
  const { data: company } = useQuery({
    queryKey: ["company"],
    queryFn: () => settingsApi.getCompany().then(r => r.data)
  })
  const { data: dropdowns = [] } = useQuery({
    queryKey: ["dropdowns-list"],
    queryFn: () => settingsApi.listDropdowns().then(r => r.data)
  })
  const { data: dropdownOptions = [] } = useQuery({
    queryKey: ["dropdown-options", selectedDropdown],
    queryFn: () => settingsApi.getDropdown(selectedDropdown).then(r => r.data),
    enabled: !!selectedDropdown
  })
  const { data: ictCategories = [] } = useQuery({
    queryKey: ["ict-categories"],
    queryFn: () => settingsApi.getIctCategories().then(r => r.data)
  })

  const updateMut = useMutation({
    mutationFn: ({ key, value }) => settingsApi.update(key, value),
    onSuccess: () => { toast.success("Setting updated"); qc.invalidateQueries({ queryKey: ["system-settings"] }); setEditingKey(null) }
  })
  const updateCompanyMut = useMutation({
    mutationFn: d => settingsApi.updateCompany(d),
    onSuccess: () => { toast.success("Company info updated"); qc.invalidateQueries({ queryKey: ["company"] }) }
  })
  const addOptionMut = useMutation({
    mutationFn: () => settingsApi.addDropdownOption({ dropdown_key: selectedDropdown, dropdown_label: selectedDropdown, ...newOption }),
    onSuccess: () => { toast.success("Option added"); qc.invalidateQueries({ queryKey: ["dropdown-options", selectedDropdown] }); setNewOption({ option_value:"", option_label:"" }) }
  })
  const delOptionMut = useMutation({
    mutationFn: val => settingsApi.deleteDropdownOption(selectedDropdown, val),
    onSuccess: () => { toast.success("Option removed"); qc.invalidateQueries({ queryKey: ["dropdown-options", selectedDropdown] }) }
  })

  const [companyForm, setCompanyForm] = useState({})
  React.useEffect(() => { if (company) setCompanyForm(company) }, [company])

  return (
    <div className="p-6 space-y-5 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary-800">System Settings</h1>
          <p className="text-sm text-gray-500">Configure the application without modifying code</p>
        </div>
        <div className="flex gap-2">
          <button className={clsx("btn-secondary btn-sm", showDropdowns && "bg-primary-100")} onClick={() => setShowDropdowns(!showDropdowns)}>
            <Globe size={14}/> Dropdown Values
          </button>
        </div>
      </div>

      {/* Dropdown Manager */}
      {showDropdowns && (
        <div className="card border-2 border-primary-200">
          <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2"><Globe size={16}/> Dropdown / Menu Values Manager</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="label">Select Dropdown to Edit</label>
              <select className="input" value={selectedDropdown} onChange={e => setSelectedDropdown(e.target.value)}>
                <option value="">Choose dropdown…</option>
                {dropdowns.map(d => <option key={d.dropdown_key} value={d.dropdown_key}>{d.dropdown_label || d.dropdown_key}</option>)}
              </select>
            </div>
            {selectedDropdown && (
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Options in "{selectedDropdown}"</label>
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto mb-3">
                  {dropdownOptions.map(opt => (
                    <div key={opt.dropdown_id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                      <span className="font-mono text-xs text-gray-500 w-24">{opt.option_value}</span>
                      <span className="flex-1 mx-2">{opt.option_label}</span>
                      <button className="btn-ghost btn-sm text-red-400 p-1" onClick={() => delOptionMut.mutate(opt.option_value)}><Trash2 size={11}/></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="input py-1.5 text-sm" placeholder="Value (e.g. NET30)" value={newOption.option_value} onChange={e => setNewOption(p => ({...p, option_value: e.target.value}))}/>
                  <input className="input py-1.5 text-sm" placeholder="Label (e.g. Net 30 Days)" value={newOption.option_label} onChange={e => setNewOption(p => ({...p, option_label: e.target.value}))}/>
                  <button className="btn-primary btn-sm" disabled={!newOption.option_value || addOptionMut.isPending} onClick={() => addOptionMut.mutate()}>
                    <Plus size={13}/> Add
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Sidebar */}
        <div className="space-y-1">
          {CATEGORIES.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={clsx("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-left",
                activeTab === key ? "bg-primary-500 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100")}>
              <Icon size={16} className="flex-shrink-0"/>
              {label}
            </button>
          ))}
          <button onClick={() => setActiveTab("DROPDOWNS_ICT")}
            className={clsx("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-left",
              activeTab === "DROPDOWNS_ICT" ? "bg-primary-500 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100")}>
            <Settings size={16}/>ICT Categories
          </button>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          {/* Company Info */}
          {activeTab === "COMPANY" && company && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-5 flex items-center gap-2"><Building2 size={16}/> Company Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  ["company_name","Company Name","text"],
                  ["company_name_ar","Company Name (Arabic)","text"],
                  ["address","Address","text"],
                  ["city","City","text"],
                  ["country","Country","text"],
                  ["phone","Phone","text"],
                  ["email","Email","email"],
                  ["website","Website","url"],
                  ["industry","Industry","text"],
                ].map(([field, label, type]) => (
                  <div key={field}>
                    <label className="label">{label}</label>
                    <input type={type} className="input"
                      value={companyForm[field] || ""}
                      onChange={e => setCompanyForm(p => ({...p, [field]: e.target.value}))}/>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-5 pt-4 border-t border-gray-100">
                <button className="btn-primary" disabled={updateCompanyMut.isPending}
                  onClick={() => updateCompanyMut.mutate(companyForm)}>
                  <Save size={14}/> {updateCompanyMut.isPending ? "Saving…" : "Save Company Info"}
                </button>
              </div>
            </div>
          )}

          {/* ICT Categories */}
          {activeTab === "DROPDOWNS_ICT" && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-4">ICT Project Categories</h3>
              <p className="text-sm text-gray-500 mb-4">Administrators can add new ICT categories here. These appear in the ICT module.</p>
              <div className="overflow-x-auto rounded-xl border border-gray-200 mb-4">
                <table className="tbl">
                  <thead><tr><th>Code</th><th>Name</th><th>Arabic Name</th><th>Has Construction</th><th>Active</th></tr></thead>
                  <tbody>
                    {ictCategories.map(c => (
                      <tr key={c.ict_cat_id}>
                        <td className="font-mono text-xs text-primary-600">{c.cat_code}</td>
                        <td className="font-medium">{c.cat_name}</td>
                        <td className="text-sm text-gray-500">{c.cat_name_ar || "—"}</td>
                        <td>{c.has_construction ? <span className="badge-green">Yes</span> : <span className="badge-gray">No</span>}</td>
                        <td>{c.is_active ? <span className="badge-green">Active</span> : <span className="badge-red">Inactive</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AddICTCategory onAdded={() => qc.invalidateQueries({ queryKey: ["ict-categories"] })}/>
            </div>
          )}

          {/* Generic Settings */}
          {!["COMPANY","DROPDOWNS_ICT"].includes(activeTab) && (
            <div className="card">
              <h3 className="font-semibold text-gray-700 mb-5">{CATEGORIES.find(c=>c.key===activeTab)?.label} Settings</h3>
              {settings.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No settings in this category</p>
              ) : (
                <div className="space-y-4">
                  {settings.map(s => (
                    <div key={s.setting_id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-700">{s.label}</div>
                        {s.description && <div className="text-xs text-gray-400 mt-0.5">{s.description}</div>}
                        <div className="font-mono text-xs text-gray-300 mt-0.5">{s.setting_key}</div>
                      </div>
                      {editingKey === s.setting_key ? (
                        <div className="flex items-center gap-2">
                          <input className="input py-1.5 text-sm w-48"
                            type={s.setting_type === "SECRET" ? "password" : "text"}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}/>
                          <button className="btn-primary btn-sm" onClick={() => updateMut.mutate({ key: s.setting_key, value: editValue })}><Save size={13}/></button>
                          <button className="btn-ghost btn-sm" onClick={() => setEditingKey(null)}><X size={13}/></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className={clsx("text-sm font-medium", s.setting_type === "SECRET" ? "text-gray-300 font-mono" : "text-gray-700")}>
                            {s.setting_type === "SECRET" ? "••••••••" : (s.setting_value || <span className="text-gray-300 italic">not set</span>)}
                          </span>
                          <button className="btn-ghost btn-sm" onClick={() => { setEditingKey(s.setting_key); setEditValue(s.setting_value || "") }}>
                            <Edit2 size={13}/>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AddICTCategory({ onAdded }) {
  const [form, setForm] = useState({ cat_code:"", cat_name:"", cat_name_ar:"", has_construction:false })
  const [adding, setAdding] = useState(false)
  const handleAdd = async () => {
    if (!form.cat_code || !form.cat_name) return
    setAdding(true)
    try {
      const { settingsApi } = await import("../services/api")
      await settingsApi.addIctCategory(form)
      const toast = (await import("react-hot-toast")).default
      toast.success("ICT category added")
      onAdded()
      setForm({ cat_code:"", cat_name:"", cat_name_ar:"", has_construction:false })
    } catch(e) {
      const toast = (await import("react-hot-toast")).default
      toast.error("Failed to add category")
    } finally { setAdding(false) }
  }
  return (
    <div className="border-t border-gray-100 pt-4">
      <h4 className="text-sm font-semibold text-gray-600 mb-3">Add New ICT Category</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <input className="input py-1.5 text-sm" placeholder="Code (e.g. AI_ML)" value={form.cat_code} onChange={e => setForm(p=>({...p,cat_code:e.target.value.toUpperCase()}))}/>
        <input className="input py-1.5 text-sm" placeholder="Name (English)" value={form.cat_name} onChange={e => setForm(p=>({...p,cat_name:e.target.value}))}/>
        <input className="input py-1.5 text-sm" placeholder="الاسم بالعربي" value={form.cat_name_ar} onChange={e => setForm(p=>({...p,cat_name_ar:e.target.value}))}/> 
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.has_construction} onChange={e=>setForm(p=>({...p,has_construction:e.target.checked}))} className="w-4 h-4"/>
            Construction?
          </label>
          <button className="btn-primary btn-sm" disabled={!form.cat_code||!form.cat_name||adding} onClick={handleAdd}>
            <Plus size={13}/> Add
          </button>
        </div>
      </div>
    </div>
  )
}
