import { list, tag, num, tallyDate, esc } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { round2 } from "../../../lib/gst.js";

export interface PurchaseBuildContext {
  config: TallyConfig;
  suppliersById: Map<string, any>;
  productsById: Map<string, any>;
  partyStateForPurchase: (pi: any) => string | null;
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

export function serializePurchaseVoucher(pi: any, ctx: PurchaseBuildContext) {
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
  const lines: any[] = pi.lines || [];
  const supplierState = ctx.partyStateForPurchase(pi);
  const intra = ctx.normState(supplierState) === ctx.normState(config.homeState) || !supplierState;
  const ut = ctx.isUnionTerritory(config.homeState);
  const heads = ctx.gstHeadNames(config, intra, ut, "input");

  if (!party) errors.push("Supplier ledger name is missing (vendor not found).");
  if (!supplier && (pi.vendorId || pi.billToSupplierId)) {
    errors.push("Referenced master missing — supplier ledger.");
  }
  if (!lines.length) errors.push("Purchase invoice has no line items.");
  if (!config.mappings.purchaseLedger) errors.push("Purchase ledger is not configured.");
  if (!config.godownName) errors.push("Tally godown / warehouse is not configured.");

  const b = new ctx.VoucherBuilder();
  let taxableTotal = 0;
  let gstTotal = 0;
  let grandTotal = Number(pi.grandTotal) || 0;
  const freight = round2(Number(pi.freight) || 0);
  const byRate = new Map<number, { taxable: number; gst: number }>();
  const lineMode = ctx.detectLineMode(lines, {
    taxable: pi.subtotal,
    gst: pi.gstTotal,
    grandTotal: pi.grandTotal ?? pi.amount,
  });

  for (const line of lines) {
    const qtyValue = Number(line.invoiceQty) || Number(line.quantity) || 0;
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

    const rateDetails = intra
      ? [
          { head: "CGST", rate: rateValue / 2 },
          { head: ut ? "SGST/UTGST" : "SGST/UTGST", rate: rateValue / 2 },
        ]
      : [{ head: "IGST", rate: rateValue }];

    b.addInventory({
      stockItem,
      hsn: product?.hsnCode || line.hsnCode || null,
      hsnDescription: line.description || product?.description || stockItem,
      amount: -split.taxableValue,
      quantity: qtyValue,
      unit,
      rateValue: round2(split.taxableValue / qtyValue),
      inclRateValue: round2(split.total / qtyValue),
      positive: true,
      godown: config.godownName,
      batch: config.batchName || "Primary Batch",
      accountingLedger: config.mappings.purchaseLedger,
      rateDetails,
      taxable: rateValue > 0,
    });
  }

  if (!grandTotal) grandTotal = round2(taxableTotal + gstTotal + freight);
  if (Math.abs(round2(taxableTotal + gstTotal + freight) - grandTotal) > 0.05) {
    errors.push(
      `Purchase totals do not reconcile: lines net+GST+freight ${round2(taxableTotal + gstTotal + freight).toFixed(
        2,
      )} vs grand total ${grandTotal.toFixed(2)}.`,
    );
  }

  // Supplier ledger entry (positive grandTotal in Purchase voucher)
  b.add({
    ledger: party || "UNKNOWN",
    amount: grandTotal,
    positive: false,
    isParty: true,
    bill: { name: pi.invoiceNumber, amount: grandTotal, type: "New Ref" },
  });

  // GST input entries (negative amount, deemed positive)
  for (const [rateValue, bucket] of byRate) {
    if (bucket.gst <= 0) continue;
    for (const head of ctx.splitAcrossHeads(bucket.gst, heads)) {
      if (!head.ledger) {
        errors.push(`No ${head.head} input ledger is configured.`);
        continue;
      }
      b.add({
        ledger: head.ledger,
        amount: -head.amount,
        positive: true,
        vatExpAmount: true,
        extra:
          list("RATEOFINVOICETAX", tag("RATEOFINVOICETAX", num(rateValue, 2).replace(/\.00$/, ""))) +
          tag("ROUNDTYPE", "Normal Rounding") +
          tag("ROUNDLIMIT", "1"),
      });
    }
  }

  if (freight > 0) {
    if (!config.mappings.freightLedger) errors.push("Purchase invoice has freight but no freight ledger is configured.");
    else b.add({ ledger: config.mappings.freightLedger, amount: -freight, positive: true });
  }

  const body = b.finish(config.mappings.roundOffLedger, `Purchase ${pi.invoiceNumber}`, { errors, warnings });
  const supplierAddress = supplier?.addressLine || pi.billToAddress || null;

  const parts = [
    tag("DATE", tallyDate(pi.issueDate)),
    tag("EFFECTIVEDATE", tallyDate(pi.issueDate)),
    tag("VOUCHERTYPENAME", "Purchase"),
    tag("VOUCHERNUMBER", pi.invoiceNumber),
    tag("PERSISTEDVIEW", "Invoice Voucher View"),
    tag("VCHENTRYMODE", "Item Invoice"),
    tag("ISINVOICE", "Yes"),
    tag("REFERENCE", pi.invoiceNumber),
    tag("NARRATION", `WhizUnik Ref: ${pi.invoiceNumber}${pi.poNumber ? ` | PO: ${pi.poNumber}` : ""}`),
    tag("PARTYLEDGERNAME", party || "UNKNOWN"),
    tag("PARTYMAILINGNAME", party || "UNKNOWN"),
    supplierAddress
      ? list("ADDRESS", tag("ADDRESS", supplierAddress) + (supplier?.city ? tag("ADDRESS", supplier.city) : "") + tag("ADDRESS", "India"))
      : list("ADDRESS", tag("ADDRESS", "India")),
    tag("BASICBUYERNAME", config.companyName),
    tag("CONSIGNEEMAILINGNAME", config.companyName),
    tag("CONSIGNEECOUNTRYNAME", "India"),
    body,
  ];

  const xml = `<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">${parts.join("")}</VOUCHER>`;

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

