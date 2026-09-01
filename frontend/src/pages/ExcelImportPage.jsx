import React, { useState, useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { excelImportApi } from "../services/api"
import { fmt } from "../utils/fmt"
import { apiErrorMessage } from "../utils/apiError"
import toast from "react-hot-toast"
import clsx from "clsx"
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Eye, Download } from "lucide-react"

export default function ExcelImportPage() {
  const fileRef = useRef()
  const [tab, setTab] = useState("import")
  const [analysis, setAnalysis] = useState(null)
  const [selectedSheet, setSelectedSheet] = useState(0)
  const [mapping, setMapping] = useState({})
  const [templateName, setTemplateName] = useState("")
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const { data: history = [] } = useQuery({ queryKey:["import-history"], queryFn:()=>excelImportApi.history().then(r=>r.data), retry:1 })

  const analyzeMut = useMutation({
    mutationFn: file => excelImportApi.analyze(file),
    onSuccess: r => {
      setAnalysis(r.data)
      setSelectedSheet(0)
      const sheet = r.data.sheets[0]
      setMapping(sheet?.suggested_mapping || {})
      setTemplateName(r.data.file_name?.replace(/\.\w+$/,"") || "Imported Template")
      toast.success("File analyzed — review and confirm")
    },
    onError: e => toast.error(apiErrorMessage(e, "Failed to analyze file"))
  })

  const handleFile = e => {
    const file = e.target.files?.[0]
    if (file) analyzeMut.mutate(file)
    e.target.value = ""
  }

  const handleImport = async () => {
    if (!analysis || !templateName) return
    const sheet = analysis.sheets[selectedSheet]
    // Build rows from sample + tell user it's ready
    setImporting(true)
    try {
      const res = await excelImportApi.importCriteria({
        template_name: templateName,
        column_mapping: mapping,
        rows: [] // In full implementation, rows come from re-parsing the file
      })
      setImportResult(res.data)
      toast.success(`Import complete: ${res.data.imported} criteria imported`)
    } catch(e) {
      toast.error(apiErrorMessage(e, "Import failed"))
    } finally { setImporting(false) }
  }

  const FIELD_TYPES = ["category","field_name","weight","max_score","min_score","dropdown_values","mandatory","description","ignore"]

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-primary-800">Excel Import — Evaluation Criteria</h1>
        <p className="text-sm text-gray-500">Upload your Excel file to import evaluation fields and dropdown values</p>
      </div>

      <div className="border-b border-gray-200">
        <div className="flex">
          {[["import","Import New File"],["history","Import History"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${tab===t?"border-primary-500 text-primary-600":"border-transparent text-gray-500 hover:text-gray-700"}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "import" && (
        <>
          {/* Upload Zone */}
          {!analysis && (
            <div
              className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-primary-400 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet size={48} className="mx-auto mb-4 text-gray-300"/>
              <p className="font-semibold text-gray-600 text-lg">{analyzeMut.isPending ? "Analyzing file…" : "Click to upload Excel or CSV"}</p>
              <p className="text-sm text-gray-400 mt-2">Supports .xlsx, .xls, .csv</p>
              <p className="text-xs text-gray-300 mt-1">File will be analyzed before any import happens</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile}/>
            </div>
          )}

          {/* Analysis Result */}
          {analysis && (
            <div className="space-y-5">
              <div className="card bg-green-50 border-green-200">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle2 size={20} className="text-green-600"/>
                  <div>
                    <div className="font-semibold text-green-800">File analyzed successfully</div>
                    <div className="text-xs text-green-600">{analysis.file_name} · {analysis.total_sheets} sheet(s)</div>
                  </div>
                  <button className="btn-secondary btn-sm ml-auto" onClick={()=>{setAnalysis(null);setImportResult(null)}}>
                    <Upload size={13}/> Upload New File
                  </button>
                </div>
              </div>

              {/* Sheet selector */}
              {analysis.sheets.length > 1 && (
                <div className="flex gap-2">
                  {analysis.sheets.map((s,i)=>(
                    <button key={i} onClick={()=>setSelectedSheet(i)} className={clsx("btn-sm rounded-lg",selectedSheet===i?"btn-primary":"btn-ghost")}>{s.name}</button>
                  ))}
                </div>
              )}

              {/* Column mapping */}
              {analysis.sheets[selectedSheet] && (
                <div className="card">
                  <h3 className="font-semibold text-gray-700 mb-4">Map Columns — "{analysis.sheets[selectedSheet].name}"</h3>
                  <p className="text-sm text-gray-500 mb-4">Tell us what each column represents. Preview shows first 5 rows.</p>

                  <div className="overflow-x-auto rounded-xl border border-gray-200 mb-4">
                    <table className="tbl">
                      <thead>
                        <tr>
                          {analysis.sheets[selectedSheet].headers.map((h,i)=>(
                            <th key={i}>
                              <div className="font-mono text-xs text-gray-500 mb-1">{h}</div>
                              <select className="input py-1 text-xs" value={mapping[h]||"ignore"}
                                onChange={e=>setMapping(p=>({...p,[h]:e.target.value}))}>
                                {FIELD_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                              </select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.sheets[selectedSheet].sample_rows.map((row,ri)=>(
                          <tr key={ri}>
                            {row.map((cell,ci)=>(
                              <td key={ci} className="text-xs text-gray-600 max-w-[120px] truncate">{cell||"—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="label">Template Name *</label>
                      <input className="input" value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="e.g. RFP Evaluation Template 2026"/>
                    </div>
                    <div className="flex items-end">
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-start gap-2">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5"/>
                        Import will NOT run automatically. Review the mapping above, then confirm.
                      </div>
                    </div>
                  </div>

                  {!importResult ? (
                    <button className="btn-primary" disabled={importing||!templateName} onClick={handleImport}>
                      <CheckCircle2 size={14}/> {importing?"Importing…":"Confirm & Import"}
                    </button>
                  ) : (
                    <div className="p-4 bg-gray-50 rounded-xl border">
                      <div className="grid grid-cols-3 gap-4 text-center mb-3">
                        <div><div className="text-2xl font-bold text-green-600">{importResult.imported}</div><div className="text-xs text-gray-500">Imported</div></div>
                        <div><div className="text-2xl font-bold text-amber-600">{importResult.skipped}</div><div className="text-xs text-gray-500">Skipped</div></div>
                        <div><div className="text-2xl font-bold text-red-600">{importResult.errors}</div><div className="text-xs text-gray-500">Errors</div></div>
                      </div>
                      <p className="text-sm text-green-700 font-medium">{importResult.message}</p>
                      {importResult.error_details?.length>0 && (
                        <div className="mt-2 text-xs text-red-600 max-h-20 overflow-y-auto">
                          {importResult.error_details.map((e,i)=><div key={i}>{e}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div className="card p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>File</th><th>Type</th><th>Imported By</th><th>Total</th><th>Success</th><th>Errors</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {history.length===0 ? <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">No imports yet</td></tr>
                : history.map(h=>(
                  <tr key={h.import_id}>
                    <td className="font-medium text-sm max-w-[160px] truncate">{h.file_name}</td>
                    <td><span className="badge-blue text-xs">{h.import_type}</span></td>
                    <td className="text-sm">{h.imported_by_name}</td>
                    <td className="text-sm">{h.total_rows}</td>
                    <td><span className="badge-green">{h.imported}</span></td>
                    <td>{h.errors>0?<span className="badge-red">{h.errors}</span>:<span className="badge-green">0</span>}</td>
                    <td><span className={clsx("badge",h.status==="COMPLETED"?"badge-green":h.status==="PARTIAL"?"badge-amber":"badge-gray")}>{h.status}</span></td>
                    <td className="text-xs text-gray-400">{fmt(h.imported_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
