import { tag, tallyDate } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { round2 } from "../../../lib/gst.js";

export interface ReceiptBuildContext {
  config: TallyConfig;
  debtorsById: Map<string, any>;
  VoucherBuilder: any;
}

export function serializeReceiptVoucher(receipt: any, ctx: ReceiptBuildContext, invoicesById: Map<string, any>) {
  const config = ctx.config;
  const errors: string[] = [];
  const warnings: string[] = [];
  const inv = receipt.invoiceId ? invoicesById.get(receipt.invoiceId) : null;
  const debtor = inv ? ctx.debtorsById.get(inv.debtorId) : null;
  const party =
    debtor?.name ||
    receipt.customerName ||
    receipt.customer_name ||
    inv?.customerName ||
    inv?.consigneeName ||
    null;
  const amount = round2(Number(receipt.amount) || 0);

  if (!config.mappings.bankLedger) errors.push("Bank ledger is not configured.");
  if (!party) errors.push("Receipt is not linked to an invoice / customer ledger.");
  if (!(amount > 0)) errors.push("Receipt amount must be positive.");

  const b = new ctx.VoucherBuilder();
  // Bank entry: positive, ISDEEMEDPOSITIVE=Yes, amount = +amount
  b.add({ ledger: config.mappings.bankLedger || "UNKNOWN", amount, positive: true });

  // Customer entry: negative, ISDEEMEDPOSITIVE=No, amount = -amount, bill = Agst Ref
  const isAdvance = receipt.isAdvance || receipt.paymentType === "advance";
  const refName = inv?.invoiceNumber || receipt.invoiceNumber || `RCT-${receipt.id.slice(0, 8)}`;
  b.add({
    ledger: party || "UNKNOWN",
    amount: -amount,
    positive: false,
    isParty: true,
    bill: { name: refName, amount: -amount, type: isAdvance ? "Advance" : "Agst Ref" },
  });

  if (receipt.collectionAccount) {
    warnings.push(`Collection account "${receipt.collectionAccount}" was noted in narration; configured bank ledger was used.`);
  }

  const body = b.finish(config.mappings.roundOffLedger, `Receipt ${receipt.id}`, { errors, warnings });
  const docRef = receipt.receiptNumber || `RCT-${receipt.id.slice(0, 8)}`;

  const parts = [
    tag("DATE", tallyDate(receipt.receiptDate || receipt.submittedAt)),
    tag("VOUCHERTYPENAME", "Receipt"),
    tag("PERSISTEDVIEW", "Accounting Voucher View"),
    tag("REFERENCE", docRef),
    tag("NARRATION", `Receipt against ${inv?.invoiceNumber || receipt.invoiceNumber || ""}${
      receipt.utr ? ` | UTR: ${receipt.utr}` : ""
    }`),
    tag("PARTYLEDGERNAME", party || "UNKNOWN"),
    body,
  ];

  const xml = `<VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">${parts.join("")}</VOUCHER>`;

  return {
    xml,
    errors,
    warnings,
    party,
    amount,
    docNumber: inv?.invoiceNumber || receipt.invoiceNumber || docRef,
    date: receipt.receiptDate || receipt.submittedAt,
  };
}

