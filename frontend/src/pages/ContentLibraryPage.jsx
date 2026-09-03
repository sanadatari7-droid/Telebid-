import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { contentLibraryApi } from "../services/api"
import { apiErrorMessage } from "../utils/apiError"
import toast from "react-hot-toast"
import clsx from "clsx"
import { BookOpen, Plus, Trash2, Search, Wand2, X, Check } from "lucide-react"

const CATEGORIES = ["Technical", "Commercial", "Legal", "Eligibility", "Timeline", "Other"]

function ItemModal({ item, onClose }) {
  const qc = useQueryClient()
  const isNew = !item?.item_id
  const [form, setForm] = useState(item || { question: "", answer: "", category: "Other", tags: "" })
  const fc = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const saveMut = useMutation({
    mutationFn: () => isNew ? contentLibraryApi.create(form) : contentLibraryApi.update(item.item_id, form),
    onSuccess: () => { toast.success(isNew ? "Added to library" : "Updated"); qc.invalidateQueries({ queryKey: ["content-library"] }); onClose() },
    onError: e => toast.error(apiErrorMessage(e, "Save failed")),
  })

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-gray-900">{isNew ? "New Library Entry" : "Edit Entry"}</h2>
          <button className="btn-ghost p-2" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Category</label>
            <select name="category" className="input" value={form.category} onChange={fc}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="label">Question</label><textarea name="question" className="input" rows={2} value={form.question} onChange={fc}/></div>
          <div><label className="label">Answer</label><textarea name="answer" className="input" rows={5} value={form.answer} onChange={fc}/></div>
          <div><label className="label">Tags (comma-separated)</label><input name="tags" className="input" value={form.tags || ""} onChange={fc}/></div>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saveMut.isPending || !form.question || !form.answer} onClick={() => saveMut.mutate()}>
              <Check size={13}/> {saveMut.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DraftTester() {
  const [question, setQuestion] = useState("")
  const [result, setResult] = useState(null)
  const draftMut = useMutation({
    mutationFn: () => contentLibraryApi.draftAnswer(question),
    onSuccess: r => setResult(r.data),
    onError: e => toast.error(apiErrorMessage(e, "Draft failed")),
  })

  return (
    <div className="card-sm bg-purple-50 border-purple-200 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-purple-800"><Wand2 size={15}/> Try AI Draft</div>
      <p className="text-xs text-purple-700">
        Type any RFP-style question — the AI retrieves the most similar entries from your library below
        and drafts an answer grounded in them (retrieval-augmented, not invented from scratch).
      </p>
      <div className="flex gap-2">
        <input className="input text-sm" placeholder="e.g. What SLA do you guarantee for fiber connectivity?"
          value={question} onChange={e=>setQuestion(e.target.value)}/>
        <button className="btn-primary btn-sm shrink-0" disabled={!question.trim() || draftMut.isPending} onClick={()=>draftMut.mutate()}>
          {draftMut.isPending ? "Drafting…" : "Draft"}
        </button>
      </div>
      {result && (
        <div className="bg-white rounded-lg border border-purple-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className={clsx("badge text-xs", result.grounded ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
              {result.grounded ? "Grounded in library" : "Low library coverage"}
            </span>
            <span className="text-xs text-gray-400">{result.sources?.length || 0} source(s) used</span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{result.answer}</p>
        </div>
      )}
    </div>
  )
}

export default function ContentLibraryPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [editItem, setEditItem] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ["content-library", search, category],
    queryFn: () => contentLibraryApi.list({ search: search || undefined, category: category || undefined }).then(r => r.data),
    retry: 1,
  })
  const deleteMut = useMutation({
    mutationFn: id => contentLibraryApi.delete(id),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["content-library"] }) },
  })

  const items = data?.items || []

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><BookOpen size={20} className="text-primary-600"/> AI Content Library</h1>
          <p className="page-subtitle">Reusable past proposal answers — the AI drafts new RFP responses grounded in these, not from scratch</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={14}/> New Entry</button>
      </div>

      <DraftTester/>

      <div className="card-sm py-3">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input className="input pl-9" placeholder="Search question or answer…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <select className="input w-auto py-2" value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Tags</th>
                <th>Used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-10"><div className="animate-spin inline-block w-5 h-5 border-4 border-blue-500 border-t-transparent rounded-full"/></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="py-12">
                  <div className="empty-state"><div className="empty-icon mx-auto"><BookOpen size={28}/></div><p className="text-sm text-gray-400">No entries yet — add past proposal answers to build the library</p></div>
                </td></tr>
              ) : items.map(it => (
                <tr key={it.item_id} className="cursor-pointer" onClick={() => setEditItem(it)}>
                  <td><span className="badge badge-gray text-xs">{it.category}</span></td>
                  <td className="text-sm max-w-xs truncate">{it.question}</td>
                  <td className="text-xs text-gray-500 max-w-sm truncate">{it.answer}</td>
                  <td className="text-xs text-gray-400 max-w-[140px] truncate">{it.tags || "—"}</td>
                  <td className="text-xs text-gray-500">{it.times_used}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <button className="btn-ghost btn-sm text-red-400" onClick={()=>{if(window.confirm("Delete this entry?"))deleteMut.mutate(it.item_id)}}>
                      <Trash2 size={12}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && <ItemModal onClose={() => setShowCreate(false)}/>}
      {editItem && <ItemModal item={editItem} onClose={() => setEditItem(null)}/>}
    </div>
  )
}
