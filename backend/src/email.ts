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

function wrapHTML(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:#1e293b;padding:24px 32px;">
        <table width="100%"><tr>
          <td><h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">📋 Invoice Due Reminder</h1></td>
          <td align="right">
            <span style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:6px;padding:4px 12px;font-size:11px;color:#cbd5e1;">Insight Factor</span>
          </td>
        </tr></table>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:32px;">
        ${body}
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">This is an automated reminder from Insight Factor. Please review and take appropriate action.</p>
        <p style="margin:0;font-size:11px;color:#94a3b8;">${config.smtp.user} · Insight Factor</p>
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
