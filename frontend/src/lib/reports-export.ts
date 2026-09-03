// ===========================================================================
// Reports export helpers — Excel via the xlsx package and PDF via a print
// view (consistent with the app's existing balance-sheet print behaviour).
//
// Both honours are honouring the filters of the on-screen view because the
// caller always passes the already-filtered rows and the visible columns.
// ===========================================================================

import * as XLSX from "xlsx";
import { fmtDate } from "@/components/ledger-ui";
import { formatCell, exportValue, type ReportColumn } from "@/lib/reports-registry";

export interface ExportHeading {
  companyName?: string;
  title: string;
  /** e.g. "1 Jan 2026 – 31 Jan 2026" or "As of 3 Sep 2026". */
  period?: string;
  /** Extra context lines shown under the period (e.g. active filters). */
  notes?: string[];
}

export type ExportRow = Record<string, any>;

// ─── Generic download helper ──────────────────────────────────────────────

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const stamp = () => new Date().toISOString().slice(0, 10);

function headingRows(
  heading: ExportHeading,
  columnCount: number,
): { rows: any[][]; count: number } {
  const rows: any[][] = [];
  if (heading.companyName) rows.push([heading.companyName]);
  rows.push([heading.title]);
  if (heading.period) rows.push([heading.period]);
  for (const n of heading.notes ?? []) rows.push([n]);
  return { rows, count: rows.length };
}

// ─── Excel ────────────────────────────────────────────────────────────────

/** Write an array-of-arrays workbook and download it. */
export function exportExcelAoa(
  filename: string,
  sheetName: string,
  aoa: any[][],
  colCount?: number,
) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable column widths (cap at 40, min 8) based on the longest value.
  const n = colCount ?? Math.max(...aoa.map((r) => r.length));
  const widths: Array<{ wch: number }> = [];
  for (let c = 0; c < n; c++) {
    let w = 8;
    for (const r of aoa) {
      const cell = r[c];
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > w) w = Math.min(48, len + 2);
    }
    widths.push({ wch: w });
  }
  ws["!cols"] = widths;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/**
 * Excel for a tabular report: company-name header, report title, period line,
 * then the visible columns with formatted values (money exported as numbers).
 */
export function exportExcelReport(
  reportTitle: string,
  heading: ExportHeading,
  columns: ReportColumn[],
  rows: ExportRow[],
) {
  const head = headingRows(heading, columns.length);
  const aoa: any[][] = [...head.rows];
  aoa.push([]);
  aoa.push(columns.map((c) => c.label));
  for (const r of rows) aoa.push(columns.map((c) => exportValue(c, r)));
  exportExcelAoa(slugify(reportTitle), reportTitle, aoa, columns.length);
  return `${slugify(reportTitle)}-${stamp()}.xlsx`;
}

// ─── PDF (print view) ─────────────────────────────────────────────────────

const PAGE_CSS = `
  @page { size: A4 landscape; margin: 14mm 12mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; }
  .report-head { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 14px; }
  .monogram { width: 42px; height: 42px; border-radius: 10px; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; letter-spacing: 1px; }
  .head-titles { flex: 1; min-width: 0; }
  .company { font-size: 15px; font-weight: 700; letter-spacing: .02em; }
  .doc-title { font-size: 21px; font-weight: 800; margin-top: 2px; }
  .doc-period { font-size: 11px; color: #64748b; margin-top: 2px; }
  .meta-stamp { font-size: 10px; color: #94a3b8; text-align: right; white-space: pre-line; }
  table.data { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.data th { background: #1e293b; color: #fff; text-align: left; padding: 5px 6px; font-weight: 600; white-space: nowrap; }
  table.data th.num, table.data td.num { text-align: right; }
  table.data td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  table.data tr:nth-child(even) td { background: #f8fafc; }
  table.data tfoot td { font-weight: 700; border-top: 2px solid #0f172a; background: #f1f5f9 !important; }
  .rep-footer { margin-top: 14px; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  .print-note { font-size: 9.5px; color: #64748b; margin: 4px 0 10px; }
  .scroll-x { width: 100%; overflow: hidden; }
`;

function initials(name?: string) {
  return (
    (name ?? "R")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "R"
  );
}

/** Open the print dialog with the supplied, self-contained HTML body. */
export async function printPdfHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    throw new Error("Could not open the print view");
  }
  const doc = win.document;
  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (doc.readyState === "complete" || Date.now() - t0 > 4000) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });

  win.focus();
  win.print();
  // Give the print dialog time before removing the frame.
  setTimeout(() => iframe.remove(), 60_000);
}

export interface PrintTableData {
  columns: ReportColumn[];
  rows: ExportRow[];
  /** Optional footer aggregates (label + value per footer cell). */
  footer?: Array<{ label: string; value: string | number }>;
}

function tableBodyHtml(data: PrintTableData, truncate: number) {
  const trunc = (s: string) => (s.length > truncate ? `${s.slice(0, truncate - 1)}…` : s);
  const head = data.columns
    .map(
      (c) =>
        `<th class="${c.kind === "money" || c.kind === "int" || c.kind === "days" ? "num" : ""}">${esc(c.label)}</th>`,
    )
    .join("");
  const body = data.rows
    .map(
      (r) =>
        `<tr>${data.columns
          .map((c) => {
            const cls =
              c.kind === "money" || c.kind === "int" || c.kind === "days" ? ' class="num"' : "";
            return `<td${cls}>${esc(trunc(formatCell(c, r)))}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const foot = data.footer
    ? `<tfoot><tr>${data.columns
        .map((c, i) => {
          const f = data.footer!.find((x) => x.label === c.label);
          if (f) {
            const cls =
              c.kind === "money" || c.kind === "int" || c.kind === "days" ? ' class="num"' : "";
            return `<td${cls}>${esc(String(f.value))}</td>`;
          }
          return i === 0 ? "<td>Total</td>" : "<td></td>";
        })
        .join("")}</tr></tfoot>`
    : "";
  return { head, body, foot };
}

function esc(s: string | number) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build a full printable page (landscape) around arbitrary body content. */
export function buildPrintPage(opts: {
  heading: ExportHeading;
  body: string;
  footerNote?: string;
  orientation?: "landscape" | "portrait";
}) {
  const { heading, footerNote } = opts;
  const orientation = opts.orientation ?? "landscape";
  const monogram = initials(heading.companyName);
  const when = `Generated ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${PAGE_CSS.replace("@page { size: A4 landscape; margin: 14mm 12mm 14mm 12mm; }", `@page { size: A4 ${orientation}; margin: 12mm 10mm 12mm 10mm; }`)}</style>
</head><body>
<div class="report-head">
  <div class="monogram">${monogram}</div>
  <div class="head-titles">
    <div class="company">${esc(heading.companyName ?? "Report")}</div>
    <div class="doc-title">${esc(heading.title)}</div>
    <div class="doc-period">${esc(heading.period ?? "")}${(heading.notes ?? []).length ? `<br/>${heading.notes!.map((n) => esc(n)).join(" · ")}` : ""}</div>
  </div>
  <div class="meta-stamp">${esc(when)}</div>
</div>
${opts.body}
<div class="rep-footer"><span>${esc(heading.title)}</span><span>${esc(footerNote ?? "")}</span><span>${heading.companyName ? esc(heading.companyName) : ""}</span></div>
</body></html>`;
}

/** PDF (print view) for a tabular report with the app header + footer. */
export async function printPdfReport(
  reportTitle: string,
  heading: ExportHeading,
  columns: ReportColumn[],
  rows: ExportRow[],
  footer?: Array<{ label: string; value: string | number }>,
) {
  if (rows.length === 0) throw new Error("Nothing to export for the current filters");
  const t = tableBodyHtml({ columns, rows, footer }, 60);
  const notes = heading.notes ?? [];
  if (rows.length) notes.push(`${rows.length} rows`);
  const html = buildPrintPage({
    heading: { ...heading, notes },
    body: `
      <div class="print-note">${esc(notes.join(" · "))}</div>
      <div class="scroll-x"><table class="data"><thead><tr>${t.head}</tr></thead><tbody>${t.body}</tbody>${t.foot}</table></div>`,
    footerNote: `Period: ${heading.period ?? ""}`,
  });
  await printPdfHtml(html);
}

// ─── Shared statement print helpers (P&L / Balance sheet) ─────────────────

export interface StatementRow {
  label: string;
  amount: string | number;
  indent?: number;
  bold?: boolean;
  /** Section header rows (no amount). */
  section?: boolean;
  /** Render amount in red for negatives in accounting style. */
  accountStyle?: boolean;
}

export function buildStatementRowsHtml(rows: StatementRow[], money = false) {
  return rows
    .map((r) => {
      const style: string[] = [];
      if (r.indent) style.push(`padding-left:${16 + (r.indent ?? 0) * 22}px`);
      if (r.bold) style.push("font-weight:700");
      if (r.section)
        style.push(
          "font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:9.5px;border-top:2px solid #334155;background:#f1f5f9",
        );
      const amt =
        r.amount === "" || r.amount === null || r.amount === undefined
          ? ""
          : money
            ? r.accountStyle
              ? fmtAccountingText(Number(r.amount))
              : `₹${Number(r.amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
            : String(r.amount);
      const right = r.amount !== "" && r.amount !== null && r.amount !== undefined;
      return `<tr><td style="${style.join(";")}">${esc(r.label)}</td><td style="${right ? "text-align:right;font-variant-numeric:tabular-nums;" : ""}${r.bold ? "font-weight:700;" : ""}">${esc(String(amt))}</td></tr>`;
    })
    .join("");
}

export function fmtAccountingText(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  return n < -0.005 ? `(${abs})` : abs;
}

export const fmtDateShort = (d?: string | null) => (d ? fmtDate(d) : "—");
