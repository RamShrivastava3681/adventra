/**
 * Low-level TallyPrime XML helpers. All generated files are UTF-8 with an
 * XML declaration and a standard Import Data envelope. Everything that comes
 * from the database is escaped so a customer called "A & B" does not break
 * the import.
 */

export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&#(?:x0*[0-8BbCcEeEfF]|0*4);?/gi, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/^[\s]+|[\s]+$/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** YYYY-MM-DD (or ISO) -> YYYYMMDD. Falls back to today. */
export function tallyDate(input: string | null | undefined): string {
  if (!input) return "00000000";
  const iso = String(input).slice(0, 10);
  const digits = iso.replace(/[^0-9]/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "00000000";
}

export function num(value: unknown, decimals = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  return n.toFixed(decimals);
}

export function money(value: unknown): string {
  return num(value, 2);
}

export function qty(value: unknown, unit: string): string {
  return `${num(value, 2)} ${unit}`;
}

export function rate(value: unknown, unit: string): string {
  return `${num(value, 4)}/${unit}`;
}

export function tag(name: string, value: unknown): string {
  return `<${name}>${esc(value)}</${name}>`;
}

export function list(name: string, inner: string): string {
  return `<${name}.LIST>${inner}</${name}.LIST>`;
}

export function message(inner: string): string {
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE>`;
}

export interface EnvelopeOptions {
  reportName: "All Masters" | "Vouchers";
  companyName: string;
  messages: string[];
}

export function envelope({ reportName, companyName, messages }: EnvelopeOptions): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "<HEADER>",
    "<TALLYREQUEST>Import Data</TALLYREQUEST>",
    "</HEADER>",
    "<BODY>",
    "<IMPORTDATA>",
    "<REQUESTDESC>",
    tag("REPORTNAME", reportName),
    "<STATICVARIABLES>",
    tag("SVCURRENTCOMPANY", companyName),
    "</STATICVARIABLES>",
    "</REQUESTDESC>",
    "<REQUESTDATA>",
    ...messages,
    "</REQUESTDATA>",
    "</IMPORTDATA>",
    "</BODY>",
    "</ENVELOPE>",
  ].join("");
}

export function validateXml1(input: string): string[] {
  const errors: string[] = [];
  if (!input || !input.includes("<ENVELOPE>")) errors.push("XML envelope is empty.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(input)) {
    errors.push("XML contains characters that are invalid in XML 1.0.");
  }
  if (/&#(?:x0*[0-8BbCcEeEfF]|0*4);?/i.test(input)) {
    errors.push("XML contains an invalid control-character reference.");
  }
  if (!/<REQUESTDATA>[\s\S]*<TALLYMESSAGE[\s\S]*>/.test(input)) {
    errors.push("XML contains no generated Tally records.");
  }

  const stack: string[] = [];
  const tokens = input.match(/<\/?[^>]+>/g) || [];
  for (const token of tokens) {
    if (token.startsWith("<?")) continue;
    if (/^<!--/.test(token)) continue;
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      const top = stack.pop();
      if (top !== name) {
        errors.push(`XML structure is mismatched at closing tag </${name}>.`);
        break;
      }
    } else if (!token.endsWith("/>")) {
      const name = token.slice(1, -1).split(/\s+/)[0];
      stack.push(name);
    }
  }
  if (stack.length) errors.push("XML contains unclosed elements.");

  const stockNames = [...input.matchAll(/<STOCKITEMNAME>([\s\S]*?)<\/STOCKITEMNAME>/gi)];
  for (const match of stockNames) {
    if (!match[1].trim()) errors.push("XML contains an empty stock item name.");
  }
  return [...new Set(errors)];
}

/**
 * Ledger entry helper. Tally's sign convention: a positive AMOUNT is a credit
 * for ISDEEMEDPOSITIVE=No and a debit for ISDEEMEDPOSITIVE=Yes. Callers pass
 * the signed amount and the flag explicitly so the voucher always balances.
 */
export function ledgerEntry(opts: {
  ledger: string;
  amount: number;
  positive: boolean;
  isParty?: boolean;
  isLastDeemedPositive?: boolean;
  bill?: { name: string; amount: number; type?: "New Ref" | "Agst Ref" | "Advance" } | null;
  vatExpAmount?: boolean;
  extra?: string;
}): string {
  const parts = [
    opts.extra || "",
    tag("LEDGERNAME", opts.ledger),
    tag("ISDEEMEDPOSITIVE", opts.positive ? "Yes" : "No"),
    opts.isParty ? tag("ISPARTYLEDGER", "Yes") : "",
    opts.isLastDeemedPositive !== undefined
      ? tag("ISLASTDEEMEDPOSITIVE", opts.isLastDeemedPositive ? "Yes" : "No")
      : "",
    tag("AMOUNT", money(opts.amount)),
  ];
  if (opts.bill) {
    parts.push(
      list(
        "BILLALLOCATIONS",
        tag("NAME", opts.bill.name) +
          tag("BILLTYPE", opts.bill.type || "New Ref") +
          tag("AMOUNT", money(opts.bill.amount)),
      ),
    );
  }
  if (opts.vatExpAmount) parts.push(tag("VATEXPAMOUNT", money(opts.amount)));
  return list("LEDGERENTRIES", parts.join(""));
}

export interface GstRateDuty {
  head: "CGST" | "SGST/UTGST" | "IGST" | string;
  rate: number;
}

export function inventoryEntry(opts: {
  stockItem: string;
  hsn: string | null;
  hsnDescription?: string | null;
  amount: number;
  quantity: number;
  unit: string;
  rateValue: number;
  inclRateValue: number;
  positive: boolean;
  godown: string;
  batch: string;
  accountingLedger: string;
  rateDetails?: GstRateDuty[];
  gstHead?: "CGST" | "SGST/UTGST" | "IGST";
  gstRate?: number;
  taxable?: boolean;
}): string {
  const isTaxable = opts.taxable !== false;
  const rates: GstRateDuty[] =
    opts.rateDetails && opts.rateDetails.length
      ? opts.rateDetails
      : opts.gstHead && opts.gstRate !== undefined
      ? [{ head: opts.gstHead, rate: opts.gstRate }]
      : [];

  const rateDetailsXml = rates
    .map(
      (r) =>
        list(
          "RATEDETAILS",
          tag("GSTRATEDUTYHEAD", r.head) +
            tag("GSTRATEVALUATIONTYPE", "Based on Value") +
            tag("GSTRATE", num(r.rate, 2).replace(/\.00$/, "")),
        ),
    )
    .join("");

  const parts = [
    tag("STOCKITEMNAME", opts.stockItem),
    tag("GSTOVRDNTAXABILITY", isTaxable ? "Taxable" : "Exempt"),
    tag("GSTSOURCETYPE", "Stock Item"),
    tag("GSTITEMSOURCE", opts.stockItem),
    tag("HSNSOURCETYPE", "Stock Item"),
    tag("HSNITEMSOURCE", opts.stockItem),
    tag("GSTOVRDNTYPEOFSUPPLY", "Goods"),
    tag("GSTRATEINFERAPPLICABILITY", "As per Masters/Company"),
    opts.hsn ? tag("GSTHSNNAME", opts.hsn) : "",
    opts.hsnDescription ? tag("GSTHSNDESCRIPTION", opts.hsnDescription) : "",
    tag("GSTHSNINFERAPPLICABILITY", "As per Masters/Company"),
    tag("ISDEEMEDPOSITIVE", opts.positive ? "Yes" : "No"),
    tag("ISLASTDEEMEDPOSITIVE", opts.positive ? "Yes" : "No"),
    tag("RATE", rate(opts.rateValue, opts.unit)),
    tag("AMOUNT", money(opts.amount)),
    tag("ACTUALQTY", qty(opts.quantity, opts.unit)),
    tag("BILLEDQTY", qty(opts.quantity, opts.unit)),
    tag("INCLVATRATE", rate(opts.inclRateValue, opts.unit)),
    list(
      "BATCHALLOCATIONS",
      tag("GODOWNNAME", opts.godown) +
        tag("BATCHNAME", opts.batch) +
        (opts.positive ? "" : tag("DESTINATIONGODOWNNAME", opts.godown)) +
        tag("AMOUNT", money(opts.amount)) +
        tag("ACTUALQTY", qty(opts.quantity, opts.unit)) +
        tag("BILLEDQTY", qty(opts.quantity, opts.unit)) +
        tag("INCLVATRATE", rate(opts.inclRateValue, opts.unit)),
    ),
    list(
      "ACCOUNTINGALLOCATIONS",
      tag("LEDGERNAME", opts.accountingLedger) +
        tag("ISDEEMEDPOSITIVE", opts.positive ? "Yes" : "No") +
        tag("ISLASTDEEMEDPOSITIVE", opts.positive ? "Yes" : "No") +
        tag("AMOUNT", money(opts.amount)),
    ),
    rateDetailsXml,
  ];
  return list("ALLINVENTORYENTRIES", parts.join(""));
}

export function customerLedger(opts: {
  name: string;
  parent: string;
  action?: "Create" | "Alter";
  gstin?: string | null;
  addressLines?: string[];
  state?: string | null;
  country?: string | null;
  registrationType?: string | null;
  openingBalance?: number;
  pincode?: string | null;
}): string {
  const action = opts.action || "Create";
  const today = new Date();
  const applicableFrom = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("");
  const country = opts.country || "India";
  const registrationType = opts.registrationType || "Regular";
  const lines = (opts.addressLines || []).filter(Boolean);
  const addressList = lines.length
    ? list("ADDRESS", lines.map((l) => tag("ADDRESS", l)).join(""))
    : "";
  const parts = [
    tag("NAME", opts.name),
    tag("PARENT", opts.parent),
    tag("ISBILLWISEON", "Yes"),
    tag("OPENINGBALANCE", money(opts.openingBalance ?? 0)),
    tag("MAILINGNAME", opts.name),
    tag("COUNTRYNAME", country),
    opts.state ? tag("STATENAME", opts.state) : "",
    opts.state ? tag("LEDSTATENAME", opts.state) : "",
    opts.gstin ? tag("PARTYGSTIN", opts.gstin) : "",
    opts.gstin ? tag("GSTREGISTRATIONTYPE", registrationType) : "",
    opts.pincode ? tag("PINCODE", opts.pincode) : "",
    opts.state
      ? list(
          "LEDGSTREGDETAILS",
          tag("APPLICABLEFROM", applicableFrom) +
            tag("GSTREGISTRATIONTYPE", registrationType) +
            tag("GSTIN", opts.gstin || "") +
            tag("STATE", opts.state) +
            tag("PLACEOFSUPPLY", opts.state),
        )
      : "",
    list(
      "LEDMAILINGDETAILS",
      tag("APPLICABLEFROM", applicableFrom) +
        tag("MAILINGNAME", opts.name) +
        addressList +
        (opts.pincode ? tag("PINCODE", opts.pincode) : "") +
        tag("STATE", opts.state || "") +
        tag("COUNTRY", country),
    ),
    addressList,
  ];
  return `<LEDGER NAME="${esc(opts.name)}" ACTION="${action}">${parts.join("")}</LEDGER>`;
}

export function unitMaster(opts: {
  name: string;
  originalName: string;
  decimalPlaces?: number;
  action?: "Create" | "Alter";
}): string {
  const action = opts.action || "Create";
  const parts = [
    tag("NAME", opts.name),
    tag("ORIGINALNAME", opts.originalName),
    tag("ISGSTEXCLUDED", "No"),
    tag("DECIMALPLACES", String(opts.decimalPlaces ?? 0)),
  ];
  return `<UNIT NAME="${esc(opts.name)}" ACTION="${action}">${parts.join("")}</UNIT>`;
}

export function accountLedgerMaster(opts: {
  name: string;
  parent: string;
  action?: "Create" | "Alter";
  taxType?: string;
  gstDutyHead?: string;
}): string {
  const action = opts.action || "Create";
  const parts = [
    tag("NAME", opts.name),
    tag("PARENT", opts.parent),
  ];
  if (opts.taxType) parts.push(tag("TAXTYPE", opts.taxType));
  if (opts.gstDutyHead) parts.push(tag("GSTDUTYHEAD", opts.gstDutyHead));
  return `<LEDGER NAME="${esc(opts.name)}" ACTION="${action}">${parts.join("")}</LEDGER>`;
}
