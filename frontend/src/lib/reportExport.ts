import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ReportProject {
  name: string; location: string; type: string; status: string;
  progress: number; startDate: string; endDate: string;
  budget: string; spent: string; materials: number;
  manager: string; engineers: string[];
}

export interface ReportData {
  project: ReportProject;
  reportType: string;
  from: Date;
  to: Date;
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

function buildRows(data: ReportData): [string, string][] {
  const { project } = data;
  return [
    ["Project Type", project.type],
    ["Status", project.status],
    ["Progress", `${project.progress}%`],
    ["Start Date", project.startDate],
    ["Target End Date", project.endDate],
    ["Budget", project.budget],
    ["Spent", project.spent],
    ["Materials Tracked", String(project.materials)],
    ["Project Manager", project.manager],
    ["Engineers", project.engineers.join(", ") || "—"],
  ];
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
  const rows = buildRows(data);
  const csv = [
    `"${data.reportType}"`,
    `"${data.project.name} - ${data.project.location}"`,
    `"Period","${formatDate(data.from)} to ${formatDate(data.to)}"`,
    `"Generated","${formatDate(new Date())}"`,
    "",
    `"Field","Value"`,
    ...rows.map(([k, v]) => `"${k}","${v.replace(/"/g, '""')}"`),
  ].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), `${fileBaseName(data)}.csv`);
}

export function exportReportXLS(data: ReportData) {
  const rows = buildRows(data);
  const rowsHtml = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const html = `
    <html xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="utf-8" /></head>
      <body>
        <table border="1">
          <tr><th colspan="2" style="text-align:left;font-size:14pt;">${data.reportType}</th></tr>
          <tr><td colspan="2">${data.project.name} — ${data.project.location}</td></tr>
          <tr><td>Period</td><td>${formatDate(data.from)} to ${formatDate(data.to)}</td></tr>
          <tr><td>Generated</td><td>${formatDate(new Date())}</td></tr>
          <tr><td></td><td></td></tr>
          <tr><th>Field</th><th>Value</th></tr>
          ${rowsHtml}
        </table>
      </body>
    </html>`;
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel" }), `${fileBaseName(data)}.xls`);
}

export function exportReportPDF(data: ReportData) {
  const doc = new jsPDF();

  // jsPDF's standard fonts have no glyph for "₱"; substitute plain text so
  // it doesn't render as a mangled fallback character.
  const pdfRows = buildRows(data).map(([k, v]) => [k, v.replace(/₱/g, "PHP ")] as [string, string]);

  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text(data.reportType, 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`${data.project.name} - ${data.project.location}`, 14, 25);
  doc.text(`Period: ${formatDate(data.from)} to ${formatDate(data.to)}`, 14, 31);
  doc.text(`Generated: ${formatDate(new Date())}`, 14, 36);

  autoTable(doc, {
    startY: 44,
    head: [["Field", "Value"]],
    body: pdfRows,
    theme: "striped",
    headStyles: { fillColor: [249, 115, 22] },
    styles: { fontSize: 10 },
  });

  doc.save(`${fileBaseName(data)}.pdf`);
}

export function exportReport(format: string, data: ReportData) {
  if (format === ".CSV") return exportReportCSV(data);
  if (format === ".XLS") return exportReportXLS(data);
  return exportReportPDF(data);
}
