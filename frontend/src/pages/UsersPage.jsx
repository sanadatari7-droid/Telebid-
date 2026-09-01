import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { usersApi } from "../services/api"
import { fmt } from "../utils/fmt"
import toast from "react-hot-toast"
import { Plus, Lock, Unlock, UserX, UserCheck, KeyRound, Pencil, X, Check, Search, Users } from "lucide-react"
import clsx from "clsx"

function UserModal({ user, onClose }) {
  const qc = useQueryClient()
  const isNew = !user?.user_id
  const [form, setForm] = useState(isNew
    ? { full_name:"", username:"", email:"", password:"", job_title:"", phone:"", dept_id:"", role_ids:[] }
    : { full_name:user.full_name||"", username:user.username||"", email:user.email||"", job_title:user.job_title||"", phone:user.phone||"", dept_id:user.dept_id||"", role_ids:(user.role_ids||[]).filter(Boolean) })
  const [resetPw, setResetPw] = useState("")
  const { data: roles=[] } = useQuery({ queryKey:["roles"], queryFn:()=>usersApi.getRoles().then(r=>r.data) })
  const { data: depts=[] } = useQuery({ queryKey:["depts"], queryFn:()=>usersApi.getDepts().then(r=>r.data) })
  const fc = e => setForm(p=>({...p,[e.target.name]:e.target.value}))
  const toggleRole = rid => setForm(p=>({...p,role_ids:p.role_ids.includes(rid)?p.role_ids.filter(r=>r!==rid):[...p.role_ids,rid]}))

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const res = await usersApi.create({...form, dept_id:form.dept_id?Number(form.dept_id):null})
        if (form.role_ids.length) await usersApi.updateRoles(res.data.user_id, form.role_ids)
      } else {
        await usersApi.update(user.user_id, {full_name:form.full_name, email:form.email, job_title:form.job_title, phone:form.phone, dept_id:form.dept_id?Number(form.dept_id):null})
        await usersApi.updateRoles(user.user_id, form.role_ids)
      }
    },
    onSuccess: () => { toast.success(isNew?"User created":"User updated"); qc.invalidateQueries({queryKey:["users-list"]}); onClose() }
  })
  const resetMut = useMutation({
    mutationFn: () => usersApi.resetPassword(user.user_id, resetPw),
    onSuccess: () => { toast.success("Password reset"); setResetPw("") }
  })

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900">{isNew?"Create User":"Edit User"}</h2>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label label-required">Full Name</label><input name="full_name" className="input" value={form.full_name} onChange={fc}/></div>
            <div><label className="label label-required">Username</label><input name="username" className="input" value={form.username} onChange={fc} readOnly={!isNew}/></div>
          </div>
          <div><label className="label label-required">Email</label><input name="email" type="email" className="input" value={form.email} onChange={fc}/></div>
          {isNew && <div><label className="label label-required">Password (min 8 chars)</label><input name="password" type="password" className="input" value={form.password} onChange={fc}/></div>}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Job Title</label><input name="job_title" className="input" value={form.job_title} onChange={fc}/></div>
            <div><label className="label">Phone</label><input name="phone" className="input" value={form.phone} onChange={fc}/></div>
          </div>
          <div>
            <label className="label">Department</label>
            <select name="dept_id" className="input" value={form.dept_id} onChange={fc}>
              <option value="">No department</option>
              {depts.map(d=><option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Roles</label>
            <div className="grid grid-cols-2 gap-2">
              {roles.map(r=>(
                <label key={r.role_id} className={clsx("flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all",
                  form.role_ids.includes(r.role_id)?"bg-blue-50 border-blue-400":"bg-gray-50 border-gray-100 hover:bg-gray-100")}>
                  <input type="checkbox" checked={form.role_ids.includes(r.role_id)} onChange={()=>toggleRole(r.role_id)} className="w-4 h-4 accent-blue-600"/>
                  <span className="text-sm font-medium">{r.role_name}</span>
                </label>
              ))}
            </div>
          </div>
          {!isNew && (
            <div className="border-t pt-4">
              <label className="label flex items-center gap-2"><KeyRound size={12}/> Reset Password</label>
              <div className="flex gap-2">
                <input type="password" className="input flex-1" placeholder="New password (min 8)" value={resetPw} onChange={e=>setResetPw(e.target.value)}/>
                <button className="btn-warning btn-sm" disabled={resetPw.length<8||resetMut.isPending} onClick={()=>resetMut.mutate()}>
                  {resetMut.isPending?"...":"Reset"}
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saveMut.isPending||!form.full_name||!form.email} onClick={()=>saveMut.mutate()}>
              <Check size={13}/> {saveMut.isPending?"Saving…":isNew?"Create User":"Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [editUser, setEditUser] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ["users-list", search],
    queryFn: () => usersApi.list({ page_size:100, search:search||undefined }).then(r=>r.data)
  })
  const users = data?.items || []
  const lockMut   = useMutation({ mutationFn: id=>usersApi.lock(id),       onSuccess:()=>{toast.success("Locked");     qc.invalidateQueries({queryKey:["users-list"]})} })
  const unlockMut = useMutation({ mutationFn: id=>usersApi.unlock(id),     onSuccess:()=>{toast.success("Unlocked");   qc.invalidateQueries({queryKey:["users-list"]})} })
  const deactMut  = useMutation({ mutationFn: id=>usersApi.deactivate(id), onSuccess:()=>{toast.success("Deactivated");qc.invalidateQueries({queryKey:["users-list"]})} })
  const actMut    = useMutation({ mutationFn: id=>usersApi.activate(id),   onSuccess:()=>{toast.success("Activated");  qc.invalidateQueries({queryKey:["users-list"]})} })

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><Users size={22}/> User Management</h1><p className="page-subtitle">Manage accounts, roles and access</p></div>
        <button className="btn-primary" onClick={()=>setShowCreate(true)}><Plus size={14}/> Create User</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[["Active",users.filter(u=>u.is_active&&!u.is_locked).length,"bg-green-600"],
          ["Locked",users.filter(u=>u.is_locked).length,"bg-amber-500"],
          ["Inactive",users.filter(u=>!u.is_active).length,"bg-gray-500"]].map(([l,v,c])=>(
          <div key={l} className="card-sm flex items-center gap-3">
            <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold",c)}>{v}</div>
            <div className="text-sm font-medium text-gray-600">{l} Users</div>
          </div>
        ))}
      </div>
      <div className="card-sm py-3">
        <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input className="input py-2 pl-9" placeholder="Search users…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      </div>
      <div className="card p-0"><div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Department</th><th>Roles</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={8} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
            : users.length===0 ? <tr><td colSpan={8} className="text-center py-8 text-sm text-gray-400">No users found</td></tr>
            : users.map(u=>(
              <tr key={u.user_id}>
                <td><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-bold">{u.full_name?.charAt(0)}</div><div><div className="font-semibold text-sm">{u.full_name}</div><div className="text-xs text-gray-400">{u.job_title}</div></div></div></td>
                <td><span className="font-mono text-xs text-gray-600">{u.username}</span></td>
                <td className="text-sm text-gray-500 max-w-[160px] truncate">{u.email}</td>
                <td className="text-sm text-gray-500">{u.dept_name||"—"}</td>
                <td className="text-xs max-w-[160px]">{u.roles?u.roles.split(", ").map(r=><span key={r} className="badge-blue text-xs mr-1 mb-0.5 inline-block">{r}</span>):"—"}</td>
                <td><span className={clsx("badge text-xs",u.is_locked?"badge-amber":u.is_active?"badge-green":"badge-red")}>{u.is_locked?"Locked":u.is_active?"Active":"Inactive"}</span></td>
                <td className="text-xs text-gray-400">{u.last_login?fmt(u.last_login,"dd MMM yyyy"):"Never"}</td>
                <td><div className="flex gap-1">
                  <button className="btn-ghost btn-sm" onClick={()=>setEditUser(u)}><Pencil size={12}/></button>
                  {u.is_locked ? <button className="btn-ghost btn-sm text-green-600" onClick={()=>unlockMut.mutate(u.user_id)}><Unlock size={12}/></button>
                               : <button className="btn-ghost btn-sm text-amber-600" onClick={()=>lockMut.mutate(u.user_id)}><Lock size={12}/></button>}
                  {u.is_active ? <button className="btn-ghost btn-sm text-red-400" onClick={()=>{if(window.confirm("Deactivate?"))deactMut.mutate(u.user_id)}}><UserX size={12}/></button>
                               : <button className="btn-ghost btn-sm text-green-600" onClick={()=>actMut.mutate(u.user_id)}><UserCheck size={12}/></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {showCreate && <UserModal onClose={()=>setShowCreate(false)}/>}
      {editUser && <UserModal user={editUser} onClose={()=>setEditUser(null)}/>}
    </div>
  )
}
