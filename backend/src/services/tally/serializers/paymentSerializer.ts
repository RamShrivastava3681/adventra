import { tag, tallyDate } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { round2 } from "../../../lib/gst.js";

export interface PaymentBuildContext {
  config: TallyConfig;
  suppliersById: Map<string, any>;
  VoucherBuilder: any;
}

export function serializePaymentVoucher(pi: any, ctx: PaymentBuildContext) {
  const config = ctx.config;
  const errors: string[] = [];
  const warnings: string[] = [];
  const supplier = ctx.suppliersById.get(pi.vendorId) || ctx.suppliersById.get(pi.billToSupplierId);
  const party =
    (pi.supplierName ||
    supplier?.companyName ||
    supplier?.name ||
    pi.billToName ||
    pi.vendorName ||
    null)?.toString().replace(/\s+/g, " ").trim();
  const amount = round2(Number(pi.amountPaid) || 0);

  if (!config.mappings.bankLedger) errors.push("Bank ledger is not configured.");
  if (!party) errors.push("Supplier ledger name is missing (vendor not found).");
  if (!supplier && (pi.vendorId || pi.billToSupplierId)) {
    errors.push("Referenced master missing — supplier ledger.");
  }
  if (!(amount > 0)) errors.push("Payment amount must be positive.");
  if (amount > (Number(pi.grandTotal) || 0) + 0.05) {
    warnings.push(`Payment (${amount.toFixed(2)}) exceeds purchase invoice total (${(Number(pi.grandTotal) || 0).toFixed(2)}).`);
  }

  const isAdvance = pi.isAdvance || pi.paymentType === "advance";
  const refName = pi.invoiceNumber || pi.id;

  const b = new ctx.VoucherBuilder();
  // Supplier entry: negative, deemed positive (debit supplier)
  b.add({
    ledger: party || "UNKNOWN",
    amount: -amount,
    positive: true,
    isParty: true,
    bill: { name: refName, amount: -amount, type: isAdvance ? "Advance" : "Agst Ref" },
  });

  // Bank entry: positive, deemed negative (credit bank)
  b.add({ ledger: config.mappings.bankLedger || "UNKNOWN", amount, positive: false });

  const body = b.finish(config.mappings.roundOffLedger, `Payment ${pi.invoiceNumber}`, { errors, warnings });
  const docRef = `PAY-${pi.invoiceNumber || pi.id.slice(0, 8)}`;

  const parts = [
    tag("DATE", tallyDate(pi.paidDate || pi.issueDate)),
    tag("VOUCHERTYPENAME", "Payment"),
    tag("PERSISTEDVIEW", "Accounting Voucher View"),
    tag("REFERENCE", docRef),
    tag("NARRATION", `Payment against ${pi.invoiceNumber}${pi.utr ? ` | UTR: ${pi.utr}` : ""}`),
    tag("PARTYLEDGERNAME", party || "UNKNOWN"),
    body,
  ];

  const xml = `<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">${parts.join("")}</VOUCHER>`;

  return {
    xml,
    errors,
    warnings,
    party,
    amount,
    docNumber: pi.invoiceNumber,
    date: pi.paidDate || pi.issueDate,
  };
}

