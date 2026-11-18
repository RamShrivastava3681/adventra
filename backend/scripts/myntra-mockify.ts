/**
 * Fills column D ("Response") of Myntra's Mockify contract sheet.
 *
 * Runs every API in the sheet against Myntra's Neo-Mockify test system, in the
 * order of mockify_guide.pdf, and writes the real responses to an Excel file
 * laid out like Myntra's sheet (API | Request | Comments | Response).
 *
 * Usage (from backend/):
 *   npm run myntra:mockify
 *   npm run myntra:mockify -- --skus SKU1,SKU2,SKU3 --warehouses WH1,WH2,WH3 --out ./mockify.xlsx
 *
 * Needs MYNTRA_MERCHANT_ID, MYNTRA_SECRET_KEY, MYNTRA_API_DOMAIN and either
 * MYNTRA_SELLER_DOMAIN (our public outbound URL) or MYNTRA_MOCK_PUSH_URL in .env.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../src/config.js";
import * as Mockify from "../src/services/myntra-mockify.service.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

async function main() {
  const out = resolve(arg("out") ?? "Mockify-Contracts-WhizUnik-responses.xlsx");
  console.log(`Myntra API domain: ${config.myntra.apiDomain}`);
  console.log(
    `Mockify pushes go to: ${config.myntra.mockPushUrl || `${config.myntra.sellerDomain} (our outbound API)`}\n`,
  );

  const run = await Mockify.runToCompletion({ skus: list(arg("skus")), warehouses: list(arg("warehouses")) });

  let scenario = "";
  for (const s of run.steps) {
    if (s.scenario !== scenario) {
      scenario = s.scenario;
      console.log(`\n── ${scenario}`);
    }
    const mark = s.status === "ok" ? "OK  " : s.status === "failed" ? "FAIL" : "SKIP";
    const note = s.note.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120);
    console.log(`  ${mark} ${s.httpStatus ?? "   "} ${s.api} — ${note}`);
  }
  if (run.error) console.log(`\nRun stopped: ${run.error}`);

  const rows = await Mockify.contractRows();
  const ok = rows.filter((r) => r.ok).length;
  const failed = rows.filter((r) => r.ok === false).length;
  writeFileSync(out, await Mockify.contractWorkbook());
  console.log(`\nColumn D: ${ok} OK, ${failed} failed, ${rows.length - ok - failed} not called, of ${rows.length} rows.`);
  console.log(`Sheet written to ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
