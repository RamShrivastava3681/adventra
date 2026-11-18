import * as Invoice from "../../models/invoice.js";
import * as PurchaseInvoice from "../../models/purchase-invoice.js";
import * as PaymentReceipt from "../../models/payment-receipt.js";
import * as CreditDebitNote from "../../models/credit-debit-note.js";
import * as Debtor from "../../models/debtor.js";
import * as Supplier from "../../models/supplier.js";
import { round2 } from "../../lib/gst.js";

export interface StagedTallyVoucher {
  guid: string | null;
  voucherNumber: string | null;
  reference: string | null;
  date: string | null;
  voucherType: string;
  partyName: string | null;
  partyGstin: string | null;
  placeOfSupply: string | null;
  amount: number;
  narration: string | null;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  ewayBillNo: string | null;
  ewayBillDate: string | null;
  ledgers: { name: string; amount: number; deemedPositive: boolean }[];
  classification: "Matched" | "New" | "Changed" | "Duplicate" | "Missing Master" | "Unbalanced" | "Invalid";
  matchedId: string | null;
  matchedDocNumber: string | null;
  differences: string[];
}

function extractTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>(.*?)</${tag}>`, "s").exec(xml);
  return m ? m[1].trim() : null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const matches: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "gs");
  let m;
  while ((m = regex.exec(xml)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

export function parseTallyXml(xmlContent: string): StagedTallyVoucher[] {
  const vouchers: StagedTallyVoucher[] = [];
  const voucherBlocks = extractAllTags(xmlContent, "VOUCHER");

  for (const block of voucherBlocks) {
    const guid = extractTag(block, "GUID");
    const vchType = extractTag(block, "VOUCHERTYPENAME") || extractTag(block, "VCHTYPE") || "Sales";
    const date = extractTag(block, "DATE");
    const voucherNumber = extractTag(block, "VOUCHERNUMBER");
    const reference = extractTag(block, "REFERENCE") || voucherNumber;
    const narration = extractTag(block, "NARRATION");
    const partyName = extractTag(block, "PARTYLEDGERNAME") || extractTag(block, "BASICBUYERNAME");
    const partyGstin = extractTag(block, "PARTYGSTIN");
    const placeOfSupply = extractTag(block, "PLACEOFSUPPLY");

    // Statutory details
    const irn = extractTag(block, "IRN") || extractTag(block, "IRNACKNO");
    const ackNo = extractTag(block, "ACKNO") || extractTag(block, "GSTINVOICEACKNO");
    const ackDate = extractTag(block, "ACKDATE");
    const ewayBillNo = extractTag(block, "EWAYBILLNO") || extractTag(block, "EWBNO");
    const ewayBillDate = extractTag(block, "EWAYBILLDATE");

    // Ledger entries
    const ledgerBlocks = extractAllTags(block, "LEDGERENTRIES.LIST");
    const ledgers: { name: string; amount: number; deemedPositive: boolean }[] = [];
    let voucherAmount = 0;

    for (const lBlock of ledgerBlocks) {
      const name = extractTag(lBlock, "LEDGERNAME") || "";
      const amtStr = extractTag(lBlock, "AMOUNT") || "0";
      const amt = Number(amtStr) || 0;
      const isPositive = extractTag(lBlock, "ISDEEMEDPOSITIVE") === "Yes";
      ledgers.push({ name, amount: amt, deemedPositive: isPositive });
      if (Math.abs(amt) > voucherAmount) {
        voucherAmount = Math.abs(amt);
      }
    }

    vouchers.push({
      guid,
      voucherNumber,
      reference,
      date,
      voucherType: vchType,
      partyName,
      partyGstin,
      placeOfSupply,
      amount: round2(voucherAmount),
      narration,
      irn,
      ackNo,
      ackDate,
      ewayBillNo,
      ewayBillDate,
      ledgers,
      classification: "New",
      matchedId: null,
      matchedDocNumber: null,
      differences: [],
    });
  }

  return vouchers;
}

export async function matchAndClassifyStaged(
  clientId: string,
  staged: StagedTallyVoucher[],
): Promise<StagedTallyVoucher[]> {
  const [invoices, purchases, debtors, suppliers] = await Promise.all([
    Invoice.list(clientId).catch(() => [] as any[]),
    PurchaseInvoice.list(clientId).catch(() => [] as any[]),
    Debtor.list().catch(() => [] as any[]),
    Supplier.list().catch(() => [] as any[]),
  ]);

  const invoicesByNum = new Map<string, any>();
  for (const inv of invoices as any[]) {
    if (inv.invoiceNumber) invoicesByNum.set(inv.invoiceNumber.trim().toLowerCase(), inv);
  }

  const purchasesByNum = new Map<string, any>();
  for (const pi of purchases as any[]) {
    if (pi.invoiceNumber) purchasesByNum.set(pi.invoiceNumber.trim().toLowerCase(), pi);
  }

  const debtorNames = new Set((debtors as any[]).map((d) => (d.name || "").trim().toLowerCase()));
  const supplierNames = new Set((suppliers as any[]).map((s) => (s.companyName || "").trim().toLowerCase()));

  for (const row of staged) {
    const refKey = (row.reference || row.voucherNumber || "").trim().toLowerCase();
    const isSales = row.voucherType.toLowerCase().includes("sales");
    const isPurchase = row.voucherType.toLowerCase().includes("purchase");

    if (isSales && refKey) {
      const match = invoicesByNum.get(refKey);
      if (match) {
        row.matchedId = match.id;
        row.matchedDocNumber = match.invoiceNumber;
        const diffs: string[] = [];
        const whizTotal = round2(Number(match.grandTotal) || Number(match.amount) || 0);
        if (Math.abs(whizTotal - row.amount) > 0.05) {
          diffs.push(`Amount mismatch: Tally ${row.amount.toFixed(2)} vs WhizUnik ${whizTotal.toFixed(2)}`);
        }
        if (match.tallyVoucherNumber && match.tallyVoucherNumber !== row.voucherNumber) {
          diffs.push(`Tally voucher # already set: ${match.tallyVoucherNumber}`);
        }
        row.differences = diffs;
        row.classification = diffs.length ? "Changed" : "Matched";
      } else {
        if (row.partyName && !debtorNames.has(row.partyName.trim().toLowerCase())) {
          row.classification = "Missing Master";
          row.differences.push(`Customer "${row.partyName}" does not exist in WhizUnik`);
        } else {
          row.classification = "New";
        }
      }
    } else if (isPurchase && refKey) {
      const match = purchasesByNum.get(refKey);
      if (match) {
        row.matchedId = match.id;
        row.matchedDocNumber = match.invoiceNumber;
        const diffs: string[] = [];
        const whizTotal = round2(Number(match.grandTotal) || Number(match.amount) || 0);
        if (Math.abs(whizTotal - row.amount) > 0.05) {
          diffs.push(`Amount mismatch: Tally ${row.amount.toFixed(2)} vs WhizUnik ${whizTotal.toFixed(2)}`);
        }
        row.differences = diffs;
        row.classification = diffs.length ? "Changed" : "Matched";
      } else {
        if (row.partyName && !supplierNames.has(row.partyName.trim().toLowerCase())) {
          row.classification = "Missing Master";
          row.differences.push(`Supplier "${row.partyName}" does not exist in WhizUnik`);
        } else {
          row.classification = "New";
        }
      }
    }
  }

  return staged;
}

