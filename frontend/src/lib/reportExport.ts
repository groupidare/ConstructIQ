import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ReportTable } from "@/lib/reportTables";

export interface ReportProject {
  name: string;
  location: string;
}

export interface ReportData {
  project: ReportProject;
  reportType: string;
  from: Date;
  to: Date;
  table: ReportTable;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function fileBaseName(data: ReportData): string {
  return `${slug(data.project.name)}_${slug(data.reportType)}`;
}

// Material Usage reflects the material plan's current state, not events
// within the chosen date range (see reportTables.ts) — say so plainly
// instead of printing a "Period" line that would imply filtering happened.
function periodLabel(data: ReportData): string {
  if (data.reportType === "Material Usage") return "Current material plan (not period-filtered)";
  return `Period: ${formatDate(data.from)} to ${formatDate(data.to)}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportReportCSV(data: ReportData) {
  const { table } = data;
  const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    csvCell(data.reportType),
    csvCell(`${data.project.name} - ${data.project.location}`),
    csvCell(periodLabel(data)),
    `"Generated","${formatDate(new Date())}"`,
    "",
    table.columns.map(csvCell).join(","),
    ...table.rows.map(row => row.map(csvCell).join(",")),
  ];
  if (table.rows.length === 0) lines.push(`"No data found for the selected period."`);
  downloadBlob(new Blob([lines.join("\n")], { type: "text/csv" }), `${fileBaseName(data)}.csv`);
}

export function exportReportXLS(data: ReportData) {
  const { table } = data;
  const headRow = `<tr>${table.columns.map(c => `<th>${c}</th>`).join("")}</tr>`;
  const bodyRows = table.rows.length > 0
    ? table.rows.map(row => `<tr>${row.map(v => `<td>${v}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${table.columns.length || 1}">No data found for the selected period.</td></tr>`;
  const html = `
    <html xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="utf-8" /></head>
      <body>
        <table border="1">
          <tr><th colspan="${table.columns.length || 1}" style="text-align:left;font-size:14pt;">${data.reportType}</th></tr>
          <tr><td colspan="${table.columns.length || 1}">${data.project.name} — ${data.project.location}</td></tr>
          <tr><td colspan="${table.columns.length || 1}">${periodLabel(data)}</td></tr>
          <tr><td>Generated</td><td colspan="${Math.max(table.columns.length - 1, 1)}">${formatDate(new Date())}</td></tr>
          <tr><td colspan="${table.columns.length || 1}"></td></tr>
          ${headRow}
          ${bodyRows}
        </table>
      </body>
    </html>`;
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel" }), `${fileBaseName(data)}.xls`);
}

export function exportReportPDF(data: ReportData) {
  const doc = new jsPDF();
  const { table } = data;

  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text(data.reportType, 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`${data.project.name} - ${data.project.location}`, 14, 25);
  doc.text(periodLabel(data), 14, 31);
  doc.text(`Generated: ${formatDate(new Date())}`, 14, 36);

  // jsPDF's standard fonts have no glyph for "₱"; substitute plain text so
  // it doesn't render as a mangled fallback character.
  const sanitize = (v: string | number) => String(v).replace(/₱/g, "PHP ");
  const body = table.rows.length > 0
    ? table.rows.map(row => row.map(sanitize))
    : [[`No data found for the selected period.`]];

  autoTable(doc, {
    startY: 44,
    head: table.rows.length > 0 ? [table.columns] : undefined,
    body,
    theme: "striped",
    headStyles: { fillColor: [249, 115, 22] },
    styles: { fontSize: 9 },
  });

  doc.save(`${fileBaseName(data)}.pdf`);
}

export function exportReport(format: string, data: ReportData) {
  if (format === ".CSV") return exportReportCSV(data);
  if (format === ".XLS") return exportReportXLS(data);
  return exportReportPDF(data);
}
