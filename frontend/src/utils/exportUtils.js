import * as XLSX from "xlsx"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

// ── Excel Export ─────────────────────────────────────────────────────────────
export function exportToExcel(data, columns, filename = "export") {
  const rows = data.map(row =>
    Object.fromEntries(columns.map(col => [col.header, col.accessor ? col.accessor(row) : row[col.key] ?? "—"]))
  )
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Data")

  // Auto-width columns
  const colWidths = columns.map(col => ({
    wch: Math.max(col.header.length, ...rows.map(r => String(r[col.header] || "").length)) + 2
  }))
  ws["!cols"] = colWidths

  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split("T")[0]}.xlsx`)
}

// ── PDF Export ────────────────────────────────────────────────────────────────
export function exportToPDF(data, columns, title = "Report", filename = "report") {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

  // Header
  doc.setFillColor(30, 64, 128)
  doc.rect(0, 0, 297, 20, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text("TeleBid Enterprise", 14, 13)
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.text(title, 297 - 14, 13, { align: "right" })

  // Date
  doc.setTextColor(100)
  doc.setFontSize(8)
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 27)

  // Table
  autoTable(doc, {
    startY: 30,
    head: [columns.map(c => c.header)],
    body: data.map(row =>
      columns.map(col => col.accessor ? col.accessor(row) : String(row[col.key] ?? "—"))
    ),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [30, 64, 128], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 14, right: 14 },
  })

  // Footer
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(`Page ${i} of ${pageCount}`, 297 - 14, 205, { align: "right" })
  }

  doc.save(`${filename}_${new Date().toISOString().split("T")[0]}.pdf`)
}

// ── Contract PDF ──────────────────────────────────────────────────────────────
export function generateContractPDF(contract) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })

  // Header background
  doc.setFillColor(30, 64, 128)
  doc.rect(0, 0, 210, 35, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text("TeleBid Enterprise", 14, 15)
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.text("Bid & Tender Management System", 14, 22)
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text("CONTRACT AGREEMENT", 210 - 14, 20, { align: "right" })

  // Contract Number
  doc.setFillColor(245, 247, 250)
  doc.rect(0, 35, 210, 12, "F")
  doc.setTextColor(30, 64, 128)
  doc.setFontSize(11)
  doc.text(`Contract No: ${contract.contract_number || "—"}`, 14, 43)
  doc.setTextColor(100)
  doc.setFontSize(9)
  doc.text(`Date: ${new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" })}`, 210 - 14, 43, { align: "right" })

  // Parties Section
  let y = 58
  doc.setTextColor(30, 64, 128)
  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.text("PARTIES", 14, y)
  doc.setDrawColor(30, 64, 128)
  doc.line(14, y + 2, 196, y + 2)
  y += 8

  const drawField = (label, value, x, yPos) => {
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(label.toUpperCase(), x, yPos)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(30)
    doc.text(String(value || "—"), x, yPos + 5)
  }

  drawField("Vendor / Contractor", contract.vendor_name, 14, y)
  drawField("Contact Person", contract.contact_person, 14, y + 12)
  drawField("Email", contract.vendor_email, 14, y + 24)
  y += 38

  // Contract Details
  doc.setTextColor(30, 64, 128)
  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.text("CONTRACT DETAILS", 14, y)
  doc.line(14, y + 2, 196, y + 2)
  y += 8

  drawField("Related Bid", `${contract.bid_number || ""} — ${contract.bid_title || ""}`, 14, y)
  drawField("Contract Value", contract.contract_value ? `${contract.symbol || "$"}${Number(contract.contract_value).toLocaleString()}` : "—", 14, y + 12)
  drawField("Start Date", contract.start_date ? new Date(contract.start_date).toLocaleDateString("en-GB") : "—", 110, y)
  drawField("End Date", contract.end_date ? new Date(contract.end_date).toLocaleDateString("en-GB") : "—", 110, y + 12)
  drawField("Status", contract.status || "DRAFT", 14, y + 24)
  y += 38

  // Notes
  if (contract.notes) {
    doc.setTextColor(30, 64, 128)
    doc.setFontSize(11)
    doc.setFont("helvetica", "bold")
    doc.text("NOTES", 14, y)
    doc.line(14, y + 2, 196, y + 2)
    y += 8
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(60)
    const lines = doc.splitTextToSize(contract.notes, 180)
    doc.text(lines, 14, y)
    y += lines.length * 5 + 10
  }

  // Signature section
  y = Math.max(y + 10, 200)
  doc.setDrawColor(180)
  doc.line(14, y, 90, y)
  doc.line(120, y, 196, y)
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text("Authorized Signatory (Vendor)", 14, y + 5)
  doc.text("Authorized Signatory (Company)", 120, y + 5)

  if (contract.signed_at) {
    doc.setTextColor(30, 128, 60)
    doc.setFontSize(9)
    doc.setFont("helvetica", "bold")
    doc.text(`✓ SIGNED on ${new Date(contract.signed_at).toLocaleDateString("en-GB")}`, 14, y + 12)
  }

  // Footer
  doc.setFillColor(30, 64, 128)
  doc.rect(0, 282, 210, 15, "F")
  doc.setTextColor(200, 200, 200)
  doc.setFontSize(7)
  doc.setFont("helvetica", "normal")
  doc.text("This document was generated by TeleBid Enterprise — Confidential", 105, 291, { align: "center" })

  doc.save(`Contract_${contract.contract_number}_${new Date().toISOString().split("T")[0]}.pdf`)
}
