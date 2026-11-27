import { ledgerEntry, inventoryEntry, list, tag, num, tallyDate, esc } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { round2 } from "../../../lib/gst.js";

export interface SalesBuildContext {
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

export function serializeSalesVoucher(inv: any, ctx: SalesBuildContext) {
  const config = ctx.config;
  const errors: string[] = [];
  const warnings: string[] = [];
  const debtor = ctx.debtorsById.get(inv.debtorId);
  const party =
    (debtor?.name || inv.customerName ||
    inv.customer_name ||
    inv.consigneeName ||
    inv.billToName ||
    null)?.toString().replace(/\s+/g, " ").trim();
  const lines: any[] = inv.lines || inv.lineItems || [];
  const partyState = ctx.partyStateForInvoice(inv);
  const intra = ctx.normState(partyState) === ctx.normState(config.homeState) || !partyState;
  const ut = ctx.isUnionTerritory(config.homeState);
  const heads = ctx.gstHeadNames(config, intra, ut, "output");

  if (!party) errors.push("Customer ledger name is missing (debtor not found).");
  if (!debtor && inv.debtorId) errors.push("Referenced master missing — customer ledger.");
  if (!lines.length) errors.push("Invoice has no line items.");
  if (!config.mappings.salesLedger) errors.push("Sales ledger is not configured.");
  if (!config.godownName) errors.push("Tally godown / warehouse is not configured.");

  const b = new ctx.VoucherBuilder();
  let taxableTotal = 0;
  let gstTotal = 0;
  let grandTotal = Number(inv.grandTotal) || 0;
  const freight = round2(Number(inv.freight) || 0);
  const byRate = new Map<number, { taxable: number; gst: number }>();
  const lineMode = ctx.detectLineMode(lines, {
    taxable: inv.subtotalGoods ?? inv.subtotal,
    gst: inv.gstTotal ?? inv.taxAmount,
    grandTotal: inv.grandTotal ?? inv.amount,
  });

  for (const line of lines) {
    const qtyValue = Number(line.quantity) || 0;
    if (!(qtyValue > 0)) {
      errors.push(`Line "${line.name || line.sku || "item"}" has no quantity.`);
      continue;
    }
    const lineAmount = ctx.invoiceLineAmount(line);
    if (!(lineAmount > 0)) {
      errors.push(`Line "${line.name || line.sku || "item"}" has no amount.`);
      continue;
    }
    const rateValue = Number(line.gstRate) || 0;
    const split = ctx.splitLine(lineAmount, rateValue, lineMode);
    taxableTotal = round2(taxableTotal + split.taxableValue);
    gstTotal = round2(gstTotal + split.gstAmount);
    const bucket = byRate.get(rateValue) || { taxable: 0, gst: 0 };
    bucket.taxable = round2(bucket.taxable + split.taxableValue);
    bucket.gst = round2(bucket.gst + split.gstAmount);
    byRate.set(rateValue, bucket);

    const product = ctx.productsById.get(line.productId);
    const stockItem = product?.name
      ? String(product.name).replace(/\s+/g, " ").trim()
      : String(line.name || line.sku || "").replace(/\s+/g, " ").trim();
    if (!product) {
      errors.push(`Referenced master missing — stock item "${line.name || line.sku || "unknown"}".`);
    } else if (!stockItem) {
      errors.push("SKU name is missing.");
    }
    if (rateValue > 0 && !(product?.hsnCode || line.hsnCode)) {
      errors.push(`HSN code is missing for stock item "${stockItem || line.name || line.sku || "unknown"}".`);
    }
    if (!line.unit && !product?.unitOfMeasure) {
      errors.push(`Unit of measure is missing for stock item "${stockItem || line.name || "unknown"}".`);
    }
    const unit = ctx.unitFor(line.unit || product?.unitOfMeasure, config.defaultUnit);
    const exUnit = round2(split.taxableValue / qtyValue);

    // Rate details for intra-state: CGST (half) + SGST/UTGST (half); for inter-state: IGST (full)
    const rateDetails = intra
      ? [
          { head: "CGST", rate: rateValue / 2 },
          { head: ut ? "SGST/UTGST" : "SGST/UTGST", rate: rateValue / 2 },
        ]
      : [{ head: "IGST", rate: rateValue }];

    b.addInventory({
      stockItem,
      hsn: line.hsnCode || product?.hsnCode || null,
      amount: split.taxableValue,
      quantity: qtyValue,
      unit,
      rateValue: exUnit,
      inclRateValue: round2(split.total / qtyValue),
      positive: false,
      godown: config.godownName,
      batch: config.batchName || "Primary Batch",
      accountingLedger: config.mappings.salesLedger,
      rateDetails,
      taxable: rateValue > 0,
    });
  }

  if (!grandTotal) grandTotal = round2(taxableTotal + gstTotal + freight);
  if (Math.abs(round2(taxableTotal + gstTotal + freight) - grandTotal) > 0.05) {
    errors.push(
      `Invoice totals do not reconcile: lines net+GST+freight ${round2(taxableTotal + gstTotal + freight).toFixed(
        2,
      )} vs grand total ${grandTotal.toFixed(2)}.`,
    );
  }

  // Customer ledger entry (negative grandTotal)
  b.add({
    ledger: party || "UNKNOWN",
    amount: -grandTotal,
    positive: true,
    isParty: true,
    isLastDeemedPositive: true,
    bill: { name: inv.invoiceNumber, amount: -grandTotal, type: "New Ref" },
  });

  // GST output entries
  for (const [rateValue, bucket] of byRate) {
    if (bucket.gst <= 0) continue;
    for (const head of ctx.splitAcrossHeads(bucket.gst, heads)) {
      if (!head.ledger) {
        errors.push(`No ${head.head} output ledger is configured.`);
        continue;
      }
      b.add({
        ledger: head.ledger,
        amount: head.amount,
        positive: false,
        vatExpAmount: true,
        extra:
          list("RATEOFINVOICETAX", tag("RATEOFINVOICETAX", num(rateValue, 2).replace(/\.00$/, ""))) +
          tag("ROUNDTYPE", "Normal Rounding") +
          tag("ROUNDLIMIT", "1"),
      });
    }
  }

  // Freight entry if applicable
  if (freight > 0) {
    if (!config.mappings.freightLedger) {
      errors.push("Invoice has freight but no freight ledger is configured.");
    } else {
      b.add({ ledger: config.mappings.freightLedger, amount: freight, positive: false });
    }
  }

  const body = b.finish(config.mappings.roundOffLedger, `Invoice ${inv.invoiceNumber}`, { errors, warnings });
  const buyerAddress = inv.billingAddress || (debtor?.billingAddress ? debtor.billingAddress : null) || "";

  const parts = [
    tag("DATE", tallyDate(inv.issueDate)),
    tag("VCHSTATUSDATE", tallyDate(inv.issueDate)),
    tag("VOUCHERTYPENAME", "Sales"),
    tag("VOUCHERNUMBER", inv.invoiceNumber),
    tag("PERSISTEDVIEW", "Invoice Voucher View"),
    tag("ISINVOICE", "Yes"),
    tag("REFERENCE", inv.invoiceNumber),
    tag("NARRATION", `WhizUnik Ref: ${inv.invoiceNumber}${inv.goodsSalesOrderNumber ? ` | SO: ${inv.goodsSalesOrderNumber}` : ""}`),
    tag("PARTYLEDGERNAME", party || "UNKNOWN"),
    tag("BASICBUYERNAME", party || "UNKNOWN"),
    inv.buyerGstin || debtor?.gstin ? tag("PARTYGSTIN", inv.buyerGstin || debtor?.gstin) : "",
    partyState ? tag("PLACEOFSUPPLY", partyState) : "",
    tag("BASICBASEPARTYNAME", party || "UNKNOWN"),
    buyerAddress
      ? list("BASICBUYERADDRESS", tag("BASICBUYERADDRESS", buyerAddress))
      : "",
    body,
  ];

  const xml = `<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">${parts.join("")}</VOUCHER>`;

  return {
    xml,
    errors,
    warnings,
    party,
    grandTotal,
    taxableTotal,
    gstTotal,
  };
}

