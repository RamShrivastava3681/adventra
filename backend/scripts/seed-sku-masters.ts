// Seed default SKU masters (Category / Gender / Colour / Size) for a client.
// Run with: cd backend && npx tsx scripts/seed-sku-masters.ts --clientId=<userId>
// Idempotent: existing codes for the client are skipped.
//
// Spec defaults:
//   Categories: T-Shirts(TN) Shirts(SH) Jeans(JN) Jackets(JK)
//   Genders: Unisex(U) Men(M) Women(W) Kids(K)
//   Colours: Aqua Blue(AQB) Black(BLK) White(WHT) Navy Blue(NVY) Red(RED)
//   Sizes: EU 38(38/EU) EU 40(40/EU) EU 42(42/EU) 3 Pair(3P/Custom)
//          Small(S/International) Medium(M/International) Large(L/International) XL(XL/International)
import * as SkuMaster from "../src/models/sku-master.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "true"];
  }),
);

const clientId = String(args.clientId ?? args.client ?? "").trim();
if (!clientId) {
  console.error("Usage: npx tsx scripts/seed-sku-masters.ts --clientId=<userId>");
  process.exit(1);
}

const SEED: Array<{ masterType: SkuMaster.SkuMasterType; name: string; code: string; sizeSystem?: string }> = [
  { masterType: "category", name: "T-Shirts", code: "TN" },
  { masterType: "category", name: "Shirts", code: "SH" },
  { masterType: "category", name: "Jeans", code: "JN" },
  { masterType: "category", name: "Jackets", code: "JK" },
  { masterType: "gender", name: "Unisex", code: "U" },
  { masterType: "gender", name: "Men", code: "M" },
  { masterType: "gender", name: "Women", code: "W" },
  { masterType: "gender", name: "Kids", code: "K" },
  { masterType: "color", name: "Aqua Blue", code: "AQB" },
  { masterType: "color", name: "Black", code: "BLK" },
  { masterType: "color", name: "White", code: "WHT" },
  { masterType: "color", name: "Navy Blue", code: "NVY" },
  { masterType: "color", name: "Red", code: "RED" },
  { masterType: "size", name: "EU 38", code: "38", sizeSystem: "EU" },
  { masterType: "size", name: "EU 40", code: "40", sizeSystem: "EU" },
  { masterType: "size", name: "EU 42", code: "42", sizeSystem: "EU" },
  { masterType: "size", name: "3 Pair", code: "3P", sizeSystem: "Custom" },
  { masterType: "size", name: "Small", code: "S", sizeSystem: "International" },
  { masterType: "size", name: "Medium", code: "M", sizeSystem: "International" },
  { masterType: "size", name: "Large", code: "L", sizeSystem: "International" },
  { masterType: "size", name: "XL", code: "XL", sizeSystem: "International" },
];

let created = 0;
let skipped = 0;
for (const s of SEED) {
  try {
    await SkuMaster.create({ clientId, ...s });
    created++;
    console.log(`+ ${s.masterType} ${s.name} (${s.code})`);
  } catch (e: any) {
    if (/already exists/i.test(e?.message ?? "")) {
      skipped++;
      console.log(`= skip ${s.masterType} ${s.code} (exists)`);
    } else {
      throw e;
    }
  }
}
console.log(`Done. created=${created} skipped=${skipped}`);
process.exit(0);
