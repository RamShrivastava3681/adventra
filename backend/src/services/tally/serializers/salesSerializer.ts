import { ledgerEntry, inventoryEntry, list, tag, num, tallyDate, esc } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { round2 } from "../../../lib/gst.js";
import { isValidGstin, stateNameFromGstin } from "../states.js";

export interface SalesBuildContext {
  config: TallyConfig;
  debtorsById: Map<string, any>;
  productsById: Map<string, any>;
  partyStateForInvoice: (inv: any) => string | null;
  stateNameFromCode: (code: string | null | undefined) => string | null;
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
  const debtorShippingAddress = debtor?.shippingAddresses?.[0];
  const buyerGstin = String(inv.buyerGstin || debtor?.gstin || "").trim().toUpperCase();
  const buyerMasterState =
    debtor?.state ||
    ctx.stateNameFromCode(debtor?.stateCode) ||
    debtor?.billingAddresses?.[0]?.state ||
    stateNameFromGstin(buyerGstin) ||
    null;
  const buyerState =
    inv.buyerState ||
    ctx.stateNameFromCode(inv.buyerStateCode) ||
    buyerMasterState ||
    stateNameFromGstin(buyerGstin);
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
  if (!buyerState) errors.push("Customer state is required for the sales voucher.");
  if (!partyState) errors.push("Place of supply is required for the sales voucher.");
  if (buyerGstin && !isValidGstin(buyerGstin)) {
    errors.push("Customer GSTIN must be a valid 15-character GSTIN or blank for an unregistered buyer.");
  }
  const buyerGstinState = stateNameFromGstin(buyerGstin);
  if (buyerGstin && isValidGstin(buyerGstin) && !buyerGstinState) {
    errors.push("Customer GSTIN has an unknown state prefix.");
  }
  if (buyerGstinState && buyerState && ctx.normState(buyerGstinState) !== ctx.normState(buyerState)) {
    errors.push(`Customer GSTIN state ${buyerGstinState} conflicts with buyer state ${buyerState}.`);
  }
  if (buyerMasterState && buyerState && ctx.normState(buyerMasterState) !== ctx.normState(buyerState)) {
    errors.push(`Invoice buyer state ${buyerState} conflicts with the customer master state ${buyerMasterState}.`);
  }
  const explicitPlaceOfSupply = inv.placeOfSupply || inv.place_of_supply;
  if (
    explicitPlaceOfSupply &&
    partyState &&
    ctx.normState(explicitPlaceOfSupply) !== ctx.normState(partyState)
  ) {
    errors.push(
      `Place of supply ${explicitPlaceOfSupply} conflicts with the invoice/consignee state ${partyState}.`,
    );
  }
  if (!config.dispatchFromName) errors.push("Dispatch-from name is not configured.");
  if (!config.dispatchFromAddress) errors.push("Dispatch-from address is not configured.");
  if (!config.dispatchFromPlace) errors.push("Dispatch-from place is not configured.");
  if (!/^\d{6}$/.test(config.dispatchFromPincode || "")) {
    errors.push("Dispatch-from PIN code must be a valid 6-digit PIN.");
  }

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
      hsnDescription: line.description || product?.description || stockItem,
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
  const buyerAddress =
    inv.billingAddress ||
    debtor?.billingAddress ||
    debtor?.billingAddresses?.[0]?.address ||
    "";
  const consigneeAddress =
    inv.consigneeAddress ||
    inv.deliveryAddress ||
    debtorShippingAddress?.address ||
    debtor?.shippingAddress ||
    buyerAddress;
  const consigneeState =
    inv.consigneeState ||
    ctx.stateNameFromCode(inv.consigneeStateCode) ||
    debtorShippingAddress?.state ||
    buyerState ||
    partyState;
  const consigneePlace =
    inv.consigneePlace ||
    inv.consigneeCity ||
    debtorShippingAddress?.city ||
    inv.deliveryCity ||
    debtor?.city ||
    "";
  const country = debtor?.country || "India";
  const buyerPostalCode =
    inv.buyerPostalCode ||
    debtor?.postalCode ||
    debtor?.pincode ||
    debtor?.billingAddresses?.[0]?.postalCode ||
    "";
  const consigneePostalCode =
    inv.consigneePostalCode ||
    debtorShippingAddress?.postalCode ||
    buyerPostalCode;
  const consigneeGstin = String(inv.consigneeGstin || buyerGstin).trim().toUpperCase();
  if (consigneeGstin && !isValidGstin(consigneeGstin)) {
    errors.push("Consignee GSTIN must be a valid 15-character GSTIN or blank for an unregistered consignee.");
  }
  if (!buyerAddress) errors.push("Customer billing address is required for the sales voucher.");
  if (!buyerPostalCode) errors.push("Customer PIN code is required for the sales voucher.");
  if (!consigneeState) errors.push("Consignee state is required for the sales voucher.");
  if (!consigneeAddress) errors.push("Consignee address is required for the sales voucher.");
  if (!consigneePostalCode) errors.push("Consignee PIN code is required for the sales voucher.");
  if (
    partyState &&
    consigneeState &&
    ctx.normState(partyState) !== ctx.normState(consigneeState)
  ) {
    errors.push(`Place of supply ${partyState} conflicts with consignee state ${consigneeState}.`);
  }

  const parts = [
    tag("DATE", tallyDate(inv.issueDate)),
    tag("VCHSTATUSDATE", tallyDate(inv.issueDate)),
    tag("VOUCHERTYPENAME", "Sales"),
    tag("VOUCHERNUMBER", inv.invoiceNumber),
    tag("PERSISTEDVIEW", "Invoice Voucher View"),
    tag("VCHENTRYMODE", "Item Invoice"),
    tag("ISINVOICE", "Yes"),
    tag("VCHGSTSTATUSISAPPLICABLE", "Yes"),
    config.gstin ? tag("CMPGSTIN", config.gstin) : "",
    config.gstRegistrationType
      ? tag("CMPGSTREGISTRATIONTYPE", config.gstRegistrationType)
      : "",
    tag("DISPATCHFROMNAME", config.dispatchFromName),
    list("DISPATCHFROMADDRESS", tag("DISPATCHFROMADDRESS", config.dispatchFromAddress)),
    tag("DISPATCHFROMSTATENAME", config.homeState),
    tag("DISPATCHFROMPLACE", config.dispatchFromPlace),
    tag("DISPATCHFROMPINCODE", config.dispatchFromPincode),
    tag("REFERENCE", inv.invoiceNumber),
    tag("NARRATION", `WhizUnik Ref: ${inv.invoiceNumber}${inv.goodsSalesOrderNumber ? ` | SO: ${inv.goodsSalesOrderNumber}` : ""}`),
    tag("PARTYLEDGERNAME", party || "UNKNOWN"),
    tag("BASICBUYERNAME", party || "UNKNOWN"),
    buyerGstin && isValidGstin(buyerGstin) ? tag("PARTYGSTIN", buyerGstin) : "",
    partyState ? tag("PLACEOFSUPPLY", partyState) : "",
    tag("BASICBASEPARTYNAME", party || "UNKNOWN"),
    buyerState ? tag("BASICBUYERSTATENAME", buyerState) : "",
    tag("BASICBUYERCOUNTRYNAME", country),
    buyerPostalCode ? tag("BASICBUYERPINCODE", buyerPostalCode) : "",
    buyerAddress
      ? list("BASICBUYERADDRESS", tag("BASICBUYERADDRESS", buyerAddress))
      : "",
    tag("CONSIGNEEMAILINGNAME", inv.consigneeName || party || "UNKNOWN"),
    consigneePlace ? tag("CONSIGNEEPLACE", consigneePlace) : "",
    consigneeState ? tag("CONSIGNEESTATENAME", consigneeState) : "",
    tag("CONSIGNEECOUNTRYNAME", country),
    consigneeGstin && isValidGstin(consigneeGstin) ? tag("CONSIGNEEGSTIN", consigneeGstin) : "",
    consigneePostalCode ? tag("CONSIGNEEPINCODE", consigneePostalCode) : "",
    consigneeAddress
      ? list("CONSIGNEEADDRESS", tag("CONSIGNEEADDRESS", consigneeAddress))
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

