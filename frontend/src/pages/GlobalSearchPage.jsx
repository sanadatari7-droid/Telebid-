import React, { useState, useEffect, useRef } from "react"
import { searchApi } from "../services/api"
import { useNavigate } from "react-router-dom"
import { fmt } from "../utils/fmt"
import clsx from "clsx"
import { Search, FileText, Building2, Briefcase, Trophy, Loader } from "lucide-react"

const ENTITY_PLURAL = { bid:"bids", vendor:"vendors", opportunity:"opportunities", contract:"contracts" }
const ENTITY_ICONS = { bid:FileText, vendor:Building2, opportunity:Briefcase, contract:Trophy }
const ENTITY_COLORS = { bid:"text-primary-600 bg-primary-50", vendor:"text-green-600 bg-green-50", opportunity:"text-amber-600 bg-amber-50", contract:"text-purple-600 bg-purple-50" }

export default function GlobalSearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults(null); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await searchApi.global(query)
        setResults(res.data)
      } catch {}
      finally { setLoading(false) }
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  return (
    <div className="p-6 space-y-5 max-w-screen-lg mx-auto">
      <div><h1 className="text-xl font-bold text-primary-800">Global Search</h1><p className="text-sm text-gray-500">Search across bids, vendors, opportunities, and contracts</p></div>

      <div className="relative">
        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input
          autoFocus
          className="input pl-12 py-4 text-base shadow-sm"
          placeholder="Search anything… bid number, vendor name, customer, contract…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {loading && <Loader size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 animate-spin"/>}
      </div>

      {query.length > 0 && query.length < 2 && (
        <p className="text-sm text-gray-400 text-center">Type at least 2 characters to search</p>
      )}

      {results && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500"><strong>{results.count}</strong> results for "<strong>{results.query}</strong>"</p>
            <div className="flex gap-2 text-xs text-gray-400">
              {["bid","vendor","opportunity","contract"].map(type => {
                const count = results.results.filter(r => r.entity_type===type).length
                return count>0 ? <span key={type} className="badge-gray">{count} {count===1?type:ENTITY_PLURAL[type]}</span> : null
              })}
            </div>
          </div>

          {results.count === 0 ? (
            <div className="card text-center py-12 text-gray-400">
              <Search size={40} className="mx-auto mb-3 opacity-20"/>
              <p className="font-medium">No results found</p>
              <p className="text-sm mt-1">Try a different keyword</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.results.map((r, i) => {
                const Icon = ENTITY_ICONS[r.entity_type] || FileText
                const color = ENTITY_COLORS[r.entity_type] || "text-gray-600 bg-gray-50"
                return (
                  <div key={i}
                    className="card cursor-pointer hover:shadow-md transition-all flex items-start gap-4"
                    onClick={() => navigate(r.url)}>
                    <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", color)}>
                      <Icon size={18}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-800 truncate">{r.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{r.subtitle}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={clsx("badge text-xs capitalize", color)}>{r.entity_type}</span>
                      {r.status && <span className="badge-gray text-xs">{r.status}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {!query && (
        <div className="card text-center py-16 text-gray-300">
          <Search size={48} className="mx-auto mb-3 opacity-20"/>
          <p className="font-medium text-gray-500">Start typing to search</p>
          <p className="text-sm mt-1 text-gray-400">Searches bids, vendors, opportunities, and contracts</p>
        </div>
      )}
    </div>
  )
}
