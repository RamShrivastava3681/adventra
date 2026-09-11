// Seed default SKU masters (Category / Gender / Colour / Size) for a client.
// Run with: cd backend && npx tsx scripts/seed-sku-masters.ts --clientId=<userId>
// Idempotent: existing codes for the client are skipped.
//
// Spec defaults:
//   Categories: T-Shirts(TN) Shirts(SH) Jeans(JN) Jackets(JK)
//   Genders: Men(MEN) Women(WOM) Unisex(UNI) Kids(KID) Boys(BOY) Girls(GRL) — fixed codes
//   Colours: 36 standard colours (Black(BLK) … Transparent(CLR)) — fixed codes
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
  { masterType: "gender", name: "Men", code: "MEN" },
  { masterType: "gender", name: "Women", code: "WOM" },
  { masterType: "gender", name: "Unisex", code: "UNI" },
  { masterType: "gender", name: "Kids", code: "KID" },
  { masterType: "gender", name: "Boys", code: "BOY" },
  { masterType: "gender", name: "Girls", code: "GRL" },
  { masterType: "color", name: "Black", code: "BLK" },
  { masterType: "color", name: "White", code: "WHT" },
  { masterType: "color", name: "Grey", code: "GRY" },
  { masterType: "color", name: "Charcoal", code: "CHR" },
  { masterType: "color", name: "Silver", code: "SLV" },
  { masterType: "color", name: "Blue", code: "BLU" },
  { masterType: "color", name: "Navy Blue", code: "NVY" },
  { masterType: "color", name: "Royal Blue", code: "RYL" },
  { masterType: "color", name: "Sky Blue", code: "SKY" },
  { masterType: "color", name: "Ice Blue", code: "IBL" },
  { masterType: "color", name: "Teal", code: "TEL" },
  { masterType: "color", name: "Turquoise", code: "TRQ" },
  { masterType: "color", name: "Green", code: "GRN" },
  { masterType: "color", name: "Olive Green", code: "OLV" },
  { masterType: "color", name: "Forest Green", code: "FGR" },
  { masterType: "color", name: "Khaki", code: "KHK" },
  { masterType: "color", name: "Red", code: "RED" },
  { masterType: "color", name: "Maroon", code: "MAR" },
  { masterType: "color", name: "Burgundy", code: "BRG" },
  { masterType: "color", name: "Orange", code: "ORG" },
  { masterType: "color", name: "Yellow", code: "YLW" },
  { masterType: "color", name: "Purple", code: "PUR" },
  { masterType: "color", name: "Pink", code: "PNK" },
  { masterType: "color", name: "Brown", code: "BRN" },
  { masterType: "color", name: "Coyote Brown", code: "CYB" },
  { masterType: "color", name: "Tan", code: "TAN" },
  { masterType: "color", name: "Beige", code: "BEI" },
  { masterType: "color", name: "Sand", code: "SND" },
  { masterType: "color", name: "Stone", code: "STN" },
  { masterType: "color", name: "Desert Sand", code: "DST" },
  { masterType: "color", name: "Gold", code: "GLD" },
  { masterType: "color", name: "Copper", code: "CPR" },
  { masterType: "color", name: "Camouflage", code: "CAM" },
  { masterType: "color", name: "Multi Colour", code: "MLT" },
  { masterType: "color", name: "Assorted", code: "AST" },
  { masterType: "color", name: "Transparent", code: "CLR" },
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
