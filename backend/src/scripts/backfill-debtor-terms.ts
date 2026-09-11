/**
 * Backfill DebtorPaymentTerms from legacy single-term Debtor fields.
 *
 * For each Debtor without any DebtorPaymentTerm rows, creates one term from
 * the legacy paymentTermsType / paymentTermsDays / advancePct fields and marks
 * it default. Safe to re-run (skips debtors that already have terms).
 *
 * Usage (from backend/): npx tsx src/scripts/backfill-debtor-terms.ts [--dry-run]
 */
import * as Debtor from "../models/debtor.js";
import * as Term from "../models/debtor-payment-term.js";
import {
  formatPaymentTerms,
  defaultDispatchConditionFor,
  balancePctFor,
} from "../lib/payment-terms.js";

const dryRun = process.argv.includes("--dry-run");
const clientId = process.env.BACKFILL_CLIENT_ID || "backfill";

const debtors = await Debtor.list();
let created = 0;
let skipped = 0;

for (const d of debtors) {
  const existing = await Term.listByDebtor(d.id, { activeOnly: false });
  if (existing.length > 0) {
    skipped++;
    continue;
  }
  const advancePct =
    d.paymentTermsType === "advance_full"
      ? 100
      : d.paymentTermsType === "advance_partial"
        ? Number(d.advancePct) || 0
        : Number((d as any).advancePct) || 0;
  const balanceDueDays =
    !d.paymentTermsType ||
    d.paymentTermsType === "credit" ||
    d.paymentTermsType === "on_delivery" ||
    d.paymentTermsType === "advance_partial"
      ? Math.max(0, Math.floor(Number(d.paymentTermsDays) || 0))
      : 0;
  const name =
    formatPaymentTerms({
      paymentTermsType: d.paymentTermsType,
      advancePct: advancePct || null,
      paymentTermsDays: (d.paymentTermsDays as number) || null,
      paymentTerms: (d as any).paymentTerms ?? null,
    }) || "Default terms";
  if (dryRun) {
    console.log(`would create for ${d.name}: ${name}`);
    created++;
    continue;
  }
  const term = await Term.create(clientId, d.id, {
    name,
    paymentTermsType: d.paymentTermsType,
    paymentTerms: (d as any).paymentTerms ?? null,
    advancePct,
    balancePct: balancePctFor(advancePct),
    balanceDueDays,
    dispatchCondition: defaultDispatchConditionFor(d.paymentTermsType, advancePct),
    isDefault: true,
  });
  await Debtor.update(d.id, { defaultPaymentTermId: term.id } as any);
  created++;
}

console.log(`done: created=${created} skipped=${skipped}${dryRun ? " (dry-run)" : ""}`);
process.exit(0);
