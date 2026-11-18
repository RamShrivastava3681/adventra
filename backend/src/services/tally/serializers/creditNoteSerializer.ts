import { tag, tallyDate } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { round2 } from "../../../lib/gst.js";

export interface NoteBuildContext {
  config: TallyConfig;
  debtorsById: Map<string, any>;
  productsById: Map<string, any>;
  partyStateForInvoice: (inv: any) => string | null;
  normState: (s: string | null | undefined) => string;
  isUnionTerritory: (s: string | null | undefined) => boolean;
  gstHeadNames: (config: TallyConfig, intra: boolean, ut: boolean, direction: "output" | "input") => { head: string; ledger: string }[];
  splitAcrossHeads: (total: number, heads: { head: string; ledger: string }[]) => { head: string; ledger: string; amount: number }[];
  invoiceLineAmount: (line: any) => number;
  detectLineMode: (lines: any[], doc: any) => "inclusive" | "exclusive";
  splitLine: (amount: number, rate: number, mode: "inclusive" | "exclusive") => { taxableValue: number; gstAmount: number; total: number };
  unitFor: (val: string | null | undefined, fallback: string) => string;
  VoucherBuilder: any;
}

export function serializeCreditNoteVoucher(
  note: any,
  ctx: NoteBuildContext,
  invoicesById: Map<string, any>,
) {
  const config = ctx.config;
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceDoc = note.invoiceId ? invoicesById.get(note.invoiceId) : null;
  const debtor = sourceDoc ? ctx.debtorsById.get(sourceDoc.debtorId) : null;
  const party = String((debtor && debtor.name) || note.counterparty || "").replace(/\s+/g, " ").trim() || null;
  const amount = round2(Number(note.amount) || 0);

  const partyState = sourceDoc ? ctx.partyStateForInvoice(sourceDoc) : null;
  const intra = ctx.normState(partyState) === ctx.normState(config.homeState) || !partyState;
  const ut = ctx.isUnionTerritory(config.homeState);
  const heads = ctx.gstHeadNames(config, intra, ut, "output");
  const lines: any[] = note.lineItems || [];

  if (!party) errors.push("Customer ledger name is missing on credit note.");
  if (!sourceDoc) errors.push("Referenced bill missing — original invoice for credit note.");
  if (!note.appliedInvoiceNumber && !sourceDoc?.invoiceNumber) {
    errors.push("Credit note bill reference is missing.");
  }
  if (!(amount > 0)) errors.push("Credit note amount must be positive.");
  if (!config.mappings.salesLedger) errors.push("Sales ledger is not configured.");

  const b = new ctx.VoucherBuilder();
  let taxableTotal = 0;
  let gstTotal = 0;
  const lineMode = ctx.detectLineMode(lines, {
    taxable: note.subtotal,
    gst: note.taxAmount,
    grandTotal: note.amount,
  });

  if (lines.length) {
    for (const line of lines) {
      const qtyValue = Number(line.quantity) || 0;
      const lineAmount = ctx.invoiceLineAmount(line);
      if (!(qtyValue > 0) || !(lineAmount > 0)) {
        errors.push(`Credit note line "${line.name || line.sku || "item"}" has no quantity or amount.`);
        continue;
      }
      const rateValue = Number(line.gstRate) || 0;
      const split = ctx.splitLine(lineAmount, rateValue, lineMode);
      taxableTotal = round2(taxableTotal + split.taxableValue);
      gstTotal = round2(gstTotal + split.gstAmount);
      const product = ctx.productsById.get(line.productId);
      const stockItem = product?.name
        ? String(product.name).replace(/\s+/g, " ").trim()
        : String(line.name || "").replace(/\s+/g, " ").trim();
      if (!product) {
        errors.push(`Referenced master missing — stock item "${line.name || line.sku || "unknown"}".`);
      }
      if (!stockItem) errors.push("SKU name is missing.");
      const unit = ctx.unitFor(line.unit || product?.unitOfMeasure, config.defaultUnit);
      if (!line.unit && !product?.unitOfMeasure) {
        errors.push(`Unit of measure is missing for stock item "${stockItem}".`);
      }
      if (rateValue > 0 && !(line.hsnCode || product?.hsnCode)) {
        errors.push(`HSN code is missing for stock item "${stockItem}".`);
      }

      const rateDetails = intra
        ? [
            { head: "CGST", rate: rateValue / 2 },
            { head: ut ? "SGST/UTGST" : "SGST/UTGST", rate: rateValue / 2 },
          ]
        : [{ head: "IGST", rate: rateValue }];

      b.addInventory({
        stockItem,
        hsn: line.hsnCode || product?.hsnCode || null,
        amount: -split.taxableValue,
        quantity: qtyValue,
        unit,
        rateValue: round2(split.taxableValue / qtyValue),
        inclRateValue: round2(split.total / qtyValue),
        positive: true,
        godown: config.godownName,
        batch: config.batchName || "Primary Batch",
        accountingLedger: config.mappings.salesLedger,
        rateDetails,
        taxable: rateValue > 0,
      });
    }

    if (Math.abs(round2(taxableTotal + gstTotal) - amount) > 0.05) {
      errors.push(
        `Credit note lines net+GST ${round2(taxableTotal + gstTotal).toFixed(2)} do not reconcile with amount ${amount.toFixed(2)}.`,
      );
    }
  } else {
    const tax = round2(Number(note.taxAmount) || 0);
    const taxable = round2(Number(note.subtotal) || amount - tax);
    taxableTotal = taxable;
    gstTotal = tax;
    b.add({
      ledger: config.mappings.salesLedger,
      amount: -taxable,
      positive: true,
    });
  }

  // Customer ledger entry (credit note = credit customer, positive amount, deemed negative)
  b.add({
    ledger: party || "UNKNOWN",
    amount: amount,
    positive: false,
    isParty: true,
    bill: {
      name: note.appliedInvoiceNumber || sourceDoc?.invoiceNumber || note.noteNumber,
      amount: amount,
      type: "Agst Ref",
    },
  });

  // GST output entries (negative, deemed positive for credit note)
  for (const head of ctx.splitAcrossHeads(gstTotal, heads)) {
    if (head.amount <= 0) continue;
    if (!head.ledger) {
      errors.push(`No ${head.head} output ledger is configured.`);
      continue;
    }
    b.add({
      ledger: head.ledger,
      amount: -head.amount,
      positive: true,
      vatExpAmount: true,
    });
  }

  const body = b.finish(config.mappings.roundOffLedger, `Credit note ${note.noteNumber}`, { errors, warnings });

  const parts = [
    tag("DATE", tallyDate(note.noteDate)),
    tag("EFFECTIVEDATE", tallyDate(note.noteDate)),
    tag("VOUCHERTYPENAME", "Credit Note"),
    tag("PERSISTEDVIEW", "Invoice Voucher View"),
    tag("VCHENTRYMODE", "Item Invoice"),
    tag("ISINVOICE", "Yes"),
    tag("REFERENCE", note.noteNumber),
    tag("NARRATION", `Credit note against ${note.appliedInvoiceNumber || sourceDoc?.invoiceNumber || "original invoice"}${
      note.reason ? ` | ${note.reason}` : ""
    }`),
    tag("PARTYLEDGERNAME", party || "UNKNOWN"),
    tag("BASICBUYERNAME", party || "UNKNOWN"),
    body,
  ];

  const xml = `<VOUCHER VCHTYPE="Credit Note" ACTION="Create" OBJVIEW="Invoice Voucher View">${parts.join("")}</VOUCHER>`;

  return {
    xml,
    errors,
    warnings,
    party,
    amount,
    docNumber: note.noteNumber,
    date: note.noteDate,
  };
}

