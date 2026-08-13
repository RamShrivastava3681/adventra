import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
      // Hardening (GHSA-p6gq-j5cr-w38f): never allow message content to read
      // local files or fetch URLs — blocks SSRF / arbitrary file read via
      // user-influenced message fields.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!(config.smtp.host && config.smtp.user && config.smtp.pass && config.admin.email);
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

function wrapHTML(
  body: string,
  title = "📋 Invoice Due Reminder",
  opts?: { company?: string; footer?: string },
): string {
  const company = opts?.company || "Insight Factor";
  const footerText =
    opts?.footer ||
    "This is an automated reminder from Insight Factor. Please review and take appropriate action.";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:#1e293b;padding:24px 32px;">
        <table width="100%"><tr>
          <td><h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">${title}</h1></td>
          <td align="right">
            <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:6px;padding:4px 12px;font-size:11px;color:#cbd5e1;">${esc(company)}</span>
          </td>
        </tr></table>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:32px;">
        ${body}
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${esc(footerText)}</p>
        <p style="margin:0;font-size:11px;color:#94a3b8;">${config.smtp.user} · ${esc(company)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
}

function daysLabel(days: number): string {
  if (days === 0) return "Due today";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    pending: "#f59e0b",
    approved: "#10b981",
    paid: "#3b82f6",
    rejected: "#ef4444",
    disputed: "#8b5cf6",
    overdue: "#ef4444",
  };
  const color = colors[status] || "#64748b";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${color};">${status}</span>`;
}

function invoiceTableRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:5px 0;font-size:13px;color:#64748b;width:140px;vertical-align:top;border-bottom:1px solid #f1f5f9;">${label}</td>
    <td style="padding:5px 0;font-size:13px;color:#1e293b;font-weight:500;border-bottom:1px solid #f1f5f9;">${value}</td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Line items table helper
// ---------------------------------------------------------------------------

function renderLineItems(items: Array<{ description?: string; quantity?: number; unitCost?: number; amount?: number; productId?: string }> | undefined | null): string {
  if (!items || items.length === 0) return "";

  let rows = items.map((li, i) => {
    const desc = li.description || li.productId || `Item ${i + 1}`;
    const qty = li.quantity ?? 1;
    const unit = li.unitCost ?? 0;
    const amt = li.amount ?? (qty * unit);
    return `<tr>
      <td style="padding:6px 8px;font-size:12px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${desc}</td>
      <td style="padding:6px 8px;font-size:12px;color:#64748b;text-align:center;border-bottom:1px solid #f1f5f9;">${qty}</td>
      <td style="padding:6px 8px;font-size:12px;color:#64748b;text-align:right;border-bottom:1px solid #f1f5f9;">$${unit.toFixed(2)}</td>
      <td style="padding:6px 8px;font-size:12px;color:#1e293b;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;">$${amt.toFixed(2)}</td>
    </tr>`;
  }).join("");

  return `
    <div style="margin-top:20px;">
      <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:8px;">Line Items</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th style="padding:6px 8px;font-size:11px;font-weight:600;color:#64748b;text-align:left;border-bottom:2px solid #e2e8f0;text-transform:uppercase;letter-spacing:0.5px;">Description</th>
            <th style="padding:6px 8px;font-size:11px;font-weight:600;color:#64748b;text-align:center;border-bottom:2px solid #e2e8f0;text-transform:uppercase;letter-spacing:0.5px;">Qty</th>
            <th style="padding:6px 8px;font-size:11px;font-weight:600;color:#64748b;text-align:right;border-bottom:2px solid #e2e8f0;text-transform:uppercase;letter-spacing:0.5px;">Unit Price</th>
            <th style="padding:6px 8px;font-size:11px;font-weight:600;color:#64748b;text-align:right;border-bottom:2px solid #e2e8f0;text-transform:uppercase;letter-spacing:0.5px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// HTML escaping for user-influenced fields interpolated into templates
// ---------------------------------------------------------------------------

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Send admin reminder email (with full invoice details + debtor forward link)
// ---------------------------------------------------------------------------

export async function sendInvoiceReminder(params: {
  type: "sales" | "purchase";
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  subtotal: number | null;
  taxRate: number;
  taxAmount: number;
  dueDate: string;
  issueDate: string;
  status: string;
  clientName: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyEmail: string | null;
  lineItems: Array<{ description?: string; quantity?: number; unitCost?: number; amount?: number; productId?: string }> | undefined | null;
  notes: string | null;
  daysUntilDue: number;
  isOverdue: boolean;
  debtorReminderToken: string | null;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`  ⚠ Email not configured — skipping reminder for ${params.type} invoice ${params.invoiceNumber}`);
    return false;
  }

  const absDays = Math.abs(params.daysUntilDue);
  const overdueLabel = params.isOverdue ? "OVERDUE" : "UPCOMING";
  const subject = `[${overdueLabel}] ${params.type === "sales" ? "Sales" : "Purchase"} Invoice ${params.invoiceNumber} — ${daysLabel(params.daysUntilDue)}`;

  // Build debtor-forwarding link (only for sales invoices with a valid token)
  const forwardLink = params.type === "sales" && params.debtorReminderToken
    ? `${config.appUrl}/api/invoices/${params.invoiceId}/remind-debtor/${params.debtorReminderToken}`
    : null;

  const lineItemsHTML = renderLineItems(params.lineItems);

  const body = `
    <div style="margin-bottom:20px;">
      <div style="font-size:14px;color:#64748b;margin-bottom:4px;">${params.type === "sales" ? "SALES INVOICE" : "PURCHASE INVOICE"}</div>
      <div style="font-size:22px;font-weight:700;color:#1e293b;">${params.invoiceNumber}</div>
    </div>

    <div style="background:${params.isOverdue ? "#fef2f2" : "#fffbeb"};border-radius:8px;padding:12px 16px;margin-bottom:20px;border-left:4px solid ${params.isOverdue ? "#ef4444" : "#f59e0b"};">
      <div style="font-size:14px;font-weight:700;color:${params.isOverdue ? "#dc2626" : "#d97706"};">
        ${params.isOverdue ? "🔴" : "🟡"} ${daysLabel(params.daysUntilDue)}
      </div>
      ${params.isOverdue
        ? `<div style="font-size:12px;color:#ef4444;margin-top:4px;">This invoice requires immediate attention.</div>`
        : `<div style="font-size:12px;color:#d97706;margin-top:4px;">Keep this invoice on your radar.</div>`}
    </div>

    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${invoiceTableRow("Invoice #", params.invoiceNumber)}
      ${invoiceTableRow("Type", params.type === "sales" ? "Sales Invoice (AR)" : "Purchase Invoice (AP)")}
      ${invoiceTableRow("Issue date", params.issueDate || "—")}
      ${invoiceTableRow("Due date", params.dueDate)}
      ${invoiceTableRow("Status", statusBadge(params.status))}
      ${invoiceTableRow("Amount", `<strong>$${params.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`)}
      ${params.subtotal != null ? invoiceTableRow("Subtotal", `$${params.subtotal.toLocaleString()}`) : ""}
      ${params.taxRate > 0 ? invoiceTableRow("Tax", `${(params.taxRate * 100).toFixed(1)}% ($${params.taxAmount.toFixed(2)})`) : ""}
      ${invoiceTableRow(params.type === "sales" ? "Debtor" : "Vendor", params.counterpartyName)}
      ${params.counterpartyEmail ? invoiceTableRow("Contact email", params.counterpartyEmail) : ""}
      ${params.clientName ? invoiceTableRow("Client", params.clientName) : ""}
    </table>

    ${lineItemsHTML}

    ${params.notes ? `
    <div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
      <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Notes</div>
      <div style="font-size:13px;color:#475569;">${params.notes}</div>
    </div>` : ""}

    <!-- Suggested Action -->
    <div style="margin-top:24px;padding:16px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">
      <div style="font-size:12px;font-weight:600;color:#0369a1;margin-bottom:6px;">💡 Suggested Action</div>
      <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
        ${params.isOverdue
          ? `This invoice is <strong>${absDays} day${absDays === 1 ? "" : "s"} overdue</strong>. Contact ${params.counterpartyName} immediately regarding payment of <strong>$${params.amount.toLocaleString()}</strong>.`
          : `This invoice is due in <strong>${absDays} day${absDays === 1 ? "" : "s"}</strong> (${params.dueDate}). Ensure payment arrangements are in place for <strong>$${params.amount.toLocaleString()}</strong>.`}
      </p>
    </div>

    ${forwardLink ? `
    <!-- Forward to debtor -->
    <div style="margin-top:16px;text-align:center;">
      <a href="${forwardLink}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
        📨 Send Reminder to Debtor
      </a>
      <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">Click to forward this reminder to ${params.counterpartyName} (${params.counterpartyEmail || "no email on file"})</p>
    </div>` : ""}
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Insight Factor" <${config.smtp.user}>`,
      to: config.admin.email,
      subject,
      html: wrapHTML(body),
    });
    console.log(`  ✅ Reminder sent: ${subject} → ${config.admin.email}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to send reminder for ${params.invoiceNumber}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Send debtor reminder email (simpler version sent to debtor)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Submission notification emails (requests created / approved / rejected)
// ---------------------------------------------------------------------------

const SUBMISSION_TYPE_LABELS: Record<string, string> = {
  visit: "Visit Report",
  travel: "Travel Request",
  expense: "Expense Report",
  leave: "Leave Request",
};

function submissionFieldsHTML(data: Record<string, any>): string {
  const labels: Record<string, string> = {
    date: "Date", location: "Location", contactPerson: "Contact Person",
    purpose: "Purpose", notes: "Notes", fromDate: "From Date", toDate: "To Date",
    fromLocation: "From", toLocation: "To", amount: "Amount",
    category: "Category", description: "Description", reason: "Reason",
    leaveType: "Leave Type",
  };
  return Object.entries(data)
    .filter(([k]) => labels[k])
    .map(([k, v]) => {
      const val = k === "amount" ? `$${Number(v).toLocaleString()}` : String(v);
      return invoiceTableRow(labels[k], val);
    }).join("");
}

export async function sendSubmissionEmail(params: {
  type: "new_request" | "status_update";
  submissionType: string;
  submitterName: string;
  submitterEmail: string;
  recipientEmail: string;
  recipientName: string;
  status?: string;
  data: Record<string, any>;
  submissionId: string;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`  ⚠ Email not configured — skipping submission notification`);
    return false;
  }

  const typeLabel = SUBMISSION_TYPE_LABELS[params.submissionType] || params.submissionType;

  let subject: string;
  let body: string;

  if (params.type === "new_request") {
    subject = `[New Request] ${typeLabel} from ${params.submitterName}`;
    body = `
      <div style="margin-bottom:24px;">
        <div style="font-size:13px;color:#64748b;margin-bottom:4px;">NEW REQUEST</div>
        <div style="font-size:20px;font-weight:700;color:#1e293b;">${typeLabel}</div>
      </div>

      <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;">
        <strong>${params.submitterName}</strong> has submitted a new ${typeLabel.toLowerCase()} awaiting your review.
      </p>

      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${invoiceTableRow("Submitted by", params.submitterName)}
        ${invoiceTableRow("Submitter email", params.submitterEmail)}
        ${invoiceTableRow("Type", typeLabel)}
        ${invoiceTableRow("Submitted at", new Date().toLocaleString())}
        ${invoiceTableRow("Status", statusBadge("pending"))}
      </table>

      <div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Details</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;">
          ${submissionFieldsHTML(params.data)}
        </table>
      </div>

      <div style="margin-top:24px;text-align:center;">
        <a href="${config.appUrl}/app/requests" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
          📋 Review in Dashboard
        </a>
      </div>
    `;
  } else {
    const statusEmoji = params.status === "approved" ? "✅" : "❌";
    const statusColor = params.status === "approved" ? "#059669" : "#dc2626";
    subject = `[${params.status === "approved" ? "Approved" : "Rejected"}] ${typeLabel} — ${params.submitterName}`;
    body = `
      <div style="margin-bottom:24px;">
        <div style="font-size:13px;color:#64748b;margin-bottom:4px;">${params.status === "approved" ? "APPROVED" : "REJECTED"}</div>
        <div style="font-size:20px;font-weight:700;color:#1e293b;">${typeLabel}</div>
      </div>

      <div style="background:${params.status === "approved" ? "#ecfdf5" : "#fef2f2"};border-radius:8px;padding:16px;margin-bottom:20px;border-left:4px solid ${statusColor};">
        <div style="font-size:16px;font-weight:700;color:${statusColor};">
          ${statusEmoji} ${params.status === "approved" ? "Approved" : "Rejected"}
        </div>
        <div style="font-size:13px;color:#475569;margin-top:4px;">
          Your ${typeLabel.toLowerCase()} has been ${params.status === "approved" ? "approved" : "rejected"} by <strong>${params.recipientName}</strong>.
        </div>
      </div>

      <table cellpadding="0" cellspacing="0" style="width:100%;">
        ${invoiceTableRow("Type", typeLabel)}
        ${invoiceTableRow("Status", statusBadge(params.status || "pending"))}
        ${invoiceTableRow("Reviewed by", params.recipientName)}
      </table>

      <div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Details</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;">
          ${submissionFieldsHTML(params.data)}
        </table>
      </div>
    `;
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Insight Factor" <${config.smtp.user}>`,
      to: params.recipientEmail,
      subject,
      html: wrapHTML(body),
    });
    console.log(`  ✅ Submission email sent: ${subject} → ${params.recipientEmail}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to send submission email:`, err);
    return false;
  }
}

export async function sendDebtorReminder(params: {
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  issueDate: string;
  counterpartyName: string;
  counterpartyEmail: string;
  daysUntilDue: number;
  isOverdue: boolean;
  lineItems: Array<{ description?: string; quantity?: number; unitCost?: number; amount?: number; productId?: string }> | undefined | null;
  notes: string | null;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`  ⚠ Email not configured — skipping debtor reminder for ${params.invoiceNumber}`);
    return false;
  }

  const absDays = Math.abs(params.daysUntilDue);
  const subject = `Payment Reminder: Invoice ${params.invoiceNumber} — ${daysLabel(params.daysUntilDue)}`;

  const lineItemsHTML = renderLineItems(params.lineItems);

  const body = `
    <div style="margin-bottom:24px;">
      <div style="font-size:13px;color:#64748b;margin-bottom:4px;">Payment Reminder</div>
      <div style="font-size:20px;font-weight:700;color:#1e293b;">Invoice ${params.invoiceNumber}</div>
    </div>

    <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;">
      Dear ${params.counterpartyName},<br><br>
      This is a friendly reminder regarding the following invoice:
    </p>

    <div style="background:${params.isOverdue ? "#fef2f2" : "#fffbeb"};border-radius:8px;padding:12px 16px;margin-bottom:20px;border-left:4px solid ${params.isOverdue ? "#ef4444" : "#f59e0b"};">
      <div style="font-size:14px;font-weight:700;color:${params.isOverdue ? "#dc2626" : "#d97706"};">
        ${params.isOverdue ? "🔴" : "🟡"} ${daysLabel(params.daysUntilDue)}
      </div>
    </div>

    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${invoiceTableRow("Invoice #", params.invoiceNumber)}
      ${invoiceTableRow("Issue date", params.issueDate || "—")}
      ${invoiceTableRow("Due date", params.dueDate)}
      ${invoiceTableRow("Amount", `<strong>$${params.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`)}
    </table>

    ${lineItemsHTML}

    ${params.notes ? `
    <div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
      <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Notes</div>
      <div style="font-size:13px;color:#475569;">${params.notes}</div>
    </div>` : ""}

    <div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;">
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
        ${params.isOverdue
          ? `We kindly request that you arrange payment of <strong>$${params.amount.toLocaleString()}</strong> at your earliest convenience. If you have any questions, please contact us immediately.`
          : `We kindly request that you arrange payment of <strong>$${params.amount.toLocaleString()}</strong> by <strong>${params.dueDate}</strong>. Please let us know if you have any questions.`}
      </p>
    </div>

    <p style="margin-top:24px;font-size:12px;color:#94a3b8;">Thank you for your prompt attention to this matter.</p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Insight Factor" <${config.smtp.user}>`,
      to: params.counterpartyEmail,
      subject,
      html: wrapHTML(body),
    });
    console.log(`  ✅ Debtor reminder sent: ${params.invoiceNumber} → ${params.counterpartyEmail}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to send debtor reminder for ${params.invoiceNumber}:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Quotation / Sales Order PDF approval email (sent to the debtor)
// ---------------------------------------------------------------------------

/**
 * Email a quotation or sales order PDF to the debtor with Approve / Reject
 * buttons. The debtor's decision is recorded via the public approval page
 * (linked by a one-time token) and reflected back in the app tabs.
 */
// ---------------------------------------------------------------------------
// NOA email (sent to the buyer/debtor with the invoice PDF attached)
// ---------------------------------------------------------------------------

/**
 * Email the Notice of Assignment to the debtor (buyer). The invoice PDF is
 * attached so the buyer can verify the details directly, and the link opens
 * the public NOA page where they can accept / reject / comment.
 */
export async function sendInvoiceNoaEmail(params: {
  invoiceNumber: string;
  amount: number;
  dueDate: string | null;
  issueDate: string | null;
  debtorName: string;
  debtorEmail: string;
  companyName: string;
  noaUrl: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`  ⚠ Email not configured — skipping NOA email for invoice ${params.invoiceNumber}`);
    return false;
  }

  const total = params.amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const safe = {
    number: esc(params.invoiceNumber),
    companyName: esc(params.companyName),
    debtorName: esc(params.debtorName),
  };
  const subject = `Notice of Assignment — Invoice ${safe.number}`;

  const body = `
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;color:#64748b;margin-bottom:4px;">NOTICE OF ASSIGNMENT</div>
      <div style="font-size:22px;font-weight:700;color:#1e293b;">Invoice ${safe.number}</div>
    </div>

    <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;">
      Dear ${safe.debtorName},<br><br>
      Please be advised that <strong>${safe.companyName}</strong> has assigned the receivables
      under the invoice below to a factoring facility. Payment, when due, should be remitted
      to the assignee. Kindly verify the invoice details and confirm your acknowledgement
      using the link below — a PDF copy of the invoice is attached to this email.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${invoiceTableRow("Invoice #", safe.number)}
      ${invoiceTableRow("Issue date", params.issueDate || "—")}
      ${invoiceTableRow("Due date", params.dueDate || "—")}
      ${invoiceTableRow("Amount", `<strong>$${total}</strong>`)}
      ${invoiceTableRow("Assigned by", safe.companyName)}
    </table>

    <div style="margin-top:24px;padding:16px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#0369a1;">
        ✅ Please verify and confirm this assignment:
      </p>
      <div style="text-align:center;margin-top:12px;">
        <a href="${params.noaUrl}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          🔗 Verify Invoice
        </a>
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:#64748b;">
        This link opens a secure page where you can accept, reject, or add comments.
      </p>
    </div>

    <p style="margin-top:24px;font-size:12px;color:#94a3b8;">
      If you have any questions, please contact ${safe.companyName} directly.
    </p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${params.companyName}" <${config.smtp.user}>`,
      to: params.debtorEmail,
      subject,
      html: wrapHTML(
        body,
        `🔖 Notice of Assignment · Invoice ${safe.number}`,
        {
          company: params.companyName,
          footer: `This is a Notice of Assignment from ${params.companyName}. Please verify the attached invoice and confirm your acknowledgement.`,
        },
      ),
      attachments: [
        {
          filename: params.pdfFilename,
          content: params.pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
    console.log(`  ✅ NOA email sent: ${params.invoiceNumber} → ${params.debtorEmail}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to send NOA email for ${params.invoiceNumber}:`, err);
    return false;
  }
}

export async function sendDocumentApprovalEmail(params: {
  kind: "quotation" | "sales_order" | "purchase_order";
  number: string;
  grandTotal: number;
  validUntil: string | null;
  customerName: string;
  customerEmail: string;
  companyName: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
  approvalUrl: string;
}): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.log(`  ⚠ Email not configured — skipping approval email for ${params.number}`);
    return false;
  }

  const kindLabel =
    params.kind === "quotation"
      ? "Quotation"
      : params.kind === "purchase_order"
        ? "Purchase Order"
        : "Sales Order";
  const subject = `${kindLabel} ${params.number} from ${params.companyName} — please review and approve`;
  const total = params.grandTotal.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const validLabel = params.kind === "quotation" ? "Valid until" : "Expected delivery";
  const recipientLabel = params.kind === "purchase_order" ? "Supplier" : "Customer";
  const safe = {
    number: esc(params.number),
    companyName: esc(params.companyName),
    customerName: esc(params.customerName),
  };

  const body = `
    <div style="margin-bottom:20px;">
      <div style="font-size:13px;color:#64748b;margin-bottom:4px;">${esc(kindLabel.toUpperCase())} FOR YOUR APPROVAL</div>
      <div style="font-size:22px;font-weight:700;color:#1e293b;">${safe.number}</div>
    </div>

    <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;">
      Dear ${safe.customerName},<br><br>
      Please find attached the ${esc(kindLabel.toLowerCase())} from <strong>${safe.companyName}</strong>.
      Review the details and confirm your acceptance — a PDF copy is attached to this email.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;">
      ${invoiceTableRow(kindLabel + " #", safe.number)}
      ${invoiceTableRow("Amount (grand total)", `<strong>$${total}</strong>`)}
      ${params.validUntil ? invoiceTableRow(validLabel, params.validUntil) : ""}
      ${invoiceTableRow(recipientLabel, safe.customerName)}
      ${invoiceTableRow("Issued by", safe.companyName)}
    </table>

    <div style="margin-top:24px;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#15803d;">
        ✅ Please review the attached PDF and confirm:
      </p>
      <div style="text-align:center;margin-top:12px;">
        <a href="${params.approvalUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
          ✅ Approve ${kindLabel}
        </a>
        <a href="${params.approvalUrl}" style="display:inline-block;background:#ffffff;color:#dc2626;text-decoration:none;padding:11px 26px;border-radius:8px;font-size:14px;font-weight:600;border:2px solid #fca5a5;margin-left:8px;">
          ✕ Reject
        </a>
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:#64748b;">
        Both buttons open a secure page where you can review the document and approve or reject it.
      </p>
    </div>

    <p style="margin-top:24px;font-size:12px;color:#94a3b8;">
      If you have any questions, please contact ${params.companyName} directly.
    </p>
  `;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${params.companyName}" <${config.smtp.user}>`,
      to: params.customerEmail,
      subject,
      html: wrapHTML(body, `📄 ${kindLabel} for approval`),
      attachments: [
        {
          filename: params.pdfFilename,
          content: params.pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
    console.log(`  ✅ Approval email sent: ${params.number} → ${params.customerEmail}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to send approval email for ${params.number}:`, err);
    return false;
  }
}
