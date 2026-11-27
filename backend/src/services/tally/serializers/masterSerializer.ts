import { customerLedger, unitMaster, accountLedgerMaster, tag, list, num, qty, rate, esc, tallyDate } from "../xml.js";
import { type TallyConfig } from "../../../models/tally.js";
import { stateNameFromCode } from "../engine.js";
import { STATE_CODES, stateNameFromGstin } from "../states.js";
import { round2 } from "../../../lib/gst.js";

const INDIAN_STATE_NAMES = new Set(
  Object.values(STATE_CODES).map((name) => name.trim().toLowerCase()),
);

function exportCountry(value: unknown): string {
  const country = String(value ?? "").trim();
  return country && !INDIAN_STATE_NAMES.has(country.toLowerCase()) ? country : "India";
}

export interface MasterBuildContext {
  config: TallyConfig;
  openingByProduct: Map<string, { qty: number; value: number }>;
}

export function serializeCustomerMaster(debtor: any, config: TallyConfig): string {
  const name = debtor.name || "";
  const primaryBillingAddress = debtor.billingAddresses?.[0];
  const address = debtor.billingAddress || debtor.address || primaryBillingAddress?.address || "";
  const city = debtor.city || primaryBillingAddress?.city || "";
  const state =
    debtor.state ||
    (debtor.stateCode ? stateNameFromCode(debtor.stateCode) : null) ||
    primaryBillingAddress?.state ||
    stateNameFromGstin(debtor.gstin) ||
    null;
  const postal =
    debtor.postalCode ||
    debtor.pincode ||
    primaryBillingAddress?.postalCode ||
    "";
  const addressLines = [address, [city, state, postal].filter(Boolean).join(", ")].filter(Boolean) as string[];

  return customerLedger({
    name,
    parent: config.mappings.debtorsGroup || "Sundry Debtors",
    action: "Create",
    gstin: debtor.gstin || null,
    addressLines,
    state,
    country: exportCountry(debtor.country),
    registrationType: debtor.gstRegistrationType || config.gstRegistrationType || "Regular",
    openingBalance: debtor.openingBalance ? Number(debtor.openingBalance) : 0,
    pincode: postal,
  });
}

export function serializeSupplierMaster(supplier: any, config: TallyConfig, stateNameFromCode?: (code: string) => string | null): string {
  const name = supplier.companyName || supplier.name || "";
  const address = supplier.addressLine || supplier.address || "";
  const city = supplier.city || "";
  const state = supplier.state || (supplier.stateCode && stateNameFromCode ? stateNameFromCode(supplier.stateCode) : null) || null;
  const postal = supplier.postalCode || supplier.pincode || "";
  const addressLines = [address, [city, state, postal].filter(Boolean).join(", ")].filter(Boolean) as string[];

  return customerLedger({
    name,
    parent: config.mappings.creditorsGroup || "Sundry Creditors",
    action: "Create",
    gstin: supplier.gstin || null,
    addressLines,
    state,
    country: exportCountry(supplier.country),
    registrationType: supplier.gstRegistrationType || config.gstRegistrationType || "Regular",
    openingBalance: supplier.openingBalance ? Number(supplier.openingBalance) : 0,
    pincode: postal,
  });
}

export function serializeStockItemMaster(
  product: any,
  ctx: MasterBuildContext,
  unitFor: (val: string | null | undefined, fallback: string) => string,
  action: "Create" | "Alter" = "Create",
): string {
  const config = ctx.config;
  const unit = unitFor(product.unitOfMeasure, config.defaultUnit);
  const rateValue = Number(product.gstRate) || 0;
  const opening = ctx.openingByProduct.get(product.id) || { qty: 0, value: 0 };
  const openValueMagnitude = round2(Math.abs(opening.value));
  // In Tally stock-item master, opening value is negative
  const openValue = round2(-openValueMagnitude);
  const openRate = opening.qty > 0 ? round2(openValueMagnitude / opening.qty) : round2(Number(product.unitCost) || 0);
  const hasOpeningValuation = opening.qty > 0 && openValueMagnitude > 0.005;
  const gstApplicableFrom = tallyDate(config.gstApplicableFrom);
  const gstRate = num(rateValue, 2).replace(/\.00$/, "");
  const halfGstRate = num(rateValue / 2, 2).replace(/\.00$/, "");

  const parts = [
    tag("NAME", product.name),
    tag("PARENT", config.stockGroup || config.mappings.salesGroup || "Primary"),
    tag("GSTAPPLICABLE", "Applicable"),
    tag("GSTTYPEOFSUPPLY", "Goods"),
    tag("BASEUNITS", unit),
    tag("ISBATCHWISEON", "No"),
    tag("ISPERISHABLEON", "No"),
    tag("OPENINGBALANCE", qty(opening.qty, unit)),
    ...(hasOpeningValuation
      ? [tag("OPENINGVALUE", num(openValue)), tag("OPENINGRATE", rate(openRate, unit))]
      : []),
    list(
      "GSTDETAILS",
      tag("APPLICABLEFROM", gstApplicableFrom) +
        tag("TAXABILITY", "Taxable") +
        tag("SRCOFGSTDETAILS", "Specify Details Here") +
        list(
          "STATEWISEDETAILS",
          "<STATENAME>Any</STATENAME>" +
            list(
              "RATEDETAILS",
              tag("GSTRATEDUTYHEAD", "CGST") +
                tag("GSTRATEVALUATIONTYPE", "Based on Value") +
                tag("GSTRATE", halfGstRate),
            ) +
            list(
              "RATEDETAILS",
              tag("GSTRATEDUTYHEAD", "SGST/UTGST") +
                tag("GSTRATEVALUATIONTYPE", "Based on Value") +
                tag("GSTRATE", halfGstRate),
            ) +
            list(
              "RATEDETAILS",
              tag("GSTRATEDUTYHEAD", "IGST") +
                tag("GSTRATEVALUATIONTYPE", "Based on Value") +
                tag("GSTRATE", gstRate),
            ),
        ),
    ),
    list(
      "HSNDETAILS",
      tag("APPLICABLEFROM", gstApplicableFrom) +
        tag("HSNCODE", product.hsnCode || "") +
        tag("SRCOFHSNDETAILS", "Specify Details Here"),
    ),
  ];

  return `<STOCKITEM NAME="${esc(product.name)}" ACTION="${action}">${parts.join("")}</STOCKITEM>`;
}

export function serializeUnitMaster(name: string, originalName: string, decimalPlaces = 0): string {
  return unitMaster({ name, originalName, decimalPlaces, action: "Create" });
}

export function serializeLedgerMaster(name: string, parent: string, taxType?: string, gstDutyHead?: string): string {
  return accountLedgerMaster({ name, parent, action: "Create", taxType, gstDutyHead });
}

