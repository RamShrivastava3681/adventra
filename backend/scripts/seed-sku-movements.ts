// One-off seed script: creates confirmed inventory movements for a SKU from a
// supplied ledger of entries. Supported SKUs: ADV-RC-001, ADV-DB-002, ADV-JK-003.
//
// Run with:  cd backend && npx tsx scripts/seed-sku-movements.ts <SKU> [--dry-run] [--yes]
//
// Data goes to the REAL DynamoDB table configured in backend/.env, owned by the
// admin user (ADMIN_EMAIL). Movements are linked to the catalogue product found
// by SKU. Idempotent: entries whose reference (linkedDocumentNumber) already
// exists as a confirmed movement for the product are skipped, so running it
// twice will not create duplicates.

import * as Product from "../src/models/product.js";
import * as StockMovement from "../src/models/stock-movement.js";
import * as db from "../src/dynamodb.js";
import { config } from "../src/config.js";

const log = (s: string) => console.log(s);

// ---------------------------------------------------------------------------
// Source data — one row per inventory movement (from the provided spreadsheet)
// ---------------------------------------------------------------------------
type SourceType = "opening_stock" | "dispatch" | "goods_receipt";

type Entry = {
  date: string;        // movementDate (YYYY-MM-DD)
  reference: string;   // stored as linkedDocumentNumber (idempotency key)
  warehouse: string;   // warehouse
  sku: string;
  product: string;     // itemName
  direction: "credit" | "debit"; // credit = stock in, debit = stock out
  quantity: number;
  sourceType: SourceType;
  status: "draft" | "confirmed" | "cancelled";
  notes: string;
};

const DATASETS: Record<string, Entry[]> = {
  "ADV-RC-001": [
  { date: "2024-08-01", reference: "OPEN-ADV-RC-001",     warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "credit", quantity: 600, sourceType: "opening_stock", status: "confirmed", notes: "Opening stock for test" },
  { date: "2024-08-25", reference: "DSP-ADV-RC-001-202408", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 30, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2024" },
  { date: "2024-09-25", reference: "DSP-ADV-RC-001-202409", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 32, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Sep 2024" },
  { date: "2024-10-25", reference: "DSP-ADV-RC-001-202410", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 35, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Oct 2024" },
  { date: "2024-11-25", reference: "DSP-ADV-RC-001-202411", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 38, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Nov 2024" },
  { date: "2024-12-25", reference: "DSP-ADV-RC-001-202412", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 42, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Dec 2024" },
  { date: "2025-01-25", reference: "DSP-ADV-RC-001-202501", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 45, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jan 2025" },
  { date: "2025-02-01", reference: "GRN-TEST-001",           warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "credit", quantity: 250, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
  { date: "2025-02-25", reference: "DSP-ADV-RC-001-202502", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 43, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Feb 2025" },
  { date: "2025-03-25", reference: "DSP-ADV-RC-001-202503", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 46, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Mar 2025" },
  { date: "2025-04-25", reference: "DSP-ADV-RC-001-202504", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 50, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Apr 2025" },
  { date: "2025-05-25", reference: "DSP-ADV-RC-001-202505", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 52, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - May 2025" },
  { date: "2025-06-25", reference: "DSP-ADV-RC-001-202506", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 55, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jun 2025" },
  { date: "2025-07-25", reference: "DSP-ADV-RC-001-202507", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 60, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jul 2025" },
  { date: "2025-08-25", reference: "DSP-ADV-RC-001-202508", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 40, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2025" },
  { date: "2025-09-01", reference: "GRN-TEST-002",           warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "credit", quantity: 220, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
  { date: "2025-09-25", reference: "DSP-ADV-RC-001-202509", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 45, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Sep 2025" },
  { date: "2025-10-25", reference: "DSP-ADV-RC-001-202510", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 50, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Oct 2025" },
  { date: "2025-11-25", reference: "DSP-ADV-RC-001-202511", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 55, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Nov 2025" },
  { date: "2025-12-25", reference: "DSP-ADV-RC-001-202512", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 60, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Dec 2025" },
  { date: "2026-01-25", reference: "DSP-ADV-RC-001-202601", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 65, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jan 2026" },
  { date: "2026-02-25", reference: "DSP-ADV-RC-001-202602", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 70, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Feb 2026" },
  { date: "2026-03-01", reference: "GRN-TEST-003",           warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "credit", quantity: 353, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
  { date: "2026-03-25", reference: "DSP-ADV-RC-001-202603", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 75, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Mar 2026" },
  { date: "2026-04-25", reference: "DSP-ADV-RC-001-202604", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 80, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Apr 2026" },
  { date: "2026-05-25", reference: "DSP-ADV-RC-001-202605", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 90, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - May 2026" },
  { date: "2026-06-25", reference: "DSP-ADV-RC-001-202606", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 105, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jun 2026" },
  { date: "2026-07-25", reference: "DSP-ADV-RC-001-202607", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 120, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jul 2026" },
  { date: "2026-08-01", reference: "GRN-TEST-004",           warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "credit", quantity: 72, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
  { date: "2026-08-25", reference: "DSP-ADV-RC-001-202608", warehouse: "Main Warehouse", sku: "ADV-RC-001", product: "Adventra Trail Rain Cover", direction: "debit", quantity: 49, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2026" },
  ],

  "ADV-JK-003": [
  { date: "2025-08-01", reference: "OPEN-ADV-JK-003",     warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "credit", quantity: 500, sourceType: "opening_stock", status: "confirmed", notes: "Opening stock for test" },
  { date: "2025-09-25", reference: "DSP-ADV-JK-003-202509", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 40, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Sep 2025" },
  { date: "2025-10-25", reference: "DSP-ADV-JK-003-202510", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 45, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Oct 2025" },
  { date: "2025-11-25", reference: "DSP-ADV-JK-003-202511", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 50, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Nov 2025" },
  { date: "2025-12-25", reference: "DSP-ADV-JK-003-202512", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 55, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Dec 2025" },
  { date: "2026-01-25", reference: "DSP-ADV-JK-003-202601", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 60, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jan 2026" },
  { date: "2026-02-25", reference: "DSP-ADV-JK-003-202602", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 65, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Feb 2026" },
  { date: "2026-03-01", reference: "GRN-ADV-JK-003-001",    warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "credit", quantity: 445, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
  { date: "2026-03-25", reference: "DSP-ADV-JK-003-202603", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 70, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Mar 2026" },
  { date: "2026-04-25", reference: "DSP-ADV-JK-003-202604", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 80, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Apr 2026" },
  { date: "2026-05-25", reference: "DSP-ADV-JK-003-202605", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 90, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - May 2026" },
  { date: "2026-06-25", reference: "DSP-ADV-JK-003-202606", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 110, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jun 2026" },
  { date: "2026-07-25", reference: "DSP-ADV-JK-003-202607", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 130, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jul 2026" },
  { date: "2026-08-25", reference: "DSP-ADV-JK-003-202608", warehouse: "Main Warehouse", sku: "ADV-JK-003", product: "Adventra Storm Jacket", direction: "debit", quantity: 100, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2026" },
  ],

  "SKU-3P-TENT": [
  { date: "2025-10-01", reference: "OPEN-SKU-3P-TENT",       warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 999, sourceType: "opening_stock", status: "confirmed", notes: "Opening stock" },
  { date: "2025-10-09", reference: "DSP-SKU-3P-TENT-20251009", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 4, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-15", reference: "DSP-SKU-3P-TENT-20251015", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 15, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-16", reference: "DSP-SKU-3P-TENT-20251016", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-18", reference: "DSP-SKU-3P-TENT-20251018", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-22", reference: "DSP-SKU-3P-TENT-20251022", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 12, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-25", reference: "DSP-SKU-3P-TENT-20251025", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-27", reference: "DSP-SKU-3P-TENT-20251027", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 10, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-29", reference: "DSP-SKU-3P-TENT-20251029", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-10-30", reference: "DSP-SKU-3P-TENT-20251030", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 7, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-03", reference: "DSP-SKU-3P-TENT-20251103", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 21, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-04", reference: "DSP-SKU-3P-TENT-20251104", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-07", reference: "DSP-SKU-3P-TENT-20251107", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-09", reference: "DSP-SKU-3P-TENT-20251109", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 4, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-10", reference: "DSP-SKU-3P-TENT-20251110", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-13", reference: "DSP-SKU-3P-TENT-20251113", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-14", reference: "DSP-SKU-3P-TENT-20251114", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 10, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-15", reference: "DSP-SKU-3P-TENT-20251115", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-19", reference: "DSP-SKU-3P-TENT-20251119", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-20", reference: "DSP-SKU-3P-TENT-20251120", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 4, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-11-22", reference: "DSP-SKU-3P-TENT-20251122", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 10, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-03", reference: "DSP-SKU-3P-TENT-20251203", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-10", reference: "DSP-SKU-3P-TENT-20251210", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 12, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-15", reference: "DSP-SKU-3P-TENT-20251215", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 20, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-16", reference: "DSP-SKU-3P-TENT-20251216", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-17", reference: "DSP-SKU-3P-TENT-20251217", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-22", reference: "DSP-SKU-3P-TENT-20251222", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 37, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2025-12-23", reference: "DSP-SKU-3P-TENT-20251223", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 30, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-01-01", reference: "DSP-SKU-3P-TENT-20260101", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 200, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-01", reference: "DSP-SKU-3P-TENT-20260401", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 22, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-03", reference: "DSP-SKU-3P-TENT-20260403", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-09", reference: "DSP-SKU-3P-TENT-20260409", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-13", reference: "DSP-SKU-3P-TENT-20260413", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-24", reference: "DSP-SKU-3P-TENT-20260424", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-28", reference: "DSP-SKU-3P-TENT-20260428", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-04-29", reference: "DSP-SKU-3P-TENT-20260429", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 12, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-01", reference: "DSP-SKU-3P-TENT-20260501", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 50, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-05", reference: "DSP-SKU-3P-TENT-20260505", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-06", reference: "DSP-SKU-3P-TENT-20260506", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-09", reference: "DSP-SKU-3P-TENT-20260509", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-12", reference: "GRN-SKU-3P-TENT-20260512", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 1, sourceType: "goods_receipt", status: "confirmed", notes: "Customer return" },
  { date: "2026-05-13", reference: "DSP-SKU-3P-TENT-20260513", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-15", reference: "DSP-SKU-3P-TENT-20260515", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-18", reference: "DSP-SKU-3P-TENT-20260518", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-19", reference: "DSP-SKU-3P-TENT-20260519", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-21", reference: "DSP-SKU-3P-TENT-20260521", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-22", reference: "DSP-SKU-3P-TENT-20260522", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-23", reference: "DSP-SKU-3P-TENT-20260523", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 5, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-24", reference: "DSP-SKU-3P-TENT-20260524", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-25", reference: "DSP-SKU-3P-TENT-20260525", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-26", reference: "DSP-SKU-3P-TENT-20260526", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-29", reference: "DSP-SKU-3P-TENT-20260529", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-30", reference: "DSP-SKU-3P-TENT-20260530", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-05-31", reference: "GRN-SKU-3P-TENT-20260531", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 1, sourceType: "goods_receipt", status: "confirmed", notes: "Customer return" },
  { date: "2026-06-01", reference: "DSP-SKU-3P-TENT-20260601", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-02", reference: "DSP-SKU-3P-TENT-20260602", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 23, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-03", reference: "GRN-SKU-3P-TENT-20260603", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 3, sourceType: "goods_receipt", status: "confirmed", notes: "Customer return" },
  { date: "2026-06-04", reference: "DSP-SKU-3P-TENT-20260604", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-06", reference: "DSP-SKU-3P-TENT-20260606", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 41, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-07", reference: "DSP-SKU-3P-TENT-20260607", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-08", reference: "DSP-SKU-3P-TENT-20260608", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-09", reference: "DSP-SKU-3P-TENT-20260609", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 6, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-12", reference: "DSP-SKU-3P-TENT-20260612", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-15", reference: "DSP-SKU-3P-TENT-20260615", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 7, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-17", reference: "DSP-SKU-3P-TENT-20260617", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 13, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-18", reference: "DSP-SKU-3P-TENT-20260618", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-20", reference: "DSP-SKU-3P-TENT-20260620", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-22", reference: "DSP-SKU-3P-TENT-20260622", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-23", reference: "GRN-SKU-3P-TENT-20260623", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 1, sourceType: "goods_receipt", status: "confirmed", notes: "Customer return" },
  { date: "2026-06-24", reference: "DSP-SKU-3P-TENT-20260624", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-25", reference: "GRN-SKU-3P-TENT-20260625", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 2, sourceType: "goods_receipt", status: "confirmed", notes: "Customer return" },
  { date: "2026-06-26", reference: "DSP-SKU-3P-TENT-20260626", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-27", reference: "DSP-SKU-3P-TENT-20260627", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 7, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-06-30", reference: "GRN-SKU-3P-TENT-20260630", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "credit", quantity: 6, sourceType: "goods_receipt", status: "confirmed", notes: "Customer return" },
  { date: "2026-07-01", reference: "DSP-SKU-3P-TENT-20260701", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 124, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-07-24", reference: "DSP-SKU-3P-TENT-20260724", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-07-25", reference: "DSP-SKU-3P-TENT-20260725", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 30, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-07-28", reference: "DSP-SKU-3P-TENT-20260728", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-07-31", reference: "DSP-SKU-3P-TENT-20260731", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 15, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-06", reference: "DSP-SKU-3P-TENT-20260806", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-10", reference: "DSP-SKU-3P-TENT-20260810", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-11", reference: "DSP-SKU-3P-TENT-20260811", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-12", reference: "DSP-SKU-3P-TENT-20260812", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 2, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-19", reference: "DSP-SKU-3P-TENT-20260819", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-22", reference: "DSP-SKU-3P-TENT-20260822", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 1, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  { date: "2026-08-26", reference: "DSP-SKU-3P-TENT-20260826", warehouse: "Main Warehouse", sku: "SKU-3P-TENT", product: "3P-TENT", direction: "debit", quantity: 3, sourceType: "dispatch", status: "confirmed", notes: "Dispatch" },
  ],

  "ADV-DB-002": [
    { date: "2024-08-01", reference: "OPEN-ADV-DB-002",     warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "credit", quantity: 950, sourceType: "opening_stock", status: "confirmed", notes: "Opening stock for test" },
    { date: "2024-08-25", reference: "DSP-ADV-DB-002-202408", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 80, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2024" },
    { date: "2024-09-25", reference: "DSP-ADV-DB-002-202409", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 78, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Sep 2024" },
    { date: "2024-10-25", reference: "DSP-ADV-DB-002-202410", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 75, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Oct 2024" },
    { date: "2024-11-25", reference: "DSP-ADV-DB-002-202411", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 72, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Nov 2024" },
    { date: "2024-12-25", reference: "DSP-ADV-DB-002-202412", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 68, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Dec 2024" },
    { date: "2025-01-25", reference: "DSP-ADV-DB-002-202501", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 65, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jan 2025" },
    { date: "2025-02-25", reference: "DSP-ADV-DB-002-202502", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 60, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Feb 2025" },
    { date: "2025-03-25", reference: "DSP-ADV-DB-002-202503", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 58, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Mar 2025" },
    { date: "2025-04-25", reference: "DSP-ADV-DB-002-202504", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 55, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Apr 2025" },
    { date: "2025-05-25", reference: "DSP-ADV-DB-002-202505", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 52, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - May 2025" },
    { date: "2025-06-25", reference: "DSP-ADV-DB-002-202506", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 48, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jun 2025" },
    { date: "2025-07-25", reference: "DSP-ADV-DB-002-202507", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 45, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jul 2025" },
    { date: "2025-08-01", reference: "GRN-TEST-101",           warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "credit", quantity: 500, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
    { date: "2025-08-25", reference: "DSP-ADV-DB-002-202508", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 70, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2025" },
    { date: "2025-09-25", reference: "DSP-ADV-DB-002-202509", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 65, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Sep 2025" },
    { date: "2025-10-25", reference: "DSP-ADV-DB-002-202510", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 60, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Oct 2025" },
    { date: "2025-11-25", reference: "DSP-ADV-DB-002-202511", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 58, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Nov 2025" },
    { date: "2025-12-25", reference: "DSP-ADV-DB-002-202512", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 55, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Dec 2025" },
    { date: "2026-01-25", reference: "DSP-ADV-DB-002-202601", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 50, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jan 2026" },
    { date: "2026-02-25", reference: "DSP-ADV-DB-002-202602", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 45, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Feb 2026" },
    { date: "2026-03-01", reference: "GRN-TEST-102",           warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "credit", quantity: 351, sourceType: "goods_receipt", status: "confirmed", notes: "Confirmed GRN / stock receipt" },
    { date: "2026-03-25", reference: "DSP-ADV-DB-002-202603", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 42, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Mar 2026" },
    { date: "2026-04-25", reference: "DSP-ADV-DB-002-202604", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 35, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Apr 2026" },
    { date: "2026-05-25", reference: "DSP-ADV-DB-002-202605", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 25, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - May 2026" },
    { date: "2026-06-25", reference: "DSP-ADV-DB-002-202606", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 18, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jun 2026" },
    { date: "2026-07-25", reference: "DSP-ADV-DB-002-202607", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 12, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Jul 2026" },
    { date: "2026-08-25", reference: "DSP-ADV-DB-002-202608", warehouse: "Main Warehouse", sku: "ADV-DB-002", product: "Adventra Summit Dry Bag", direction: "debit", quantity: 10, sourceType: "dispatch", status: "confirmed", notes: "Confirmed dispatch - Aug 2026" },
  ],
};

// ---------------------------------------------------------------------------
// Mapping — spreadsheet values → StockMovement fields
// ---------------------------------------------------------------------------
/** credit → stock in ("in"), debit → stock out ("out"). */
const directionOf = (d: Entry["direction"]): "in" | "out" => (d === "credit" ? "in" : "out");

/** Source type → movement reason (mirrors the GRN / Dispatch system reasons). */
function reasonOf(sourceType: SourceType): string {
  switch (sourceType) {
    case "opening_stock": return "Opening stock";
    case "dispatch":      return "Dispatch";
    case "goods_receipt": return "Goods receipt";
  }
}

/** Source type → linked document type (GRN / Dispatch), null for opening stock. */
function linkedDocumentTypeOf(sourceType: SourceType): string | null {
  switch (sourceType) {
    case "dispatch":      return "Dispatch";
    case "goods_receipt": return "GRN";
    case "opening_stock": return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Safety guards: this script writes to the REAL DynamoDB table.
  const isDryRun = process.argv.includes("--dry-run");
  const hasConfirmed = process.argv.includes("--yes");
  if (!isDryRun && !hasConfirmed) {
    log(`❌ Refusing to write to table "${config.dynamodb.tableName}" without confirmation.`);
    log("   Re-run with:  --yes");
    log("   To preview without writing anything, use:            --dry-run");
    process.exit(1);
  }
  if (isDryRun) log("▶ DRY RUN — no data will be written.\n");

  const adminEmail = config.admin.email;
  if (!adminEmail) {
    log("❌ No ADMIN_EMAIL set in backend/.env — cannot resolve the owner account.");
    process.exit(1);
  }

  const users = (await db.scanByType("User")) as any[];
  const owner = users.find((u) => u.email === adminEmail);
  if (!owner) {
    log(`❌ User "${adminEmail}" not found. Create it by starting the backend once, or set ADMIN_EMAIL correctly.`);
    process.exit(1);
  }
  const clientId = owner.id;
  log(`→ Owner account: ${owner.email} (id ${clientId})`);
  log(`→ Table: ${config.dynamodb.tableName}\n`);

  // Select the dataset for the requested SKU (first non-flag argument, so flag
  // ordering like `--yes ADV-DB-002` or `ADV-DB-002 --yes` both work).
  const targetSku = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "ADV-RC-001").toUpperCase();
  const entries = DATASETS[targetSku];
  if (!entries) {
    log(`❌ No dataset for SKU ${targetSku}. Available datasets:`);
    for (const sku of Object.keys(DATASETS)) log(`   · ${sku}`);
    process.exit(1);
  }

  // Resolve the catalogue product by SKU — movements must link to it.
  const products = (await Product.list(clientId)) as any[];
  const product = products.find((p: any) => (p.sku ?? "").toUpperCase() === targetSku);
  if (!product) {
    log(`❌ SKU ${targetSku} not found in the catalogue. Existing SKUs:`);
    for (const p of products) log(`   · ${p.sku} — ${p.name}`);
    process.exit(1);
  }
  log(`→ Product: ${product.sku} — ${product.name}\n`);

  const unit = product.unitOfMeasure || "unit";
  const unitCost = Number(product.unitCost) > 0 ? Number(product.unitCost) : null;
  const createdBy = { id: owner.id, name: owner.email };

  // Existing movements for this product (idempotency check by reference).
  const existing = (await StockMovement.list(clientId)).filter((m) => m.productId === product.id);

  if (isDryRun) {
    log(`PLAN (${entries.length} entries):`);
    let balance = 0;
    for (const e of entries) {
      const dir = directionOf(e.direction);
      const dup = existing.some(
        (m) => m.linkedDocumentNumber === e.reference && m.direction === dir && m.status === "confirmed"
      );
      balance += dir === "in" ? e.quantity : -e.quantity;
      log(
        `  ${dup ? "SKIP" : "NEW "}  ${e.date}  ${dir === "in" ? "IN " : "OUT"}  qty=${e.quantity}` +
        `  ${e.reference}  (${reasonOf(e.sourceType)})`
      );
    }
    log(`\nExpected running balance after all entries: ${balance}`);
    log("(End of dry run — nothing written.)");
    process.exit(0);
  }

  // Create movements (skip already-seeded references).
  const counts = { in: 0, out: 0, skipped: 0 };
  let balance = 0;
  const created: any[] = [];

  for (const e of entries) {
    const dir = directionOf(e.direction);
    const dup = existing.some(
      (m) => m.linkedDocumentNumber === e.reference && m.direction === dir && m.status === "confirmed"
    );
    if (dup) {
      counts.skipped += 1;
      log(`  · ${e.reference}: already exists (${dir}) → skipped`);
      continue;
    }
    const item = await StockMovement.create({
      clientId,
      productId: product.id,
      direction: dir,
      itemName: e.product,
      sku: e.sku,
      quantity: e.quantity,
      unit,
      unitCost,
      warehouse: e.warehouse,
      reason: reasonOf(e.sourceType),
      linkedDocumentType: linkedDocumentTypeOf(e.sourceType),
      linkedDocumentNumber: e.reference,
      status: e.status,
      notes: e.notes,
      movementDate: e.date,
      createdById: createdBy.id,
      createdByName: createdBy.name,
      confirmedById: createdBy.id,
      confirmedByName: createdBy.name,
      confirmedAt: db.nowISO(),
    });
    created.push(item);
    counts[dir] += 1;
    balance += dir === "in" ? e.quantity : -e.quantity;
    log(`  ✓ ${e.date}  ${dir === "in" ? "IN " : "OUT"}  qty=${e.quantity}  ${e.reference}  → ${item.movementNumber}`);
  }

  log(`\n→ Movements written: ${counts.in} in, ${counts.out} out, ${counts.skipped} skipped (already existed)`);
  log(`→ Balance delta from this run: ${balance}`);

  // True running balance = all confirmed movements for the product (in − out).
  const allForProduct = (await StockMovement.list(clientId)).filter(
    (m) => m.productId === product.id && m.status === "confirmed"
  );
  const running = allForProduct.reduce(
    (sum, m) => sum + (m.direction === "in" ? m.quantity : -m.quantity),
    0
  );
  log(`→ Running balance for ${product.sku} (confirmed in − confirmed out): ${running}`);

  // Recompute forecasts exactly like the API does after a movement change,
  // so the Demand Forecast page reflects the new data immediately.
  const { recomputeAll } = await import("../src/services/forecast-service.js");
  try {
    const res = await recomputeAll(clientId);
    log(`→ Forecast recomputed for ${res.count} active product(s) (computed ${res.computedDate}).`);
  } catch (err: any) {
    log(`  ⚠ Forecast recompute failed (movements are still saved): ${err?.message ?? err}`);
  }

  log(`\n✅ Done. ${created.length} movement(s) created for ${product.sku}.`);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
